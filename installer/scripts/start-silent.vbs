' Starts the Sacred Heart MIS Node.js server silently (no console window)
' Uses start-loop.bat so the server automatically restarts after an update (exit 0)
Dim oShell, appDir

Set oShell  = CreateObject("WScript.Shell")
appDir  = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
appDir  = Left(appDir, InStrRev(appDir, "\") - 1)   ' go up one level (scripts\ -> app root)

oShell.CurrentDirectory = appDir
oShell.Run "cmd /c """ & appDir & "\scripts\start-loop.bat""", 0, False
