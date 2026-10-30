# Builds GlassHome.apk without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Usage: .\build.ps1 [-Install]   (-Install also installs it on the Fire TV over adb)
param([switch]$Install, [string]$Device = '192.168.0.225:5555')
$ErrorActionPreference = 'Stop'

# The tools (JDK 17, Android SDK, adb) live under Local AppData; when they were
# set up from the Claude app, Windows keeps them in its package folder instead.
$local = $env:LOCALAPPDATA
if (-not (Test-Path "$local\fire-dev")) {
  $pkg = Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path "$($_.FullName)\LocalCache\Local\fire-dev" } | Select-Object -First 1
  if ($pkg) { $local = "$($pkg.FullName)\LocalCache\Local" }
}
$tools = "$local\fire-dev"
$jdk   = (Get-ChildItem "$tools\jdk-x" -Directory)[0].FullName
$bt    = "$tools\sdk\build-tools\34.0.0"
$jar   = "$tools\sdk\platforms\android-34\android.jar"
$adb   = "$local\adb-tv\adb.exe"
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"

$root = $PSScriptRoot
$out  = Join-Path $root 'build'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\res", "$out\classes", "$out\dex" | Out-Null

# Arguments go in as one array: PowerShell would split bare args like pass:x.
function Run([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$(Split-Path $exe -Leaf) failed ($LASTEXITCODE)" }
}

Run "$bt\aapt2.exe" @('compile', '--dir', "$root\res", '-o', "$out\res.zip")
# Assets are added below, not with aapt2 -A, which writes them with Windows
# backslashes that Android can't find.
Run "$bt\aapt2.exe" @('link', '-I', $jar, '--manifest', "$root\AndroidManifest.xml",
  '-o', "$out\unsigned.apk", "$out\res.zip", '--auto-add-overlay')

$java = @(Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object FullName)
Run "$jdk\bin\javac.exe" (@('-source', '8', '-target', '8', '-Xlint:-options', '-encoding', 'UTF-8',
  '-classpath', $jar, '-d', "$out\classes") + $java)
$classes = @(Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" (@('--release', '--min-api', '22', '--lib', $jar, '--output', "$out\dex") + $classes)

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open("$out\unsigned.apk", 'Update')
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\dex\classes.dex", 'classes.dex')
$assets = Join-Path $root 'assets'
Get-ChildItem $assets -Recurse -File | ForEach-Object {
  $name = 'assets/' + $_.FullName.Substring($assets.Length + 1).Replace('\', '/')
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name)
}
$zip.Dispose()

Run "$bt\zipalign.exe" @('-f', '-p', '4', "$out\unsigned.apk", "$out\aligned.apk")

# A local signing key for this app only, made on first build.
$ks = Join-Path $tools 'glasshome.keystore'
if (-not (Test-Path $ks)) {
  Run "$jdk\bin\keytool.exe" @('-genkeypair', '-keystore', $ks, '-storepass', 'glasshome', '-keypass', 'glasshome',
    '-alias', 'glasshome', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Glass Home Fire TV')
}
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', 'pass:glasshome', '--ks-key-alias', 'glasshome',
  '--out', "$root\GlassHome.apk", "$out\aligned.apk")
Write-Output "Built $root\GlassHome.apk"

if ($Install) {
  & $adb connect $Device | Out-Null
  Run $adb @('-s', $Device, 'install', '-r', "$root\GlassHome.apk")
  Run $adb @('-s', $Device, 'shell', 'am', 'start', '-n', 'com.glasshome.firetv/.MainActivity')
}
