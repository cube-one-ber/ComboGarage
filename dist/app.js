'use strict';
/* Combo Garage — Mario Kart World stat lab.
   Stats: level = driver points + vehicle points, clamped 0–25; level → ratio from the game's table. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/* ------------------------------------------------------------ stat definitions */
const TERRAIN = { Tarmac: 'road', Gravel: 'off-road', Water: 'water' };
const CORE = [
  { id: 'speed', name: 'Speed', short: 'Spd', key: t => 'TopSpeed' + t },
  { id: 'accel', name: 'Acceleration', short: 'Acc', key: () => 'Acceleration' },
  { id: 'mt', name: 'Mini-turbo', short: 'MT', key: () => 'DriftDashTime' },
  { id: 'handling', name: 'Handling', short: 'Hnd', key: t => 'Handling' + t },
  { id: 'coin', name: 'Coin speed', short: 'Coin', key: () => 'CoinSpeedRatio' },
  { id: 'weight', name: 'Weight', short: 'Wgt', key: () => 'Weight' },
];
const SAME = ' Every combo has the same value, so it never separates two builds.';
/* Each description comes from tracing the stat through the game's code (see the README). */
const STAT_INFO = {
  TopSpeedTarmac: 'Scales your speed on road. The game checks the ground under you every frame and switches between road, off-road and water speed to match.',
  TopSpeedGravel: 'Scales your speed on ground that isn\'t road, dirt or water. The game\'s name for this one is Gravel.',
  TopSpeedWater: 'Scales your speed on water.',
  TopSpeedGlide: 'Replaces your surface speed while you\'re gliding.',
  TopSpeedDirt: 'Your speed on dirt.' + SAME,
  TopSpeedRailSlide: 'Your speed while grinding a rail.' + SAME,
  TopSpeedWallRide: 'Your speed while riding a wall.' + SAME,
  Acceleration: 'Multiplies how fast your speed builds up, every frame. No other stat swings as much, and it\'s what gets you back up to speed after a hit.',
  DriftDashTime: 'Multiplies how long a drift boost lasts: boost frames = base frames × this value. It changes the length of the boost, not its strength.',
  HandlingTarmac: 'Multiplies how sharply you turn on road.',
  HandlingGravel: 'Multiplies how sharply you turn on ground that isn\'t road, dirt or water.',
  HandlingWater: 'Multiplies how sharply you turn on water.',
  HandlingDirt: 'How sharply you turn on dirt.' + SAME,
  HandlingGlide: 'How sharply you turn while gliding.' + SAME,
  HandlingGrip: 'A second turn-rate multiplier on the game\'s normal steering path, separate from surface handling.',
  TireGrip: 'A grip value named in the stat table.' + SAME,
  Weight: 'Heavier combos take a smaller kick in a collision. The game scales that kick by 1 ÷ your weight, between ×0.5 and ×2.',
  CoinSpeedRatio: 'Decides how early your coins pay off. Everyone gets the same speed bonus at 20 coins. A high value gives you most of it from your first few coins, and a low value holds it back until you\'re near 20.',
  InvincibleRatio: 'Multiplies how long you stay invincible after a hit. The base is 150–200 frames after a spin, crash or squash, and 70–100 after lightning.',
};

const PRESETS = {
  online: { label: 'Online meta', w: { speed: 3, accel: 3, mt: 2, handling: 1, coin: 2, weight: 0 } },
  tt: { label: 'Time trial', w: { speed: 5, accel: 1, mt: 1, handling: 1, coin: 0, weight: 0 } },
  balanced: { label: 'Balanced', w: { speed: 1, accel: 1, mt: 1, handling: 1, coin: 1, weight: 0 } },
};

/* ------------------------------------------------------------ state */
const state = {
  driver: null, vehicle: null, terrain: 'Tarmac', preview: null,
  tab: 'drivers', search: '', sort: 'class', ride: 'all',
  finder: { preset: 'online', terrain: 'Tarmac', weights: { ...PRESETS.online.w }, lockD: false, lockV: false, x: 'speed', y: 'accel' },
  saved: [], compare: [],
};
let D, drivers, vehicles, usedD, usedV, ranges;
const spin = { on: false, skip: false, cancel: false, ready: false, roll: 0 };
const NEG = '−';
const signed = n => (n > 0 ? '+' + n : n < 0 ? NEG + Math.abs(n) : '0');

/* ------------------------------------------------------------ stat maths */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const level = (dc, vc, k) => clamp(D.driverClasses[dc][k] + D.vehicleClasses[vc][k], 0, 25);
const ratio = (k, l) => D.curves['Level' + String(l).padStart(2, '0')][k] ?? 1;
const fmtRatio = r => '×' + r.toFixed(3);
const norm = (k, l) => { const [a, b] = ranges[k]; return b > a ? (l - a) / (b - a) : 0; };

/* Coin bonus: code at 0x656360 / 0x65a220. c = coins ÷ 20, shape = ratio − 0.5 (both 0–1). */
function coinBonus(r, coins) {
  const c = clamp(coins * 0.05, 0, 1), sh = clamp(r - 0.5, 0, 1);
  const easeOut = Math.sqrt(1 - (1 - c) ** 2), easeIn = 1 - Math.sqrt(1 - c * c);
  return (easeIn + sh * (easeOut - easeIn)) * 5;
}
function scorer(weights, terrain) {
  const parts = CORE.map(c => [c.key(terrain), weights[c.id] || 0]).filter(p => p[1] > 0);
  const total = parts.reduce((a, p) => a + p[1], 0);
  return (dc, vc) => (total ? parts.reduce((a, [k, w]) => a + w * norm(k, level(dc, vc, k)), 0) / total * 100 : 0);
}
const onlineScore = () => scorer(PRESETS.online.w, 'Tarmac');
const openCount = name => D.worldOpen.drivers[name] || 0;

/* ------------------------------------------------------------ images */
const vSrc = (id, w) => `img/vehicles/${id}-${w}.webp`;
const vCard = id => `img/vehicles/${id}-card.webp`;
const dBig = id => `img/drivers/${id}.webp`;
const dIcon = id => `img/drivers/${id}-icon.webp`;

