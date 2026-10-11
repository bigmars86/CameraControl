# CameraControl proxy server
# Serves the web UI on localhost and translates its API calls into the CGI commands of
# Xiongmai/XMEye PTZ cameras (Digest or Basic auth). build.ps1 packages it into CameraControl.exe.

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', '', Justification = 'Read by the functions below')]
param(
    # 0 = the port from the settings (default 8080)
    [int]$Port = 0,
    # Settings, preset images and log: outside the program folder, so updates and the temp cleanup keep them
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'CameraControl'),
    [switch]$Launch
)

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Security

$ErrorActionPreference = "Continue"

# --- Global State ---

$script:CameraIP       = ""
$script:Username       = "admin"
$script:Password       = ""
$script:PasswordProtected = $null   # DPAPI-encrypted password as stored in the config file
$script:Settings       = $null
$script:Timeout        = 5
$script:IsConnected    = $false
$script:StatusKnown    = $false   # false until the first check after (re)configuration finished
$script:RetryInterval  = 10       # seconds between camera reachability checks
$script:ProbeTask      = $null
$script:LastProbe      = [DateTime]::MinValue
$script:HttpClient     = $null
$script:Handler        = $null
if (-not $script:WebRoot)    { $script:WebRoot = $PSScriptRoot }
if (-not $script:LegacyDir)  { $script:LegacyDir = $PSScriptRoot }   # older versions kept settings and presets here
if (-not $script:AppVersion) { $script:AppVersion = 'dev' }
$script:ConfigFile     = Join-Path $DataDir 'camera_config.json'
$script:PresetDir      = Join-Path $DataDir 'presets'
$script:BrowserProfile = Join-Path $env:TEMP 'CameraControlBrowser'

# Preset images: "<slot>.<ext>" or "<key>-<slot>.<ext>" (key 0-9 or a-z calls camera preset slot 1-255)
$script:PresetPattern = '^(?:([0-9a-z])-)?(\d{1,3})\.(jpe?g|png|gif|webp)$'
$script:MaxImageBytes = 5MB

# Static files: only the web app (in source mode the web root is the whole repository)
$script:StaticPattern = '^/(index\.html|(css|js|lang|imgs/icons)/[A-Za-z0-9_./-]+)$'

# Settings stored in camera_config.json. The password is handled separately.
$script:DefaultSettings = [ordered]@{
    ip            = ""
    username      = "admin"
    timeout       = 5
    retryInterval = 10
    maxDelay      = 1
    panSpeed      = 5
    tiltSpeed     = 5
    zoomSpeed     = 5
    language      = "en"
    theme         = "dark"
    # Used at the next start
    browser       = "chrome"
    port          = 8080
}

# --- Camera HTTP Client ---

function Initialize-CameraClient {
    if ($script:HttpClient) { $script:HttpClient.Dispose(); $script:HttpClient = $null }
    if ($script:Handler)    { $script:Handler.Dispose();    $script:Handler    = $null }
    $script:ProbeTask   = $null
    $script:IsConnected = $false
    $script:StatusKnown = $false

    if (-not $script:CameraIP) {
        $script:StatusKnown = $true
        Write-Host "[camera] No camera address configured"
        return
    }

    try {
        $creds = New-Object System.Net.CredentialCache
        $uri   = [Uri]"http://$($script:CameraIP)/"
        $creds.Add($uri, "Digest",  (New-Object System.Net.NetworkCredential($script:Username, $script:Password)))
        $creds.Add($uri, "Basic",   (New-Object System.Net.NetworkCredential($script:Username, $script:Password)))

        $handler                   = New-Object System.Net.Http.HttpClientHandler
        $handler.Credentials       = $creds
        $handler.PreAuthenticate   = $false
        $handler.UseCookies        = $true
        $handler.AllowAutoRedirect = $true

        $client         = New-Object System.Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromSeconds($script:Timeout)
    }
    catch {
        Set-CameraConnected $false "invalid camera address '$($script:CameraIP)'"
        return
    }
    $script:Handler    = $handler
    $script:HttpClient = $client

    # Checked in the background, so an offline camera never blocks the server
    Start-CameraProbe
}

