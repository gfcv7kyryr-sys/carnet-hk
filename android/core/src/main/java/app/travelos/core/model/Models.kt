package app.travelos.core.model

/** Profil choisi au démarrage. */
enum class Profile { PILOTE, CARNET }

/** État d'une étape du programme. */
enum class StepStatus(val label: String) {
    PLANNED("Prévue"),
    IN_PROGRESS("En cours"),
    DONE("Terminée"),
    SKIPPED("Ignorée");

    companion object {
        fun from(value: String): StepStatus = entries.firstOrNull { it.name == value } ?: PLANNED
    }
}
