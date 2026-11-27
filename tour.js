// Sun Scout — guided tour: dims the screen, spotlights one part of the app at a time and explains it.
// steps: [{ sel, title, text, before?() }]
export function startTour(steps, { onEnd } = {}) {
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `<div class="tour-hole"></div>
    <div class="tour-tip" role="dialog" aria-live="polite">
      <div class="tt-top"><span class="tt-count"></span><button class="link tt-skip">Skip tour</button></div>
      <h4></h4><p></p>
      <div class="tt-foot"><div class="tt-dots"></div><button class="pill tt-back">Back</button><button class="pill hero tt-next">Next</button></div>
    </div>`;
  document.body.appendChild(root);
  const hole = root.querySelector('.tour-hole'), tip = root.querySelector('.tour-tip');
  const dots = root.querySelector('.tt-dots');
  dots.innerHTML = steps.map(() => '<i></i>').join('');
  let i = -1, target = null, raf = 0;

  const place = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!target) return;
      const r = target.getBoundingClientRect(), pad = 6, W = innerWidth, H = innerHeight;
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      const w = Math.min(W - 4, r.right + pad) - x, h = Math.min(H - 4, r.bottom + pad) - y;
      Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
      // the card goes below the highlighted part if it fits, else above, else at the bottom of the screen
      const tw = Math.min(360, W - 20), th = tip.offsetHeight;
      tip.style.width = tw + 'px';
      let top;
      if (H - (y + h) > th + 18) top = y + h + 12;
      else if (y > th + 18) top = y - th - 12;
      else top = H - th - 12;
      tip.style.top = Math.max(10, top) + 'px';
      tip.style.left = Math.min(Math.max(10, r.left + r.width / 2 - tw / 2), W - tw - 10) + 'px';
    });
  };
  const show = n => {
    if (n < 0) return;
    if (n >= steps.length) return end();
    const s = steps[n];
    s.before?.();
    const el = document.querySelector(s.sel);
    if (!el || !el.getClientRects().length) return show(n > i ? n + 1 : n - 1);   // not on screen in this layout: skip it
    i = n; target = el;
    root.querySelector('.tt-count').textContent = `${n + 1} of ${steps.length}`;
    tip.querySelector('h4').textContent = s.title;
    tip.querySelector('p').innerHTML = s.text;
    root.querySelector('.tt-back').classList.toggle('hidden', n === 0);
    root.querySelector('.tt-next').textContent = n === steps.length - 1 ? 'Start exploring' : 'Next';
    root.querySelector('.tt-skip').classList.toggle('hidden', n === steps.length - 1);
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === n));
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 70) el.scrollIntoView({ block: r.height > innerHeight * 0.6 ? 'start' : 'center' });
    tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
    place(); setTimeout(place, 120);
  };
  const end = () => {
    removeEventListener('resize', place); removeEventListener('scroll', place, true); removeEventListener('keydown', key);
    root.classList.add('out'); setTimeout(() => root.remove(), 250);
    onEnd?.();
  };
  const key = e => { if (e.key === 'Escape') end(); else if (e.key === 'ArrowRight' || e.key === 'Enter') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); };
  root.querySelector('.tt-next').onclick = () => show(i + 1);
  root.querySelector('.tt-back').onclick = () => show(i - 1);
  root.querySelector('.tt-skip').onclick = end;
  addEventListener('resize', place); addEventListener('scroll', place, true); addEventListener('keydown', key);
  show(0);
  return { end };
}