# --- Camera reachability (checked every $RetryInterval seconds by the server loop) ---

function Start-CameraProbe {
    if (-not $script:HttpClient -or $script:ProbeTask) { return }
    $script:LastProbe = [DateTime]::UtcNow
    $script:ProbeTask = $script:HttpClient.GetAsync("http://$($script:CameraIP)/")
}

function Update-CameraProbe {
    $task = $script:ProbeTask
    if ($task) {
        if (-not $task.IsCompleted) { return }
        $script:ProbeTask = $null
        if ($task.Status -eq 'RanToCompletion') {
            $status = $task.Result.StatusCode
            $task.Result.Dispose()
            Set-CameraConnected ($status -eq [System.Net.HttpStatusCode]::OK) "HTTP $([int]$status)"
        }
        elseif ($task.IsFaulted) {
            Set-CameraConnected $false $task.Exception.GetBaseException().Message
        }
        else {
            Set-CameraConnected $false "no answer within $($script:Timeout)s"
        }
    }
    elseif (([DateTime]::UtcNow - $script:LastProbe).TotalSeconds -ge $script:RetryInterval) {
        Start-CameraProbe
    }
}

function Set-CameraConnected([bool]$online, [string]$reason) {
    if (-not $script:StatusKnown -or $online -ne $script:IsConnected) {
        if ($online) { Write-Host "[camera] Connected ($($script:CameraIP))" }
        else         { Write-Host "[camera] Offline ($($script:CameraIP)): $reason - retrying every $($script:RetryInterval)s" }
    }
    $script:IsConnected = $online
    $script:StatusKnown = $true
}

# Sends a command to the camera and returns the HTTP status code, or $null (and marks the camera offline)
# if it does not answer.
function Invoke-Camera([string]$url) {
    try {
        $response = $script:HttpClient.GetAsync($url).Result
        $status = [int]$response.StatusCode
        $response.Dispose()
        return $status
    }
    catch {
        Set-CameraConnected $false $_.Exception.GetBaseException().Message
        return $null
    }
}

# --- Settings (camera_config.json) ---

# The password is stored with Windows DPAPI: only the same Windows user on the same PC can decrypt it.
$script:SecretEntropy = [System.Text.Encoding]::UTF8.GetBytes('CameraControl')

function Protect-Secret([string]$plain) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
    $cipher = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $script:SecretEntropy, 'CurrentUser')
    return [Convert]::ToBase64String($cipher)
}

function Unprotect-Secret([string]$protected) {
    $cipher = [Convert]::FromBase64String($protected)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $script:SecretEntropy, 'CurrentUser')
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

# Validates a value from the config file or the UI; throws on values that cannot be converted.
function ConvertTo-SettingValue([string]$name, $value) {
    switch ($name) {
        'ip'            {
            # Used in camera URLs: host name or IPv4 address, optionally with a port
            $address = "$value".Trim()
            if ($address -and $address -notmatch '^[A-Za-z0-9.-]+(:\d{1,5})?$') { throw "invalid camera address '$value'" }
            return $address
        }
        'timeout'       { return [Math]::Min(60, [Math]::Max(1, [int]$value)) }
        'retryInterval' { return [Math]::Min(3600, [Math]::Max(2, [int]$value)) }
        'maxDelay'      { return [Math]::Min(10.0, [Math]::Max(0.5, [double]$value)) }
        'theme'         { return $(if ($value -eq 'light') { 'light' } else { 'dark' }) }
        'language'      {
            if ("$value" -notmatch '^[a-z]{2}$') { throw "invalid language '$value'" }
            return "$value"
        }
        'browser'       {
            if ("$value" -notin 'chrome', 'edge') { throw "invalid browser '$value'" }
            return "$value".ToLower()
        }
        'port'          {
            $number = [int]$value
            if ($number -lt 1024 -or $number -gt 65535) { throw "invalid port '$value' (1024-65535)" }
            return $number
        }
        { $_ -like '*Speed' } { return [Math]::Min(10, [Math]::Max(1, [int]$value)) }
        default         { return "$value" }
    }
}

