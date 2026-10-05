// Draws the 360-spot ring as SVG. Degree 0 is at the top, degrees run clockwise.

const NS = 'http://www.w3.org/2000/svg';
const C = 200;            // centre of the 400×400 viewBox
const R_IN = 152;
const R_OUT = 180;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function point(deg, r) {
  const a = (deg - 90) * Math.PI / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/**
 * Create a ring inside `svg`.
 * Returns an object with:
 *   setFilled(set)        — degrees (Set<number>) drawn as taken
 *   setActive(deg|null)   — highlight one degree
 *   onHover(fn)           — fn(deg|null) when the pointer moves over a spot
 *   onSelect(fn)          — fn(deg) when a spot is clicked/tapped
 */
export function createRing(svg, { ferryDeg = null, animate = true } = {}) {
  svg.setAttribute('viewBox', '0 0 400 400');
  svg.innerHTML = '';

  el('circle', { cx: C, cy: C, r: (R_IN + R_OUT) / 2, class: 'ring-track' }, svg);

  const ticks = [];
  const tickGroup = el('g', { class: 'ring-ticks' }, svg);
  const hitGroup = el('g', { class: 'ring-hits' }, svg);

  for (let d = 0; d < 360; d++) {
    const [x1, y1] = point(d, R_IN);
    const [x2, y2] = point(d, R_OUT);
    const t = el('line', { x1, y1, x2, y2, class: 'tick' }, tickGroup);
    if (animate) t.style.animationDelay = `${d * 2.5}ms`;
    ticks.push(t);

    // Wider invisible wedge so each spot is easy to point at.
    const [a1, b1] = point(d - 0.5, R_IN - 14);
    const [a2, b2] = point(d + 0.5, R_IN - 14);
    const [a3, b3] = point(d + 0.5, R_OUT + 10);
    const [a4, b4] = point(d - 0.5, R_OUT + 10);
    const hit = el('path', { d: `M${a1},${b1} L${a2},${b2} L${a3},${b3} L${a4},${b4} Z`, class: 'hit' }, hitGroup);
    hit.dataset.deg = d;
  }
  if (animate) svg.classList.add('is-drawing');

  // Quarter marks: 0°, 90°, 180°, 270°
  for (const d of [0, 90, 180, 270]) {
    const [x1, y1] = point(d, R_OUT + 4);
    const [x2, y2] = point(d, R_OUT + 12);
    el('line', { x1, y1, x2, y2, class: 'quarter' }, svg);
  }

  if (ferryDeg != null) {
    const g = el('g', { class: 'ferry-mark' }, svg);
    const [x, y] = point(ferryDeg, R_OUT + 14);
    el('circle', { cx: x, cy: y, r: 4.5 }, g);
    const [lx, ly] = point(ferryDeg, R_OUT + 28);
    const label = el('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g);
    label.textContent = 'Ferry';
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
      if (deg != null) ticks[deg].classList.add('is-active');
    },
    setInteractive(on) {
      interactive = on;
      svg.classList.toggle('is-interactive', on);
    },
    onHover(fn) { hoverFn = fn; },
    onSelect(fn) { selectFn = fn; },
  };
}
