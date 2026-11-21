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
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdate
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.fillColor
import org.maplibre.android.style.layers.PropertyFactory.fillOutlineColor
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconAnchor
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.symbolSortKey
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/**
 * Carte du jour : une carte MapLibre (fond OpenStreetMap) posée au-dessus de la WebView, dans le
 * rectangle que l'interface lui réserve. La page garde l'en-tête, la liste des étapes et la légende ;
 * la carte dessine les repères numérotés, les trajets par mode et la position.
 *
 * Tous les points sont en WGS-84 (carnet, GPS, OpenStreetMap) : aucune conversion ici. Le seul endroit
 * où le format change est le lien « Y aller », qui laisse AMap convertir (dev=1).
 *
 * La vue est gardée en vie quand on ouvre une fiche : au retour, cadrage et zoom sont intacts.
 */
class MapHost(private val activity: MainActivity, private val root: FrameLayout) {
    private val ctx: Context = activity
    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("travelos-map", Context.MODE_PRIVATE)
    private val density = ctx.resources.displayMetrics.density

    private var box: FrameLayout? = null
    private var mapView: MapView? = null
    private var map: MapLibreMap? = null
    private var style: Style? = null
    private var pending: JSONObject? = null
    private var resumed = true

    private var shownKey = ""
    private val fitPts = ArrayList<LatLng>()
    private val stopPos = ArrayList<Triple<String, LatLng, Boolean>>() // id, position, prochaine étape
    private val legLines = LinkedHashMap<String, JSONObject>()
    private val pinImages = HashSet<String>()

    private var srcStops: GeoJsonSource? = null
    private var srcLegs: GeoJsonSource? = null
    private var srcAcc: GeoJsonSource? = null
    private var srcMe: GeoJsonSource? = null

    private var hasMe = false
    private var locating = false
    private var pendingLocate = false
    private var bestFix: Location? = null
    private val lm by lazy { ctx.getSystemService(LocationManager::class.java) }

    fun state(): String = JSONObject()
        .put("ready", true)
        .put("engine", "MapLibre · OpenStreetMap")
        .put("visible", box?.visibility == View.VISIBLE)
        .toString()

    /* ---------------- affichage ---------------- */

    /**
     * data : { rect:{x,y,w,h,r} en pixels CSS, key: identifiant du jour, sig, fit: recadrer,
     *          stops:[{n,id,name,lat,lng,next,done}], legs:[{from,to,mode,path,route}] }
     */
    fun show(json: String) = main.post {
        val data = try { JSONObject(json) } catch (e: Exception) { return@post }
        if (!ensureView()) return@post
        val r = data.getJSONObject("rect")
        val lp = FrameLayout.LayoutParams(px(r.getDouble("w")), px(r.getDouble("h")))
        lp.leftMargin = px(r.getDouble("x")); lp.topMargin = px(r.getDouble("y"))
        box!!.layoutParams = lp
        (box!!.background as? GradientDrawable)?.cornerRadius = (r.optDouble("r", 0.0) * density).toFloat()
        box!!.visibility = View.VISIBLE
        if (style == null) { pending = data; return@post }
        apply(data)
    }

    private fun apply(data: JSONObject) {
        val st = style ?: return
        val k = data.optString("key") + "|" + data.optString("sig")
        if (k != shownKey) {
            val sameDay = shownKey.substringBefore("|") == data.optString("key")
            shownKey = k
            draw(st, data)
            if (!sameDay || data.optBoolean("fit")) fit(false)
        } else if (data.optBoolean("fit")) fit(true)
    }

    fun hide() = main.post { box?.visibility = View.GONE }

    fun fit(animate: Boolean = true) = main.post { doFit(animate, 0) }

    private fun doFit(animate: Boolean, tries: Int) {
        val m = map ?: return
        val v = mapView ?: return
        if (fitPts.isEmpty()) return
        // La carte doit avoir sa taille pour cadrer : on attend qu'elle soit posée.
        if ((v.width == 0 || v.height == 0) && tries < 30) { v.postDelayed({ doFit(animate, tries + 1) }, 50); return }
        try {
            val u: CameraUpdate = if (fitPts.size == 1) CameraUpdateFactory.newLatLngZoom(fitPts[0], 16.0) else {
                val b = LatLngBounds.Builder()
                fitPts.forEach { b.include(it) }
                CameraUpdateFactory.newLatLngBounds(b.build(), dp(56))
            }
            if (animate) m.animateCamera(u, 450) else m.moveCamera(u)
        } catch (_: Throwable) { /* cadrage impossible : la carte reste où elle est */ }
    }

