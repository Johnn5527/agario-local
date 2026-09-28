# Execute este script no PowerShell COMO ADMINISTRADOR
# Clique direito no PowerShell → Executar como administrador
# Depois:  Set-Location "...\Agar.io"; .\scripts\abrir-firewall-lan.ps1

$ErrorActionPreference = 'Stop'

Write-Host "Liberando portas 3000 (jogo) e 3001 (painel de bots) no Firewall do Windows..."

netsh advfirewall firewall delete rule name="Agar.io Clone LAN 3000" | Out-Null
netsh advfirewall firewall delete rule name="Agar.io Bots Panel 3001" | Out-Null

netsh advfirewall firewall add rule name="Agar.io Clone LAN 3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="Agar.io Bots Panel 3001" dir=in action=allow protocol=TCP localport=3001

Write-Host ""
Write-Host "OK. Na mesma Wi-Fi, abra: http://SEU_IP:3000"
Write-Host "Descobrir IP: ipconfig   (procure IPv4)"
