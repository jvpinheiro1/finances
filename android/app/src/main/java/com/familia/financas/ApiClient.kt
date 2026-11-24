package com.familia.financas

import android.content.Context
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Cliente HTTP nativo para envio de notificações bancárias ao backend Go.
 * Regra de segurança (AGENTS.md / ADR 0011): NUNCA registra conteúdo da notificação,
 * valores monetários ou o token de dispositivo em logs (Logcat).
 */
object ApiClient {
    private const val PREFS_NAME = "financas_prefs"
    private const val KEY_API_URL = "api_base_url"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_EXTRA_PACKAGES = "extra_packages"

    // Pacotes oficiais dos 7 bancos suportados por padrão (Decisão E8-D1).
    val DEFAULT_BANK_PACKAGES = setOf(
        "com.nu.production",          // Nubank
        "com.itau",                   // Itaú
        "com.itaucard.activity",      // Itaú Cartões
        "com.bradesco",               // Bradesco
        "br.com.bb.android",          // Banco do Brasil
        "br.com.intermedium",         // Banco Inter
        "com.santander.app",          // Santander
        "com.c6bank.app"              // C6 Bank
    )

    fun saveConfig(ctx: Context, apiUrl: String, deviceToken: String, extraPackages: String) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_API_URL, apiUrl.trim().trimEnd('/'))
            .putString(KEY_DEVICE_TOKEN, deviceToken.trim())
            .putString(KEY_EXTRA_PACKAGES, extraPackages.trim())
            .apply()
    }

    fun getApiUrl(ctx: Context): String =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_API_URL, "") ?: ""

    fun getDeviceToken(ctx: Context): String =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_DEVICE_TOKEN, "") ?: ""

    fun getExtraPackages(ctx: Context): String =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_EXTRA_PACKAGES, "") ?: ""

    fun isAllowedBankPackage(ctx: Context, pkg: String): Boolean {
        if (DEFAULT_BANK_PACKAGES.contains(pkg)) return true
        val extras = getExtraPackages(ctx)
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        return extras.contains(pkg)
    }

    fun sendNotification(
        ctx: Context,
        packageName: String,
        title: String,
        text: String,
        externalId: String
    ): Boolean {
        val baseUrl = getApiUrl(ctx)
        val token = getDeviceToken(ctx)
        if (baseUrl.isEmpty() || token.isEmpty()) return false

        val endpoint = URL("$baseUrl/api/v1/ingest/bank-notification")
        val payload = JSONObject().apply {
            put("package_name", packageName)
            put("title", title)
            put("text", text)
            put("occurred_on", LocalDate.now(ZoneOffset.UTC).toString())
            put("external_id", externalId)
        }.toString()

        // Até 2 tentativas com timeout de 35s para suportar cold start (~30s) em PaaS gratuito (ADR 0012).
        for (attempt in 1..2) {
            val conn = (endpoint.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 35_000
                readTimeout = 35_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("X-Requested-With", "AndroidApp")
            }
            try {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(payload)
                }
                val code = conn.responseCode
                if (code in 200..299) {
                    return true
                }
                if (code in 400..499) {
                    return false
                }
            } catch (_: Exception) {
                // Silencioso: nunca grava payload financeiro no Logcat.
            } finally {
                conn.disconnect()
            }
        }
        return false
    }
}
