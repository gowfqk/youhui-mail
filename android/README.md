# 邮汇 Android 客户端

这是一个轻量的 Android 配套客户端：原生部分负责首次配置并保存自托管邮汇服务器地址，工作台由 Android WebView 加载现有响应式网页。首次启动地址栏保持空白；客户端只接受 HTTPS 根地址。应用不读取或保存邮汇网站密码、邮箱密码或邮箱授权凭据。

## 构建与使用

在 Android Studio 中打开本 `android/` 目录并同步 Gradle 工程，或运行 `./gradlew assembleDebug`。调试 APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`；这是调试签名版本，正式发布需另行配置发布签名。最低支持 Android 8.1（API 27）。首次打开时，输入自己部署的邮汇 HTTPS 根地址后连接，再在工作台登录。

如果没有 Firebase 配置文件，工程仍可正常构建并使用 WebView，但 APK 不会启用 FCM。启用 FCM 前，在 Firebase 项目中注册 Android 应用，包名必须是 `com.youhui.mail`，下载该应用的 `google-services.json` 并放到 `android/app/google-services.json`。此文件按项目私有配置处理，不要提交到 Git；添加后 Gradle 会自动应用 Google Services 插件并纳入 Firebase Messaging。Firebase 官方接入说明见 [Android 设置指南](https://firebase.google.com/docs/android/setup)。

Android 13 及更新版本需要用户授予通知权限。首次登录后的客户端会请求权限；如果拒绝，需在 Android 系统设置中为邮汇重新打开通知。无通知权限时，应用不会登记或展示推送。

## FCM 工作方式

邮汇服务器向 FCM 发送的 data message 只包含通用信号 `type=mail.new`，不包含发件人、主题、验证码、正文或附件。手机收到信号后通过 WorkManager，使用 WebView 中现有的登录 Cookie 向用户自己的邮汇服务器请求待处理事件，再在设备本地生成通知。锁屏公开预览只显示“你有新邮件”，解锁后的通知详情来自邮汇服务器。Google 因 FCM 传输仍能看到设备推送令牌及送达时序。

要让服务端发送 FCM，需在 Firebase 项目启用 Firebase Cloud Messaging API，并为服务端配置有权发送 FCM v1 消息的 Google 服务账号。部署时任选一种安全注入方式：把完整 JSON 放入 `FCM_SERVICE_ACCOUNT_JSON` 环境变量，或把 JSON 作为受保护文件挂载并将 `GOOGLE_APPLICATION_CREDENTIALS` 设置为该文件路径。不要把服务账号 JSON、私钥或环境变量值写入源码、镜像或备份。还需启用邮汇的“定时检查与新邮件提醒”；否则服务器不会扫描并生成新邮件事件。官方服务端发送说明见 [FCM HTTP v1 指南](https://firebase.google.com/docs/cloud-messaging/send/v1-api)，Android 消息接收说明见 [接收消息指南](https://firebase.google.com/docs/cloud-messaging/android/receive)。

本源码和不含 `google-services.json` 的 APK 都不会携带 Firebase 项目标识或服务账号。要制作启用 FCM 的 APK，需要为 `com.youhui.mail` 提供 Firebase 配置文件；服务端服务账号必须另行安全配置在当前邮汇部署中。不会因构建客户端而自动修改或部署服务器。

## 当前能力与限制

原生客户端提供服务器地址配置、返回导航、附件文件选择和同源附件下载；WebView 复用邮汇现有邮件账户、邮件列表与阅读、写信和设置功能。应用拒绝明文 HTTP、无效 TLS 证书、混合内容、文件 URL 访问和第三方 Cookie，不向网页注入原生 JavaScript 桥接。

这是 WebView 配套客户端，不是独立重写的原生邮件界面；邮件数据和邮箱凭据仍由邮汇服务器管理。Google 等身份提供商可能阻止嵌入式 WebView OAuth；如遇到该限制，可在系统浏览器中登录工作台，或在客户端使用邮汇密码登录。反向代理路径前缀部署不受支持，请将邮汇部署在独立站点根路径。
