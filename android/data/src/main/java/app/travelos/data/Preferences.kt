package app.travelos.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.travelos.core.model.Profile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "travelos_prefs")

/** Réglages persistants (DataStore). */
class Preferences(private val context: Context) {
    private val lastProfileKey = stringPreferencesKey("last_profile")
    private val glassKey = stringPreferencesKey("glass_level")

    val lastProfile: Flow<Profile?> = context.dataStore.data.map { prefs ->
        prefs[lastProfileKey]?.let { v -> Profile.entries.firstOrNull { it.name == v } }
    }

    /** « COMPLET », « LEGER » ou « MAT » ; utilisé à partir de la phase 7. */
    val glassLevel: Flow<String> = context.dataStore.data.map { it[glassKey] ?: "COMPLET" }

    suspend fun setLastProfile(profile: Profile) {
        context.dataStore.edit { it[lastProfileKey] = profile.name }
    }

    suspend fun setGlassLevel(level: String) {
        context.dataStore.edit { it[glassKey] = level }
    }
}
