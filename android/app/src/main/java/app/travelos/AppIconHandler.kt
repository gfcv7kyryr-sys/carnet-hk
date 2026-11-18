package app.travelos

import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** Sert l'icône d'une application installée en PNG : /appicon/<paquet>.png (écran Applications). */
class AppIconHandler(private val pm: PackageManager) : WebViewAssetLoader.PathHandler {
    private val cache = HashMap<String, ByteArray>()

    override fun handle(path: String): WebResourceResponse? {
        val pkg = path.removeSuffix(".png")
        if (pkg.isBlank() || pkg.contains('/')) return null
        val bytes = synchronized(cache) { cache[pkg] } ?: render(pkg)?.also { synchronized(cache) { cache[pkg] = it } } ?: return null
        return WebResourceResponse("image/png", null, ByteArrayInputStream(bytes))
    }

    private fun render(pkg: String): ByteArray? = try {
        val d = pm.getApplicationIcon(pkg)
        val size = 144
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        d.setBounds(0, 0, size, size)
        d.draw(canvas)
        ByteArrayOutputStream().use { out ->
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }
}