    /** Crée la vue carte si besoin ; renvoie false si elle n'a pas pu démarrer (plan simplifié alors). */
    private fun ensureView(): Boolean {
        if (box != null) return true
        return try {
            MapLibre.getInstance(ctx)
            val opts = MapLibreMapOptions.createFromAttributes(ctx, null)
                .textureMode(true)
                .logoEnabled(false)
                .attributionEnabled(false)
                .compassEnabled(false)
                .rotateGesturesEnabled(false)
                .tiltGesturesEnabled(false)
            val mv = MapView(ctx, opts)
            mv.onCreate(null)
            mv.onStart()
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
                addView(attribution(), FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply {
                    setMargins(dp(10), 0, 0, dp(8))
                })
            }
            root.addView(frame, FrameLayout.LayoutParams(1, 1))
            box = frame; mapView = mv
            mv.getMapAsync { m ->
                map = m
                m.uiSettings.isRotateGesturesEnabled = false
                m.uiSettings.isTiltGesturesEnabled = false
                m.uiSettings.isCompassEnabled = false
                m.uiSettings.isLogoEnabled = false
                m.uiSettings.isAttributionEnabled = false
                m.setMinZoomPreference(9.0)
                m.setMaxZoomPreference(19.0)
                m.addOnMapClickListener { ll -> tap(m, ll) }
                m.setStyle(Style.Builder().fromUri("asset://map/osm.json")) { st ->
                    style = st
                    addLayers(st)
                    pending?.let { d -> pending = null; apply(d) }
                }
            }
            true
        } catch (t: Throwable) {
            activity.toastJs("La carte n'a pas pu démarrer : plan simplifié affiché.")
            activity.jsCall("TravelOS.onMapFailed", t.javaClass.simpleName)
            false
        }
    }

    private fun destroyMap() {
        mapView?.onStop(); mapView?.onDestroy()
        box?.let { root.removeView(it) }
        box = null; mapView = null; map = null; style = null; shownKey = ""; hasMe = false
        legLines.clear(); pinImages.clear(); stopPos.clear(); fitPts.clear()
        srcStops = null; srcLegs = null; srcAcc = null; srcMe = null
    }

    /** Touche sur la carte : le repère le plus proche du doigt ouvre la fiche du lieu. */
    private fun tap(m: MapLibreMap, ll: LatLng): Boolean {
        var best: String? = null; var bestD = Double.MAX_VALUE
        val t = m.projection.toScreenLocation(ll)
        for ((id, pos, next) in stopPos) {
            val p = m.projection.toScreenLocation(pos)
            val h = dp(if (next) 61 else 48)
            val dx = (t.x - p.x).toDouble(); val dy = (t.y - (p.y - h / 2f)).toDouble()
            val d = Math.hypot(dx, dy)
            if (d < bestD) { bestD = d; best = id }
        }
        if (best != null && bestD <= dp(34)) { activity.jsCall("TravelOS.onMapStop", best); return true }
        return false
    }

    /* ---------------- couches ---------------- */

    private fun addLayers(st: Style) {
        val empty = """{"type":"FeatureCollection","features":[]}"""
        srcLegs = GeoJsonSource("legs", empty); srcAcc = GeoJsonSource("acc", empty)
        srcStops = GeoJsonSource("stops", empty); srcMe = GeoJsonSource("me", empty)
        st.addSource(srcLegs!!); st.addSource(srcAcc!!); st.addSource(srcStops!!); st.addSource(srcMe!!)

        // Un liseré blanc sous chaque trajet, pour qu'il se lise sur n'importe quel fond de carte.
        st.addLayer(LineLayer("legs-casing", "legs").withProperties(
            lineColor("#FFFFFF"), lineWidth(10f), lineOpacity(0.9f),
            lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
        // Ferry : tirets bleus. Marche : pointillés verts. Peak Tram : trait orange plein. Autres modes : trait plein.
        fun leg(mode: String, color: String, width: Float, dash: Array<Float>?, cap: String) {
            val l = LineLayer("leg-$mode", "legs").withFilter(Expression.eq(Expression.get("mode"), Expression.literal(mode)))
            l.setProperties(lineColor(color), lineWidth(width), lineCap(cap), lineJoin(Property.LINE_JOIN_ROUND))
            if (dash != null) l.setProperties(lineDasharray(dash))
            st.addLayer(l)
        }
        leg("ferry", "#1E88E5", 5f, arrayOf(2.2f, 1.5f), Property.LINE_CAP_BUTT)
        leg("walk", "#2E9D4F", 6f, arrayOf(0.05f, 1.9f), Property.LINE_CAP_ROUND)
        leg("peaktram", "#F07C00", 6f, null, Property.LINE_CAP_ROUND)
        leg("dingding", "#0B6E4F", 5f, null, Property.LINE_CAP_ROUND)
        leg("metro", "#C8102E", 5f, null, Property.LINE_CAP_ROUND)

        st.addLayer(FillLayer("acc-fill", "acc").withProperties(
            fillColor(Color.argb(46, 10, 132, 255)), fillOutlineColor(Color.argb(90, 10, 132, 255))))
        st.addLayer(SymbolLayer("stops-pins", "stops").withProperties(
            iconImage(Expression.get("icon")), iconAnchor(Property.ICON_ANCHOR_BOTTOM),
            iconAllowOverlap(true), iconIgnorePlacement(true), symbolSortKey(Expression.get("z"))))
        // Ta position : point bleu cerné de blanc, à part des repères numérotés.
        st.addLayer(CircleLayer("me-dot", "me").withProperties(
            circleRadius(8f), circleColor(Color.parseColor("#0A84FF")),
            circleStrokeColor(Color.WHITE), circleStrokeWidth(3f)))
    }

    private fun feature(geometry: JSONObject, props: JSONObject) =
        JSONObject().put("type", "Feature").put("properties", props).put("geometry", geometry)

    private fun collection(features: Collection<JSONObject>) =
        JSONObject().put("type", "FeatureCollection").put("features", JSONArray(features.toList())).toString()

    private fun point(lat: Double, lng: Double) =
        JSONObject().put("type", "Point").put("coordinates", JSONArray().put(lng).put(lat))

    private fun line(mode: String, pts: List<DoubleArray>): JSONObject {
        val c = JSONArray(); pts.forEach { c.put(JSONArray().put(it[1]).put(it[0])) }
        return feature(JSONObject().put("type", "LineString").put("coordinates", c), JSONObject().put("mode", mode))
    }

    private fun draw(st: Style, data: JSONObject) {
        legLines.clear(); stopPos.clear(); fitPts.clear()
        val stops = data.optJSONArray("stops") ?: JSONArray()
        val pos = HashMap<String, DoubleArray>()
        val feats = ArrayList<JSONObject>()
        for (i in 0 until stops.length()) {
            val s = stops.getJSONObject(i)
            val lat = s.getDouble("lat"); val lng = s.getDouble("lng")
            val n = s.getInt("n"); val next = s.optBoolean("next"); val done = s.optBoolean("done")
            pos[s.getString("id")] = doubleArrayOf(lat, lng)
            fitPts.add(LatLng(lat, lng)); stopPos.add(Triple(s.getString("id"), LatLng(lat, lng), next))
            val icon = "pin-$n-${if (next) "n" else if (done) "d" else "o"}"
            if (pinImages.add(icon)) st.addImage(icon, pin(n, next, done))
            feats.add(feature(point(lat, lng), JSONObject().put("id", s.getString("id")).put("icon", icon).put("z", if (next) 2 else 1)))
        }
        srcStops?.setGeoJson(collection(feats))

        val legs = data.optJSONArray("legs") ?: JSONArray()
        for (i in 0 until legs.length()) {
            val l = legs.getJSONObject(i)
            val id = l.optString("from") + ">" + l.optString("to")
            val path = l.optJSONArray("path")
            if (path != null && path.length() > 1) {
                // Tracé vérifié du carnet : tel quel.
                legLines[id] = line(l.optString("mode"), (0 until path.length()).map { j -> path.getJSONArray(j).let { doubleArrayOf(it.getDouble(0), it.getDouble(1)) } })
            } else if (l.optString("route") == "osm-foot") {
                val a = pos[l.optString("from")]; val z = pos[l.optString("to")]
                if (a != null && z != null) walk(id, a, z)
            }
            // Sans tracé : rien n'est dessiné, le mode reste indiqué dans la liste.
        }
        pushLegs()
    }

    private fun pushLegs() { srcLegs?.setGeoJson(collection(legLines.values)) }

    /**
     * Marche : itinéraire piéton OpenStreetMap, demandé en ligne la première fois puis gardé en mémoire.
     * Il est relié exactement aux points des deux arrêts. Hors ligne et sans mémoire : pas de tracé.
     */
    private fun walk(id: String, a: DoubleArray, z: DoubleArray) {
        val ck = "walk2:$id:${"%.5f,%.5f>%.5f,%.5f".format(a[0], a[1], z[0], z[1])}"
        prefs.getString(ck, null)?.let { cached ->
            val arr = JSONArray(cached)
            legLines[id] = line("walk", (0 until arr.length()).map { arr.getJSONArray(it).let { p -> doubleArrayOf(p.getDouble(0), p.getDouble(1)) } })
            return
        }
        val day = shownKey
        Thread {
            try {
                val u = URL("https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${z[1]},${z[0]}?overview=full&geometries=geojson")
                val c = u.openConnection() as HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 12000
                c.setRequestProperty("User-Agent", "TravelOS/0.10 (carnet de voyage familial)")
                if (c.responseCode != 200) return@Thread
                val body = c.inputStream.bufferedReader().use { it.readText() }
                val co = JSONObject(body).getJSONArray("routes").getJSONObject(0).getJSONObject("geometry").getJSONArray("coordinates")
                if (co.length() < 2) return@Thread
                val pts = ArrayList<DoubleArray>()
                pts.add(a)
                for (k in 0 until co.length()) co.getJSONArray(k).let { pts.add(doubleArrayOf(it.getDouble(1), it.getDouble(0))) }
                pts.add(z)
                val arr = JSONArray(); pts.forEach { arr.put(JSONArray().put(it[0]).put(it[1])) }
                prefs.edit().putString(ck, arr.toString()).apply()
                main.post { if (shownKey == day && map != null) { legLines[id] = line("walk", pts); pushLegs() } }
            } catch (_: Exception) {
                // Pas de réseau : le tronçon reste sans tracé, son mode est affiché dans la liste.
            }
        }.start()
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
        if (locating) { bestFix?.let { map?.animateCamera(CameraUpdateFactory.newLatLng(LatLng(it.latitude, it.longitude))) }; return }
        locating = true
        var started = false
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try {
                if (l.isProviderEnabled(p)) { l.requestLocationUpdates(p, 2000L, 2f, fixListener, Looper.getMainLooper()); started = true }
            } catch (_: Exception) {}
        }
        if (!started) { locating = false; activity.toastJs("Localisation désactivée dans les réglages Android."); return }
        if (!hasMe) activity.toastJs("Recherche de ta position…")
        // Si rien n'arrive en 25 s, on le dit ; la carte reste utilisable.
        main.postDelayed({ if (locating && !hasMe) activity.toastJs("Pas encore de position : réessaie à l'extérieur.") }, 25_000)
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
        if (style == null) return
        val best = bestFix
        if (!live && best != null && best.accuracy < loc.accuracy) return
        bestFix = loc
        val first = !hasMe
        hasMe = true
        val acc = loc.accuracy.toDouble().coerceAtLeast(5.0)
        srcMe?.setGeoJson(collection(listOf(feature(point(loc.latitude, loc.longitude), JSONObject()))))
        srcAcc?.setGeoJson(collection(listOf(feature(circle(loc.latitude, loc.longitude, acc), JSONObject()))))
        if (first) {
            val z = m.cameraPosition.zoom.coerceAtLeast(15.0)
            m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(loc.latitude, loc.longitude), z), 500)
        }
    }

    /** Cercle de précision : polygone de 48 côtés, rayon en mètres. */
    private fun circle(lat: Double, lng: Double, meters: Double): JSONObject {
        val ring = JSONArray()
        val dLat = meters / 111_320.0
        val dLng = meters / (111_320.0 * cos(Math.toRadians(lat)))
        for (i in 0..48) {
            val a = 2 * Math.PI * i / 48
            ring.put(JSONArray().put(lng + dLng * Math.cos(a)).put(lat + dLat * Math.sin(a)))
        }
        return JSONObject().put("type", "Polygon").put("coordinates", JSONArray().put(ring))
    }

    /* ---------------- cartes hors ligne ---------------- */

    /**
     * Télécharge, une région par journée, le fond de carte autour des étapes (à faire en Wi-Fi).
     * regions : [{id,name,s,w,n,e}] en degrés WGS-84. Le niveau de détail baisse si la zone est vaste,
     * pour rester à quelques milliers de tuiles par journée.
     */
    fun downloadOffline(json: String) = main.post {
        try {
            MapLibre.getInstance(ctx)
            val list = JSONArray(json)
            val mgr = OfflineManager.getInstance(ctx)
            mgr.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
                override fun onList(existing: Array<OfflineRegion>?) {
                    val have = (existing ?: emptyArray()).mapNotNull { r ->
                        try { JSONObject(String(r.metadata)).optString("id") } catch (_: Exception) { null }
                    }.toSet()
                    var todo = 0
                    for (i in 0 until list.length()) {
                        val o = list.getJSONObject(i)
                        if (o.getString("id") in have) { report(o.getString("name"), 2, 100); continue }
                        todo++
                        create(mgr, o)
                    }
                    if (todo == 0) activity.toastJs("Les cartes de toutes les journées sont déjà sur la tablette.")
                }
                override fun onError(error: String) { activity.toastJs("Téléchargement des cartes impossible pour l'instant.") }
            })
        } catch (t: Throwable) {
            activity.toastJs("Téléchargement des cartes impossible pour l'instant.")
        }
    }

    private fun create(mgr: OfflineManager, o: JSONObject) {
        val padLat = 0.010; val padLng = 0.010
        val bounds = LatLngBounds.Builder()
            .include(LatLng(o.getDouble("s") - padLat, o.getDouble("w") - padLng))
            .include(LatLng(o.getDouble("n") + padLat, o.getDouble("e") + padLng)).build()
        var maxZ = 16
        while (maxZ > 11 && tiles(bounds, 10, maxZ) > 3500) maxZ--
        val def = OfflineTilePyramidRegionDefinition("asset://map/osm.json", bounds, 10.0, maxZ.toDouble(), density)
        val meta = JSONObject().put("id", o.getString("id")).put("name", o.getString("name")).toString().toByteArray()
        mgr.createOfflineRegion(def, meta, object : OfflineManager.CreateOfflineRegionCallback {
            override fun onCreate(region: OfflineRegion) {
                region.setObserver(object : OfflineRegion.OfflineRegionObserver {
                    override fun onStatusChanged(status: OfflineRegionStatus) {
                        val req = status.requiredResourceCount.coerceAtLeast(1)
                        val pct = (status.completedResourceCount * 100 / req).toInt()
                        report(o.getString("name"), if (status.isComplete) 2 else 1, if (status.isComplete) 100 else pct)
                        if (status.isComplete) region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                    }
                    override fun onError(error: OfflineRegionError) {}
                    override fun mapboxTileCountLimitExceeded(limit: Long) {}
                })
                region.setDownloadState(OfflineRegion.STATE_ACTIVE)
            }
            override fun onError(error: String) { report(o.getString("name"), -1, 0) }
        })
    }

    private fun report(name: String, status: Int, pct: Int) =
        activity.jsCall("TravelOS.onOfflineMap", JSONObject().put("city", name).put("status", status).put("pct", pct).toString())

    /** Nombre de tuiles de la zone entre deux niveaux de zoom (projection de Mercator). */
    private fun tiles(b: LatLngBounds, z0: Int, z1: Int): Long {
        fun x(lng: Double, z: Int) = floor((lng + 180.0) / 360.0 * (1 shl z)).toLong()
        fun y(lat: Double, z: Int): Long {
            val r = Math.toRadians(lat)
            return floor((1 - ln(tan(r) + 1 / cos(r)) / Math.PI) / 2 * (1 shl z)).toLong()
        }
        var n = 0L
        for (z in z0..z1) n += (x(b.longitudeEast, z) - x(b.longitudeWest, z) + 1) * (y(b.latitudeSouth, z) - y(b.latitudeNorth, z) + 1)
        return n
    }

    /* ---------------- cycle de vie ---------------- */

    fun onResume() { resumed = true; mapView?.onResume() }
    fun onPause() { resumed = false; mapView?.onPause(); stopFix() }
    fun onDestroy() { stopFix(); mapView?.onStop(); mapView?.onDestroy() }

    /* ---------------- dessin ---------------- */

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

    /** Mention obligatoire d'OpenStreetMap, toujours visible. */
    private fun attribution() = TextView(ctx).apply {
        text = "© les contributeurs d'OpenStreetMap"
        setTextColor(Color.parseColor("#3A3A3C"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        setPadding(dp(8), dp(3), dp(8), dp(3))
        background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(Color.argb(200, 255, 255, 255)) }
    }

    /** Repère en goutte, numéroté ; la prochaine étape est plus grande, avec un liseré épais. */
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

    private fun dp(v: Int) = (v * density).toInt()
    private fun px(css: Double) = (css * density).toInt()
}