/* ------------------------------------------------------------ tooltip + toast */
const tipEl = () => $('#tooltip');
function showTip(nodes, x, y) {
  const t = tipEl();
  t.replaceChildren(...nodes);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = clamp(x + 14, 8, innerWidth - r.width - 8) + 'px';
  t.style.top = (y + r.height + 20 > innerHeight ? y - r.height - 12 : y + 14) + 'px';
}
const hideTip = () => { tipEl().hidden = true; };
function tipOn(el, build) {
  el.addEventListener('pointerenter', e => showTip(build(), e.clientX, e.clientY));
  el.addEventListener('pointermove', e => showTip(build(), e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(build(), r.left, r.bottom); });
  el.addEventListener('blur', hideTip);
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* A stat's hover: what it does, then what it is on this combo. */
function statTip(k, title, d = state.driver, v = state.vehicle) {
  const dp = D.driverClasses[d.cls][k], vp = D.vehicleClasses[v.cls][k], l = level(d.cls, v.cls, k);
  const nodes = [
    h('strong', { text: title }),
    h('div', { text: STAT_INFO[k] }),
    h('div', { class: 'tt-sub tt-sep', text: `This combo: ${dp} ${vp < 0 ? NEG : '+'} ${Math.abs(vp)} = level ${l}, ${fmtRatio(ratio(k, l))}` }),
  ];
  if (k === 'CoinSpeedRatio') {
    const r = ratio(k, l);
    nodes.push(h('div', { class: 'tt-sub', text: `Bonus at 5 / 10 / 20 coins: +${coinBonus(r, 5).toFixed(1)}% / +${coinBonus(r, 10).toFixed(1)}% / +5.0%` }));
  }
  return nodes;
}

/* ------------------------------------------------------------ combo selection */
function setCombo(d, v, opts = {}) {
  if (spin.on) spin.cancel = true;   // picking by hand beats a spin in progress
  const dc = d !== state.driver, vc = v !== state.vehicle;
  const before = vc && !opts.spun && !calmMotion() ? snapshotMeters() : null;
  state.driver = d; state.vehicle = v;
  state.preview = null;
  renderStage(dc, vc, opts.back);
  renderStats();
  if (before) tweenMeters(before);
  syncChooser();
  renderImpact();
  renderCoins();
  renderFinderResults();
  syncButtons();
  const q = new URLSearchParams({ d: d.id, v: v.id });
  history.replaceState(null, '', '?' + q + location.hash);
}
const pair = () => ({ d: state.driver.id, v: state.vehicle.id });
const same = (a, b) => a.d === b.d && a.v === b.v;
const resolve = p => ({ d: drivers.get(p.d), v: vehicles.get(p.v) });

/* ------------------------------------------------------------ vehicle change
   The old vehicle squats and pulls away. The new one arrives, overruns its mark, dips its nose
   under braking and rocks back. Going backwards plays it in reverse. Only transform and opacity
   animate, so the browser can keep it smooth on its compositor. */
const calmMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function setVehicleImage(img, v) {
  img.srcset = `${vSrc(v.id, 1200)} 1200w, ${vSrc(v.id, 1920)} 1920w`;
  img.sizes = '(max-width: 720px) 110vw, (max-width: 1180px) 80vw, 62vw';
  img.src = vSrc(v.id, 1920);
  img.alt = v.name + ', studio render';
}
function preloadNeighbours() {
  const n = D.vehicles.length, i = D.vehicles.findIndex(v => v.id === state.vehicle.id);
  for (const d of [-1, 1]) setVehicleImage(new Image(), D.vehicles[(i + d + n) % n]);
}
let lastSwap = 0;
function driveSwap(v, back, oldName) {
  const wrap = $('.stage-vehicle-wrap'), cur = $('#stageVehicle'), s = back ? -1 : 1, now = performance.now();
  const pace = now - lastSwap < 450 ? .62 : 1;   // keep up with quick clicks
  lastSwap = now;
  for (const a of wrap.getAnimations({ subtree: true })) a.cancel();
  $$('.veh-ghost', wrap).forEach(e => e.remove());
  const ghost = () => {
    const g = cur.cloneNode();
    g.removeAttribute('id'); g.alt = ''; g.classList.add('veh-ghost');
    wrap.append(g);
    return g;
  };
  const leaving = [ghost(), ghost(), ghost()];
  setVehicleImage(cur, v);
  const arriving = [cur, ghost(), ghost()];

  const leave = [
    { transform: 'none' },
    { transform: `translateX(${-s * 6}%) rotate(${s * .9}deg) skewX(${s * 2}deg)`, offset: .24 },
    { transform: `translateX(${-s * 140}%) rotate(${s * .4}deg) scaleX(1.1) skewX(${s * 7}deg)` },
  ];
  const arrive = [
    { transform: `translateX(${s * 125}%) scaleX(1.1) skewX(${s * 7}deg)`, easing: 'cubic-bezier(.08,.72,.2,1)' },
    { transform: `translateX(${-s * 2.8}%) rotate(${-s * 1.8}deg) skewX(${s * 2}deg)`, offset: .56, easing: 'ease-in-out' },
    { transform: `translateX(${s * .9}%) rotate(${s * .8}deg) skewX(${-s * .8}deg)`, offset: .79, easing: 'ease-in-out' },
    { transform: 'none' },
  ];
  const out = { duration: 300 * pace, easing: 'cubic-bezier(.42,0,.85,.5)', fill: 'forwards' };
  const inn = { duration: 620 * pace, delay: 200 * pace, fill: 'backwards' };
  leaving.forEach((g, i) => {
    g.animate(leave, { ...out, delay: i * 16 });
    if (i) g.animate([{ opacity: 0 }, { opacity: .22 / i, offset: .34 }, { opacity: 0, offset: .9 }], { ...out, delay: i * 16 });
  });
  const last = leaving[0].getAnimations()[0];
  last.onfinish = () => leaving.forEach(g => g.remove());
  arriving.forEach((g, i) => {
    const a = g.animate(arrive, { ...inn, delay: inn.delay + i * 16 });
    if (!i) return;
    g.animate([{ opacity: .22 / i }, { opacity: .22 / i, offset: .14 }, { opacity: 0, offset: .36 }], { ...inn, delay: inn.delay + i * 16, fill: 'both' });
    a.onfinish = () => g.remove();
  });
  rush(s, pace);
  nameSwap(oldName, s, pace);
}
function rush(s, pace) {
  const box = $('#stageRush'), W = box.clientWidth;
  box.replaceChildren();
  for (let i = 0; i < 14; i++) {
    const w = 160 + Math.random() * 380, low = i % 2 === 1;
    const bar = h('i', { class: low ? 'low' : '', style: `top:${(low ? 62 : 16) + Math.random() * 28}%;${s > 0 ? 'left:100%' : `left:${-w}px`};width:${w}px` });
    box.append(bar);
    bar.animate([
      { transform: 'none', opacity: 0 },
      { opacity: 1, offset: .22 },
      { opacity: 0, transform: `translateX(${-s * (W + w * 1.3)}px)` },
    ], { duration: (340 + Math.random() * 260) * pace, delay: 40 + Math.random() * 200 * pace, easing: 'cubic-bezier(.25,.2,.55,1)', fill: 'backwards' }).onfinish = () => bar.remove();
  }
}
function nameSwap(oldName, s, pace) {
  const el = $('#vehicleName');
  for (const a of el.getAnimations()) a.cancel();
  $$('.name-ghost').forEach(e => e.remove());
  const g = el.cloneNode(false);
  g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.classList.add('name-ghost');
  g.classList.toggle('long', oldName.length > 13);
  g.textContent = oldName;
  g.style.left = el.offsetLeft + 'px'; g.style.top = el.offsetTop + 'px';
  el.after(g);
  g.animate([{ opacity: 1 }, { opacity: 0, transform: `translateX(${-s * 54}px) skewX(${s * 9}deg)` }], { duration: 170 * pace, easing: 'ease-in', fill: 'forwards' }).onfinish = () => g.remove();
  el.animate([
    { opacity: 0, transform: `translateX(${s * 60}px) skewX(${s * 9}deg)` },
    { opacity: 1, transform: `translateX(${-s * 3}px) skewX(${-s * 2}deg)`, offset: .66 },
    { opacity: 1, transform: 'none' },
  ], { duration: 420 * pace, delay: 175 * pace, easing: 'cubic-bezier(.16,.8,.3,1)', fill: 'backwards' });
}
function snapshotMeters() {
  return $$('#meters .meter').map(m => ({ level: +$('.meter-level', m).textContent, segs: $$('.segs i', m).map(i => i.className) }));
}
function tweenMeters(before) {   // ripple the segments that changed and count up to the new level
  const after = $$('#meters .meter');
  if (before.length !== after.length) return;
  after.forEach((m, i) => {
    const was = before[i], num = $('.meter-level', m), to = +num.textContent;
    $$('.segs i', m).forEach((seg, j) => { if (seg.className !== was.segs[j]) seg.classList.add('flip'); });
    if (to === was.level) return;
    num.textContent = was.level;
    const t0 = performance.now();
    const run = t => {
      const u = clamp((t - t0 - 90) / 380, 0, 1);
      if (num.isConnected) num.textContent = Math.round(was.level + (to - was.level) * (1 - (1 - u) ** 3));
      if (u < 1 && num.isConnected) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  });
}

function renderStage(dc, vc, back) {
  const { driver: d, vehicle: v } = state, st = $('#stage'), oldName = $('#vehicleName').textContent;
  $('#driverName').textContent = d.name;
  $('#driverName').classList.toggle('long', d.name.length > 8);
  $('#vehicleName').textContent = v.name;
  $('#vehicleName').classList.toggle('long', v.name.length > 13);
  if (vc && !calmMotion()) driveSwap(v, back, oldName); else setVehicleImage($('#stageVehicle'), v);
  const di = $('#stageDriver');
  di.src = dBig(d.id);
  di.alt = d.name + (d.outfit === 'Standard' ? '' : ' in the ' + d.outfit + ' outfit');
  if (dc) { st.classList.remove('swap-d'); void st.offsetWidth; st.classList.add('swap-d'); }
  const rank = comboRank(d.cls, v.cls);
  $('#stageTags').replaceChildren(...[
    rank === 1 ? h('span', { class: 'tag tag-hot', text: 'Online meta #1' }) : null,
    d.opens ? h('span', { class: 'tag', text: d.opens + ' of top 100' }) : null,
    h('span', { class: 'tag', text: v.rideLabel }), h('span', { class: 'tag', text: d.cls }), h('span', { class: 'tag', text: v.cls }),
  ].filter(Boolean));
  const box = $('#outfits');
  const list = d.char.outfits.length > 1 ? d.char.outfits : [];
  box.replaceChildren(...list.map(o => h('button', {
    type: 'button', title: o.outfit, 'aria-label': o.outfit + ' outfit', 'aria-pressed': String(o.id === d.id),
    onclick: () => setCombo(drivers.get(o.id), state.vehicle),
  }, h('img', { src: dIcon(o.id), alt: '', loading: 'lazy' }))));
}
function comboRank(dc, vc) {
  const score = onlineScore(), mine = score(dc, vc);
  let rank = 1;
  for (const a of usedD) for (const b of usedV) if (score(a, b) > mine + 1e-9) rank++;
  return rank;
}

/* ------------------------------------------------------------ stats panel */
function meterSegs(dp, vp, l, previewLevel) {
  const box = h('div', { class: 'segs', 'aria-hidden': 'true' });
  for (let i = 1; i <= 25; i++) {
    let c = '';
    if (vp >= 0) c = i <= dp ? 'd' : i <= l ? 'b' : '';
    else c = i <= l ? 'd' : i <= dp ? 'p' : '';
    box.append(h('i', { class: c, style: `--i:${i}` }));
  }
  if (previewLevel != null && previewLevel !== l) box.append(h('span', { class: 'preview-mark', style: `left:calc(${previewLevel / 25 * 100}% - 1.5px)` }));
  return box;
}
function renderStats() {
  if (spin.on) return;
  const { driver: d, vehicle: v, terrain: t, preview: p } = state;
  const pd = p?.driver || d, pv = p?.vehicle || v;
  $('#meters').replaceChildren(...CORE.map(c => {
    const k = c.key(t), dp = D.driverClasses[d.cls][k], vp = D.vehicleClasses[v.cls][k], l = level(d.cls, v.cls, k);
    const pl = p ? level(pd.cls, pv.cls, k) : null, delta = p ? pl - l : 0;
    const shownL = p ? pl : l, title = c.name + (c.id === 'speed' || c.id === 'handling' ? ' · ' + TERRAIN[t] : '');
    const el = h('div', {
      class: 'meter', tabindex: '0',
      'aria-label': `${title}: level ${l} of 25, ${fmtRatio(ratio(k, l))}. ${STAT_INFO[k]}`,
    },
      h('div', { class: 'meter-label' }, c.name, c.id === 'speed' || c.id === 'handling' ? h('small', { text: TERRAIN[t] }) : null),
      h('div', { class: 'meter-value' },
        delta ? h('span', { class: 'meter-delta ' + (delta > 0 ? 'up' : 'down'), text: signed(delta) }) : null,
        h('span', { class: 'meter-ratio', text: fmtRatio(ratio(k, shownL)) }),
        h('span', { class: 'meter-level', text: shownL })),
      meterSegs(dp, vp, l, pl));
    tipOn(el, () => statTip(k, title));
    return el;
  }));

  const rank = comboRank(d.cls, v.cls), sc = Math.round(onlineScore()(d.cls, v.cls));
  $('#metaScore').replaceChildren(
    h('span', { class: 'ms-num', text: sc }),
    h('span', { class: 'ms-text' }, h('b', { text: `Online meta score · #${rank} of ${usedD.length * usedV.length}` }), h('br'), 'Scored with the Online meta weights on road.'));

  const dt = D.characters.filter(c => c.cls === d.cls && c.name !== d.name).map(c => c.name);
  const vt = D.vehicles.filter(x => x.cls === v.cls && x.id !== v.id).map(x => x.name);
  $('#twins').replaceChildren(...[
    dt.length ? h('div', {}, h('b', { text: 'Same stats as ' + d.name + ': ' }), dt.join(', ')) : null,
    vt.length ? h('div', {}, h('b', { text: 'Same stats as ' + v.name + ': ' }), vt.join(', ')) : null,
  ].filter(Boolean));

  const rows = D.order.map((k, i) => {
    const dp = D.driverClasses[d.cls][k], vp = D.vehicleClasses[v.cls][k], l = level(d.cls, v.cls, k);
    const tr = h('tr', { tabindex: '0' },
      h('td', { text: D.labels[i] }), h('td', { text: dp }),
      h('td', { class: vp > 0 ? 'pos' : vp < 0 ? 'neg' : '', text: signed(vp) }),
      h('td', { text: l }), h('td', { text: fmtRatio(ratio(k, l)) }));
    tipOn(tr, () => statTip(k, D.labels[i]));
    return tr;
  });
  $('#allStats').replaceChildren(h('table', {},
    h('thead', {}, h('tr', {}, ['Stat', 'Driver', 'Vehicle', 'Level', 'Ratio'].map(t => h('th', { scope: 'col', text: t })))),
    h('tbody', {}, rows)));
}

/* ------------------------------------------------------------ chooser */
function minis(cells) {
  return h('div', { class: 'minis' }, cells.map(([lab, val]) => h('div', { class: 'mini' }, h('b', { text: val }), h('span', { text: lab }))));
}
function hoverPreview(el, make) {
  const on = () => { state.preview = make(); renderStats(); };
  const off = () => { state.preview = null; renderStats(); };
  el.addEventListener('pointerenter', on);
  el.addEventListener('pointerleave', off);
  el.addEventListener('focus', on);
  el.addEventListener('blur', off);
}
function driverTile(c) {
  const b = h('button', { class: 'pick pick-driver', type: 'button', 'data-cls': c.cls, 'data-name': c.name, 'aria-pressed': 'false', onclick: () => setCombo(drivers.get(c.id), state.vehicle) },
    h('img', { src: dIcon(c.id), alt: '', width: 44, height: 44, loading: 'lazy' }), h('span', { text: c.name }));
  hoverPreview(b, () => ({ driver: drivers.get(c.id) }));
  return b;
}
function vehicleTile(v) {
  const b = h('button', { class: 'pick pick-vehicle', type: 'button', 'data-cls': v.cls, 'data-id': v.id, 'aria-pressed': 'false', onclick: () => setCombo(state.driver, v) },
    h('img', { src: vCard(v.id), alt: '', width: 360, height: 240, loading: 'lazy' }), h('span', { text: v.name }), h('small', { text: v.rideLabel }));
  hoverPreview(b, () => ({ vehicle: v }));
  return b;
}
function renderChooser() {
  const grid = $('#chooserGrid'), isD = state.tab === 'drivers', q = state.search.trim().toLowerCase(), t = state.terrain;
  grid.replaceChildren();
  const sk = t === 'Tarmac' ? 'TopSpeedTarmac' : 'TopSpeed' + t;
  let items;
  if (isD) {
    items = D.characters.filter(c => !q || c.name.toLowerCase().includes(q) || c.outfits.some(o => o.outfit.toLowerCase().includes(q)));
  } else {
    items = D.vehicles.filter(v => (state.ride === 'all' || v.rideLabel === state.ride) && (!q || v.name.toLowerCase().includes(q)));
  }
  if (!items.length) { grid.append(h('p', { class: 'empty', text: 'Nothing matches that search.' })); syncChooser(); return; }
  const table = isD ? D.driverClasses : D.vehicleClasses;
  if (state.sort === 'class') {
    const groups = new Map();
    for (const x of items) (groups.get(x.cls) || groups.set(x.cls, []).get(x.cls)).push(x);
    const keys = [...groups.keys()].sort((a, b) => table[a].Weight - table[b].Weight || table[b].Acceleration - table[a].Acceleration || a.localeCompare(b));
    for (const c of keys) {
      const row = table[c], f = isD ? (n => n) : signed;
      grid.append(h('div', { class: 'class-row', 'data-cls': c },
        h('div', { class: 'class-info' },
          h('div', { class: 'class-name' }, c, h('small', { text: isD ? 'driver points' : 'vehicle bonus' })),
          minis([['Spd', f(row[sk])], ['Acc', f(row.Acceleration)], ['MT', f(row.DriftDashTime)], ['Coin', f(row.CoinSpeedRatio)]])),
        h('div', { class: 'class-items' }, groups.get(c).map(isD ? driverTile : vehicleTile))));
    }
  } else {
    const by = {
      speed: x => -table[x.cls][sk], accel: x => -table[x.cls].Acceleration, name: () => 0,
    }[state.sort];
    const sorted = [...items].sort((a, b) => by(a) - by(b) || a.name.localeCompare(b.name));
    grid.append(h('div', { class: 'flat-grid' + (isD ? '' : ' vehicles') }, sorted.map(isD ? driverTile : vehicleTile)));
  }
  syncChooser();
}
function syncChooser() {
  const { driver: d, vehicle: v, tab } = state;
  const cls = tab === 'drivers' ? d.cls : v.cls;
  $$('.class-row').forEach(r => r.classList.toggle('current', r.dataset.cls === cls));
  $$('.pick-driver').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.name === d.name)));
  $$('.pick-vehicle').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === v.id)));
}
function setTab(tab) {
  state.tab = tab;
  $('#tabDrivers').setAttribute('aria-selected', String(tab === 'drivers'));
  $('#tabVehicles').setAttribute('aria-selected', String(tab === 'vehicles'));
  $('#chooserGrid').setAttribute('aria-labelledby', tab === 'drivers' ? 'tabDrivers' : 'tabVehicles');
  $('#rideSeg').hidden = tab === 'drivers';
  $('#search').placeholder = tab === 'drivers' ? 'Search drivers or outfits' : 'Search vehicles';
  renderChooser();
}

