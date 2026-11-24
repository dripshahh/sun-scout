import { horizonProfile, hillTimes } from './terrain.js';
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
map.on('click', e => setLocation(e.latlng.lat, e.latlng.lng, null));

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
$('cloudBtn').onclick = () => clouds.on ? cloudsOff() : cloudsOn();
$('cloudPlay').onclick = () => clouds.timer ? (stopCloudLoop(), clouds.idx = clouds.frames.length - 1, showCloudFrame()) : startCloudLoop();

// rain radar (RainViewer)
let radar = null;
$('radarBtn').onclick = async () => {
  if (radar) { map.removeLayer(radar); radar = null; $('radarBtn').classList.remove('on'); return; }
  try {
    const j = await fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json());
    const last = j.radar.past[j.radar.past.length - 1];
    radar = L.tileLayer(`${j.host}${last.path}/256/{z}/{x}/{y}/4/1_1.png`, { pane: 'clouds', opacity: .75, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar © RainViewer' }).addTo(map);
    $('radarBtn').classList.add('on');
    if (map.getZoom() > 10) map.flyTo([state.lat, state.lng], 7, { duration: 1.2 });
  } catch (e) { alert('Rain radar is unavailable right now.'); }
};

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
      html = `<span class="big">☁️ Cloud over this spot</span>${thick ? 'Thick, high cloud. The sun is probably hidden.' : 'Thin or low cloud. You may get hazy or broken sun.'}`;
    } else if (isClear) html = `<span class="big">☀️ Clear sky over this spot</span>The satellite sees no cloud here. The sun should be out (if it's daytime).`;
    else html = `<span class="big">❔ No reading</span>The satellite has no data for this spot.`;
    box.innerHTML = html + `<div class="note" style="margin-top:4px">Meteosat image from ${fmt(t)} local (${ago} min ago). Each pixel covers about 3–4 km, so it can't see a single small cloud.</div>`;
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
    state.weather = j; state.offset = j.utc_offset_seconds;
    if (changed) setNow();
  } catch (e) { state.weather = null; $('wxNow').textContent = 'Forecast unavailable: ' + e.message; }
  update();
}
function wxAt(dayStr, hour) {
  const w = state.weather; if (!w) return null;
  const i = w.hourly.time.indexOf(`${dayStr}T${pad2(hour)}:00`); if (i < 0) return null;
  return { cc: w.hourly.cloud_cover[i], low: w.hourly.cloud_cover_low[i], pp: w.hourly.precipitation_probability[i] ?? 0, pr: w.hourly.precipitation[i] ?? 0, code: w.hourly.weather_code[i], temp: w.hourly.temperature_2m[i] };
}
const isRain = x => x && (x.pr > 0.2 || x.pp >= 60);
const wxColor = x => !x ? '#333' : isRain(x) ? 'var(--blue)' : (x.low < 25 && x.cc < 40) ? 'var(--good)' : x.low < 60 ? 'var(--mid)' : 'var(--grey)';
// 0 = clear, 1 = fully overcast; drives the 3D lighting
function cloudFactor() { const x = wxAt(state.date, Math.floor(state.minutes / 60)); return x && state.useWx ? clamp((0.7 * x.low + 0.3 * x.cc) / 100 + (isRain(x) ? 0.2 : 0), 0, 1) : 0; }

