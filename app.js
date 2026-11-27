import { horizonProfile, hillTimes } from './terrain.js';
import { SkyCard, WeatherFX } from './fx.js';

// ───────────────────────── visitor counter (GoatCounter: free, anonymous, no cookies) ─────────────────────────
// Your stats: https://<name>.goatcounter.com. Only counts and app actions are sent, never what anyone searches or where they are.
const GOATCOUNTER = 'sunscoutapp';   // ← your GoatCounter name, e.g. 'sunscout'
if (GOATCOUNTER && /github\.io$/.test(location.hostname)) {
  const sc = document.createElement('script'); sc.async = true; sc.src = 'https://gc.zgo.at/count.js';
  sc.dataset.goatcounter = `https://${GOATCOUNTER}.goatcounter.com/count`;
  document.head.appendChild(sc);
}
const tracked = new Set();
function track(name, once = true) {   // counts an action, like "opened Street view" (once per visit by default)
  if (!GOATCOUNTER || (once && tracked.has(name))) return; tracked.add(name);
  const send = () => window.goatcounter?.count?.({ path: 'action/' + name, title: name, event: true });
  window.goatcounter?.count ? send() : setTimeout(send, 3000);
}
// Sun Scout — main app: shared time/location state, map view, live clouds, forecast, panels.
const $ = id => document.getElementById(id);
const D2R = Math.PI / 180, deg = r => r / D2R;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
SunCalc.addTime(-4, 'blueEndAM', 'blueStartPM'); // blue hour ≈ sun between −6° and −4°

const state = {
  lat: 18.922, lng: 72.8347, label: 'Gateway of India, Mumbai',
  offset: 19800,            // seconds from UTC at the location (from the forecast API)
  date: '', minutes: 0,     // local date (YYYY-MM-DD) + minutes after local midnight
  weather: null, view: 'map', useWx: true, horizon: null, hill: null,
};

// reopen where you were last time (handy on the phone)
try { const last = JSON.parse(localStorage.getItem('sunscout-last') || 'null'); if (last && isFinite(last.lat) && isFinite(last.lng)) Object.assign(state, { lat: last.lat, lng: last.lng, label: last.label || '' }); } catch { /* no storage */ }

// ───────────────────────── time helpers (everything shown in the location's local time) ─────────────────────────
const localParts = d => { const x = new Date(d.getTime() + state.offset * 1000); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes() }; };
const pad2 = n => String(n).padStart(2, '0');
const fmt = d => { if (!d || isNaN(d)) return '—'; const p = localParts(d); return pad2(p.h) + ':' + pad2(p.min); };
const fmtMin = m => pad2(Math.floor(m / 60)) + ':' + pad2(Math.floor(m % 60));
const dayStartUTC = () => { const [y, m, d] = state.date.split('-').map(Number); return Date.UTC(y, m - 1, d) - state.offset * 1000; };
const selected = () => new Date(dayStartUTC() + state.minutes * 60000);
const minutesOf = d => (d - dayStartUTC()) / 60000;
const sunTimes = () => SunCalc.getTimes(new Date(dayStartUTC() + 12 * 3600000), state.lat, state.lng);
const sunAt = d => SunCalc.getPosition(d, state.lat, state.lng);
const bearingOf = az => (deg(az) + 180 + 360) % 360; // SunCalc azimuth is measured from south
// true when the sun is up but hidden behind hills (needs the terrain horizon)
const sunBlocked = d => { const h = state.horizon; if (!h) return false; const p = sunAt(d), a = deg(p.altitude); return a > -1 && a + (state.sunOff || 0) < h.prof[Math.round(bearingOf(p.azimuth)) % 360]; };
const compass = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((b % 360) + 360) % 360 / 45) % 8];

function setNow() {
  const p = localParts(new Date());
  state.date = `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`;
  state.minutes = p.h * 60 + p.min;
  $('date').value = state.date; $('t').value = state.minutes;
  const max = new Date(Date.UTC(p.y, p.m, p.d + 15)); $('date').max = max.toISOString().slice(0, 10);
}

// ───────────────────────── map ─────────────────────────
const map = L.map('map', { zoomControl: true }).setView([state.lat, state.lng], 17);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
map.createPane('clouds').style.zIndex = 450;
const sunLayer = L.layerGroup().addTo(map);

function pointAt(bearing, px) {
  const c = map.latLngToContainerPoint([state.lat, state.lng]), r = bearing * D2R;
  return map.containerPointToLatLng(L.point(c.x + Math.sin(r) * px, c.y - Math.cos(r) * px));
}
function drawSunOnMap() {
  if (state.view !== 'map') return;
  sunLayer.clearLayers();
  if (map.getZoom() < 12) {   // zoomed out (e.g. watching clouds): just mark the spot
    L.circleMarker([state.lat, state.lng], { radius: 7, color: '#fff', fillColor: '#e5604d', fillOpacity: 1, weight: 2 }).addTo(sunLayer);
    return;
  }
  const size = map.getSize(), R = Math.min(size.x, size.y) * 0.36, center = [state.lat, state.lng];
  const onDome = p => pointAt(bearingOf(p.azimuth), R * (1 - p.altitude / (Math.PI / 2)));
  const ring = []; for (let b = 0; b <= 360; b += 5) ring.push(pointAt(b, R));
  L.polyline(ring, { color: '#fff', weight: 1, opacity: .35, dashArray: '4 6', interactive: false }).addTo(sunLayer);
  ['N', 'E', 'S', 'W'].forEach((t, i) => L.marker(pointAt(i * 90, R + 14), { interactive: false, icon: L.divIcon({ className: '', html: `<div style="color:#fff;font-weight:800;text-shadow:0 0 4px #000;transform:translate(-50%,-50%)">${t}</div>` }) }).addTo(sunLayer));
  const t = sunTimes();
  [t.sunrise, t.sunset].forEach(d => { if (!isNaN(d)) L.polyline([center, pointAt(bearingOf(sunAt(d).azimuth), R)], { color: '#ff7a59', weight: 3, opacity: .9, interactive: false }).addTo(sunLayer); });
  const arc = [], start = dayStartUTC();
  for (let m = 0; m <= 1440; m += 5) { const p = sunAt(new Date(start + m * 60000)); if (p.altitude > 0) arc.push(onDome(p)); }
  if (arc.length) L.polyline(arc, { color: '#ffb02e', weight: 4, opacity: .95, interactive: false }).addTo(sunLayer);
  for (let h = 0; h < 24; h++) { const p = sunAt(new Date(start + h * 3600000)); if (p.altitude > 0) L.circleMarker(onDome(p), { radius: 3, color: '#fff', weight: 1, fillColor: '#ffb02e', fillOpacity: 1 }).bindTooltip(fmtMin(h * 60)).addTo(sunLayer); }
  const now = sunAt(selected());
  if (now.altitude > 0) {
    const b = bearingOf(now.azimuth), sp = onDome(now);
    L.polyline([center, pointAt((b + 180) % 360, Math.min(R, 40 / Math.tan(now.altitude)))], { color: '#111', weight: 6, opacity: .65, interactive: false }).addTo(sunLayer);
    L.polyline([center, sp], { color: '#ffcf6b', weight: 3, interactive: false }).addTo(sunLayer);
    L.marker(sp, { interactive: false, icon: L.divIcon({ className: '', html: '<div style="font-size:26px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 6px #ffb02e)">☀️</div>' }) }).addTo(sunLayer);
  }
  L.circleMarker(center, { radius: 6, color: '#fff', fillColor: '#e5604d', fillOpacity: 1, weight: 2 }).addTo(sunLayer);
}
map.on('zoomend moveend resize', drawSunOnMap);
map.on('click', e => {
  const { lat, lng } = e.latlng;
  if (state.pendingName) {
    const name = state.pendingName; endPickMode();
    savePlace(name, lat, lng, 'Picked on the map');
    setLocation(lat, lng, name);
    $('place').textContent = `⭐ Saved “${name}”. It will come up in search from now on.`;
    toast(`⭐ Saved “${name}”. Tap ⭐ next to search to come back to it.`);
    setTimeout(() => { $('place').textContent = '📍 ' + name; }, 5000);
    return;
  }
  setLocation(lat, lng, null);
});
function startPickMode(name, nearArea) {
  name = (name || '').trim().slice(0, 80); if (!name) return;
  hideSugs(); $('q').blur();
  state.pendingName = name;
  if (state.view !== 'map') switchView('map');
  if (!nearArea && map.getZoom() < 15) map.setZoom(16);
  $('pickText').textContent = nearArea ? `This is the area. Tap the exact spot of “${name}” to save it.` : `Move the map to “${name}” and tap its exact spot. Sun Scout will remember it.`;
  $('pickBar').classList.remove('hidden');
}
function endPickMode() { state.pendingName = null; $('pickBar').classList.add('hidden'); }

