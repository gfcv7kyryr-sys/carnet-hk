import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Numéro de version : numéro d'exécution GitHub Actions, pour que chaque APK
// s'installe par-dessus la précédente.
val runNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "app.travelos"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.travelos"
        minSdk = 30
        targetSdk = 35
        versionCode = runNumber
        versionName = "0.1.$runNumber"
    }

    signingConfigs {
        // Clé de prototype, versionnée pour que les mises à jour s'installent sans
        // désinstaller. Elle sera remplacée par une clé privée (secret GitHub) en phase 7.
        create("travelosDev") {
            storeFile = rootProject.file("keystore/travelos-dev.jks")
            storePassword = "travelos-dev"
            keyAlias = "travelos"
            keyPassword = "travelos-dev"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("travelosDev")
        }
        debug {
            signingConfig = signingConfigs.getByName("travelosDev")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }

    androidResources {
        // Les médias sont déjà compressés : on les stocke tels quels dans l'APK.
        noCompress += listOf("mp3", "m4a", "webp", "jpg", "png", "pdf")
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

/**
 * Copie le carnet de route (index.html, images, audios) du dépôt dans les assets de l'APK,
 * sous assets/carnet/. Temporaire : en phase 6 le contenu arrivera par paquet ZIP.
 */
abstract class CopyCarnetTask : DefaultTask() {
    @get:Inject
    abstract val fs: FileSystemOperations

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val carnetFiles: ConfigurableFileCollection

    @get:Internal
    abstract val carnetRoot: DirectoryProperty

    @get:Input
    abstract val includes: ListProperty<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val root = carnetRoot.get().asFile
        val patterns = includes.get()
        val target = outputDir.get().dir("carnet").asFile
        fs.sync {
            from(root) { include(patterns) }
            into(target)
        }
    }
}

val carnetIncludes = listOf("index.html", "img/**", "audio/**", "vendor/**", "icon-*.png")
val carnetDir = rootProject.layout.projectDirectory.dir("..")
val copyCarnet = tasks.register<CopyCarnetTask>("copyCarnetAssets") {
    carnetRoot.set(carnetDir)
    includes.set(carnetIncludes)
    carnetFiles.from(fileTree(carnetDir) { include(carnetIncludes) })
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyCarnet, CopyCarnetTask::outputDir)
    }
}

dependencies {
    implementation(project(":data"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.androidx.webkit)
}
