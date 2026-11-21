package app.travelos

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.amap.api.maps.AMap
import com.amap.api.maps.CameraUpdateFactory
import com.amap.api.maps.CoordinateConverter
import com.amap.api.maps.MapsInitializer
import com.amap.api.maps.TextureMapView
import com.amap.api.maps.model.BitmapDescriptorFactory
import com.amap.api.maps.model.Circle
import com.amap.api.maps.model.CircleOptions
import com.amap.api.maps.model.LatLng
import com.amap.api.maps.model.LatLngBounds
import com.amap.api.maps.model.Marker
import com.amap.api.maps.model.MarkerOptions
import com.amap.api.maps.model.Polyline
import com.amap.api.maps.model.PolylineOptions
import com.amap.api.maps.offlinemap.OfflineMapManager
import com.amap.api.services.core.LatLonPoint
import com.amap.api.services.core.ServiceSettings
import com.amap.api.services.route.BusRouteResult
import com.amap.api.services.route.DriveRouteResult
import com.amap.api.services.route.RideRouteResult
import com.amap.api.services.route.RouteSearch
import com.amap.api.services.route.WalkRouteResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Carte du jour : une carte Amap native posée au-dessus de la WebView, dans le rectangle que
 * l'interface lui réserve. La page garde l'en-tête, la liste des étapes et la légende ; la carte
 * dessine les repères numérotés, les trajets par mode et la position.
 *
 * La vue est gardée en vie quand on ouvre une fiche : au retour, cadrage et zoom sont intacts.
 * Les coordonnées du carnet sont en WGS-84 ; Amap affiche Hong Kong, Macao et la Chine
 * continentale en GCJ-02, d'où la conversion par CoordinateConverter (type GPS → Amap).
 */
class MapHost(private val activity: MainActivity, private val root: FrameLayout) {
    private val ctx: Context = activity
    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("travelos-map", Context.MODE_PRIVATE)
    private val density = ctx.resources.displayMetrics.density

    private var box: FrameLayout? = null
    private var mapView: TextureMapView? = null
    private var map: AMap? = null
    private var shownKey = ""
    private var bounds: LatLngBounds? = null
    private val markerStop = HashMap<String, String>()
    private val walkLines = HashMap<String, Polyline>()
    private var resumed = true

    private var me: Marker? = null
    private var meCircle: Circle? = null
    private var locating = false
    private var pendingLocate = false
    private var bestFix: Location? = null
    private val lm by lazy { ctx.getSystemService(LocationManager::class.java) }

    /* ---------------- clé et état ---------------- */