// ───────────────────────── live satellite clouds (EUMETSAT Meteosat Indian Ocean, every 15 min) ─────────────────────────
const EUM = 'https://view.eumetsat.int/geoserver/wms';
const CloudLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 256; tile.className = 'cloud-tile';
    const s = this.getTileSize();
    const a = L.CRS.EPSG3857.project(this._map.unproject(coords.scaleBy(s), coords.z));
    const b = L.CRS.EPSG3857.project(this._map.unproject(coords.add([1, 1]).scaleBy(s), coords.z));
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = tile.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256), p = d.data;
      for (let i = 0; i < p.length; i += 4) {               // infrared: bright = cold cloud tops, dark = warm ground
        const g = p[i], alpha = clamp((g - 95) / 110, 0, 1);
        const storm = clamp((g - 215) / 40, 0, 1);         // very cold tops = tall storm clouds → tint blue-violet
        p[i] = 255 - storm * 90; p[i + 1] = 255 - storm * 70; p[i + 2] = 255;
        p[i + 3] = Math.pow(alpha, 0.8) * 235;
      }
      ctx.putImageData(d, 0, 0); done(null, tile);
    };
    img.onerror = () => done(null, tile);
    img.src = `${EUM}?service=WMS&version=1.3.0&request=GetMap&layers=msg_iodc:ir108&styles=&format=image/png&crs=EPSG:3857&bbox=${a.x},${b.y},${b.x},${a.y}&width=256&height=256&time=${this.options.time}`;
    return tile;
  }
});
const clouds = { on: false, frames: [], idx: 0, timer: null, latest: null };
async function latestSatTime() {
  if (clouds.latest && Date.now() - clouds.fetchedAt < 5 * 60000) return clouds.latest;
  const txt = await fetch(`https://view.eumetsat.int/geoserver/msg_iodc/ir108/wms?service=WMS&request=GetCapabilities&version=1.3.0`).then(r => r.text());
  const m = txt.match(/name="time" default="([^"]+)"/);
  clouds.latest = m ? new Date(m[1]) : new Date(Math.floor((Date.now() - 30 * 60000) / 900000) * 900000);
  clouds.fetchedAt = Date.now();
  return clouds.latest;
}
async function cloudsOn() {
  clouds.on = true; $('cloudBtn').classList.add('on'); $('cloudBar').classList.remove('hidden'); $('cloudTime').textContent = 'loading…';
  try {
    const latest = await latestSatTime();
    clouds.frames.forEach(f => map.removeLayer(f.layer));
    clouds.frames = [];
    for (let k = 8; k >= 0; k--) {
      const t = new Date(latest - k * 15 * 60000);
      const layer = new CloudLayer({ pane: 'clouds', time: t.toISOString(), maxNativeZoom: 8, opacity: 0, updateWhenIdle: true, keepBuffer: 1 }).addTo(map);
      clouds.frames.push({ t, layer });
    }
    if (map.getZoom() > 10) map.flyTo([state.lat, state.lng], 7, { duration: 1.2 });
    clouds.idx = clouds.frames.length - 1; showCloudFrame();
    startCloudLoop();
  } catch (e) { $('cloudTime').textContent = 'satellite unavailable'; }
}
function cloudsOff() {
  clouds.on = false; stopCloudLoop();
  clouds.frames.forEach(f => map.removeLayer(f.layer)); clouds.frames = [];
  $('cloudBtn').classList.remove('on'); $('cloudBar').classList.add('hidden');
}
function showCloudFrame() {
  clouds.frames.forEach((f, i) => f.layer.setOpacity(i === clouds.idx ? 1 : 0));
  const f = clouds.frames[clouds.idx]; if (!f) return;
  const ago = Math.round((Date.now() - f.t) / 60000);
  $('cloudTime').textContent = `${fmt(f.t)} local · ${ago < 90 ? ago + ' min ago' : Math.round(ago / 60) + ' h ago'}${clouds.idx === clouds.frames.length - 1 ? ' · latest' : ''}`;
}
function startCloudLoop() {
  stopCloudLoop(); $('cloudPlay').textContent = '⏸';
  clouds.timer = setInterval(() => { clouds.idx = (clouds.idx + 1) % clouds.frames.length; showCloudFrame(); }, clouds.idx === clouds.frames.length - 1 ? 700 : 700);
}
function stopCloudLoop() { clearInterval(clouds.timer); clouds.timer = null; $('cloudPlay').textContent = '▶'; }
$('cloudBtn').onclick = () => { track('live clouds'); if (clouds.on) return cloudsOff(); if (fc.on) fcOff(); cloudsOn(); };
$('cloudPlay').onclick = () => clouds.timer ? (stopCloudLoop(), clouds.idx = clouds.frames.length - 1, showCloudFrame()) : startCloudLoop();