// ───────────────────────── panels ─────────────────────────
function lightQuality(a) { return a < -6 ? 'Night' : a < 0 ? 'Blue hour' : a < 6 ? 'Golden, warm' : a < 20 ? 'Low, directional' : a < 50 ? 'Neutral' : 'Harsh, overhead'; }
function score(a, x, blocked) {
  if (a < -6) return ['🌙', 'Night', 'The sun is down. Use practicals or city lights.', '#141a2e'];
  if (a < 0) return ['💙', 'Blue hour', 'Soft, cool light with no shadows. Great for moody city shots.', '#16224a'];
  if (blocked && a > 0) return ['⛰️', 'Sun is behind the hills', 'The sun is up but hidden by terrain: soft, shadowless light here. ' + (state.hill?.rise != null && state.minutes < state.hill.rise ? `Direct sun reaches you at ${fmtMin(state.hill.rise)}.` : 'Direct sun has gone for the day.'), '#1e2a2a'];
  if (isRain(x)) return ['🌧️', 'Rain likely', `${x.pp}% chance of rain this hour. Plan cover or a backup.`, '#13243f'];
  if (x && x.low >= 70) return ['☁️', 'Flat, soft light', 'Overcast: no hard shadows. Good for skin tones and even exposure.', '#23262d'];
  const some = x && x.low >= 25 ? ' Some clouds may pass over.' : '';
  if (a < 6) return ['🔥', 'Golden light!', 'Warm, low sun with long shadows. Best time for beauty shots.' + some, '#3a2508'];
  if (a < 20) return ['😎', 'Lovely directional light', 'Low angle with strong texture and shape.' + some, '#2f2810'];
  if (a < 50) return ['🙂', 'Good, neutral daylight', 'Clean light, but watch for squinting.' + some, '#1f2a1c'];
  return ['🥵', 'Harsh overhead sun', 'Short shadows and dark eye sockets. Use diffusion or shoot in shade.' + some, '#3a1c14'];
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
  $('tLabel').textContent = fmt(d); $('tLabel2').textContent = fmt(d);
  $('az').textContent = `${b.toFixed(0)}° ${compass(b)}`;
  $('alt').textContent = `${a.toFixed(1)}°`;
  $('shadow').textContent = a > 0.5 ? `${(1 / Math.tan(p.altitude)).toFixed(1)}× object height` : 'none';
  $('quality').textContent = lightQuality(a);

  const t = sunTimes();
  $('rise').textContent = fmt(t.sunrise); $('set').textContent = fmt(t.sunset);
  $('goldAM').textContent = fmt(t.sunrise) + '–' + fmt(t.goldenHourEnd);
  $('goldPM').textContent = fmt(t.goldenHour) + '–' + fmt(t.sunset);
  $('blueAM').textContent = fmt(t.dawn) + '–' + fmt(t.blueEndAM);
  $('bluePM').textContent = fmt(t.blueStartPM) + '–' + fmt(t.dusk);

  // forecast strip
  const hours = $('hours'); hours.innerHTML = '';
  const sel = Math.floor(state.minutes / 60), x = wxAt(state.date, sel);
  if (state.weather) {
    for (let h = 0; h < 24; h++) {
      const w = wxAt(state.date, h), el = document.createElement('div');
      const mid = new Date(dayStartUTC() + (h * 60 + 30) * 60000);
      el.style.background = wxColor(w); el.style.opacity = (mid > t.sunrise && mid < t.sunset) ? 1 : .35;
      if (h === sel) el.className = 'now';
      el.title = w ? `${fmtMin(h * 60)} · ${wxText(w.code)} · clouds ${w.cc}% (low ${w.low}%) · rain ${w.pp}% · ${w.temp}°C` : 'no data';
      el.onclick = () => { stopPlay(); state.minutes = h * 60 + 30; $('t').value = state.minutes; update(); };
      hours.appendChild(el);
    }
    $('wxNow').innerHTML = x ? `<b>${fmtMin(sel * 60)}</b> · ${wxText(x.code)} · clouds ${x.cc}% (low ${x.low}%) · rain ${x.pp}% · ${x.temp}°C` : 'No forecast for this date (only about 16 days ahead are available).';
  }

  const blocked = sunBlocked(d);
  const [emoji, title, sub, bg] = score(a, x, blocked);
  $('score').querySelector('.emoji').textContent = emoji;
  $('score').querySelector('.title').textContent = title;
  $('score').querySelector('.sub').textContent = sub;
  $('score').style.background = `linear-gradient(135deg, ${bg}, #1d212b)`;

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
  if (scene3d && (state.view === 'orbit' || state.view === 'street')) scene3d.setSun(d, cloudFactor(), blocked);
  renderHills();
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
  if (scene3d) { scene3d.needsLoad = true; if (state.view === 'orbit' || state.view === 'street') load3D(true); }
}