function Sync-CameraConfig {
    $script:CameraIP      = $script:Settings.ip
    $script:Username      = $script:Settings.username
    $script:Timeout       = $script:Settings.timeout
    $script:RetryInterval = $script:Settings.retryInterval
}

function Import-Config {
    $script:Settings = [ordered]@{}
    foreach ($key in $script:DefaultSettings.Keys) { $script:Settings[$key] = $script:DefaultSettings[$key] }

    if (-not (Test-Path -LiteralPath $script:ConfigFile)) {
        Write-Host "[config] $($script:ConfigFile) not found, using defaults"
        return
    }
    try {
        $cfg = Get-Content -LiteralPath $script:ConfigFile -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "[config] Could not read $($script:ConfigFile), using defaults: $_"
        return
    }

    foreach ($p in $cfg.PSObject.Properties) {
        if (-not $script:Settings.Contains($p.Name)) { continue }
        try   { $script:Settings[$p.Name] = ConvertTo-SettingValue $p.Name $p.Value }
        catch { Write-Host "[config] Ignoring invalid value for '$($p.Name)'" }
    }

    if ($cfg.passwordProtected) {
        try {
            $script:Password = Unprotect-Secret $cfg.passwordProtected
            $script:PasswordProtected = $cfg.passwordProtected
        }
        catch {
            Write-Host "[config] The saved password belongs to another Windows user or PC - enter it again in the settings"
        }
    }
    if ($cfg.password) {
        # Plain-text password typed into the file by hand: use it, but store it encrypted
        $script:Password = [string]$cfg.password
        $script:PasswordProtected = Protect-Secret $script:Password
        if (Export-Config) { Write-Host "[config] Password moved to encrypted storage" }
    }
    Write-Host "[config] Loaded $($script:ConfigFile)"
}

