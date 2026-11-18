package app.travelos.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Ce qui se passe sur place, séparé du contenu du voyage (qui vient du paquet) :
 * une mise à jour du paquet ne touche jamais à ces données.
 */
@Entity(tableName = "step_state")
data class StepStateEntity(
    /** Clé stable de l'étape : « j3:4 » (journée, rang dans le programme). */
    @PrimaryKey val key: String,
    /** PLANNED, IN_PROGRESS, DONE ou SKIPPED. */
    val status: String,
    val updatedAt: Long,
)

/** Historique des lieux détectés (rempli à partir de la phase 4). */
@Entity(tableName = "detections", indices = [Index("placeId")])
data class DetectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val placeId: String,
    val timestamp: Long,
    val source: String,
)

/** Appelé depuis le pont JavaScript, qui tourne déjà hors du fil principal : requêtes synchrones. */
@Dao
interface StateDao {
    @Query("SELECT * FROM step_state")
    fun allSteps(): List<StepStateEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertStep(state: StepStateEntity)

    @Query("DELETE FROM step_state WHERE `key` = :key")
    fun deleteStep(key: String)

    @Query("SELECT COUNT(*) FROM step_state WHERE status = 'DONE'")
    fun doneCount(): Int

    @Insert
    fun insertDetection(detection: DetectionEntity)
}

@Database(entities = [StepStateEntity::class, DetectionEntity::class], version = 1, exportSchema = true)
abstract class StateDatabase : RoomDatabase() {
    abstract fun stateDao(): StateDao

    companion object {
        fun build(context: Context): StateDatabase =
            Room.databaseBuilder(context.applicationContext, StateDatabase::class.java, "travelos-state.db").build()
    }
}