// rain radar (RainViewer)
let radar = null;
$('radarBtn').onclick = async () => { track('rain radar');
  if (radar) { map.removeLayer(radar); radar = null; $('radarBtn').classList.remove('on'); return; }
  try {
    const j = await fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json());
    const last = j.radar.past[j.radar.past.length - 1];
    radar = L.tileLayer(`${j.host}${last.path}/256/{z}/{x}/{y}/4/1_1.png`, { pane: 'clouds', opacity: .75, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar © RainViewer' }).addTo(map);
    $('radarBtn').classList.add('on');
    if (map.getZoom() > 10) map.flyTo([state.lat, state.lng], 7, { duration: 1.2 });
  } catch (e) { alert('Rain radar is unavailable right now.'); }
};

// ───────────────────────── 🔮 forecast clouds on the map (any hour, up to 16 days ahead) ─────────────────────────
// A 7×7 grid of forecasts (~90 km across) from Open-Meteo, drawn as clouds + rain and blended between hours so it moves
// smoothly with the time slider. Arrows show which way the clouds are drifting (wind at cloud height, 850 hPa).
const fc = { on: false, data: null, key: '', layer: null, arrows: L.layerGroup(), N: 7, stepLat: 0.135, canvas: document.createElement('canvas'), loading: null };
fc.canvas.width = fc.canvas.height = 168;
async function fcLoad() {
  const key = `${state.lat.toFixed(2)},${state.lng.toFixed(2)}`;
  if (fc.data && fc.key === key) return;
  if (fc.loading && fc.loadingKey === key) return fc.loading;
  const N = fc.N, half = (N - 1) / 2, dLat = fc.stepLat, dLng = fc.stepLat / Math.cos(state.lat * D2R);
  const lats = [], lngs = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { lats.push((state.lat + (half - j) * dLat).toFixed(3)); lngs.push((state.lng + (i - half) * dLng).toFixed(3)); }
  fc.loadingKey = key;
  fc.loading = (async () => {
    $('fcNote').textContent = 'Loading the forecast map…';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lngs.join(',')}&hourly=cloud_cover,cloud_cover_low,precipitation,wind_speed_850hPa,wind_direction_850hPa&timezone=auto&forecast_days=16`;
    const d = await fetch(url).then(r => r.json());
    if (!Array.isArray(d)) throw new Error(d.reason || 'no data');
    fc.data = { pts: d, lat0: state.lat + half * dLat, lng0: state.lng - half * dLng, dLat, dLng }; fc.key = key;
  })();
  try { await fc.loading; } finally { fc.loading = null; }
}
function fcValuesAt(k, idx) {   // [cloudiness 0..1, rain mm] for grid point k at hour index idx
  const h = fc.data.pts[k].hourly, cc = h.cloud_cover[idx], low = h.cloud_cover_low[idx], pr = h.precipitation[idx];
  if (cc == null) return null;
  return [Math.min(1, (0.55 * (low ?? cc) + 0.45 * cc) / 100), pr ?? 0];
}
function fcRender() {
  if (!fc.on || !fc.data) return;
  const times = fc.data.pts[0].hourly.time, h0 = Math.floor(state.minutes / 60), f = (state.minutes % 60) / 60;
  const i0 = times.indexOf(`${state.date}T${pad2(h0)}:00`), i1 = h0 < 23 ? i0 + 1 : i0;
  const dayName = new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (i0 < 0) {
    if (fc.layer) fc.layer.setOpacity(0); fc.arrows.clearLayers(); fc.grid = null; updateFX();
    $('fcTime').textContent = `🔮 ${dayName}: no forecast`; $('fcNote').textContent = 'Forecasts reach about 16 days ahead. Pick a nearer date.';
    return;
  }
  const N = fc.N, W = fc.canvas.width, g = fc.canvas.getContext('2d'), img = g.createImageData(W, W), px = img.data;
  const val = [], rain = [];
  for (let k = 0; k < N * N; k++) {
    const a = fcValuesAt(k, i0), b = fcValuesAt(k, i1) || a;
    val.push(a ? a[0] * (1 - f) + b[0] * f : 0); rain.push(a ? a[1] * (1 - f) + b[1] * f : 0);
  }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {   // smooth (bilinear) between the grid points
    const gx = x / (W - 1) * (N - 1), gy = y / (W - 1) * (N - 1), xi = Math.min(N - 2, Math.floor(gx)), yi = Math.min(N - 2, Math.floor(gy)), fx = gx - xi, fy = gy - yi;
    const at = (arr) => (arr[yi * N + xi] * (1 - fx) + arr[yi * N + xi + 1] * fx) * (1 - fy) + (arr[(yi + 1) * N + xi] * (1 - fx) + arr[(yi + 1) * N + xi + 1] * fx) * fy;
    const c = at(val), r = Math.min(1, at(rain) / 2), o = (y * W + x) * 4;
    const edge = Math.min(1, Math.min(x, y, W - 1 - x, W - 1 - y) / (W * 0.12));   // soft edges
    const a = Math.max(0, Math.min(1, (c - 0.12) / 0.75)) * edge;
    px[o] = 255 - r * 170; px[o + 1] = 255 - r * 120; px[o + 2] = 255; px[o + 3] = Math.round(Math.max(a * 210, r * 220 * edge));
  }
  g.putImageData(img, 0, 0);
  fc.grid = rain; fc.rainMax = Math.max(...rain); updateFX();
  const { lat0, lng0, dLat, dLng } = fc.data, half = dLat / 2, halfL = dLng / 2;
  const bounds = [[lat0 - (N - 1) * dLat - half, lng0 - halfL], [lat0 + half, lng0 + (N - 1) * dLng + halfL]];
  const url = fc.canvas.toDataURL();
  if (!fc.layer) fc.layer = L.imageOverlay(url, bounds, { pane: 'clouds', opacity: 1, className: 'cloud-tile' }).addTo(map);
  else { fc.layer.setUrl(url); fc.layer.setBounds(L.latLngBounds(bounds)); fc.layer.setOpacity(1); }
  // drift arrows: wind blows FROM wind_direction, clouds move the opposite way
  if (fc.arrowHour !== `${state.date}${h0}`) {
    fc.arrowHour = `${state.date}${h0}`; fc.arrows.clearLayers();
    for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) {
      const h = fc.data.pts[j * N + i].hourly, dir = h.wind_direction_850hPa[i0], spd = h.wind_speed_850hPa[i0];
      if (dir == null) continue;
      const size = 12 + Math.min(14, (spd || 0) / 3);
      L.marker([lat0 - j * dLat, lng0 + i * dLng], { interactive: false, pane: 'clouds', icon: L.divIcon({ className: '', iconSize: [size, size], html: `<div class="wind" style="font-size:${size}px;transform:rotate(${(dir + 180) % 360 - 90}deg)">➜</div>` }) }).addTo(fc.arrows);
    }
  }
  const here = fcValuesAt((N * N - 1) / 2, i0), spdHere = fc.data.pts[(N * N - 1) / 2].hourly.wind_speed_850hPa[i0];
  $('fcTime').textContent = `🔮 ${dayName} · ${fmtMin(state.minutes)}`;
  $('fcNote').textContent = here ? `Here: ${Math.round(here[0] * 100)}% cloud${here[1] > 0.2 ? ', rain' : ''} · clouds drifting at ${Math.round(spdHere || 0)} km/h (arrows)` : '';
}
async function fcOn() {
  if (clouds.on) cloudsOff();
  fc.on = true; $('fcBtn').classList.add('on'); $('fcBar').classList.remove('hidden'); fc.arrows.addTo(map);
  if (map.getZoom() > 10) map.flyTo([state.lat, state.lng], 9, { duration: 1.2 });
  try { await fcLoad(); fc.arrowHour = null; fcRender(); }
  catch (e) { $('fcTime').textContent = '🔮 Forecast map unavailable'; $('fcNote').textContent = 'Check your connection and try again.'; }
}
function fcOff() {
  fc.on = false; fc.grid = null; $('fcBtn').classList.remove('on'); $('fcBar').classList.add('hidden'); updateFX();
  if (fc.layer) { map.removeLayer(fc.layer); fc.layer = null; } fc.arrows.clearLayers(); map.removeLayer(fc.arrows);
}
$('fcBtn').onclick = () => { track('forecast clouds'); fc.on ? fcOff() : fcOn(); };

// "Right now, from space": read the satellite cloud mask at the exact spot
async function checkLiveSky() {
  const box = $('liveSky'); box.textContent = 'Checking the latest satellite image…';
  try {
    const t = await latestSatTime();
    const p = L.CRS.EPSG3857.project(L.latLng(state.lat, state.lng)), h = 3000;
    const q = (layer) => `${EUM}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}&styles=&crs=EPSG:3857&bbox=${p.x - h},${p.y - h},${p.x + h},${p.y + h}&width=3&height=3&i=1&j=1&info_format=application/json&time=${t.toISOString()}`;
    const [mask, ir] = await Promise.all([fetch(q('msg_iodc:clm')).then(r => r.json()), fetch(q('msg_iodc:ir108')).then(r => r.json()).catch(() => null)]);
    const c = mask.features[0].properties, ago = Math.round((Date.now() - t) / 60000);
    const g = ir && ir.features[0] ? (ir.features[0].properties.GRAY_INDEX ?? ir.features[0].properties.RED_BAND ?? null) : null;
    const isCloud = c.RED_BAND > 200 && c.GREEN_BAND > 200 && c.BLUE_BAND > 200;
    const isClear = !isCloud && (c.GREEN_BAND > 100 || c.BLUE_BAND > 100);
    let html;
    if (isCloud) {
      const thick = g != null && g > 190;
      html = `<span class="big">☁️ Cloud over this spot</span>${thick ? 'Thick, high cloud: the sun is probably hidden.' : 'Thin or low cloud: hazy or broken sun.'}`;
    } else if (isClear) html = `<span class="big">☀️ Clear sky over this spot</span>No cloud seen here right now.`;
    else html = `<span class="big">❔ No reading</span>The satellite has no data for this spot.`;
    box.innerHTML = html + `<div class="note" style="margin-top:4px">Meteosat · ${fmt(t)} (${ago} min ago) · sees areas about 3 km wide</div>`;
  } catch (e) { box.textContent = 'Satellite check unavailable right now.'; }
}
$('liveRefresh').onclick = () => { clouds.latest = null; checkLiveSky(); };

// ───────────────────────── forecast (Open-Meteo) ─────────────────────────
const wxText = c => c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Overcast' : c <= 48 ? 'Fog' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : 'Thunderstorm';
async function loadWeather() {
  $('wxNow').textContent = 'Loading forecast…';
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat.toFixed(4)}&longitude=${state.lng.toFixed(4)}&hourly=cloud_cover,cloud_cover_low,precipitation_probability,precipitation,weather_code,temperature_2m&timezone=auto&forecast_days=16`;
    const j = await fetch(url).then(r => r.json());
    if (j.error) throw new Error(j.reason);
    const changed = state.offset !== j.utc_offset_seconds;
    state.weather = j; state.offset = j.utc_offset_seconds; $('wxNow').textContent = '';
    loadModels();
    if (changed) setNow();
  } catch (e) { state.weather = null; $('wxNow').textContent = 'Forecast unavailable: ' + e.message; }
  update();
}
// ── forecast confidence: compare three independent weather models for the same spot ──
const MODELS = [['ecmwf_ifs025', 'ECMWF (Europe)'], ['gfs_seamless', 'GFS (USA)'], ['icon_seamless', 'ICON (Germany)']];
const CAT = { sun: '☀️ sunny', mixed: '⛅ some cloud', cloud: '☁️ overcast', rain: '🌧️ rain' };
let modelSeq = 0;
async function loadModels() {
  const my = ++modelSeq; state.models = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat.toFixed(4)}&longitude=${state.lng.toFixed(4)}&hourly=cloud_cover,cloud_cover_low,precipitation&models=${MODELS.map(m => m[0]).join(',')}&timezone=auto&forecast_days=16`;
    const j = await fetch(url).then(r => r.json());
    if (j.error || my !== modelSeq) return;
    state.models = j; update();
  } catch (e) { /* confidence is a bonus: the main forecast still works */ }
}
function modelsAt(dayStr, hour) {
  const m = state.models; if (!m) return [];
  const i = m.hourly.time.indexOf(`${dayStr}T${pad2(hour)}:00`); if (i < 0) return [];
  const out = [];
  for (const [id, name] of MODELS) {
    const cc = m.hourly[`cloud_cover_${id}`]?.[i], low = m.hourly[`cloud_cover_low_${id}`]?.[i], pr = m.hourly[`precipitation_${id}`]?.[i];
    if (cc == null || low == null) continue;
    out.push({ name, cat: (pr ?? 0) > 0.3 ? 'rain' : (low < 25 && cc < 45) ? 'sun' : low < 60 ? 'mixed' : 'cloud' });
  }
  return out;
}
function confidenceAt(dayStr, hour) {
  const ms = modelsAt(dayStr, hour); if (!ms.length) return null;
  const count = {}; ms.forEach(m => count[m.cat] = (count[m.cat] || 0) + 1);
  const [cat, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return { cat, agree: n, total: ms.length, odd: ms.filter(m => m.cat !== cat) };
}
function renderConfidence(t) {
  if (!state.models) { $('confNow').textContent = state.weather ? 'Comparing 3 weather models…' : ''; $('bestWindow').textContent = ''; state.best = null; return null; }
  const sel = Math.floor(state.minutes / 60);
  const c = confidenceAt(state.date, sel);
  if (!c) { $('confNow').textContent = 'Model comparison isn\'t available this far ahead.'; }
  else if (c.agree === c.total && c.total > 1) $('confNow').innerHTML = `<b>${fmtMin(sel * 60)}</b> · all ${c.total} weather models say <b>${CAT[c.cat]}</b>`;
  else if (c.agree >= 2) $('confNow').innerHTML = `<b>${fmtMin(sel * 60)}</b> · ${c.agree} of ${c.total} models say <b>${CAT[c.cat]}</b> (${c.odd.map(o => `${o.name.split(' ')[0]}: ${CAT[o.cat]}`).join(', ')})`;
  else $('confNow').innerHTML = `<b>${fmtMin(sel * 60)}</b> · models disagree (${modelsAt(state.date, sel).map(o => CAT[o.cat]).join(' / ')}). Keep a backup plan.`;

  // most reliable sunny stretch of daylight today
  const runs = []; let cur = null;
  for (let h = 0; h < 24; h++) {
    const mid = new Date(dayStartUTC() + (h * 60 + 30) * 60000), up = mid > t.sunrise && mid < t.sunset;
    const k = confidenceAt(state.date, h), level = !up || !k || k.cat !== 'sun' ? 0 : k.agree === k.total ? 2 : k.agree >= 2 ? 1 : 0;
    if (level && cur && cur.level === level) cur.end = h; else { if (cur) runs.push(cur); cur = level ? { start: h, end: h, level } : null; }
  }
  if (cur) runs.push(cur);
  const best0 = runs.filter(r => r.level === 2).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] || runs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const best = best0; state.best = best ? best.start : null;
  $('bestWindow').innerHTML = best
    ? `☀️ Best sun ${(() => { const p = localParts(new Date()); return state.date === `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}` ? 'today' : 'on ' + new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); })()}: <b>${fmtMin(best.start * 60)}–${fmtMin((best.end + 1) * 60)}</b>${best.level === 2 ? ' · all models agree' : ' · 2 of 3 models agree'}`
    : '☁️ No clearly sunny stretch this day: expect soft light.';
  return c;
}

function wxAt(dayStr, hour) {
  const w = state.weather; if (!w) return null;
  const i = w.hourly.time.indexOf(`${dayStr}T${pad2(hour)}:00`); if (i < 0) return null;
  return { cc: w.hourly.cloud_cover[i], low: w.hourly.cloud_cover_low[i], pp: w.hourly.precipitation_probability[i] ?? 0, pr: w.hourly.precipitation[i] ?? 0, code: w.hourly.weather_code[i], temp: w.hourly.temperature_2m[i] };
}
const isRain = x => x && (x.pr > 0.2 || x.pp >= 60);
// 0 = clear, 1 = fully overcast; drives the 3D lighting
// cloud over the sun at this minute: blended between forecast hours, so the light changes smoothly as you drag the time
function cloudFactor() {
  if (!state.useWx) return 0;
  const cf = h => { const x = wxAt(state.date, h); return x ? clamp((0.7 * x.low + 0.3 * x.cc) / 100 + (isRain(x) ? 0.2 : 0), 0, 1) : null; };
  const h = state.minutes / 60, h0 = Math.floor(h), a = cf(h0); if (a == null) return 0;
  const b = h0 < 23 ? cf(h0 + 1) : null;
  return b == null ? a : a + (b - a) * (h - h0);
}

// ───────────────────────── panels ─────────────────────────
const LIGHT = [[-6, '🌙', 'Night'], [0, '💙', 'Blue hour'], [6, '🔥', 'Golden'], [20, '😎', 'Directional'], [50, '🙂', 'Neutral'], [91, '🥵', 'Harsh']];
const lightOf = a => LIGHT.find(l => a < l[0]);
function score(a, x, blocked) {
  if (a < -6) return ['🌙 Night', 'The sun is down. Use practicals or city light.', '#141a2e'];
  if (a < 0) return ['💙 Blue hour', 'Soft, cool, shadowless light. Moody city shots.', '#16224a'];
  if (blocked && a > 0) return ['⛰️ Sun behind the hills', 'Up, but hidden by terrain: soft light here. ' + (state.hill?.rise != null && state.minutes < state.hill.rise ? `Direct sun at ${fmtMin(state.hill.rise)}.` : 'No more direct sun today.'), '#1e2a2a'];
  if (x && x.code >= 95) return ['⛈️ Thunderstorm', `${x.pp}% chance of rain. Plan cover and a backup.`, '#1d1a3a'];
  if (isRain(x)) return ['🌧️ Rain likely', `${x.pp}% chance of rain this hour. Plan cover or a backup.`, '#13243f'];
  if (x && x.low >= 70) return ['☁️ Soft, flat light', 'Overcast: no hard shadows, even exposure, kind to skin.', '#23262d'];
  const some = x && x.low >= 25 ? ' Clouds may pass.' : '';
  if (a < 6) return ['🔥 Golden light!', 'Warm, low sun and long shadows. Beauty-shot time.' + some, '#3a2508'];
  if (a < 20) return ['😎 Lovely directional light', 'Low angle with strong texture and shape.' + some, '#2f2810'];
  if (a < 50) return ['🙂 Good daylight', 'Clean, neutral light. Watch for squinting.' + some, '#1f2a1c'];
  return ['🥵 Harsh overhead sun', 'Short shadows, dark eyes. Diffuse it or find shade.' + some, '#3a1c14'];
}
const isSnow = x => x && ((x.code >= 71 && x.code <= 77) || x.code === 85 || x.code === 86);
function wxIcon(x, up) {
  if (!x) return '·';
  if (x.code >= 95) return '⛈️';
  if (isSnow(x)) return '🌨️';
  if (isRain(x)) return '🌧️';
  if (x.code === 45 || x.code === 48) return '🌫️';
  if (x.low >= 70 || x.cc >= 85) return '☁️';
  if (x.cc >= 35 || x.low >= 25) return up ? '⛅' : '☁️';
  return up ? '☀️' : '🌙';
}
// weather at this exact minute for the animations: what it's doing here, blended a little across the hour
function skyWeather() {
  const x = wxAt(state.date, Math.floor(state.minutes / 60));
  if (!x) return { cloud: 0, rain: 0, snow: false, storm: false, fog: false, x };
  const rain = isRain(x) ? clamp(0.3 + x.pr / 3, 0.3, 1) : 0;
  return { cloud: clamp((0.6 * x.low + 0.4 * x.cc) / 100, 0, 1), rain, snow: isSnow(x), storm: x.code >= 95, fog: x.code === 45 || x.code === 48, x };
}
function sliderGradient() {
  const stops = [], start = dayStartUTC();
  for (let m = 0; m <= 1440; m += 30) {
    const a = deg(sunAt(new Date(start + m * 60000)).altitude);
    const c = a < -6 ? '#101425' : a < 0 ? '#2b4a9c' : a < 6 ? '#ff9a2e' : a < 20 ? '#ffd27a' : '#fff1c9';
    stops.push(`${c} ${(m / 1440 * 100).toFixed(1)}%`);
  }
  const g = `linear-gradient(90deg, ${stops.join(',')})`;
  $('sliderBg').style.background = g; $('dayBar').style.background = g;
}
function buildChips() {
  const t = sunTimes();
  const list = [['Now', null], ['🌅 Sunrise', t.sunrise], ['✨ Golden AM', new Date(+t.sunrise + 20 * 60000)], ['☀️ Noon', t.solarNoon], ['✨ Golden PM', new Date(+t.goldenHour + 15 * 60000)], ['🌇 Sunset', t.sunset], ['💙 Blue hour', t.blueStartPM]];
  $('chips').innerHTML = '';
  list.forEach(([label, d]) => {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = () => { stopPlay(); if (!d) { setNow(); onDayChange(); } else { state.minutes = clamp(Math.round(minutesOf(d)), 0, 1439); $('t').value = state.minutes; update(); } };
    $('chips').appendChild(b);
  });
}

function update() {
  const d = selected(), p = sunAt(d), a = deg(p.altitude), b = bearingOf(p.azimuth);
  $('tLabel').textContent = fmt(d);
  $('az').textContent = `${compass(b)} ${b.toFixed(0)}°`;
  $('alt').textContent = a > 0 ? `${a.toFixed(0)}°` : 'down';
  $('shadow').textContent = a > 0.5 ? `${Math.min(99, 1 / Math.tan(p.altitude)).toFixed(1)}×` : '—';
  $('dirArrow').setAttribute('transform', `rotate(${b} 20 20)`);
  const altR = clamp(a, 0, 90) * D2R; $('altArrow').querySelector('line').setAttribute('x2', 6 + 24 * Math.cos(altR)); $('altArrow').querySelector('line').setAttribute('y2', 32 - 24 * Math.sin(altR));
  $('altArrow').querySelector('circle').setAttribute('cx', 6 + 24 * Math.cos(altR)); $('altArrow').querySelector('circle').setAttribute('cy', 32 - 24 * Math.sin(altR));
  $('shadowBar').setAttribute('width', a > 0.5 ? clamp(21 / Math.tan(p.altitude), 1.5, 24) : 0);

  const t = sunTimes();
  $('rise').textContent = fmt(t.sunrise); $('set').textContent = fmt(t.sunset);
  $('goldAM').textContent = fmt(t.sunrise) + '–' + fmt(t.goldenHourEnd);
  $('goldPM').textContent = fmt(t.goldenHour) + '–' + fmt(t.sunset);
  $('blueAM').textContent = fmt(t.dawn) + '–' + fmt(t.blueEndAM);
  $('bluePM').textContent = fmt(t.blueStartPM) + '–' + fmt(t.dusk);
  $('dayNeedle').style.left = (state.minutes / 1440 * 100) + '%';
  const inWin = (s, e) => state.minutes >= minutesOf(s) && state.minutes < minutesOf(e);
  document.querySelectorAll('.mom').forEach(m => m.classList.remove('now'));
  const momNow = inWin(t.dawn, t.blueEndAM) ? 0 : inWin(t.sunrise, t.goldenHourEnd) ? 2 : inWin(t.goldenHour, t.sunset) ? 3 : inWin(t.blueStartPM, t.dusk) ? 5 : -1;
  if (momNow >= 0) document.querySelectorAll('.mom')[momNow].classList.add('now');

  // hour-by-hour strip (built once per day / forecast, then only the highlight moves)
  const sel = Math.floor(state.minutes / 60), x = wxAt(state.date, sel);
  renderHours(t, sel);

  const blocked = sunBlocked(d);
  const L = a > 0 && (blocked || (x && (x.low >= 70 || isRain(x)))) ? [0, '☁️', 'Soft'] : lightOf(a);
  $('quality').textContent = L[2]; $('lightIco').textContent = L[1];
  if (blocked) { $('shadow').textContent = '—'; $('shadowBar').setAttribute('width', 0); }
  const [title, sub, bg] = score(a, x, blocked);
  const conf = renderConfidence(t);
  $('heroTitle').textContent = title; $('heroSub').textContent = sub;
  $('hero').style.setProperty('--tint', bg);
  const cc = $('heroConf');
  if (!conf || a < -6) cc.classList.add('hidden');
  else { cc.classList.remove('hidden'); cc.className = 'confchip ' + (conf.agree === conf.total && conf.total > 1 ? 'c3' : conf.agree >= 2 ? 'c2' : 'c1'); cc.textContent = conf.agree === conf.total && conf.total > 1 ? '✓ Forecasts agree' : conf.agree >= 2 ? `${conf.agree} of ${conf.total} forecasts agree` : 'Forecasts disagree: have a backup'; }
  $('bTemp').textContent = x ? `${wxIcon(x, a > 0)} ${Math.round(x.temp)}°` : '–';
  $('bRain').classList.toggle('hidden', !x || x.pp < 20); if (x) $('bRain').textContent = `💧 ${x.pp}%`;

  // the animated sky + weather over the map / 3D
  const w = skyWeather(), s0 = dayStartUTC(), alts = [];
  for (let m = 0; m <= 1440; m += 10) alts.push(deg(sunAt(new Date(s0 + m * 60000)).altitude));
  const rm = minutesOf(t.sunrise), sm = minutesOf(t.sunset);
  sky.set({ minutes: state.minutes, alts, alt: a, cloud: w.cloud, rain: w.rain, snow: w.snow, storm: w.storm, fog: w.fog, blocked,
    rise: rm >= 0 && rm < 1440 ? rm : null, set: sm >= 0 && sm < 1440 ? sm : null, riseLbl: '🌅 ' + fmt(t.sunrise), setLbl: fmt(t.sunset) + ' 🌇' });
  updateFX(w);

  // facade
  const f = Number($('facade').value); $('facadeLbl').textContent = `${f}° ${compass(f)}`;
  const lit = []; let cur = null; const start = dayStartUTC();
  for (let m = 0; m <= 1440; m += 5) {
    const q = sunAt(new Date(start + m * 60000)), off = Math.abs(((bearingOf(q.azimuth) - f + 540) % 360) - 180);
    const on = q.altitude > 0 && off < 90;
    if (on && !cur) cur = [m, m]; else if (on) cur[1] = m; else if (cur) { lit.push(cur); cur = null; }
  }
  if (cur) lit.push(cur);
  const offNow = Math.abs(((b - f + 540) % 360) - 180);
  $('facadeInfo').innerHTML = (lit.length ? `Direct sun on this wall: <b>${lit.map(r => fmtMin(r[0]) + '–' + fmtMin(r[1])).join(', ')}</b>` : 'This wall gets <b>no direct sun</b> on this date.')
    + `<br>At ${fmt(d)}: ` + (a <= 0 ? 'the sun is down.' : offNow < 90 ? `<b style="color:var(--good)">lit from the front</b>${offNow < 25 ? ', almost head-on' : ''}.` : `<b style="color:var(--bad)">in shade</b>. The sun is behind it, so it's backlit.`);

  drawSunOnMap();
  fcRender();
  if (scene3d && (state.view === 'orbit' || state.view === 'street')) scene3d.setSun(d, cloudFactor(), blocked);
  renderHills();
}
// ───────────────────────── visuals: animated sky card, hour strip, weather effects ─────────────────────────
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const jumpTo = m => { stopPlay(); state.minutes = clamp(Math.round(m), 0, 1439); $('t').value = state.minutes; update(); };
const sky = new SkyCard($('sky'), { onScrub: m => { jumpTo(m); if (!lsGet('sunscout-skyhint')) { lsSet('sunscout-skyhint', '1'); $('skyHint').classList.add('gone'); } } });
if (lsGet('sunscout-skyhint')) $('skyHint').classList.add('gone');
document.querySelectorAll('.mom').forEach(m => m.onclick = () => { const v = sunTimes()[m.dataset.at]; if (!isNaN(v)) jumpTo(minutesOf(v) + 1); });
$('bestWindow').onclick = () => { if (state.best != null) jumpTo(state.best * 60); };

