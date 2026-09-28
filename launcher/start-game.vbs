' MECH TACTICS launcher
' - If the dev server (http://localhost:5173) is not running, start "npm run dev" in a minimized window.
' - Wait until the server answers, then open the game in the default browser.
' - Close the minimized "MECH TACTICS server" window to stop the server.
Option Explicit

Dim sh, fso, root, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = "http://localhost:5173/"

If Not ServerUp(url) Then
  sh.CurrentDirectory = root
  ' 7 = minimized window, False = do not wait
  sh.Run "cmd /c title MECH TACTICS server && npm run dev", 7, False
  For i = 1 To 60
    WScript.Sleep 500
    If ServerUp(url) Then Exit For
  Next
  If Not ServerUp(url) Then
    MsgBox "Could not start the game server." & vbCrLf & _
      "Check that Node.js is installed and run 'npm install' once in:" & vbCrLf & root, _
      vbExclamation, "MECH TACTICS"
    WScript.Quit 1
  End If
End If

sh.Run url

Function ServerUp(u)
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", u, False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function
