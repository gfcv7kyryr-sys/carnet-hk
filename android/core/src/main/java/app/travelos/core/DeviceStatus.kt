package app.travelos.core

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import android.provider.Settings

/** Instantané de l'état de la tablette, lu à la demande (pas de surveillance continue). */
data class DeviceSnapshot(
    val batteryPercent: Int,
    val charging: Boolean,
    val network: NetworkState,
    val gpsEnabled: Boolean,
    val airplaneMode: Boolean,
)

enum class NetworkState(val label: String) {
    NONE("Sans réseau"),
    WIFI("Wi-Fi"),
    CELLULAR("Données mobiles"),
    OTHER("Réseau"),
}

/** Caractéristiques fixes de l'appareil, pour l'écran de diagnostic. */
data class DeviceInfo(
    val model: String,
    val manufacturer: String,
    val androidVersion: String,
    val sdkInt: Int,
    val totalRamGb: Double,
    val freeStorageGb: Double,
    val totalStorageGb: Double,
    val playServicesInstalled: Boolean,
    val gnssHardware: String,
)

class DeviceStatus(private val context: Context) {

    fun snapshot(): DeviceSnapshot {
        val battery = context.getSystemService(BatteryManager::class.java)
        val percent = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        val charging = battery?.isCharging ?: false
        val location = context.getSystemService(LocationManager::class.java)
        val gps = runCatching { location?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true }.getOrDefault(false)
        val airplane = Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
        return DeviceSnapshot(percent, charging, network(), gps, airplane)
    }

    private fun network(): NetworkState {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return NetworkState.NONE
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return NetworkState.NONE
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkState.WIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkState.CELLULAR
            else -> NetworkState.OTHER
        }
    }

    fun info(): DeviceInfo {
        val am = context.getSystemService(ActivityManager::class.java)
        val mem = ActivityManager.MemoryInfo().also { am?.getMemoryInfo(it) }
        val stat = StatFs(context.filesDir.absolutePath)
        val gb = 1024.0 * 1024.0 * 1024.0
        val location = context.getSystemService(LocationManager::class.java)
        val gnss = runCatching { location?.gnssHardwareModelName }.getOrNull() ?: "inconnu"
        return DeviceInfo(
            model = Build.MODEL,
            manufacturer = Build.MANUFACTURER,
            androidVersion = Build.VERSION.RELEASE,
            sdkInt = Build.VERSION.SDK_INT,
            totalRamGb = mem.totalMem / gb,
            freeStorageGb = stat.availableBytes / gb,
            totalStorageGb = stat.totalBytes / gb,
            playServicesInstalled = isInstalled("com.google.android.gms"),
            gnssHardware = gnss,
        )
    }

    private fun isInstalled(pkg: String): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(pkg, 0)
        }
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }
}
