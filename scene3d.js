// Sun Scout — 3D scene: satellite ground, OpenStreetMap buildings with windows, real sun + cast shadows,
// the searched building highlighted, smooth camera flights, orbit and street-level modes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as PbfNS from 'https://cdn.jsdelivr.net/npm/pbf@3.2.1/+esm';
import * as VTNS from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@1.3.1/+esm';

const Pbf = typeof PbfNS.default === 'function' ? PbfNS.default : PbfNS.default?.default || PbfNS;
const VectorTile = VTNS.VectorTile || VTNS.default?.VectorTile;

const D2R = Math.PI / 180;
const RADIUS = 400;            // metres of city (buildings) loaded around the chosen spot
const EYE = 1.7;               // camera height in street mode (metres)
const BAY = 3.2, FLOOR = 3.5, CELLS = 8;   // window grid: bay width, floor height, cells per texture
const LENSES = [85, 50, 35, 24, 16];
const lon2tile = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2tile = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return Math.atan(Math.sinh(n)) / D2R; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const loadImage = src => new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }; // >0 = counter-clockwise
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const distToRing = (p, r) => { let m = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)); m = Math.min(m, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)); } return m; };
let tileUrlTemplate = null;

// Facade texture: 8×8 window cells. `map` = wall + glass, `glow` = which windows light up at night.
function makeFacadeTextures(renderer) {
  const S = 512, c = S / CELLS;
  const wall = document.createElement('canvas'), glow = document.createElement('canvas');
  wall.width = wall.height = glow.width = glow.height = S;
  const g = wall.getContext('2d'), e = glow.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
    const x = i * c + c * 0.16, y = j * c + c * 0.22, w = c * 0.68, h = c * 0.5;
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#5d6f80'); grad.addColorStop(1, '#2f3a46');
    g.fillStyle = grad; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, h * 0.18);       // sky reflection
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(i * c, j * c + c * 0.9, c, c * 0.1); // floor slab line
    if (Math.random() < 0.45) { e.fillStyle = `hsl(${35 + Math.random() * 15},90%,${55 + Math.random() * 20}%)`; e.fillRect(x, y, w, h); }
  }
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const map = mk(wall); map.colorSpace = THREE.SRGBColorSpace;
  const em = mk(glow); em.colorSpace = THREE.SRGBColorSpace;
  return { map, em };
}

export class Scene3D {
  constructor(container, onStatus) {
    this.el = container; this.onStatus = onStatus || (() => {});
    this.active = false; this.mode = 'orbit'; this.keys = {}; this.yaw = 0; this.pitch = 0; this.lensMM = 35;
    this.anim = null;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.6;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfcad6, 900, 9000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 30000);
    this.camera.position.set(260, 220, 320);

