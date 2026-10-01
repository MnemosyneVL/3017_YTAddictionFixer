@echo off
REM ============================================================================
REM  Addiction Recovery for YouTube - stop
REM  Closes ONLY the dedicated browser (matched by its profile
REM  folder), never your normal Chrome.
REM ============================================================================
setlocal
echo Stopping the dedicated browser...
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*yt-budget-profile*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host ('Closed ' + $p.Count + ' process(es).') } else { Write-Host 'It was not running.' }"
exit /b 0
