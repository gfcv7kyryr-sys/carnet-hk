package app.travelos.ui.programme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.travelos.core.TripClock
import app.travelos.core.model.StepStatus
import app.travelos.data.TripRepository
import app.travelos.data.db.StepEntity
import app.travelos.ui.components.NightBackground
import app.travelos.ui.components.glass
import app.travelos.ui.components.pressable
import app.travelos.ui.theme.Carnet
import kotlinx.coroutines.launch
import java.time.LocalDate

@Composable
fun ProgrammeScreen(repository: TripRepository, onOpenDay: (String) -> Unit, onBack: () -> Unit) {
    val days by repository.days.collectAsState(initial = emptyList())
    val steps by repository.allSteps.collectAsState(initial = emptyList())

    NightBackground {
        Column(Modifier.fillMaxSize().safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            TopBar("Programme", onBack)
            LazyColumn(
                modifier = Modifier.widthIn(max = 960.dp).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 32.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                itemsIndexed(days, key = { _, d -> d.id }) { i, day ->
                    val daySteps = steps.filter { it.dayId == day.id }
                    val done = daySteps.count { StepStatus.from(it.status) == StepStatus.DONE }
                    val (a, b) = Carnet.tone(day.city)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .glass(RoundedCornerShape(26.dp))
                            .pressable({ onOpenDay(day.id) })
                            .padding(18.dp),
                    ) {
                        Box(
                            Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)).background(Brush.linearGradient(listOf(a, b))),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(day.cityZh.take(1), fontSize = 34.sp, color = Color.White)
                        }
                        Spacer(Modifier.width(18.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Jour ${i + 1} · ${TripClock.shortDate(LocalDate.parse(day.date))} · ${day.city}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(day.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        Text(
                            "$done/${daySteps.size}",
                            style = MaterialTheme.typography.labelLarge,
                            color = if (done == daySteps.size && daySteps.isNotEmpty()) Carnet.Green else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun DayScreen(
    repository: TripRepository,
    dayId: String,
    onOpenInCarnet: (String) -> Unit,
    onBack: () -> Unit,
) {
    val dayFlow = remember(dayId) { repository.day(dayId) }
    val stepsFlow = remember(dayId) { repository.steps(dayId) }
    val day by dayFlow.collectAsState(initial = null)
    val steps by stepsFlow.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val (a, b) = Carnet.tone(day?.city.orEmpty())

    NightBackground(a, b) {
        Column(Modifier.fillMaxSize().safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            TopBar(day?.city.orEmpty(), onBack)
            LazyColumn(
                modifier = Modifier.widthIn(max = 960.dp).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 32.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    val d = day ?: return@item
                    Column(Modifier.padding(bottom = 12.dp)) {
                        Text(TripClock.longDate(LocalDate.parse(d.date)), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(d.title, style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onBackground)
                        Spacer(Modifier.height(10.dp))
                        Text(d.lede, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                itemsIndexed(steps, key = { _, s -> s.id }) { _, step ->
                    StepRow(
                        step = step,
                        onStatus = { status -> scope.launch { repository.setStatus(step.id, status) } },
                        onOpen = step.placeId?.let { pid -> { onOpenInCarnet("lieu-$pid") } },
                    )
                }
            }
        }
    }
}

@Composable
private fun StepRow(step: StepEntity, onStatus: (StepStatus) -> Unit, onOpen: (() -> Unit)?) {
    val status = StepStatus.from(step.status)
    val dim = status == StepStatus.DONE || status == StepStatus.SKIPPED
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .glass(RoundedCornerShape(24.dp))
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.width(86.dp)) {
                Text(step.time, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = if (dim) Carnet.Muted else MaterialTheme.colorScheme.onBackground)
                if (step.dayOffset != 0) {
                    Text(if (step.dayOffset < 0) "la veille" else "lendemain", style = MaterialTheme.typography.labelMedium, color = Carnet.Muted)
                }
            }
            Text(
                step.text,
                style = MaterialTheme.typography.bodyLarge,
                color = if (dim) Carnet.Muted else MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(start = 86.dp)) {
            StatusPill("Terminée", status == StepStatus.DONE, Carnet.Green) {
                onStatus(if (status == StepStatus.DONE) StepStatus.PLANNED else StepStatus.DONE)
            }
            StatusPill("Ignorer", status == StepStatus.SKIPPED, Carnet.Muted) {
                onStatus(if (status == StepStatus.SKIPPED) StepStatus.PLANNED else StepStatus.SKIPPED)
            }
            if (onOpen != null) {
                StatusPill("Fiche du lieu ›", false, Carnet.Red, onOpen)
            }
        }
    }
}

@Composable
private fun StatusPill(text: String, active: Boolean, color: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (active) color.copy(alpha = 0.30f) else Color.White.copy(alpha = 0.08f))
            .pressable(onClick)
            .padding(horizontal = 16.dp, vertical = 9.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (active) Color.White else color)
    }
}

@Composable
fun TopBar(title: String, onBack: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.widthIn(max = 960.dp).fillMaxWidth().padding(horizontal = 32.dp, vertical = 16.dp),
    ) {
        Box(
            Modifier.size(52.dp).glass(RoundedCornerShape(50)).pressable(onBack),
            contentAlignment = Alignment.Center,
        ) {
            Text("‹", fontSize = 30.sp, color = MaterialTheme.colorScheme.onBackground)
        }
        Spacer(Modifier.width(16.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
    }
}