    this.sky = new Sky(); this.sky.scale.setScalar(20000); this.scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.85;

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    const sc = this.sunLight.shadow.camera;
    sc.left = sc.bottom = -RADIUS * 1.1; sc.right = sc.top = RADIUS * 1.1; sc.near = 1; sc.far = 4000;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.bias = -0.0003; this.sunLight.shadow.normalBias = 0.5; this.sunLight.shadow.radius = 2;
    this.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a4c3a, 0.6); this.scene.add(this.hemi);

    const far = new THREE.Mesh(new THREE.CircleGeometry(12000, 64), new THREE.MeshStandardMaterial({ color: 0x55584c, roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -0.3; this.scene.add(far);

    this.facade = makeFacadeTextures(r);
    this.wallMat = new THREE.MeshStandardMaterial({ map: this.facade.map, emissiveMap: this.facade.em, emissive: 0xffc27a, emissiveIntensity: 0, vertexColors: true, roughness: 0.75, metalness: 0.05 });
    this.roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2620, transparent: true, opacity: 0.35 });
    this.hiEdgeMat = new THREE.LineBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 1, fog: false });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xe0a52a, metalness: 0.8, roughness: 0.35 });
    this.selMat = new THREE.LineBasicMaterial({ color: 0x46d9ff, transparent: true, opacity: 1, depthTest: false, fog: false });
    [this.wallMat, this.roofMat, this.edgeMat, this.hiEdgeMat, this.goldMat, this.selMat].forEach(m => { m.shared = true; });

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.bgroup = new THREE.Group();
    this.selGroup = new THREE.Group(); this.selGroup.renderOrder = 20; this.scene.add(this.selGroup);
    this.dome = new THREE.Group(); this.scene.add(this.dome);
    this.addCompass();

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.minDistance = 10; this.controls.maxDistance = 2500;
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08; this.controls.target.set(0, 10, 0);
    this.controls.addEventListener('start', () => { this.anim = null; });

    this.bindStreetControls();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ───── helpers ─────
  toLocal(lng, lat) { return [(lng - this.lng0) * 111320 * this.coslat, (lat - this.lat0) * 110574]; } // [east, north] metres
  v3(e, h, n) { return new THREE.Vector3(e, h, -n); }
  label(text, color = '#fff', size = 64, w = 128) {
    const c = document.createElement('canvas'); c.width = w; c.height = 128; const g = c.getContext('2d');
    g.font = `bold ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(text, w / 2, 64); g.fillStyle = color; g.fillText(text, w / 2, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false }));
    s.renderOrder = 10; s.userData.aspect = w / 128; return s;
  }
  addCompass() {
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, b]) => {
      const s = this.label(t, t === 'N' ? '#ff6b5a' : '#fff'); s.scale.setScalar(26);
      s.position.set(Math.sin(b * D2R) * (RADIUS + 40), 14, -Math.cos(b * D2R) * (RADIUS + 40)); this.scene.add(s);
    });
  }
  clearGroup(g) { g.traverse(o => { o.geometry?.dispose(); if (o.material && !o.material.shared) { o.material.map?.dispose(); o.material.dispose?.(); } }); g.clear(); }

  // ───── loading a place ─────
  async load(lat, lng, name, kindHint) {
    this.kindHint = kindHint || null;
    this.lat0 = lat; this.lng0 = lng; this.coslat = Math.cos(lat * D2R); this.placeName = name;
    this.clearGroup(this.world); this.anim = null; this.world.add(this.bgroup);
    this.selected = null; this.clearGroup(this.selGroup); this.onSelect?.(null);
    this.target = null; this.trees = []; this.crowns = null; this.footprints = []; this.occluders = []; this.streetVisited = false;
    this.streetPos = new THREE.Vector3(0, EYE, 30);
    this.onStatus('🛰️ Loading satellite ground and 🏢 buildings…');
    const [, n] = await Promise.all([this.loadGround(), this.loadBuildings().catch(e => { console.error(e); return -1; })]);
    try { this.buildTrees(); } catch (e) { console.error(e); this.treeCount = 0; }
    if (this.horizon) this.setHorizon(this.horizon);
    this.renderer.shadowMap.needsUpdate = true;
    let msg;
    if (n < 0) msg = '⚠️ Could not load buildings. Showing the ground only.';
    else if (this.target) msg = `🏢 Found ${this.placeName ? '“' + this.placeName.split(',')[0] + '”' : 'the building'}: about ${Math.round(this.heightOf(this.target.parts[0]))} m tall.`;
    else if (n === 0) msg = 'ℹ️ No buildings are mapped here in OpenStreetMap. Showing the ground and the sun.';
    else msg = `📍 ${n} buildings loaded. This exact spot isn't a mapped building, so it's marked with a pin.`;
    if (this.treeCount) msg += ` 🌳 ${this.treeCount} trees placed from the satellite photo and mapped parks.`;
    if (n > 0) msg += (this.temples ? ` 🛕 ${this.temples} temple/place${this.temples > 1 ? 's' : ''} of worship shaped automatically.` : '') + ' 👆 Click any building to fix its shape or height.';
    this.onStatus(msg);
    clearTimeout(this.statusTimer); this.statusTimer = setTimeout(() => this.onStatus(null), 9000);
    return n;
  }

  // Esri answers "Map data not yet available" (a flat grey tile) where it has no sharp photo:
  // then use the enlarged matching corner of a less-zoomed tile instead (up to 3 levels up).
  async bestTile(z, x, y, depth = 0) {
    const img = await loadImage(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
    if (img && !(depth < 3 && z > 12 && this.isPlaceholder(img))) return { img, sx: 0, sy: 0, sw: 256 };
    if (depth >= 3 || z <= 12) return img ? { img, sx: 0, sy: 0, sw: 256 } : null;
    const up = await this.bestTile(z - 1, x >> 1, y >> 1, depth + 1);
    if (!up) return null;
    const sw = up.sw / 2;
    return { img: up.img, sx: up.sx + (x & 1) * sw, sy: up.sy + (y & 1) * sw, sw };
  }
  isPlaceholder(img) {
    const c = this._probe ||= Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data; let grey = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) < 4 && Math.abs(d[i + 1] - d[i + 2]) < 4 && d[i] > 170) grey++;
    return grey > 0.75 * 1024;
  }

  async groundLayer(z, radius, y, order) {
    const dLat = radius / 110574, dLng = radius / (111320 * this.coslat);
    const x0 = Math.floor(lon2tile(this.lng0 - dLng, z)), x1 = Math.floor(lon2tile(this.lng0 + dLng, z));
    const y0 = Math.floor(lat2tile(this.lat0 + dLat, z)), y1 = Math.floor(lat2tile(this.lat0 - dLat, z));
    const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#55584c'; ctx.fillRect(0, 0, W, H);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let yy = y0; yy <= y1; yy++)
      jobs.push(this.bestTile(z, x, yy).then(t => t && ctx.drawImage(t.img, t.sx, t.sy, t.sw, t.sw, (x - x0) * 256, (yy - y0) * 256, 256, 256)));
    await Promise.all(jobs);
    const [wE, nN] = this.toLocal(tile2lon(x0, z), tile2lat(y0, z));
    const [eE, sN] = this.toLocal(tile2lon(x1 + 1, z), tile2lat(y1 + 1, z));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(eE - wE, nN - sN), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set((wE + eE) / 2, y, -(nN + sN) / 2);
    mesh.receiveShadow = true; mesh.name = 'ground'; mesh.renderOrder = order;
    this.world.add(mesh);
    return { canvas, wE, nN, eE, sN };
  }
  loadGround() {   // sharp z19 photo near the spot, z16 for the wider surroundings
    return Promise.all([this.groundLayer(19, 270, 0.03, 2), this.groundLayer(16, 1800, 0, 1)]).then(([inner]) => { this.inner = inner; });
  }

  async loadBuildings() {
    if (!tileUrlTemplate) tileUrlTemplate = (await fetch('https://tiles.openfreemap.org/planet').then(r => r.json())).tiles[0];
    const z = 14, dLat = RADIUS / 110574, dLng = RADIUS / (111320 * this.coslat);
    const x0 = Math.floor(lon2tile(this.lng0 - dLng, z)), x1 = Math.floor(lon2tile(this.lng0 + dLng, z));
    const y0 = Math.floor(lat2tile(this.lat0 + dLat, z)), y1 = Math.floor(lat2tile(this.lat0 - dLat, z));
    const tiles = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
    const fps = [], pois = [];
    const water = this.water = [], woods = this.woods = [], parks = this.parks = [];
    await Promise.all(tiles.map(async ([x, y]) => {
      const buf = await fetch(tileUrlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y)).then(r => r.ok ? r.arrayBuffer() : null);
      if (!buf) return;
      const vt = new VectorTile(new Pbf(buf)), pl = vt.layers.poi;
      const grab = (lname, test, out) => {
        const L = vt.layers[lname]; if (!L) return;
        for (let i = 0; i < L.length; i++) {
          const f = L.feature(i); if (!test(f.properties)) continue;
          const g = f.toGeoJSON(x, y, z).geometry;
          const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
          for (const rings of polys) out.push(rings[0].map(([lo, la]) => this.toLocal(lo, la)));
        }
      };
      grab('water', () => true, water);
      grab('landcover', p => p.class === 'wood' || p.class === 'forest', woods);
      grab('park', () => true, parks);
      if (pl) for (let i = 0; i < pl.length; i++) {
        const f = pl.feature(i); if (f.properties.class !== 'place_of_worship') continue;
        const g = f.toGeoJSON(x, y, z).geometry; if (g.type !== 'Point') continue;
        const [e, n] = this.toLocal(g.coordinates[0], g.coordinates[1]);
        pois.push({ e, n, sub: f.properties.subclass, name: f.properties['name:en'] || f.properties.name });
      }
      const layer = vt.layers.building; if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), p = f.properties;
        if (p.hide_3d) continue;
        const top = p.render_height || 6, bottom = p.render_min_height || 0;
        if (top - bottom < 0.5) continue;
        const gj = f.toGeoJSON(x, y, z).geometry;
        const polys = gj.type === 'Polygon' ? [gj.coordinates] : gj.type === 'MultiPolygon' ? gj.coordinates : [];
        for (const rings of polys) {
          const rs = rings.map(ring => { const pts = ring.map(([lo, la]) => this.toLocal(lo, la)); if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop(); return pts; });
          if (rs[0].length < 3) continue;
          let cx = 0, cy = 0; rs[0].forEach(([a, b]) => { cx += a; cy += b; }); cx /= rs[0].length; cy /= rs[0].length;
          if (Math.hypot(cx, cy) > RADIUS) continue;
          const rad = Math.max(...rs[0].map(([a, b]) => Math.hypot(a - cx, b - cy)));
          fps.push({ outer: rs[0], holes: rs.slice(1), top, bottom, cx, cy, rad });
        }
      }
    }));
    // places of worship → give their footprint a matching shape
    const kindOf = sub => ({ hindu: 'temple', jain: 'temple', buddhist: 'temple', sikh: 'dome', muslim: 'dome', christian: 'church' }[sub] || 'temple');
    for (const p of pois) {
      let hit = fps.find(f => Math.hypot(f.cx - p.e, f.cy - p.n) < f.rad + 1 && inside([p.e, p.n], f.outer));
      if (!hit) { let bd = 8; for (const f of fps) { const d = distToRing([p.e, p.n], f.outer); if (d < bd) { bd = d; hit = f; } } }
      if (hit && !hit.autoKind) { hit.autoKind = kindOf(p.sub); hit.name = p.name; }
    }
    this.temples = fps.filter(f => f.autoKind).length;
    fps.forEach(f => { f.key = this.keyOf(f); this.applyEdit(f); });
    this.footprints = fps;
    if (!fps.length) { this.addPin(0, 0); return 0; }

    // which footprint is the searched place? inside it, or the closest one within 35 m
    let best = null, bestD = 35;
    for (const f of fps) {
      if (inside([0, 0], f.outer)) { if (!best || bestD > 0 || f.top > best.top) { best = f; bestD = 0; } continue; }
      if (bestD > 0) { const d = distToRing([0, 0], f.outer); if (d < bestD) { best = f; bestD = d; } }
    }
    if (best) { // join neighbouring pieces of the same building that got split at tile borders
      const parts = fps.filter(f => f === best || (Math.abs(f.top - best.top) < 0.5 && f.outer.some(p => distToRing(p, best.outer) < 0.6)));
      parts.forEach(f => f.isTarget = true);
      let cx = 0, cy = 0, rad = 0; parts.forEach(f => { cx += f.cx; cy += f.cy; }); cx /= parts.length; cy /= parts.length;
      parts.forEach(f => f.outer.forEach(([a, b]) => { rad = Math.max(rad, Math.hypot(a - cx, b - cy)); }));
      if (this.kindHint && !best.autoKind) parts.forEach(f => { f.autoKind = this.kindHint; this.applyEdit(f); });
      this.target = { cx, cy, rad, parts, get top() { return this._s.heightOf(parts[0]); }, _s: this };
    }
    this.buildMeshes();
    if (!this.target) this.addPin(0, 0);
    return fps.length;
  }

  // ───── your fixes: saved in this browser, keyed by the building's position ─────
  keyOf(f) { return `${(this.lat0 + f.cy / 110574).toFixed(5)},${(this.lng0 + f.cx / (111320 * this.coslat)).toFixed(5)}`; }
  static edits() { try { return JSON.parse(localStorage.getItem('sunscout-edits') || '{}'); } catch { return {}; } }
  static saveEdits(all) { try { localStorage.setItem('sunscout-edits', JSON.stringify(all)); } catch { /* storage blocked: fixes last for this visit only */ } }
  applyEdit(f) { const e = (this.memEdits ||= Scene3D.edits())[f.key] || {}; f.kind = e.kind || f.autoKind || 'building'; f.userTop = e.top ?? null; f.edited = !!(e.kind || e.top != null); }
  heightOf(f) {
    if (f.userTop != null) return f.userTop;
    if (f.kind === 'low') return Math.min(f.top, 7);
    if (f.kind === 'temple') return Math.max(f.top, Math.min(32, 8 + f.rad * 1.2));
    if (f.kind === 'dome' || f.kind === 'church') return Math.max(f.top, 12);
    return f.top;
  }
  editSelected(patch) {
    const f = this.selected; if (!f) return;
    const all = this.memEdits ||= Scene3D.edits(), e = { ...(all[f.key] || {}), ...patch };
    if (e.kind === (f.autoKind || 'building')) delete e.kind;
    Object.keys(e).forEach(k => e[k] == null && delete e[k]);
    if (Object.keys(e).length) all[f.key] = e; else delete all[f.key];
    Scene3D.saveEdits(all); this.applyEdit(f); this.buildMeshes(); this.onSelect?.(this.info(f));
  }
  resetSelected() {
    const f = this.selected; if (!f) return;
    const all = this.memEdits ||= Scene3D.edits(); delete all[f.key]; Scene3D.saveEdits(all);
    this.applyEdit(f); this.buildMeshes(); this.onSelect?.(this.info(f));
  }
  info(f) { return { name: f.name || (f.isTarget ? (this.placeName || '').split(',')[0] : ''), kind: f.kind, auto: f.autoKind || 'building', height: Math.round(this.heightOf(f)), edited: f.edited }; }
  select(f) { this.selected = f; this.drawSelection(); this.onSelect?.(f ? this.info(f) : null); }
  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.bgroup.children.filter(o => o.isMesh), false)[0];
    let f = null;
    if (hit) {
      const p = [hit.point.x, -hit.point.z], vis = this.footprints.filter(x => x.kind !== 'removed');
      f = vis.find(x => inside(p, x.outer)) || null;
      if (!f) { let bd = 1.5; for (const x of vis) { const d = distToRing(p, x.outer); if (d < bd) { bd = d; f = x; } } }
    } else {   // a plot you turned into open ground can still be clicked to bring it back
      const g = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (g) f = this.footprints.find(x => x.kind === 'removed' && inside([g.x, -g.z], x.outer)) || null;
    }
    this.select(f);
  }
  drawSelection() {
    this.clearGroup(this.selGroup);
    const f = this.selected; if (!f) return;
    const H = f.kind === 'removed' ? 0.4 : this.heightOf(f);
    const g = this.edgeGeometry(f, f.kind === 'removed' ? 0.3 : f.bottom, H + 0.2, true);
    this.selGroup.add(new THREE.LineSegments(g, this.selMat));
  }

  // ───── building meshes ─────
  buildMeshes() {
    this.clearGroup(this.bgroup);
    const vis = this.footprints.filter(f => f.kind !== 'removed');
    const others = vis.filter(f => !f.isTarget), tgt = vis.filter(f => f.isTarget);
    this.occluders = others.length ? this.buildSet(others, false) : [];
    if (tgt.length) this.buildSet(tgt, true);
    const name = (this.placeName || '').split(',')[0].slice(0, 28);
    if (this.target && name) {
      const top = this.target.top, k = Math.max(1, top / 60);
      const l = this.label(name, '#ffcf6b', 54, Math.min(1024, 60 + name.length * 32));
      l.scale.set(9 * l.userData.aspect * k, 9 * k, 1);
      l.position.copy(this.v3(this.target.cx, top + 10 * k, this.target.cy));
      this.bgroup.add(l);
    }
    this.drawSelection();
    this.renderer.shadowMap.needsUpdate = true;
  }
  buildSet(list, hi) {
    const palette = [0xf2ede4, 0xe8e0d2, 0xdfe3e6, 0xf0e4d6, 0xd8d3ca, 0xe6e9ee, 0xefe6dc];
    const walls = [], plain = [], edges = [], gold = [];
    for (const f of list) {
      const special = f.kind === 'temple' || f.kind === 'dome' || f.kind === 'church';
      const tint = new THREE.Color(hi ? 0xffe3b8 : f.kind === 'temple' ? 0xf3dcae : special ? 0xf1eee6 : palette[Math.floor(Math.abs(Math.sin(f.cx * 12.9898 + f.cy * 78.233)) * 43758) % palette.length]);
      const H = this.heightOf(f);
      if (!special) {
        walls.push(this.wallGeometry(f, tint, f.bottom, H));
        plain.push(this.capGeometry(f, tint.clone().multiplyScalar(0.78), H));
        edges.push(this.edgeGeometry(f, f.bottom, H));
        continue;
      }
      let base;
      if (f.kind === 'temple') {          // stepped base + curved shikhara tower + gold kalash
        base = Math.max(3.5, H * 0.3);
        plain.push(this.wallGeometry(f, tint, f.bottom, base), this.capGeometry(f, tint.clone().multiplyScalar(0.9), base));
        plain.push(this.crownGeometry(f, base, H, t => 0.72 * Math.pow(Math.cos(t * Math.PI / 2), 0.7), 16, tint));
        gold.push(this.finial(f, H, Math.max(0.7, Math.min(2, f.rad * 0.09))));
      } else if (f.kind === 'dome') {     // walls + dome + finial (mosque / gurdwara)
        const R = Math.max(3, Math.min(f.rad * 0.75, H * 0.55)); base = Math.max(3, H - R);
        plain.push(this.wallGeometry(f, tint, f.bottom, base), this.capGeometry(f, tint.clone().multiplyScalar(0.9), base));
        plain.push(this.crownGeometry(f, base, H, t => 0.8 * Math.sqrt(Math.max(0, 1 - t * t)), 12, tint));
        gold.push(this.finial(f, H, Math.max(0.5, Math.min(1.5, f.rad * 0.05))));
      } else {                            // church: walls + steep pitched roof
        base = Math.max(4, H * 0.55);
        plain.push(this.wallGeometry(f, tint, f.bottom, base));
        plain.push(this.crownGeometry(f, base, H, t => 1 - t, 3, tint.clone().multiplyScalar(0.72)));
      }
      edges.push(this.edgeGeometry(f, f.bottom, base));
    }
    const out = [];
    if (walls.length) out.push(new THREE.Mesh(mergeGeometries(walls), this.wallMat));
    if (plain.length) out.push(new THREE.Mesh(mergeGeometries(plain), this.roofMat));
    out.forEach(m => { m.castShadow = m.receiveShadow = true; m.name = hi ? 'target' : 'buildings'; this.bgroup.add(m); });
    if (gold.length) { const m = new THREE.Mesh(mergeGeometries(gold), this.goldMat); m.castShadow = true; this.bgroup.add(m); }
    if (edges.length) this.bgroup.add(new THREE.LineSegments(mergeGeometries(edges), hi ? this.hiEdgeMat : this.edgeMat));
    [...walls, ...plain, ...edges, ...gold].forEach(g => g.dispose());
    return out;
  }
  finial(f, H, s) {
    const a = new THREE.SphereGeometry(s * 1.4, 14, 8).scale(1, 0.5, 1).translate(0, s * 0.4, 0).toNonIndexed();
    const b = new THREE.ConeGeometry(s * 0.55, s * 2.8, 12).translate(0, s * 2.1, 0).toNonIndexed();
    const g = mergeGeometries([a, b]); a.dispose(); b.dispose();
    return g.translate(f.cx, H - s * 0.2, -f.cy);
  }
  makeGeo(pos, tint) {
    const g = new THREE.BufferGeometry(), n = pos.length / 3, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  // a tower that narrows toward the footprint's centre following `prof(t)` (1 = full size, 0 = point)
  crownGeometry(f, h0, h1, prof, steps, tint) {
    const ring = area(f.outer) > 0 ? f.outer : [...f.outer].reverse(), n = ring.length, pos = [];
    const lv = [];
    for (let s = 0; s <= steps; s++) { const t = s / steps, k = prof(t); lv.push({ h: h0 + (h1 - h0) * t, pts: ring.map(([a, b]) => [f.cx + (a - f.cx) * k, f.cy + (b - f.cy) * k]) }); }
    for (let s = 0; s < steps; s++) {
      const L0 = lv[s], L1 = lv[s + 1];
      for (let i = 0; i < n; i++) {
        const a0 = L0.pts[i], b0 = L0.pts[(i + 1) % n], a1 = L1.pts[i], b1 = L1.pts[(i + 1) % n];
        const A0 = [a0[0], L0.h, -a0[1]], B0 = [b0[0], L0.h, -b0[1]], A1 = [a1[0], L1.h, -a1[1]], B1 = [b1[0], L1.h, -b1[1]];
        pos.push(...A0, ...B0, ...A1, ...B0, ...B1, ...A1);
      }
    }
    return this.makeGeo(pos, tint);
  }
  addPin(e, n) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xe5604d, emissive: 0x401008 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 20), m); cone.rotation.x = Math.PI; cone.position.y = 6; cone.castShadow = true;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 16), m); ball.position.y = 10; ball.castShadow = true;
    g.add(cone, ball); g.position.copy(this.v3(e, 0, n)); this.world.add(g);
  }
  // walls: one quad per edge, UVs in "window cells" so the facade texture tiles at real-world scale
  wallGeometry(f, tint, h0, h1) {
    const pos = [], uv = [];
    const rings = [[f.outer, true], ...f.holes.map(h => [h, false])];
    for (const [ring0, isOuter] of rings) {
      const ring = (area(ring0) > 0) === isOuter ? ring0 : [...ring0].reverse(); // outer CCW, holes CW → normals face outwards
      let run = 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], len = Math.hypot(bx - ax, by - ay);
        if (len < 0.01) continue;
        const u0 = run / (BAY * CELLS), u1 = (run + len) / (BAY * CELLS), v0 = h0 / (FLOOR * CELLS), v1 = h1 / (FLOOR * CELLS);
        const A0 = [ax, h0, -ay], B0 = [bx, h0, -by], A1 = [ax, h1, -ay], B1 = [bx, h1, -by];
        pos.push(...A0, ...B0, ...A1, ...B0, ...B1, ...A1);
        uv.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
        run += len;
      }
    }
    const g = this.makeGeo(pos, tint);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }
  capGeometry(f, color, h) {
    const shape = new THREE.Shape(f.outer.map(([a, b]) => new THREE.Vector2(a, b)));
    f.holes.forEach(r => shape.holes.push(new THREE.Path(r.map(([a, b]) => new THREE.Vector2(a, b)))));
    const s = new THREE.ShapeGeometry(shape); s.rotateX(-Math.PI / 2); s.translate(0, h, 0);
    const ni = s.index ? s.toNonIndexed() : s;
    const g = this.makeGeo(Array.from(ni.attributes.position.array), color);
    s.dispose(); if (ni !== s) ni.dispose();
    return g;
  }
  edgeGeometry(f, h0, h1, all) {
    const pts = [];
    for (const ring of [f.outer, ...f.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        pts.push(ax, h1 + 0.05, -ay, bx, h1 + 0.05, -by);
        if (all) pts.push(ax, h0, -ay, bx, h0, -by);
        const [px, py] = ring[(i - 1 + ring.length) % ring.length];
        const a1 = Math.atan2(ay - py, ax - px), a2 = Math.atan2(by - ay, bx - ax);
        let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (all || turn > 0.35) pts.push(ax, h0, -ay, ax, h1, -ay);   // only real corners
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  }

  // ───── sun ─────
  sunDir(date) {
    const p = SunCalc.getPosition(date, this.lat0, this.lng0);
    const b = p.azimuth + Math.PI, a = p.altitude;
    return { v: new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.sin(a), -Math.cos(b) * Math.cos(a)), alt: a / D2R };
  }
  setDay(startUTC) {   // the sun's path across the sky for the day, with hour labels
    if (this.lat0 == null) return;
    this.clearGroup(this.dome);
    const R = 320, pts = [];
    for (let m = 0; m <= 1440; m += 5) { const s = this.sunDir(new Date(startUTC + m * 60000)); if (s.alt > -1) pts.push(s.v.clone().multiplyScalar(R)); }
    if (pts.length > 1) this.dome.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb02e, transparent: true, opacity: .85, fog: false })));
    for (let h = 0; h < 24; h++) {
      const s = this.sunDir(new Date(startUTC + h * 3600000)); if (s.alt < 0) continue;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffcf6b, fog: false }));
      dot.position.copy(s.v).multiplyScalar(R); this.dome.add(dot);
      const l = this.label(String(h).padStart(2, '0'), '#ffe2a6', 50); l.scale.setScalar(9); l.position.copy(s.v).multiplyScalar(R).add(new THREE.Vector3(0, 6, 0)); this.dome.add(l);
    }
    this.sunBall = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
    this.dome.add(this.sunBall);
  }
  setSun(date, cloud = 0, blocked = false) {
    if (this.lat0 == null) return;
    const { v, alt } = this.sunDir(date);
    this.sunVec = v; this.sunAlt = alt;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(v); u.turbidity.value = 2.5 + 12 * cloud; u.rayleigh.value = 2.2 + 1.0 * cloud;
    this.sunLight.position.copy(v).multiplyScalar(1500); this.sunLight.target.position.set(0, 0, 0);

    const day = smooth(-1, 3, alt);
    const warm = new THREE.Color(1.0, 0.52, 0.27), mid = new THREE.Color(1.0, 0.83, 0.64), white = new THREE.Color(1.0, 0.97, 0.93);
    this.sunLight.color.copy(alt < 8 ? warm.clone().lerp(mid, smooth(0, 8, alt)) : mid.clone().lerp(white, smooth(8, 30, alt)));
    this.sunLight.intensity = (blocked ? 0 : 1) * (alt < 10 ? 4.2 : 3.2) * day * (1 - 0.88 * cloud);
    this.sunLight.castShadow = this.sunLight.intensity > 0.05;
    const ambient = smooth(-10, 5, alt);
    this.hemi.intensity = 0.15 + ambient * (0.9 + 1.0 * cloud);
    this.hemi.color.set(alt < 0 ? 0x5f7cc8 : alt < 8 ? 0xffd8b0 : 0xcfe0ff);
    this.renderer.toneMappingExposure = 0.4 + 0.35 * smooth(-8, 3, alt);
    this.wallMat.emissiveIntensity = 1.4 * (1 - smooth(-7, 1, alt));     // windows glow after sunset
    this.scene.fog.color.copy(alt < 0 ? new THREE.Color(0x1c2540) : new THREE.Color(0xbfcad6).lerp(new THREE.Color(0xffc48a), 1 - smooth(0, 12, alt)).lerp(new THREE.Color(0xa9aeb6), cloud * 0.7));
    if (this.sunBall) { this.sunBall.position.copy(v).multiplyScalar(320); this.sunBall.visible = alt > -2; }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ───── camera: smooth flights between views ─────
  flyTo(pos, look, dur = 1.4) {
    const from = this.camera.position.clone(), fromLook = this.currentLook();
    this.anim = { from, to: pos.clone(), fromLook, toLook: look.clone(), t0: performance.now(), dur: dur * 1000 };
  }
  currentLook() { const d = new THREE.Vector3(); this.camera.getWorldDirection(d); return this.camera.position.clone().add(d.multiplyScalar(this.mode === 'street' ? 50 : this.camera.position.distanceTo(this.controls.target))); }
  stepAnim(now) {
    const a = this.anim; if (!a) return false;
    const t = Math.min(1, (now - a.t0) / a.dur), k = ease(t);
    this.camera.position.lerpVectors(a.from, a.to, k);
    const look = new THREE.Vector3().lerpVectors(a.fromLook, a.toLook, k);
    this.camera.lookAt(look);
    if (t >= 1) {
      this.anim = null;
      if (this.mode === 'street') { this.streetPos.copy(a.to); this.setYawPitchToward(a.toLook); }
      else this.controls.target.copy(a.toLook);
    }
    return true;
  }
  setYawPitchToward(p) { const d = p.clone().sub(this.camera.position); this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }

  // horizontal direction toward the sun (for "front-lit" views); falls back to south
  sunSide() { const v = this.sunVec && this.sunAlt > 0 ? this.sunVec : new THREE.Vector3(0, 0, 1); const h = new THREE.Vector2(v.x, -v.z); return h.lengthSq() < 1e-6 ? new THREE.Vector2(0, -1) : h.normalize(); } // (east, north)

  // aerial view framing the searched building, from the sunny side
  frameTarget(dur = 1.6) {
    const T = this.target || { cx: 0, cy: 0, rad: 30, top: 20 };
    const s = this.sunSide(), dist = Math.max(110, T.top * 2.4 + T.rad * 2.2);
    const pos = this.v3(T.cx + s.x * dist * 0.8, Math.max(60, T.top * 1.1 + dist * 0.45), T.cy + s.y * dist * 0.8);
    this.flyTo(pos, this.v3(T.cx, T.top * 0.45, T.cy), dur);
  }
  // street-level spot in front of the building, on the sunny side, not inside another building, with a clear view
  bestStreetSpot() {
    const T = this.target || { cx: 0, cy: 0, rad: 15, top: 15 };
    const look = this.v3(T.cx, Math.min(T.top * 0.5, 40), T.cy);
    const s = this.sunSide(), base = Math.atan2(s.y, s.x);
    const ray = new THREE.Raycaster();
    // try rings of spots around the building, sunny side first; return the first with a clear view,
    // otherwise the open spot whose view is least blocked (buildings count more than trees)
    let fallback = null, fallbackScore = Infinity;
    const crowns = this.treesOn !== false && this.crowns ? [this.crowns] : [];
    for (const extra of [1, 0.6, 1.5, 0.4, 2.2]) {
      const d = Math.min(260, Math.max(18, T.top * 0.9 + T.rad) * extra);
      for (let k = 0; k < 36; k++) {
        const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
        const e = T.cx + Math.cos(ang) * d, n = T.cy + Math.sin(ang) * d;
        if (this.footprints.some(f => !f.isTarget && f.kind !== 'removed' && Math.hypot(f.cx - e, f.cy - n) < f.rad + 2 && (inside([e, n], f.outer) || distToRing([e, n], f.outer) < 1.5))) continue;
        if (crowns.length && this.trees?.some(t => Math.hypot(t.e - e, t.n - n) < t.r + 1.5)) continue;   // not inside a tree
        const eye = this.v3(e, EYE, n), dir = look.clone().sub(eye), len = dir.length();
        ray.set(eye, dir.normalize()); ray.far = Math.max(1, len - T.rad);
        const hb = ray.intersectObjects(this.occluders || [], false).length, ht = crowns.length ? ray.intersectObjects(crowns, false).length : 0;
        if (!hb && !ht) return { pos: eye, look, d };
        const score = hb * 10 + ht + k * 0.05;
        if (score < fallbackScore) { fallbackScore = score; fallback = { pos: eye, look, d }; }
      }
    }
    if (fallback) return fallback;
    const e = T.cx + s.x * (T.rad + 30), n = T.cy + s.y * (T.rad + 30);
    return { pos: this.v3(e, EYE, n), look, d: T.rad + 30 };
  }
  bestView() {
    if (this.mode === 'street') {
      const spot = this.bestStreetSpot(), mm = this.lensFor(spot);
      this.setLens(mm); this.onLensChange?.(mm);
      this.flyTo(spot.pos, spot.look, 1.6);
    } else this.frameTarget();
  }
  // the longest lens that still fits the whole building height in frame
  lensFor(spot) {
    const T = this.target || { top: 15 };
    const need = Math.atan2(T.top - EYE, spot.d) - Math.atan2(spot.look.y - EYE, spot.d);
    const aspect = this.camera.aspect || 1.5;
    return LENSES.find(L => { const hf = 2 * Math.atan(18 / L), vf = 2 * Math.atan(Math.tan(hf / 2) / aspect); return vf / 2 > need * 1.15; }) || 16;
  }
  // ───── trees: found in the satellite photo (green, textured canopy) + mapped woods and parks ─────
  buildTrees() {
    const CELL = 2, N = Math.ceil(2 * RADIUS / CELL);
    const toX = e => (e + RADIUS) / CELL, toY = n => (RADIUS - n) / CELL;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c.getContext('2d', { willReadFrequently: true }); };
    const land = mk(), bld = mk();
    const fill = (g, ring, style, stroke) => { g.beginPath(); ring.forEach(([e, n], i) => i ? g.lineTo(toX(e), toY(n)) : g.moveTo(toX(e), toY(n))); g.closePath(); g.fillStyle = style; g.fill(); if (stroke) { g.lineWidth = stroke; g.strokeStyle = style; g.stroke(); } };
    land.globalCompositeOperation = 'lighter';
    this.parks.forEach(r => fill(land, r, 'rgb(0,0,255)'));
    this.woods.forEach(r => fill(land, r, 'rgb(0,255,0)'));
    this.water.forEach(r => fill(land, r, 'rgb(255,0,0)'));
    this.footprints.filter(f => f.kind !== 'removed').forEach(f => fill(bld, f.outer, '#fff', 1.6));
    const L = land.getImageData(0, 0, N, N).data, B = bld.getImageData(0, 0, N, N).data;
    const at = (D, i, j, ch) => D[(j * N + i) * 4 + ch];

    // 1) canopy from the sharp satellite photo
    const canopy = new Uint8Array(N * N);
    const inn = this.inner;
    if (inn) {
      const { canvas, wE, nN, eE, sN } = inn, W = canvas.width, H = canvas.height;
      const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      const sx = W / (eE - wE), sy = H / (nN - sN);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const e = i * CELL - RADIUS + CELL / 2, n = RADIUS - j * CELL - CELL / 2;
        if (e < wE || e > eE || n > nN || n < sN || Math.hypot(e, n) > 265) continue;
        if (at(B, i, j, 0) > 0 || at(L, i, j, 0) > 0) continue;
        const x0 = Math.floor((e - CELL / 2 - wE) * sx), y0 = Math.floor((nN - n - CELL / 2) * sy), x1 = Math.min(W, Math.ceil(x0 + CELL * sx)), y1 = Math.min(H, Math.ceil(y0 + CELL * sy));
        let r = 0, g = 0, b = 0, l2 = 0, cnt = 0;
        for (let y = Math.max(0, y0); y < y1; y++) for (let x = Math.max(0, x0); x < x1; x++) { const k = (y * W + x) * 4, R = px[k], G = px[k + 1], Bb = px[k + 2]; r += R; g += G; b += Bb; const lum = (R + G + Bb) / 3; l2 += lum * lum; cnt++; }
        if (!cnt) continue;
        r /= cnt; g /= cnt; b /= cnt;
        const bright = (r + g + b) / 3, sd = Math.sqrt(Math.max(0, l2 / cnt - bright * bright)), exg = 2 * g - r - b;
        if (exg > 14 && g >= r && g >= b && bright > 22 && bright < 135 && sd > 7) canopy[j * N + i] = 1;
      }
    }
    // 2) candidates: canopy cells, plus woods / parks outside the sharp photo
    let seed = 1234567; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cand = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      if (canopy[idx]) {   // only keep canopy that is part of a clump (removes lone green pixels and lawns' edges)
        let c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += canopy[(j + dj) * N + i + di] || 0;
        if (c >= 5) cand.push([i, j, c / 9]);
        continue;
      }
      const e = i * CELL - RADIUS, n = RADIUS - j * CELL;
      if (inn && Math.hypot(e, n) <= 265) continue;            // the photo already decided here
      if (at(B, i, j, 0) > 0 || at(L, i, j, 0) > 0 || Math.hypot(e, n) > RADIUS) continue;
      const p = at(L, i, j, 1) > 0 ? 0.07 : at(L, i, j, 2) > 0 ? 0.02 : 0;
      if (p && rnd() < p) cand.push([i, j, 0.6]);
    }
    for (let k = cand.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [cand[k], cand[m]] = [cand[m], cand[k]]; }
    // 3) keep trees at least ~4.5 m apart
    const grid = new Map(), trees = [], G = 5;
    for (const [i, j, dens] of cand) {
      if (trees.length >= 5000) break;
      const e = i * CELL - RADIUS + CELL / 2 + (rnd() - 0.5), n = RADIUS - j * CELL - CELL / 2 + (rnd() - 0.5);
      const r = 1.8 + 2.4 * dens * (0.7 + rnd() * 0.5), gx = Math.floor(e / G), gy = Math.floor(n / G);
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (const t of grid.get(`${gx + a},${gy + b}`) || []) if (Math.hypot(t.e - e, t.n - n) < Math.max(4.5, (t.r + r) * 0.8)) { ok = false; break; }
      if (!ok) continue;
      const t = { e, n, r, h: r * 2 + 2 + rnd() * 4 }; trees.push(t);
      const key = `${gx},${gy}`; (grid.get(key) || grid.set(key, []).get(key)).push(t);
    }
    this.treeCount = trees.length; this.trees = trees;
    if (!trees.length) return;
    const crownGeo = new THREE.IcosahedronGeometry(1, 1), trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), greens = [0x3f6b2e, 0x4c7a34, 0x36602a, 0x557f3a, 0x46703a].map(c => new THREE.Color(c));
    trees.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(new THREE.Vector3(t.e, t.h - t.r * 0.85, -t.n), q, new THREE.Vector3(t.r, t.r * 0.85, t.r)); crowns.setMatrixAt(k, m);
      crowns.setColorAt(k, greens[k % greens.length]);
      m.compose(new THREE.Vector3(t.e, 0, -t.n), q, new THREE.Vector3(t.r * 1.4, t.h - t.r * 1.2, t.r * 1.4)); trunks.setMatrixAt(k, m);
    });
    crowns.castShadow = trunks.castShadow = true; crowns.receiveShadow = true; this.crowns = crowns;
    this.treeGroup = new THREE.Group(); this.treeGroup.add(crowns, trunks); this.treeGroup.visible = this.treesOn !== false;
    this.world.add(this.treeGroup);
  }
  setTrees(on) { this.treesOn = on; if (this.treeGroup) this.treeGroup.visible = on; this.renderer.shadowMap.needsUpdate = true; }

  // ───── hills on the horizon (from free elevation data): a distant silhouette ring ─────
  setHorizon(h) {
    this.horizon = h;
    if (this.hills) { this.scene.remove(this.hills); this.hills.geometry.dispose(); this.hills = null; }
    if (!h || h.max < 0.3) return;
    const R = 4200, pos = [], idx = [];
    for (let a = 0; a <= 360; a++) {
      const ang = Math.max(0, h.prof[a % 360]) * D2R, b = a * D2R, x = Math.sin(b) * R, z = -Math.cos(b) * R;
      pos.push(x, -1, z, x, R * Math.tan(ang), z);
      if (a) { const k = a * 2; idx.push(k - 2, k, k - 1, k, k + 1, k - 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.hills = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x59636a, side: THREE.DoubleSide, fog: true }));
    this.scene.add(this.hills);
  }

  // for the Google view: the building and the best street spot, in lat/lng
  placeInfo() {
    const toLL = (e, n) => ({ lat: this.lat0 + n / 110574, lng: this.lng0 + e / (111320 * this.coslat) });
    const T = this.target, spot = this.bestStreetSpot();
    const s = toLL(spot.pos.x, -spot.pos.z), lk = toLL(spot.look.x, -spot.look.z);
    const v = this.sunVec && this.sunAlt > 0 ? this.sunVec : null;
    return {
      target: { ...toLL(T ? T.cx : 0, T ? T.cy : 0), top: T ? T.top : 20, rad: T ? T.rad : 30, gLat: s.lat, gLng: s.lng },
      spot: s, look: { ...lk, h: spot.look.y }, mm: this.lensFor(spot),
      sunBearing: v ? (Math.atan2(v.x, -v.z) / D2R + 360) % 360 : 180,
    };
  }

  // ───── modes & controls ─────
  setActive(on) { this.active = on; if (on) { this.resize(); this.last = performance.now(); } }
  setMode(mode, fly = true) {
    const prev = this.mode; this.mode = mode;
    if (mode === 'street') {
      this.controls.enabled = false;
      if (prev !== 'street' && !this.streetVisited) { this.streetVisited = true; this.bestView(); }
      else if (prev !== 'street') { this.flyTo(this.streetPos, this.streetPos.clone().add(new THREE.Vector3(-Math.sin(this.yaw), Math.tan(this.pitch), -Math.cos(this.yaw)).multiplyScalar(50)), 1.2); }
    } else {
      this.controls.enabled = true; this.applyLens();
      if (fly) this.frameTarget(prev === 'street' ? 1.4 : 1.8);
    }
    this.applyLens();
  }
  setLens(mm) { this.lensMM = mm; this.applyLens(); }
  applyLens() {   // full-frame (36 mm wide sensor) horizontal field of view
    if (this.mode !== 'street') { this.camera.fov = 50; this.camera.updateProjectionMatrix(); return; }
    const hfov = 2 * Math.atan(18 / this.lensMM), aspect = this.camera.aspect || 1.5;
    this.camera.fov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) / D2R;
    this.camera.updateProjectionMatrix();
  }
  lookAtSun(behind) {
    if (!this.sunVec) return;
    const v = this.sunVec.clone(); if (behind) v.negate();
    const yaw = Math.atan2(-v.x, -v.z), pitch = behind ? 0.12 : Math.max(-0.2, Math.min(0.6, Math.asin(Math.max(-1, Math.min(1, this.sunVec.y)))));
    const look = this.streetPos.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(50));
    this.flyTo(this.streetPos.clone(), look, 0.9);
  }
  groundPoint(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }
  bindStreetControls() {
    const el = this.renderer.domElement;
    let drag = null, down = null, clickTimer = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 450; down = null;
      if (moved > 5 || !quick) return;
      const ev = { clientX: e.clientX, clientY: e.clientY };
      clearTimeout(clickTimer); clickTimer = setTimeout(() => this.pick(ev), 240);   // wait: it may be a double-click
    });
    el.addEventListener('pointerdown', e => { if (this.mode !== 'street') return; this.anim = null; drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (!drag || this.mode !== 'street') return;
      const k = 0.0035 * (this.camera.fov / 50);
      this.yaw += (e.clientX - drag.x) * k; this.pitch += (e.clientY - drag.y) * k;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch)); drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {   // in street mode the scroll wheel zooms through the lenses
      if (this.mode !== 'street') return; e.preventDefault();
      const i = LENSES.indexOf(this.lensMM), j = Math.max(0, Math.min(LENSES.length - 1, i + (e.deltaY > 0 ? 1 : -1)));
      if (j !== i) { this.setLens(LENSES[j]); this.onLensChange?.(LENSES[j]); }
    }, { passive: false });
    el.addEventListener('dblclick', e => {
      clearTimeout(clickTimer);
      const p = this.groundPoint(e); if (!p || Math.hypot(p.x, p.z) > RADIUS * 1.4) return;
      const to = new THREE.Vector3(p.x, EYE, p.z);
      const T = this.target, look = T ? this.v3(T.cx, Math.min(T.top * 0.5, 40), T.cy) : this.currentLook().setY(EYE + 5);
      if (this.mode !== 'street') { this.streetVisited = true; this.mode = 'street'; this.controls.enabled = false; this.applyLens(); this.onModeChange?.('street'); }
      this.streetPos.copy(to);
      this.flyTo(to, this.mode === 'street' && T ? look : this.currentLook(), 1.2);
    });
    addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') this.keys[e.key.toLowerCase()] = true; });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }
  updateStreet(dt) {
    const k = this.keys, run = k.shift ? 14 : 5;
    let f = 0, s = 0;
    if (k.w || k.arrowup || k['pad-f']) f += 1;
    if (k.s || k.arrowdown || k['pad-b']) f -= 1;
    if (k.d || k.arrowright || k['pad-r']) s += 1;
    if (k.a || k.arrowleft || k['pad-l']) s -= 1;
    if (f || s) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      this.streetPos.x += (fx * f + -fz * s) * run * dt;
      this.streetPos.z += (fz * f + fx * s) * run * dt;
      const d = Math.hypot(this.streetPos.x, this.streetPos.z);
      if (d > RADIUS * 1.3) { this.streetPos.x *= RADIUS * 1.3 / d; this.streetPos.z *= RADIUS * 1.3 / d; }
    }
    this.camera.position.copy(this.streetPos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.applyLens();
  }
  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.active) return;
    if (!this.stepAnim(now)) { if (this.mode === 'street') this.updateStreet(dt); else this.controls.update(); }
    this.renderer.render(this.scene, this.camera);
  }
  snapshot(name) {
    this.renderer.render(this.scene, this.camera);
    const a = document.createElement('a'); a.download = name; a.href = this.renderer.domElement.toDataURL('image/png'); a.click();
  }
}
