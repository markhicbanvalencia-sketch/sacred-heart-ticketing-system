' Starts the Sacred Heart MIS Node.js server silently (no console window)
Dim oShell, appDir

oShell  = CreateObject("WScript.Shell")
appDir  = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
appDir  = Left(appDir, InStrRev(appDir, "\") - 1)   ' go up one level (scripts\ -> app root)

oShell.CurrentDirectory = appDir
' Run node in background, redirect output to log file
oShell.Run "cmd /c node src\server.js >> data\server.log 2>&1", 0, False
