Option Explicit

Const HIDDEN_WINDOW = 0

Dim shell
Dim fso
Dim rootDir
Dim batchPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
batchPath = fso.BuildPath(rootDir, "start_gabada.bat")

If Not fso.FileExists(batchPath) Then
    MsgBox "Launcher not found:" & vbCrLf & batchPath, vbCritical + vbOKOnly, "GABADA"
    WScript.Quit 1
End If

shell.CurrentDirectory = rootDir
shell.Run "cmd.exe /c " & Quote(batchPath), HIDDEN_WINDOW, False
WScript.Quit 0

Function Quote(text)
    Quote = Chr(34) & text & Chr(34)
End Function
