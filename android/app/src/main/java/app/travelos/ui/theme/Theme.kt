package app.travelos.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** Couleurs reprises du carnet de route (variables CSS --ink, --red, tons par ville). */
object Carnet {
    val Ink = Color(0xFFF5F5F7)
    val Muted = Color(0xFFA1A1A6)
    val Red = Color(0xFFFF453A)
    val RedLight = Color(0xFFE3262B)
    val Green = Color(0xFF32D27A)
    val Gold = Color(0xFFFFB340)

    val HkA = Color(0xFF2340B8)
    val HkB = Color(0xFFE0338A)
    val MoA = Color(0xFFE08A00)
    val SzA = Color(0xFF0A6CF0)
    val SzB = Color(0xFF1EC8C0)
    val GzA = Color(0xFFE3262B)
    val GzB = Color(0xFFF28C28)
    val LiA = Color(0xFF0B9466)
    val LiB = Color(0xFF1BAFD0)

    val Night = Color(0xFF05070F)

    /** Ton de la ville, comme data-tone dans le carnet. */
    fun tone(city: String): Pair<Color, Color> = when {
        city.contains("Macao", true) -> MoA to Color(0xFFE8467C)
        city.contains("Shenzhen", true) -> SzA to SzB
        city.contains("Canton", true) -> GzA to GzB
        city.contains("Xingping", true) || city.contains("Huangyao", true) -> LiA to LiB
        else -> HkA to HkB
    }
}

private val Scheme = darkColorScheme(
    primary = Carnet.Red,
    onPrimary = Color.White,
    background = Carnet.Night,
    onBackground = Carnet.Ink,
    surface = Color(0xFF1C1C1E),
    onSurface = Carnet.Ink,
    onSurfaceVariant = Carnet.Muted,
)

private val Display = TextStyle(fontWeight = FontWeight.Bold, letterSpacing = (-0.035).em)

private val Type = Typography(
    displayLarge = Display.copy(fontSize = 64.sp, lineHeight = 66.sp),
    displayMedium = Display.copy(fontSize = 44.sp, lineHeight = 48.sp),
    headlineMedium = Display.copy(fontSize = 30.sp, lineHeight = 34.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 22.sp, letterSpacing = (-0.02).em),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 18.sp, letterSpacing = (-0.01).em),
    bodyLarge = TextStyle(fontSize = 18.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
)

@Composable
fun TravelOsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = Type, content = content)
}
