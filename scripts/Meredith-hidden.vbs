' Start Meredith with no console window.
' Put a shortcut to this file in your Startup folder (Win+R -> shell:startup)
' and the app is simply always there at http://localhost:5173
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & shell.CurrentDirectory & "\Meredith.cmd""", 0, False
