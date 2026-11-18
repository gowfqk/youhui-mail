# 邮汇 · 多账户邮件工作台

邮汇是一个可自托管的中文 Web 邮件客户端。它不是静态样机：账户连接后，服务端会实时使用 IMAP 读取和管理邮件，并通过对应账户的 SMTP 发送邮件。

## 已实现

- 统一收件箱、多邮箱筛选、搜索、分页，以及已发送、草稿、归档、垃圾邮件、已删除、星标和自定义 IMAP 文件夹。
- 打开邮件正文、下载附件、发送附件（单封最多 10 个、总计 18 MB）、标记已读/未读、加星/取消星、归档、移至已删除、回复，以及从所选邮箱发信。
- 可添加多个 IMAP/SMTP 账户。内置服务器快速配置：Gmail、Outlook/Microsoft 365、Yahoo、iCloud、Fastmail、网易 163、QQ、Zoho；也支持任何提供标准 IMAP/SMTP 访问的自定义域名邮箱。
- Google/Microsoft OAuth 邮箱授权；支持 Google、GitHub、Cloudflare Access / Zero Trust OIDC 第三方登录，身份绑定后 OAuth 成功即可解锁工作台。
- 统一设置内配置 AI、翻译、定时邮件检查、浏览器提醒与可手动测试的 Webhook；可查看各邮箱的 IMAP/IDLE 连接状态、最近成功同步时间和重连错误。邮件内嵌图片正常显示，远程图片默认阻止并可逐封加载。
- 首次设置工作台密码；邮箱凭据以 AES-256-GCM 加密保存在本地数据目录；备份可选择使用口令加密，也可导出未加密文件。登录密码使用 scrypt 哈希，服务端通过 TLS 连接邮件服务器，并配置基础安全响应头。

邮箱服务商必须允许 IMAP/SMTP 或 OAuth 访问。Proton Mail 等不开放标准 IMAP 的服务，需要在应用服务器侧配置该服务商提供的 Bridge/兼容网关后，再填写对应地址；不能仅凭邮箱地址绕过服务商限制。

## 本地启动

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

浏览器访问 `http://localhost:3000`。首次打开会要求创建至少 12 位的工作台密码。随后选择“添加邮箱”，填写账号和服务商要求的应用专用密码；应用会先实际验证 IMAP 收件和 SMTP 发件连接，成功后才保存账户。

## Docker 镜像

GitHub Actions 会在 `main` 分支或 `v*` 版本标签推送时构建并发布 `ghcr.io/gowfqk/youhui-mail`；Pull Request 只验证构建，不发布镜像。运行时数据库和加密密钥保存在独立的 `/data` 卷中，不会打包进镜像。首次启动时，打开 `http://localhost:3000` 并设置至少 12 位的工作台密码。

镜像若为私有，运行前需使用有该包读取权限的 GitHub 账户登录 `ghcr.io`。

```sh
docker volume create youhui-mail-data
docker run -d --name youhui-mail --restart unless-stopped \
  -p 3000:3000 \
  -v youhui-mail-data:/data \
  -e APP_BASE_URL=https://mail.example.com \
  ghcr.io/gowfqk/youhui-mail:latest
```

`APP_BASE_URL` 用于 OAuth 回调，应替换为实际的 HTTPS 根地址；正式部署仍应通过反向代理启用 HTTPS。备份、邮箱数据和 `data/encryption.key` 必须保存在受保护的持久化存储中，不要将它们复制到镜像。

## OAuth 客户端和回调地址

在工作台打开“设置 → OAuth 登录”，填写客户端 ID 与客户端密钥。OAuth 密钥在服务端以 AES-256-GCM 加密保存；API 只返回“是否已配置”状态，不回传密钥。未填写的输入框会保留已有值。首次启动时，如果数据库还没有 OAuth 配置，旧环境变量 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`MICROSOFT_CLIENT_ID`、`MICROSOFT_CLIENT_SECRET` 会迁移到加密配置；已有的数据库配置不会被覆盖。

工作台会在 OAuth 设置页展示实际回调 URI。将相应 URI 原样添加到提供方控制台：

