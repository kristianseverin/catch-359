import { config } from './config.js';
import { getClient, degToKm, fmtKm } from './db.js';
import { createRing } from './ring.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demoData = params.has('demo');   // ?demo shows sample data when no database is connected
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Static text from config
// ---------------------------------------------------------------------------
function applyConfig() {
  const kmPerDeg = fmtKm(config.routeKm / 360);
  $('fact-km').textContent = `${config.routeKm} km`;
  $('fact-gap').textContent = `1° ≈ ${kmPerDeg} km`;
  if (config.eventDate) {
    const d = new Date(`${config.eventDate}T12:00:00`);
    let txt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (config.startTime) txt += `, ${config.startTime}`;
    $('fact-date').textContent = txt;
  }
  for (const a of [$('route-link'), $('footer-route')]) a.href = config.routeUrl;
  $('route-link').textContent = config.routeName;
  $('ferry-minutes').textContent = `${config.ferryHeadstartMinutes}-minute`;
  if (config.contactEmail) {
    $('footer-contact').innerHTML = '';
    const a = document.createElement('a');
    a.href = `mailto:${config.contactEmail}`;
    a.textContent = config.contactEmail;
    $('footer-contact').append('Questions: ', a);
  }
}

// ---------------------------------------------------------------------------
// Sample data for previewing without a database
// ---------------------------------------------------------------------------
const SAMPLE_FIRST = ['Mette', 'Anders', 'Sofie', 'Lars', 'Ida', 'Jonas', 'Freja', 'Mikkel', 'Karin', 'Erik', 'Hanna', 'Tobias', 'Lena', 'Oskar', 'Maja', 'Rasmus'];
const SAMPLE_LAST = ['Holm', 'Lund', 'Berg', 'Dahl', 'Krogh', 'Vang', 'Skov', 'Bech', 'Friis', 'Juhl', 'Moll', 'Storm'];
const SAMPLE_COUNTRY = ['Denmark', 'Denmark', 'Denmark', 'Sweden', 'Norway', 'Germany', 'Netherlands', 'United Kingdom'];
function sampleStartList() {
  return Array.from({ length: 360 }, (_, d) => ({
    start_degree: d,
    rider_name: `${SAMPLE_FIRST[(d * 7) % 16]} ${SAMPLE_LAST[(d * 5) % 12]}`,
    country: SAMPLE_COUNTRY[(d * 3) % 8],
    club: d % 4 === 0 ? 'CK Sample' : null,
  }));
}
function sampleStats() {
  const published = params.get('demo') === 'startlist';
  return { capacity: 360, registered: published ? 360 : 137, waitlist: 0, registration_open: !published, draw_published: published, countries: 9 };
}

// ---------------------------------------------------------------------------
// Hero ring + registration state
// ---------------------------------------------------------------------------
const ferryDeg = config.ferryKm != null ? (config.ferryKm / config.routeKm) * 360 : null;
const heroRing = createRing($('hero-ring'), { ferryDeg, animate: !reduceMotion });

function renderStats(s) {
  const taken = Math.min(s.registered, s.capacity);
  heroRing.setFilled(new Set(Array.from({ length: taken }, (_, i) => i)));
  $('ring-count').textContent = taken;
  $('ring-label').textContent = `of ${s.capacity} spots taken`;

  const form = $('signup-form');
  const btn = $('submit-btn');
  if (!s.registration_open) {
    form.hidden = true;
    $('hero-cta').textContent = s.draw_published ? 'See the start list' : 'Registration closed';
    $('hero-cta').href = s.draw_published ? '#startlist' : '#signup';
    $('signup-status').textContent = s.draw_published
      ? 'Registration is closed and the start spots have been drawn.'
      : 'Registration is closed. The start spots will be drawn and published here soon.';
  } else if (s.registered >= s.capacity) {
    btn.textContent = 'Join the waitlist';
    $('hero-cta').textContent = 'Join the waitlist';
    $('signup-status').textContent = `All ${s.capacity} start spots are taken. Join the waitlist and you'll move up if someone withdraws` +
      (s.waitlist ? ` (${s.waitlist} ${s.waitlist === 1 ? 'rider is' : 'riders are'} ahead of you).` : '.');
  }
}

// ---------------------------------------------------------------------------
// Sign-up form
// ---------------------------------------------------------------------------
function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function showError(msg) {
  const e = $('form-error');
  e.textContent = msg;
  e.hidden = !msg;
}