let hoursKey = '', hoursSel = -1;
function renderHours(t, sel) {
  const box = $('hours');
  if (!state.weather) { box.innerHTML = ''; hoursKey = ''; return; }
  const key = `${state.date}|${state.lat},${state.lng}|${state.weather.hourly.time[0]}|${!!state.models}`;
  let fresh = false;
  if (key !== hoursKey) {
    hoursKey = key; fresh = true; box.innerHTML = '';
    if (!wxAt(state.date, 12)) { box.innerHTML = '<div class="note nofc">No forecast this far ahead (about 16 days is the limit).</div>'; return; }
    for (let h = 0; h < 24; h++) {
      const w = wxAt(state.date, h), mid = new Date(dayStartUTC() + (h * 60 + 30) * 60000), up = mid > t.sunrise && mid < t.sunset, c = confidenceAt(state.date, h);
      const el = document.createElement('button'); el.className = 'hr' + (up ? ' up' : '');
      const dot = c ? (c.agree === c.total && c.total > 1 ? 'c3' : c.agree >= 2 ? 'c2' : 'c1') : '';
      el.innerHTML = `<span class="t">${pad2(h)}</span><span class="i">${wxIcon(w, up)}</span><span class="tp">${w ? Math.round(w.temp) + '°' : ''}</span><span class="r">${w && w.pp >= 20 ? '💧' + w.pp + '%' : ''}</span><i class="dot ${dot}"></i>`;
      el.title = w ? `${fmtMin(h * 60)} · ${wxText(w.code)} · clouds ${w.cc}% · rain ${w.pp}% · ${w.temp}°C` : '';
      el.onclick = () => jumpTo(h * 60 + 30);
      box.appendChild(el);
    }
  }
  if (sel === hoursSel && !fresh) return;
  hoursSel = sel;
  [...box.children].forEach((el, h) => el.classList.toggle('now', h === sel));
  const el = box.children[sel];
  if (el && el.classList.contains('hr')) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: fresh ? 'auto' : 'smooth' });
}