/* ------------------------------------------------------------ meta: range chart */
const IMPACT = ['TopSpeedTarmac', 'TopSpeedGravel', 'TopSpeedWater', 'Acceleration', 'DriftDashTime', 'HandlingTarmac', 'CoinSpeedRatio', 'Weight', 'InvincibleRatio'];
function renderImpact() {
  const W = 660, L = 148, R = 106, rowH = 32, top = 8, axisH = 24, H = top + IMPACT.length * rowH + axisH;
  const x = v => L + (v - 0.5) / 2.5 * (W - L - R);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Ratio range for each stat' });
  for (const t of [0.5, 1, 1.5, 2, 2.5, 3]) {
    svg.append(s('line', { class: t === 1 ? 'base-line' : 'grid-line', x1: x(t), x2: x(t), y1: top, y2: H - axisH + 2 }));
    svg.append(s('text', { class: 'tick', x: x(t), y: H - 6, 'text-anchor': 'middle' }, '×' + t.toFixed(1)));
  }
  IMPACT.forEach((k, i) => {
    const [a, b] = ranges[k], ra = ratio(k, a), rb = ratio(k, b), y = top + i * rowH + rowH / 2;
    const lab = D.labels[D.order.indexOf(k)], cur = ratio(k, level(state.driver.cls, state.vehicle.cls, k));
    const g = s('g', { tabindex: '0', 'aria-label': `${lab}: ${fmtRatio(ra)} to ${fmtRatio(rb)}. ${STAT_INFO[k]}` },
      s('rect', { class: 'hit', x: 0, y: y - rowH / 2, width: W, height: rowH }),
      s('text', { class: 'lab', x: 0, y: y + 4 }, lab),
      s('rect', { x: x(ra), y: y - 5, width: Math.max(4, x(rb) - x(ra)), height: 10, rx: 4, fill: 'var(--seq-3)' }),
      s('circle', { cx: x(cur), cy: y, r: 5.5, fill: 'var(--ink)', stroke: '#fff', 'stroke-width': 2 }),
      s('text', { class: 'val', x: W, y: y + 4, 'text-anchor': 'end' }, `×${ra.toFixed(2)}–×${rb.toFixed(2)}`));
    tipOn(g, () => statTip(k, lab));
    svg.append(g);
  });
  $('#impactChart').replaceChildren(svg);
}

