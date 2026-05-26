; ============================================================
;  Sacred Heart MIS - Inno Setup Installer Script
;  Version : 1.0
;  Publisher: MV Tech I.T and Home Automation Services
; ============================================================

#define AppName      "Sacred Heart MIS"
#define AppVersion   "1.0"
#define AppPublisher "MV Tech I.T and Home Automation Services"
#define AppURL       "https://github.com/markhicbanvalencia-sketch/sacred-heart-ticketing-system"
#define AppID        "{{6F3A2B1C-9D4E-4F5A-8B7C-1A2D3E4F5A6B}"

[Setup]
AppId={#AppID}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=SacredHeartMIS-v1.0-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
UninstallDisplayIcon={app}\scripts\launch.bat
UninstallDisplayName={#AppName} v{#AppVersion}
ChangesEnvironment=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";   Description: "Create a &desktop shortcut";        GroupDescription: "Additional icons:"
Name: "startupentry";  Description: "Start server automatically at &login"; GroupDescription: "Startup:"

[Files]
; --- Application source ---
Source: "..\src\*";          DestDir: "{app}\src";     Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\views\*";        DestDir: "{app}\views";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\public\*";       DestDir: "{app}\public";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\*";      DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\package.json";   DestDir: "{app}"; Flags: ignoreversion

; --- Launcher scripts ---
Source: "scripts\launch.bat";       DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\stop.bat";         DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\start-silent.vbs"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Dirs]
; Grant write access to data and uploads so the app can read/write the database
Name: "{app}\data";    Permissions: everyone-modify
Name: "{app}\uploads"; Permissions: everyone-modify

[Icons]
; Start Menu
Name: "{group}\Open Sacred Heart MIS";               Filename: "{app}\scripts\launch.bat"; WorkingDir: "{app}"; IconFilename: "{app}\scripts\launch.bat"
Name: "{group}\Stop Server";                          Filename: "{app}\scripts\stop.bat";   WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}";    Filename: "{uninstallexe}"

; Desktop shortcut
Name: "{autodesktop}\Sacred Heart MIS"; Filename: "{app}\scripts\launch.bat"; WorkingDir: "{app}"; Tasks: desktopicon

; Startup (run silently on login)
Name: "{userstartup}\Sacred Heart MIS Server"; Filename: "wscript.exe"; Parameters: """{app}\scripts\start-silent.vbs"""; WorkingDir: "{app}"; Tasks: startupentry

[Run]
; 1. Initialise the database (first-time setup)
Filename: "node.exe"; Parameters: "scripts\init-db.js"; WorkingDir: "{app}"; StatusMsg: "Setting up database..."; Flags: waituntilterminated runhidden

; 2. Open port 3000 in Windows Firewall so LAN users can reach the server
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""Sacred Heart MIS"" dir=in action=allow protocol=TCP localport=3000"; WorkingDir: "{app}"; StatusMsg: "Configuring firewall..."; Flags: waituntilterminated runhidden

; 3. Launch app in browser after install (optional, user can untick)
Filename: "wscript.exe"; Parameters: """{app}\scripts\start-silent.vbs"""; WorkingDir: "{app}"; Description: "Launch {#AppName} now"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Kill the server process before uninstalling
Filename: "{app}\scripts\stop.bat"; Flags: runhidden waituntilterminated
; Remove the firewall rule
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Sacred Heart MIS"""; Flags: runhidden waituntilterminated

[Code]
{ ------------------------------------------------------------------ }
{  Check that Node.js 18+ is installed before allowing setup to run  }
{ ------------------------------------------------------------------ }
function GetNodeVersion(var VerStr: String): Boolean;
var
  ResultCode: Integer;
  TempFile:   String;
  Lines:      TArrayOfString;
begin
  Result  := False;
  TempFile := ExpandConstant('{tmp}\nodeversion.txt');
  if Exec('cmd.exe', '/c node --version > "' + TempFile + '" 2>&1',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if LoadStringsFromFile(TempFile, Lines) and (GetArrayLength(Lines) > 0) then
    begin
      VerStr := Trim(Lines[0]);
      Result := (ResultCode = 0) and (Copy(VerStr, 1, 1) = 'v');
    end;
  end;
end;

function NodeMeetsMinVersion(VerStr: String): Boolean;
var
  Major: Integer;
  Parts: TStringList;
begin
  Result := False;
  // VerStr is like "v20.11.0"
  VerStr := Copy(VerStr, 2, Length(VerStr)); // strip leading 'v'
  Parts  := TStringList.Create;
  try
    Parts.Delimiter     := '.';
    Parts.DelimitedText := VerStr;
    if Parts.Count > 0 then
      Major := StrToIntDef(Parts[0], 0);
    Result := Major >= 18;
  finally
    Parts.Free;
  end;
end;

function InitializeSetup(): Boolean;
var
  VerStr: String;
begin
  Result := True;

  if not GetNodeVersion(VerStr) then
  begin
    MsgBox(
      'Node.js is not installed on this computer.' + #13#10 + #13#10 +
      'Sacred Heart MIS requires Node.js 18 or newer.' + #13#10 + #13#10 +
      'Please download and install Node.js from:' + #13#10 +
      '  https://nodejs.org/en/download' + #13#10 + #13#10 +
      'After installing Node.js, run this setup again.',
      mbCriticalError, MB_OK
    );
    Result := False;
    Exit;
  end;

  if not NodeMeetsMinVersion(VerStr) then
  begin
    MsgBox(
      'Your Node.js version (' + VerStr + ') is too old.' + #13#10 +
      'Sacred Heart MIS requires Node.js 18 or newer.' + #13#10 + #13#10 +
      'Please update Node.js from https://nodejs.org and run setup again.',
      mbCriticalError, MB_OK
    );
    Result := False;
  end;
end;
