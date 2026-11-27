// Sun Scout — AR: hold your phone up and see today's sun path (and the moon) drawn over the camera.
// Uses the phone's compass + tilt sensors. Without sensors (a laptop) you can drag to look around instead.
const D = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dirOf = (b, a) => [Math.sin(b * D) * Math.cos(a * D), Math.cos(b * D) * Math.cos(a * D), Math.sin(a * D)]; // east, north, up
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// W3C device orientation → device axes in world coordinates (x = right edge, y = top edge, z = out of the screen)
function axesFrom(a, b, g) {
  const ca = Math.cos(a * D), sa = Math.sin(a * D), cb = Math.cos(b * D), sb = Math.sin(b * D), cg = Math.cos(g * D), sg = Math.sin(g * D);
  return [
    [ca * cg - sa * sb * sg, cg * sa + ca * sb * sg, -cb * sg],
    [-cb * sa, ca * cb, sb],
    [cg * sa * sb + ca * sg, sa * sg - ca * cg * sb, cb * cg],
  ];
}

export class ARView {
  // data(): { sun:[{b,a,m}], moon:[{b,a}], hours:[{b,a,lbl}], sunNow:{b,a}|null, moonNow:{b,a,ico}|null,
  //           live:[{b,a}], hills:number[360]|null, rise:{b,lbl}, set:{b,lbl}, time:string }
  constructor(root, { data, onTime, getTime }) {
    this.root = root; this.data = data; this.onTime = onTime; this.getTime = getTime;
    this.video = root.querySelector('video'); this.cv = root.querySelector('canvas'); this.g = this.cv.getContext('2d');
    this.msgEl = root.querySelector('.armsg'); this.slider = root.querySelector('input[type=range]');
    this.axes = null; this.manual = false; this.yaw = 0; this.pitch = 10; this.yawFix = 0; this.aligning = false;
    this.fovLong = 64; this.raf = 0; this.gotSensor = false;
    this.onOri = e => this.handle(e);
    this.slider.oninput = () => this.onTime(Number(this.slider.value));
    root.querySelector('.arclose').onclick = () => this.close();
    root.querySelector('.aralign').onclick = () => { this.aligning = !this.aligning; this.hint(); };
    root.querySelector('.arzoom').onclick = e => { this.fovLong = this.fovLong === 64 ? 46 : this.fovLong === 46 ? 80 : 64; e.currentTarget.textContent = { 46: '🔍 Tele', 64: '🔍 1×', 80: '🔍 Wide' }[this.fovLong]; };
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', () => { this.drag = null; });
    addEventListener('resize', () => this.size());
  }
  get isOpen() { return !this.root.classList.contains('hidden'); }