function Export-Config {
    $data = [ordered]@{}
    foreach ($key in $script:Settings.Keys) { $data[$key] = $script:Settings[$key] }
    if ($script:PasswordProtected) { $data['passwordProtected'] = $script:PasswordProtected }
    try {
        New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
        [System.IO.File]::WriteAllText($script:ConfigFile, ($data | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
        return $true
    }
    catch {
        Write-Host "[config] Could not save $($script:ConfigFile): $($_.Exception.GetBaseException().Message)"
        return $false
    }
}

# Older versions kept camera_config.json and imgs\presets next to the EXE (or this script): copy them once
function Import-LegacyData {
    if (Test-Path -LiteralPath $script:ConfigFile) { return }
    $oldConfig = Join-Path $script:LegacyDir 'camera_config.json'
    if (Test-Path -LiteralPath $oldConfig -PathType Leaf) {
        Copy-Item -LiteralPath $oldConfig -Destination $script:ConfigFile
        Write-Host "[config] Copied settings from $oldConfig"
    }
    $oldPresets = Join-Path $script:LegacyDir 'imgs\presets'
    if (Test-Path -LiteralPath $oldPresets) {
        $images = @(Get-ChildItem -LiteralPath $oldPresets -File | Where-Object { $_.Name -match $script:PresetPattern })
        if ($images) {
            $images | Copy-Item -Destination $script:PresetDir -Force
            Write-Host "[presets] Copied $($images.Count) preset images from $oldPresets"
        }
    }
}

# --- PTZ direction mapping (JS code -> camera navigate value) ---

$script:PtzMap = @{
    "Up"        = "up"
    "Down"      = "down"
    "Left"      = "left"
    "Right"     = "right"
    "LeftUp"    = "leftup"
    "RightUp"   = "rightup"
    "LeftDown"  = "leftdown"
    "RightDown" = "rightdown"
    "ZoomTele"  = "zoomin"
    "ZoomWide"  = "zoomout"
}

# --- Browser launcher ---

# Opens the UI in Chrome or Edge as an app window with a throw-away profile and returns the browser process,
# so the server can stop when the window is closed ($null if only the default browser could be opened).
function Start-Browser([string]$Url) {
    $chrome = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
    )
    $edge = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
    )
    # The browser from the settings, or the other one if it is not installed
    $order = if ($script:Settings.browser -eq 'edge') { $edge + $chrome } else { $chrome + $edge }
    $browser = $order | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $browser) {
        Write-Host "[launcher] Neither Chrome nor Edge found, opening the default browser: $Url"
        Start-Process $Url
        return $null
    }

    Write-Host "[launcher] Opening $browser"
    # No translation prompt, and no background mode: the browser process has to end with the window
    $defaultDir = Join-Path $script:BrowserProfile 'Default'
    New-Item -ItemType Directory -Force -Path $defaultDir | Out-Null
    Set-Content -LiteralPath (Join-Path $script:BrowserProfile 'Local State') '{"background_mode":{"enabled":false}}' -Encoding Ascii
    Set-Content -LiteralPath (Join-Path $defaultDir 'Preferences') '{"translate":{"enabled":false}}' -Encoding Ascii
    return Start-Process -FilePath $browser -PassThru -ArgumentList @(
        "--app=$Url", '--window-size=1400,900', '--window-position=100,100',
        "--user-data-dir=`"$($script:BrowserProfile)`"",
        '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'
    )
}

# --- Content-Type helper ---

function Get-MimeType([string]$ext) {
    switch ($ext.ToLower()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".gif"  { return "image/gif" }
        ".webp" { return "image/webp" }
        ".svg"  { return "image/svg+xml" }
        ".ico"  { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

# --- Requests and responses ---

# no-store: settings and preset images change while the app is running
function Send-Response {
    param(
        [System.Net.HttpListenerResponse]$resp,
        [byte[]]$bytes,
        [string]$contentType,
        [int]$status = 200
    )
    $resp.StatusCode      = $status
    $resp.ContentType     = $contentType
    $resp.Headers.Add("Cache-Control", "no-store")
    $resp.Headers.Add("X-Content-Type-Options", "nosniff")
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    $resp.OutputStream.Close()
}

function Send-Json([System.Net.HttpListenerResponse]$resp, $data, [int]$status = 200) {
    $json = ConvertTo-Json -InputObject $data -Compress -Depth 5
    Send-Response $resp ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8" $status
}

function Send-Error([System.Net.HttpListenerResponse]$resp, [string]$message, [int]$status) {
    Send-Json $resp ([ordered]@{ status = 'error'; message = $message }) $status
}

function Send-CameraOffline([System.Net.HttpListenerResponse]$resp) {
    Send-Error $resp 'Camera not connected' 503
}

function Send-Text([System.Net.HttpListenerResponse]$resp, [string]$text, [int]$status = 200) {
    Send-Response $resp ([System.Text.Encoding]::UTF8.GetBytes($text)) "text/plain; charset=utf-8" $status
}

function Send-File([System.Net.HttpListenerResponse]$resp, [string]$filePath) {
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        Send-Text $resp "Not found" 404
        return
    }
    $resp.Headers.Add("X-Frame-Options", "DENY")
    Send-Response $resp ([System.IO.File]::ReadAllBytes($filePath)) (Get-MimeType ([System.IO.Path]::GetExtension($filePath)))
}

function Read-RequestText([System.Net.HttpListenerRequest]$req) {
    $reader = New-Object System.IO.StreamReader($req.InputStream)
    try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

# Returns $null if the body is larger than $limit bytes
function Read-RequestBody([System.Net.HttpListenerRequest]$req, [long]$limit) {
    $body  = New-Object System.IO.MemoryStream
    $chunk = New-Object byte[] 65536
    while (($read = $req.InputStream.Read($chunk, 0, $chunk.Length)) -gt 0) {
        if ($body.Length + $read -gt $limit) { return $null }
        $body.Write($chunk, 0, $read)
    }
    return ,$body.ToArray()
}

# Only our own page may use the API: blocks other websites from controlling the camera or reading settings
function Test-SameOrigin([System.Net.HttpListenerRequest]$req) {
    $site = $req.Headers['Sec-Fetch-Site']
    if ($site -and $site -ne 'same-origin' -and $site -ne 'none') { return $false }
    $origin = $req.Headers['Origin']
    return (-not $origin) -or ($origin -eq "http://localhost:$Port") -or ($origin -eq "http://127.0.0.1:$Port")
}

# --- API: GET /api/settings.js (loaded by index.html before the app starts) ---

function Handle-SettingsScript([System.Net.HttpListenerContext]$ctx) {
    # Never contains the password
    $json = ConvertTo-Json -InputObject $script:Settings -Compress
    Send-Response $ctx.Response ([System.Text.Encoding]::UTF8.GetBytes("window.CAMERA_SETTINGS = $json;")) "application/javascript; charset=utf-8"
}

# --- API: POST /api/settings ---

function Handle-SettingsSave([System.Net.HttpListenerContext]$ctx) {
    try {
        $changes = Read-RequestText $ctx.Request | ConvertFrom-Json
        # Validate everything before changing anything
        $values = [ordered]@{}
        foreach ($p in $changes.PSObject.Properties) {
            if ($script:Settings.Contains($p.Name)) { $values[$p.Name] = ConvertTo-SettingValue $p.Name $p.Value }
        }
    }
    catch {
        Send-Error $ctx.Response "$_" 400
        return
    }

    $cameraBefore = "$($script:Settings.ip)|$($script:Settings.username)|$($script:Settings.timeout)"
    foreach ($name in $values.Keys) { $script:Settings[$name] = $values[$name] }
    $updated = @($values.Keys)
    # Empty password = keep the current one
    $passwordChanged = [bool]$changes.password
    if ($passwordChanged) {
        $script:Password = [string]$changes.password
        $script:PasswordProtected = Protect-Secret $script:Password
        $updated += 'password'
    }
    Sync-CameraConfig
    $reconnect = $passwordChanged -or ($cameraBefore -ne "$($script:Settings.ip)|$($script:Settings.username)|$($script:Settings.timeout)")
    Write-Host "[config] Updated: $($updated -join ', ')"
    if ($reconnect) { Initialize-CameraClient }
    $saved = Export-Config
    Send-Json $ctx.Response ([ordered]@{ status = 'ok'; reconnect = $reconnect; saved = $saved; file = $script:ConfigFile })
}

# --- API: GET /api/health ---

function Handle-Health([System.Net.HttpListenerContext]$ctx) {
    # pending = the first check after (re)configuration is still running
    Send-Json $ctx.Response ([ordered]@{
        connected  = $script:IsConnected
        pending    = -not $script:StatusKnown
        configured = [bool]$script:CameraIP
    })
}

# --- API: POST /api/ptz ---

function Handle-Ptz([System.Net.HttpListenerContext]$ctx) {
    if (-not $script:IsConnected) {
        Send-CameraOffline $ctx.Response
        return
    }

    try {
        $cmd  = Read-RequestText $ctx.Request | ConvertFrom-Json
        $code = "$($cmd.code)"
        $extraUrls = @()

        if ($cmd.action -eq "stop") {
            $navigate  = "ptzstop"
            $panSpeed  = 0
            $tiltSpeed = 0

            if ($code -eq "ZoomTele" -or $code -eq "ZoomWide") {
                # Firmware-specific zoom stop fallback chain (neutral commands only).
                $navigate = "zoomstop"
                $extraUrls += "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&stop&0&0"
                $extraUrls += "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&ptzstop&0&0"
            }
        }
        else {
            $navigate = $script:PtzMap[$code]
            if (-not $navigate) {
                Send-Error $ctx.Response "unknown command '$code'" 400
                return
            }
            $panSpeed  = [Math]::Min(10, [Math]::Max(1, [int]$cmd.arg1))
            $tiltSpeed = [Math]::Min(10, [Math]::Max(1, [int]$cmd.arg2))
        }
    }
    catch {
        Send-Error $ctx.Response "invalid request: $_" 400
        return
    }

    $url = "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&$navigate&$panSpeed&$tiltSpeed"
    Write-Host "[ptz] $url"
    $status = Invoke-Camera $url
    if ($null -eq $status) {
        Send-CameraOffline $ctx.Response
        return
    }
    Write-Host "[ptz] Response: $status"

    foreach ($extra in $extraUrls) {
        Write-Host "[ptz] $extra"
        $status = Invoke-Camera $extra
        if ($null -ne $status) { Write-Host "[ptz] Response: $status" }
    }

    Send-Json $ctx.Response ([ordered]@{ status = 'ok'; navigate = $navigate })
}

# --- API: presets (camera positions and their images) ---

function Test-PresetSlot([System.Net.HttpListenerResponse]$resp, [int]$slot) {
    if ($slot -ge 1 -and $slot -le 255) { return $true }
    Send-Error $resp "preset number must be 1-255" 400
    return $false
}

# POST /api/presets/{n}/call and /save: move to, or store the current position in, camera preset slot n
function Invoke-PresetCommand([System.Net.HttpListenerContext]$ctx, [int]$slot, [string]$command) {
    if (-not (Test-PresetSlot $ctx.Response $slot)) { return }
    if (-not $script:IsConnected) {
        Send-CameraOffline $ctx.Response
        return
    }

    $url = "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&$command&$slot"
    Write-Host "[preset] $url"
    $status = Invoke-Camera $url
    if ($null -eq $status) {
        Send-CameraOffline $ctx.Response
        return
    }
    Write-Host "[preset] Response: $status"
    Send-Json $ctx.Response ([ordered]@{ status = 'ok'; preset = $slot })
}

function Get-PresetImage {
    if (-not (Test-Path -LiteralPath $script:PresetDir)) { return }
    foreach ($file in Get-ChildItem -LiteralPath $script:PresetDir -File) {
        if ($file.Name -notmatch $script:PresetPattern) { continue }
        $slot = [int]$Matches[2]
        if ($slot -lt 1 -or $slot -gt 255) { continue }
        [pscustomobject]@{ slot = $slot; key = "$($Matches[1])".ToLower(); file = $file.Name; path = $file.FullName }
    }
}

# GET /api/presets
function Handle-PresetList([System.Net.HttpListenerContext]$ctx) {
    $presets = @(Get-PresetImage | ForEach-Object { [ordered]@{ slot = $_.slot; key = $_.key; file = $_.file } })
    Send-Json $ctx.Response ([ordered]@{ folder = $script:PresetDir; presets = $presets })
}

# File extension for JPEG, PNG, GIF and WebP data, $null for anything else
function Get-ImageType([byte[]]$bytes) {
    if ($bytes.Length -lt 12) { return $null }
    $ascii = [System.Text.Encoding]::ASCII
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8 -and $bytes[2] -eq 0xFF) { return 'jpg' }
    if ($bytes[0] -eq 0x89 -and $ascii.GetString($bytes, 1, 3) -eq 'PNG') { return 'png' }
    if ($ascii.GetString($bytes, 0, 4) -eq 'GIF8') { return 'gif' }
    if ($ascii.GetString($bytes, 0, 4) -eq 'RIFF' -and $ascii.GetString($bytes, 8, 4) -eq 'WEBP') { return 'webp' }
    return $null
}

# PUT /api/presets/{n}/image?key=k (body: the image) - replaces any image of slot n
function Handle-PresetUpload([System.Net.HttpListenerContext]$ctx, [int]$slot) {
    if (-not (Test-PresetSlot $ctx.Response $slot)) { return }
    $key = "$($ctx.Request.QueryString['key'])".ToLower()
    if ($key -notmatch '^[0-9a-z]?$') {
        Send-Error $ctx.Response "key must be a single letter or digit" 400
        return
    }
    $bytes = Read-RequestBody $ctx.Request $script:MaxImageBytes
    if ($null -eq $bytes) {
        Send-Error $ctx.Response "image is larger than 5 MB" 413
        return
    }
    $type = Get-ImageType $bytes
    if (-not $type) {
        Send-Error $ctx.Response "not a JPEG, PNG, GIF or WebP image" 415
        return
    }

    $images = @(Get-PresetImage)
    $taken  = $images | Where-Object { $key -and $_.key -eq $key -and $_.slot -ne $slot } | Select-Object -First 1
    if ($taken) {
        Send-Json $ctx.Response ([ordered]@{ status = 'error'; message = "key '$key' is used by preset $($taken.slot)"; slot = $taken.slot }) 409
        return
    }
    $name = if ($key) { "$key-$slot.$type" } else { "$slot.$type" }
    try {
        New-Item -ItemType Directory -Force -Path $script:PresetDir | Out-Null
        $images | Where-Object { $_.slot -eq $slot } | ForEach-Object { Remove-Item -LiteralPath $_.path -Force }
        [System.IO.File]::WriteAllBytes((Join-Path $script:PresetDir $name), $bytes)
    }
    catch {
        Send-Error $ctx.Response "could not save the image: $($_.Exception.GetBaseException().Message)" 500
        return
    }
    Write-Host "[presets] Saved $name"
    Send-Json $ctx.Response ([ordered]@{ status = 'ok'; slot = $slot; key = $key; file = $name })
}

# DELETE /api/presets/{n}/image - the position stays stored in the camera
function Handle-PresetDelete([System.Net.HttpListenerContext]$ctx, [int]$slot) {
    $images = @(Get-PresetImage | Where-Object { $_.slot -eq $slot })
    if (-not $images) {
        Send-Error $ctx.Response "preset $slot has no image" 404
        return
    }
    foreach ($image in $images) {
        Remove-Item -LiteralPath $image.path -Force
        Write-Host "[presets] Removed $($image.file)"
    }
    Send-Json $ctx.Response ([ordered]@{ status = 'ok'; slot = $slot })
}

# POST /api/presets/folder - opens the preset folder in Explorer
function Handle-PresetFolder([System.Net.HttpListenerContext]$ctx) {
    New-Item -ItemType Directory -Force -Path $script:PresetDir | Out-Null
    Start-Process explorer.exe -ArgumentList "`"$($script:PresetDir)`""
    Send-Json $ctx.Response ([ordered]@{ status = 'ok' })
}

