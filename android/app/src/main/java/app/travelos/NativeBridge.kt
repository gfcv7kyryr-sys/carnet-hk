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
        val q = Uri.encode("$lat,$lng($label)")
        start(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$q")))
    }

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