/* ------------------------------------------------------------ meta: coin curves */
function renderCoins() {
  const W = 660, H = 270, L = 40, R = 14, T = 12, B = 36;
  const x = c => L + c / 20 * (W - L - R), y = p => T + (1 - p / 5) * (H - T - B);
  const k = 'CoinSpeedRatio', [a, b] = ranges[k], me = ratio(k, level(state.driver.cls, state.vehicle.cls, k));
  const series = [
    { name: `Highest coin speed (${fmtRatio(ratio(k, b))})`, r: ratio(k, b), color: 'var(--s1)' },
    { name: `Lowest coin speed (${fmtRatio(ratio(k, a))})`, r: ratio(k, a), color: 'var(--s2)' },
    { name: `Your combo (${fmtRatio(me)})`, r: me, color: 'var(--ink)' },
  ];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Speed bonus by coins held, for the highest and lowest coin speed and your combo' });
  for (const p of [0, 1, 2, 3, 4, 5]) {
    svg.append(s('line', { class: p ? 'grid-line' : 'base-line', x1: L, x2: W - R, y1: y(p), y2: y(p) }));
    svg.append(s('text', { class: 'tick', x: L - 8, y: y(p) + 4, 'text-anchor': 'end' }, `+${p}%`));
  }
  for (const c of [0, 5, 10, 15, 20]) svg.append(s('text', { class: 'tick', x: x(c), y: H - 16, 'text-anchor': 'middle' }, c));
  svg.append(s('text', { class: 'axis-label', x: (L + W - R) / 2, y: H - 1, 'text-anchor': 'middle' }, 'Coins held'));
  for (const sr of series) {
    let d = '';
    for (let c = 0; c <= 20; c += 0.25) d += `${c ? 'L' : 'M'}${x(c).toFixed(1)} ${y(coinBonus(sr.r, c)).toFixed(1)}`;
    svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  const cross = s('line', { class: 'base-line', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
  svg.append(cross);
  const hit = s('rect', { class: 'hit', x: L, y: T, width: W - L - R, height: H - T - B, tabindex: '0', 'aria-label': 'Coin curve values' });
  const onMove = e => {
    const r = svg.getBoundingClientRect(), c = clamp(Math.round(((e.clientX - r.left) / r.width * W - L) / (W - L - R) * 20), 0, 20);
    cross.setAttribute('x1', x(c)); cross.setAttribute('x2', x(c)); cross.setAttribute('visibility', 'visible');
    showTip([h('strong', { text: c + (c === 1 ? ' coin' : ' coins') }), ...series.map(sr => h('div', { class: 'tt-row' },
      h('i', { class: 'tt-key', style: `background:${sr.color === 'var(--ink)' ? '#fff' : sr.color}` }),
      h('b', { text: `+${coinBonus(sr.r, c).toFixed(1)}%` }), ' ' + sr.name.split(' (')[0]))], e.clientX, e.clientY);
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  svg.append(hit);
  $('#coinChart').replaceChildren(svg);
  $('#coinLegend').replaceChildren(...series.map(sr => h('li', {}, h('i', { class: 'key key-line', style: `background:${sr.color}` }), sr.name)));
  $('#coinTable').replaceChildren(h('table', {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Coin speed' }), [1, 5, 10, 15, 20].map(c => h('th', { scope: 'col', text: c + (c === 1 ? ' coin' : ' coins') })))),
    h('tbody', {}, series.map(sr => h('tr', {}, h('td', { text: sr.name.split(' (')[0] }), [1, 5, 10, 15, 20].map(c => h('td', { text: `+${coinBonus(sr.r, c).toFixed(1)}%` })))))));
}

/* ------------------------------------------------------------ meta: World Open */
function renderOpen() {
  const counts = Object.entries(D.worldOpen.drivers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const byName = new Map(D.characters.map(c => [c.name, c]));
  const waffle = $('#waffle'), lit = names => {
    waffle.classList.toggle('dim', !!names);
    $$('button', waffle).forEach(b => b.classList.toggle('lit', !!names && names.includes(b.dataset.name)));
  };
  waffle.setAttribute('aria-label', 'Top 100 racers by driver: ' + counts.map(([n, c]) => `${n} ${c}`).join(', '));
  for (const [name, n] of counts) {
    const c = byName.get(name);
    for (let i = 0; i < n; i++) {
      const b = h('button', { type: 'button', 'data-name': name, 'aria-label': `${name}, ${n} of 100`, tabindex: i ? '-1' : '0', onclick: () => setCombo(drivers.get(c.id), state.vehicle) },
        h('img', { src: dIcon(c.id), alt: '', loading: 'lazy' }));
      const tw = D.characters.filter(x => x.cls === c.cls && x.name !== name).map(x => x.name);
      tipOn(b, () => [h('strong', { text: `${n} of 100` }), h('div', { text: name }), h('div', { class: 'tt-sub', text: tw.length ? `${c.cls}, same stats as ${tw.join(', ')}` : c.cls })]);
      b.addEventListener('pointerenter', () => lit([name]));
      b.addEventListener('pointerleave', () => lit(null));
      waffle.append(b);
    }
  }
  const groups = new Map();
  for (const [name, n] of counts) {
    const c = byName.get(name), g = groups.get(c.cls) || groups.set(c.cls, { cls: c.cls, n: 0, names: [] }).get(c.cls);
    g.n += n; g.names.push(name);
  }
  const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const max = top[0].n;
  $('#openSummary').replaceChildren(...top.map(g => {
    const row = h('div', { class: 'open-bar', tabindex: '0', 'aria-label': `${g.cls}: ${g.n} of 100, ${g.names.join(', ')}` },
      h('span', { text: g.names[0] + (g.names.length > 1 ? ` +${g.names.length - 1}` : '') }),
      h('span', { class: 'bar-wrap' }, h('span', { class: 'bar', style: `width:${g.n / max * 100}%` })),
      h('span', { class: 'num', text: g.n }));
    row.addEventListener('pointerenter', () => lit(g.names));
    row.addEventListener('pointerleave', () => lit(null));
    row.addEventListener('focus', () => lit(g.names));
    row.addEventListener('blur', () => lit(null));
    tipOn(row, () => [h('strong', { text: `${g.n} of 100` }), h('div', { text: `${g.cls}: ${g.names.join(', ')}` })]);
    return row;
  }),
  h('p', { class: 'open-note' }, (() => {
    const sum = t => [...groups.values()].filter(g => t(D.driverClasses[g.cls].Weight)).reduce((a, g) => a + g.n, 0);
    return [h('b', { text: `${sum(w => w <= 8)} of 100` }), ' drove one of the seven lightest stat classes. ', h('b', { text: String(sum(w => w >= 12)) }), ' drove one of the four heaviest. Nintendo\'s list names drivers only, so vehicles aren\'t shown.'];
  })()));
  $('#openSub').textContent = 'Nintendo\'s published top 100 racers for the July 2026 Mario Kart World Open, one icon per racer.';
  $('#openLink').href = D.worldOpen.url;
}

const BUILDS = [
  { d: 'Driver_Basabasa_00', v: 'Vehicle_Hvc_00', title: 'Online meta', note: 'The most-picked driver in the top 100, in the pairing the Online meta weights rank first. Mach Rocket has identical stats.' },
  { d: 'Driver_Basabasa_00', v: 'Vehicle_Kgs_00', title: 'Road kart', note: 'Trades one level of acceleration, mini-turbo and coin speed for one more level of road speed. Like the H.O.G., it\'s built for road.' },
  { d: 'Driver_Kinopico_00', v: 'Vehicle_Hvc_00', title: 'Faster light', note: 'The second most-picked driver. Two more levels of road speed than Swoop, for two less acceleration and coin speed.' },
  { d: 'Driver_Wario_00', v: 'Vehicle_Bsn_00', title: 'Speed first', note: 'Reaches level 17, the highest road speed there is. Wario matches Bowser\'s road speed with better acceleration, so suits solo time trials.' },
];
function comboArt(d, v, extra) {
  return h('div', { class: extra || 'result-art' },
    h('img', { class: 'v', src: vCard(v.id), alt: '', loading: 'lazy' }),
    h('img', { class: 'd', src: dBig(d.id), alt: '', loading: 'lazy' }));
}
function levelChips(d, v, terrain = 'Tarmac', ids = ['speed', 'accel', 'mt', 'handling', 'coin']) {
  return h('div', { class: 'lv-row' }, CORE.filter(c => ids.includes(c.id)).map(c => {
    const k = c.key(terrain), el = h('span', { class: 'lv', tabindex: '-1' }, h('span', { text: c.short }), level(d.cls, v.cls, k));
    tipOn(el, () => statTip(k, c.name, d, v));
    return el;
  }));
}
function renderBuilds() {
  $('#builds').replaceChildren(...BUILDS.map(b => {
    const d = drivers.get(b.d), v = vehicles.get(b.v);
    return h('article', { class: 'build' },
      comboArt(d, v, 'build-art'),
      h('div', { class: 'build-body' },
        h('p', { class: 'eyebrow', text: b.title }),
        h('h4', { text: `${d.name} + ${v.name}` }),
        h('p', { text: b.note }),
        levelChips(d, v),
        h('div', { class: 'build-actions' },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { setCombo(d, v); $('#garage').scrollIntoView(); toast('Loaded into the garage'); } }, 'Load'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addCompare({ d: d.id, v: v.id }) }, '+ Compare'))));
  }));
}
function renderGlossary() {
  const list = ['Acceleration', 'DriftDashTime', 'CoinSpeedRatio', 'TopSpeedTarmac', 'TopSpeedGravel', 'TopSpeedWater', 'TopSpeedGlide', 'HandlingTarmac', 'HandlingGravel', 'HandlingWater', 'HandlingGrip', 'Weight', 'InvincibleRatio'];
  const rest = D.order.filter(k => !list.includes(k));
  const item = k => [h('dt', { text: D.labels[D.order.indexOf(k)] }), h('dd', { text: STAT_INFO[k] })];
  $('#glossary').replaceChildren(...[...list, ...rest].flatMap(k => h('div', {}, item(k))));
}

/* ------------------------------------------------------------ finder */
function renderFinderControls() {
  const seg = $('#presetSeg');
  seg.replaceChildren(...[...Object.entries(PRESETS).map(([id, p]) => [id, p.label]), ['custom', 'Custom']].map(([id, label]) =>
    h('button', { type: 'button', 'data-preset': id, 'aria-pressed': String(state.finder.preset === id), onclick: () => usePreset(id) }, label)));
  const box = $('#weights');
  box.replaceChildren(h('h3', { text: 'What matters to you' }),
    ...CORE.map(c => h('div', { class: 'weight' },
      h('label', { for: 'w-' + c.id }, c.name, h('output', { id: 'wo-' + c.id, text: state.finder.weights[c.id] })),
      h('input', { id: 'w-' + c.id, type: 'range', min: 0, max: 5, step: 1, value: state.finder.weights[c.id], oninput: e => {
        state.finder.weights[c.id] = +e.target.value;
        $('#wo-' + c.id).textContent = e.target.value;
        state.finder.preset = 'custom';
        $$('#presetSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === 'custom')));
        renderFinderResults();
      } }))),
    h('p', { class: 'weights-note', text: 'Online meta is tuned so its top picks match the classes top players chose in the World Open. Weight counts heavier as better.' }));
  const opts = CORE.map(c => h('option', { value: c.id, text: c.name }));
  $('#axisX').replaceChildren(...opts.map(o => o.cloneNode(true)));
  $('#axisY').replaceChildren(...opts.map(o => o.cloneNode(true)));
  $('#axisX').value = state.finder.x; $('#axisY').value = state.finder.y;
}
function usePreset(id) {
  state.finder.preset = id;
  if (PRESETS[id]) state.finder.weights = { ...PRESETS[id].w };
  $$('#presetSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === id)));
  CORE.forEach(c => { $('#w-' + c.id).value = state.finder.weights[c.id]; $('#wo-' + c.id).textContent = state.finder.weights[c.id]; });
  renderFinderResults();
}
function repDriver(dc) {
  if (state.driver.cls === dc) return state.driver;
  const c = D.characters.filter(x => x.cls === dc).sort((a, b) => openCount(b.name) - openCount(a.name) || a.name.localeCompare(b.name))[0];
  return drivers.get(c.id);
}
const repVehicle = vc => (state.vehicle.cls === vc ? state.vehicle : D.vehicles.find(v => v.cls === vc));
function finderPairs() {
  const f = state.finder, score = scorer(f.weights, f.terrain), out = [];
  for (const dc of usedD) {
    if (f.lockD && dc !== state.driver.cls) continue;
    for (const vc of usedV) {
      if (f.lockV && vc !== state.vehicle.cls) continue;
      out.push({ dc, vc, score: score(dc, vc) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.dc.localeCompare(b.dc) || a.vc.localeCompare(b.vc));
}
function renderFinderResults() {
  const f = state.finder, list = finderPairs();
  $('#results').replaceChildren(...list.slice(0, 6).map((p, i) => {
    const d = repDriver(p.dc), v = repVehicle(p.vc);
    const dn = D.characters.filter(c => c.cls === p.dc && c.name !== d.name).length;
    const vn = D.vehicles.filter(x => x.cls === p.vc && x.id !== v.id).map(x => x.name);
    const alt = [dn ? `${dn} other driver${dn > 1 ? 's' : ''}` : null, vn.length ? vn.join(', ') : null].filter(Boolean).join(' · ');
    return h('li', { class: 'result' }, h('button', { type: 'button', 'aria-label': `Load ${d.name} on ${v.name}`, onclick: () => { setCombo(d, v); toast('Loaded into the garage'); } },
      h('div', { class: 'result-art' },
        h('img', { class: 'v', src: vCard(v.id), alt: '', loading: 'lazy' }),
        h('img', { class: 'd', src: dBig(d.id), alt: '', loading: 'lazy' }),
        h('span', { class: 'rank', text: i + 1 }), h('span', { class: 'score', text: Math.round(p.score) })),
      h('div', { class: 'result-body' },
        h('h4', { text: `${d.name} + ${v.name}` }),
        levelChips(d, v, f.terrain),
        alt ? h('div', { class: 'alt', text: 'Same stats: ' + alt }) : null)));
  }));
  renderMap(list);
}
const SEQ = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'];
function renderMap(list) {
  const f = state.finder, W = 760, H = 440, L = 46, R = 16, T = 14, B = 46;
  const cx = CORE.find(c => c.id === f.x), cy = CORE.find(c => c.id === f.y), kx = cx.key(f.terrain), ky = cy.key(f.terrain);
  const cells = new Map();
  for (const p of list) {
    const X = level(p.dc, p.vc, kx), Y = level(p.dc, p.vc, ky), key = X + ',' + Y;
    const c = cells.get(key) || cells.set(key, { X, Y, items: [] }).get(key);
    c.items.push(p);
  }
  const all = [...cells.values()];
  const minX = Math.min(...all.map(c => c.X)), maxX = Math.max(...all.map(c => c.X));
  const minY = Math.min(...all.map(c => c.Y)), maxY = Math.max(...all.map(c => c.Y));
  const x = v => L + (v - minX + 0.5) / (maxX - minX + 1) * (W - L - R);
  const y = v => T + (maxY - v + 0.5) / (maxY - minY + 1) * (H - T - B);
  const lo = Math.min(...list.map(p => p.score)), hi = Math.max(...list.map(p => p.score));
  const tone = sc => `var(${SEQ[Math.round((hi > lo ? (sc - lo) / (hi - lo) : 1) * (SEQ.length - 1))]})`;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Combo map: ${cx.name} across, ${cy.name} up` });
  for (let v = minX; v <= maxX; v++) if (v % 2 === 0 || maxX - minX < 12) {
    svg.append(s('line', { class: 'grid-line', x1: x(v), x2: x(v), y1: T, y2: H - B }));
    svg.append(s('text', { class: 'tick', x: x(v), y: H - B + 16, 'text-anchor': 'middle' }, v));
  }
  for (let v = minY; v <= maxY; v++) if (v % 2 === 0 || maxY - minY < 12) {
    svg.append(s('line', { class: 'grid-line', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    svg.append(s('text', { class: 'tick', x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
  }
  svg.append(s('text', { class: 'axis-label', x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle' }, `${cx.name} level`));
  svg.append(s('text', { class: 'axis-label', transform: `translate(12 ${(T + H - B) / 2}) rotate(-90)`, 'text-anchor': 'middle' }, `${cy.name} level`));
  // best trade-off line: cells nothing beats on both axes
  const front = all.filter(a => !all.some(b => b.X >= a.X && b.Y >= a.Y && (b.X > a.X || b.Y > a.Y))).sort((a, b) => a.X - b.X);
  if (front.length > 1) svg.append(s('path', { d: front.map((c, i) => `${i ? 'L' : 'M'}${x(c.X).toFixed(1)} ${y(c.Y).toFixed(1)}`).join(''), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const myX = level(state.driver.cls, state.vehicle.cls, kx), myY = level(state.driver.cls, state.vehicle.cls, ky);
  const stepX = (W - L - R) / (maxX - minX + 1), stepY = (H - T - B) / (maxY - minY + 1);
  for (const c of all) {
    const best = c.items[0], r = clamp(3.5 + Math.sqrt(c.items.length) * 1.6, 4, 9);
    const g = s('g', { class: 'cell', tabindex: '0', 'aria-label': `${cx.name} ${c.X}, ${cy.name} ${c.Y}: ${c.items.length} pairing${c.items.length > 1 ? 's' : ''}` },
      s('rect', { class: 'hit', x: x(c.X) - stepX / 2, y: y(c.Y) - stepY / 2, width: stepX, height: stepY }),
      s('circle', { class: 'dot', cx: x(c.X), cy: y(c.Y), r, fill: tone(best.score), stroke: '#fff', 'stroke-width': 2 }));
    const load = () => { setCombo(repDriver(best.dc), repVehicle(best.vc)); toast('Loaded into the garage'); };
    g.addEventListener('click', load);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); } });
    tipOn(g, () => [h('strong', { text: `Score ${Math.round(best.score)}` }), h('div', { text: `${cx.name} ${c.X} · ${cy.name} ${c.Y}` }),
      ...c.items.slice(0, 3).map(p => h('div', { class: 'tt-sub', text: `${repDriver(p.dc).name} + ${repVehicle(p.vc).name}` })),
      c.items.length > 3 ? h('div', { class: 'tt-sub', text: `and ${c.items.length - 3} more` }) : null].filter(Boolean));
    svg.append(g);
  }
  const yr = y(myY), xr = x(myX);
  svg.append(s('circle', { cx: xr, cy: yr, r: 7, fill: 'var(--yellow)', stroke: 'var(--ink)', 'stroke-width': 2, 'pointer-events': 'none' }));
  svg.append(s('text', { class: 'you-label', x: xr + (xr > W - 90 ? -12 : 12), y: yr + 4, 'text-anchor': xr > W - 90 ? 'end' : 'start', 'pointer-events': 'none' }, 'You'));
  $('#map').replaceChildren(svg);
}

/* ------------------------------------------------------------ compare + saved */
const SLOT = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
function persist() {
  try {
    localStorage.setItem('cg-saved', JSON.stringify(state.saved));
    localStorage.setItem('cg-compare', JSON.stringify(state.compare));
  } catch { toast('Browser storage is off, so this is kept for this visit only'); }
}
function addCompare(p) {
  if (state.compare.some(c => same(c, p))) { toast('Already in the comparison'); return; }
  if (state.compare.length >= 3) { toast('Compare holds three. Remove one first.'); return; }
  const used = state.compare.map(c => c.slot), slot = [0, 1, 2].find(i => !used.includes(i));
  state.compare.push({ ...p, slot });
  persist(); renderCompare(); syncButtons(); toast('Added to compare');
}
function removeCompare(p) {
  state.compare = state.compare.filter(c => !same(c, p));
  persist(); renderCompare(); syncButtons();
}
function renderCompare() {
  const box = $('#compareBody'), list = [...state.compare].sort((a, b) => a.slot - b.slot).map(c => ({ ...c, ...resolve(c) })), t = state.terrain;
  const empty = 3 - list.length;
  const cols = h('div', { class: 'compare-cols' },
    list.map(c => h('article', { class: 'panel cmp-card' },
      comboArt(c.d, c.v),
      h('span', { class: 'cmp-swatch' }, h('i', { style: `background:${SLOT[c.slot]}` }), 'ABC'[c.slot]),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${c.d.name} on ${c.v.name}`, onclick: () => removeCompare({ d: c.d.id, v: c.v.id }) }, '×'),
      h('div', { class: 'cmp-body' }, h('h4', { text: `${c.d.name} + ${c.v.name}` }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { setCombo(c.d, c.v); $('#garage').scrollIntoView(); } }, 'Load')))),
    Array.from({ length: empty }, (_, i) => h('div', { class: 'cmp-add' }, i === 0
      ? h('div', {}, h('p', { text: 'Use the current combo from the garage.' }), h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => addCompare(pair()) }, '+ Add ' + state.driver.name + ' + ' + state.vehicle.name))
      : h('span', { text: 'Empty slot' }))));
  box.replaceChildren(cols);
  if (!list.length) return;
  const keys = [...CORE.map(c => ({ k: c.key(t), name: c.name + (c.id === 'speed' || c.id === 'handling' ? ' · ' + TERRAIN[t] : ''), pick: c.id !== 'weight' })), { k: 'InvincibleRatio', name: 'Invincibility', pick: false }];
  const legend = h('ul', { class: 'legend legend-inline', 'aria-label': 'Combos' }, list.map(c => h('li', {}, h('i', { class: 'key', style: `background:${SLOT[c.slot]}` }), `${'ABC'[c.slot]}: ${c.d.name} + ${c.v.name}`)));
  box.append(h('article', { class: 'panel cmp-chart' },
    h('h3', { class: 'chart-title', text: 'Levels side by side' }),
    h('p', { class: 'chart-sub', text: 'Bars show level out of 25. Hover a stat for what it does.' }),
    legend,
    h('div', { class: 'cmp-rows' }, keys.map(({ k, name }) => {
      const label = h('h5', { tabindex: '0', text: name });
      tipOn(label, () => statTip(k, name, list[0].d, list[0].v));
      return h('div', { class: 'cmp-row' }, label, h('div', { class: 'cmp-bars' }, list.map(c => {
        const l = level(c.d.cls, c.v.cls, k);
        return h('div', { class: 'cmp-bar' },
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${l * 4}%;background:${SLOT[c.slot]}` })),
          h('div', { class: 'num' }, l, ' ', h('small', { text: fmtRatio(ratio(k, l)) })));
      })));
    }))));
  const rows = D.order.map((k, i) => {
    const ls = list.map(c => level(c.d.cls, c.v.cls, k)), best = Math.max(...ls);
    return h('tr', {}, h('td', { text: D.labels[i] }), ls.map(l => h('td', { class: list.length > 1 && l === best && ls.some(x => x !== best) ? 'best' : '', text: l })));
  });
  box.append(h('details', { class: 'panel cmp-table' }, h('summary', { text: 'All 19 stats as a table' }),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Stat' }), list.map(c => h('th', { scope: 'col', text: 'ABC'[c.slot] })))),
      h('tbody', {}, rows)))));
}
function renderSaved() {
  const box = $('#savedBody');
  const list = state.saved.map(p => ({ p, ...resolve(p) })).filter(x => x.d && x.v);
  if (!list.length) { box.replaceChildren(h('p', { class: 'empty', text: 'Nothing saved yet. Press Save combo in the garage.' })); return; }
  box.replaceChildren(h('div', { class: 'saved-list' }, list.map(({ p, d, v }) => h('article', { class: 'saved-item' },
    comboArt(d, v),
    h('div', { class: 'cmp-body' }, h('h4', { text: `${d.name} + ${v.name}` }),
      h('div', { class: 'saved-actions' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { setCombo(d, v); $('#savedDialog').close(); } }, 'Load'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => addCompare(p) }, '+ Compare'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { state.saved = state.saved.filter(x => !same(x, p)); persist(); renderSaved(); syncButtons(); } }, 'Remove')))))));
}
function syncButtons() {
  const p = pair(), saved = state.saved.some(x => same(x, p)), inCmp = state.compare.some(x => same(x, p));
  const sv = $('#save');
  sv.textContent = saved ? 'Saved' : 'Save combo';
  sv.setAttribute('aria-pressed', String(saved));
  $('#addCompare').textContent = inCmp ? 'In compare' : '+ Compare';
  const count = (id, n) => { const e = $(id); e.textContent = n; e.toggleAttribute('data-zero', !n); };
  count('#savedCount', state.saved.length);
  count('#compareCount', state.compare.length);
  renderCompare();
}

/* ------------------------------------------------------------ shuffle: three rows that stop in turn */
const pick = a => a[Math.floor(Math.random() * a.length)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const rowEl = name => $(`.spin-row[data-row="${name}"]`);

const sfx = {
  ctx: null, buf: {}, loop: null, on: true,
  load() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    for (const n of ['roll', 'stop', 'coin']) {
      fetch(`sound/${n}.m4a`).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b)).then(a => { this.buf[n] = a; }).catch(() => {});
    }
  },
  node(gain) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.ctx.destination);
    return g;
  },
  play(n, gain = 1, rate = 1) {
    if (!this.on || !this.ctx || !this.buf[n]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf[n]; src.playbackRate.value = rate;
    src.connect(this.node(gain)); src.start();
  },
  tick(pitch = 1) {   // a soft click as tiles crawl past the window
    if (!this.on || !this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.node(0.05), t = this.ctx.currentTime;
    o.type = 'triangle'; o.frequency.value = 1500 * pitch;
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.035);
    o.connect(g); o.start(t); o.stop(t + 0.04);
  },
  startLoop() {
    if (!this.on || !this.ctx || !this.buf.roll) return;
    const src = this.ctx.createBufferSource(), g = this.node(0.8);
    // AAC pads both ends with silence, so loop inside them
    src.buffer = this.buf.roll; src.loop = true; src.loopStart = 0.08; src.loopEnd = src.buffer.duration - 0.08;
    src.connect(g); src.start(0, 0.08);
    this.loop = { src, g };
  },
  stopLoop() {
    if (!this.loop) return;
    const { src, g } = this.loop, t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.03); src.stop(t + 0.2);
    this.loop = null;
  },
};

let coinImg;
function prepSpin() {
  sfx.load();
  sfx.ctx?.resume();
  if (spin.ready) return;
  spin.ready = true;
  coinImg = new Image(); coinImg.src = 'img/coin.webp';
  for (const c of D.characters) new Image().src = dIcon(c.id);
  for (const v of D.vehicles) new Image().src = vCard(v.id);
}
function loadRow(name, items, target) {
  const row = rowEl(name), strip = $('.spin-strip', row), track = $('.spin-track', row);
  strip.replaceChildren(...items.map(it => h('div', { class: 'spin-tile ' + (it.cls || '') },
    it.src ? h('img', { src: it.src, alt: '', decoding: 'async' }) : null, it.text ? h('b', { text: it.text }) : it.glyph)));
  row.classList.remove('locked');
  const tiles = [...strip.children], tw = tiles[0].offsetWidth;
  const r = { row, strip, track, tiles, tw, step: tw + (parseFloat(getComputedStyle(strip).columnGap) || 0), cw: row.clientWidth, target };
  place(r, xFor(r, 2));
  return r;
}
const xFor = (r, i) => r.cw / 2 - (i * r.step + r.tw / 2);
function place(r, x) { r.strip.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; }
function lockRow(r) {
  place(r, xFor(r, r.target));
  r.track.classList.remove('b1', 'b2', 'b3');
  r.tiles[r.target].classList.add('win');
  r.row.classList.add('locked');
  sfx.play('stop', 1.2);
}
/* Pull back, throw forward, overrun the window, ease back. power sets how long it crawls at the end. */
function runRow(r, ms, power, pitch = 1) {
  const pull = 130, settle = 320, end = xFor(r, r.target), start = xFor(r, 2), back = r.step * .22, over = r.step * .17;
  return new Promise(done => {
    let t0, last = start, blur = '', seen = 0;
    const setBlur = b => { if (b === blur) return; if (blur) r.track.classList.remove(blur); if (b) r.track.classList.add(b); blur = b; };
    const frame = now => {
      if (spin.skip || spin.cancel) { lockRow(r); return done(); }
      t0 ??= now;
      const t = now - t0;
      let x;
      if (t < pull) x = start + back * Math.sin(t / pull * Math.PI / 2);
      else if (t < pull + ms) x = start + back + (end - over - start - back) * (1 - (1 - (t - pull) / ms) ** power);
      else if (t < pull + ms + settle) {
        const u = (t - pull - ms) / settle;
        x = end - over * (1 - u * u * (3 - 2 * u));
      } else { lockRow(r); return done(); }
      place(r, x);
      const v = Math.abs(x - last); last = x;
      setBlur(v > 70 ? 'b3' : v > 34 ? 'b2' : v > 15 ? 'b1' : '');
      const passed = Math.floor((start - x) / r.step);
      if (passed !== seen) { seen = passed; if (v < r.step / 5) sfx.tick(pitch); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
function driverItems(d, target, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    let c, id;
    if (i === target) { out.push({ cls: 'driver', src: dBig(d.id), text: d.name }); continue; }
    do { c = pick(D.characters); id = c.outfits[0].id; } while (c.name === out[i - 1]?.text || (i === target + 1 && c.name === d.name));
    out.push({ cls: 'driver', src: Math.abs(i - target) < 5 ? dBig(id) : dIcon(id), text: c.name });
  }
  return out;
}
function typeItems(kart, target, len) {
  const tile = isKart => ({ cls: 'word', src: vCard(isKart ? 'Vehicle_Stk_00' : 'Vehicle_Stb_00'), text: isKart ? 'Kart' : 'Bike' });
  return Array.from({ length: len }, (_, i) => tile(((i - target) % 2 === 0) === kart));
}
function vehicleItems(pool, v, target, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    if (i === target) { out.push({ src: vCard(v.id), text: v.name }); continue; }
    let x;
    do { x = pick(pool); } while (x.name === out[i - 1]?.text || (i === target + 1 && x.id === v.id));
    out.push({ src: vCard(x.id), text: x.name });
  }
  return out;
}
function rollMeters() {
  const m = $('#meters');
  m.classList.remove('settle'); m.classList.add('rolling');
  $$('.meter-delta', m).forEach(e => e.remove());
  $$('.meter-ratio', m).forEach(e => { e.textContent = ''; });
  $$('.segs i', m).forEach(e => { e.className = ''; });
  clearInterval(spin.roll);
  spin.roll = setInterval(() => $$('.meter-level', m).forEach(e => { e.textContent = 1 + Math.floor(Math.random() * 20); }), 70);
}
function driverMeters(d) {   // row 1 has landed: show what the driver alone brings
  clearInterval(spin.roll);
  const m = $('#meters');
  m.classList.remove('rolling');
  m.replaceChildren(...CORE.map(c => {
    const dp = D.driverClasses[d.cls][c.key(state.terrain)];
    return h('div', { class: 'meter' },
      h('div', { class: 'meter-label' }, c.name),
      h('div', { class: 'meter-value' }, h('span', { class: 'meter-level', text: dp })),
      meterSegs(dp, 0, dp, null));
  }));
  m.classList.add('settle');
}
function spinChrome(on) {
  $('#stage').classList.toggle('spinning', on);
  $('.stats-panel').classList.toggle('spinning', on);
  $('#shuffle').textContent = on ? 'Skip' : 'Shuffle';
  for (const id of ['#share', '#addCompare', '#save', '#prevVehicle', '#nextVehicle']) $(id).disabled = on;
}
function endSpin() {
  clearInterval(spin.roll);
  sfx.stopLoop();
  spin.on = false;
  $('#meters').classList.remove('rolling');
  spinChrome(false);
}
/* The vehicle is drawn from all of them, so each one is equally likely
   and row 2 lands on kart or bike in proportion to how many of each there are. */
function pickCombo() {
  const c = pick(D.characters), v = pick(D.vehicles), kart = v.ride === 'Kart';
  return { d: drivers.get(pick(c.outfits).id), v, kart, pool: D.vehicles.filter(x => (x.ride === 'Kart') === kart) };
}
async function shuffle() {
  if (spin.on) { spin.skip = true; return; }
  const { d, v, kart, pool } = pickCombo(), word = kart ? 'kart' : 'bike';
  const rank = comboRank(d.cls, v.cls), said = `${d.name} + ${v.name} · Online meta #${rank} of ${usedD.length * usedV.length}`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setCombo(d, v); toast(said); return; }

  prepSpin();
  Object.assign(spin, { on: true, skip: false, cancel: false });
  const big = new Image(); big.src = dBig(d.id);
  await Promise.race([big.decode().catch(() => {}), wait(350)]);
  spinChrome(true);
  rollMeters();
  sfx.startLoop();

  const vehRow = rowEl('vehicle');
  vehRow.classList.remove('locked');
  vehRow.classList.add('waiting');
  $('.spin-label', vehRow).textContent = 'Vehicle';
  const idle = Array.from({ length: 9 }, () => ({ cls: 'unknown', glyph: '?' }));
  const waiting = loadRow('vehicle', idle, 4);
  place(waiting, xFor(waiting, 4));
  const rd = loadRow('driver', driverItems(d, 34, 40), 34);
  const rt = loadRow('type', typeItems(kart, 30, 36), 30);
  const first = runRow(rd, 1250, 3.2).then(() => { if (!spin.cancel) driverMeters(d); });
  const second = wait(140).then(() => runRow(rt, 1600, 3.6, .8));
  await Promise.all([first, second]);

  if (!spin.cancel) {   // only now does the last row know what it can show
    vehRow.classList.remove('waiting');
    $('.spin-label', vehRow).textContent = `Pick a ${word}`;
    const n = pool.length > 18 ? 30 : 26;
    const rv = loadRow('vehicle', vehicleItems(pool, v, n, n + 6), n);
    await runRow(rv, 1500, 4.3, 1.2);
  }
  sfx.stopLoop();
  if (spin.cancel) { endSpin(); renderStats(); return; }
  if (!spin.skip) await wait(500);

  endSpin();
  setCombo(d, v, { spun: true });
  const m = $('#meters');
  m.classList.add('settle');
  setTimeout(() => m.classList.remove('settle'), 900);
  toast(said);
  const box = $('#stage').getBoundingClientRect();
  coinBurst(box.left + box.width * .6, box.top + box.height * .56, rank === 1 ? 90 : rank <= 24 ? 56 : rank <= 120 ? 30 : 16);
  sfx.play('coin', rank <= 24 ? 1.3 : .9);
}
function coinBurst(x, y, n) {
  if (!coinImg?.complete || !coinImg.naturalWidth) return;
  const cv = $('#coins'), c2 = cv.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), COLS = 6, ROWS = 4, FRAMES = COLS * ROWS;
  const W = innerWidth, H = innerHeight, fs = coinImg.naturalWidth / COLS;
  cv.width = W * dpr; cv.height = H * dpr;
  c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  c2.imageSmoothingQuality = 'high';
  const coins = Array.from({ length: n }, () => ({
    x: x + (Math.random() - .5) * 120, y: y + (Math.random() - .5) * 50, vx: (Math.random() - .5) * 15, vy: -(8 + Math.random() * 15),
    s: 36 + Math.random() * 52, f: Math.random() * FRAMES, df: .35 + Math.random() * .55, wait: Math.random() * 16,
  }));
  let last = performance.now();
  const frame = now => {
    const k = Math.min((now - last) / 16.7, 3); last = now;
    c2.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of coins) {
      if (p.wait > 0) { p.wait -= k; alive++; continue; }
      p.vy += .62 * k; p.x += p.vx * k; p.y += p.vy * k; p.f = (p.f + p.df * k) % FRAMES;
      if (p.y - p.s > H) continue;
      alive++;
      const i = Math.floor(p.f);
      c2.drawImage(coinImg, (i % COLS) * fs, Math.floor(i / COLS) * fs, fs, fs, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    if (alive) requestAnimationFrame(frame); else c2.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ wiring */
function setTerrain(t) {
  state.terrain = t;
  $$('#terrainSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.terrain === t)));
  renderStats(); renderChooser(); renderCompare();
}
function setFinderTerrain(t) {
  state.finder.terrain = t;
  $$('#finderTerrainSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.terrain === t)));
  renderFinderResults();
}
function step(delta) {
  const i = D.vehicles.findIndex(v => v.id === state.vehicle.id);
  setCombo(state.driver, D.vehicles[(i + delta + D.vehicles.length) % D.vehicles.length], { back: delta < 0 });
  preloadNeighbours();
}
function arrow(btn, delta) {
  if (!calmMotion()) btn.animate([{ transform: 'none' }, { transform: `translateX(${delta * 4}px) scale(.92)`, offset: .4 }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
  step(delta);
}
function wire() {
  $('#terrainSeg').addEventListener('click', e => { const b = e.target.closest('[data-terrain]'); if (b) setTerrain(b.dataset.terrain); });
  $('#finderTerrainSeg').addEventListener('click', e => { const b = e.target.closest('[data-terrain]'); if (b) setFinderTerrain(b.dataset.terrain); });
  $('#prevVehicle').onclick = e => arrow(e.currentTarget, -1);
  $('#nextVehicle').onclick = e => arrow(e.currentTarget, 1);
  $('.veh-nav').addEventListener('pointerenter', preloadNeighbours, { once: true });
  $('#stage').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
  $('#shuffle').onclick = shuffle;
  for (const ev of ['pointerenter', 'focus', 'touchstart']) $('#shuffle').addEventListener(ev, prepSpin, { passive: true });
  try { sfx.on = localStorage.getItem('cg-sound') !== 'off'; } catch { /* storage off: keep the default */ }
  $('#soundToggle').setAttribute('aria-pressed', String(sfx.on));
  $('#soundToggle').onclick = () => {
    sfx.on = !sfx.on;
    $('#soundToggle').setAttribute('aria-pressed', String(sfx.on));
    if (sfx.on) prepSpin(); else sfx.stopLoop();
    try { localStorage.setItem('cg-sound', sfx.on ? 'on' : 'off'); } catch { /* kept for this visit */ }
  };
  $('#save').onclick = () => {
    const p = pair(), had = state.saved.some(x => same(x, p));
    state.saved = had ? state.saved.filter(x => !same(x, p)) : [...state.saved, p];
    persist(); syncButtons(); toast(had ? 'Removed from saved' : 'Saved');
  };
  $('#addCompare').onclick = () => {
    const p = pair();
    if (state.compare.some(x => same(x, p))) removeCompare(p); else addCompare(p);
  };
  $('#share').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
    catch { toast('Copy the address bar to share this combo'); }
  };
  $('#openSaved').onclick = () => { renderSaved(); $('#savedDialog').showModal(); };
  $$('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  $('#savedDialog').addEventListener('click', e => { if (e.target.id === 'savedDialog') e.target.close(); });
  $('#tabDrivers').onclick = () => setTab('drivers');
  $('#tabVehicles').onclick = () => setTab('vehicles');
  $('#search').addEventListener('input', e => { state.search = e.target.value; renderChooser(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderChooser(); });
  const rides = ['all', ...new Set(D.vehicles.map(v => v.rideLabel))];
  $('#rideSeg').replaceChildren(...rides.map(r => h('button', { type: 'button', 'data-ride': r, 'aria-pressed': String(r === 'all'), onclick: () => {
    state.ride = r;
    $$('#rideSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ride === r)));
    renderChooser();
  } }, r === 'all' ? 'All' : r)));
  $('#lockDriver').addEventListener('change', e => { state.finder.lockD = e.target.checked; renderFinderResults(); });
  $('#lockVehicle').addEventListener('change', e => { state.finder.lockV = e.target.checked; renderFinderResults(); });
  $('#axisX').addEventListener('change', e => { state.finder.x = e.target.value; renderFinderResults(); });
  $('#axisY').addEventListener('change', e => { state.finder.y = e.target.value; renderFinderResults(); });
}
function loadStored() {
  const read = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const ok = p => p && drivers.has(p.d) && vehicles.has(p.v);
  state.saved = read('cg-saved').filter(ok);
  const seen = new Set();
  state.compare = read('cg-compare').filter(ok).filter(p => [0, 1, 2].includes(p.slot) && !seen.has(p.slot) && seen.add(p.slot)).slice(0, 3);
}
async function init() {
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('data request failed');
  D = await res.json();
  drivers = new Map(); vehicles = new Map(D.vehicles.map(v => [v.id, v]));
  for (const c of D.characters) for (const o of c.outfits) drivers.set(o.id, { id: o.id, name: c.name, outfit: o.outfit, cls: c.cls, char: c, opens: openCount(c.name) });
  usedD = [...new Set(D.characters.map(c => c.cls))].sort();
  usedV = [...new Set(D.vehicles.map(v => v.cls))].sort();
  ranges = {};
  for (const k of D.order) {
    let lo = 99, hi = -1;
    for (const a of usedD) for (const b of usedV) { const l = level(a, b, k); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    ranges[k] = [lo, hi];
  }
  $('#driverTotal').textContent = D.characters.length;
  $('#vehicleTotal').textContent = D.vehicles.length;
  $('#srcArchive').textContent = D.source.archive.split('/').pop();
  loadStored();
  const q = new URLSearchParams(location.search);
  state.driver = drivers.get(q.get('d')) || drivers.get('Driver_Basabasa_00');
  state.vehicle = vehicles.get(q.get('v')) || vehicles.get('Vehicle_Hvc_00');
  wire();
  renderFinderControls();
  renderOpen();
  renderBuilds();
  renderGlossary();
  renderChooser();
  setCombo(state.driver, state.vehicle);
}
init().catch(err => {
  console.error(err);
  $('#stageTags').textContent = 'Could not load the game data. Serve this folder over HTTP, for example: python -m http.server';
});