# GET /presets/<file>
function Handle-PresetImage([System.Net.HttpListenerContext]$ctx, [string]$name) {
    if ($name -notmatch $script:PresetPattern) {
        Send-Text $ctx.Response "Not found" 404
        return
    }
    Send-File $ctx.Response (Join-Path $script:PresetDir $name)
}

# --- Static files ---

function Handle-StaticFile([System.Net.HttpListenerContext]$ctx, [string]$path) {
    if ($path -eq "/") { $path = "/index.html" }
    if ($path -notmatch $script:StaticPattern -or $path.Contains('..')) {
        Send-Text $ctx.Response "Not found" 404
        return
    }
    Send-File $ctx.Response (Join-Path $script:WebRoot $path.Substring(1).Replace('/', '\'))
}

# --- Main server loop ---

function Test-PortFree([int]$number) {
    $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $number)
    try {
        $probe.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        $probe.Stop()
    }
}

# The app (-Launch) moves to a free port when the port is taken; in source mode -Port decides
function Start-Listener {
    if (-not (Test-PortFree $Port)) {
        if (-not $Launch) {
            Write-Host "ERROR: Port $Port is already in use. Stop the other program or choose another port with -Port."
            return $null
        }
        $busy  = $Port
        $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $probe.Start()
        $script:Port = $probe.LocalEndpoint.Port
        $probe.Stop()
        Write-Host "[server] Port $busy is in use, using port $Port"
    }
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    try {
        $listener.Start()
        return $listener
    }
    catch {
        Write-Host "ERROR: Cannot listen on port $($Port): $($_.Exception.GetBaseException().Message)"
        return $null
    }
}

function Start-ProxyServer {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingEmptyCatchBlock', '', Justification = 'Best-effort cleanup of disconnected clients and at shutdown')]
    param()

    try {
        New-Item -ItemType Directory -Force -Path $script:PresetDir | Out-Null
        Import-LegacyData
    }
    catch {
        Write-Host "[config] Cannot use the data folder $($DataDir): $($_.Exception.GetBaseException().Message)"
    }
    Import-Config
    # Written once, so a later start does not copy old files over again
    if (-not (Test-Path -LiteralPath $script:ConfigFile)) { $null = Export-Config }
    Sync-CameraConfig
    Initialize-CameraClient
    if (-not $Port) { $script:Port = $script:Settings.port }

    $listener = Start-Listener
    if (-not $listener) {
        if ($Launch) {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show("CameraControl could not start its local web server on port $Port.", 'Camera Control', 'OK', 'Error')
        }
        return
    }

    Write-Host ""
    Write-Host "========================================================"
    Write-Host "  CameraControl $($script:AppVersion)"
    Write-Host "========================================================"
    Write-Host "  Camera : $(if ($script:CameraIP) { $script:CameraIP } else { '(not configured)' })"
    Write-Host "  Data   : $DataDir"
    Write-Host "  URL    : http://localhost:$Port/"
    Write-Host "  Press Ctrl+C to stop"
    Write-Host "========================================================"
    Write-Host ""

    $browser = $null
    if ($Launch) {
        $browser = Start-Browser "http://localhost:$Port/"
    }

    try {
        while ($listener.IsListening) {
            Update-CameraProbe

            # Async GetContext so we can monitor the browser process and the camera between requests
            $asyncResult = $listener.BeginGetContext($null, $null)
            while (-not $asyncResult.AsyncWaitHandle.WaitOne(500)) {
                if ($browser -and $browser.HasExited) {
                    Write-Host "[launcher] Browser closed. Shutting down..."
                    $listener.Stop()
                    break
                }
                Update-CameraProbe
            }

            if (-not $listener.IsListening) { break }

            $ctx = $null
            try {
                $ctx = $listener.EndGetContext($asyncResult)
            }
            catch {
                # Listener was stopped
                break
            }

            $req    = $ctx.Request
            $resp   = $ctx.Response
            $path   = $req.Url.AbsolutePath
            $method = $req.HttpMethod

            # The UI polls the health endpoint every few seconds - keep it out of the log
            if ($path -ne "/api/health") {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $method $path"
            }

            try {
                if ($path.StartsWith("/api/") -and -not (Test-SameOrigin $req)) {
                    Write-Host "[security] Blocked request from another website: $method $path"
                    Send-Text $resp "Forbidden" 403
                }
                elseif ($path -eq "/api/settings.js") {
                    Handle-SettingsScript $ctx
                }
                elseif ($path -eq "/api/settings" -and $method -eq "POST") {
                    Handle-SettingsSave $ctx
                }
                elseif ($path -eq "/api/health") {
                    Handle-Health $ctx
                }
                elseif ($path -eq "/api/ptz" -and $method -eq "POST") {
                    Handle-Ptz $ctx
                }
                elseif ($path -eq "/api/presets" -and $method -eq "GET") {
                    Handle-PresetList $ctx
                }
                elseif ($path -eq "/api/presets/folder" -and $method -eq "POST") {
                    Handle-PresetFolder $ctx
                }
                elseif ($path -match "^/api/presets/(\d{1,3})/(call|save)$" -and $method -eq "POST") {
                    Invoke-PresetCommand $ctx ([int]$Matches[1]) $(if ($Matches[2] -eq 'call') { 'poscall' } else { 'posset' })
                }
                elseif ($path -match "^/api/presets/(\d{1,3})/image$" -and $method -eq "PUT") {
                    Handle-PresetUpload $ctx ([int]$Matches[1])
                }
                elseif ($path -match "^/api/presets/(\d{1,3})/image$" -and $method -eq "DELETE") {
                    Handle-PresetDelete $ctx ([int]$Matches[1])
                }
                elseif ($path -match "^/presets/([^/]+)$" -and $method -eq "GET") {
                    Handle-PresetImage $ctx $Matches[1]
                }
                elseif ($method -eq "GET") {
                    Handle-StaticFile $ctx $path
                }
                else {
                    Send-Text $resp "Not found" 404
                }
            }
            catch {
                Write-Host "[error] $path : $_"
                try { Send-Text $resp "Internal Server Error" 500 } catch { }
            }
        }
    }
    finally {
        Write-Host ""
        Write-Host "[server] Shutting down..."
        try { if ($listener.IsListening) { $listener.Stop() } } catch { }
        try { $listener.Close() } catch { }
        if ($script:HttpClient) { $script:HttpClient.Dispose() }
        if ($script:Handler)    { $script:Handler.Dispose() }
        if ($Launch) {
            try { Remove-Item -LiteralPath $script:BrowserProfile -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

# --- Entry point ---

Start-ProxyServer
