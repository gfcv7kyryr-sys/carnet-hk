package app.travelos.core

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/** Calculs de date et d'heure du voyage, dans le fuseau du voyage. */
object TripClock {
    val PARIS: ZoneId = ZoneId.of("Europe/Paris")
    private val HM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE)
    private val LONG_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.FRANCE)
    private val SHORT_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM", Locale.FRANCE)

    fun now(zone: ZoneId): ZonedDateTime = ZonedDateTime.now(zone)

    fun hm(t: ZonedDateTime): String = t.format(HM)

    fun longDate(d: LocalDate): String = d.format(LONG_DATE).replaceFirstChar { it.titlecase(Locale.FRANCE) }

    fun shortDate(d: LocalDate): String = d.format(SHORT_DATE).replaceFirstChar { it.titlecase(Locale.FRANCE) }

    fun daysBetween(from: LocalDate, to: LocalDate): Long = ChronoUnit.DAYS.between(from, to)

    /** « 9:40 » ou « 21:05 » → LocalTime, ou null si le format est inattendu. */
    fun parseStepTime(raw: String): LocalTime? {
        val parts = raw.trim().split(":")
        if (parts.size != 2) return null
        val h = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        return LocalTime.of(h, m)
    }
}
