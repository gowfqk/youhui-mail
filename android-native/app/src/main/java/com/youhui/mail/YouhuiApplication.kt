package com.youhui.mail

import android.app.Application
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.I18n

class YouhuiApplication : Application() {

    lateinit var serviceLocator: ServiceLocator
        private set

    override fun onCreate() {
        super.onCreate()
        I18n.init(this)
        serviceLocator = ServiceLocator(this)
    }
}
