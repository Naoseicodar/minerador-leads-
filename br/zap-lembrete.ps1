# Verifica se o ClaudioZap esta rodando. Se nao, exibe popup de lembrete.
$rodando = Get-WmiObject Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like "*claudio-zap*" }

if (-not $rodando) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "O ClaudioZap ainda nao foi iniciado hoje!`n`nVa em:`nC:\Users\Win10\CLAUDE PROJETOS\minerador-leads`ne execute o zap.bat",
        "Lembrete — ClaudioZap",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
}