// rain / snow / storm drawn over the map or 3D view
const fx = new WeatherFX($('stage'));
let fxOn = lsGet('sunscout-fx') !== '0';
const fxLabel = () => { $('fxBtn').textContent = `🌧️ Rain & storm animation: ${fxOn ? 'on' : 'off'}`; };
fxLabel();
$('fxBtn').onclick = () => { fxOn = !fxOn; lsSet('sunscout-fx', fxOn ? '1' : '0'); fxLabel(); updateFX(); };
function fcRainAt(x, y) {   // forecast rain (0..1) at a point on the screen, from the forecast-cloud grid
  const g = fc.grid; if (!g) return 0;
  const ll = map.containerPointToLatLng([x, y]), N = fc.N, { lat0, lng0, dLat, dLng } = fc.data;
  const gx = (ll.lng - lng0) / dLng, gy = (lat0 - ll.lat) / dLat;
  if (gx < -0.5 || gy < -0.5 || gx > N - 0.5 || gy > N - 0.5) return 0;
  const xi = clamp(Math.floor(gx), 0, N - 2), yi = clamp(Math.floor(gy), 0, N - 2), fx_ = clamp(gx - xi, 0, 1), fy = clamp(gy - yi, 0, 1);
  const v = (g[yi * N + xi] * (1 - fx_) + g[yi * N + xi + 1] * fx_) * (1 - fy) + (g[(yi + 1) * N + xi] * (1 - fx_) + g[(yi + 1) * N + xi + 1] * fx_) * fy;
  return v < 0.15 ? 0 : clamp(0.25 + v / 1.5, 0, 1);
}
function updateFX(w = skyWeather()) {
  const off = { kind: 'off', fog: 0 }, view3d = state.view !== 'map';
  if (!fxOn || (view3d && !state.useWx)) return fx.set(off);
  if (!view3d && fc.on && fc.grid) return fx.set(fc.rainMax >= 0.15 ? { kind: 'rain', intensity: 1, storm: false, fog: 0, rainAt: fcRainAt } : off);
  if (!view3d && map.getZoom() < 11) return fx.set(off);   // zoomed out: the forecast is for one spot, so don't rain on the whole region
  fx.set({ kind: w.snow ? 'snow' : w.rain > 0 ? 'rain' : 'off', intensity: w.rain || 0.5, storm: w.storm, fog: w.fog ? 1 : 0 });
}
map.on('zoomend', () => updateFX());

// first visit: a quick three-step welcome
if (!lsGet('sunscout-welcomed')) {
  $('welcome').classList.remove('hidden');
  const close = () => { $('welcome').classList.add('hidden'); lsSet('sunscout-welcomed', '1'); };
  $('welcomeGo').onclick = close; $('welcome').onclick = e => { if (e.target.id === 'welcome') close(); };
}

function onDayChange() { computeHillTimes(); sliderGradient(); buildChips(); if (scene3d) scene3d.setDay(dayStartUTC()); update(); }

// ───────────────────────── location ─────────────────────────
function setLocation(lat, lng, label, keepHint) {
  if (!keepHint) state.kindHint = null;
  state.lat = lat; state.lng = lng; state.label = label;
  $('place').textContent = '📍 ' + (label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  try { localStorage.setItem('sunscout-last', JSON.stringify({ lat, lng, label })); } catch { /* no storage */ }
  sliderGradient(); buildChips(); update();
  loadWeather(); checkLiveSky(); loadHorizon();
  if (fc.on) { fc.data = null; fc.arrowHour = null; fcLoad().then(fcRender).catch(() => {}); }
  if (scene3d) { scene3d.needsLoad = true; if (state.view === 'orbit' || state.view === 'street') load3D(true); }
}

// ── search: suggestions as you type, from two sources (Photon is forgiving with names, Nominatim knows addresses),
//    India first, then nearby, then the rest of the world. Also accepts "lat, lng" and Google Maps links.
const enc = encodeURIComponent;
const typeIcon = t => ({ hotel: '🏨', apartments: '🏢', commercial: '🏢', office: '🏢', building: '🏢', yes: '🏢', retail: '🛍️', mall: '🛍️', attraction: '📸', monument: '🗿', memorial: '🗿', museum: '🏛️', place_of_worship: '🛕', temple: '🛕', mosque: '🕌', church: '⛪', park: '🌳', beach: '🏖️', station: '🚉', aerodrome: '✈️', bridge: '🌉', university: '🎓', college: '🎓', school: '🏫', hospital: '🏥', restaurant: '🍽️', cafe: '☕', stadium: '🏟️', fort: '🏰', castle: '🏰', city: '🏙️', town: '🏘️', village: '🏘️', suburb: '🏘️', neighbourhood: '🏘️', road: '🛣️', residential: '🛣️', primary: '🛣️', secondary: '🛣️' }[t] || '📍');
// coordinates from anything a maps app can give you: Google / Apple links, "geo:" links, "19.0123, 72.8345", or 19°01'23"N 72°50'04"E
function parseCoords(q) {
  const ok = (a, b) => isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null;
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&](?:q|ll|sll|query|daddr|destination|coordinate|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /geo:(-?\d+\.\d+),(-?\d+\.\d+)/i, /(?:^|[^\d.])(-?\d{1,2}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})(?![\d.])/];
  for (const p of pats) { const m = q.match(p); if (m) { const r = ok(+m[1], +m[2]); if (r) return r; } }
  const d = q.match(/(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([EW])/i);
  if (d) {
    const lat = (+d[1] + d[2] / 60 + d[3] / 3600) * (/s/i.test(d[4]) ? -1 : 1), lng = (+d[5] + d[6] / 60 + d[7] / 3600) * (/w/i.test(d[8]) ? -1 : 1);
    return ok(lat, lng);
  }
  return null;
}

