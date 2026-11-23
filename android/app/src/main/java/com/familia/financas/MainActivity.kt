package com.familia.financas

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Tela de configuração do App Android de captura bancária.
 * Permite configurar a URL do servidor, o token de dispositivo (ff_dev_...)
 * gerado na PWA e abrir a tela de permissão de Acesso a Notificações do Android.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "Finanças Família — Captura Bancária"
            textSize = 20f
        }
        val subtitle = TextView(this).apply {
            text = "As notificações dos bancos suportados (Nubank, Itaú, Bradesco, BB, Inter, Santander, C6) vão para a SUA fila privada de revisão."
            setPadding(0, 12, 0, 24)
        }

        val urlLabel = TextView(this).apply { text = "URL da API (HTTPS):" }
        val urlInput = EditText(this).apply {
            hint = "https://financas.seudominio.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(ApiClient.getApiUrl(this@MainActivity))
        }

        val tokenLabel = TextView(this).apply {
            text = "Token do Dispositivo (gerado na PWA):"
            setPadding(0, 16, 0, 0)
        }
        val tokenInput = EditText(this).apply {
            hint = "ff_dev_..."
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(ApiClient.getDeviceToken(this@MainActivity))
        }

        val extraPkgLabel = TextView(this).apply {
            text = "Pacotes bancários extras opcionais (separados por vírgula):"
            setPadding(0, 16, 0, 0)
        }
        val extraPkgInput = EditText(this).apply {
            hint = "br.com.outrobanco.app"
            inputType = InputType.TYPE_CLASS_TEXT
            setText(ApiClient.getExtraPackages(this@MainActivity))
        }

        val saveBtn = Button(this).apply {
            text = "Salvar configuração"
            setOnClickListener {
                ApiClient.saveConfig(
                    this@MainActivity,
                    urlInput.text.toString(),
                    tokenInput.text.toString(),
                    extraPkgInput.text.toString()
                )
                Toast.makeText(this@MainActivity, "Configuração salva com sucesso", Toast.LENGTH_SHORT).show()
            }
        }

        val permBtn = Button(this).apply {
            text = "Abrir Permissão de Acesso a Notificações"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }

        root.addView(title)
        root.addView(subtitle)
        root.addView(urlLabel)
        root.addView(urlInput)
        root.addView(tokenLabel)
        root.addView(tokenInput)
        root.addView(extraPkgLabel)
        root.addView(extraPkgInput)
        root.addView(saveBtn)
        root.addView(permBtn)

        setContentView(ScrollView(this).apply { addView(root) })
    }
}
