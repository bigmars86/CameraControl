@{
    Severity     = @('Error', 'Warning')
    ExcludeRules = @(
        # Console output in source mode; the EXE redirects Write-Host to the log file
        'PSAvoidUsingWriteHost'
        # Internal script functions, not cmdlets: -WhatIf/-Confirm would not mean anything
        'PSUseShouldProcessForStateChangingFunctions'
        # Request handlers are named after what they handle (Handle-Ptz, Handle-Preset, ...)
        'PSUseApprovedVerbs'
    )
}