  // must be called straight from a tap (iPhone only allows camera / motion access from one)
  open() {
    this.root.classList.remove('hidden'); document.body.classList.add('arOn');
    this.size(); this.gotSensor = false; this.manual = false; this.axes = null; this.yawFix = 0; this.aligning = false; this.relative = false; this.iosOff = null; this.warned = false;
    this.slider.value = this.getTime();
    this.msg('Starting camera…');
    const cam = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      : Promise.reject(new Error('no camera'));
    const perm = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
    cam.then(s => { if (!this.isOpen) return s.getTracks().forEach(t => t.stop()); this.stream = s; this.video.srcObject = s; this.video.play().catch(() => {}); this.root.classList.add('cam'); })
      .catch(() => { this.root.classList.remove('cam'); });
    perm.then(p => {
      if (p !== 'granted') return this.goManual('Motion access is off, so drag to look around. (Allow it to follow your phone.)');
      this.evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      addEventListener(this.evt, this.onOri);
      setTimeout(() => { if (this.isOpen && !this.gotSensor) this.goManual(matchMedia('(pointer: coarse)').matches ? 'No compass found, so drag to look around.' : 'On a phone this follows where you point. Here, drag to look around.'); }, 1500);
      this.hint();
    });
    const loop = () => { this.raf = requestAnimationFrame(loop); this.draw(); };
    cancelAnimationFrame(this.raf); loop();
  }
  close() {
    this.root.classList.add('hidden'); this.root.classList.remove('cam'); document.body.classList.remove('arOn');
    cancelAnimationFrame(this.raf);
    if (this.evt) removeEventListener(this.evt, this.onOri);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.video.srcObject = null;
  }
  goManual(why) {
    if (this.gotSensor) return;
    this.manual = true;
    const s = this.data().sunNow; this.yaw = s ? s.b : 180; this.pitch = s ? clamp(s.a, -5, 50) : 10;
    this.msg(why);
  }
  msg(t) { this.msgEl.textContent = t; this.msgEl.classList.toggle('hidden', !t); }
  hint() {
    if (this.aligning) return this.msg('Tap the real sun (or moon) on screen to line everything up.');
    this.msg(this.manual ? 'Drag to look around.' : 'Point your phone at the sky. Off a bit? Tap 🎯 Align.');
    clearTimeout(this.hintT); this.hintT = setTimeout(() => { if (!this.aligning) this.msg(''); }, 5000);
  }
  syncTime(m) { if (this.isOpen) this.slider.value = m; }
  size() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.W = r.width; this.H = r.height; this.cv.width = r.width * dpr; this.cv.height = r.height * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  handle(e) {
    if (e.alpha == null || e.beta == null) return;
    let a = e.alpha;
    if (e.webkitCompassHeading != null && e.webkitCompassHeading >= 0) {
      // iPhone: the tilt sensors are smooth but don't know north; the compass knows north but is jumpy (worst when the phone
      // is held upright). So keep the smooth sensors and only slowly learn how far they are from true north.
      const off = (360 - e.webkitCompassHeading) - e.alpha;
      if (this.iosOff == null) this.iosOff = off;
      else this.iosOff += (((off - this.iosOff + 540) % 360) - 180) * (Math.abs(e.beta) < 45 ? 0.04 : 0.008);
      a = e.alpha + this.iosOff;
      this.unsure = e.webkitCompassAccuracy > 25;
    } else if (!e.absolute && this.evt === 'deviceorientation') this.relative = true; // no north reference: Align fixes it
    const ax = axesFrom(a, e.beta, e.gamma);
    if (!this.gotSensor) { this.gotSensor = true; this.manual = false; this.axes = ax; if (this.relative) { this.aligning = true; } this.hint(); return; }
    // smooth out the shake: small wobbles are damped hard, real turns follow quickly
    const [X0, , Z0] = this.axes, [X1, , Z1] = ax;
    const turn = Math.acos(clamp(dot(Z0, Z1), -1, 1)) / D;
    const k = clamp(turn / 10, 0.05, 0.6);
    const norm = v => { const n = Math.hypot(...v) || 1; return v.map(c => c / n); };
    const Z = norm(Z0.map((c, i) => c + (Z1[i] - c) * k));
    let X = X0.map((c, i) => c + (X1[i] - c) * k); const xz = dot(X, Z); X = norm(X.map((c, i) => c - xz * Z[i]));
    const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    this.axes = [X, Y, Z];
    if (this.unsure && !this.aligning && !this.warned) { this.warned = true; this.msg('Compass unsure: wave the phone in a figure-8, or tap 🎯 Align.'); clearTimeout(this.hintT); this.hintT = setTimeout(() => this.msg(''), 5000); }
  }
  // device axes, after the user's alignment nudge
  frame() {
    let X, Y, Z;
    if (this.manual || !this.axes) {
      const h = this.yaw * D, p = this.pitch * D;
      const f = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)], r = [Math.cos(h), -Math.sin(h), 0];
      Y = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      X = r; Z = [-f[0], -f[1], -f[2]];
      return { X, Y, Z, rot: 0 };
    }
    const c = Math.cos(this.yawFix * D), s = Math.sin(this.yawFix * D), turn = v => [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
    [X, Y, Z] = this.axes.map(turn);
    return { X, Y, Z, rot: (screen.orientation?.angle ?? window.orientation ?? 0) * D };
  }
  focal() { return Math.max(this.W, this.H) / 2 / Math.tan(this.fovLong / 2 * D); }
  // compass bearing + altitude → screen point (null if behind you); also returns the raw direction for edge arrows
  project(fr, b, a) {
    const v = dirOf(b, a), dx = dot(v, fr.X), dy = dot(v, fr.Y), fw = -dot(v, fr.Z);
    const sx = dx * Math.cos(fr.rot) - dy * Math.sin(fr.rot), sy = dx * Math.sin(fr.rot) + dy * Math.cos(fr.rot);
    if (fw < 0.08) return { off: true, sx, sy, fw };
    const f = this.focal();
    return { x: this.W / 2 + f * sx / fw, y: this.H / 2 - f * sy / fw, sx, sy, fw };
  }
  // screen point → compass bearing / altitude
  unproject(fr, x, y) {
    const f = this.focal(), sx = (x - this.W / 2) / f, sy = -(y - this.H / 2) / f;
    const dx = sx * Math.cos(fr.rot) + sy * Math.sin(fr.rot), dy = -sx * Math.sin(fr.rot) + sy * Math.cos(fr.rot);
    const v = [0, 1, 2].map(i => dx * fr.X[i] + dy * fr.Y[i] - fr.Z[i]);
    const n = Math.hypot(...v);
    return { b: (Math.atan2(v[0], v[1]) / D + 360) % 360, a: Math.asin(v[2] / n) / D };
  }

  down(e) {
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.aligning) {
      const fr = this.frame(), tap = this.unproject(fr, x, y), d = this.data();
      const cands = (d.live || []).filter(p => p && p.a > -1);
      if (!cands.length) { this.msg('The sun and moon are both below the horizon right now, so there is nothing to align to.'); this.aligning = false; return; }
      const best = cands.sort((p, q) => Math.abs(((p.b - tap.b + 540) % 360) - 180) - Math.abs(((q.b - tap.b + 540) % 360) - 180))[0];
      const diff = ((best.b - tap.b + 540) % 360) - 180;
      if (this.manual) this.yaw = (this.yaw + diff + 360) % 360; else this.yawFix = (this.yawFix + diff + 360) % 360;
      this.aligning = false; this.msg('✓ Lined up.'); clearTimeout(this.hintT); this.hintT = setTimeout(() => this.msg(''), 2500);
      return;
    }
    if (this.manual) { this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; this.cv.setPointerCapture?.(e.pointerId); }
  }
  move(e) {
    if (!this.drag) return;
    const k = this.fovLong / Math.max(this.W, this.H);
    this.yaw = (this.drag.yaw - (e.clientX - this.drag.x) * k + 360) % 360;
    this.pitch = clamp(this.drag.pitch + (e.clientY - this.drag.y) * k, -60, 85);
  }

  draw() {
    const g = this.g, W = this.W, H = this.H; if (!W) return;
    g.clearRect(0, 0, W, H);
    const cam = this.root.classList.contains('cam');
    const fr = this.frame(), d = this.data();
    if (!cam) {   // no camera: a simple sky so it still reads
      const hz = this.project(fr, fr.Z ? (Math.atan2(-fr.Z[0], -fr.Z[1]) / D + 360) % 360 : 0, 0);
      const hy = hz.off ? H / 2 : clamp(hz.y, -H, 2 * H);
      const gr = g.createLinearGradient(0, hy - H, 0, hy + 1);
      gr.addColorStop(0, '#0d1b3a'); gr.addColorStop(1, '#3b5d93');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#151a12'; g.fillRect(0, hy, W, H);
    }
    const path = (pts, style, width, dash, close) => {
      g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash || []); g.beginPath();
      let pen = false, last = null;
      for (const p of pts) {
        const q = this.project(fr, p.b, p.a);
        if (q.off || (last && Math.hypot(q.x - last.x, q.y - last.y) > W)) { pen = false; last = null; if (q.off) continue; }
        pen ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); pen = true; last = q;
      }
      g.stroke(); g.setLineDash([]);
    };
    const label = (q, txt, col, sz = 13, dy = 0) => {
      g.font = `700 ${sz}px -apple-system, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(txt, q.x, q.y + dy); g.fillStyle = col; g.fillText(txt, q.x, q.y + dy);
    };

    // horizon + compass ticks
    const ring = []; for (let b = 0; b <= 360; b += 2) ring.push({ b, a: 0 });
    path(ring, 'rgba(255,255,255,.55)', 1.5);
    for (let b = 0; b < 360; b += 15) {
      const q = this.project(fr, b, 0); if (q.off) continue;
      const main = b % 45 === 0;
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = main ? 2 : 1; g.beginPath(); g.moveTo(q.x, q.y - (main ? 8 : 4)); g.lineTo(q.x, q.y + (main ? 8 : 4)); g.stroke();
      if (main) label(q, COMPASS[b / 45], b === 0 ? '#ff8a7a' : '#fff', 14, 20);
    }
    // hills
    if (d.hills) { const h = []; for (let b = 0; b <= 360; b += 2) h.push({ b, a: d.hills[b % 360] }); path(h, 'rgba(120,220,140,.85)', 2, [6, 5]); }
    // sunrise / sunset bearings on the horizon
    for (const s of [d.rise, d.set]) { if (!s) continue; const q = this.project(fr, s.b, 0); if (!q.off) { g.fillStyle = '#ff7a59'; g.beginPath(); g.arc(q.x, q.y, 5, 0, 7); g.fill(); label(q, s.lbl, '#ffc2a8', 13, -16); } }

    // moon path, then sun path coloured by the light (blue hour → golden → day)
    if (d.moon?.length) path(d.moon, 'rgba(200,215,255,.7)', 2, [3, 6]);
    const band = a => a < 0 ? 0 : a < 6 ? 1 : 2, STY = [['rgba(110,160,255,.95)', 4], ['rgba(255,150,50,.98)', 5], ['rgba(255,226,140,.95)', 4]];
    let run = [], prev = null;
    for (const p of d.sun) {
      if (prev && p.m - prev.m > 4) { if (run.length > 1) path(run, ...STY[band(run[1].a)]); run = []; }
      else if (prev && band(p.a) !== band(prev.a)) { run.push(p); path(run, ...STY[band(prev.a)]); run = [prev]; }
      run.push(p); prev = p;
    }
    if (run.length > 1) path(run, ...STY[band(run[run.length - 1].a)]);
    const sq = d.sunNow ? this.project(fr, d.sunNow.b, d.sunNow.a) : null;
    for (const h of d.hours) { const q = this.project(fr, h.b, h.a); if (q.off || (sq && !sq.off && Math.hypot(q.x - sq.x, q.y - sq.y) < 34)) continue; g.fillStyle = '#fff'; g.beginPath(); g.arc(q.x, q.y, 3.5, 0, 7); g.fill(); label(q, h.lbl, '#fff', 12, -14); }

    // the moon and the sun at the chosen time
    if (d.moonNow) { const q = this.project(fr, d.moonNow.b, d.moonNow.a); if (!q.off) { g.font = '26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.moonNow.ico, q.x, q.y); } }
    let arrow = null;
    if (d.sunNow) {
      const q = this.project(fr, d.sunNow.b, d.sunNow.a);
      const inView = !q.off && q.x > -20 && q.x < W + 20 && q.y > -20 && q.y < H + 20;
      if (inView) {
        const gr = g.createRadialGradient(q.x, q.y, 2, q.x, q.y, 46); gr.addColorStop(0, 'rgba(255,240,190,.95)'); gr.addColorStop(.35, 'rgba(255,190,80,.5)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(q.x, q.y, 46, 0, 7); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(q.x, q.y, 16, 0, 7); g.stroke();
        label(q, '☀️ ' + d.time, '#ffe39a', 15, 32);
      } else arrow = q;
    }
    // sun out of view: an arrow at the edge pointing the way to turn
    if (arrow) {
      let ang = Math.atan2(-arrow.sy, arrow.sx); if (arrow.off && Math.hypot(arrow.sx, arrow.sy) < 0.15) ang = 0;
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 46, ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r;
      g.save(); g.translate(ax, ay); g.rotate(ang);
      g.fillStyle = 'rgba(255,176,46,.95)'; g.beginPath(); g.moveTo(20, 0); g.lineTo(-10, -13); g.lineTo(-4, 0); g.lineTo(-10, 13); g.closePath(); g.fill();
      g.restore();
      label({ x: ax - Math.cos(ang) * 34, y: ay - Math.sin(ang) * 34 }, `☀️ ${d.time} this way`, '#ffe39a', 13);
    }
  }
}
