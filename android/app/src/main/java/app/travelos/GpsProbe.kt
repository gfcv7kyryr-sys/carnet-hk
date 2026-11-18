package app.travelos

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Test du GPS fait directement sur la puce (GPS_PROVIDER), sans les services Google.
 * Démarré et arrêté par l'interface ; rien ne tourne en dehors du test.
 */
class GpsProbe(private val context: Context) {
    private val lm = context.getSystemService(LocationManager::class.java)
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var running = false
    @Volatile private var startedAt = 0L
    @Volatile private var firstFixMs: Long? = null
    @Volatile private var lastFixMs: Long? = null
    @Volatile private var location: Location? = null
    @Volatile private var satsUsed = 0
    @Volatile private var satsVisible = 0
    @Volatile private var error: String? = null

    private val listener = LocationListener { loc ->
        val now = SystemClock.elapsedRealtime()
        if (firstFixMs == null) firstFixMs = now - startedAt
        lastFixMs = now - startedAt
        location = loc
    }

    private val gnss = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            var used = 0
            for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
            satsUsed = used
            satsVisible = status.satelliteCount
        }
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start() = main.post {
        if (running) return@post
        firstFixMs = null; lastFixMs = null; location = null; satsUsed = 0; satsVisible = 0; error = null
        startedAt = SystemClock.elapsedRealtime()
        when {
            !hasPermission() -> error = "Autorisation de localisation manquante."
            lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> error = "Le GPS est désactivé dans les réglages Android."
            else -> try {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
                lm.registerGnssStatusCallback(ContextCompat.getMainExecutor(context), gnss)
                running = true
            } catch (e: SecurityException) {
                error = "Autorisation de localisation manquante."
            }
        }
    }

    fun stop() = main.post {
        if (!running) return@post
        lm?.removeUpdates(listener)
        lm?.unregisterGnssStatusCallback(gnss)
        running = false
    }

    fun json(): String {
        val loc = location
        return JSONObject()
            .put("running", running)
            .put("elapsedMs", if (running) SystemClock.elapsedRealtime() - startedAt else JSONObject.NULL)
            .put("firstFixMs", firstFixMs ?: JSONObject.NULL)
            .put("satsUsed", satsUsed)
            .put("satsVisible", satsVisible)
            .put("lat", loc?.latitude ?: JSONObject.NULL)
            .put("lng", loc?.longitude ?: JSONObject.NULL)
            .put("accuracy", if (loc != null && loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
            .put("error", error ?: JSONObject.NULL)
            .toString()
    }
}
