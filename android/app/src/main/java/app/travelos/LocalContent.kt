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
import java.io.FilterInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.channels.Channels

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

    /**
     * Audio du paquet servi avec les requêtes partielles (Range) : sans elles, le lecteur de la WebView
     * ne peut pas avancer ni reculer dans un morceau.
     */
    private fun media(packDir: File?, request: WebResourceRequest): WebResourceResponse? {
        val path = request.url.path ?: return null
        if (packDir == null || !path.startsWith("/pack/")) return null
        val mime = when (path.substringAfterLast('.').lowercase()) { "mp3" -> "audio/mpeg"; "m4a" -> "audio/mp4"; "ogg", "opus" -> "audio/ogg"; else -> return null }
        val root = packDir.canonicalFile
        val file = File(root, Uri.decode(path.removePrefix("/pack/"))).canonicalFile
        if (!file.path.startsWith(root.path + File.separator) || !file.isFile) return empty(404, "Absent")
        val size = file.length()
        val range = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
        val m = range?.let { Regex("""bytes=(\d*)-(\d*)""").find(it) }
        var start = 0L; var end = size - 1
        if (m != null) {
            val (a, b) = m.destructured
            if (a.isNotEmpty()) { start = a.toLong(); if (b.isNotEmpty()) end = minOf(b.toLong(), size - 1) }
            else if (b.isNotEmpty()) start = maxOf(0L, size - b.toLong())
            if (start >= size) return WebResourceResponse(mime, null, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$size"), ByteArrayInputStream(ByteArray(0)))
        }
        val len = end - start + 1
        val raf = RandomAccessFile(file, "r").apply { seek(start) }
        val body: InputStream = object : FilterInputStream(Channels.newInputStream(raf.channel)) {
            var left = len
            override fun read(): Int { if (left <= 0) return -1; val r = super.read(); if (r >= 0) left--; return r }
            override fun read(b: ByteArray, off: Int, n: Int): Int { if (left <= 0) return -1; val r = super.read(b, off, minOf(n.toLong(), left).toInt()); if (r > 0) left -= r; return r }
            override fun close() { super.close(); raf.close() }
        }
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "Content-Length" to len.toString(), "Cache-Control" to "no-cache")
        return if (m != null) WebResourceResponse(mime, null, 206, "Partial Content", headers + ("Content-Range" to "bytes $start-$end/$size"), body)
        else WebResourceResponse(mime, null, 200, "OK", headers, body)
    }

    private fun empty(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    /**
     * N'autorise que le contenu local ; toute autre requête est bloquée.
     * Les liens externes touchés par l'utilisateur sont confiés à [onExternal].
     */
    class Client(
        private val loader: WebViewAssetLoader,
        private val packDir: File? = null,
        private val onExternal: (Uri) -> Unit,
    ) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host == HOST) {
                media(packDir, request)?.let { return it }
                return loader.shouldInterceptRequest(url) ?: empty(404, "Absent")
            }
            return empty(403, "Hors ligne")
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            onExternal(request.url)
            return true
        }
    }
}