    /** Clé Amap : celle saisie dans les réglages, sinon celle compilée dans l'APK (secret AMAP_KEY). */
    fun key(): String = prefs.getString("key", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.AMAP_KEY

    fun setKey(k: String) {
        prefs.edit().putString("key", k.trim()).apply()
        main.post { destroyMap() }
    }

    fun state(): String = JSONObject()
        .put("key", key().isNotBlank())
        .put("keyHint", key().takeIf { it.length > 8 }?.let { it.take(4) + "…" + it.takeLast(4) } ?: "")
        .put("visible", box?.visibility == View.VISIBLE)
        .toString()

    private fun initSdk() {
        MapsInitializer.updatePrivacyShow(ctx, true, true)
        MapsInitializer.updatePrivacyAgree(ctx, true)
        MapsInitializer.setApiKey(key())
        ServiceSettings.updatePrivacyShow(ctx, true, true)
        ServiceSettings.updatePrivacyAgree(ctx, true)
        ServiceSettings.getInstance().setApiKey(key())
    }

    /* ---------------- affichage ---------------- */

    /**
     * data : { rect:{x,y,w,h} en pixels CSS, key: identifiant du jour, fit: recadrer,
     *          stops:[{n,id,name,lat,lng,next,done}], legs:[{from,to,mode,path,route}] }
     */
    fun show(json: String) = main.post {
        if (key().isBlank()) return@post
        val data = try { JSONObject(json) } catch (e: Exception) { return@post }
        val m = ensureMap() ?: return@post
        val r = data.getJSONObject("rect")
        val lp = FrameLayout.LayoutParams(px(r.getDouble("w")), px(r.getDouble("h")))
        lp.leftMargin = px(r.getDouble("x")); lp.topMargin = px(r.getDouble("y"))
        box!!.layoutParams = lp
        (box!!.background as? GradientDrawable)?.cornerRadius = (r.optDouble("r", 0.0) * density).toFloat()
        box!!.visibility = View.VISIBLE
        val k = data.optString("key") + "|" + data.optString("sig")
        if (k != shownKey) {
            val sameDay = shownKey.substringBefore("|") == data.optString("key")
            shownKey = k
            draw(m, data)
            if (!sameDay || data.optBoolean("fit")) fit(false)
        } else if (data.optBoolean("fit")) fit(true)
    }

    fun hide() = main.post { box?.visibility = View.GONE }

    fun fit(animate: Boolean = true) = main.post {
        val m = map ?: return@post
        val b = bounds ?: return@post
        val pad = (56 * density).toInt()
        val u = CameraUpdateFactory.newLatLngBounds(b, pad)
        // La carte doit avoir sa taille pour cadrer : on attend qu'elle soit posée.
        mapView?.post { if (animate) m.animateCamera(u, 450, null) else m.moveCamera(u) }
    }

    private fun ensureMap(): AMap? {
        map?.let { return it }
        return try {
            initSdk()
            val mv = TextureMapView(ctx)
            mv.onCreate(null)
            if (resumed) mv.onResume()
            val frame = FrameLayout(ctx).apply {
                visibility = View.GONE
                clipToOutline = true
                outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
                background = GradientDrawable().apply { cornerRadius = 0f; setColor(Color.parseColor("#E9E4DA")) }
                addView(mv, FrameLayout.LayoutParams(-1, -1))
                addView(chips(), FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END).apply {
                    setMargins(0, 0, dp(14), dp(14))
                })
            }
            root.addView(frame, FrameLayout.LayoutParams(1, 1))
            box = frame; mapView = mv
            val m = mv.map
            m.uiSettings.apply {
                isZoomControlsEnabled = false
                isRotateGesturesEnabled = false
                isTiltGesturesEnabled = false
                isScaleControlsEnabled = true
                isCompassEnabled = false
            }
            try { m.setMapLanguage(AMap.ENGLISH) } catch (_: Throwable) {}
            // Premier affichage : on cadre quand la carte est prête (sa taille est connue).
            m.setOnMapLoadedListener { fit(false) }
            m.setOnMarkerClickListener { mk ->
                markerStop[mk.id]?.let { activity.jsCall("TravelOS.onMapStop", it) }
                true
            }
            map = m
            m
        } catch (t: Throwable) {
            activity.toastJs("La carte Amap n'a pas pu démarrer : plan simplifié affiché.")
            activity.jsCall("TravelOS.onMapFailed", t.javaClass.simpleName)
            null
        }
    }

    private fun destroyMap() {
        mapView?.onDestroy()
        box?.let { root.removeView(it) }
        box = null; mapView = null; map = null; shownKey = ""; me = null; meCircle = null
        markerStop.clear(); walkLines.clear()
    }

    private fun draw(m: AMap, data: JSONObject) {
        m.clear(true)
        markerStop.clear(); walkLines.clear(); me = null; meCircle = null
        val stops = data.optJSONArray("stops") ?: JSONArray()
        val pos = HashMap<String, LatLng>()
        val b = LatLngBounds.Builder()
        var any = false
        for (i in 0 until stops.length()) {
            val s = stops.getJSONObject(i)
            val p = gcj(s.getDouble("lat"), s.getDouble("lng"))
            pos[s.getString("id")] = p
            b.include(p); any = true
            val mk = m.addMarker(MarkerOptions()
                .position(p)
                .anchor(0.5f, 1f)
                .zIndex(if (s.optBoolean("next")) 30f else 20f)
                .icon(BitmapDescriptorFactory.fromBitmap(pin(s.getInt("n"), s.optBoolean("next"), s.optBoolean("done")))))
            markerStop[mk.id] = s.getString("id")
        }
        bounds = if (any) b.build() else null
        val legs = data.optJSONArray("legs") ?: JSONArray()
        for (i in 0 until legs.length()) {
            val l = legs.getJSONObject(i)
            val path = l.optJSONArray("path")
            if (path != null && path.length() > 1) {
                val pts = (0 until path.length()).map { j -> path.getJSONArray(j).let { gcj(it.getDouble(0), it.getDouble(1)) } }
                m.addPolyline(style(l.optString("mode"), PolylineOptions().addAll(pts)))
            } else if (l.optString("route") == "amap") {
                val a = pos[l.optString("from")]; val z = pos[l.optString("to")]
                if (a != null && z != null) walk(m, l.optString("from") + ">" + l.optString("to"), a, z)
            }
        }
    }