// ── your own saved places: found first in search, kept in this browser, included in the shareable file ──
const readPlaces = () => { try { const l = JSON.parse(localStorage.getItem('sunscout-places') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const writePlaces = list => { try { localStorage.setItem('sunscout-places', JSON.stringify(list)); } catch { /* storage blocked */ } };
const normName = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
function savePlace(name, lat, lng, detail) {
  track('saved a place', false);
  name = name.trim().slice(0, 80); if (!name) return;
  const list = readPlaces().filter(p => normName(p.name) !== normName(name));
  list.unshift({ name, lat: +lat.toFixed(6), lng: +lng.toFixed(6), detail: (detail || '').slice(0, 120) });
  writePlaces(list.slice(0, 500)); renderFixCount();
}
function savedMatches(q) {
  const words = normName(q).split(' ').filter(Boolean); if (!words.length) return [];
  return readPlaces().filter(p => { const t = normName(p.name + ' ' + (p.detail || '')); return words.every(w => t.includes(w)); })
    .slice(0, 4).map(p => ({ name: p.name, detail: p.detail ? `⭐ Saved · ${p.detail}` : '⭐ Your saved place', lat: p.lat, lng: p.lng, icon: '⭐' }));
}
let sugs = [], sugSel = -1, sugTimer = null, sugCtl = null;
let pickName = '';
async function fetchSuggestions(q) {
  const coords = parseCoords(q);
  const firstLine = q.replace(/https?:\/\/\S+/g, '').split(/[\n\r]+|\s·\s/).map(s => s.trim()).filter(Boolean);
  pickName = (firstLine[0] || '').slice(0, 80);
  if (coords) {
    const fromLink = q.match(/\/maps\/place\/([^/@?]+)/);   // full Google Maps links carry the place's name
    let nm = fromLink ? decodeURIComponent(fromLink[1].replace(/\+/g, ' ')) : firstLine.length && !parseCoords(firstLine[0]) ? firstLine[0] : null;
    if (nm && nm.length > 80) nm = nm.slice(0, 80);
    return [{ name: nm || 'Coordinates', detail: `📌 ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}${nm ? ' · will be saved to your places' : ''}`, lat: coords[0], lng: coords[1], icon: '📌', saveAs: nm, exact: true }];
  }
  let sharedName = null;
  if (/https?:\/\//i.test(q)) {   // shared from Google / Apple Maps: the link can't be opened, so use the name + address that come with it
    sharedName = firstLine[0] || null;
    const mine = sharedName ? savedMatches(sharedName) : [];
    if (mine.length) return mine;
    q = (firstLine.length > 1 ? firstLine.slice(1) : firstLine).join(', ');
    if (!q) return [];
  }
  const mine = sharedName ? [] : savedMatches(q);
  sugCtl?.abort(); sugCtl = new AbortController(); const signal = sugCtl.signal;
  const c = map.getCenter();
  const photon = fetch(`https://photon.komoot.io/api/?q=${enc(q)}&limit=8&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&location_bias_scale=0.4`, { signal })
    .then(r => r.json()).then(j => j.features.map(f => {
      const p = f.properties;
      return { name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city, detail: [p.street && p.name ? p.street : null, p.locality || p.district, p.city, p.state, p.country].filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], icon: typeIcon(p.osm_value), cc: p.countrycode, type: p.osm_value, religion: p.religion };
    })).catch(() => []);
  const nomMap = j => j.map(r => ({ name: r.name || r.display_name.split(',')[0], detail: r.display_name.split(',').slice(1, 5).join(',').trim(), lat: +r.lat, lng: +r.lon, icon: typeIcon(r.type), cc: (r.address?.country_code || '').toUpperCase(), type: r.type }));
  const nomIN = fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=in&q=${enc(q)}`, { signal }).then(r => r.json()).then(nomMap).catch(() => []);
  let [a, b] = await Promise.all([photon, nomIN]);
  if (signal.aborted) return null;
  const all = [...b, ...a.filter(x => x.cc === 'IN'), ...a.filter(x => x.cc !== 'IN')];
  const out = [];
  for (const s of all) if (s.name && !out.some(o => Math.hypot(o.lat - s.lat, o.lng - s.lng) < 0.0008 && o.name.toLowerCase() === s.name.toLowerCase())) out.push(s);
  const words = q.split(/\s+/).filter(w => w.length > 2);
  if (!out.some(o => o.cc === 'IN') && words.length >= 2 && words.length <= 4) {
    // nothing in India: names are often mapped shorter ("Phoenix Palladium" → "Palladium"), so retry with one word dropped
    const variants = words.map((_, i) => words.filter((__, j) => j !== i).join(' '));
    const extra = await Promise.all(variants.map(v => fetch(`https://photon.komoot.io/api/?q=${enc(v)}&limit=4&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&location_bias_scale=0.4`)
      .then(r => r.json()).then(j => j.features.filter(f => f.properties.countrycode === 'IN').map(f => { const p = f.properties; return { name: p.name || p.street, detail: [p.street, p.locality || p.district, p.city, p.state].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], icon: typeIcon(p.osm_value), cc: 'IN', type: p.osm_value }; })).catch(() => [])));
    const near = extra.flat().filter(s => s.name);
    out.unshift(...near.filter((s, i) => near.findIndex(o => o.name === s.name && Math.hypot(o.lat - s.lat, o.lng - s.lng) < 0.001) === i));
  }
  if (!out.length) {   // nothing at all: try the whole world
    const w = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${enc(q)}`).then(r => r.json()).then(nomMap).catch(() => []);
    out.push(...w);
  }
  if (sharedName) out.forEach(s => { s.areaFor = sharedName; s.detail = `Area near “${sharedName}” · ${s.detail || ''}`; });
  return [...mine, ...out.filter(s => !mine.some(m => Math.hypot(m.lat - s.lat, m.lng - s.lng) < 0.0005))].slice(0, 7);
}
function renderSugs(list, q) {
  const box = $('sugs'); sugs = list; sugSel = list.length ? 0 : -1;
  const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nm = pickName || q;
  const pickRow = `<div class="sug pickrow${list.length ? '' : ' sel'}" data-pick="1"><span class="ic">📍</span><div><div class="nm">${list.length ? 'Not in the list?' : 'Not on the free map yet.'} Pick “${esc(nm)}” on the map</div><div class="dt">Tap it once on the satellite map. Sun Scout will remember it for next time.</div></div></div>`;
  const empty = list.length ? '' : `<div class="empty">No match for “${esc(nm)}”. Many shops and new buildings aren't on the free map. Pick it on the map once below, search the area instead (e.g. “Lower Parel”), or paste coordinates from Google Maps (long-press the spot there, then copy the numbers at the top).</div>`;
  if (list.length && list.every(s => s.exact)) { box.innerHTML = list.map((s, i) => `<div class="sug${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="ic">${s.icon}</span><div><div class="nm">${esc(s.name)}</div><div class="dt">${esc(s.detail)}</div></div></div>`).join(''); box.classList.remove('hidden'); bindSugs(box, el => pick(sugs[+el.dataset.i])); return; }
  box.innerHTML = empty + list.map((s, i) => `<div class="sug${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="ic">${s.icon}</span><div><div class="nm">${esc(s.name)}</div><div class="dt">${esc(s.detail)}</div></div></div>`).join('') + pickRow;
  box.classList.remove('hidden');
  bindSugs(box, el => el.dataset.pick ? startPickMode(nm) : pick(sugs[+el.dataset.i]));
}
function bindSugs(box, act) { box.querySelectorAll('.sug').forEach(el => { el.onmousedown = e => e.preventDefault(); el.onclick = () => act(el); }); }
// ⭐ your places: one tap from the search bar, plus "save this spot"
function showPlaces() {
  const box = $('sugs'), list = readPlaces();
  const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sugs = list.map(p => ({ name: p.name, detail: p.detail || 'Your saved place', lat: p.lat, lng: p.lng, icon: '⭐' })); sugSel = -1;
  const here = state.label ? state.label.split(',')[0] : `${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`;
  box.innerHTML = `<div class="sughead">⭐ Your places${list.length ? ` (${list.length})` : ''}</div>`
    + (list.length ? '' : '<div class="empty">Nothing saved yet. Missing a shop or building? Search the nearest road or area, tap the exact spot on the map, then tap ⭐ Save. It will come up here and in search.</div>')
    + sugs.map((s, i) => `<div class="sug" data-i="${i}"><span class="ic">⭐</span><div><div class="nm">${esc(s.name)}</div><div class="dt">${esc(s.detail)}</div></div></div>`).join('')
    + `<div class="sug pickrow" data-save="1"><span class="ic">➕</span><div><div class="nm">Save the current spot</div><div class="dt">📍 ${esc(here)}</div></div></div>`
    + `<div class="sug pickrow" data-newpick="1"><span class="ic">📍</span><div><div class="nm">Add a place that's missing from the map</div><div class="dt">Name it, then tap its exact spot on the satellite map</div></div></div>`;
  box.classList.remove('hidden');
  bindSugs(box, el => {
    if (el.dataset.save) { hideSugs(); $('savePlace').click(); return; }
    if (el.dataset.newpick) { hideSugs(); const n = prompt('Name of the place (e.g. Dev Darshan):', $('q').value.trim()); if (n && n.trim()) startPickMode(n); return; }
    const p = sugs[+el.dataset.i]; hideSugs(); $('q').blur(); goPlace(p);
  });
}
function goPlace(p) { state.kindHint = null; map.setView([p.lat, p.lng], 17, { animate: false }); setLocation(p.lat, p.lng, p.name); }
const hideSugs = () => $('sugs').classList.add('hidden');
async function suggest(force) {
  const q = $('q').value.trim();
  if (q.length < 3 && !force) return hideSugs();
  if (!q) return;
  $('sugs').innerHTML = '<div class="empty">🔎 Searching…</div>'; $('sugs').classList.remove('hidden');
  const list = await fetchSuggestions(q);
  if (list) renderSugs(list, q);
  return list;
}
function pick(s) {
  track('searched a place');
  hideSugs(); $('q').value = s.name; $('q').blur();
  if (s.saveAs) savePlace(s.saveAs, s.lat, s.lng, 'From a maps link');
  if (s.areaFor) { map.setView([s.lat, s.lng], 17, { animate: false }); setLocation(s.lat, s.lng, s.areaFor + ' (area)'); startPickMode(s.areaFor, true); return; }
  map.setView([s.lat, s.lng], 17, { animate: false });
  const t = (s.type || '') + ' ' + (s.name || '').toLowerCase();
  state.kindHint = /mosque|masjid|dargah|gurudwara|gurdwara|sikh|muslim/.test(t) ? 'dome' : /church|cathedral|chapel|christian/.test(t) ? 'church' : /temple|mandir|place_of_worship|shrine|derasar|devasthan|hindu|jain/.test(t) ? 'temple' : null;
  setLocation(s.lat, s.lng, [s.name, s.detail].filter(Boolean).join(', '), true);
  if (state.view === 'map') switchView('orbit');   // a search means "show me this place": go straight to 3D
}
const oneLine = t => t.replace(/\s*[\n\r]+\s*/g, ' · ').trim();
$('q').addEventListener('paste', e => {
  const t = e.clipboardData?.getData('text'); if (!t || !/[\n\r]/.test(t)) return;
  e.preventDefault(); $('q').value = oneLine(t); clearTimeout(sugTimer); suggest(true);
});
$('q').addEventListener('input', () => { clearTimeout(sugTimer); if (!$('q').value.trim()) { if (readPlaces().length) showPlaces(); else hideSugs(); return; } sugTimer = setTimeout(suggest, 300); });
$('q').addEventListener('focus', () => {
  if (!$('q').value.trim()) { if (readPlaces().length) showPlaces(); }
  else if (sugs.length && $('q').value.trim().length >= 3) $('sugs').classList.remove('hidden');
});
$('myPlaces').onmousedown = e => e.preventDefault();
$('myPlaces').onclick = () => { if (!$('sugs').classList.contains('hidden') && $('sugs').querySelector('.sughead')) return hideSugs(); showPlaces(); };
$('q').addEventListener('blur', () => setTimeout(hideSugs, 150));
$('q').addEventListener('keydown', async e => {
  const items = $('sugs').querySelectorAll('.sug');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!items.length) return;
    sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === sugSel));
  } else if (e.key === 'Enter') {
    e.preventDefault(); clearTimeout(sugTimer);
    const selEl = $('sugs').querySelectorAll('.sug')[sugSel];
    if (!$('sugs').classList.contains('hidden') && selEl) return selEl.dataset.pick ? startPickMode(pickName || $('q').value.trim()) : pick(sugs[+selEl.dataset.i]);
    const list = await suggest(true); if (list && list.length) pick(list[0]);
  } else if (e.key === 'Escape') hideSugs();
});
$('go').onclick = async () => { clearTimeout(sugTimer); const list = await suggest(true); if (list && list.length) pick(list[0]); };

