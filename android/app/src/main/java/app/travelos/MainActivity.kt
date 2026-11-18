package app.travelos

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Activité unique de TravelOS. Elle sert aussi d'écran d'accueil Android (catégorie HOME) :
 * à l'allumage de la tablette, on arrive directement sur le choix du profil.
 *
 * L'interface est une page HTML embarquée (assets/ui) affichée dans une WebView verrouillée ;
 * le contenu du voyage (pack.json, images, audios) est lu dans le stockage de l'application.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        js("window.TravelOS && TravelOS.onPermission && TravelOS.onPermission()")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as TravelOsApp).container

        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/pack/", WebViewAssetLoader.InternalStoragePathHandler(this, container.packSync.dir))
            .addPathHandler("/appicon/", AppIconHandler(packageManager))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
            }
            addJavascriptInterface(NativeBridge(this@MainActivity, container), "TravelOSNative")
            webViewClient = LockedClient(loader)
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        pickFiles.launch(params.acceptTypes.firstOrNull { it.isNotBlank() } ?: "*/*")
                        true
                    } catch (e: ActivityNotFoundException) {
                        fileCallback = null
                        false
                    }
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("https://$HOST/assets/ui/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // Écran d'accueil : le retour n'est jamais une sortie, l'interface décide.
            override fun handleOnBackPressed() = js("window.TravelOS && TravelOS.back()")
        })
    }

    /** Touche Accueil alors que TravelOS est déjà ouvert. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) js("window.TravelOS && TravelOS.onHome()")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        (application as TravelOsApp).container.gps.stop()
        webView.destroy()
        super.onDestroy()
    }

    fun requestLocationPermission() {
        locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun toastJs(message: String) {
        js("window.TravelOS && TravelOS.toast(${JSONObject.quote(message)})")
    }

    private fun js(code: String) {
        if (::webView.isInitialized) webView.post { webView.evaluateJavascript(code, null) }
    }

    /** Plein écran façon terminal : les barres Android réapparaissent d'un glissement du bord. */
    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    /** N'autorise que l'interface embarquée ; les liens externes partent vers les autres applis. */
    private inner class LockedClient(private val loader: WebViewAssetLoader) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host == HOST) {
                return loader.shouldInterceptRequest(url)
                    ?: WebResourceResponse("text/plain", "utf-8", 404, "Absent", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            return WebResourceResponse("text/plain", "utf-8", 403, "Hors ligne", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == HOST) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: ActivityNotFoundException) {
                toastJs("Aucune application ne peut ouvrir ce lien.")
            }
            return true
        }
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}
