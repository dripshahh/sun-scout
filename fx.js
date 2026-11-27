// Sun Scout — the animated sky card (sun arc, clouds, rain, stars, a little figure with its shadow)
// and the weather effects drawn over the map / 3D view (rain, snow, storm flashes, fog).
// Everything pauses when it's off-screen or the app is in the background, and stays still for "reduce motion".
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// sky colours (top, horizon) by sun altitude
const SKY = [
  [-18, [5, 8, 20], [12, 17, 38]],
  [-7, [12, 20, 52], [34, 48, 100]],
  [-3, [26, 42, 100], [150, 96, 120]],
  [1, [52, 78, 150], [250, 140, 70]],
  [6, [64, 112, 190], [255, 190, 110]],
  [15, [56, 122, 210], [190, 215, 240]],
  [60, [36, 108, 222], [150, 200, 245]],
];
function skyAt(alt, cloud) {
  let i = 0; while (i < SKY.length - 2 && alt > SKY[i + 1][0]) i++;
  const [a0, t0, b0] = SKY[i], [a1, t1, b1] = SKY[i + 1], f = clamp((alt - a0) / (a1 - a0), 0, 1);
  let top = mix(t0, t1, f), bot = mix(b0, b1, f);
  const day = clamp((alt + 4) / 10, 0, 1), c = cloud * (0.35 + 0.45 * day);    // overcast: greyer, flatter
  top = mix(top, mix([18, 20, 26], [118, 126, 140], day), c); bot = mix(bot, mix([26, 28, 34], [168, 174, 184], day), c);
  return { top, bot };
}