// ───────────────────────── time controls ─────────────────────────
$('t').oninput = () => { stopPlay(); state.minutes = Number($('t').value); update(); };
$('date').onchange = () => { if ($('date').value) { state.date = $('date').value; onDayChange(); } };
$('facade').oninput = update;
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; $('play').textContent = '▶'; }
$('play').onclick = () => {
  if (playTimer) return stopPlay();
  const t = sunTimes();
  if (state.minutes >= minutesOf(t.dusk) || state.minutes < minutesOf(t.dawn) - 30) state.minutes = Math.max(0, Math.round(minutesOf(t.dawn)) - 20);
  $('play').textContent = '⏸';
  playTimer = setInterval(() => {
    state.minutes += 2;
    if (state.minutes >= Math.min(1439, minutesOf(t.dusk) + 20)) { stopPlay(); }
    $('t').value = state.minutes; update();
  }, 33);
};

// ───────────────────────── views: map / 3D / street ─────────────────────────
let scene3d = null;
async function ensureScene() {
  if (scene3d) return scene3d;
  status3D('Starting the 3D engine…');
  const { Scene3D } = await import('./scene3d.js');
  scene3d = new Scene3D($('scene'), status3D);
  scene3d.needsLoad = true;
  scene3d.onModeChange = m => setTabs(m);
  scene3d.onLensChange = mm => document.querySelectorAll('#sceneTools .lens button').forEach(x => x.classList.toggle('on', Number(x.dataset.mm) === mm));
  scene3d.onSelect = info => { showEdit(info); renderFixCount(); };
  scene3d.horizon = state.horizon;
  return scene3d;
}
function status3D(msg) { const el = $('sceneStatus'); if (!msg) return el.classList.add('hidden'); el.textContent = msg; el.classList.remove('hidden'); }
let loadSeq = 0;
async function load3D(reframe) {
  const s = await ensureScene();
  if (s.needsLoad) {
    s.needsLoad = false; const my = ++loadSeq;
    await s.load(state.lat, state.lng, state.label, state.kindHint);
    if (my !== loadSeq) return;   // a newer search started meanwhile
    s.setDay(dayStartUTC());
    s.setSun(selected(), cloudFactor(), sunBlocked(selected()));
    if (reframe && (state.view === 'orbit' || state.view === 'street')) s.setMode(state.view);
  }
  s.setSun(selected(), cloudFactor(), sunBlocked(selected()));
}
function setTabs(view) {
  state.view = view;
  if (view !== 'map') track(view === 'orbit' ? 'opened 3D' : 'opened Street view');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  const own3d = view === 'orbit' || view === 'street';
  $('map').classList.toggle('hidden', view !== 'map'); $('mapTools').classList.toggle('hidden', view !== 'map');
  $('scene').classList.toggle('hidden', !own3d); $('sceneTools').classList.toggle('hidden', !own3d);
  $('sceneHint').classList.toggle('hidden', view === 'map');
  $('pad').classList.toggle('hidden', view !== 'street' || !matchMedia('(pointer: coarse)').matches);
  document.querySelector('#sceneTools .lens').classList.toggle('hidden', view !== 'street');
  $('faceSun').classList.toggle('hidden', view !== 'street'); $('sunBehind').classList.toggle('hidden', view !== 'street');
  if (!own3d) { $('editPanel').classList.add('hidden'); scene3d?.select(null); }
  $('sceneHint').textContent = view === 'street'
    ? 'Drag to look · W A S D / arrows to walk (Shift to run) · double-click to jump there · scroll to change lens · click a building to fix it'
    : 'Drag to spin · scroll to zoom · double-click the ground to stand there · click a building to fix it';
  document.body.classList.toggle('in3d', own3d);
  if (view === 'map') { map.invalidateSize(); drawSunOnMap(); status3D(null); }
  if (own3d && matchMedia('(pointer: coarse)').matches && !setTabs.shown?.[view]) {
    (setTabs.shown ||= {})[view] = true;
    toast(view === 'street' ? '👆 Drag to look around · 🕹️ thumb stick to walk · double-tap to jump there · pinch for lens' : '👆 Drag to spin · pinch to zoom · double-tap the ground to stand there · tap a building to fix it', 5500);
  }
  scene3d?.setActive(own3d);
  updateFX();
}
async function switchView(view) {
  setTabs(view);
  if (view === 'map') return;
  try {
    await load3D();
    scene3d.setActive(true);
    scene3d.setMode(view);
  } catch (e) { console.error(e); status3D('Could not start 3D: ' + e.message); }
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchView(t.dataset.view));
document.querySelectorAll('#sceneTools .lens button').forEach(b => b.onclick = () => { scene3d?.setLens(Number(b.dataset.mm)); scene3d?.onLensChange(Number(b.dataset.mm)); });
$('bestView').onclick = () => scene3d && scene3d.bestView();
// the swipeable button row fades at its right edge until you reach the end
(() => { const st = document.querySelector('#sceneTools .strip'); const f = () => st.classList.toggle('end', st.scrollLeft + st.clientWidth >= st.scrollWidth - 4); st.addEventListener('scroll', f, { passive: true }); addEventListener('resize', f); new ResizeObserver(f).observe(st); })();
$('faceSun').onclick = () => scene3d && scene3d.lookAtSun(false);
$('sunBehind').onclick = () => scene3d && scene3d.lookAtSun(true);
$('wxBtn').onclick = () => { state.useWx = !state.useWx; $('wxBtn').classList.toggle('on', state.useWx); $('wxBtn').textContent = `☁️ Forecast clouds: ${state.useWx ? 'on' : 'off'}`; update(); };
const shotName = () => `sun-scout-${state.date}-${fmt(selected()).replace(':', '')}.png`;
$('treeBtn').onclick = () => { const on = !$('treeBtn').classList.contains('on'); $('treeBtn').classList.toggle('on', on); $('treeBtn').textContent = `🌳 Trees: ${on ? 'on' : 'off'}`; scene3d?.setTrees(on); };
$('snap').onclick = () => { track('took a snapshot', false); scene3d && scene3d.snapshot(shotName()); };
// phone walking: a thumb joystick. Push further to walk faster; let go and you ease to a stop.
(() => {
  const pad = $('pad'), knob = $('knob'); let id = null;
  const setMove = (f, s) => { if (scene3d) { scene3d.move.f = f; scene3d.move.s = s; scene3d.poke(); } };
  const at = e => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    let x = e.clientX - r.left - R, y = e.clientY - r.top - R; const d = Math.hypot(x, y), max = R * 0.62;
    if (d > max) { x *= max / d; y *= max / d; }
    knob.style.transform = `translate(${x}px, ${y}px)`;
    const dz = v => Math.abs(v) < 0.12 ? 0 : v;     // a small dead zone so a resting thumb doesn't creep
    setMove(dz(-y / max), dz(x / max));
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; try { pad.setPointerCapture(id); } catch { /* ignore */ } pad.classList.add('on'); at(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === id) at(e); });
  const end = e => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; pad.classList.remove('on'); setMove(0, 0); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
})();
function toast(msg, ms = 4000) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.add('hidden'), ms); }

