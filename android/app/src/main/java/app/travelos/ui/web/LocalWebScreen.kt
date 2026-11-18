package app.travelos.ui.web

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

private const val HOST = "appassets.androidplatform.net"

/** Contient le rappel du sélecteur de fichiers en attente (photos de billets, etc.). */
private class FileChooserHolder {
    var callback: ValueCallback<Array<Uri>>? = null
}

/**
 * Affiche une page HTML embarquée (assets/…) dans une WebView verrouillée :
 * - les fichiers sont servis en local par WebViewAssetLoader, sans réseau ;
 * - toute requête vers un autre site est bloquée ;
 * - les liens externes (Amap, réservations) s'ouvrent hors de l'application.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LocalWebScreen(entryPath: String, hash: String?, onExit: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val chooser = remember { FileChooserHolder() }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        chooser.callback?.onReceiveValue(uris.toTypedArray())
        chooser.callback = null
    }

    val webView = remember {
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

        WebView(context).apply {
            setBackgroundColor(Color.BLACK)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = true
                setGeolocationEnabled(true)
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
            }
            webViewClient = LockedClient(context, loader)
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    chooser.callback?.onReceiveValue(null)
                    chooser.callback = callback
                    val mime = params.acceptTypes.firstOrNull { it.isNotBlank() } ?: "*/*"
                    return try {
                        pickFiles.launch(mime)
                        true
                    } catch (e: ActivityNotFoundException) {
                        chooser.callback = null
                        false
                    }
                }

                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: GeolocationPermissions.Callback,
                ) {
                    val granted = ContextCompat.checkSelfPermission(
                        context,
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                    ) == PackageManager.PERMISSION_GRANTED
                    callback.invoke(origin, granted, false)
                }
            }
            val fragment = hash?.takeIf { it.isNotBlank() }?.let { "#$it" }.orEmpty()
            loadUrl("https://$HOST/assets/$entryPath$fragment")
        }
    }

    BackHandler {
        if (webView.canGoBack()) webView.goBack() else onExit()
    }

    DisposableEffect(webView) {
        onDispose {
            chooser.callback?.onReceiveValue(null)
            webView.stopLoading()
            webView.destroy()
        }
    }

    AndroidView(factory = { webView }, modifier = modifier.fillMaxSize())
}

private class LockedClient(
    private val context: Context,
    private val loader: WebViewAssetLoader,
) : WebViewClient() {

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host == HOST) return loader.shouldInterceptRequest(url)
        // Aucun chargement réseau depuis le contenu embarqué.
        return WebResourceResponse("text/plain", "utf-8", 403, "Hors ligne", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (url.host == HOST) return false
        // Liens externes : ouverts par l'application adaptée (navigateur, Amap, téléphone…).
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: ActivityNotFoundException) {
            true
        }
    }
}