    /** Style par mode : ferry en tirets bleus, marche en pointillés verts, Peak Tram en trait orange. */
    private fun style(mode: String, o: PolylineOptions): PolylineOptions = when (mode) {
        "ferry" -> o.color(Color.parseColor("#1E88E5")).width(dp(5).toFloat()).setDottedLine(true)
            .setDottedLineType(PolylineOptions.DOTTEDLINE_TYPE_SQUARE).zIndex(10f)
        "walk" -> o.color(Color.parseColor("#2E9D4F")).width(dp(6).toFloat()).setDottedLine(true)
            .setDottedLineType(PolylineOptions.DOTTEDLINE_TYPE_CIRCLE).zIndex(10f)
        "peaktram" -> o.color(Color.parseColor("#F07C00")).width(dp(6).toFloat()).zIndex(11f)
        "dingding" -> o.color(Color.parseColor("#0B6E4F")).width(dp(5).toFloat()).zIndex(10f)
        "metro" -> o.color(Color.parseColor("#C8102E")).width(dp(5).toFloat()).zIndex(10f)
        else -> o.color(Color.parseColor("#8A8A8E")).width(dp(4).toFloat()).zIndex(9f)
    }

    /** Marche : itinéraire piéton calculé par Amap (réseau requis la première fois), gardé en mémoire. */
    private fun walk(m: AMap, id: String, a: LatLng, z: LatLng) {
        val cacheKey = "walk:$id:${"%.5f,%.5f>%.5f,%.5f".format(a.latitude, a.longitude, z.latitude, z.longitude)}"
        prefs.getString(cacheKey, null)?.let { cached ->
            val arr = JSONArray(cached)
            val pts = (0 until arr.length()).map { arr.getJSONArray(it).let { p -> LatLng(p.getDouble(0), p.getDouble(1)) } }
            walkLines[id] = m.addPolyline(style("walk", PolylineOptions().addAll(pts)))
            return
        }
        try {
            val rs = RouteSearch(ctx)
            val day = shownKey
            rs.setRouteSearchListener(object : RouteSearch.OnRouteSearchListener {
                override fun onBusRouteSearched(r: BusRouteResult?, code: Int) {}
                override fun onDriveRouteSearched(r: DriveRouteResult?, code: Int) {}
                override fun onRideRouteSearched(r: RideRouteResult?, code: Int) {}
                override fun onWalkRouteSearched(r: WalkRouteResult?, code: Int) {
                    val path = r?.paths?.firstOrNull() ?: return
                    if (code != 1000) return
                    val pts = ArrayList<LatLng>()
                    pts.add(a)
                    for (st in path.steps) for (p in st.polyline) pts.add(LatLng(p.latitude, p.longitude))
                    pts.add(z)
                    if (pts.size < 3) return
                    val arr = JSONArray(); pts.forEach { arr.put(JSONArray().put(it.latitude).put(it.longitude)) }
                    prefs.edit().putString(cacheKey, arr.toString()).apply()
                    if (shownKey == day && map === m) walkLines[id] = m.addPolyline(style("walk", PolylineOptions().addAll(pts)))
                }
            })
            rs.calculateWalkRouteAsyn(RouteSearch.WalkRouteQuery(RouteSearch.FromAndTo(
                LatLonPoint(a.latitude, a.longitude), LatLonPoint(z.latitude, z.longitude))))
        } catch (_: Throwable) {
            // Pas de réseau ou service refusé : le tronçon reste sans tracé, le mode est affiché dans la liste.
        }
    }

