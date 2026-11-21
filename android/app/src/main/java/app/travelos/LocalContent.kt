package app.travelos

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File

/** Contenu local de TravelOS servi aux WebView (interface, paquet, icônes), sans réseau. */
object LocalContent {
    const val HOST = "appassets.androidplatform.net"
    const val UI = "https://$HOST/assets/ui/"

    fun loader(context: Context, packDir: File): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .addPathHandler("/pack/", WebViewAssetLoader.InternalStoragePathHandler(context, packDir))
            .addPathHandler("/appicon/", AppIconHandler(context.packageManager))
            .addPathHandler("/osm/", OsmTiles.get(context))
            .build()

    private fun empty(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    /**
     * N'autorise que le contenu local ; toute autre requête est bloquée.
     * Les liens externes touchés par l'utilisateur sont confiés à [onExternal].
     */
    class Client(
        private val loader: WebViewAssetLoader,
        private val onExternal: (Uri) -> Unit,
    ) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host == HOST) return loader.shouldInterceptRequest(url) ?: empty(404, "Absent")
            return empty(403, "Hors ligne")
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            onExternal(request.url)
            return true
        }
    }
}
