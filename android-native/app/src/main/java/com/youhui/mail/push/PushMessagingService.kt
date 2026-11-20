package com.youhui.mail.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** 只接收通用唤醒信号（type=mail.new）；邮件元数据由 Worker 从用户自己的服务器拉取。 */
class PushMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val locator = (application as com.youhui.mail.YouhuiApplication).serviceLocator
        if (token.isNotBlank()) locator.tokenStore.fcmToken = token
        PushClient.ensurePush(applicationContext, locator)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if ("mail.new" == message.data["type"]) PushClient.enqueueSync(applicationContext)
    }

    override fun onDeletedMessages() {
        PushClient.enqueueSync(applicationContext)
    }
}
