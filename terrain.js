// Sun Scout — terrain horizon from free elevation tiles (AWS Terrain Tiles, "terrarium" PNGs).
// For every compass direction it finds how high the hills rise above the horizon, so we know when the sun
// really appears over / disappears behind them.
const D2R = Math.PI / 180;
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const lon2tile = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2tile = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
const img = src => new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

// a 3×3 block of elevation tiles around the spot, with a bilinear "height at lat/lng" lookup
async function grid(lat, lng, z) {
  const cx = Math.floor(lon2tile(lng, z)), cy = Math.floor(lat2tile(lat, z));
  const c = document.createElement('canvas'); c.width = c.height = 768;
  const g = c.getContext('2d', { willReadFrequently: true });
  const imgs = await Promise.all([-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => img(URL(z, cx + dx, cy + dy)).then(i => i && g.drawImage(i, (dx + 1) * 256, (dy + 1) * 256)))));
  const d = g.getImageData(0, 0, 768, 768).data;
  const H = new Float32Array(768 * 768);
  for (let k = 0; k < H.length; k++) H[k] = d[k * 4] * 256 + d[k * 4 + 1] + d[k * 4 + 2] / 256 - 32768;
  const ox = (cx - 1) * 256, oy = (cy - 1) * 256;
  return (la, lo) => {
    const x = lon2tile(lo, z) * 256 - ox - 0.5, y = lat2tile(la, z) * 256 - oy - 0.5;
    if (x < 0 || y < 0 || x >= 767 || y >= 767) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * 768 + x0;
    return (H[i] * (1 - fx) + H[i + 1] * fx) * (1 - fy) + (H[i + 768] * (1 - fx) + H[i + 769] * fx) * fy;
  };
}

export async function horizonProfile(lat, lng) {
  const [near, far] = await Promise.all([grid(lat, lng, 12), grid(lat, lng, 9)]);   // ~38 m detail nearby, ~300 m out to ~70 km
  const ground = near(lat, lng) ?? far(lat, lng) ?? 0;
  const eye = Math.max(ground, 0) + 1.7;
  const prof = new Float32Array(360), mPerLat = 110574, mPerLng = 111320 * Math.cos(lat * D2R);
  let max = -90;
  for (let az = 0; az < 360; az++) {
    const s = Math.sin(az * D2R), c = Math.cos(az * D2R);
    let best = -90;
    for (let d = 420; d < 70000; d *= 1.035) {   // nearer than ~400 m is handled by the 3D buildings
      const la = lat + c * d / mPerLat, lo = lng + s * d / mPerLng;
      let h = d < 9000 ? near(la, lo) : null; if (h == null) h = far(la, lo); if (h == null) break;
      h = Math.max(h, 0);                                   // the sea counts as sea level
      const drop = d * d / (2 * 6371000) * 0.87;            // earth curvature, with normal refraction
      const ang = Math.atan2(h - eye - drop, d) / D2R;
      if (ang > best) best = ang;
    }
    prof[az] = best; if (best > max) max = best;
  }
  return { prof, max, ground: Math.round(ground) };
}

// first/last minute of the day when the sun is above the terrain; SunCalc altitudes are in radians
// `off` lifts the sun's centre to its top edge (+ refraction), so a flat horizon gives the official sunrise/sunset
export function hillTimes(prof, sunAt, startUTC, off = 0) {
  let rise = null, set = null, blockedMin = 0;
  for (let m = 0; m <= 1440; m += 1) {
    const p = sunAt(new Date(startUTC + m * 60000)), alt = p.altitude / D2R;
    if (alt < -1) continue;
    const az = Math.round((p.azimuth / D2R + 180 + 360) % 360) % 360;
    const vis = alt + off > prof[az];
    if (vis) { if (rise == null) rise = m; set = m; } else if (alt > 0) blockedMin++;
  }
  return { rise, set, blockedMin };
}
