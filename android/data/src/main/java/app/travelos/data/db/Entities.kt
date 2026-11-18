package app.travelos.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "trips")
data class TripEntity(
    @PrimaryKey val id: String,
    val name: String,
    val country: String,
    val currency: String,
    val startDate: String,
    val endDate: String,
    val timeZone: String,
)

@Entity(tableName = "days", indices = [Index("tripId")])
data class DayEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    val date: String,
    val city: String,
    val cityZh: String,
    val title: String,
    val lede: String,
    val orderIndex: Int,
)

@Entity(tableName = "steps", indices = [Index("dayId")])
data class StepEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val dayId: String,
    val orderIndex: Int,
    val time: String,
    /** Décalage en jours par rapport à la date de la journée (ex. -1 pour le départ la veille). */
    val dayOffset: Int,
    val text: String,
    val placeId: String?,
    /** Valeur de [app.travelos.core.model.StepStatus]. */
    val status: String = "PLANNED",
    /** Étape ajoutée sur place (conservée lors des mises à jour de contenu). */
    val custom: Boolean = false,
)

@Entity(tableName = "places", indices = [Index("tripId")])
data class PlaceEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    val name: String,
    val nameZh: String,
    /** Coordonnées WGS-84 (celles du GPS), jamais GCJ-02. */
    val lat: Double,
    val lng: Double,
    val lang: String,
    val radiusM: Int = 175,
)

@Entity(tableName = "hotels", indices = [Index("tripId")])
data class HotelEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tripId: String,
    val date: String,
    val name: String,
    val nameZh: String,
    val addressZh: String,
    val phone: String,
    val lang: String,
)

@Entity(tableName = "phrases", indices = [Index("tripId")])
data class PhraseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tripId: String,
    val orderIndex: Int,
    val fr: String,
    val zhHans: String,
    val pinyin: String,
    val zhHant: String,
    val jyutping: String,
)

/** Historique des lieux détectés (utilisé à partir de la phase 4). */
@Entity(tableName = "detections", indices = [Index("placeId")])
data class DetectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val placeId: String,
    val timestamp: Long,
    val source: String,
)

/** Nombre de lignes par table, pour l'écran de diagnostic. */
data class DbCounts(
    val trips: Int,
    val days: Int,
    val steps: Int,
    val places: Int,
    val hotels: Int,
    val phrases: Int,
)
