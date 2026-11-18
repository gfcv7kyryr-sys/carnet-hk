package app.travelos.data

import app.travelos.core.model.StepStatus
import app.travelos.data.db.DayEntity
import app.travelos.data.db.DbCounts
import app.travelos.data.db.PlaceEntity
import app.travelos.data.db.StepEntity
import app.travelos.data.db.TravelDatabase
import app.travelos.data.db.TripEntity
import kotlinx.coroutines.flow.Flow

/** Point d'accès unique aux données du voyage pour l'interface. */
class TripRepository(private val db: TravelDatabase) {
    private val dao = db.tripDao()

    val trip: Flow<TripEntity?> = dao.observeTrip()
    val days: Flow<List<DayEntity>> = dao.observeDays()
    val allSteps: Flow<List<StepEntity>> = dao.observeAllSteps()
    val places: Flow<List<PlaceEntity>> = dao.observePlaces()
    val counts: Flow<DbCounts> = dao.observeCounts()

    fun day(id: String): Flow<DayEntity?> = dao.observeDay(id)
    fun steps(dayId: String): Flow<List<StepEntity>> = dao.observeSteps(dayId)

    suspend fun setStatus(stepId: Long, status: StepStatus) = dao.setStepStatus(stepId, status.name)
}