    /* ---------------- position ---------------- */

    fun locate() = main.post {
        if (map == null) return@post
        if (!hasPermission()) {
            pendingLocate = true
            activity.requestLocationPermission()
            return@post
        }
        startFix()
    }

    /** Appelé après la réponse à la demande d'autorisation. */
    fun onPermission() = main.post {
        if (!pendingLocate) return@post
        pendingLocate = false
        if (hasPermission()) startFix()
        else activity.toastJs("Position non autorisée : la carte et les fiches restent disponibles.")
    }

    private fun hasPermission() =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private val fixListener = LocationListener { loc -> onFix(loc, true) }

    @SuppressLint("MissingPermission")
    private fun startFix() {
        val l = lm ?: return
        // Dernière position connue tout de suite si elle est récente (moins de 3 minutes).
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.FUSED_PROVIDER)
            .mapNotNull { p -> try { l.getLastKnownLocation(p) } catch (_: Exception) { null } }
            .filter { SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos < 180_000_000_000L }
            .minByOrNull { it.accuracy }
            ?.let { onFix(it, false) }
        if (locating) { me?.let { map?.animateCamera(CameraUpdateFactory.changeLatLng(it.position)) }; return }
        locating = true
        var started = false
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try {
                if (l.isProviderEnabled(p)) { l.requestLocationUpdates(p, 2000L, 2f, fixListener, Looper.getMainLooper()); started = true }
            } catch (_: Exception) {}
        }
        if (!started) { locating = false; activity.toastJs("Localisation désactivée dans les réglages Android."); return }
        if (me == null) activity.toastJs("Recherche de ta position…")
        // Si rien n'arrive en 25 s, on le dit ; la carte reste utilisable.
        main.postDelayed({ if (locating && me == null) activity.toastJs("Pas encore de position : réessaie à l'extérieur.") }, 25_000)
        // Économie de batterie : on arrête après 2 minutes.
        main.postDelayed({ stopFix() }, 120_000)
    }

    private fun stopFix() {
        if (!locating) return
        try { lm?.removeUpdates(fixListener) } catch (_: Exception) {}
        locating = false
    }

    private fun onFix(loc: Location, live: Boolean) {
        val m = map ?: return
        val first = me == null
        val best = bestFix
        if (!live && best != null && best.accuracy < loc.accuracy) return
        bestFix = loc
        val p = gcj(loc.latitude, loc.longitude)
        val acc = loc.accuracy.toDouble().coerceAtLeast(5.0)
        if (me == null) {
            meCircle = m.addCircle(CircleOptions().center(p).radius(acc)
                .fillColor(Color.argb(46, 10, 132, 255)).strokeColor(Color.argb(90, 10, 132, 255)).strokeWidth(dp(1).toFloat()).zIndex(5f))
            me = m.addMarker(MarkerOptions().position(p).anchor(0.5f, 0.5f).zIndex(40f)
                .icon(BitmapDescriptorFactory.fromBitmap(blueDot())))
        } else {
            me!!.position = p; meCircle?.center = p; meCircle?.radius = acc
        }
        if (first) {
            val z = m.cameraPosition.zoom.coerceAtLeast(15f)
            m.animateCamera(CameraUpdateFactory.newLatLngZoom(p, z), 500, null)
        }
    }

    /* ---------------- cartes hors ligne ---------------- */

    private var offline: OfflineMapManager? = null

    /** Télécharge les cartes hors ligne des villes du voyage (à faire en Wi-Fi avant le départ). */
    fun downloadOffline(cities: String) = main.post {
        if (key().isBlank()) { activity.toastJs("Ajoute d'abord la clé Amap."); return@post }
        try {
            initSdk()
            val mgr = offline ?: OfflineMapManager(ctx, object : OfflineMapManager.OfflineMapDownloadListener {
                override fun onDownload(status: Int, completeCode: Int, downName: String?) {
                    activity.jsCall("TravelOS.onOfflineMap", JSONObject().put("city", downName ?: "").put("status", status).put("pct", completeCode).toString())
                }
                override fun onCheckUpdate(hasNew: Boolean, name: String?) {}
                override fun onRemove(success: Boolean, name: String?, describe: String?) {}
            }).also { offline = it }
            val wanted = cities.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            val list = mgr.offlineMapCityList
            for (w in wanted) {
                val c = list.firstOrNull { it.city.contains(w) }
                if (c == null) activity.toastJs("Carte hors ligne introuvable : $w")
                else mgr.downloadByCityCode(c.code)
            }
        } catch (t: Throwable) {
            activity.toastJs("Téléchargement des cartes impossible pour l'instant.")
        }
    }

    /* ---------------- cycle de vie ---------------- */

    fun onResume() { resumed = true; mapView?.onResume() }
    fun onPause() { resumed = false; mapView?.onPause(); stopFix() }
    fun onDestroy() { stopFix(); offline?.destroy(); mapView?.onDestroy() }

    /* ---------------- dessin ---------------- */

    private fun gcj(lat: Double, lng: Double): LatLng = try {
        CoordinateConverter(ctx).from(CoordinateConverter.CoordType.GPS).coord(LatLng(lat, lng)).convert()
    } catch (_: Throwable) { LatLng(lat, lng) }

    private fun chips(): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(chip("◎  Ma position") { locate() })
        addView(chip("⛶  Vue du jour") { fit(true) }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(10) })
    }

    private fun chip(text: String, onClick: () -> Unit) = TextView(ctx).apply {
        this.text = text
        setTextColor(Color.parseColor("#1D1D1F"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(Color.argb(240, 255, 255, 255)) }
        elevation = dp(4).toFloat()
        setOnClickListener { onClick() }
    }

    /** Repère en goutte, numéroté ; la prochaine étape est plus grande, avec un halo. */
    private fun pin(n: Int, next: Boolean, done: Boolean): Bitmap {
        val w = dp(if (next) 46 else 36); val h = (w * 1.32f).toInt()
        val bmp = Bitmap.createBitmap(w + dp(8), h + dp(4), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val cx = bmp.width / 2f; val r = w / 2f
        val fill = when { done -> Color.parseColor("#9A9AA0"); else -> Color.parseColor("#B3122E") }
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(70, 0, 0, 0)
        c.drawOval(RectF(cx - r * .45f, h - dp(4).toFloat(), cx + r * .45f, h + dp(2).toFloat()), p)
        val path = Path().apply {
            addCircle(cx, r + dp(2), r, Path.Direction.CW)
            moveTo(cx - r * .55f, r + dp(2) + r * .75f); lineTo(cx, h.toFloat()); lineTo(cx + r * .55f, r + dp(2) + r * .75f); close()
        }
        p.color = fill; c.drawPath(path, p)
        p.style = Paint.Style.STROKE; p.strokeWidth = dp(if (next) 3 else 2).toFloat(); p.color = Color.WHITE
        c.drawCircle(cx, r + dp(2), r - p.strokeWidth / 2, p)
        p.style = Paint.Style.FILL; p.color = Color.WHITE
        p.textAlign = Paint.Align.CENTER; p.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        p.textSize = r * (if (n > 9) .82f else 1.0f)
        c.drawText(n.toString(), cx, r + dp(2) - (p.descent() + p.ascent()) / 2, p)
        return bmp
    }

    private fun blueDot(): Bitmap {
        val s = dp(24)
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(60, 0, 0, 0); c.drawCircle(s / 2f, s / 2f + 1, s / 2f - 1, p)
        p.color = Color.WHITE; c.drawCircle(s / 2f, s / 2f, s / 2f - 2, p)
        p.color = Color.parseColor("#0A84FF"); c.drawCircle(s / 2f, s / 2f, s / 2f - dp(5), p)
        return bmp
    }

    private fun dp(v: Int) = (v * density).toInt()
    private fun px(css: Double) = (css * density).toInt()
}
