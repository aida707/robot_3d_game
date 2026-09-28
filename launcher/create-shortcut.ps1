# 바탕화면에 MECH TACTICS 바로가기를 (다시) 만든다. 프로젝트 폴더를 옮겼을 때 다시 실행하면 된다.
# 사용법: 이 파일을 우클릭 → "PowerShell에서 실행"
#   또는 powershell -ExecutionPolicy Bypass -File launcher\create-shortcut.ps1
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'MECH TACTICS.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$root\launcher\start-game.vbs`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$root\launcher\mech-tactics.ico,0"
$shortcut.Description = 'MECH TACTICS 실행'
$shortcut.Save()

Write-Host "바로가기를 만들었습니다: $lnk"
