package app.travelos

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.widget.FrameLayout
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.File

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

    private var pendingGuideText: String? = null
    private var pendingGuidePhoto: Uri? = null
    private val takePhoto = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val text = pendingGuideText ?: return@registerForActivityResult
        shareToGuide(text, if (ok) pendingGuidePhoto else null)
        pendingGuideText = null
    }

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        js("window.TravelOS && TravelOS.onPermission && TravelOS.onPermission()")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as TravelOsApp).container

        val loader = LocalContent.loader(this, container.packSync.dir)

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
            webViewClient = LocalContent.Client(loader) { url ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: ActivityNotFoundException) {
                    toastJs("Aucune application ne peut ouvrir ce lien.")
                }
            }
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
        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        webView.loadUrl(LocalContent.UI + "index.html")

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

    /** Sortie de veille : l'accueil remet à jour l'heure, la scène du moment et la prochaine étape. */
    override fun onPause() {
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) js("window.TravelOS && TravelOS.onResume && TravelOS.onResume()")
    }

    override fun onDestroy() {
        (application as TravelOsApp).container.gps.stop()
        webView.destroy()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        js("window.TravelOS && TravelOS.onSystemTheme && TravelOS.onSystemTheme(${isSystemDark()})")
    }

    fun isSystemDark(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun callJs(code: String) = js(code)

    /** Question au guide : texte copié, photo facultative, partage vers DeepSeek (ou au choix). */
    fun askGuide(text: String, withPhoto: Boolean) {
        copyToClipboard(text)
        if (!withPhoto) { shareToGuide(text, null); return }
        val dir = File(cacheDir, "guide").apply { mkdirs() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        dir.listFiles()?.filter { it.name != file.name }?.forEach { it.delete() }
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        pendingGuideText = text
        pendingGuidePhoto = uri
        try {
            takePhoto.launch(uri)
        } catch (e: ActivityNotFoundException) {
            pendingGuideText = null
            shareToGuide(text, null)
        }
    }

    private fun shareToGuide(text: String, photo: Uri?) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = if (photo != null) "image/jpeg" else "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            if (photo != null) {
                putExtra(Intent.EXTRA_STREAM, photo)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        val deepseek = "com.deepseek.chat"
        val target = if (packageManager.getLaunchIntentForPackage(deepseek) != null) send.setPackage(deepseek)
        else Intent.createChooser(send, "Demander au guide")
        try {
            startActivity(target)
            toastJs("Question copiée : si elle n'apparaît pas, collez-la dans DeepSeek.")
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent.createChooser(send.setPackage(null), "Demander au guide"))
        }
    }

    private fun copyToClipboard(text: String) {
        val cm = getSystemService(ClipboardManager::class.java) ?: return
        cm.setPrimaryClip(ClipData.newPlainText("Question au guide", text))
    }

    fun requestLocationPermission() {
        locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    fun setTextZoom(percent: Int) {
        if (::webView.isInitialized && webView.settings.textZoom != percent) webView.settings.textZoom = percent
    }

    fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun toastJs(message: String) {
        js("window.TravelOS && TravelOS.toast(${JSONObject.quote(message)})")
    }

    /** Appelle une fonction de l'interface avec une chaîne en argument, si elle existe. */
    fun jsCall(fn: String, arg: String) {
        js("window.TravelOS && $fn && $fn(${JSONObject.quote(arg)})")
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

}
