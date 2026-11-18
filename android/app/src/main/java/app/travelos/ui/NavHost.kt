package app.travelos.ui

import android.net.Uri
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.travelos.AppContainer
import app.travelos.core.model.Profile
import app.travelos.ui.chooser.ProfileChooserScreen
import app.travelos.ui.diagnostic.DiagnosticScreen
import app.travelos.ui.kids.KidsScreen
import app.travelos.ui.pilote.HomeScreen
import app.travelos.ui.programme.DayScreen
import app.travelos.ui.programme.ProgrammeScreen
import app.travelos.ui.web.LocalWebScreen
import kotlinx.coroutines.launch

object Routes {
    const val CHOOSER = "chooser"
    const val HOME = "home"
    const val PROGRAMME = "programme"
    const val DAY = "day/{dayId}"
    const val CARNET = "carnet?hash={hash}"
    const val KIDS = "kids"
    const val DIAGNOSTIC = "diagnostic"

    fun day(id: String) = "day/$id"
    fun carnet(hash: String? = null) = if (hash.isNullOrBlank()) "carnet" else "carnet?hash=${Uri.encode(hash)}"
}

@Composable
fun TravelOsNavHost(container: AppContainer) {
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()

    NavHost(
        navController = nav,
        startDestination = Routes.CHOOSER,
        enterTransition = { fadeIn(tween(320)) + scaleIn(tween(320), initialScale = 0.97f) },
        exitTransition = { fadeOut(tween(200)) },
        popEnterTransition = { fadeIn(tween(260)) },
        popExitTransition = { fadeOut(tween(200)) },
    ) {
        composable(Routes.CHOOSER) {
            ProfileChooserScreen(
                preferences = container.preferences,
                onChoose = { profile ->
                    scope.launch { container.preferences.setLastProfile(profile) }
                    nav.navigate(if (profile == Profile.PILOTE) Routes.HOME else Routes.KIDS) {
                        popUpTo(Routes.CHOOSER) { inclusive = false }
                    }
                },
            )
        }
        composable(Routes.HOME) {
            HomeScreen(
                container = container,
                onOpenCarnet = { hash -> nav.navigate(Routes.carnet(hash)) },
                onOpenProgramme = { nav.navigate(Routes.PROGRAMME) },
                onOpenDay = { id -> nav.navigate(Routes.day(id)) },
                onOpenDiagnostic = { nav.navigate(Routes.DIAGNOSTIC) },
                onSwitchProfile = { nav.popBackStack(Routes.CHOOSER, inclusive = false) },
            )
        }
        composable(Routes.PROGRAMME) {
            ProgrammeScreen(
                repository = container.repository,
                onOpenDay = { id -> nav.navigate(Routes.day(id)) },
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            Routes.DAY,
            arguments = listOf(navArgument("dayId") { type = NavType.StringType }),
        ) { entry ->
            DayScreen(
                repository = container.repository,
                dayId = entry.arguments?.getString("dayId").orEmpty(),
                onOpenInCarnet = { hash -> nav.navigate(Routes.carnet(hash)) },
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            Routes.CARNET,
            arguments = listOf(
                navArgument("hash") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { entry ->
            LocalWebScreen(
                entryPath = "carnet/index.html",
                hash = entry.arguments?.getString("hash"),
                onExit = { nav.popBackStack() },
            )
        }
        composable(Routes.KIDS) {
            KidsScreen(onExit = { nav.popBackStack(Routes.CHOOSER, inclusive = false) })
        }
        composable(Routes.DIAGNOSTIC) {
            DiagnosticScreen(container = container, onBack = { nav.popBackStack() })
        }
    }
}