// ── search: suggestions as you type, from two sources (Photon is forgiving with names, Nominatim knows addresses),
//    India first, then nearby, then the rest of the world. Also accepts "lat, lng" and Google Maps links.
const enc = encodeURIComponent;
const typeIcon = t => ({ hotel: '🏨', apartments: '🏢', commercial: '🏢', office: '🏢', building: '🏢', yes: '🏢', retail: '🛍️', mall: '🛍️', attraction: '📸', monument: '🗿', memorial: '🗿', museum: '🏛️', place_of_worship: '🛕', temple: '🛕', mosque: '🕌', church: '⛪', park: '🌳', beach: '🏖️', station: '🚉', aerodrome: '✈️', bridge: '🌉', university: '🎓', college: '🎓', school: '🏫', hospital: '🏥', restaurant: '🍽️', cafe: '☕', stadium: '🏟️', fort: '🏰', castle: '🏰', city: '🏙️', town: '🏘️', village: '🏘️', suburb: '🏘️', neighbourhood: '🏘️', road: '🛣️', residential: '🛣️', primary: '🛣️', secondary: '🛣️' }[t] || '📍');
function parseCoords(q) {
  const m = q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || q.match(/^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/);
  return m ? [+m[1], +m[2]] : null;
}
let sugs = [], sugSel = -1, sugTimer = null, sugCtl = null;
async function fetchSuggestions(q) {
  const coords = parseCoords(q);
  if (coords) return [{ name: 'Coordinates', detail: `${coords[0]}, ${coords[1]}`, lat: coords[0], lng: coords[1], icon: '📌' }];
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
  return out.slice(0, 7);
}
function renderSugs(list, q) {
  const box = $('sugs'); sugs = list; sugSel = list.length ? 0 : -1;
  if (!list.length) { box.innerHTML = `<div class="empty">No match for “${q.replace(/</g, '&lt;')}”. Try adding the area or city, e.g. “World One, Lower Parel”. You can also paste coordinates or a Google Maps link.</div>`; box.classList.remove('hidden'); return; }
  box.innerHTML = list.map((s, i) => `<div class="sug${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="ic">${s.icon}</span><div><div class="nm">${s.name.replace(/</g, '&lt;')}</div><div class="dt">${(s.detail || '').replace(/</g, '&lt;')}</div></div></div>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.sug').forEach(el => el.onmousedown = e => { e.preventDefault(); pick(sugs[+el.dataset.i]); });
}
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
  hideSugs(); $('q').value = s.name; $('q').blur();
  map.setView([s.lat, s.lng], 17, { animate: false });
  const t = (s.type || '') + ' ' + (s.name || '').toLowerCase();
  state.kindHint = /mosque|masjid|dargah|gurudwara|gurdwara|sikh|muslim/.test(t) ? 'dome' : /church|cathedral|chapel|christian/.test(t) ? 'church' : /temple|mandir|place_of_worship|shrine|derasar|devasthan|hindu|jain/.test(t) ? 'temple' : null;
  setLocation(s.lat, s.lng, [s.name, s.detail].filter(Boolean).join(', '), true);
  if (state.view === 'map') switchView('orbit');   // a search means "show me this place": go straight to 3D
}
$('q').addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(suggest, 300); });
$('q').addEventListener('focus', () => { if (sugs.length && $('q').value.trim().length >= 3) $('sugs').classList.remove('hidden'); });
$('q').addEventListener('blur', () => setTimeout(hideSugs, 150));
$('q').addEventListener('keydown', async e => {
  const items = $('sugs').querySelectorAll('.sug');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!items.length) return;
    sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === sugSel));
  } else if (e.key === 'Enter') {
    e.preventDefault(); clearTimeout(sugTimer);
    if (!$('sugs').classList.contains('hidden') && sugs[sugSel]) return pick(sugs[sugSel]);
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
    ? 'Drag to look · W A S D / arrows to walk · scroll to change lens · click a building to fix it'
    : 'Drag to spin · scroll to zoom · double-click the ground to stand there · click a building to fix it';
  if (view === 'map') { map.invalidateSize(); drawSunOnMap(); status3D(null); }
  scene3d?.setActive(own3d);
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
$('faceSun').onclick = () => scene3d && scene3d.lookAtSun(false);
$('sunBehind').onclick = () => scene3d && scene3d.lookAtSun(true);
$('wxBtn').onclick = () => { state.useWx = !state.useWx; $('wxBtn').classList.toggle('on', state.useWx); $('wxBtn').textContent = `☁️ Forecast clouds: ${state.useWx ? 'on' : 'off'}`; update(); };
const shotName = () => `sun-scout-${state.date}-${fmt(selected()).replace(':', '')}.png`;
$('treeBtn').onclick = () => { const on = !$('treeBtn').classList.contains('on'); $('treeBtn').classList.toggle('on', on); $('treeBtn').textContent = `🌳 Trees: ${on ? 'on' : 'off'}`; scene3d?.setTrees(on); };
$('snap').onclick = () => scene3d && scene3d.snapshot(shotName());
document.querySelectorAll('#pad button').forEach(b => {
  const set = v => e => { if (v) e.preventDefault(); const k = 'pad-' + b.dataset.mv; if (scene3d) scene3d.keys[k] = v; };
  b.addEventListener('pointerdown', set(true)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, set(false)));
});

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
const readFixes = () => { try { return JSON.parse(localStorage.getItem('sunscout-edits') || '{}'); } catch { return {}; } };
function renderFixCount() {
  const n = Object.keys(readFixes()).length;
  $('fixCount').textContent = n ? `${n} building${n > 1 ? 's' : ''} fixed and saved in this browser.` : 'No fixes yet. In 3D, click any building to correct it.';
}
$('fixExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'sun-scout', version: 1, fixes: readFixes() }, null, 1)], { type: 'application/json' });
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
    const merged = { ...readFixes(), ...clean };
    try { localStorage.setItem('sunscout-edits', JSON.stringify(merged)); } catch { /* storage blocked */ }
    if (scene3d) { scene3d.memEdits = merged; scene3d.footprints?.forEach(f => scene3d.applyEdit(f)); if (scene3d.footprints?.length) scene3d.buildMeshes(); }
    renderFixCount();
    alert(`Loaded ${Object.keys(clean).length} building fixes.`);
  } catch (err) { alert('That file is not a Sun Scout fixes file.'); }
};

// ───────────────────────── phone: my location, install, offline ─────────────────────────
$('locate').onclick = () => {
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
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ───────────────────────── start ─────────────────────────
if (state.label !== 'Gateway of India, Mumbai') $('place').textContent = '📍 ' + (state.label || `${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`);
setNow();
onDayChange();
loadWeather();
checkLiveSky();
loadHorizon();
renderFixCount();
window.sunScout = { state, map }; // handy for debugging in the console
