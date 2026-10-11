# Camera Proxy Server
# PowerShell HTTP proxy for Xiongmai/XMEye IP cameras
# Translates web API calls to camera-specific endpoints with Digest auth

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', '', Justification = 'Read by the functions below')]
param(
    [int]$Port = 8080,
    [string]$ConfigFile = "$PSScriptRoot\camera_config.json",
    [switch]$Launch
)

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Security

$ErrorActionPreference = "Continue"

# --- Global State ---

$script:CameraIP       = ""
$script:Username       = "admin"
$script:Password       = "admin"
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
if (-not $script:AppVersion) { $script:AppVersion = 'dev' }

# Settings stored in camera_config.json (next to the EXE). The password is handled separately.
$script:DefaultSettings = [ordered]@{
    ip            = "192.168.178.19"
    username      = "admin"
    timeout       = 5
    retryInterval = 10
    maxDelay      = 1
    panSpeed      = 5
    tiltSpeed     = 5
    zoomSpeed     = 5
    language      = "en"
    theme         = "dark"
}

# --- Camera HTTP Client ---

function Initialize-CameraClient {
    if ($script:HttpClient) { $script:HttpClient.Dispose(); $script:HttpClient = $null }
    if ($script:Handler)    { $script:Handler.Dispose();    $script:Handler    = $null }
    $script:ProbeTask   = $null
    $script:IsConnected = $false
    $script:StatusKnown = $false

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

# Sends a command to the camera. Returns $null (and marks the camera offline) if it does not answer.
function Invoke-Camera([string]$url) {
    try {
        return $script:HttpClient.GetAsync($url).Result
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
        'timeout'       { return [Math]::Min(60, [Math]::Max(1, [int]$value)) }
        'retryInterval' { return [Math]::Min(3600, [Math]::Max(2, [int]$value)) }
        'maxDelay'      { return [Math]::Min(10.0, [Math]::Max(0.5, [double]$value)) }
        'theme'         { return $(if ($value -eq 'light') { 'light' } else { 'dark' }) }
        'language'      {
            if ("$value" -notmatch '^[a-z]{2}$') { throw "invalid language '$value'" }
            return "$value"
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

    if (-not (Test-Path $ConfigFile)) {
        Write-Host "[config] $ConfigFile not found, using defaults"
        return
    }
    try {
        $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "[config] Could not read $ConfigFile, using defaults: $_"
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
    Write-Host "[config] Loaded $ConfigFile"
}

function Export-Config {
    $data = [ordered]@{}
    foreach ($key in $script:Settings.Keys) { $data[$key] = $script:Settings[$key] }
    if ($script:PasswordProtected) { $data['passwordProtected'] = $script:PasswordProtected }
    try {
        [System.IO.File]::WriteAllText($ConfigFile, ($data | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
        return $true
    }
    catch {
        Write-Host "[config] Could not save $($ConfigFile): $($_.Exception.GetBaseException().Message)"
        return $false
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

function Find-Chrome {
    param([string]$Url)

    $paths = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
    )

    $chrome = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($chrome) {
        Write-Host "[launcher] Opening Chrome: $Url"
        $profileDir = Join-Path $env:TEMP 'CameraControlChrome'
        # Pre-seed Chrome preferences to disable translate prompt
        $defaultDir = Join-Path $profileDir 'Default'
        if (-not (Test-Path $defaultDir)) { New-Item -ItemType Directory -Force -Path $defaultDir | Out-Null }
        $prefsFile = Join-Path $defaultDir 'Preferences'
        if (-not (Test-Path $prefsFile)) {
            Set-Content $prefsFile '{"translate":{"enabled":false},"translate_blocked_languages":[],"translate_site_blacklist_with_time":{}}' -Encoding UTF8
        }
        return Start-Process -FilePath $chrome `
            -ArgumentList "--app=$Url", "--window-size=1400,900", "--window-position=100,100", "--user-data-dir=$profileDir", "--no-first-run", "--no-default-browser-check", "--disable-features=Translate" `
            -PassThru
    }
    else {
        Write-Host "[launcher] Chrome not found, opening default browser: $Url"
        Start-Process $Url
        return $null
    }
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
        ".svg"  { return "image/svg+xml" }
        ".ico"  { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

# --- Send JSON response ---

function Send-Json {
    param(
        [System.Net.HttpListenerResponse]$resp,
        [string]$json,
        [int]$status = 200
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $resp.StatusCode   = $status
    $resp.ContentType  = "application/json; charset=utf-8"
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    $resp.OutputStream.Close()
}

function Send-CameraOffline([System.Net.HttpListenerResponse]$resp) {
    Send-Json $resp '{"status":"error","message":"Camera not connected"}' 503
}

# --- Send plain text / error ---

function Send-Text {
    param(
        [System.Net.HttpListenerResponse]$resp,
        [string]$text,
        [int]$status = 200
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $resp.StatusCode   = $status
    $resp.ContentType  = "text/plain; charset=utf-8"
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    $resp.OutputStream.Close()
}

# Only our own page may use the API: blocks other websites from controlling the camera or reading settings
function Test-SameOrigin([System.Net.HttpListenerRequest]$req) {
    $site = $req.Headers['Sec-Fetch-Site']
    if ($site -and $site -ne 'same-origin' -and $site -ne 'none') { return $false }
    $origin = $req.Headers['Origin']
    return (-not $origin) -or ($origin -eq "http://localhost:$Port") -or ($origin -eq "http://127.0.0.1:$Port")
}

# --- API: GET /api/settings.js (loaded by index.html before the app starts) ---

function Handle-SettingsScript {
    param([System.Net.HttpListenerContext]$ctx)

    # Never contains the password
    $json  = $script:Settings | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("window.CAMERA_SETTINGS = $json;")
    $ctx.Response.StatusCode      = 200
    $ctx.Response.ContentType     = "application/javascript; charset=utf-8"
    $ctx.Response.Headers.Add("Cache-Control", "no-store")
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.OutputStream.Close()
}

# --- API: POST /api/settings ---

function Handle-SettingsSave {
    param([System.Net.HttpListenerContext]$ctx)

    $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
    $body   = $reader.ReadToEnd()
    $reader.Close()

    try {
        $changes = $body | ConvertFrom-Json
        $cameraBefore = "$($script:Settings.ip)|$($script:Settings.username)|$($script:Settings.timeout)"
        $updated = @()
        foreach ($p in $changes.PSObject.Properties) {
            if (-not $script:Settings.Contains($p.Name)) { continue }
            $script:Settings[$p.Name] = ConvertTo-SettingValue $p.Name $p.Value
            $updated += $p.Name
        }
        # Empty password = keep the current one
        $passwordChanged = [bool]$changes.password
        if ($passwordChanged) {
            $script:Password = [string]$changes.password
            $script:PasswordProtected = Protect-Secret $script:Password
            $updated += 'password'
        }
        Sync-CameraConfig
        $reconnect = $passwordChanged -or ($cameraBefore -ne "$($script:Settings.ip)|$($script:Settings.username)|$($script:Settings.timeout)")
        Write-Host "[config] Updated: $($updated -join ', ') (camera $($script:CameraIP))"
        if ($reconnect) { Initialize-CameraClient }
        $saved = Export-Config
        $file  = $ConfigFile | ConvertTo-Json
        Send-Json $ctx.Response "{`"status`":`"ok`",`"reconnect`":$("$reconnect".ToLower()),`"saved`":$("$saved".ToLower()),`"file`":$file}"
    }
    catch {
        $msg = "$_" -replace '"','\"'
        Send-Json $ctx.Response "{`"status`":`"error`",`"message`":`"$msg`"}" 400
    }
}

# --- API: GET /api/health ---

function Handle-Health {
    param([System.Net.HttpListenerContext]$ctx)

    # pending = the first check after (re)configuration is still running
    $connected = if ($script:IsConnected) { "true" } else { "false" }
    $pending   = if ($script:StatusKnown) { "false" } else { "true" }
    Send-Json $ctx.Response "{`"connected`":$connected,`"pending`":$pending}"
}

# --- API: GET /api/snapshot ---

function Handle-Snapshot {
    param([System.Net.HttpListenerContext]$ctx)

    if (-not $script:IsConnected) {
        Send-Text $ctx.Response "Camera not connected" 503
        return
    }

    try {
        $ts  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $url = "http://$($script:CameraIP)/action_snapshot?t=$ts"
        $r   = $script:HttpClient.GetAsync($url).Result
        $bytes = $r.Content.ReadAsByteArrayAsync().Result

        if ($bytes.Length -gt 0) {
            $ctx.Response.StatusCode      = 200
            $ctx.Response.ContentType     = "image/jpeg"
            $ctx.Response.Headers.Add("Cache-Control", "no-cache, no-store")
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $ctx.Response.OutputStream.Close()
        }
        else {
            # Snapshot returns empty on this camera - return a 1x1 placeholder JPEG
            # so img.onload fires instead of onerror
            $b64  = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQE"
            $b64 += "BQoHBwYIDAoMCwsKCwsMDhEQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/"
            $b64 += "2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU"
            $b64 += "FBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAA"
            $b64 += "AAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAA"
            $b64 += "AAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCw"
            $b64 += "AB//2Q=="
            $placeholder = [Convert]::FromBase64String($b64)
            $ctx.Response.StatusCode      = 200
            $ctx.Response.ContentType     = "image/jpeg"
            $ctx.Response.Headers.Add("Cache-Control", "no-cache, no-store")
            $ctx.Response.ContentLength64 = $placeholder.Length
            $ctx.Response.OutputStream.Write($placeholder, 0, $placeholder.Length)
            $ctx.Response.OutputStream.Close()
        }
    }
    catch {
        Write-Host "[snapshot] Error: $_"
        Send-Text $ctx.Response "Snapshot failed: $_" 500
    }
}

# --- API: POST /api/ptz ---

function Handle-Ptz {
    param([System.Net.HttpListenerContext]$ctx)

    if (-not $script:IsConnected) {
        Send-CameraOffline $ctx.Response
        return
    }

    $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
    $body   = $reader.ReadToEnd()
    $reader.Close()

    try {
        $cmd = $body | ConvertFrom-Json
        $extraUrls = @()

        if ($cmd.action -eq "stop") {
            $navigate  = "ptzstop"
            $panSpeed  = "0"
            $tiltSpeed = "0"

            if ($cmd.code -eq "ZoomTele" -or $cmd.code -eq "ZoomWide") {
                # Firmware-specific zoom stop fallback chain (neutral commands only).
                $navigate = "zoomstop"
                $extraUrls += "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&stop&0&0"
                $extraUrls += "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&ptzstop&0&0"
            }
        }
        else {
            $navigate  = $script:PtzMap[$cmd.code]
            if (-not $navigate) { $navigate = $cmd.code.ToLower() }
            $panSpeed  = "$($cmd.arg1)"
            $tiltSpeed = "$($cmd.arg2)"
        }

        $url = "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&$navigate&$panSpeed&$tiltSpeed"
        Write-Host "[ptz] $url"
        $r = Invoke-Camera $url
        if (-not $r) {
            Send-CameraOffline $ctx.Response
            return
        }
        Write-Host "[ptz] Response: $($r.StatusCode)"

        foreach ($extra in $extraUrls) {
            Write-Host "[ptz] $extra"
            $r2 = Invoke-Camera $extra
            if ($r2) { Write-Host "[ptz] Response: $($r2.StatusCode)" }
        }

        Send-Json $ctx.Response "{`"status`":`"ok`",`"navigate`":`"$navigate`"}"
    }
    catch {
        Write-Host "[ptz] Error: $_"
        $msg = "$_" -replace '"','\"'
        Send-Json $ctx.Response "{`"status`":`"error`",`"message`":`"$msg`"}" 500
    }
}

# --- API: POST /api/preset/{n}/save ---

function Handle-PresetSave {
    param(
        [System.Net.HttpListenerContext]$ctx,
        [int]$presetNum
    )

    if (-not $script:IsConnected) {
        Send-CameraOffline $ctx.Response
        return
    }

    try {
        $url = "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&posset&$presetNum"
        Write-Host "[preset-save] $url"
        $r = Invoke-Camera $url
        if (-not $r) {
            Send-CameraOffline $ctx.Response
            return
        }
        Write-Host "[preset-save] Response: $($r.StatusCode)"

        Send-Json $ctx.Response "{`"status`":`"ok`",`"preset`":$presetNum}"
    }
    catch {
        Write-Host "[preset-save] Error: $_"
        $msg = "$_" -replace '"','\"'
        Send-Json $ctx.Response "{`"status`":`"error`",`"message`":`"$msg`"}" 500
    }
}

# --- API: POST /api/preset/{n} ---

function Handle-Preset {
    param(
        [System.Net.HttpListenerContext]$ctx,
        [int]$presetNum
    )

    if (-not $script:IsConnected) {
        Send-CameraOffline $ctx.Response
        return
    }

    try {
        $url = "http://$($script:CameraIP)/cgi-bin/ptzctrl.cgi?ptzcmd&poscall&$presetNum"
        Write-Host "[preset] $url"
        $r = Invoke-Camera $url
        if (-not $r) {
            Send-CameraOffline $ctx.Response
            return
        }
        Write-Host "[preset] Response: $($r.StatusCode)"

        Send-Json $ctx.Response "{`"status`":`"ok`",`"preset`":$presetNum}"
    }
    catch {
        Write-Host "[preset] Error: $_"
        $msg = "$_" -replace '"','\"'
        Send-Json $ctx.Response "{`"status`":`"error`",`"message`":`"$msg`"}" 500
    }
}

# --- Static file serving ---

function Handle-StaticFile {
    param(
        [System.Net.HttpListenerContext]$ctx,
        [string]$path
    )

    if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }
    $filePath = Join-Path $script:WebRoot ($path.TrimStart("/").Replace("/", "\"))

    if (-not (Test-Path $filePath -PathType Leaf)) {
        Send-Text $ctx.Response "Not found: $path" 404
        return
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $ext   = [System.IO.Path]::GetExtension($filePath)
        $mime  = Get-MimeType $ext

        $ctx.Response.StatusCode      = 200
        $ctx.Response.ContentType     = $mime
        $ctx.Response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
        $ctx.Response.Headers.Add("Pragma", "no-cache")
        $ctx.Response.Headers.Add("X-Content-Type-Options", "nosniff")
        $ctx.Response.Headers.Add("X-Frame-Options", "DENY")
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.OutputStream.Close()
    }
    catch {
        Send-Text $ctx.Response "Error reading file: $_" 500
    }
}

# --- Preset directory listing ---

function Handle-PresetList {
    param([System.Net.HttpListenerContext]$ctx)

    $presetDir = Join-Path $script:WebRoot "imgs\presets"
    $html = ""
    if (Test-Path $presetDir) {
        $items = Get-ChildItem $presetDir -File
        $links = @()
        foreach ($f in $items) {
            $links += "<a href=""$($f.Name)"">$($f.Name)</a>"
        }
        $html = $links -join "`n"
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
    $ctx.Response.StatusCode      = 200
    $ctx.Response.ContentType     = "text/html; charset=utf-8"
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.OutputStream.Close()
}

# --- Main server loop ---

function Start-ProxyServer {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingEmptyCatchBlock', '', Justification = 'Best-effort cleanup of disconnected clients and at shutdown')]
    param()

    Import-Config
    Sync-CameraConfig

    if ($script:CameraIP) {
        Initialize-CameraClient
    }

    $prefix  = "http://localhost:${Port}/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)

    # Check port availability before binding
    $sock = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try   { $sock.Start(); $sock.Stop() }
    catch {
        Write-Host ""
        Write-Host "ERROR: Port $Port is already in use."
        Write-Host "Stop the other instance (or the running proxy-server.ps1) and try again."
        Write-Host ""

        if ($Launch) {
            # If another app instance is already serving our API, reuse it and open the UI.
            try {
                $healthUrl = "http://localhost:${Port}/api/health"
                $probe = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -Method GET -TimeoutSec 2
                if ($probe.StatusCode -ge 200 -and $probe.StatusCode -lt 500) {
                    Write-Host "[launcher] Existing instance detected on port $Port. Opening UI..."
                    $null = Find-Chrome "http://localhost:${Port}/"
                    return
                }
            }
            catch {
                # Port is occupied by something else; fall through to user-visible exit prompt.
            }

            Read-Host 'Press Enter to exit'
        }

        return
    }

    $listener.Start()

    Write-Host ""
    Write-Host "========================================================"
    Write-Host "  Camera Proxy Server $($script:AppVersion)"
    Write-Host "========================================================"
    Write-Host "  Camera : $($script:CameraIP)"
    Write-Host "  Config : $ConfigFile"
    Write-Host "  URL    : http://localhost:${Port}/"
    Write-Host "  Press Ctrl+C to stop"
    Write-Host "========================================================"
    Write-Host ""

    # Launch browser if requested
    $chromeProc = $null
    if ($Launch) {
        $chromeProc = Find-Chrome "http://localhost:${Port}/"
    }

    try {
        while ($listener.IsListening) {
            Update-CameraProbe

            # Async GetContext so we can monitor the browser process and the camera between requests
            $asyncResult = $listener.BeginGetContext($null, $null)
            while (-not $asyncResult.AsyncWaitHandle.WaitOne(500)) {
                if ($Launch -and $chromeProc -and $chromeProc.HasExited) {
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
                # Route the request
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
                elseif ($path -eq "/api/snapshot") {
                    Handle-Snapshot $ctx
                }
                elseif ($path -eq "/api/ptz" -and $method -eq "POST") {
                    Handle-Ptz $ctx
                }
                elseif ($path -match "^/api/preset/(\d+)/save$" -and $method -eq "POST") {
                    Handle-PresetSave $ctx ([int]$Matches[1])
                }
                elseif ($path -match "^/api/preset/(\d+)$" -and $method -eq "POST") {
                    Handle-Preset $ctx ([int]$Matches[1])
                }
                elseif ($path -eq "/imgs/presets/" -or $path -eq "/imgs/presets") {
                    Handle-PresetList $ctx
                }
                else {
                    Handle-StaticFile $ctx $path
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
            try { Remove-Item (Join-Path $env:TEMP 'CameraControlChrome') -Recurse -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

# --- Entry point ---

Start-ProxyServer
