package app.travelos

import android.annotation.SuppressLint
import android.graphics.Color
import android.service.dreams.DreamService
import android.webkit.WebView

/**
 * Économiseur d'écran TravelOS (Réglages Android › Affichage › Économiseur d'écran) :
 * s'affiche quand la tablette est en charge et inactive. Photo du jour, heure en transparence
 * derrière le sujet, prochaine étape. Lecture seule : un toucher réveille la tablette.
 */
class TravelDream : DreamService() {
    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = false
        val container = (application as TravelOsApp).container
        val loader = LocalContent.loader(this, container.packSync.dir)
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            webViewClient = LocalContent.Client(loader) { /* aucun lien externe dans l'économiseur */ }
            loadUrl(LocalContent.UI + "dream.html")
        }
        setContentView(webView)
    }

    override fun onDetachedFromWindow() {
        webView?.destroy()
        webView = null
        super.onDetachedFromWindow()
    }
}
