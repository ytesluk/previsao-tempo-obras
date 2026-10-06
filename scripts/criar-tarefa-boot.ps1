# Cria a tarefa que sobe o robo NO BOOT, sem depender de ninguem fazer logon.
#
# PRECISA SER EXECUTADO COMO ADMINISTRADOR (a conta comum nao pode criar tarefas "na inicializacao").
#
#   powershell -ExecutionPolicy Bypass -File scripts\criar-tarefa-boot.ps1
#
# Usa o modo S4U ("executar estando o usuario conectado ou nao", SEM armazenar senha):
# ninguem precisa digitar ou guardar a senha do usuario em lugar nenhum.
#
# Parametros:
#   -Usuario   conta sob a qual o robo roda (padrao: quem esta executando este script).
#              Precisa ser a MESMA conta que fez o login do WhatsApp por QR Code,
#              porque o PM2 guarda a lista de processos por usuario.
#   -Projeto   pasta do projeto (padrao: a pasta acima deste script).

[CmdletBinding()]
param(
  [string]$Usuario = "$env:USERDOMAIN\$env:USERNAME",
  [string]$Projeto = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identidade)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Este script precisa ser executado como Administrador (clique com o botao direito no PowerShell > Executar como administrador)."
}

$bat = Join-Path $Projeto 'scripts\iniciar-windows.bat'
if (-not (Test-Path $bat)) { Write-Error "Nao encontrei $bat. Passe a pasta certa em -Projeto." }

Write-Host "Projeto : $Projeto"
Write-Host "Usuario : $Usuario"

$acao = New-ScheduledTaskAction -Execute $bat
$gatilho = New-ScheduledTaskTrigger -AtStartup
$gatilho.Delay = 'PT2M'   # espera a rede subir antes de conectar ao WhatsApp
$conta = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType S4U -RunLevel Limited
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName 'PrevisaoTempoObrasBoot' -Action $acao -Trigger $gatilho `
  -Principal $conta -Settings $opcoes -Force `
  -Description 'Sobe o robo previsao-tempo-obras (PM2) no boot, sem depender de logon.' | Out-Null

Write-Host ''
Write-Host 'Tarefa "PrevisaoTempoObrasBoot" criada.' -ForegroundColor Green
Write-Host 'A tarefa "PrevisaoTempoObras" (ao fazer logon) continua existindo como rede de seguranca;'
Write-Host 'o script de inicio nao faz nada se o robo ja estiver no ar.'
Write-Host ''
Write-Host 'Para testar sem reiniciar:'
Write-Host '  pm2 delete previsao-tempo-obras'
Write-Host '  Start-ScheduledTask -TaskName PrevisaoTempoObrasBoot'
Write-Host '  Start-Sleep 25; pm2 list'
Write-Host ''
Write-Host 'Se a tarefa falhar com 0x41303 ou nao rodar no boot, a conta pode precisar do direito'
Write-Host '"Log on as a batch job" (secpol.msc > Politicas locais > Atribuicao de direitos de usuario).'
