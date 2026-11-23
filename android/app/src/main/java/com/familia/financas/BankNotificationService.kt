package com.familia.financas

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.Executors

/**
 * Escuta apenas as notificações dos aplicativos bancários autorizados (E8-D1)
 * e envia ao backend para revisão privada pelo dono do celular (E8-D3).
 */
class BankNotificationService : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.isOngoing) return
        val pkg = sbn.packageName ?: return
        if (!ApiClient.isAllowedBankPackage(applicationContext, pkg)) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim() ?: ""

        if (title.isEmpty() && text.isEmpty()) return

        // Identificador para deduplicação caso o sistema operacional reexiba a notificação.
        val externalId = "${sbn.key}:${sbn.postTime}"
        val appCtx = applicationContext

        executor.execute {
            ApiClient.sendNotification(
                ctx = appCtx,
                packageName = pkg,
                title = title,
                text = text,
                externalId = externalId
            )
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }
}
