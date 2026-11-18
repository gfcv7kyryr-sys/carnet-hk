package app.travelos.ui.kids

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.travelos.ui.web.LocalWebScreen

/**
 * Profil Carnet (Charlie). Pour en sortir, un appui long sur le dragon en haut à gauche :
 * un toucher simple ne fait rien, pour éviter les sorties par accident.
 * Le geste « retour » d'Android est neutralisé.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun KidsScreen(onExit: () -> Unit) {
    BackHandler { /* neutralisé dans le profil enfant */ }
    Box(Modifier.fillMaxSize().background(Color(0xFFFBF6EC))) {
        LocalWebScreen(entryPath = "kids/index.html", hash = null, onExit = {})
        Box(
            modifier = Modifier
                .safeDrawingPadding()
                .padding(16.dp)
                .size(56.dp)
                .clip(CircleShape)
                .background(Color(0x332B2420))
                .combinedClickable(onClick = {}, onLongClick = onExit)
                .align(Alignment.TopStart),
            contentAlignment = Alignment.Center,
        ) {
            Text("龍", fontSize = 26.sp, color = Color(0xFF2B2420))
        }
    }
}
