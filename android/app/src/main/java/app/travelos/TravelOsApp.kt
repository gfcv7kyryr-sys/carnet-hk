package app.travelos

import android.app.Application
import android.content.Context
import app.travelos.core.DeviceStatus
import app.travelos.data.Preferences
import app.travelos.data.TripRepository
import app.travelos.data.db.TravelDatabase
import app.travelos.data.seed.SeedImporter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Dépendances partagées de l'application (injection manuelle, sans bibliothèque). */
class AppContainer(context: Context) {
    val database: TravelDatabase = TravelDatabase.build(context)
    val repository = TripRepository(database)
    val preferences = Preferences(context)
    val deviceStatus = DeviceStatus(context)
    private val seedImporter = SeedImporter(context, database)

    private val _seedError = MutableStateFlow<String?>(null)
    /** Message d'erreur si le chargement du voyage embarqué a échoué. */
    val seedError: StateFlow<String?> = _seedError

    suspend fun seed() {
        runCatching { seedImporter.importIfEmpty() }
            .onFailure { _seedError.value = it.message ?: it.javaClass.simpleName }
    }
}

class TravelOsApp : Application() {
    lateinit var container: AppContainer
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        appScope.launch { container.seed() }
    }
}
