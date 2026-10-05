// Draws the real route with its 360 start spots on a map of Jutland, as SVG.
// Spot 0 is the route's start; spots follow the direction of travel, 1/360 of the route apart.

import { route } from './route-data.js';

const NS = 'http://www.w3.org/2000/svg';
const TICK_IN = 1.5;      // gap between the route line and a tick
const TICK_OUT = 9;       // where a tick ends, measured from the route

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function label(parent, spot, text, cls, dist = 26) {
  const x = spot.x + spot.nx * dist;
  const y = spot.y + spot.ny * dist;
  const dir = spot.nx * Math.sign(dist);
  const anchor = Math.abs(spot.nx) < 0.35 ? 'middle' : dir > 0 ? 'start' : 'end';
  const t = el('text', { x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle', class: cls }, parent);
  t.textContent = text;
  return t;
}

/**
 * Create the route drawing inside `svg`.
 * Returns an object with:
 *   setFilled(set)        — spots (Set<number>) drawn as taken
 *   setActive(deg|null)   — highlight one spot
 *   setInteractive(bool)  — allow pointing at spots
 *   onHover(fn), onSelect(fn)
 */
export function createRing(svg, { animate = true } = {}) {
  svg.setAttribute('viewBox', `0 0 ${route.width} ${route.height}`);
  svg.innerHTML = '';

  // Map: sea, land, towns
  const clipId = `map-clip-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id: clipId }, defs);
  el('rect', { x: 0, y: 0, width: route.width, height: route.height, rx: 6 }, clip);
  const map = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  el('rect', { x: 0, y: 0, width: route.width, height: route.height, class: 'map-sea' }, map);
  if (route.land) el('path', { d: route.land, class: 'map-land' }, map);

  const townGroup = el('g', { class: 'map-towns' }, svg);
  for (const t of route.towns) {
    const big = t.pop >= 100000;
    el('circle', { cx: t.x, cy: t.y, r: big ? 2.6 : 1.8, class: big ? 'town-dot is-big' : 'town-dot' }, townGroup);
    const off = big ? 5 : 4;
    const pos = {
      e: [t.x + off, t.y, 'start'], w: [t.x - off, t.y, 'end'],
      n: [t.x, t.y - off - 2, 'middle'], s: [t.x, t.y + off + 3, 'middle'],
    }[t.side];
    const txt = el('text', { x: pos[0], y: pos[1], 'text-anchor': pos[2], 'dominant-baseline': 'middle', class: big ? 'town-label is-big' : 'town-label' }, townGroup);
    txt.textContent = t.name;
  }

  el('path', { d: route.path, class: 'route-line' }, svg);

  const ticks = [];
  const tickGroup = el('g', { class: 'ring-ticks' }, svg);
  const hitGroup = el('g', { class: 'ring-hits' }, svg);

  route.spots.forEach((s, d) => {
    const t = el('line', {
      x1: s.x + s.nx * TICK_IN, y1: s.y + s.ny * TICK_IN,
      x2: s.x + s.nx * TICK_OUT, y2: s.y + s.ny * TICK_OUT,
      class: 'tick',
    }, tickGroup);
    if (animate) t.style.animationDelay = `${d * 2.5}ms`;
    ticks.push(t);

    const hit = el('circle', { cx: s.x + s.nx * 6, cy: s.y + s.ny * 6, r: 4.5, class: 'hit' }, hitGroup);
    hit.dataset.deg = d;
  });
  if (animate) svg.classList.add('is-drawing');

  // Start marker: spot 0 is in Aarhus, whose name is already on the map
  const s0 = route.spots[0];
  const start = el('g', { class: 'start-mark' }, svg);
  el('circle', { cx: s0.x, cy: s0.y, r: 3.2 }, start);
  label(start, s0, 'Spot 0', 'map-label', 19);

  let hoverFn = () => {};
  let selectFn = () => {};
  let interactive = false;

  hitGroup.addEventListener('pointerover', (e) => {
    if (!interactive) return;
    const d = e.target.dataset?.deg;
    if (d != null) hoverFn(Number(d));
  });
  hitGroup.addEventListener('pointerleave', () => interactive && hoverFn(null));
  hitGroup.addEventListener('click', (e) => {
    if (!interactive) return;
    const d = e.target.dataset?.deg;
    if (d != null) selectFn(Number(d));
  });

  let active = null;
  return {
    setFilled(set) {
      ticks.forEach((t, d) => t.classList.toggle('is-filled', set.has(d)));
    },
    setActive(deg) {
      if (active != null) ticks[active].classList.remove('is-active');
      active = deg;
      if (deg != null) {
        ticks[deg].classList.add('is-active');
        tickGroup.appendChild(ticks[deg]);   // draw on top of its neighbours
      }
    },
    setInteractive(on) {
      interactive = on;
      svg.classList.toggle('is-interactive', on);
    },
    onHover(fn) { hoverFn = fn; },
    onSelect(fn) { selectFn = fn; },
  };
}
