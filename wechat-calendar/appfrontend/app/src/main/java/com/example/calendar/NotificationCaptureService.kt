package com.example.calendar

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class NotificationCaptureService : NotificationListenerService() {

    private val executor = Executors.newSingleThreadExecutor()
    // 只捕获这几个主流办公和社交应用的通知，避免过多垃圾数据
    private val whitelist = setOf(
        "com.tencent.mm",
        "com.tencent.mobileqq",
        "com.ss.android.lark",
        "com.alibaba.android.rimet"
    )

    companion object {
        @Volatile private var instance: NotificationCaptureService? = null
        var onUploadLog: ((String) -> Unit)? = null

        fun captureCurrentNotifications(): Boolean {
            val svc = instance ?: return false
            val list = svc.activeNotifications ?: emptyArray()
            list.forEach { svc.processAndUpload(it) }
            onUploadLog?.invoke("手动抓取：共处理 ${list.size} 条通知")
            return true
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        onUploadLog?.invoke("通知监听服务已连接")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        executor.shutdown()
    }
    // 每当有新通知发布时触发
    override fun onNotificationPosted(sbn: StatusBarNotification) {

        if (!AppPrefs.isCaptureEnabled(this)) return
        processAndUpload(sbn)
    }
    // 处理通知内容并上传到服务器
    private fun processAndUpload(sbn: StatusBarNotification) {
//        if (!whitelist.contains(sbn.packageName)) return // 只处理白名单内的应用
        val token = AppPrefs.getAppToken(this)
        if (token.isBlank()) return

        val extras = sbn.notification.extras
        val title = extras?.getCharSequence("android.title")?.toString() ?: ""
        val text = extras?.getCharSequence("android.text")?.toString() ?: ""
        val postedAt = formatDateTime(sbn.postTime)
        val dedupeKey = md5("${sbn.packageName}|$title|$text|$postedAt")

        if (AppPrefs.isDuplicate(this, dedupeKey)) return

        val baseUrl = AppPrefs.getBaseUrl(this)
        executor.execute {
            val result = ApiClient.ingest(
                baseUrl = baseUrl,
                token = token,
                packageName = sbn.packageName,
                title = title,
                text = text,
                postedAt = postedAt,
                dedupeKey = dedupeKey
            )
            if (result.ok) {
                AppPrefs.markSent(this, dedupeKey)
            }
            onUploadLog?.invoke("${if (result.ok) "✅" else "❌"} ${sbn.packageName}: ${result.message}")
        }
    }

    private fun formatDateTime(timestamp: Long): String {
        return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(timestamp))
    }

    private fun md5(input: String): String {
        val digest = MessageDigest.getInstance("MD5").digest(input.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
