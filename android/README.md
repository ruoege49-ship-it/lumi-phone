# Android · 0.2.1

目标是让现有小手机安装到安卓后独立运行，保留已批准的界面和本地数据规则。用户从设置填写 API；应用直接请求指定服务，结果继续由原有引擎保存到 IndexedDB。附件通过系统文件选择器导入，完整备份通过系统保存窗口写入，恢复前仍显示预览并保留恢复点。

包名 `com.ruoege.lumiphone`，版本 `0.2.1`，versionCode `1`。最低 Android 8.0，目标 Android 15；需要支持现代 JavaScript 的 Android System WebView。此包与旧小手机是不同应用。用户数据和 API 密钥均不打入安装包。

## 平台接入

- `MainActivity.java` 从安装包提供固定的 `https://lumi-phone.local/` 内容，页面、字体、图片和试听音乐离线可加载。
- `NativeBridge.java` 负责网络请求、超时取消和系统文档保存；远程地址要求 HTTPS，本机回环地址可用 HTTP。网络失败回传给原有任务状态，不生成假回复。
- `dist/request.mjs` 由电脑版和安卓版共用；保存的模型、参数、密钥及语音配置会进入实际请求。音频传输保留二进制内容，识别使用 multipart。
- 返回键依次关闭原图、面板、会话、第二页桌面；桌面首页再返回到系统。应用进入后台时停止录音并暂停播放。
- 麦克风只在录音时请求。文件通过系统选择器授权，无需读取整个存储空间。发布包关闭 WebView 调试和系统自动备份。
- IndexedDB 使用现有 `lumi.functional.phone.v2`；浏览器与安卓的存档各自独立，可用完整 JSON 备份迁移，密钥需重新填写。

## 在 Windows 构建

需要 JDK 21、Android SDK 36 / Build-tools 36.0.0、Gradle 8.14.3。Android Gradle Plugin 为 8.11.0。设置 `JAVA_HOME`、`ANDROID_HOME` 后，在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -GradlePath '你的 Gradle 8.14.3/bin/gradle.bat'
```

默认在独立英文目录 `C:/lumi-phone-android-build` 构建，避免中文路径影响 Android 工具。可用 `-BuildRoot` 指定其他英文目录。已有依赖缓存时可传 `-Offline`；只生成调试包时可传 `-DebugOnly`。

发布包和 SHA-256 文件输出到 `delivery/`。脚本自动执行 zipalign、签名和签名验证。签名材料保存在 `%LOCALAPPDATA%/LumiPhoneSigning/`，密码由当前 Windows 用户的 DPAPI 保护，不进入仓库。后续版本必须保留同一签名；升级时同时更新 `package.json` 和 `android/app/build.gradle` 的版本，并递增 versionCode。

## 验证入口

`npm test` 覆盖数据、网关和安卓传输适配，共 31 项。设备检查使用专门的模拟器和本地服务，不包含外部模型密钥：

```powershell
$env:PORT='43154'
node test-provider.mjs
```

另一终端将 `emulator-5582` 替换为测试模拟器序列号，并安装构建目录内的调试包和测试包：

```powershell
adb -s emulator-5582 reverse tcp:43154 tcp:43154
adb -s emulator-5582 install -r C:/lumi-phone-android-build/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5582 install -r C:/lumi-phone-android-build/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5582 shell am instrument -w com.ruoege.lumiphone.test/com.ruoege.lumiphone.SmokeInstrumentation
adb -s emulator-5582 shell am force-stop com.ruoege.lumiphone
adb -s emulator-5582 shell am instrument -w -e phase restore com.ruoege.lumiphone.test/com.ruoege.lumiphone.SmokeInstrumentation
```

测试会在测试应用中创建验收角色和图片，勿对日常使用的存档运行。正常完成的输出为全部 `PASS` 和 `INSTRUMENTATION_CODE: -1`；不能只用 adb 进程退出码判断。

## 0.2.1 验证记录 · 2026-10-18

31 项 Node 检查通过，发布构建和签名验证通过，安装包内 23 个网页资源与源码逐一校验一致。

在独立 Android 15 模拟器上安装最终签名的发布 APK，并使用同签名的独立测试包运行：离线页面启动、角色表单保存、模型列表、聊天、二进制朗读音频、multipart 识别请求、原图保存、备份排除密钥、系统文档导出、实际点击导入并显示预览、恢复附件、刷新保留记录和系统返回键，全部通过。强制结束进程后重开，角色与原图恢复通过。测试包不在发布附件中。

接口验证使用本地固定测试服务；外部模型服务和实体手机麦克风由使用者配置与授权后使用。
