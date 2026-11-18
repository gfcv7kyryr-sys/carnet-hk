package app.travelos.ui.chooser

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.travelos.core.model.Profile
import app.travelos.data.Preferences
import app.travelos.ui.components.NightBackground
import app.travelos.ui.components.glass
import app.travelos.ui.components.pressable
import app.travelos.ui.theme.Carnet

/** Écran « Qui voyage ? », façon choix de profil Apple TV. */
@Composable
fun ProfileChooserScreen(preferences: Preferences, onChoose: (Profile) -> Unit) {
    val last by preferences.lastProfile.collectAsState(initial = null)

    NightBackground {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "TravelOS",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Qui voyage ?",
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(56.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(72.dp)) {
                Avatar(
                    glyph = "港",
                    name = "Pilote",
                    hint = "Guide, carte, billets",
                    colors = listOf(Carnet.HkA, Carnet.HkB),
                    highlighted = last == Profile.PILOTE,
                    onClick = { onChoose(Profile.PILOTE) },
                )
                Avatar(
                    glyph = "龍",
                    name = "Carnet",
                    hint = "Le carnet de Charlie",
                    colors = listOf(Carnet.GzA, Carnet.Gold),
                    highlighted = last == Profile.CARNET,
                    onClick = { onChoose(Profile.CARNET) },
                )
            }
        }
    }
}

@Composable
private fun Avatar(
    glyph: String,
    name: String,
    hint: String,
    colors: List<Color>,
    highlighted: Boolean,
    onClick: () -> Unit,
) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val glow by pulse.animateFloat(
        initialValue = 0.85f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "glow",
    )
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.pressable(onClick),
    ) {
        Box(
            modifier = Modifier
                .size(220.dp)
                .graphicsLayer { if (highlighted) { scaleX = glow * 1.02f; scaleY = glow * 1.02f } }
                .glass(CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(176.dp)
                    .clip(CircleShape)
                    .background(Brush.linearGradient(colors)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = glyph,
                    color = Color.White,
                    fontSize = 96.sp,
                    fontWeight = FontWeight.Light,
                )
            }
        }
        Spacer(Modifier.height(22.dp))
        Text(name, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(4.dp))
        Text(
            hint,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(220.dp),
        )
    }
}
