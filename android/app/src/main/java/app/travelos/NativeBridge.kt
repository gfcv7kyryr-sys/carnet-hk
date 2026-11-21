package app.travelos

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import app.travelos.data.db.StepStateEntity
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pont entre l'interface HTML et le moteur natif, exposé sous `window.TravelOSNative`.
 * La WebView ne charge que l'interface embarquée (tout autre site est bloqué),
 * donc seul notre propre code peut appeler ces méthodes.
 * Les méthodes tournent sur le fil du pont (hors fil principal) ; tout ce qui touche
 * à l'affichage est renvoyé sur le fil principal.
 */
class NativeBridge(private val activity: MainActivity, private val c: AppContainer) {
    private val main = Handler(Looper.getMainLooper())
    private val dao = c.database.stateDao()

    @JavascriptInterface
    fun version(): String {
        val info = activity.packageManager.getPackageInfo(activity.packageName, PackageManager.PackageInfoFlags.of(0))
        return "${info.versionName} (${info.longVersionCode})"
    }

    @JavascriptInterface
    fun device(): String {
        val s = c.deviceStatus.snapshot()
        val i = c.deviceStatus.info()
        return JSONObject()
            .put("battery", s.batteryPercent).put("charging", s.charging)
            .put("network", s.network.name).put("networkLabel", s.network.label)
            .put("gps", s.gpsEnabled).put("airplane", s.airplaneMode)
            .put("model", "${i.manufacturer} ${i.model}").put("android", i.androidVersion).put("sdk", i.sdkInt)
            .put("ramGb", i.totalRamGb).put("freeGb", i.freeStorageGb).put("totalGb", i.totalStorageGb)
            .put("playServices", i.playServicesInstalled).put("gnss", i.gnssHardware)
            .toString()
    }

    /** Mode sombre du système (réglage de la tablette). */
    @JavascriptInterface
    fun systemDark(): Boolean = activity.isSystemDark()

    // ---- État des étapes (Room) ----

    @JavascriptInterface
    fun stepStates(): String {
        val o = JSONObject()
        dao.allSteps().forEach { o.put(it.key, it.status) }
        return o.toString()
    }

    @JavascriptInterface
    fun setStepState(key: String, status: String) {
        if (status == "PLANNED") dao.deleteStep(key)
        else dao.upsertStep(StepStateEntity(key, status, System.currentTimeMillis()))
    }

    // ---- Paquet de contenu ----

    @JavascriptInterface
    fun hasSyncedPack(): Boolean = c.packSync.hasPack()

    @JavascriptInterface
    fun syncState(): String = c.packSync.state.value.toJson().put("source", c.sourceBaseUrl).toString()

    @JavascriptInterface
    fun startSync() {
        c.scope.launch { c.packSync.run(c.sourceBaseUrl) }
    }

    // ---- GPS ----

    @JavascriptInterface
    fun hasLocationPermission(): Boolean = c.gps.hasPermission()

    @JavascriptInterface
    fun requestLocationPermission() = main.post { activity.requestLocationPermission() }

    @JavascriptInterface
    fun gpsStart() { c.gps.start() }

    @JavascriptInterface
    fun gpsStop() { c.gps.stop() }

    @JavascriptInterface
    fun gpsState(): String = c.gps.json()

    // ---- Traducteur hors ligne ----

    @JavascriptInterface
    fun translatorState(): String = c.translator.state()

    @JavascriptInterface
    fun translatorDownload() = main.post { c.translator.download() }

    /** Résultat renvoyé à TravelOS.onTranslate(id, { text, error }). */
    @JavascriptInterface
    fun translate(id: String, text: String, toChinese: Boolean) = main.post {
        c.translator.translate(text, toChinese) { result, error ->
            val payload = JSONObject().put("text", result ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL)
            activity.callJs("TravelOS.onTranslate(${JSONObject.quote(id)}, $payload)")
        }
    }

    @JavascriptInterface
    fun speak(text: String, languageTag: String): String = c.translator.speak(text, languageTag)

