package app.travelos.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TripDao {

    @Query("SELECT * FROM trips ORDER BY startDate LIMIT 1")
    fun observeTrip(): Flow<TripEntity?>

    @Query("SELECT COUNT(*) FROM trips")
    suspend fun tripCount(): Int

    @Query("SELECT * FROM days ORDER BY date, orderIndex")
    fun observeDays(): Flow<List<DayEntity>>

    @Query("SELECT * FROM days WHERE id = :id")
    fun observeDay(id: String): Flow<DayEntity?>

    @Query("SELECT * FROM steps WHERE dayId = :dayId ORDER BY orderIndex")
    fun observeSteps(dayId: String): Flow<List<StepEntity>>

    @Query("SELECT * FROM steps ORDER BY dayId, orderIndex")
    fun observeAllSteps(): Flow<List<StepEntity>>

    @Query("UPDATE steps SET status = :status WHERE id = :id")
    suspend fun setStepStatus(id: Long, status: String)

    @Query("SELECT * FROM places ORDER BY name")
    fun observePlaces(): Flow<List<PlaceEntity>>

    @Query(
        "SELECT (SELECT COUNT(*) FROM trips) AS trips, (SELECT COUNT(*) FROM days) AS days, " +
            "(SELECT COUNT(*) FROM steps) AS steps, (SELECT COUNT(*) FROM places) AS places, " +
            "(SELECT COUNT(*) FROM hotels) AS hotels, (SELECT COUNT(*) FROM phrases) AS phrases"
    )
    fun observeCounts(): Flow<DbCounts>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTrip(trip: TripEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDays(days: List<DayEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSteps(steps: List<StepEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaces(places: List<PlaceEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertHotels(hotels: List<HotelEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPhrases(phrases: List<PhraseEntity>)
}
