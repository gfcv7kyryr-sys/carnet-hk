package app.travelos.ui.pilote

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelos.core.DeviceSnapshot
import app.travelos.core.DeviceStatus
import app.travelos.core.TripClock
import app.travelos.core.model.StepStatus
import app.travelos.data.TripRepository
import app.travelos.data.db.DayEntity
import app.travelos.data.db.StepEntity
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Ce que l'accueil affiche, recalculé toutes les 20 secondes. */
data class HomeState(
    val loading: Boolean = true,
    val tripName: String = "",
    val localTime: String = "--:--",
    val parisTime: String = "--:--",
    val todayLabel: String = "",
    val phase: Phase = Phase.Before(0, null),
    val doneSteps: Int = 0,
    val totalSteps: Int = 0,
    val dayCount: Int = 0,
    val placeCount: Int = 0,
    val device: DeviceSnapshot? = null,
)

sealed interface Phase {
    /** Avant le départ : compte à rebours et première journée. */
    data class Before(val daysLeft: Long, val firstDay: DayEntity?) : Phase

    /** Pendant le voyage : journée en cours et prochaine étape. */
    data class During(val day: DayEntity, val next: StepEntity?, val dayIndex: Int) : Phase

    data object After : Phase
}

class HomeViewModel(repository: TripRepository, private val deviceStatus: DeviceStatus) : ViewModel() {

    private val ticker = flow {
        while (true) {
            emit(Unit)
            delay(20_000)
        }
    }

    val state: StateFlow<HomeState> = combine(
        repository.trip,
        repository.days,
        repository.allSteps,
        repository.places,
        ticker,
    ) { trip, days, steps, places, _ ->
        if (trip == null) return@combine HomeState(loading = true, device = deviceStatus.snapshot())
        val zone = runCatching { ZoneId.of(trip.timeZone) }.getOrDefault(ZoneId.of("Asia/Hong_Kong"))
        val now = TripClock.now(zone)
        val today = now.toLocalDate()
        HomeState(
            loading = false,
            tripName = trip.name,
            localTime = TripClock.hm(now),
            parisTime = TripClock.hm(now.withZoneSameInstant(TripClock.PARIS)),
            todayLabel = TripClock.longDate(today),
            phase = phaseFor(LocalDate.parse(trip.startDate), LocalDate.parse(trip.endDate), today, now, days, steps),
            doneSteps = steps.count { StepStatus.from(it.status) == StepStatus.DONE },
            totalSteps = steps.size,
            dayCount = days.size,
            placeCount = places.size,
            device = deviceStatus.snapshot(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState())

    private fun phaseFor(
        start: LocalDate,
        end: LocalDate,
        today: LocalDate,
        now: ZonedDateTime,
        days: List<DayEntity>,
        steps: List<StepEntity>,
    ): Phase {
        if (today.isBefore(start)) return Phase.Before(TripClock.daysBetween(today, start), days.firstOrNull())
        if (today.isAfter(end)) return Phase.After
        val index = days.indexOfFirst { it.date == today.toString() }
        val day = days.getOrNull(index) ?: return Phase.Before(0, days.firstOrNull())
        val todaySteps = steps.filter { it.dayId == day.id && it.dayOffset == 0 }
        val open = todaySteps.filter {
            val s = StepStatus.from(it.status)
            s == StepStatus.PLANNED || s == StepStatus.IN_PROGRESS
        }
        val next = open.firstOrNull { step ->
            val t = TripClock.parseStepTime(step.time)
            t == null || !t.isBefore(now.toLocalTime().minusMinutes(30))
        } ?: open.firstOrNull()
        return Phase.During(day, next, index)
    }
}
