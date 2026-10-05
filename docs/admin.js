import { getClient, degToKm, fmtKm } from './db.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).has('demo');

let api = null;           // real or demo backend, same interface
let rows = [];
let settings = null;

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------
function supabaseApi(client) {
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async load() {
      const [r, s] = await Promise.all([
        client.from('registrations').select('*').order('created_at'),
        client.from('event_settings').select('*').eq('id', 1).single(),
      ]);
      return { rows: check(r), settings: check(s) };
    },
    setStatus: async (id, status) => check(await client.from('registrations').update({ status }).eq('id', id)),
    promote: async (id) => check(await client.rpc('promote_rider', { p_id: id })),
    runDraw: async () => check(await client.rpc('run_draw')),
    setPublished: async (v) => check(await client.rpc('set_draw_published', { p_published: v })),
    setOpen: async (v) => check(await client.rpc('set_registration_open', { p_open: v })),
  };
}

function demoApi() {
  const first = ['Mette', 'Anders', 'Sofie', 'Lars', 'Ida', 'Jonas', 'Freja', 'Mikkel', 'Karin', 'Erik'];
  const last = ['Holm', 'Lund', 'Berg', 'Dahl', 'Krogh', 'Vang', 'Skov'];
  const countries = ['Denmark', 'Denmark', 'Sweden', 'Germany', 'Norway', 'Netherlands'];
  const data = Array.from({ length: 24 }, (_, i) => ({
    id: String(i), created_at: new Date(Date.now() - (24 - i) * 36e5 * 7).toISOString(),
    first_name: first[i % 10], last_name: last[(i * 3) % 7], email: `rider${i}@example.com`,
    country: countries[i % 6], club: i % 3 ? null : 'CK Sample',
    emergency_name: 'Contact Person', emergency_phone: '+45 12 34 56 78',
    longest_ride_km: 400 + (i * 97) % 1200, expected_speed_kmh: 24 + (i % 8), experience: i % 4 ? null : '1000 km brevet',
    status: i < 20 ? 'registered' : 'waitlist', start_degree: null,
  }));
  const s = { capacity: 20, registration_open: true, draw_done: false, draw_published: false };
  const free = () => [...Array(360).keys()].filter((d) => !data.some((r) => r.start_degree === d));
  return {
    load: async () => ({ rows: structuredClone(data), settings: { ...s } }),
    async setStatus(id, status) { const r = data.find((x) => x.id === id); r.status = status; if (status !== 'registered') r.start_degree = null; },
    async promote(id) {
      if (data.filter((r) => r.status === 'registered').length >= s.capacity) throw new Error(`The start list is full (${s.capacity} riders). Withdraw someone first.`);
      const r = data.find((x) => x.id === id); r.status = 'registered';
      if (s.draw_done) { const f = free(); r.start_degree = f[Math.floor(Math.random() * f.length)]; }
    },
    async runDraw() {
      const reg = data.filter((r) => r.status === 'registered').sort(() => Math.random() - 0.5);
      data.forEach((r) => { r.start_degree = null; });
      const spots = [...Array(360).keys()].sort(() => Math.random() - 0.5);
      reg.forEach((r, k) => { r.start_degree = spots[k]; });
      Object.assign(s, { registration_open: false, draw_done: true, draw_published: false });
      return { riders: reg.length };
    },
    async setPublished(v) { s.draw_published = v; },
    async setOpen(v) { s.registration_open = v; },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function say(msg, isError = false) {
  $('admin-msg').textContent = msg;
  $('admin-msg').classList.toggle('is-error', isError);
}

const statusLabel = { registered: 'Start list', waitlist: 'Waitlist', withdrawn: 'Withdrawn' };

function renderControls() {
  const count = (st) => rows.filter((r) => r.status === st).length;
  const reg = count('registered');
  $('c-registered').textContent = `${reg} / ${settings.capacity}`;
  $('c-waitlist').textContent = count('waitlist');
  $('c-withdrawn').textContent = count('withdrawn');
  $('c-countries').textContent = new Set(rows.filter((r) => r.status === 'registered').map((r) => r.country.trim().toLowerCase())).size;

  $('reg-state').textContent = settings.registration_open
    ? 'Open. New riders join the start list until it is full, then the waitlist.'
    : 'Closed. The sign-up form is hidden on the public page.';
  $('toggle-reg').textContent = settings.registration_open ? 'Close registration' : 'Reopen registration';

  const unplaced = rows.filter((r) => r.status === 'registered' && r.start_degree == null).length;
  let draw;
  if (!settings.draw_done) draw = 'Not drawn yet. Running the draw closes registration and gives every rider on the start list a random spot out of the 360 (1.6 km apart).';
  else if (unplaced) draw = `Drawn, but ${unplaced} rider${unplaced === 1 ? ' has' : 's have'} no spot. Run the draw again to reshuffle everyone, or move riders from the waitlist with "Add to start list".`;
  else draw = settings.draw_published ? 'Drawn and published on the public page.' : 'Drawn, not published yet. Check the spots, then publish.';
  $('draw-state').textContent = draw;
  $('run-draw').textContent = settings.draw_done ? 'Run the draw again' : 'Run the draw';
  $('toggle-publish').textContent = settings.draw_published ? 'Hide start list' : 'Publish start list';
  $('toggle-publish').disabled = !settings.draw_done;
}

function cell(tr, main, sub, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  if (main != null) { const s = document.createElement('span'); s.className = 'main'; s.textContent = main; td.append(s); }
  if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; td.append(s); }
  tr.append(td);
  return td;
}

function actionButton(td, label, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'link'; b.textContent = label;
  b.addEventListener('click', fn);
  td.append(b);
}

function visibleRows() {
  const q = $('search').value.trim().toLowerCase();
  const f = $('filter').value;
  return rows
    .filter((r) => f === 'all' || r.status === f)
    .filter((r) => !q || `${r.first_name} ${r.last_name} ${r.email} ${r.country} ${r.club ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.start_degree ?? 999) - (b.start_degree ?? 999) || a.created_at.localeCompare(b.created_at));
}

function renderTable() {
  const list = visibleRows();
  const body = $('rows');
  body.replaceChildren(...list.map((r) => {
    const tr = document.createElement('tr');
    const spot = cell(tr, r.start_degree != null ? `${r.start_degree}°` : '–', r.start_degree != null ? `km ${fmtKm(degToKm(r.start_degree))}` : null, 'spot');
    spot.querySelector('.main').className = '';
    cell(tr, `${r.first_name} ${r.last_name}`, [r.country, r.club].filter(Boolean).join(', '));
    const contact = cell(tr, null, null);
    const a = document.createElement('a'); a.href = `mailto:${r.email}`; a.textContent = r.email; contact.append(a);
    cell(tr, r.emergency_name, r.emergency_phone);
    cell(tr, [r.longest_ride_km != null && `${r.longest_ride_km} km longest`, r.expected_speed_kmh != null && `${r.expected_speed_kmh} km/h`].filter(Boolean).join(', ') || '–', r.experience);
    cell(tr, new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    const st = cell(tr, null, null);
    const pill = document.createElement('span'); pill.className = `status status-${r.status}`; pill.textContent = statusLabel[r.status]; st.append(pill);
    const act = cell(tr, null, null, 'actions');
    const name = `${r.first_name} ${r.last_name}`;
    if (r.status === 'registered') actionButton(act, 'Withdraw', () => act_(() => api.setStatus(r.id, 'withdrawn'), `${name} withdrawn. Their spot is free.`, `Withdraw ${name}?${r.start_degree != null ? ` Spot ${r.start_degree}° will become empty.` : ''}`));
    if (r.status === 'waitlist') {
      actionButton(act, 'Add to start list', () => act_(() => api.promote(r.id), `${name} added to the start list.`));
      actionButton(act, 'Withdraw', () => act_(() => api.setStatus(r.id, 'withdrawn'), `${name} withdrawn.`));
    }
    if (r.status === 'withdrawn') actionButton(act, 'Move to waitlist', () => act_(() => api.setStatus(r.id, 'waitlist'), `${name} is back on the waitlist.`));
    return tr;
  }));
  $('empty').hidden = list.length > 0;
}

async function refresh() {
  ({ rows, settings } = await api.load());
  renderControls();
  renderTable();
}

async function act_(fn, success, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try {
    await fn();
    await refresh();
    say(success);
  } catch (e) {
    say(e.message, true);
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function exportCsv() {
  const cols = ['start_degree', 'km', 'status', 'first_name', 'last_name', 'email', 'country', 'club', 'emergency_name', 'emergency_phone', 'longest_ride_km', 'expected_speed_kmh', 'experience', 'created_at'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of visibleRows()) {
    const row = { ...r, km: r.start_degree != null ? degToKm(r.start_degree).toFixed(1) : '' };
    lines.push(cols.map((c) => esc(row[c])).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `catch-359-riders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function show(id) {
  for (const s of ['not-configured', 'login', 'not-admin', 'dashboard']) $(s).hidden = s !== id;
}

function wireDashboard() {
  $('search').addEventListener('input', renderTable);
  $('filter').addEventListener('change', renderTable);
  $('export').addEventListener('click', exportCsv);
  $('toggle-reg').addEventListener('click', () => {
    const open = !settings.registration_open;
    act_(() => api.setOpen(open), open ? 'Registration reopened.' : 'Registration closed.');
  });
  $('run-draw').addEventListener('click', () => {
    const msg = settings.draw_done
      ? 'Run the draw again? Every rider gets a new random spot and the start list is hidden until you publish it again.'
      : 'Run the draw? This closes registration and gives every rider on the start list a random spot.';
    act_(() => api.runDraw(), 'Draw done. Check the spots below, then publish the start list.', msg);
  });
  $('toggle-publish').addEventListener('click', () => {
    const pub = !settings.draw_published;
    act_(() => api.setPublished(pub), pub ? 'Start list published on the public page.' : 'Start list hidden from the public page.');
  });
}

async function enterDashboard() {
  show('dashboard');
  try { await refresh(); } catch (e) { say(e.message, true); }
}

async function main() {
  wireDashboard();
  const client = await getClient().catch(() => null);

  if (!client) {
    if (demo) {
      api = demoApi();
      $('who').textContent = 'Preview with sample riders';
      return enterDashboard();
    }
    return show('not-configured');
  }

  api = supabaseApi(client);

  const signedIn = async (session) => {
    if (!session) { $('sign-out').hidden = true; $('who').textContent = ''; return show('login'); }
    $('who').textContent = session.user.email;
    $('sign-out').hidden = false;
    const { data: isAdmin } = await client.rpc('is_admin');
    if (!isAdmin) return show('not-admin');
    enterDashboard();
  };

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const { data, error } = await client.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    $('login-error').hidden = !error;
    if (error) { $('login-error').textContent = 'That email and password combination is wrong.'; return; }
    signedIn(data.session);
  });

  $('sign-out').addEventListener('click', async () => {
    await client.auth.signOut();
    signedIn(null);
  });

  const { data } = await client.auth.getSession();
  signedIn(data.session);
}

main();