    /** Ouvre Google Traduction (conversation, caméra) avec le texte, s'il est installé. */
    @JavascriptInterface
    fun openGoogleTranslate(text: String) {
        val pkg = "com.google.android.apps.translate"
        if (!isInstalled(pkg)) {
            activity.toastJs("Google Traduction n'est pas installé : à installer depuis le Play Store avant le départ.")
            return
        }
        val intent = if (text.isBlank()) activity.packageManager.getLaunchIntentForPackage(pkg)
        else Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).setPackage(pkg)
        intent?.let { start(it) }
    }

    @JavascriptInterface
    fun hasApp(pkg: String): Boolean = isInstalled(pkg)

    // ---- Demander au guide (DeepSeek) ----

    /** Copie la question, prend une photo si demandé, puis la partage avec DeepSeek. */
    @JavascriptInterface
    fun askGuide(text: String, withPhoto: Boolean) = main.post { activity.askGuide(text, withPhoto) }

    private fun isInstalled(pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") activity.packageManager.getPackageInfo(pkg, 0)
        }
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    // ---- Sorties vers Android ----

    @JavascriptInterface
    fun openUrl(url: String) {
        val uri = Uri.parse(url)
        val scheme = uri.scheme ?: return
        if (scheme !in ALLOWED_SCHEMES) return
        start(Intent(Intent.ACTION_VIEW, uri))
    }

    /** Ouvre un lieu dans l'application de cartes choisie (Amap, Google Maps…). */
    @JavascriptInterface
    fun openMap(lat: Double, lng: Double, label: String) {
        // « Y aller » : itinéraire dans Amap (transports en commun par défaut, modifiable dans Amap).
        // dev=1 : coordonnées en WGS-84, Amap les convertit lui-même.
        val amap = Uri.parse("androidamap://route/plan/?sourceApplication=TravelOS&dlat=$lat&dlon=$lng&dname=${Uri.encode(label)}&dev=1&t=1")
        val intent = Intent(Intent.ACTION_VIEW, amap).setPackage("com.autonavi.minimap").addCategory(Intent.CATEGORY_DEFAULT)
        if (intent.resolveActivity(activity.packageManager) != null) { start(intent); return }
        val q = Uri.encode("$lat,$lng($label)")
        start(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$q")))
    }

    /* ---------------- Carte du jour (Amap) ---------------- */

    @JavascriptInterface fun mapState(): String = activity.mapHost.state()
    @JavascriptInterface fun mapShow(json: String) = activity.mapHost.show(json)
    @JavascriptInterface fun mapHide() = activity.mapHost.hide()
    @JavascriptInterface fun mapFit() = activity.mapHost.fit(true)
    @JavascriptInterface fun mapLocate() = activity.mapHost.locate()
    @JavascriptInterface fun setAmapKey(key: String) = activity.mapHost.setKey(key)
    @JavascriptInterface fun offlineMaps(cities: String) = activity.mapHost.downloadOffline(cities)

    @JavascriptInterface
    fun apps(): String {
        val pm = activity.packageManager
        val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(query, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") pm.queryIntentActivities(query, 0)
        }
        val arr = JSONArray()
        list.map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != activity.packageName }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
            .forEach { (pkg, label) -> arr.put(JSONObject().put("pkg", pkg).put("label", label)) }
        return arr.toString()
    }

    @JavascriptInterface
    fun launchApp(pkg: String) {
        val intent = activity.packageManager.getLaunchIntentForPackage(pkg) ?: return
        start(intent)
    }

    /** « home » : choix de l'écran d'accueil ; « wifi » ; sinon les réglages Android. */
    @JavascriptInterface
    fun openSettings(which: String) {
        val action = when (which) {
            "home" -> Settings.ACTION_HOME_SETTINGS
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "dream" -> "android.settings.DREAM_SETTINGS"
            else -> Settings.ACTION_SETTINGS
        }
        start(Intent(action))
    }

    @JavascriptInterface
    fun isDefaultHome(): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))
        } else {
            @Suppress("DEPRECATION") activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        return info?.activityInfo?.packageName == activity.packageName
    }

    /**
     * Fond de l'écran verrouillé = une image du paquet (photo du jour). Renvoie « ok » ou un message.
     * L'horloge de l'écran verrouillé reste celle d'Android ; seule l'image change.
     */
    @JavascriptInterface
    fun setLockWallpaper(packPath: String): String {
        val file = java.io.File(c.packSync.dir, packPath)
        if (packPath.contains("..") || !file.isFile) return "Image absente : synchronisez le contenu."
        return try {
            val bmp = android.graphics.BitmapFactory.decodeFile(file.absolutePath) ?: return "Image illisible."
            android.app.WallpaperManager.getInstance(activity)
                .setBitmap(bmp, null, true, android.app.WallpaperManager.FLAG_LOCK)
            "ok"
        } catch (e: Exception) {
            e.message ?: "Impossible de changer le fond d'écran."
        }
    }

    /** Taille du texte de toute l'interface, en pourcentage (85 à 130). */
    @JavascriptInterface
    fun setTextZoom(percent: Int) = main.post { activity.setTextZoom(percent.coerceIn(70, 160)) }

    @JavascriptInterface
    fun keepScreenOn(on: Boolean) = main.post { activity.setKeepScreenOn(on) }

    private companion object {
        val ALLOWED_SCHEMES = setOf("https", "http", "tel", "geo", "mailto")
    }

    private fun start(intent: Intent) = main.post {
        try {
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            activity.toastJs("Aucune application ne peut ouvrir ce lien.")
        }
    }
}
