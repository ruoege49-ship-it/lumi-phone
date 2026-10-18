param(
    [string]$AndroidSdk = 'C:/Android/Sdk',
    [string]$GradlePath = '',
    [string]$BuildRoot = 'C:/lumi-phone-android-build',
    [switch]$DebugOnly,
    [switch]$Offline
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$package=Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if($env:ANDROID_HOME){$AndroidSdk=$env:ANDROID_HOME}
if(-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms/android-36/android.jar'))){throw 'Android SDK 36 is required. Set ANDROID_HOME.'}
if(-not $GradlePath){
    $installedGradle=Get-Command gradle -ErrorAction SilentlyContinue
    if($installedGradle){$GradlePath=$installedGradle.Source}
    else{$cachedGradle=Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle/wrapper/dists/gradle-8.14.3-bin') -Filter gradle.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1; if($cachedGradle){$GradlePath=$cachedGradle.FullName}}
}
if(-not $GradlePath){throw 'Gradle 8.14.3 is required; supply -GradlePath.'}
$resolvedBuild=[IO.Path]::GetFullPath($BuildRoot)
if($resolvedBuild -match '[^\x00-\x7F]' -or $resolvedBuild.TrimEnd('/','\') -eq [IO.Path]::GetPathRoot($resolvedBuild).TrimEnd('/','\')){throw 'Use a dedicated ASCII build directory, not a drive root.'}
$androidBuild=Join-Path $resolvedBuild 'android'
$sourceBuild=Join-Path $androidBuild 'app/src'
New-Item -ItemType Directory -Force -Path $sourceBuild | Out-Null
foreach($item in @('settings.gradle','build.gradle','gradle.properties')){Copy-Item -LiteralPath (Join-Path $projectRoot "android/$item") -Destination $androidBuild -Force}
Copy-Item -LiteralPath (Join-Path $projectRoot 'android/app/build.gradle') -Destination (Join-Path $androidBuild 'app/build.gradle') -Force
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'android/app/src') | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $sourceBuild -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $resolvedBuild -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $resolvedBuild -Force
[IO.File]::WriteAllText((Join-Path $androidBuild 'local.properties'),'sdk.dir='+$AndroidSdk.Replace('\','/'),[Text.UTF8Encoding]::new($false))
$arguments=@('-p',$androidBuild,'assembleDebug','assembleDebugAndroidTest','--console=plain','--no-daemon','--max-workers=2')
if(-not $DebugOnly){$arguments+='assembleRelease'}
if($Offline){$arguments+='--offline'}
& $GradlePath @arguments
if($LASTEXITCODE -ne 0){throw 'Android build failed.'}
if($DebugOnly){Write-Output (Join-Path $androidBuild 'app/build/outputs/apk/debug/app-debug.apk');exit 0}
$signingRoot=Join-Path $env:LOCALAPPDATA 'LumiPhoneSigning'
New-Item -ItemType Directory -Force -Path $signingRoot | Out-Null
$keystore=Join-Path $signingRoot 'release.jks'
$protectedPassword=Join-Path $signingRoot 'password.dpapi'
if(Test-Path -LiteralPath $protectedPassword){$password=ConvertTo-SecureString ((Get-Content -LiteralPath $protectedPassword -Raw).Trim())}
elseif(Test-Path -LiteralPath $keystore){throw 'Signing password is missing. Restore LumiPhoneSigning; do not replace the key.'}
else{
    $randomBytes=New-Object byte[] 32
    $generator=[Security.Cryptography.RandomNumberGenerator]::Create();$generator.GetBytes($randomBytes);$generator.Dispose()
    $password=ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    $password | ConvertFrom-SecureString | Set-Content -LiteralPath $protectedPassword -Encoding ASCII
}
$env:LUMI_SIGN_PASSWORD=[Net.NetworkCredential]::new('', $password).Password
try{
    if(-not (Test-Path -LiteralPath $keystore)){
        & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keystore -alias lumi -keyalg RSA -keysize 3072 -validity 10000 -storepass:env LUMI_SIGN_PASSWORD -keypass:env LUMI_SIGN_PASSWORD -dname 'CN=Lumi Phone, O=ruoege49-ship-it, C=CN'
        if($LASTEXITCODE -ne 0){throw 'Signing key generation failed.'}
    }
    $buildTools=Join-Path $AndroidSdk 'build-tools/36.0.0'
    $unsigned=Join-Path $androidBuild 'app/build/outputs/apk/release/app-release-unsigned.apk'
    $aligned=Join-Path $resolvedBuild 'lumi-aligned.apk'
    & (Join-Path $buildTools 'zipalign.exe') -f -p 4 $unsigned $aligned
    if($LASTEXITCODE -ne 0){throw 'APK alignment failed.'}
    $delivery=Join-Path $projectRoot 'delivery'
    New-Item -ItemType Directory -Force -Path $delivery | Out-Null
    $apk=Join-Path $delivery ('lumi-phone-'+$package.version+'.apk')
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias lumi --ks-pass env:LUMI_SIGN_PASSWORD --key-pass env:LUMI_SIGN_PASSWORD --out $apk $aligned
    if($LASTEXITCODE -ne 0){throw 'APK signing failed.'}
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk
    if($LASTEXITCODE -ne 0){throw 'APK signature verification failed.'}
    $hash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($apk))" | Set-Content -LiteralPath (Join-Path $delivery 'SHA256SUMS.txt') -Encoding ASCII
    [pscustomobject]@{APK=$apk;Bytes=(Get-Item -LiteralPath $apk).Length;SHA256=$hash;Package='com.ruoege.lumiphone';Version=$package.version} | ConvertTo-Json
}finally{Remove-Item Env:LUMI_SIGN_PASSWORD -ErrorAction SilentlyContinue}
