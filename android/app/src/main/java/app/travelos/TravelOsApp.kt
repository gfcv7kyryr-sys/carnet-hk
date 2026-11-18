package app.travelos

import android.app.Application
import android.content.Context
import app.travelos.core.DeviceStatus
import app.travelos.data.db.StateDatabase
import app.travelos.data.pack.PackSync
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Dépendances partagées (injection manuelle, sans bibliothèque). */
class AppContainer(context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val database: StateDatabase = StateDatabase.build(context)
    val deviceStatus = DeviceStatus(context)
    val packSync = PackSync(context)
    val gps = GpsProbe(context)
    val prefs = context.getSharedPreferences("travelos", Context.MODE_PRIVATE)

    /** Adresse d'où l'on télécharge le paquet (dépôt du carnet). */
    var sourceBaseUrl: String
        get() = prefs.getString(KEY_SOURCE, null) ?: DEFAULT_SOURCE
        set(value) = prefs.edit().putString(KEY_SOURCE, value).apply()

    companion object {
        private const val KEY_SOURCE = "source_base_url"
        const val DEFAULT_SOURCE = "https://raw.githubusercontent.com/gfcv7kyryr-sys/carnet-hk/travelos-socle/"
    }
}

class TravelOsApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        // Base de la version 0.1 (contenu dans Room), remplacée par le paquet de contenu.
        deleteDatabase("travelos.db")
        container = AppContainer(this)
    }
}
