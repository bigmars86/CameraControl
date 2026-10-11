# Runs PSScriptAnalyzer on the given files; used by pre-commit (locally and in CI).
param([Parameter(ValueFromRemainingArguments)][string[]]$Path)

if (-not (Get-Module -ListAvailable PSScriptAnalyzer)) {
    Write-Output 'PSScriptAnalyzer is missing. Install it once with: Install-Module PSScriptAnalyzer -Scope CurrentUser'
    exit 1
}

$settings = Join-Path $PSScriptRoot '..\PSScriptAnalyzerSettings.psd1'
$findings = @($Path | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Settings $settings })
if ($findings.Count) {
    $findings | Format-Table -AutoSize ScriptName, Line, Severity, RuleName, Message | Out-String -Width 220 | Write-Output
    exit 1
}