async function onSubmit(ev, client) {
  ev.preventDefault();
  const form = ev.currentTarget;
  showError('');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const f = new FormData(form);
  const payload = {
    p_first_name: f.get('first_name'),
    p_last_name: f.get('last_name'),
    p_email: f.get('email'),
    p_country: f.get('country'),
    p_club: f.get('club'),
    p_emergency_name: f.get('emergency_name'),
    p_emergency_phone: f.get('emergency_phone'),
    p_longest_ride_km: numOrNull(f.get('longest_ride_km')),
    p_expected_speed_kmh: numOrNull(f.get('expected_speed_kmh')),
    p_experience: f.get('experience'),
  };

  if (!client) {
    showError("This is a preview: the database isn't connected yet, so nothing was saved.");
    return;
  }

  const btn = $('submit-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Signing up…';
  const { data, error } = await client.rpc('register_rider', payload);
  btn.disabled = false;
  btn.textContent = label;

  if (error) {
    if (error.hint === 'duplicate') showError(`${payload.p_email} is already signed up. To change your details, contact the organizers.`);
    else if (error.hint === 'closed') showError('Registration has closed.');
    else showError("Your sign-up didn't go through. Check the fields and try again.");
    return;
  }

  form.hidden = true;
  const box = $('confirmation');
  if (data.status === 'waitlist') {
    $('confirm-title').textContent = `You're number ${data.waitlist_position} on the waitlist`;
    $('confirm-text').textContent = "If a rider withdraws, the organizers will move you onto the start list and email you.";
  } else {
    $('confirm-title').textContent = `You're on the start list, ${payload.p_first_name.trim()}`;
  }
  box.hidden = false;
  box.focus();
  loadStats(client);
}

// ---------------------------------------------------------------------------
// Public start list
// ---------------------------------------------------------------------------
function renderStartList(riders) {
  $('startlist').hidden = false;
  $('nav-startlist').hidden = false;

  const byDeg = new Map(riders.map((r) => [r.start_degree, r]));
  const ring = createRing($('list-ring'), { ferryDeg, animate: false });
  ring.setFilled(new Set(byDeg.keys()));
  ring.setInteractive(true);

  const show = (deg) => {
    const r = byDeg.get(deg);
    $('pick-deg').textContent = deg == null ? '–' : `${deg}°`;
    $('pick-name').textContent = deg == null ? 'Point at a spot' : (r ? r.rider_name : 'Empty spot');
    $('pick-meta').textContent = deg == null ? '' : [r && [r.country, r.club].filter(Boolean).join(', '), `km ${fmtKm(degToKm(deg))}`].filter(Boolean).join('  /  ');
  };
  let pinned = null;
  ring.onHover((deg) => { show(deg ?? pinned); ring.setActive(deg ?? pinned); });
  ring.onSelect((deg) => { pinned = deg; show(deg); ring.setActive(deg); });

  const list = $('rider-list');
  const items = riders.map((r) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="deg"></span><span class="who"><span class="name"></span><span class="from"></span></span><span class="km"></span>';
    b.querySelector('.deg').textContent = `${r.start_degree}°`;
    b.querySelector('.name').textContent = r.rider_name;
    b.querySelector('.from').textContent = [r.country, r.club].filter(Boolean).join(', ');
    b.querySelector('.km').textContent = `km ${fmtKm(degToKm(r.start_degree))}`;
    b.addEventListener('click', () => { pinned = r.start_degree; show(pinned); ring.setActive(pinned); });
    li.append(b);
    li.dataset.search = `${r.rider_name} ${r.country} ${r.club ?? ''}`.toLowerCase();
    return li;
  });
  list.replaceChildren(...items);

  $('rider-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let first = null;
    for (const li of items) {
      const hit = !q || li.dataset.search.includes(q);
      li.hidden = !hit;
      if (hit && !first) first = li;
    }
    if (q && first) {
      const deg = Number(first.querySelector('.deg').textContent.replace('°', ''));
      show(deg);
      ring.setActive(deg);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function loadStats(client) {
  let stats;
  if (client) {
    const { data, error } = await client.rpc('get_public_stats');
    if (error) {
      $('signup-status').textContent = "Registration information couldn't be loaded. Reload the page to try again.";
      return null;
    }
    stats = data;
  } else {
    stats = demoData ? sampleStats() : { capacity: 360, registered: 0, waitlist: 0, registration_open: true, draw_published: false };
  }
  renderStats(stats);
  return stats;
}

async function main() {
  applyConfig();
  const client = await getClient().catch(() => null);
  if (!client) $('demo-note').hidden = false;

  $('signup-form').addEventListener('submit', (ev) => onSubmit(ev, client));

  const stats = await loadStats(client);
  if (stats?.draw_published) {
    if (client) {
      const { data } = await client.rpc('get_start_list');
      if (data?.length) renderStartList(data);
    } else {
      renderStartList(sampleStartList());
    }
  }
}

main();
