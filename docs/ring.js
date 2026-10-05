// Draws the real route with its 360 start spots as SVG.
// Spot 0 is the route's start; spots follow the direction of travel, 1/360 of the route apart.

import { route } from './route-data.js';

const NS = 'http://www.w3.org/2000/svg';
const TICK_IN = 2.5;      // gap between the route line and a tick
const TICK_OUT = 12;      // tick length

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
export function createRing(svg, { ferryDeg = null, animate = true } = {}) {
  svg.setAttribute('viewBox', `0 0 ${route.width} ${route.height}`);
  svg.innerHTML = '';

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

    const hit = el('circle', { cx: s.x + s.nx * 6, cy: s.y + s.ny * 6, r: 6, class: 'hit' }, hitGroup);
    hit.dataset.deg = d;
  });
  if (animate) svg.classList.add('is-drawing');

  // Start marker
  const s0 = route.spots[0];
  const start = el('g', { class: 'start-mark' }, svg);
  el('circle', { cx: s0.x, cy: s0.y, r: 4 }, start);
  label(start, s0, 'Spot 0, Aarhus', 'map-label', -12);   // inside the loop

  if (ferryDeg != null) {
    const s = route.spots[Math.round(ferryDeg) % 360];
    const g = el('g', { class: 'ferry-mark' }, svg);
    el('circle', { cx: s.x, cy: s.y, r: 4.5 }, g);
    label(g, s, 'Ferry', 'map-label', -12);
  }

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