| 用途 | 提供方 | 回调 URI |
| --- | --- | --- |
| 邮箱授权 | Google | `${APP_BASE_URL}/oauth/google/callback` |
| 邮箱授权 | Microsoft | `${APP_BASE_URL}/oauth/microsoft/callback` |
| 工作台登录 | Google | `${APP_BASE_URL}/identity/google/callback` |
| 工作台登录 | GitHub OAuth App | `${APP_BASE_URL}/identity/github/callback` |
| 工作台登录 | Cloudflare Access / Zero Trust OIDC | `${APP_BASE_URL}/identity/cloudflare/callback` |

`${APP_BASE_URL}` 应是外部可访问的应用 HTTPS 根地址，例如 `https://mail.example.com`，不能带末尾斜线或路径。生产部署应设置正确的 `APP_BASE_URL`；保存客户端后，以设置页显示的 URI 为准。

第三方登录用于解锁工作台，不等同于邮箱授权。用户先解锁工作台并在“已绑定的登录身份”中主动绑定 Google、GitHub 或 Cloudflare Access 账户；只有已经绑定且身份完全匹配的账户才能登录。绑定后，第三方 OAuth 验证成功会直接建立工作台会话，不再要求输入本地密码。未绑定身份不会自动注册或获得访问权；绑定、解绑等操作需从已解锁的工作台发起。请继续保留工作台密码作为回退方式。

Cloudflare 登录使用 Cloudflare Zero Trust 中配置的 SaaS OIDC 应用。在邮汇设置中填写 Cloudflare Access 的 OIDC Configuration endpoint、Client ID 和 Client Secret，并在 Cloudflare Access 应用中登记上表 Redirect URL、配置允许登录的访问策略。配置端点的形式为：

```text
https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>/.well-known/openid-configuration
```

该配置端点必须与 Client ID 对应。应用会验证 HTTPS Cloudflare Access 域名、发现文档中的 issuer/端点与同源关系，并校验 OIDC ID token 的签名、issuer、audience、expiry、state 和 nonce。Google 与 Cloudflare 登录使用 OIDC；GitHub 通过 OAuth API 获取稳定的用户身份。邮箱 Google/Microsoft OAuth 仍用于连接邮箱，需分别满足提供方对 IMAP/SMTP 权限、测试用户和管理员同意等要求。

## 新邮件检查与 Webhook

在“设置 → 定时检查与新邮件提醒”中可选择每 2、5 或 10 分钟检查一次。启用浏览器通知并授予浏览器权限后，工作台不在前台时才弹系统通知；通知不会包含邮件正文或附件。设置默认邮箱后只监测该邮箱，否则监测所有已连接邮箱。首次运行和新账户先建立基线，不会把已有邮件当作新邮件推送。

Webhook 只有在用户填写地址、启用并保存后才会发送新邮件通知。地址须使用 HTTPS 且解析到公网 IP；设置会加密保存，状态 API 不返回地址或签名密钥。留空地址或密钥不会清除已有值；使用“清除 Webhook 配置”可移除。保存通知设置不会触发测试请求。测试按钮只会向已保存的 Webhook 地址发送测试通知，应用不会自行触发真实测试。Webhook 使用验证后的公网地址直接连接，不经过专用于 Google OAuth 的受限代理。

每封新邮件会发送一个 JSON `mail.new` 事件，不包含正文、附件或原始邮件。示例：

```json
{
  "event": "mail.new",
  "eventId": 123,
  "occurredAt": "2026-01-02T03:04:05.000Z",
  "account": { "label": "个人邮箱", "email": "user@example.com" },
  "sender": { "name": "Example Service", "email": "noreply@example.com" },
  "subject": "登录验证码",
  "receivedAt": "2026-01-02T03:03:59.000Z",
  "verificationCode": "483921",
  "summary": "验证码：483921"
}
```

`verificationCode` 在邮件主题，或（邮件不超过 128 KiB 时）主题与最多 12,000 个正文字符中，明确出现验证码、校验码、OTP 等提示词且附近有 4–8 位数字时才会填入；否则为 `null`，摘要使用主题。Webhook 请求还包含 `X-Youhui-Event`、`X-Youhui-Delivery` 和 `X-Youhui-Timestamp`。若配置了可选签名密钥，会附带 `X-Youhui-Signature: sha256=<hex>`：签名是 `HMAC-SHA256(secret, timestamp + "." + 原始 JSON 请求体)`，建议校验时间戳以限制重放。Webhook 失败最多尝试 4 次（首次加最多 3 次重试）。

