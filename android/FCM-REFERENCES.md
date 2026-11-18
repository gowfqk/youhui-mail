# FCM 官方实施参考

- Firebase Android 项目配置与 SDK 接入：<https://firebase.google.com/docs/android/setup>
  - Android 应用需使用与 `applicationId` 完全一致的包名注册，并把 `google-services.json` 放在 `app/` 模块根目录。
  - 配置文件包含项目/应用标识；官方建议使用 Google Services Gradle 插件和 Firebase Android BoM。当前页面示例使用 Google Services 插件 `4.6.0` 与 BoM `35.2.0`。
- FCM HTTP v1 服务端发送：<https://firebase.google.com/docs/cloud-messaging/send/v1-api>
  - 服务端使用服务账号 OAuth 2.0 短期 access token，授权 scope 为 `https://www.googleapis.com/auth/firebase.messaging`，发送至 `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`。
- Android 收消息：<https://firebase.google.com/docs/cloud-messaging/android/receive>
  - Android 应用通过 `FirebaseMessagingService` 接收 data message；耗时网络取数应交给 WorkManager 等受管理后台任务。
  - 本实现遵循该建议：FCM 只携带 `type=mail.new`，由 WorkManager 使用邮汇登录 Cookie 向邮汇服务器读取事件详情。