// ── fix-a-building panel ──
const KIND_LABEL = { building: 'a building', temple: 'a temple', dome: 'a domed building', church: 'a church', low: 'a low building', removed: 'open ground' };
function showEdit(info) {
  const p = $('editPanel');
  if (!info) return p.classList.add('hidden');
  p.classList.remove('hidden');
  $('editTitle').textContent = info.name ? `✏️ ${info.name}` : '✏️ This building';
  $('editNote').textContent = (info.auto !== 'building' ? `Map data says this is ${KIND_LABEL[info.auto]}. ` : '') + (info.edited ? 'You changed it. Your fix is saved in this browser.' : 'Wrong shape? Pick what it really is:');
  p.querySelectorAll('.kinds button').forEach(b => b.classList.toggle('on', b.dataset.k === info.kind));
  $('editH').value = info.height; $('editHv').textContent = info.height + ' m';
  $('editH').disabled = info.kind === 'removed';
  $('editReset').classList.toggle('hidden', !info.edited);
}
document.querySelectorAll('#editPanel .kinds button').forEach(b => b.onclick = () => scene3d?.editSelected({ kind: b.dataset.k }));
$('editH').oninput = () => { $('editHv').textContent = $('editH').value + ' m'; };
$('editH').onchange = () => scene3d?.editSelected({ top: Number($('editH').value) });
$('editReset').onclick = () => scene3d?.resetSelected();
$('editClose').onclick = () => scene3d?.select(null);

// ───────────────────────── hills (free elevation data) ─────────────────────────
let horizonSeq = 0;
async function loadHorizon() {
  const my = ++horizonSeq; state.horizon = null; state.hill = null; renderHills();
  try {
    const h = await horizonProfile(state.lat, state.lng);
    if (my !== horizonSeq) return;
    state.horizon = h; computeHillTimes();
    scene3d?.setHorizon(h);
    update();
  } catch (e) { console.error(e); $('hills').textContent = '⛰️ Hill data unavailable right now.'; }
}
function computeHillTimes() {
  const st = sunTimes(); state.sunOff = isNaN(st.sunset) ? 0 : -deg(sunAt(st.sunset).altitude);
  state.hill = state.horizon ? hillTimes(state.horizon.prof, sunAt, dayStartUTC(), state.sunOff) : null;
}
function renderHills() {
  const el = $('hills'), h = state.horizon, t = state.hill;
  if (!h) { el.textContent = '⛰️ Checking hills around you…'; return; }
  const st = sunTimes(), r0 = minutesOf(st.sunrise), s0 = minutesOf(st.sunset);
  const lateBy = t && t.rise != null ? Math.round(t.rise - r0) : 0, earlyBy = t && t.set != null ? Math.round(s0 - t.set) : 0;
  if (!t || t.rise == null) { el.innerHTML = '⛰️ <b>Hills block direct sun all day</b> at this spot on this date.'; return; }
  if (lateBy < 3 && earlyBy < 3) { el.innerHTML = `⛰️ Open horizon: no hills hide the sun here (ground ${h.ground} m above sea level).`; return; }
  el.innerHTML = `⛰️ <b>Hills change your light.</b> Direct sun reaches you at <b>${fmtMin(t.rise)}</b>${lateBy >= 3 ? ` (${lateBy} min after sunrise)` : ''} and disappears behind terrain at <b>${fmtMin(t.set)}</b>${earlyBy >= 3 ? ` (${earlyBy} min before sunset)` : ''}.`;
}

// ───────────────────────── your building fixes: save / load as a file ─────────────────────────
$('pickCancel').onclick = endPickMode;
$('savePlace').onclick = () => {
  const name = prompt('Name this place so you can search for it later:', state.label && !/^My location$/.test(state.label) ? state.label.split(',')[0] : '');
  if (name && name.trim()) { savePlace(name, state.lat, state.lng, ''); state.label = name.trim(); $('place').textContent = `⭐ Saved “${name.trim()}”.`; toast(`⭐ Saved “${name.trim()}”. Find it any time with the ⭐ button next to search.`); }
};
const readFixes = () => { try { return JSON.parse(localStorage.getItem('sunscout-edits') || '{}'); } catch { return {}; } };
function renderFixCount() {
  const n = Object.keys(readFixes()).length, places = readPlaces();
  $('fixCount').textContent = (places.length ? '' : 'No saved places yet. Search for one, or pick it on the map. ') + (n ? `${n} building${n > 1 ? 's' : ''} fixed in 3D.` : 'In 3D, click any building to correct it.');
  const box = $('placesList'); box.innerHTML = '';
  places.slice(0, 30).forEach(p => {
    const row = document.createElement('div'); row.className = 'pl';
    const go = document.createElement('button'); go.className = 'go'; go.textContent = '⭐ ' + p.name;
    go.onclick = () => { goPlace(p); scrollTo({ top: 0, behavior: 'smooth' }); };
    const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'Remove';
    rm.onclick = () => { if (confirm(`Remove “${p.name}” from your saved places?`)) { writePlaces(readPlaces().filter(x => !(x.name === p.name && x.lat === p.lat))); renderFixCount(); } };
    row.append(go, rm); box.appendChild(row);
  });
}
$('fixExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'sun-scout', version: 1, fixes: readFixes(), places: readPlaces() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sun-scout-fixes.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('fixImport').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text()), fixes = data.fixes || data;
    const clean = {};
    for (const [k, v] of Object.entries(fixes)) {
      if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(k) || typeof v !== 'object' || !v) continue;
      const o = {}; if (['building', 'temple', 'dome', 'church', 'low', 'removed'].includes(v.kind)) o.kind = v.kind;
      if (Number.isFinite(v.top) && v.top > 0 && v.top < 1000) o.top = v.top;
      if (Object.keys(o).length) clean[k] = o;
    }
    const places = Array.isArray(data.places) ? data.places.filter(p => p && typeof p.name === 'string' && p.name.trim() && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) : [];
    places.reverse().forEach(p => savePlace(String(p.name), +p.lat, +p.lng, typeof p.detail === 'string' ? p.detail : ''));
    const merged = { ...readFixes(), ...clean };
    try { localStorage.setItem('sunscout-edits', JSON.stringify(merged)); } catch { /* storage blocked */ }
    if (scene3d) { scene3d.memEdits = merged; scene3d.footprints?.forEach(f => scene3d.applyEdit(f)); if (scene3d.footprints?.length) scene3d.buildMeshes(); }
    renderFixCount();
    alert(`Loaded ${Object.keys(clean).length} building fixes and ${places.length} saved places.`);
  } catch (err) { alert('That file is not a Sun Scout fixes file.'); }
};

// ───────────────────────── phone: my location, install, offline ─────────────────────────
$('locate').onclick = () => {
  track('used my location');
  if (!navigator.geolocation) { $('place').textContent = 'This browser cannot share your location.'; return; }
  $('place').textContent = '📍 Finding you…';
  navigator.geolocation.getCurrentPosition(p => {
    const { latitude: lat, longitude: lng } = p.coords;
    map.setView([lat, lng], 17, { animate: false });
    setLocation(lat, lng, 'My location');
  }, err => {
    $('place').textContent = err.code === 1 ? '📍 Location is blocked. Allow it for this site in your browser settings, or search instead.' : '📍 Could not find your location. Try again outside, or search instead.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
};

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const dismissed = (() => { try { return localStorage.getItem('sunscout-install-dismissed') === '1'; } catch { return false; } })();
const isPhone = matchMedia('(pointer: coarse)').matches;
let installEvt = null;
function showInstall(how, button) {
  if (standalone || dismissed || !isPhone) return;
  $('installHow').textContent = how; $('installBtn').classList.toggle('hidden', !button); $('installBar').classList.remove('hidden');
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall('Opens full screen like a normal app, with one tap.', true); });
if (/iphone|ipad|ipod/i.test(navigator.userAgent)) showInstall('In Safari: tap the Share button ⬆️, then "Add to Home Screen".', false);
$('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBar').classList.add('hidden'); };
$('installClose').onclick = () => { $('installBar').classList.add('hidden'); try { localStorage.setItem('sunscout-install-dismissed', '1'); } catch { /* no storage */ } };
// keep the installed app up to date: look for a new version on open and whenever you come back to it,
// and reload once when it arrives (only if an older version was running)
const APP_VERSION = 'v7';
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }).catch(() => {});
}
$('appVersion').textContent = `Sun Scout ${APP_VERSION}`;
if (standalone) track('opened the installed app');

// opened from Android's Share menu (e.g. a place shared from Google Maps): search what was shared
(() => {
  const sp = new URLSearchParams(location.search);
  const lines = ['title', 'text', 'url'].flatMap(k => (sp.get(k) || '').split(/[\n\r]+/)).map(t => t.trim()).filter(Boolean);
  const shared = lines.filter((t, i) => lines.indexOf(t) === i).join('\n');
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  $('q').value = oneLine(shared);
  setTimeout(() => { $('q').focus(); suggest(true); }, 400);
})();

// ───────────────────────── start ─────────────────────────
if (state.label !== 'Gateway of India, Mumbai') $('place').textContent = '📍 ' + (state.label || `${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`);
setNow();
onDayChange();
loadWeather();
checkLiveSky();
loadHorizon();
renderFixCount();
(() => {
  const c = navigator.connection; if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
  const warm = () => import('./scene3d.js').catch(() => {});
  addEventListener('load', () => setTimeout(() => (window.requestIdleCallback || setTimeout)(warm, { timeout: 4000 }), 2500), { once: true });
})();
window.sunScout = { state, map, get scene() { return scene3d; } }; // handy for debugging in the console
