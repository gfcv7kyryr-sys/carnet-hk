package app.travelos.ui.diagnostic

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.travelos.AppContainer
import app.travelos.BuildConfigInfo
import app.travelos.data.db.DbCounts
import app.travelos.ui.components.GlassCard
import app.travelos.ui.components.NightBackground
import app.travelos.ui.components.pressable
import app.travelos.ui.programme.TopBar
import app.travelos.ui.theme.Carnet
import kotlinx.coroutines.delay
import java.util.Locale

/** Mesure GPS faite directement sur la puce (GPS_PROVIDER), sans les services Google. */
data class GpsProbe(
    val running: Boolean = false,
    val firstFixMs: Long? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracyM: Float? = null,
    val satsUsed: Int = 0,
    val satsVisible: Int = 0,
    val error: String? = null,
)

@Composable
fun DiagnosticScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val info = remember { container.deviceStatus.info() }
    val counts by container.repository.counts.collectAsState(initial = null)
    var probe by remember { mutableStateOf(GpsProbe()) }
    var elapsed by remember { mutableLongStateOf(0L) }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            probe = GpsProbe(running = true)
        } else {
            probe = GpsProbe(error = "Autorisation de localisation refusée.")
        }
    }

    if (probe.running) {
        GpsListenerEffect(context, onUpdate = { probe = it(probe) })
        LaunchedEffect(Unit) {
            val start = SystemClock.elapsedRealtime()
            while (true) {
                elapsed = SystemClock.elapsedRealtime() - start
                delay(250)
            }
        }
    }

    NightBackground {
        Column(Modifier.fillMaxSize().safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            TopBar("Diagnostic", onBack)
            Column(
                modifier = Modifier
                    .widthIn(max = 960.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 32.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                GlassCard(Modifier.fillMaxWidth()) {
                    SectionTitle("Tablette")
                    InfoRow("Modèle", "${info.manufacturer} ${info.model}")
                    InfoRow("Android", "${info.androidVersion} (API ${info.sdkInt})")
                    InfoRow("Mémoire vive", "%.1f Go".format(Locale.FRANCE, info.totalRamGb))
                    InfoRow("Stockage libre", "%.0f Go sur %.0f Go".format(Locale.FRANCE, info.freeStorageGb, info.totalStorageGb))
                    InfoRow("Services Google", if (info.playServicesInstalled) "présents (non utilisés)" else "absents")
                    InfoRow("Puce GNSS", info.gnssHardware)
                    InfoRow("Version TravelOS", BuildConfigInfo.versionName(context))
                }

                GlassCard(Modifier.fillMaxWidth()) {
                    SectionTitle("Test GPS sans Google")
                    Text(
                        "Mesure le temps du premier point donné par la puce GPS elle-même. " +
                            "Pour un test réaliste : dehors, Wi-Fi coupé, et tablette non utilisée en GPS depuis plusieurs heures.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(14.dp))
                    when {
                        probe.running -> {
                            val fix = probe.firstFixMs
                            InfoRow("Temps écoulé", seconds(elapsed))
                            InfoRow("Premier point", fix?.let { seconds(it) } ?: "en attente…")
                            InfoRow("Satellites utilisés / vus", "${probe.satsUsed} / ${probe.satsVisible}")
                            if (probe.lat != null && probe.lng != null) {
                                InfoRow("Position", "%.5f, %.5f".format(Locale.US, probe.lat, probe.lng))
                                InfoRow("Précision", probe.accuracyM?.let { "± %.0f m".format(Locale.FRANCE, it) } ?: "?")
                            }
                            probe.error?.let { Text(it, color = Carnet.Red, style = MaterialTheme.typography.bodyMedium) }
                            Spacer(Modifier.height(10.dp))
                            Button("Arrêter le test") { probe = probe.copy(running = false) }
                        }
                        else -> {
                            probe.error?.let { Text(it, color = Carnet.Red, style = MaterialTheme.typography.bodyMedium) }
                            probe.firstFixMs?.let { InfoRow("Dernier résultat", "premier point en ${seconds(it)}") }
                            Button("Lancer le test GPS") {
                                if (hasFineLocation(context)) {
                                    probe = GpsProbe(running = true)
                                } else {
                                    permission.launch(
                                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                                    )
                                }
                            }
                        }
                    }
                }

                GlassCard(Modifier.fillMaxWidth()) {
                    SectionTitle("Base de données locale")
                    val c: DbCounts? = counts
                    if (c == null) {
                        Text("Lecture…", style = MaterialTheme.typography.bodyMedium)
                    } else {
                        InfoRow("Voyages", "${c.trips}")
                        InfoRow("Journées", "${c.days}")
                        InfoRow("Étapes", "${c.steps}")
                        InfoRow("Lieux", "${c.places}")
                        InfoRow("Hôtels", "${c.hotels}")
                        InfoRow("Phrases", "${c.phrases}")
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

private fun hasFineLocation(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun seconds(ms: Long) = "%.1f s".format(Locale.FRANCE, ms / 1000.0)

/** Écoute la puce GPS tant que le composable est affiché ; tout est retiré à la sortie. */
@SuppressLint("MissingPermission")
@Composable
private fun GpsListenerEffect(context: Context, onUpdate: ((GpsProbe) -> GpsProbe) -> Unit) {
    DisposableEffect(Unit) {
        val lm = context.getSystemService(LocationManager::class.java)
        val start = SystemClock.elapsedRealtime()
        val listener = LocationListener { loc: Location ->
            val now = SystemClock.elapsedRealtime()
            onUpdate { p ->
                p.copy(
                    firstFixMs = p.firstFixMs ?: (now - start),
                    lat = loc.latitude,
                    lng = loc.longitude,
                    accuracyM = if (loc.hasAccuracy()) loc.accuracy else null,
                )
            }
        }
        val gnss = object : GnssStatus.Callback() {
            override fun onSatelliteStatusChanged(status: GnssStatus) {
                var used = 0
                for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
                val visible = status.satelliteCount
                onUpdate { p -> p.copy(satsUsed = used, satsVisible = visible) }
            }
        }
        try {
            if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                onUpdate { p -> p.copy(error = "Le GPS est désactivé dans les réglages Android.") }
            } else {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
                lm.registerGnssStatusCallback(ContextCompat.getMainExecutor(context), gnss)
            }
        } catch (e: SecurityException) {
            onUpdate { p -> p.copy(error = "Autorisation de localisation manquante.") }
        }
        onDispose {
            lm?.removeUpdates(listener)
            lm?.unregisterGnssStatusCallback(gnss)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
    }
}

@Composable
private fun Button(text: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Carnet.Red)
            .pressable(onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimary)
    }
}
