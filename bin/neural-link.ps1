# Neural Link dispatcher — entry point Windows
# Reads stdin, calls Node.js, returns stdout
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$rawInput = @($input) -join "`n"
if (-not $rawInput) { $rawInput = [Console]::In.ReadToEnd() }
if (-not $rawInput) { exit 0 }
$rawInput | node "$projectDir\src\index.js"
