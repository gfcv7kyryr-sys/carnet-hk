package app.travelos

import android.content.Context
import android.speech.tts.TextToSpeech
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import org.json.JSONObject
import java.util.Locale

/**
 * Traduction français ⇄ chinois faite sur la tablette (ML Kit) : les modèles (environ 30 Mo
 * par langue) se téléchargent une fois en Wi-Fi, puis tout fonctionne sans réseau.
 * Le chinois produit est en caractères simplifiés.
 * La lecture à voix haute passe par la synthèse vocale d'Android (voix hors ligne à installer).
 */
class OfflineTranslator(context: Context) {
    private val frToZh: Translator = Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(TranslateLanguage.FRENCH).setTargetLanguage(TranslateLanguage.CHINESE).build(),
    )
    private val zhToFr: Translator = Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(TranslateLanguage.CHINESE).setTargetLanguage(TranslateLanguage.FRENCH).build(),
    )

    @Volatile private var ready = false
    @Volatile private var downloading = false
    @Volatile private var error: String? = null

    @Volatile private var ttsReady = false
    private val tts = TextToSpeech(context.applicationContext) { status -> ttsReady = status == TextToSpeech.SUCCESS }

    init {
        // Vérifie, sans rien télécharger, si les modèles sont déjà présents.
        checkReady()
    }

    private fun checkReady() {
        RemoteModelManager.getInstance()
            .getDownloadedModels(TranslateRemoteModel::class.java)
            .addOnSuccessListener { models ->
                val langs = models.map { it.language }.toSet()
                ready = TranslateLanguage.FRENCH in langs && TranslateLanguage.CHINESE in langs
            }
    }

    fun state(): String = JSONObject()
        .put("ready", ready).put("downloading", downloading).put("error", error ?: JSONObject.NULL)
        .put("tts", ttsReady).toString()

    fun download() {
        if (downloading) return
        downloading = true
        error = null
        val conditions = DownloadConditions.Builder().build()
        frToZh.downloadModelIfNeeded(conditions)
            .continueWithTask { zhToFr.downloadModelIfNeeded(conditions) }
            .addOnSuccessListener { ready = true; downloading = false; checkReady() }
            .addOnFailureListener { e -> error = e.message ?: "Téléchargement impossible"; downloading = false }
    }

    fun translate(text: String, toChinese: Boolean, onResult: (String?, String?) -> Unit) {
        val t = if (toChinese) frToZh else zhToFr
        t.translate(text)
            .addOnSuccessListener { onResult(it, null) }
            .addOnFailureListener { e -> onResult(null, e.message ?: "Traduction impossible") }
    }

    /** Renvoie « ok », « missing » (voix absente) ou « off » (synthèse indisponible). */
    fun speak(text: String, languageTag: String): String {
        if (!ttsReady) return "off"
        val res = tts.setLanguage(Locale.forLanguageTag(languageTag))
        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) return "missing"
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "travelos")
        return "ok"
    }

    fun close() {
        frToZh.close(); zhToFr.close(); tts.shutdown()
    }
}
