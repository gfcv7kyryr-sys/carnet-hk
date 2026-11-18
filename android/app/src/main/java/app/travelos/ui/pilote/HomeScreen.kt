package app.travelos.ui.pilote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.travelos.AppContainer
import app.travelos.core.NetworkState
import app.travelos.core.TripClock
import app.travelos.ui.components.GlassCard
import app.travelos.ui.components.NightBackground
import app.travelos.ui.components.StatusChip
import app.travelos.ui.components.glass
import app.travelos.ui.components.pressable
import app.travelos.ui.theme.Carnet
import java.time.LocalDate

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    container: AppContainer,
    onOpenCarnet: (String?) -> Unit,
    onOpenProgramme: () -> Unit,
    onOpenDay: (String) -> Unit,
    onOpenDiagnostic: () -> Unit,
    onSwitchProfile: () -> Unit,
) {
    val vm: HomeViewModel = viewModel(
        factory = viewModelFactory { initializer { HomeViewModel(container.repository, container.deviceStatus) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val seedError by container.seedError.collectAsStateWithLifecycle()

    NightBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 40.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 1100.dp).fillMaxWidth()) {
                Header(state, onSwitchProfile)
                Spacer(Modifier.height(20.dp))
                StatusRow(state)
                Spacer(Modifier.height(28.dp))

                if (seedError != null) {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Text("Le voyage n'a pas pu être chargé", style = MaterialTheme.typography.titleLarge, color = Carnet.Red)
                        Text(seedError.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                    }
                    Spacer(Modifier.height(20.dp))
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                    modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                ) {
                    NowCard(state, onOpenDay, Modifier.weight(1.6f))
                    ProgressCard(state, Modifier.weight(1f))
                }
                Spacer(Modifier.height(28.dp))
                Text("Raccourcis", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
                Spacer(Modifier.height(14.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    maxItemsInEachRow = 4,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    val tile = Modifier.weight(1f).height(170.dp)
                    Tile("書", "Carnet de route", "Le guide complet", Carnet.HkA, Carnet.HkB, tile) { onOpenCarnet(null) }
                    Tile("日", "Programme", "${state.dayCount} journées", Carnet.GzA, Carnet.GzB, tile, onClick = onOpenProgramme)
                    Tile("票", "Réservations", "Billets et néons", Carnet.MoA, Color(0xFFE8467C), tile) { onOpenCarnet("resas") }
                    Tile("話", "Phrases", "Cantonais, mandarin", Carnet.LiA, Carnet.LiB, tile) { onOpenCarnet("langue") }
                    Tile("圖", "Carte", "Phase 3", Color(0xFF3A3A3C), Color(0xFF636366), tile, enabled = false) {}
                    Tile("救", "SOS", "Urgences, adresses", Carnet.Red, Color(0xFFFF8A65), tile) { onOpenCarnet("sos") }
                    Tile("具", "Outils", "Devises, convertisseur", Carnet.SzA, Carnet.SzB, tile) { onOpenCarnet("outils") }
                    Tile("診", "Diagnostic", "Tablette et GPS", Color(0xFF5E5CE6), Color(0xFF0A84FF), tile, onClick = onOpenDiagnostic)
                }
            }
        }
    }
}

@Composable
private fun Header(state: HomeState, onSwitchProfile: () -> Unit) {
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Text(
                text = state.todayLabel.ifEmpty { " " },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = state.tripName.ifEmpty { "TravelOS" },
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(state.localTime, style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onBackground)
            Text(
                "Hong Kong · Paris ${state.parisTime}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.size(20.dp))
        Box(
            modifier = Modifier
                .size(56.dp)
                .glass(RoundedCornerShape(50))
                .pressable(onSwitchProfile),
            contentAlignment = Alignment.Center,
        ) {
            Text("港", fontSize = 24.sp, color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StatusRow(state: HomeState) {
    val d = state.device
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        StatusChip(
            text = if (state.loading) "Chargement du voyage…" else "Hors ligne prêt · ${state.dayCount} journées · ${state.placeCount} lieux",
            dot = if (state.loading) Carnet.Gold else Carnet.Green,
        )
        if (d != null) {
            val battery = if (d.batteryPercent >= 0) "${d.batteryPercent} %${if (d.charging) " en charge" else ""}" else "?"
            StatusChip("Batterie $battery", if (d.batteryPercent in 0..20) Carnet.Red else Carnet.Green)
            StatusChip(
                if (d.airplaneMode) "Mode avion" else d.network.label,
                if (d.network == NetworkState.NONE) Carnet.Muted else Carnet.SzB,
            )
            StatusChip(if (d.gpsEnabled) "GPS actif" else "GPS désactivé", if (d.gpsEnabled) Carnet.Green else Carnet.Red)
        }
    }
}

@Composable
private fun NowCard(state: HomeState, onOpenDay: (String) -> Unit, modifier: Modifier) {
    GlassCard(modifier.fillMaxHeight()) {
        when (val phase = state.phase) {
            is Phase.Before -> {
                Text("Départ dans", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("${phase.daysLeft}", fontSize = 84.sp, style = MaterialTheme.typography.displayLarge, color = MaterialTheme.colorScheme.onBackground)
                    Spacer(Modifier.size(12.dp))
                    Text(
                        if (phase.daysLeft > 1) "jours" else "jour",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 14.dp),
                    )
                }
                phase.firstDay?.let { day ->
                    Spacer(Modifier.height(8.dp))
                    DayLine("Première journée", day.date, day.city, day.title) { onOpenDay(day.id) }
                }
            }
            is Phase.During -> {
                Text(
                    "Jour ${phase.dayIndex + 1} · ${phase.day.city}",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(phase.day.title, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
                Spacer(Modifier.height(16.dp))
                val next = phase.next
                if (next != null) {
                    Text("Prochaine étape · ${next.time}", style = MaterialTheme.typography.labelLarge, color = Carnet.Red)
                    Text(next.text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground, maxLines = 4, overflow = TextOverflow.Ellipsis)
                } else {
                    Text("Toutes les étapes du jour sont faites.", style = MaterialTheme.typography.bodyLarge)
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    "Ouvrir la journée ›",
                    style = MaterialTheme.typography.labelLarge,
                    color = Carnet.Red,
                    modifier = Modifier.pressable({ onOpenDay(phase.day.id) }),
                )
            }
            Phase.After -> {
                Text("Le voyage est terminé", style = MaterialTheme.typography.headlineMedium)
                Text("Le journal et l'album restent disponibles dans le carnet.", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
private fun DayLine(label: String, date: String, city: String, title: String, onClick: () -> Unit) {
    val (a, b) = Carnet.tone(city)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White.copy(alpha = 0.06f))
            .pressable(onClick)
            .padding(14.dp),
    ) {
        Box(
            Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(a, b))),
        )
        Spacer(Modifier.size(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "$label · ${TripClock.shortDate(LocalDate.parse(date))} · $city",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text("›", fontSize = 28.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ProgressCard(state: HomeState, modifier: Modifier) {
    GlassCard(modifier.fillMaxHeight()) {
        Text("Progression", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${state.doneSteps}", style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onBackground)
            Text(
                " / ${state.totalSteps} étapes",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        val fraction = if (state.totalSteps > 0) state.doneSteps.toFloat() / state.totalSteps else 0f
        Box(
            Modifier
                .fillMaxWidth()
                .height(12.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Color.White.copy(alpha = 0.10f)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .height(12.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Brush.horizontalGradient(listOf(Carnet.SzA, Carnet.Red))),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Les étapes se cochent dans le programme, journée par journée.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Tile(
    glyph: String,
    title: String,
    subtitle: String,
    a: Color,
    b: Color,
    modifier: Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .glass(RoundedCornerShape(28.dp))
            .pressable(onClick, enabled)
            .padding(20.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Box(
            Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(listOf(a, b))),
            contentAlignment = Alignment.Center,
        ) {
            Text(glyph, fontSize = 28.sp, color = Color.White)
        }
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground.copy(alpha = if (enabled) 1f else 0.5f))
            Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
