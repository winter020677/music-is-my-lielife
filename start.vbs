' ============================================================
'  TikTok LIVE Tool - start (no black console window)
'  Double-click this file, or use the desktop shortcut made by setup.bat.
'  If the tool is already running, only the admin window opens.
'  Startup messages are written to %TEMP%\tiktok-live-tool-start.log
' ============================================================
Option Explicit

Dim shell, fso, root, logFile, title
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

' Japanese text is written as character codes (this file must stay ASCII).
title = J("54 69 6B 54 6F 6B 20 4C 49 56 45 20 30C4 30FC 30EB")

If Not fso.FileExists(root & "\dist\admin\index.html") Then
  ' "Please run setup.bat first."
  MsgBox J("5148 306B 20 73 65 74 75 70 2E 62 61 74 20 3092 5B9F 884C 3057 3066 304F 3060 3055 3044 3002"), vbExclamation, title
  WScript.Quit 1
End If

If shell.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  ' "Node.js was not found. Install the LTS version from https://nodejs.org/ and run setup.bat."
  MsgBox J("4E 6F 64 65 2E 6A 73 20 304C 898B 3064 304B 308A 307E 305B 3093 3002 68 74 74 70 73 3A 2F 2F 6E 6F 64 65 6A 73 2E 6F 72 67 2F 20 304B 3089 300C 4C 54 53 300D 306E 7248 3092 30A4 30F3 30B9 30C8 30FC 30EB 3057 3066 3001 73 65 74 75 70 2E 62 61 74 20 3092 5B9F 884C 3057 3066 304F 3060 3055 3044 3002"), vbExclamation, title
  WScript.Quit 1
End If

logFile = shell.ExpandEnvironmentStrings("%TEMP%") & "\tiktok-live-tool-start.log"
shell.Run "cmd /c node --disable-warning=ExperimentalWarning src\server\main.ts --open > """ & logFile & """ 2>&1", 0, False

' Turns "30C4 30FC" (hex character codes) into text.
Function J(codes)
  Dim parts, i, text
  parts = Split(codes, " ")
  text = ""
  For i = 0 To UBound(parts)
    text = text & ChrW(CLng("&H" & parts(i)))
  Next
  J = text
End Function
