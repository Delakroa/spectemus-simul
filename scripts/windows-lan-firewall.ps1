$ErrorActionPreference = "Stop"
$tcpRuleName = "Watch Together LAN TCP"
$udpRuleName = "Watch Together LAN UDP"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`""
    )
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

$interfaceIndexes = @(
    Get-NetIPConfiguration |
        Where-Object { $null -ne $_.IPv4DefaultGateway -and $null -ne $_.IPv4Address } |
        ForEach-Object { $_.InterfaceIndex }
)
$profiles = @(
    $interfaceIndexes |
        ForEach-Object { Get-NetConnectionProfile -InterfaceIndex $_ }
)
if ($profiles.Count -eq 0) {
    throw "Не найдено IPv4-подключение с default gateway. Подключите Windows к домашней сети и повторите команду."
}

$nonPrivateProfiles = @($profiles | Where-Object { $_.NetworkCategory -ne "Private" })
if ($nonPrivateProfiles.Count -gt 0) {
    $descriptions = ($nonPrivateProfiles | ForEach-Object { "$($_.Name) ($($_.NetworkCategory))" }) -join ", "
    throw "Сеть '$descriptions' не имеет профиль Private. Не открывайте LAN-порты в недоверенной сети. В Windows Settings → Network & Internet задайте для этой домашней сети Private, затем повторите команду."
}

Get-NetFirewallRule -DisplayName $tcpRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName $udpRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
    -DisplayName $tcpRuleName `
    -Direction Inbound `
    -Action Allow `
    -Profile Private `
    -Protocol TCP `
    -LocalPort 8088,7880,7881 | Out-Null

New-NetFirewallRule `
    -DisplayName $udpRuleName `
    -Direction Inbound `
    -Action Allow `
    -Profile Private `
    -Protocol UDP `
    -LocalPort 50000-50100 | Out-Null

Write-Host "[ok] Разрешены только Watch Together LAN-порты для профиля Private."
