package app.travelos.data.pack

import android.content.Context
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** État de la synchronisation, lu par l'interface. */
data class SyncState(
    val running: Boolean = false,
    val filesDone: Int = 0,
    val filesTotal: Int = 0,
    val bytesDone: Long = 0,
    val bytesTotal: Long = 0,
    val message: String = "",
    val error: String? = null,
    val packVersion: String? = null,
    val lastSync: Long = 0,
    val localFiles: Int = 0,
    val localBytes: Long = 0,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("running", running).put("filesDone", filesDone).put("filesTotal", filesTotal)
        .put("bytesDone", bytesDone).put("bytesTotal", bytesTotal).put("message", message)
        .put("error", error ?: JSONObject.NULL).put("packVersion", packVersion ?: JSONObject.NULL)
        .put("lastSync", lastSync).put("localFiles", localFiles).put("localBytes", localBytes)
}

/**
 * Télécharge le paquet de contenu (pack.json + images + audios) depuis le dépôt du carnet,
 * en Wi-Fi, avant le départ ou à l'hôtel. Chaque fichier est vérifié par SHA-256 avant d'être
 * mis en place ; un fichier déjà présent et identique n'est pas retéléchargé ; en cas d'erreur,
 * les fichiers déjà en place restent utilisables.
 */
class PackSync(context: Context) {
    val dir: File = File(context.filesDir, "pack").apply { mkdirs() }
    private val stateFile = File(dir, ".sync-state.json")
    private val _state = MutableStateFlow(loadState())
    val state: StateFlow<SyncState> = _state

    private fun loadState(): SyncState {
        val saved = readSaved()
        val files = saved.optJSONObject("files")
        var bytes = 0L
        var count = 0
        files?.keys()?.forEach { path ->
            val f = File(dir, path)
            if (f.isFile) { count++; bytes += f.length() }
        }
        return SyncState(
            packVersion = saved.optString("packVersion").ifEmpty { null },
            lastSync = saved.optLong("lastSync", 0),
            localFiles = count,
            localBytes = bytes,
        )
    }

    private fun readSaved(): JSONObject =
        runCatching { JSONObject(stateFile.readText()) }.getOrDefault(JSONObject())

    /** Chemin du pack.json synchronisé, ou null si aucune synchro n'a encore eu lieu. */
    fun hasPack(): Boolean = File(dir, PACK_PATH).isFile

    suspend fun run(baseUrl: String) = withContext(Dispatchers.IO) {
        if (_state.value.running) return@withContext
        val base = baseUrl.trimEnd('/') + "/"
        update { it.copy(running = true, error = null, message = "Lecture du manifeste…", filesDone = 0, bytesDone = 0) }
        try {
            val manifest = JSONObject(fetchText(base + MANIFEST_PATH))
            val packVersion = manifest.optString("packVersion")
            val entries = manifest.getJSONArray("files")
            val saved = readSaved()
            val known = saved.optJSONObject("files") ?: JSONObject()

            data class Entry(val path: String, val size: Long, val sha: String)
            val all = (0 until entries.length()).map {
                val e = entries.getJSONObject(it)
                Entry(e.getString("path"), e.getLong("size"), e.getString("sha256"))
            }
            all.forEach { require(isSafePath(it.path)) { "Chemin refusé dans le manifeste : ${it.path}" } }

            val todo = all.filter { e ->
                val f = File(dir, e.path)
                !(f.isFile && f.length() == e.size && known.optString(e.path) == e.sha)
            }
            val needed = todo.sumOf { it.size }
            val free = StatFs(dir.absolutePath).availableBytes
            if (needed + SAFETY_MARGIN > free) {
                throw IOException("Espace insuffisant : ${needed / MB} Mo nécessaires, ${free / MB} Mo libres.")
            }
            update { it.copy(filesTotal = todo.size, bytesTotal = needed, message = if (todo.isEmpty()) "Déjà à jour" else "Téléchargement…") }

            todo.forEachIndexed { index, e ->
                download(base + e.path, File(dir, e.path), e.sha)
                known.put(e.path, e.sha)
                update { it.copy(filesDone = index + 1, bytesDone = it.bytesDone + e.size, message = e.path.substringAfterLast('/')) }
                if (index % 10 == 9) save(known, saved.optString("packVersion"), saved.optLong("lastSync"))
            }

            // Fichiers qui ne font plus partie du paquet : supprimés.
            val wanted = all.map { it.path }.toSet()
            known.keys().asSequence().toList().filter { it !in wanted }.forEach { path ->
                File(dir, path).delete()
                known.remove(path)
            }
            val now = System.currentTimeMillis()
            save(known, packVersion, now)
            val fresh = loadState()
            update { fresh.copy(running = false, message = "Contenu à jour", filesTotal = todo.size, filesDone = todo.size) }
        } catch (e: Exception) {
            val fresh = loadState()
            update { fresh.copy(running = false, error = e.message ?: e.javaClass.simpleName, message = "") }
        }
    }

    private fun save(files: JSONObject, packVersion: String, lastSync: Long) {
        val tmp = File(dir, ".sync-state.tmp")
        tmp.writeText(JSONObject().put("packVersion", packVersion).put("lastSync", lastSync).put("files", files).toString())
        if (!tmp.renameTo(stateFile)) { stateFile.delete(); tmp.renameTo(stateFile) }
    }

    private fun update(change: (SyncState) -> SyncState) { _state.value = change(_state.value) }

    private fun isSafePath(path: String) =
        path.isNotBlank() && !path.startsWith("/") && !path.contains("..") && !path.contains('\\')

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
        }

    private fun fetchText(url: String): String {
        val c = open(url)
        try {
            if (c.responseCode != 200) throw IOException("Réponse ${c.responseCode} pour $url")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    private fun download(url: String, target: File, sha: String) {
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, target.name + ".part")
        val digest = MessageDigest.getInstance("SHA-256")
        val c = open(url)
        try {
            if (c.responseCode != 200) throw IOException("Réponse ${c.responseCode} pour ${target.name}")
            c.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
        } finally {
            c.disconnect()
        }
        val got = digest.digest().joinToString("") { "%02x".format(it) }
        if (got != sha) {
            tmp.delete()
            throw IOException("Fichier corrompu : ${target.name}")
        }
        if (target.exists()) target.delete()
        if (!tmp.renameTo(target)) throw IOException("Impossible d'enregistrer ${target.name}")
    }

    companion object {
        const val MANIFEST_PATH = "travelos/pack/manifest.json"
        const val PACK_PATH = "travelos/pack/pack.json"
        private const val MB = 1024L * 1024L
        private const val SAFETY_MARGIN = 200L * MB
    }
}
