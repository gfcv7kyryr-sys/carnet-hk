package app.travelos

import android.content.Context
import android.content.pm.PackageManager

object BuildConfigInfo {
    fun versionName(context: Context): String = try {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        "${info.versionName} (${info.longVersionCode})"
    } catch (e: Exception) {
        "?"
    }
}
