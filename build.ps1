# Build CameraControl.exe - standalone single-file executable
#
# The EXE embeds the web app (HTML, CSS, JS, translations, icons). On launch it extracts it to
# %TEMP%\CameraControl, starts the proxy, opens the browser in app mode and cleans up when the
# window is closed. Settings, preset images and the log are kept in %LOCALAPPDATA%\CameraControl.
#
# Requirements: ps2exe module
#   Install-Module ps2exe -Scope CurrentUser

param(
    # Release version (x.y.z); the release workflow passes the git tag
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '0.0.0'
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

# --- Ensure ps2exe is available ---
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "Installing ps2exe..."
    Install-Module ps2exe -Scope CurrentUser -Force
}
Import-Module ps2exe -ErrorAction Stop

# ---------------------------------------------------------------------------
# Step 1 - Collect web assets to embed
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Collecting assets..."

# File types we embed
$WebExts = @('.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')

# Only the web app itself - never repo tooling, settings, logs or user images
$AssetPaths = 'index.html', 'css', 'js', 'lang', 'imgs\icons' | ForEach-Object { Join-Path $ScriptDir $_ }

$EmbedData = [System.Collections.Generic.Dictionary[string,string]]::new()

Get-ChildItem $AssetPaths -Recurse -File | ForEach-Object {
    $relPath  = $_.FullName.Substring($ScriptDir.Length + 1)
    $relSlash = $relPath.Replace('\', '/')

    if ($WebExts -notcontains $_.Extension.ToLower()) { return }

    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $EmbedData[$relSlash] = [Convert]::ToBase64String($bytes)
    Write-Host ("  + {0,-45} {1,7} bytes" -f $relSlash, $bytes.Length)
}

Write-Host ("  Total: {0} files" -f $EmbedData.Count)

# ---------------------------------------------------------------------------
# Step 2 - Build the embedded-assets hashtable as PowerShell source
# ---------------------------------------------------------------------------
$hashLines = $EmbedData.GetEnumerator() | ForEach-Object {
    "    '$($_.Key)' = '$($_.Value)'"
}
$hashBlock = $hashLines -join "`n"

# ---------------------------------------------------------------------------
# Step 3 - Read proxy-server.ps1 and strip its param() block
#           (everything from the start up to - but not including - Add-Type)
# ---------------------------------------------------------------------------
$proxyRaw   = Get-Content "$ScriptDir\proxy-server.ps1" -Raw
$markerText = "`nAdd-Type -AssemblyName System.Net.Http"
$markerIdx  = $proxyRaw.IndexOf($markerText)
if ($markerIdx -lt 0) { throw "Marker 'Add-Type -AssemblyName System.Net.Http' not found in proxy-server.ps1" }
$proxyBody  = $proxyRaw.Substring($markerIdx + 1)   # +1 skips the leading newline

# Append temp-dir cleanup after Start-ProxyServer
$proxyBody  = $proxyBody.TrimEnd() + @'

# Cleanup: remove extracted temp assets
try { Remove-Item $_TempDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
'@

# ---------------------------------------------------------------------------
# Step 4 - Assemble the single standalone script
#           Part A: assets hashtable  (single-quoted = no interpolation by build.ps1)
#           Part B: preamble          (single-quoted = no interpolation by build.ps1)
#           Part C: proxy server body (already a string, concatenated)
# ---------------------------------------------------------------------------
$partA = @'
# ====== EMBEDDED ASSETS ======
$_Assets = @{
'@ + "`n" + $hashBlock + "`n}`n"

$partB = @'

# ====== STANDALONE PREAMBLE ======
$script:AppVersion = '__APP_VERSION__'
$_ExeDir  = Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
$_TempDir = Join-Path $env:TEMP 'CameraControl'
# Settings, preset images and log: survive updates of the EXE and the temp cleanup
$DataDir  = Join-Path $env:LOCALAPPDATA 'CameraControl'

# Single instance. Checked before extracting anything: a second instance would overwrite the
# running instance's files and delete its temp folder on exit.
$_IsFirstInstance = $false
$_InstanceMutex = [System.Threading.Mutex]::new($false, 'Local\CameraControl.SingleInstance', [ref]$_IsFirstInstance)
if (-not $_IsFirstInstance) {
    $_Message  = 'Camera Control is already running.'
    $_LangCode = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName
    if ($_Assets.ContainsKey("lang/$_LangCode.json")) {
        $_Lang = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_Assets["lang/$_LangCode.json"])) | ConvertFrom-Json
        if ($_Lang.app.alreadyRunning) { $_Message = $_Lang.app.alreadyRunning }
    }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_Message, 'Camera Control', 'OK', 'Information')
    exit
}

New-Item -ItemType Directory -Force -Path $_TempDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir -ErrorAction SilentlyContinue | Out-Null

# Write-Host goes to CameraControl.log in the data folder (one old file is kept above 1 MB).
# Logging must never raise an error: PS2EXE shows every error as a dialog.
$script:_LogFile = Join-Path $DataDir 'CameraControl.log'
try {
    if ((Get-Item $script:_LogFile -ErrorAction Stop).Length -gt 1MB) {
        Move-Item $script:_LogFile (Join-Path $DataDir 'CameraControl.old.log') -Force -ErrorAction Stop
    }
}
catch {
    $null = $_   # no log yet
}
function Write-Host {
    param([Parameter(ValueFromRemainingArguments)]$msg, [switch]$NoNewline)
    if (-not $script:_LogFile) { return }
    try {
        [System.IO.File]::AppendAllText($script:_LogFile, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $($msg -join ' ')`r`n")
    }
    catch {
        $script:_LogFile = $null   # stop logging rather than fail
    }
}

Write-Host '[init] Extracting assets...'
foreach ($entry in $_Assets.GetEnumerator()) {
    $destPath = Join-Path $_TempDir ($entry.Key -replace '/', '\')
    $destDir  = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    [System.IO.File]::WriteAllBytes($destPath, [Convert]::FromBase64String($entry.Value))
}

# Read by the proxy server code below
$script:WebRoot   = $_TempDir
$script:LegacyDir = $_ExeDir
$Port             = 0   # the port from the settings
$Launch           = $true

# ====== PROXY SERVER ======
'@
$partB = $partB.Replace('__APP_VERSION__', $Version)

$combined = $partA + $partB + "`n" + $proxyBody

# ---------------------------------------------------------------------------
# Step 5 - Write temp file and compile
# ---------------------------------------------------------------------------
$TempFile = Join-Path $ScriptDir '_build_standalone.ps1'
Set-Content $TempFile $combined -Encoding UTF8
Write-Host ""
Write-Host ("Generated script: {0} ({1:N0} bytes)" -f $TempFile, (Get-Item $TempFile).Length)

$OutExe = Join-Path $ScriptDir 'CameraControl.exe'
Write-Host "Compiling $OutExe ..."

try {
    Invoke-ps2exe `
        -inputFile   $TempFile `
        -outputFile  $OutExe `
        -noConsole `
        -iconFile    "$ScriptDir\camera.ico" `
        -title       "Camera Control" `
        -description "PTZ Camera Control Interface" `
        -product     "CameraControl" `
        -company     "" `
        -copyright   "bigmars86 - GPL-3.0" `
        -version     "$Version.0"

    Write-Host ""
    Write-Host "=========================================================="
    Write-Host "  Build complete: CameraControl.exe $Version"
    Write-Host "=========================================================="
    Write-Host ""
}
finally {
    Remove-Item $TempFile -ErrorAction SilentlyContinue
}