手动测试使用相同的 JSON 字段结构，但 `event` 为 `webhook.test`、`eventId` 为 `test-<UUID>`、包含 `test: true`，`account` 和 `sender` 为空，主题为“Webhook 测试通知”；它不会代表真实新邮件。只有用户在设置中点击测试按钮时才会发送。

企业微信群机器人地址（`qyapi.weixin.qq.com/cgi-bin/webhook/send`）会自动改用企业微信的 `text` 消息格式，内容包含邮箱、发件人、主题、时间以及有明确提示时提取的验证码，不包含正文或附件。测试为独立的测试文本；企业微信返回的 `errcode` 必须为 0 才算成功，HTTP 200 并不一定代表推送成功。签名如有配置，仍按实际发送的 JSON 请求体计算。其他地址保持上述通用 JSON 事件格式。测试失败时会尽可能显示 HTTP 状态或企业微信错误码，不回显地址或密钥。

## Agent 邮件访问（MCP）

在工作台“设置 → Agent / MCP”中查看 MCP Streamable HTTP 端点，并按用途分别创建 Bearer 令牌：

- **只读**：列出邮箱和文件夹、搜索与读取邮件。读取会将邮件标记为已读。
- **邮件管理**：包含只读能力，并可标记读/未读、加星或归档；移入已删除前必须在工作台确认。
- **发送邮件**：包含只读能力，并可提交纯文本邮件待确认；只有用户在工作台逐封确认后才会发送。
- **完全访问**：包含当前全部 MCP 邮件工具；发送邮件和移入已删除仍须在工作台逐项确认，不提供永久删除工具。

每种权限各有独立令牌，并可设置为访问全部已连接邮箱或指定邮箱。令牌只在创建或轮换时显示一次；工作台只保存 SHA-256 摘要。轮换会立即使该权限的旧令牌失效，撤销也只影响对应权限。未配置邮箱范围的既有令牌继续访问全部邮箱；升级前已有的旧令牌会自动降为只读。待处理请求会显示在工作台，并可批准或拒绝。邮件正文属于不可信外部内容，不要把正文里的指令当作可信命令。

## 邮箱连接状态

在“设置 → 邮箱账户”中可逐个查看 IMAP/IDLE 连接状态、最近一次成功读取/同步邮件的时间、重连次数及最新重连错误。启用新邮件检查时，工作台会为通知范围内的邮箱维护 IDLE 连接；关闭检查后 IDLE 状态会显示为未启用。状态在账户设置页打开时定期刷新。

## 真实部署与安全

正式连接个人邮箱前，请将项目部署到你控制的私有服务器或本机，并启用 HTTPS、限制网络访问、保护 `data/` 目录及备份。不要把 `data/encryption.key`、`data/mail.sqlite` 或 OAuth 密钥提交到 Git，也不要把未受保护的服务直接开放到公网。

`data/encryption.key` 在首次运行时自动生成。丢失该密钥将无法解密已保存的邮箱凭据；迁移或备份时需将它与 SQLite 数据库一起安全保存。更改 `DATA_DIR` 可指定其他持久化目录。

工作台可在“设置 → 备份与恢复”下载单文件 `.yhbackup` 文件，并可选择使用自己设置的口令加密；未加密备份包含数据库和可解密邮箱凭据的密钥，需妥善保管。加密备份使用 scrypt 派生密钥和 AES-256-GCM 保护整个文件；恢复时需要原密码，遗忘后无法恢复。备份不会保留登录会话。恢复会替换当前工作台全部账户和设置、退出所有会话，并要求使用备份创建时的工作台密码重新登录。系统会在恢复前检查文件格式、SQLite 完整性和加密数据；定期下载并妥善保管备份仍由用户负责。

默认支持 465 端口的 SSL/TLS 和 587 端口的 STARTTLS。若邮箱服务商要求不同端口或主机名，可在连接表单中手动填写。所有账户均在首次连接时进行实时验证；本项目没有预填邮箱、密码或模拟邮件。
