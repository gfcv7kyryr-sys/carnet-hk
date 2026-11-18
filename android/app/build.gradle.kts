plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
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
        versionName = "0.4.$runNumber"
        // La tablette (MediaTek Dimensity 6300) est en 64 bits ARM : on n'embarque que cette
        // architecture pour les bibliothèques natives du traducteur, ce qui divise la taille de l'APK.
        ndk { abiFilters += "arm64-v8a" }
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

    androidResources {
        // Les médias sont déjà compressés : on les stocke tels quels dans l'APK.
        noCompress += listOf("mp3", "m4a", "webp", "jpg", "png", "pdf")
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation(project(":data"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.mlkit.translate)
}
