# 邮汇原生 Android 客户端（Kotlin + Jetpack Compose）

本目录是按《邮汇原生 Android 客户端改造设计文档》（Part B）搭建的原生 UI 客户端脚手架。
现有 `android/` 目录的 Java WebView 外壳**保持不变**，作为回退版本并存。

## 当前进度（对应设计文档 B8 分阶段清单）

**已完成：阶段 1~4 全部 + 阶段 5（OAuth 回环 UI / 设备会话管理 / 推送诊断）**
**剩余仅发布项**（release 签名需自备 keystore）

- [x] Kotlin 2.0 + Compose BOM + Material3 + 单模块分包工程
- [x] `TokenStore`（EncryptedSharedPreferences/Keystore）+ `AuthInterceptor`（Bearer 注入）+ `TokenAuthenticator`（401 清会话回登录页并停推送）
- [x] `ServerSetupScreen`（移植 `normalizeServerUrl` 的 HTTPS 校验规则）
- [x] `LoginScreen` 密码登录 → `POST /api/mobile/login` → 令牌入库
- [x] `InboxScreen`：`/api/mail` 分页 + 下拉刷新 + 多账户/文件夹筛选 + 搜索
- [x] `MessageDetailScreen`（`attachments=meta` 详情）+ `MailBodyWebView`（严格配置：禁 JS/禁 file/禁混合内容/外链外跳/远程图默认阻止）
- [x] 邮件操作（已读/未读/星标/取消星标）
- [x] 附件流式下载（`@Streaming` 落盘 cacheDir + FileProvider 分享）
- [x] **写信与回复**（`ComposeScreen`）：发件账户选择、收件人/抄送/主题/正文、
      附件多选上传（服务端约束前端预检：≤10 个、单件 ≤15MB、总量 ≤18MB）、
      In-Reply-To/References 头（回复线程保持）
- [x] **新邮件推送**（移植自 WebView 版 Java 实现，认证改 Bearer）：
      `PushMessagingService`（FCM `type=mail.new` 唤醒）、`PushSyncWorker`
      （Bearer 拉取 `/api/notifications/events`，≤5 页、401 静默、5xx 重试）、
      锁屏通知公开版不含邮件内容；FCM token 入加密存储
- [x] **周期拉取回退（与 Java 版差异）**：额外注册 15 分钟 `PeriodicWorkRequest`，
      服务端 FCM 服务账号未配置（登记返回 503）时，仍能靠网页端"新邮件检查"（IMAP IDLE）+
      事件拉取链路收到本地通知
- [x] **正文 cid 内嵌图回填**（App 2.0.2）：服务端对超出内联预算（>2MB/张或 >6MB 总量）的
      `cid:` 引用保留 `data-cid-src` 标记，App 打开详情时按 contentId 匹配附件元数据、经
      `disposition=inline` 端点取回图片并替换为 `data:` URL；客户端自限 ≤8MB/张、≤20MB/封、≤20 张
- [x] **附件区去重**（App 2.1.0）：已成功回填到正文显示的内嵌图不再出现在附件列表，
      附件区只保留真正的可下载附件
- [x] **Room 离线缓存**（App 2.1.0）：收件箱列表与详情均"网络优先、失败回落缓存"；
      列表缓存按文件夹整页替换（含已读/星标记同步、归档删除联动移除），
      详情缓存 7 天自动淘汰；离线时列表顶部提示"离线缓存"；登出/会话失效清空全库
- [x] **第三方身份 OAuth 回环登录**（App 2.2.0，设计文档 A3）：PKCE S256 +
      本地回环监听（`127.0.0.1` 随机端口，network_security_config 已放行）+
      Custom Tabs 打开 `/api/mobile/identity/:provider/start` 授权页；
      回调校验 deviceState → `/api/mobile/oauth/exchange` 换会话；
      登录页仅显示服务端已绑定的登录方式（Google/GitHub/Cloudflare）
- [x] **设备会话管理页**（App 2.2.0，收件箱顶栏"设备"入口）：列出全部移动端会话
      （本机标记/最近活跃/到期时间），吊销任意设备（含确认弹窗；吊销本机自动回登录页），
      附推送状态诊断（FCM 令牌获取情况）
- [x] **文件夹导航修复**（App 2.2.1）：`/api/folders` 实际返回对象数组（path/name/specialUse），
      旧 DTO 误定义为字符串列表导致反序列化静默失败、只显示收件箱；现已修正并按 path 去重、
      中文本地化（收件箱/已发送/草稿箱/已删除/垃圾邮件/归档/加星），文件夹改为横向标签栏
      （FilterChip 一眼可见、点击切换）；收件箱顶栏"服务器"入口已隐藏（换服务器仍可在登录页操作）
- [x] **雷鸟风格显示**（App 2.2.2）：详情页卡片式头部（主题大字、发件人字母头像圆、
      名字突出+地址灰小字、收件人/抄送默认折叠可展开、友好时间"今天/昨天/周几"）、
      附件改芯片化横排（图标+文件名+大小+下载合一）、正文两侧留白；
      收件箱列表行同步：日期右置与发件人同行、未读主题色圆点、主题行缩小层级
