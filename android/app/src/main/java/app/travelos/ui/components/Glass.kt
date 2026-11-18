package app.travelos.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.travelos.ui.theme.Carnet

/**
 * Verre liquide, niveau 1 (voir cahier des charges) : remplissage translucide,
 * bord spéculaire en dégradé, reflet doux en haut et ombre diffuse.
 * Le flou réel de l'arrière-plan est géré dans l'interface HTML du carnet.
 */
fun Modifier.glass(shape: Shape = RoundedCornerShape(28.dp), tint: Color = Color.White): Modifier = this
    .shadow(elevation = 18.dp, shape = shape, ambientColor = Color.Black, spotColor = Color.Black)
    .clip(shape)
    .background(
        Brush.verticalGradient(
            listOf(tint.copy(alpha = 0.16f), tint.copy(alpha = 0.07f)),
        ),
    )
    .drawBehind {
        drawRect(
            Brush.radialGradient(
                colors = listOf(Color.White.copy(alpha = 0.14f), Color.Transparent),
                center = Offset(size.width * 0.3f, -size.height * 0.1f),
                radius = size.maxDimension * 0.7f,
            ),
        )
    }
    .border(
        width = 1.dp,
        brush = Brush.linearGradient(
            colors = listOf(
                Color.White.copy(alpha = 0.55f),
                Color.White.copy(alpha = 0.05f),
                Color.White.copy(alpha = 0.05f),
                Color.White.copy(alpha = 0.20f),
            ),
        ),
        shape = shape,
    )

/** Effet de pression façon iOS : léger rétrécissement avec un ressort. */
@Composable
fun Modifier.pressable(onClick: () -> Unit, enabled: Boolean = true): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.55f, stiffness = 500f),
        label = "press",
    )
    return this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(interactionSource = source, indication = null, enabled = enabled, onClick = onClick)
}

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    corner: Dp = 28.dp,
    padding: Dp = 24.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .glass(RoundedCornerShape(corner))
            .padding(padding),
        content = content,
    )
}

/** Fond nocturne aux tons de Hong Kong, avec halos de néon. */
@Composable
fun NightBackground(
    a: Color = Carnet.HkA,
    b: Color = Carnet.HkB,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Carnet.Night)
            .drawBehind {
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(a.copy(alpha = 0.55f), Color.Transparent),
                        center = Offset(size.width * 0.15f, size.height * 0.05f),
                        radius = size.maxDimension * 0.6f,
                    ),
                )
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(b.copy(alpha = 0.45f), Color.Transparent),
                        center = Offset(size.width * 0.9f, size.height * 0.95f),
                        radius = size.maxDimension * 0.55f,
                    ),
                )
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(Carnet.Gold.copy(alpha = 0.12f), Color.Transparent),
                        center = Offset(size.width * 0.75f, size.height * 0.15f),
                        radius = size.maxDimension * 0.35f,
                    ),
                )
            },
        content = content,
    )
}

/** Petite pastille d'état (batterie, réseau, GPS). */
@Composable
fun StatusChip(text: String, dot: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .glass(RoundedCornerShape(50))
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.width(8.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}
