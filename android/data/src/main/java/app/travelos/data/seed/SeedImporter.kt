package app.travelos.data.seed

import android.content.Context
import androidx.room.withTransaction
import app.travelos.data.db.DayEntity
import app.travelos.data.db.HotelEntity
import app.travelos.data.db.PhraseEntity
import app.travelos.data.db.PlaceEntity
import app.travelos.data.db.StepEntity
import app.travelos.data.db.TravelDatabase
import app.travelos.data.db.TripEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Charge le voyage de démonstration embarqué (assets/seed, généré depuis le carnet de route
 * par tools/extract-pack.mjs) lors du premier lancement.
 * En phase 6, il sera remplacé par l'import de paquets ZIP.
 */
class SeedImporter(private val context: Context, private val db: TravelDatabase) {

    suspend fun importIfEmpty(): Boolean = withContext(Dispatchers.IO) {
        val dao = db.tripDao()
        if (dao.tripCount() > 0) return@withContext false

        val tripJson = JSONObject(read("seed/trip.json"))
        val tripId = tripJson.getString("id")
        val trip = TripEntity(
            id = tripId,
            name = tripJson.getString("name"),
            country = tripJson.optString("country"),
            currency = tripJson.optString("currency", "HKD"),
            startDate = tripJson.getString("startDate"),
            endDate = tripJson.getString("endDate"),
            timeZone = tripJson.optString("timeZone", "Asia/Hong_Kong"),
        )

        val days = mutableListOf<DayEntity>()
        val steps = mutableListOf<StepEntity>()
        JSONArray(read("seed/days.json")).forEachObject { i, d ->
            val dayId = d.getString("id")
            days += DayEntity(
                id = dayId,
                tripId = tripId,
                date = d.getString("date"),
                city = d.optString("city"),
                cityZh = d.optString("cityZh"),
                title = d.optString("title"),
                lede = d.optString("lede"),
                orderIndex = d.optInt("order", i),
            )
            d.optJSONArray("steps")?.forEachObject { k, s ->
                steps += StepEntity(
                    dayId = dayId,
                    orderIndex = k,
                    time = s.optString("time"),
                    dayOffset = s.optInt("dayOffset", 0),
                    text = s.optString("text"),
                    placeId = if (s.isNull("placeId")) null else s.optString("placeId"),
                )
            }
        }

        val places = mutableListOf<PlaceEntity>()
        JSONArray(read("seed/places.json")).forEachObject { _, p ->
            places += PlaceEntity(
                id = p.getString("id"),
                tripId = tripId,
                name = p.optString("name"),
                nameZh = p.optString("nameZh"),
                lat = p.getDouble("lat"),
                lng = p.getDouble("lng"),
                lang = p.optString("lang"),
            )
        }

        val hotels = mutableListOf<HotelEntity>()
        JSONArray(read("seed/hotels.json")).forEachObject { _, h ->
            hotels += HotelEntity(
                tripId = tripId,
                date = h.optString("date"),
                name = h.optString("name"),
                nameZh = h.optString("nameZh"),
                addressZh = h.optString("addressZh"),
                phone = h.optString("phone"),
                lang = h.optString("lang"),
            )
        }

        val phrases = mutableListOf<PhraseEntity>()
        JSONArray(read("seed/phrases.json")).forEachObject { i, p ->
            phrases += PhraseEntity(
                tripId = tripId,
                orderIndex = i,
                fr = p.optString("fr"),
                zhHans = p.optString("zhHans"),
                pinyin = p.optString("pinyin"),
                zhHant = p.optString("zhHant"),
                jyutping = p.optString("jyutping"),
            )
        }

        db.withTransaction {
            dao.insertTrip(trip)
            dao.insertDays(days)
            dao.insertSteps(steps)
            dao.insertPlaces(places)
            dao.insertHotels(hotels)
            dao.insertPhrases(phrases)
        }
        true
    }

    private fun read(path: String): String =
        context.assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }

    private inline fun JSONArray.forEachObject(block: (Int, JSONObject) -> Unit) {
        for (i in 0 until length()) block(i, getJSONObject(i))
    }
}