- [x] **正文图片自适应**（App 2.2.3）：WebView 注入纯 CSS（`img{max-width:100%!important;height:auto!important}`，
      含 table/video 同步约束），固定宽度大图自动缩放到屏宽并保持比例；开启 overview 模式
      （无 viewport meta 的邮件按屏宽排版）。纯 CSS 不引入 JS，安全模型不变
- [x] **正文捏合缩放**（App 2.2.4）：开启 WebView 原生双指捏合手势（隐藏 +/- 控件），
      自动适配后仍可放大看细节；纯 WebView 能力不引入 JS

**未包含（阶段 5 发布项）：**

- [ ] release 签名（需自备 keystore 配置 signingConfig；当前为 debug 签名）
- [ ] 应用图标按品牌细化（当前为简洁 adaptive 图标）

**推送生效条件**：App 已含 Firebase 配置（`youmail-fde02`）；FCM 唤醒还需在服务端按主 README
安全配置 `FCM_SERVICE_ACCOUNT_JSON`。未配置时登记 `POST /api/push/devices` 返回 503，App 侧
静默降级为 15 分钟周期拉取（前提：工作台开启"新邮件检查"，事件才会生成）。

## 构建

**本机（Windows）已验证可编译通过**（2026-11-19），实际环境与配置：

- Gradle 9.0.0（位于 `~/.gradle/wrapper/dists/gradle-9.0.0-bin`，AGP 已升至 **8.13.2** 以兼容 Gradle 9）
- compileSdk **36**（本机 SDK 已有 `platforms;android-36.1`；targetSdk 保持 35）
- JDK：Android Studio 自带 JBR 21（`C:\Program Files\Android\Android Studio\jbr`）
- SDK 路径在 `local.properties` 写作 `sdk.dir=C:/Users/i/AppData/Local/Android/Sdk`（**必须用正斜杠**，Java Properties 会把 `\U` 等当作转义序列导致 `Invalid file path`）
- 项目路径含中文，已在 `gradle.properties` 加 `android.overridePathCheck=true`；实际编译还需在纯 ASCII 路径的副本下进行（中文路径会导致 Gradle worker `IOException: Invalid file path`）。命令行编译流程：

```powershell
# 1. 同步源码到 ASCII 副本（首次：复制整个 android-native；之后仅同步改动文件）
robocopy android-native C:\Users\i\youhui-native-build /E /XD .temp build .gradle .idea
# 2. 编译
cd C:\Users\i\youhui-native-build
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
& C:\Users\i\.gradle\wrapper\dists\gradle-9.0.0-bin\*\gradle-9.0.0\bin\gradle.bat :app:assembleDebug --no-daemon
# 3. 产物在 app\build\outputs\apk\debug\app-debug.apk
```

在 Android Studio 中直接打开本目录构建也可（AS 内部构建进程对中文路径更宽容，如遇问题可同样导入 `C:\Users\i\youhui-native-build` 副本）。

依赖版本以 `app/build.gradle` 为准：compileSdk 36 / minSdk 27 / Compose BOM 2024.12.01 / material-icons-extended（星标图标在核心库不存在）。

**Firebase 已配置**：`app/google-services.json`（项目 `youmail-fde02`，包名 `com.youhui.mail`）已就位，构建时自动应用 Google Services 插件，`firebase-messaging` 依赖已启用。FCM 客户端代码属阶段 4（`PushMessagingService`/`PushSyncWorker` 移植），服务端仍需按主 README 安全配置 FCM 服务账号后推送才会工作。`google-services.json` 属项目私有文件，已列入 `.gitignore`，不要提交到 Git。

## 安全要点（与设计文档 C 节一致）

- Bearer 令牌等价会话 Cookie：存 EncryptedSharedPreferences，禁日志，仅经 HTTPS；两类 prefs 文件已排除 Auto Backup。
- 正文 WebView：禁 JS、禁 file 访问、禁混合内容；远程图默认阻止（`data-external-src` 回填机制），未知 URL scheme 一律拦截。
- 回环白名单：`network_security_config.xml` 仅放行 `127.0.0.1` / `localhost` 明文（RFC 8252），其余仍强制 HTTPS。
- 服务端地址仅接受 HTTPS 根地址（`UrlGuards.normalizeServerUrl`，与旧版 WebView 客户端规则一致）。

## 与服务端（Part A）的对应关系

| 客户端组件 | 服务端端点 |
| --- | --- |
| `AuthRepository.loginWithPassword` | `POST /api/mobile/login` |
| 设备会话管理（待实现 UI） | `GET /api/mobile/sessions`、`DELETE /api/mobile/sessions/:deviceId` |
| `MailRepository.message`（meta 模式） | `GET /api/message/:accountId/:uid?attachments=meta` |
| `MailRepository.downloadAttachment` | `GET /api/message/:accountId/:uid/attachment/:index` |
| OAuth 回环（待实现 UI） | `GET /api/mobile/identity/:provider/start`、`POST /api/mobile/oauth/exchange` |
| `YouhuiApi.events` | `GET /api/notifications/events` |

> AI生成
