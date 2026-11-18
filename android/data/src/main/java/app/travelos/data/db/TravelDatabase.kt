package app.travelos.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        TripEntity::class,
        DayEntity::class,
        StepEntity::class,
        PlaceEntity::class,
        HotelEntity::class,
        PhraseEntity::class,
        DetectionEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class TravelDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao

    companion object {
        fun build(context: Context): TravelDatabase =
            Room.databaseBuilder(context.applicationContext, TravelDatabase::class.java, "travelos.db")
                .build()
    }
}
