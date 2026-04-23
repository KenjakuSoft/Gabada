#define MyAppName "Gabada"
#define MyAppPublisher "Gabada"

#ifndef MyAppVersion
  #define MyAppVersion "0.1.3"
#endif

#ifndef SourceDir
  #define SourceDir "..\dist\Gabada"
#endif

#ifndef OutputDir
  #define OutputDir ".\output"
#endif

[Setup]
AppId={{C90E6406-6DD7-4C1A-A70E-4716E9A04D2A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Gabada
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=GabadaSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Gabada.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\Gabada.exe"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Gabada.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Gabada.exe"; Description: "Launch Gabada"; Flags: nowait postinstall skipifsilent