export class SkyCard {
  constructor(canvas, { onScrub } = {}) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.onScrub = onScrub;
    this.d = null; this.visible = true; this.raf = 0; this.last = 0; this.flash = 0;
    const R = (a, b) => a + Math.random() * (b - a);
    this.stars = Array.from({ length: 46 }, () => ({ x: Math.random(), y: R(0.02, 0.6), r: R(0.4, 1.3), p: R(0, 6.3) }));
    this.puffs = Array.from({ length: 10 }, (_, i) => ({ x: Math.random(), y: R(0.08, 0.5), s: R(0.7, 1.35), v: R(0.006, 0.016), k: i }));
    this.drops = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random(), v: R(0.9, 1.4) }));
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.kick());
    this.bindScrub();
  }
  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0); this.draw(performance.now());
  }
  // d: { minutes, alts[145] (every 10 min), alt, cloud 0..1, rain 0..1, snow, storm, fog, rise, set (minutes), blocked }
  set(d) { this.d = d; this.draw(performance.now()); this.kick(); }
  kick() {
    if (this.raf || !this.visible || document.hidden || reduced()) return;
    const loop = t => {
      this.raf = 0;
      if (!this.visible || document.hidden) return;
      if (t - this.last > 40) { this.draw(t); }        // ~25 fps is plenty for drifting clouds and rain
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  bindScrub() {   // drag (or tap) across the sky to change the time; vertical swipes still scroll the page
    const cv = this.cv; let id = null, x0 = 0, y0 = 0, on = false;
    const setX = e => { const r = cv.getBoundingClientRect(); this.onScrub?.(clamp((e.clientX - r.left) / r.width, 0, 1) * 1439); };
    cv.addEventListener('pointerdown', e => { id = e.pointerId; x0 = e.clientX; y0 = e.clientY; on = false; });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      if (!on && Math.abs(e.clientX - x0) > 6 && Math.abs(e.clientX - x0) > Math.abs(e.clientY - y0)) { on = true; try { cv.setPointerCapture(id); } catch { /* ignore */ } cv.classList.add('scrub'); }
      if (on) setX(e);
    });
    const end = e => { if (e.pointerId !== id) return; if (!on && e.type === 'pointerup' && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) setX(e); id = null; on = false; cv.classList.remove('scrub'); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }

  draw(t) {
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000); this.last = t;
    const g = this.g, W = this.W, H = this.H, d = this.d; if (!W || !d) return;
    const hy = H * 0.7, top = 16, still = reduced();
    const X = m => m / 1440 * W, Y = a => a >= 0 ? hy - Math.min(a, 90) / 90 * (hy - top) * 1.15 : hy + (-a) / 40 * (H - hy);
    const sky = skyAt(d.alt, d.cloud), day = clamp((d.alt + 4) / 10, 0, 1);

    // sky
    let gr = g.createLinearGradient(0, 0, 0, hy);
    gr.addColorStop(0, rgb(sky.top)); gr.addColorStop(1, rgb(sky.bot));
    g.fillStyle = gr; g.fillRect(0, 0, W, hy + 1);

    // stars
    const starA = clamp((-d.alt - 3) / 8, 0, 1) * (1 - d.cloud * 0.9);
    if (starA > 0.02) for (const s of this.stars) {
      g.fillStyle = `rgba(255,255,255,${starA * (0.55 + 0.45 * Math.sin(t / 700 + s.p))})`;
      g.beginPath(); g.arc(s.x * W, s.y * hy, s.r, 0, 7); g.fill();
    }
    // moon (decorative) once it's properly dark
    if (d.alt < -6) {
      const mx = W * 0.7, my = 30, a = clamp((-d.alt - 6) / 6, 0, 1) * (1 - d.cloud * 0.6);
      g.fillStyle = `rgba(240,240,225,${a})`; g.beginPath(); g.arc(mx, my, 9, 0, 7); g.fill();
      g.fillStyle = rgb(sky.top, a); g.beginPath(); g.arc(mx + 4, my - 3, 8, 0, 7); g.fill();
    }

    // the sun's path today: bright above the horizon, faint below
    g.lineWidth = 1.5; g.setLineDash([3, 5]);
    for (const above of [false, true]) {
      g.strokeStyle = above ? 'rgba(255,236,190,.75)' : 'rgba(255,255,255,.16)'; g.beginPath();
      let pen = false;
      d.alts.forEach((a, i) => { const ok = above ? a >= 0 : a < 0.5; if (!ok) { pen = false; return; } const x = X(i * 10), y = Y(a); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; });
      g.stroke();
    }
    g.setLineDash([]);

    // the sun, glowing (warmer and bigger near the horizon)
    const sx = X(d.minutes), sy = Y(d.alt);
    if (d.alt > -4) {
      const low = clamp(1 - d.alt / 25, 0, 1), dim = (1 - 0.75 * d.cloud) * (d.blocked ? 0.45 : 1) * clamp((d.alt + 4) / 5, 0, 1);
      const pulse = still ? 0 : Math.sin(t / 650) * 3;
      const core = mix([255, 246, 210], [255, 150, 60], low), R = 34 + 18 * low + pulse;
      gr = g.createRadialGradient(sx, sy, 2, sx, sy, R);
      gr.addColorStop(0, rgb(core, 0.95 * dim)); gr.addColorStop(0.25, rgb(core, 0.45 * dim)); gr.addColorStop(1, rgb(core, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, R, 0, 7); g.fill();
      g.fillStyle = rgb(mix(core, [255, 255, 255], 0.5), Math.max(0.35, dim)); g.beginPath(); g.arc(sx, sy, 7.5, 0, 7); g.fill();
    }

    // clouds drifting across
    const nPuffs = Math.min(this.puffs.length, Math.round(d.cloud * (this.puffs.length - 1)) + (d.cloud > 0.08 ? 1 : 0));
    const cCol = mix(mix([40, 44, 54], [250, 250, 252], day), [150, 156, 168], d.rain * 0.7 * day);
    for (let i = 0; i < nPuffs; i++) {
      const p = this.puffs[i]; if (!still) p.x = (p.x + p.v * dt * (1 + d.rain)) % 1.25;
      const cx = (p.x - 0.12) * W, cy = p.y * hy, s = p.s * (12 + 8 * d.cloud);
      g.fillStyle = rgb(cCol, 0.55 + 0.35 * d.cloud);
      g.beginPath();
      g.ellipse(cx, cy, s * 1.9, s * 0.8, 0, 0, 7); g.ellipse(cx - s * 0.9, cy + s * 0.15, s * 1.1, s * 0.65, 0, 0, 7);
      g.ellipse(cx + s * 0.7, cy - s * 0.35, s * 1.1, s * 0.9, 0, 0, 7); g.ellipse(cx + s * 1.5, cy + s * 0.2, s * 0.9, s * 0.55, 0, 0, 7);
      g.fill();
    }
    // fog: soft bands near the ground
    if (d.fog) { gr = g.createLinearGradient(0, hy * 0.35, 0, hy); gr.addColorStop(0, 'rgba(200,205,215,0)'); gr.addColorStop(1, `rgba(200,205,215,${0.55 * (0.4 + 0.6 * day)})`); g.fillStyle = gr; g.fillRect(0, 0, W, hy); }

    // ground with a soft rolling hill line
    const gTop = mix(sky.bot, [20, 24, 30], 0.72), gBot = [14, 16, 21];
    gr = g.createLinearGradient(0, hy - 6, 0, H); gr.addColorStop(0, rgb(gTop)); gr.addColorStop(1, rgb(gBot));
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, hy - 3 - 4 * Math.sin(x / 47) - 3 * Math.sin(x / 19 + 1));
    g.lineTo(W, H); g.closePath(); g.fill();

    // sunrise / sunset marks on the horizon
    g.font = '600 10px -apple-system, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.7)'; g.textBaseline = 'top';
    const mark = (m, lbl) => { if (m == null || isNaN(m)) return; const x = X(m); g.fillRect(x - 0.5, hy - 4, 1, 8); g.textAlign = x < 30 ? 'left' : x > W - 30 ? 'right' : 'center'; g.fillText(lbl, x, hy + 7); };
    mark(d.rise, d.riseLbl); mark(d.set, d.setLbl);

    // a little figure on the ground and its shadow: long and pointing away from the sun
    const fx = W * 0.5, fy = H - 12, fh = 15;
    if (d.alt > 0.5 && !d.blocked) {
      const len = clamp(fh / Math.tan(d.alt * Math.PI / 180), 2, W * 0.42), dir = sx < fx ? 1 : -1;
      const sa = 0.55 * (1 - 0.8 * d.cloud);
      gr = g.createLinearGradient(fx, 0, fx + dir * len, 0); gr.addColorStop(0, `rgba(0,0,0,${sa})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(fx + dir * len / 2, fy, len / 2, 2.6, 0, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,.88)'; g.fillStyle = 'rgba(255,255,255,.88)'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.arc(fx, fy - fh + 2.5, 2.6, 0, 7); g.fill();
    g.beginPath(); g.moveTo(fx, fy - fh + 5.5); g.lineTo(fx, fy - 5); g.moveTo(fx, fy - 5); g.lineTo(fx - 3, fy); g.moveTo(fx, fy - 5); g.lineTo(fx + 3, fy);
    g.moveTo(fx - 3.5, fy - 9.5); g.lineTo(fx + 3.5, fy - 9.5); g.stroke();

    // rain / snow
    if (d.rain > 0.02 || d.snow) {
      const n = Math.round((d.snow ? 70 : 40 + 80 * d.rain));
      g.strokeStyle = d.snow ? 'rgba(255,255,255,.85)' : 'rgba(190,215,255,.6)'; g.fillStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const p = this.drops[i]; if (!still) p.y += dt * p.v * (d.snow ? 0.18 : 1.6);
        if (p.y > 1) { p.y -= 1; p.x = Math.random(); }
        const x = p.x * W, y = p.y * H;
        if (d.snow) { g.moveTo(x + 1.4, y); g.arc(x, y, 1.4, 0, 7); }
        else { g.moveTo(x, y); g.lineTo(x - 2, y + 9); }
      }
      d.snow ? g.fill() : g.stroke();
    }
    // thunder: the odd flash
    if (d.storm && !still) { if (Math.random() < dt * 0.35) this.flash = 1; }
    if (this.flash > 0) { g.fillStyle = `rgba(235,240,255,${this.flash * 0.55})`; g.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - dt * 3.5); }

    // "now" line
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(sx - 0.5, 0, 1, H);
  }
}

// Rain, snow, fog and lightning over the map or 3D view. rainAt(x, y) can make the rain fall only
// where the forecast map says it rains; otherwise it falls everywhere at `intensity`.
export class WeatherFX {
  constructor(host) {
    const cv = this.cv = document.createElement('canvas'); cv.className = 'wxfx'; host.appendChild(cv);
    this.g = cv.getContext('2d'); this.drops = []; this.flash = 0; this.raf = 0; this.last = 0; this.cfg = { kind: 'off' };
    new ResizeObserver(() => this.resize()).observe(host); this.host = host;
    document.addEventListener('visibilitychange', () => this.kick());
  }
  resize() { const r = this.host.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5); this.W = r.width; this.H = r.height; this.cv.width = r.width * dpr; this.cv.height = r.height * dpr; this.g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  // cfg: { kind: 'off' | 'rain' | 'snow', intensity 0..1, storm, fog 0..1, rainAt?: (x, y) => 0..1 }
  set(cfg) {
    this.cfg = cfg;
    const on = !reduced() && (cfg.kind !== 'off' || cfg.fog > 0);
    this.cv.classList.toggle('on', on);
    if (!on) { cancelAnimationFrame(this.raf); this.raf = 0; this.g.clearRect(0, 0, this.W || 0, this.H || 0); return; }
    this.kick();
  }
  kick() {
    if (this.raf || document.hidden || !this.cv.classList.contains('on')) return;
    const loop = t => { this.raf = 0; if (document.hidden || !this.cv.classList.contains('on')) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  spawn(p, top) {
    const { W, H, cfg } = this;
    for (let k = 0; k < 6; k++) {               // try a few spots; keep the drop where it's raining
      p.x = Math.random() * (W + 60) - 30; p.y = top ? -20 - Math.random() * 40 : Math.random() * H;
      if (!cfg.rainAt || Math.random() < cfg.rainAt(p.x, Math.max(0, p.y))) { p.live = true; break; }
      p.live = false;
    }
    p.v = (cfg.kind === 'snow' ? 40 : 700) * (0.75 + Math.random() * 0.5); p.z = 0.5 + Math.random() * 0.5; p.ph = Math.random() * 6.3;
  }
  frame(t) {
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000); this.last = t;
    const { g, W, H, cfg } = this; if (!W) return;
    g.clearRect(0, 0, W, H);
    if (cfg.fog > 0) { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, `rgba(215,220,228,${0.08 * cfg.fog})`); gr.addColorStop(1, `rgba(215,220,228,${0.3 * cfg.fog})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    if (cfg.kind === 'off') return;
    const snow = cfg.kind === 'snow';
    const want = Math.round((snow ? 140 : 260) * clamp(cfg.rainAt ? 1 : cfg.intensity, 0.15, 1) * Math.min(1.4, W * H / 300000));
    while (this.drops.length < want) { const p = {}; this.spawn(p, false); this.drops.push(p); }
    this.drops.length = Math.min(this.drops.length, want);
    const wind = snow ? 0 : 0.18;
    g.strokeStyle = 'rgba(200,222,255,.55)'; g.lineWidth = 1.2; g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    for (const p of this.drops) {
      p.y += p.v * p.z * dt; p.x += (snow ? Math.sin(t / 600 + p.ph) * 12 : p.v * wind) * p.z * dt;
      if (p.y > H + 10) this.spawn(p, true);
      if (!p.live) continue;
      if (snow) { g.moveTo(p.x + 1.6 * p.z, p.y); g.arc(p.x, p.y, 1.6 * p.z, 0, 7); }
      else { const l = 14 * p.z; g.moveTo(p.x, p.y); g.lineTo(p.x - l * wind, p.y - l); }
    }
    snow ? g.fill() : g.stroke();
    if (cfg.storm) { if (Math.random() < dt * 0.25) this.flash = 1; if (this.flash > 0) { g.fillStyle = `rgba(230,236,255,${this.flash * 0.35})`; g.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - dt * 3); } }
  }
}
