package app.travelos

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/**
 * Fond de carte de la Carte du jour : tuiles vectorielles OpenStreetMap (OpenFreeMap, sans compte ni clé)
 * et polices des libellés, servies à la page sous /osm/ et gardées sur la tablette.
 *
 *   /osm/t/{z}/{x}/{y}.pbf          tuile vectorielle (schéma OpenMapTiles, niveaux 0 à 14)
 *   /osm/fonts/{police}/{plage}.pbf  glyphes des libellés
 *
 * Une tuile déjà vue ou téléchargée se lit sur la tablette, sans réseau. downloadDays() remplit la
 * mémoire pour les journées du voyage, à faire en Wi-Fi avant le départ.
 */
class OsmTiles private constructor(ctx: Context) : WebViewAssetLoader.PathHandler {
    private val dir = File(ctx.filesDir, "osm").apply { mkdirs() }
    private val tileJsonFile = File(dir, "tiles.json")

    override fun handle(path: String): WebResourceResponse? {
        val bytes = try {
            when {
                path.startsWith("t/") -> tile(path.removePrefix("t/").removeSuffix(".pbf"))
                path.startsWith("fonts/") -> font(path.removePrefix("fonts/"))
                else -> null
            }
        } catch (_: Exception) { null }
        // Sans tuile (hors ligne, pas encore gardée) : réponse vide, la carte affiche le fond uni.
        return if (bytes == null) WebResourceResponse("application/x-protobuf", null, 204, "No Content", HEADERS, ByteArrayInputStream(ByteArray(0)))
        else WebResourceResponse("application/x-protobuf", null, 200, "OK", HEADERS, ByteArrayInputStream(bytes))
    }

    /** z/x/y → octets de la tuile, depuis la mémoire ou le réseau. */
    fun tile(zxy: String): ByteArray? {
        val parts = zxy.split("/")
        if (parts.size != 3 || parts.any { it.toIntOrNull() == null }) return null
        val f = File(dir, "t/$zxy.pbf")
        if (f.exists()) return f.readBytes()
        val template = template() ?: return null
        val b = fetch(template.replace("{z}", parts[0]).replace("{x}", parts[1]).replace("{y}", parts[2])) ?: return null
        save(f, b)
        return b
    }

    private fun font(rel: String): ByteArray? {
        if (rel.contains("..")) return null
        val f = File(dir, "fonts/" + rel.replace("%20", " "))
        if (f.exists()) return f.readBytes()
        val b = fetch("$BASE/fonts/$rel") ?: return null
        save(f, b)
        return b
    }

    /** Adresse des tuiles du jour (OpenFreeMap publie une nouvelle version chaque semaine). */
    @Synchronized private fun template(): String? {
        val fresh = tileJsonFile.exists() && System.currentTimeMillis() - tileJsonFile.lastModified() < 3L * 86_400_000
        if (!fresh) fetch("$BASE/planet")?.let { save(tileJsonFile, it) }
        if (!tileJsonFile.exists()) return null
        return try { JSONObject(tileJsonFile.readText()).getJSONArray("tiles").getString(0) } catch (_: Exception) { null }
    }

    private fun fetch(url: String): ByteArray? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 15000
        c.setRequestProperty("User-Agent", "TravelOS/0.11 (carnet de voyage familial)")
        if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null
    } catch (_: Exception) { null }

    private fun save(f: File, b: ByteArray) {
        f.parentFile?.mkdirs()
        val tmp = File(f.path + ".part")
        tmp.writeBytes(b); tmp.renameTo(f)
    }

    /**
     * Garde sur la tablette le fond de carte autour de chaque journée (niveaux 10 à 14 ; au-delà, la carte
     * agrandit les tuiles du niveau 14) et les polices des libellés. regions : [{id,name,s,w,n,e}].
     */
    fun downloadDays(regions: String, report: (String, Int, Int) -> Unit) = Thread {
        val list = try { JSONArray(regions) } catch (_: Exception) { return@Thread }
        for (stack in listOf("Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"))
            for (range in listOf("0-255", "256-511", "8192-8447")) font("${stack.replace(" ", "%20")}/$range.pbf")
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            val name = o.optString("name")
            val pad = 0.012
            val tiles = ArrayList<String>()
            for (z in 10..14) {
                val x0 = lon2x(o.getDouble("w") - pad, z); val x1 = lon2x(o.getDouble("e") + pad, z)
                val y0 = lat2y(o.getDouble("n") + pad, z); val y1 = lat2y(o.getDouble("s") - pad, z)
                for (x in x0..x1) for (y in y0..y1) tiles.add("$z/$x/$y")
            }
            var done = 0; var failed = 0
            for (t in tiles) {
                if (tile(t) == null) failed++
                done++
                if (done % 20 == 0 || done == tiles.size) report(name, if (done == tiles.size) (if (failed > tiles.size / 10) -1 else 2) else 1, done * 100 / tiles.size)
            }
        }
    }.start()

    private fun lon2x(lon: Double, z: Int) = floor((lon + 180.0) / 360.0 * (1 shl z)).toInt()
    private fun lat2y(lat: Double, z: Int): Int {
        val r = Math.toRadians(lat)
        return floor((1 - ln(tan(r) + 1 / cos(r)) / Math.PI) / 2 * (1 shl z)).toInt()
    }

    fun stats(): JSONObject {
        val t = File(dir, "t"); var n = 0; var bytes = 0L
        t.walkTopDown().filter { it.isFile && it.name.endsWith(".pbf") }.forEach { n++; bytes += it.length() }
        return JSONObject().put("tiles", n).put("bytes", bytes)
    }

    companion object {
        private const val BASE = "https://tiles.openfreemap.org"
        private val HEADERS = mapOf("Cache-Control" to "no-cache", "Access-Control-Allow-Origin" to "*")
        @Volatile private var inst: OsmTiles? = null
        fun get(ctx: Context): OsmTiles = inst ?: synchronized(this) { inst ?: OsmTiles(ctx.applicationContext).also { inst = it } }
    }
}
