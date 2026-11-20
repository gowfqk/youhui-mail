package com.youhui.mail

import android.app.Application
import com.youhui.mail.di.ServiceLocator

class YouhuiApplication : Application() {

    lateinit var serviceLocator: ServiceLocator
        private set

    override fun onCreate() {
        super.onCreate()
        serviceLocator = ServiceLocator(this)
    }
}
