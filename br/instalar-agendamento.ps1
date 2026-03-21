# Execute este script como Administrador (botao direito -> Executar como administrador)

$pasta = "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"

# Tarefa 1: Rodar o bot as 8h
$acao1 = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$pasta\zap.bat`""
$gatilho1 = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -TaskName "ClaudioZap - Envio 8h" -Action $acao1 -Trigger $gatilho1 -RunLevel Highest -Force
Write-Host "Tarefa 1 criada: ClaudioZap roda todo dia as 8h" -ForegroundColor Green

# Tarefa 2: Lembrete popup as 8h30 se nao estiver rodando
$acao2 = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$pasta\zap-lembrete.ps1`""
$gatilho2 = New-ScheduledTaskTrigger -Daily -At 8:30AM
Register-ScheduledTask -TaskName "ClaudioZap - Lembrete 8h30" -Action $acao2 -Trigger $gatilho2 -RunLevel Highest -Force
Write-Host "Tarefa 2 criada: Lembrete popup as 8h30 se nao tiver rodado" -ForegroundColor Green

Write-Host "`nPronto! Agendamentos configurados com sucesso." -ForegroundColor Cyan
pause
