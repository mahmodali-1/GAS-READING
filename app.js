/* refuse to run inside another site's frame (clickjacking protection) */
if (window.top !== window.self) { try { window.top.location.replace(window.self.location.href); } catch (e) {} throw new Error('framed'); }
document.body.classList.add('ok');

(() => {
'use strict';

/* =========================================================
   SETTINGS — fill these two lines from Supabase
   (Project Settings → API). The key is the PUBLIC "anon" or
   "publishable" key, which is safe inside a webpage.
   Never put the service_role / secret key here.
   ========================================================= */
const CONFIG = Object.assign({
  supabaseUrl: '', supabaseKey: '',
  managerEmail: 'mahmood.ali@midalcable.com', supervisorEmail: 'mahmood02ali@gmail.com',
}, window.MIDAL_CONFIG || {});


/* =========================================================
   Helpers
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const todayISO = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const toUTC = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = t => { const d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 864e5);
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]}`; };
const fmtMonth = ym => { const [y, m] = ym.split('-'); return `${MON[+m - 1]} ${y}`; };
const weekday = iso => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(toUTC(iso)).getUTCDay()];
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (v, d) => v == null || !isFinite(v) ? '–' : (d === 2 ? nf2 : d === 1 ? nf1 : (Math.abs(v) < 10 ? nf1 : nf0)).format(v);
const compact = v => { const a = Math.abs(v); if (a >= 1e6) return nf1.format(v / 1e6) + 'M'; if (a >= 1e3) return nf1.format(v / 1e3) + 'k'; return nf0.format(v); };
const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* HF / TF naming: "hf1", "HF-01", "hf #1" -> "HF 1" */
const hfName = s => { const m = String(s ?? '').trim().match(/^(HF|TF)\s*[-_#.]?\s*0*(\d+)\s*$/i); return m ? `${m[1].toUpperCase()} ${m[2]}` : String(s ?? '').trim(); };
const hfType = s => { const m = String(s ?? '').trim().match(/^(HF|TF)\b|^(HF|TF)(?=\d)/i); return m ? (m[1] || m[2]).toUpperCase() : ''; };
const nextNum = type => Math.max(0, ...S.furnaces.filter(f => hfType(f.name) === type).map(f => +(f.name.match(/\d+/) || [0])[0])) + 1;
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* =========================================================
   State
   ========================================================= */
const DEFAULT_SETTINGS = { unit: 'Nm³', threshold: 40, window: 30 };
const S = {
  furnaces: [],            // {id,name,code,group,mode,active,order}
  months: new Map(),       // docId -> {furnace, month:'YYYY-MM', days:{DD:{v,note,by,at}}}
  settings: { ...DEFAULT_SETTINGS },
  ver: 0,
  loaded: { f: false, r: false },
  view: 'overview', fid: null, group: 'HF',
  range: '90', from: null, to: null,
  entryDate: todayISO(), draft: {},
  tableMonth: null,
  canWrite: true,
  charts: [],
  imp: null,
};

/* =========================================================
   Storage — claude db when published, browser storage otherwise
   ========================================================= */
const LS_KEY = 'midal-furnace-gas-v1';
const Store = {
  mode: 'wait', db: null,
  async init() {
    if (CONFIG.supabaseUrl && CONFIG.supabaseKey) {
      if (window.supabase) return sbBoot();
      toast('Could not load the login library. Check the internet and reload.', true); return;
    }
    if (!(window.claude && typeof window.claude.use === 'function')) { showLogin(''); return; }
    let db = null;
    if (window.claude && typeof window.claude.use === 'function') {
      try { db = await window.claude.use('db'); } catch { db = null; }
    }
    if (db) {
      this.db = db; this.mode = 'db'; setSync('db');
      let user = null;
      try { user = await window.claude.use('user'); } catch {}
      let admin = true;
      if (user && typeof user.canEdit === 'function') { try { admin = await user.canEdit(); } catch {} }
      if (!admin) { await startSupervisor(db, user); changed(true); return; }
      S.role = 'manager'; setRoleBadge();
      subscribeManagerExtras(db);
      db.doc('public/requests').onSnapshot(s => { S.requests = s.exists ? clone(s.data()).items || {} : {}; changed(); }, () => {});
      db.collection('furnaces').onSnapshot(snap => {
        S.furnaces = snap.docs.map(d => ({ id: d.id, ...clone(d.data()) })).sort(byOrder);
        S.loaded.f = true; changed();
      }, e => onDbError(e));
      db.collection('readings').limit(1000).onSnapshot(snap => {
        const m = new Map();
        snap.docs.forEach(d => m.set(d.id, clone(d.data())));
        S.months = m; S.loaded.r = true; changed();
      }, e => onDbError(e));
      db.doc('config/settings').onSnapshot(snap => {
        S.settings = { ...DEFAULT_SETTINGS, ...(snap.exists ? clone(snap.data()) : {}) }; changed();
      }, e => onDbError(e));
      try {
        if (user && typeof user.can === 'function') {
          const w = await user.can('data.write');
          if (w === false) { S.canWrite = false; changed(true); }
        }
      } catch {}
    } else this.initLocal();
  },
  initLocal() {
      this.mode = 'local'; setSync('local');
      try {
        const raw = JSON.parse(lsGet(LS_KEY) || 'null');
        if (raw) {
          S.furnaces = (raw.furnaces || []).sort(byOrder);
          S.months = new Map(raw.months || []);
          S.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
          S.requests = raw.requests || {};
        }
      } catch {}
      S.loaded.f = S.loaded.r = true; changed(true);
  },
  persistLocal() {
    if (this.mode !== 'local') return;
    lsSet(LS_KEY, JSON.stringify({ furnaces: S.furnaces, months: [...S.months], settings: S.settings, requests: S.requests }));
  },
  async setMonth(id, body) { if (this.mode === 'sb') return; if (this.mode === 'db') await this.db.doc('readings/' + id).set(body); else this.persistLocal(); },
  async delMonth(id) { if (this.mode === 'sb') return; if (this.mode === 'db') await this.db.doc('readings/' + id).delete(); else this.persistLocal(); },
  async setFurnace(f) { if (this.mode === 'sb') { const { error } = await SB.client.from('furnaces').upsert(fToRow(f)); if (error) throw error; return; } const { id, ...rest } = f; if (this.mode === 'db') await this.db.doc('furnaces/' + id).set(rest); else this.persistLocal(); },
  async delFurnace(id) { if (this.mode === 'sb') { const { error } = await SB.client.from('furnaces').delete().eq('id', id); if (error) throw error; return; } if (this.mode === 'db') await this.db.doc('furnaces/' + id).delete(); else this.persistLocal(); },
  async setSettings(s) { if (this.mode === 'sb') { const { error } = await SB.client.from('settings').update({ unit: s.unit, threshold: s.threshold, window_days: s.window }).eq('id', 1); if (error) throw error; return; } if (this.mode === 'db') await this.db.doc('config/settings').set(s); else this.persistLocal(); },
};
function byOrder(a, b) { return rankG(groupOf(a)) - rankG(groupOf(b)) || groupOf(a).localeCompare(groupOf(b)) || (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name, undefined, { numeric: true }); }
function onDbError(e) {
  if (e && e.code === 'revoked') { S.canWrite = false; toast('Access to shared data ended. Reload to reconnect.', true); }
  else if (e && e.code === 'resource_exhausted') toast('Too many requests. Reload the page in a minute.', true);
}
function writeError(e) {
  if (Store.mode === 'sb') { toast(sbErr(e), true); return; }
  const c = e && e.code;
  if (c === 'invalid_argument') { S.canWrite = false; changed(true); toast('You have view-only access. Ask the owner for Contributor access to edit.', true); }
  else if (c === 'quota_exceeded') toast('Storage is full. Delete old readings or furnaces to free space.', true);
  else if (c === 'resource_exhausted') toast('Saving too fast. Wait a moment and try again.', true);
  else toast('Could not save. Check your connection and try again.', true);
}
function setSync(mode) {
  const el = $('#sync'); el.className = 'sync ' + (mode === 'local' ? 'local' : mode === 'wait' ? 'wait' : '');
  el.lastElementChild.textContent = mode === 'sb' ? 'Secure database' : mode === 'db' ? 'Live · shared' : mode === 'local' ? 'Saved in this browser' : 'Connecting…';
}

/* per-document write queue: one write at a time per document */
const queues = new Map();
function queued(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const p = prev.then(fn, fn);
  queues.set(key, p.catch(() => {}));
  return p;
}

/* =========================================================
   Data access
   ========================================================= */
const monthId = (fid, iso) => `${fid}__${iso.slice(0, 7)}`;
const furnace = id => S.furnaces.find(f => f.id === id);
const activeFurnaces = () => S.furnaces.filter(f => f.active !== false).sort(byOrder);
const unit = () => S.settings.unit || 'Nm³';

function entriesOf(fid) {
  const out = [];
  for (const body of S.months.values()) {
    if (!body || body.furnace !== fid || !body.days) continue;
    for (const [dd, e] of Object.entries(body.days)) {
      if (e && typeof e.v === 'number' && isFinite(e.v)) out.push({ date: `${body.month}-${dd}`, v: e.v, note: e.note || '', by: e.by || '', at: e.at || 0 });
    }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}
function entryAt(fid, iso) {
  const b = S.months.get(monthId(fid, iso));
  const e = b && b.days && b.days[iso.slice(8)];
  return e && typeof e.v === 'number' ? e : null;
}

/* changes: [{fid, date, v (number|null to delete), note}] */
async function putEntries(changes, onProgress) {
  const groups = new Map();
  for (const c of changes) {
    const id = monthId(c.fid, c.date);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  const by = lsGet('midal-gas-by') || '';
  const ids = [...groups.keys()];
  // optimistic local apply
  const bodies = new Map();
  for (const id of ids) {
    const list = groups.get(id);
    const body = clone(S.months.get(id)) || { furnace: list[0].fid, month: list[0].date.slice(0, 7), days: {} };
    body.days = body.days || {};
    for (const c of list) {
      const dd = c.date.slice(8);
      if (c.v == null) delete body.days[dd];
      else body.days[dd] = { v: c.v, note: c.note || '', by: c.by ?? by, at: Date.now() };
    }
    bodies.set(id, body);
    if (Object.keys(body.days).length) S.months.set(id, body); else S.months.delete(id);
  }
  changed();
  if (Store.mode === 'sb') return sbWrite(changes, onProgress);
  let done = 0, failed = null;
  const work = ids.map(id => () => queued('m:' + id, async () => {
    const body = bodies.get(id);
    try {
      if (Object.keys(body.days).length) await Store.setMonth(id, body); else await Store.delMonth(id);
    } catch (e) { failed = failed || e; }
    done++; onProgress && onProgress(done, ids.length);
  }));
  await pool(work, 4);
  if (Store.mode === 'local') Store.persistLocal();
  if (failed) { writeError(failed); return false; }
  return true;
}
async function pool(tasks, n) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) await tasks[i++](); });
  await Promise.all(runners);
}
async function saveFurnace(f) {
  const i = S.furnaces.findIndex(x => x.id === f.id);
  if (i >= 0) S.furnaces[i] = f; else S.furnaces.push(f);
  S.furnaces.sort(byOrder); changed();
  try { await queued('f:' + f.id, () => Store.setFurnace(f)); return true; } catch (e) { writeError(e); return false; }
}
async function removeFurnace(id) {
  const docs = [...S.months.entries()].filter(([, b]) => b.furnace === id).map(([k]) => k);
  S.furnaces = S.furnaces.filter(f => f.id !== id);
  docs.forEach(k => S.months.delete(k));
  if (S.fid === id) { S.fid = null; S.view = 'overview'; }
  changed(true);
  try {
    await queued('f:' + id, () => Store.delFurnace(id));
    await pool(docs.map(k => () => queued('m:' + k, () => Store.delMonth(k))), 4);
  } catch (e) { writeError(e); }
}

/* =========================================================
   Analytics
   ========================================================= */
const memo = new Map();
function analyse(f) {
  const m = memo.get(f.id);
  if (m && m.ver === S.ver) return m.res;
  const entries = entriesOf(f.id);
  const daily = new Map();   // date -> {c, est, status, base, drop}
  const meter = f.mode !== 'consumption';
  if (!meter) {
    entries.forEach(e => daily.set(e.date, { c: e.v, est: false }));
  } else {
    for (let i = 1; i < entries.length; i++) {
      const p = entries[i - 1], e = entries[i];
      const gap = diffDays(p.date, e.date);
      const diff = e.v - p.v;
      if (gap <= 0) continue;
      if (diff < 0) { daily.set(e.date, { c: null, est: false, drop: true, diff }); continue; }
      const per = diff / gap;
      for (let k = 1; k <= gap; k++) daily.set(addDays(p.date, k), { c: per, est: gap > 1, span: gap });
    }
  }
  const days = [...daily.keys()].sort();
  const thr = +S.settings.threshold || 40, win = +S.settings.window || 30;
  const hist = [];
  for (const d of days) {
    const r = daily.get(d);
    if (r.c == null) { r.status = 'drop'; continue; }
    const base = hist.length >= 7 ? median(hist.slice(-win)) : null;
    r.base = base;
    if (r.c === 0) r.status = 'idle';
    else if (r.est) r.status = 'est';
    else if (base > 0 && Math.abs(r.c - base) / base * 100 > thr) r.status = r.c > base ? 'high' : 'low';
    else r.status = 'ok';
    if (r.c > 0) hist.push(r.c);
  }
  const res = { entries, daily, days, meter, first: days[0] || entries[0]?.date || null, last: entries.length ? entries[entries.length - 1] : null };
  memo.set(f.id, { ver: S.ver, res });
  return res;
}
function sumRange(a, from, to) {
  let total = 0, n = 0, running = 0, max = null, maxD = null, anomalies = 0, est = 0, drops = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = a.daily.get(d);
    if (!r) continue;
    if (r.status === 'drop') { drops++; continue; }
    total += r.c; n++;
    if (r.c > 0) running++;
    if (r.est) est++;
    if (r.status === 'high' || r.status === 'low') anomalies++;
    if (max == null || r.c > max) { max = r.c; maxD = d; }
  }
  return { total, n, running, avg: running ? total / running : null, max, maxD, anomalies, est, drops };
}
function rangeBounds() {
  const to = S.range === 'custom' && S.to ? S.to : todayISO();
  if (S.range === 'all') {
    let min = to;
    S.furnaces.forEach(f => { const a = analyse(f); if (a.first && a.first < min) min = a.first; });
    return { from: min, to };
  }
  if (S.range === 'custom' && S.from) return { from: S.from <= to ? S.from : to, to };
  const n = S.range === 'custom' ? 90 : +S.range;
  return { from: addDays(to, -(n - 1)), to };
}
function monthToDate(a) {
  const t = todayISO(), m0 = t.slice(0, 8) + '01';
  const cur = sumRange(a, m0, t);
  const [y, m] = t.split('-').map(Number);
  const pm = m === 1 ? ymd(y - 1, 12, 1) : ymd(y, m - 1, 1);
  const pmEnd = addDays(m0, -1);
  const pto = addDays(pm, diffDays(m0, t));
  const prev = sumRange(a, pm, pto < pmEnd ? pto : pmEnd);
  return { cur, prev };
}
function freshness(f) {
  const a = analyse(f);
  if (!a.last) return 'none';
  const age = diffDays(a.last.date, todayISO());
  const lastDay = a.daily.get(a.last.date);
  if (lastDay && lastDay.status === 'drop') return 'warn';
  return age <= 0 ? 'today' : age === 1 ? 'late' : 'old';
}

/* =========================================================
   Render scheduling
   ========================================================= */
let rafId = 0, pending = false;
function changed(force) {
  S.ver++;
  managerHooks();
  if (force) pending = true;
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}
function editingInMain() {
  const a = document.activeElement;
  return a && $('#main').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'button';
}
document.addEventListener('focusout', () => setTimeout(() => { if (pending && !editingInMain()) render(); }, 0));

function render(forceMain) {
  if (S.role === 'supervisor') { if (Store.mode === 'sb') { renderSimpleSup(); return; } if (forceMain) S._lastView = null; renderSupervisor(); return; }
  if (!S.loaded.f || !S.loaded.r) return;
  renderNav();
  renderRail();
  if (!forceMain && editingInMain() && S.view === S._lastView) { pending = true; if (S.view === 'entry') refreshEntryRows(); return; }
  pending = false;
  S._lastView = S.view;
  S.charts.forEach(c => c.destroy()); S.charts = [];
  const main = $('#main');
  const views = { overview: viewOverview, group: viewGroup, compare: viewCompare, furnace: viewFurnace, entry: viewEntry, data: viewData, manage: viewManage };
  if (!S.furnaces.length && (S.view === 'overview' || S.view === 'group' || S.view === 'compare' || S.view === 'furnace' || S.view === 'entry')) main.innerHTML = viewEmpty();
  else (views[S.view] || viewOverview)(main);
}
function go(view, fid) {
  S.view = view; if (fid !== undefined) S.fid = fid;
  render(true);
  window.scrollTo({ top: 0 });
}

/* =========================================================
   Groups (HF / TF) and ordering
   ========================================================= */
const GROUP_ORDER = ['HF', 'TF'];
const groupOf = f => (f.group || hfType(f.name) || 'Other');
const rankG = g => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? (g === 'Other' ? 99 : 50) : i; };
const groupName = g => g === 'Other' ? 'Other furnaces' : `${g} furnaces`;
function groupsOf(list) { return [...new Set(list.map(groupOf))].sort((a, b) => rankG(a) - rankG(b) || a.localeCompare(b)); }
function inGroup(g) { return activeFurnaces().filter(f => groupOf(f) === g); }
const shortName = f => { const g = groupOf(f), m = String(f.name).match(/(\d+)\s*$/); return m && norm(f.name).startsWith(norm(g)) ? m[1] : f.name; };
const GROUP_COLORS = () => ({ HF: css('--brand'), TF: css('--tf'), Other: css('--muted') });
const gColor = g => GROUP_COLORS()[g] || css('--muted');
const PALETTE = ['#0B109F', '#E0602D', '#12A58A', '#D0457A', '#7A4FD0', '#C79A00', '#1C9AD6', '#8B4513', '#6BAA1F', '#5E6A8A', '#E377C2', '#0F6E6E'];
const PALETTE_DARK = ['#8C92FF', '#FF9A6B', '#4FD1B0', '#FF7FB0', '#B18CFF', '#F1C94A', '#56C1F0', '#D9A066', '#9FDC5A', '#A3AECB', '#F5A6D8', '#4FB8B8'];
const pal = i => (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' ? PALETTE_DARK : PALETTE)[i % PALETTE.length];

/* =========================================================
   Chrome: nav, rail toggle, rail
   ========================================================= */
function renderNav() {
  $$('.nav button').forEach(b => {
    b.removeAttribute('aria-current');
    if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page');
  });
}
function spark(a) {
  const t = todayISO(), vals = [];
  for (let i = 29; i >= 0; i--) { const r = a.daily.get(addDays(t, -i)); vals.push(r && r.c != null ? r.c : null); }
  const nums = vals.filter(v => v != null);
  if (nums.length < 2) return '<svg viewBox="0 0 100 22" aria-hidden="true"><line x1="0" y1="20" x2="100" y2="20" stroke="currentColor" stroke-opacity=".2"/></svg>';
  const max = Math.max(...nums) || 1;
  let d = '', pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = (i / 29 * 100).toFixed(2), y = (20 - v / max * 18).toFixed(2);
    d += (pen ? 'L' : 'M') + x + ' ' + y; pen = true;
  });
  return `<svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
const frClass = fr => fr === 'today' ? 'today' : fr === 'late' ? 'late' : fr === 'warn' ? 'warn' : '';
const frTitle = fr => fr === 'today' ? 'Read today' : fr === 'late' ? 'Last read yesterday' : fr === 'warn' ? 'Last reading is lower than the one before' : fr === 'none' ? 'No readings' : 'No reading for 2+ days';

function setRail(show) {
  document.body.classList.toggle('rail-hidden', !show);
  const b = $('#railToggle'); b.setAttribute('aria-expanded', String(show));
  b.title = show ? 'Hide furnace list ( [ )' : 'Show furnace list ( [ )';
  lsSet('midal-gas-rail', show ? '1' : '0');
  setTimeout(() => S.charts.forEach(c => c.resize()), 60);
}
$('#railToggle').addEventListener('click', () => setRail(document.body.classList.contains('rail-hidden')));
{ const pref = lsGet('midal-gas-rail'); setRail(pref == null ? !matchMedia('(max-width: 860px)').matches : pref !== '0'); }

function renderRail() {
  const rail = $('#rail');
  if (!S.furnaces.length) { rail.innerHTML = '<div class="rail-title"><span>No furnaces yet</span></div>'; return; }
  const act = activeFurnaces();
  let html = `<div class="rail-title"><span>${act.length} furnaces</span><span>Month to date</span></div>`;
  html += `<button class="ri all" data-go="overview" ${S.view === 'overview' ? 'aria-current="true"' : ''}><span></span><span class="nm">All furnaces</span><span class="vl">${esc(unit())}</span></button>`;
  for (const g of groupsOf(act)) {
    const list = inGroup(g);
    const mtd = list.reduce((x, f) => x + monthToDate(analyse(f)).cur.total, 0);
    const cur = S.view === 'group' && S.group === g;
    html += `<button class="rail-group" data-group="${esc(g)}" ${cur ? 'aria-current="true"' : ''}><i class="gsw" style="background:${gColor(g)}"></i><span>${esc(groupName(g))}</span><span class="vl">${compact(mtd)}</span></button>`;
    for (const f of list) {
      const a = analyse(f), m = monthToDate(a).cur.total, fr = freshness(f);
      const on = S.view === 'furnace' && S.fid === f.id;
      html += `<button class="ri" data-fid="${esc(f.id)}" ${on ? 'aria-current="true"' : ''} title="${frTitle(fr)}">
        <span class="dot ${frClass(fr)}"></span><span class="nm">${esc(f.name)}</span><span class="vl">${a.first ? compact(m) : '–'}</span>${spark(a)}</button>`;
    }
  }
  html += `<div class="rail-legend"><span><i class="dot today"></i>Read today</span><span><i class="dot late"></i>Last read yesterday</span><span><i class="dot"></i>Older or none</span><span><i class="dot warn"></i>Needs checking</span></div>`;
  rail.innerHTML = html;
  const curEl = rail.querySelector('[aria-current="true"]');
  if (curEl && S._railScrollFor !== (S.fid || S.group || S.view)) { S._railScrollFor = S.fid || S.group || S.view; curEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
$('#rail').addEventListener('click', e => {
  const g = e.target.closest('.rail-group'); if (g) { S.group = g.dataset.group; go('group'); return; }
  const b = e.target.closest('.ri'); if (!b) return;
  if (b.dataset.go) go('overview'); else go('furnace', b.dataset.fid);
});
$('.nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });

/* ---------- Furnace switcher strip (on every analysis page) ---------- */
function switcher() {
  const act = activeFurnaces();
  return `<nav class="fstrip" aria-label="Jump to a furnace">
    <button class="fs-all" data-go="overview" ${S.view === 'overview' ? 'aria-current="true"' : ''}>All</button>
    ${groupsOf(act).map(g => `<div class="fs-grp">
      <button class="fs-g" data-group="${esc(g)}" ${S.view === 'group' && S.group === g ? 'aria-current="true"' : ''} style="--gc:${gColor(g)}">${esc(g)}</button>
      ${inGroup(g).map(f => `<button class="fs-f ${frClass(freshness(f))}" data-fid="${esc(f.id)}" title="${esc(f.name)} · ${frTitle(freshness(f))}" ${S.view === 'furnace' && S.fid === f.id ? 'aria-current="true"' : ''}>${esc(shortName(f))}</button>`).join('')}
    </div>`).join('')}
    <button class="fs-cmp" data-cmp title="Compare furnaces on the same charts">Compare</button>
    <button class="fs-find" data-find title="Find a furnace (Ctrl+K)">Find <kbd>Ctrl K</kbd></button>
  </nav>`;
}
function bindSwitcher(root) {
  root.querySelectorAll('.fstrip [data-fid]').forEach(b => b.addEventListener('click', () => go('furnace', b.dataset.fid)));
  root.querySelectorAll('.fstrip [data-group]').forEach(b => b.addEventListener('click', () => { S.group = b.dataset.group; go('group'); }));
  root.querySelectorAll('.fstrip [data-go]').forEach(b => b.addEventListener('click', () => go('overview')));
  root.querySelectorAll('[data-find]').forEach(b => b.addEventListener('click', openFind));
  root.querySelectorAll('[data-cmp]').forEach(b => b.addEventListener('click', () => {
    if (S.view === 'furnace' && S.fid) compareWith([S.fid, ...S.cmp.filter(x => x !== S.fid)]);
    else if (S.view === 'group') compareWith(inGroup(S.group).map(f => f.id));
    else go('compare');
  }));
}
function stepFurnace(dir) {
  const list = activeFurnaces(); if (!list.length) return;
  const i = list.findIndex(f => f.id === S.fid);
  const n = list[(i + dir + list.length) % list.length];
  go('furnace', n.id);
}
function stepGroup(dir) {
  const gs = groupsOf(activeFurnaces()); if (!gs.length) return;
  const i = gs.indexOf(S.group); S.group = gs[(i + dir + gs.length) % gs.length]; go('group');
}

/* ---------- Find (Ctrl+K) ---------- */
const dlgF = $('#dlgFind');
let findSel = 0, findItems = [];
function findList() {
  const items = [{ label: 'All furnaces', sub: 'Overview', act: () => go('overview') }];
  for (const g of groupsOf(activeFurnaces())) {
    items.push({ label: `All ${g}`, sub: `${inGroup(g).length} furnaces compared`, act: () => { S.group = g; go('group'); } });
    inGroup(g).forEach(f => { const a = analyse(f); items.push({ label: f.name, sub: a.last ? `Last reading ${fmtDay(a.last.date)}` : 'No readings', fid: f.id, act: () => go('furnace', f.id) }); });
  }
  items.push({ label: 'Compare furnaces', sub: 'Two or more on the same charts', act: () => go('compare') });
  items.push({ label: 'Daily entry', sub: 'Enter today’s readings', act: () => go('entry') });
  items.push({ label: 'Import & export', sub: 'Excel in and out', act: () => go('data') });
  items.push({ label: 'Furnaces & settings', sub: 'Add, rename, reorder', act: () => go('manage') });
  return items;
}
function renderFind() {
  const q = norm($('#findQ').value);
  findItems = findList().filter(it => !q || norm(it.label).includes(q) || norm(it.label).replace(/^(hf|tf)/, '') === q);
  findSel = Math.min(findSel, Math.max(0, findItems.length - 1));
  $('#findList').innerHTML = findItems.length ? findItems.map((it, i) => `<li role="option" id="fo${i}" aria-selected="${i === findSel}" data-i="${i}"><strong>${esc(it.label)}</strong><span>${esc(it.sub)}</span></li>`).join('') : '<li class="none">No match</li>';
  $('#findQ').setAttribute('aria-activedescendant', findItems.length ? 'fo' + findSel : '');
  const el = $('#fo' + findSel); el && el.scrollIntoView({ block: 'nearest' });
}
function openFind() { if (dlgF.open || S.role === 'supervisor') return; $('#findQ').value = ''; findSel = 0; renderFind(); dlgF.showModal(); $('#findQ').focus(); }
function pickFind(i) { const it = findItems[i]; if (!it) return; dlgF.close(); it.act(); }
$('#findQ').addEventListener('input', () => { findSel = 0; renderFind(); });
$('#findQ').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); findSel = Math.min(findItems.length - 1, findSel + 1); renderFind(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); findSel = Math.max(0, findSel - 1); renderFind(); }
  else if (e.key === 'Enter') { e.preventDefault(); pickFind(findSel); }
});
$('#findList').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); li && pickFind(+li.dataset.i); });
$('#findBtn').addEventListener('click', openFind);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openFind(); return; }
  if ($$('dialog').some(d => d.open)) return;
  const t = e.target, typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === '/') { e.preventDefault(); openFind(); }
  else if (S.role === 'supervisor') return;
  else if (e.key === '[') setRail(document.body.classList.contains('rail-hidden'));
  else if (S.view === 'furnace' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); stepFurnace(e.key === 'ArrowRight' ? 1 : -1); }
  else if (S.view === 'group' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); stepGroup(e.key === 'ArrowRight' ? 1 : -1); }
});

/* ---------- group math ---------- */
function groupDaily(list, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let sum = 0, n = 0;
    list.forEach(f => { const r = analyse(f).daily.get(d); if (r && r.c != null) { sum += r.c; n++; } });
    out.push({ d, sum: n ? sum : null, n });
  }
  return out;
}
function last13() {
  const t = todayISO(); let [y, mo] = t.split('-').map(Number); const months = [];
  for (let i = 0; i < 13; i++) { months.unshift(ymd(y, mo, 1)); mo--; if (!mo) { mo = 12; y--; } }
  return months.map((m0, i) => ({ key: m0.slice(0, 7), from: m0, to: i < 12 ? addDays(months[i + 1], -1) : t }));
}
function rowsFor(list, from, to) {
  return list.map(f => { const a = analyse(f); return { f, a, s: sumRange(a, from, to), m: monthToDate(a) }; });
}
function sumRows(rows) {
  const t = { total: 0, mtd: 0, pmtd: 0, anomalies: 0, running: 0 };
  rows.forEach(r => { t.total += r.s.total; t.mtd += r.m.cur.total; t.pmtd += r.m.prev.total; t.anomalies += r.s.anomalies; t.running += r.s.running; });
  return t;
}
function lastCell(f, a) { return a.last ? `${fmtDay(a.last.date)}${freshness(f) === 'warn' ? ' <span class="pill drop">Check</span>' : ''}` : '<span class="muted">None</span>'; }

/* =========================================================
   Overview — HF and TF analysed side by side
   ========================================================= */
function viewOverview(main) {
  const { from, to } = rangeBounds(), t = todayISO();
  const act = activeFurnaces(), gs = groupsOf(act);
  const G = gs.map(g => { const rows = rowsFor(inGroup(g), from, to); return { g, rows, tot: sumRows(rows), daily: groupDaily(inGroup(g), from, to) }; });
  const plant = { total: 0, mtd: 0, pmtd: 0, anomalies: 0 };
  G.forEach(x => { plant.total += x.tot.total; plant.mtd += x.tot.mtd; plant.pmtd += x.tot.pmtd; plant.anomalies += x.tot.anomalies; });
  const readToday = act.filter(f => analyse(f).last?.date === t).length;
  const months = last13();

  const figG = G.slice(0, 2).map(x => `<div class="fig gfig" style="--gc:${gColor(x.g)}"><div class="k">${esc(x.g)}, month to date</div><div class="v">${fmt(x.tot.mtd)}<small>${esc(unit())}</small></div><div class="n">${pct(x.tot.mtd, x.tot.pmtd) || '–'} vs last month · ${plant.mtd ? nf0.format(x.tot.mtd / plant.mtd * 100) : 0}% of plant</div></div>`).join('');

  const flagged = [];
  G.forEach(x => x.rows.forEach(({ f, a }) => { for (let d = addDays(t, -6); d <= t; d = addDays(d, 1)) { const r = a.daily.get(d); if (r && ['high', 'low', 'drop'].includes(r.status)) flagged.push({ g: x.g, f, d, r }); } }));

  const tableBody = G.map(x => {
    const gt = x.tot;
    const maxT = Math.max(1, ...x.rows.map(r => r.s.total));
    return `<tbody class="grp">
      <tr class="gsum click" data-group="${esc(x.g)}" style="--gc:${gColor(x.g)}">
        <td><strong>${esc(groupName(x.g))}</strong> <span class="muted">${x.rows.length}</span></td>
        <td class="num"><strong>${fmt(gt.total)}</strong></td>
        <td class="num">${plant.total ? nf1.format(gt.total / plant.total * 100) + '% of plant' : '–'}</td>
        <td></td>
        <td class="num">${pct(gt.mtd, gt.pmtd) || '–'}</td>
        <td class="num">${gt.anomalies}</td>
        <td></td>
      </tr>
      ${x.rows.map(({ f, a, s, m }) => `<tr class="click" data-fid="${esc(f.id)}">
        <td class="fcell">${esc(f.name)}</td>
        <td class="num">${fmt(s.total)}</td>
        <td><div class="sharebar"><div class="bar-bg"><div class="bar-in" style="width:${(s.total / maxT * 100).toFixed(1)}%;background:${gColor(x.g)}"></div></div><span>${gt.total ? nf0.format(s.total / gt.total * 100) : 0}%</span></div></td>
        <td class="num">${fmt(s.avg)}</td>
        <td class="num">${pct(m.cur.total, m.prev.total) || '–'}</td>
        <td class="num">${s.anomalies || ''}</td>
        <td>${lastCell(f, a)}</td>
      </tr>`).join('')}
    </tbody>`;
  }).join('');

  main.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>All furnaces</h1><p class="sub">${fmtDate(from)} to ${fmtDate(to)} · ${gs.map(g => `${inGroup(g).length} ${g}`).join(' and ')} · figures in ${esc(unit())}</p></div>
    ${rangeControl()}
  </div>
  ${switcher()}
  ${S.canWrite ? '' : '<div class="notice">You have view-only access.</div>'}
  ${libNotice()}
  <section class="figs">
    <div class="fig"><div class="k">Plant, month to date</div><div class="v">${fmt(plant.mtd)}<small>${esc(unit())}</small></div><div class="n">${pct(plant.mtd, plant.pmtd) || '–'} vs same days last month</div></div>
    ${figG}
    <div class="fig"><div class="k">Readings in today</div><div class="v">${readToday}<small>of ${act.length}</small></div><div class="n">${readToday < act.length && S.canWrite ? '<a href="#" id="toEntry">Enter today’s readings</a>' : fmtDate(t)}</div></div>
  </section>
  ${checkPanel()}
  ${recentPanel()}
  <div class="cols">
    <section class="panel">
      <div class="ph"><h2>Daily consumption, HF and TF</h2><div class="legend">${gs.map(g => `<span><i class="sw" style="background:${gColor(g)}"></i>${esc(g)}</span>`).join('')}</div></div>
      <div class="chart tall"><canvas id="cPlant" role="img" aria-label="Daily consumption stacked by HF and TF"></canvas></div>
    </section>
    <section class="panel">
      <div class="ph"><h2>Monthly, HF vs TF</h2><p>Last 13 months</p></div>
      <div class="chart tall"><canvas id="cMonthG" role="img" aria-label="Monthly totals for HF and TF"></canvas></div>
    </section>
  </div>
  <section class="panel">
    <div class="ph"><h2>Consumption by furnace</h2><p>Selected period · click a group or furnace to open it</p></div>
    <div class="tw"><table class="board">
      <thead><tr><th>Furnace</th><th class="num">Total</th><th>Share of group</th><th class="num">Avg / running day</th><th class="num">MTD vs last month</th><th class="num">Unusual days</th><th>Last reading</th></tr></thead>
      ${tableBody}
    </table></div>
  </section>
  <section class="panel">
    <div class="ph"><h2>Last 7 days to check</h2><p>${flagged.length ? flagged.length + ' flagged days' : 'Nothing unusual'} · ±${esc(S.settings.threshold)}% from each furnace’s ${esc(S.settings.window)}-day median</p></div>
    ${flagged.length ? `<div class="tw"><table><thead><tr><th>Furnace</th><th>Day</th><th class="num">Used</th><th class="num">Usual</th><th></th></tr></thead>
      ${gs.filter(g => flagged.some(x => x.g === g)).map(g => `<tbody class="grp"><tr class="gsum" style="--gc:${gColor(g)}"><td colspan="5"><strong>${esc(g)}</strong></td></tr>
        ${flagged.filter(x => x.g === g).sort((p, q) => p.f.order - q.f.order || (p.d < q.d ? 1 : -1)).map(({ f, d, r }) => `<tr class="click" data-fid="${esc(f.id)}"><td class="fcell">${esc(f.name)}</td><td>${weekday(d)} ${fmtDay(d)}</td><td class="num">${r.c == null ? '–' : fmt(r.c)}</td><td class="num">${fmt(r.base)}</td><td>${statusPill(r)}</td></tr>`).join('')}</tbody>`).join('')}
    </table></div>` : `<p class="muted">Every furnace stayed within its usual range over the last week.</p>`}
  </section>`;
  bindRange(main); bindSwitcher(main); bindRecent(main); bindCheck(main);
  $$('tr[data-fid]', main).forEach(tr => tr.addEventListener('click', () => go('furnace', tr.dataset.fid)));
  $$('tr[data-group]', main).forEach(tr => tr.addEventListener('click', () => { S.group = tr.dataset.group; go('group'); }));
  const te = $('#toEntry'); te && te.addEventListener('click', e => { e.preventDefault(); S.entryDate = todayISO(); go('entry'); });

  const labels = G[0] ? G[0].daily.map(x => x.d) : [];
  const opt = chartBase();
  opt.scales.x.stacked = true; opt.scales.y.stacked = true;
  opt.scales.x.ticks.callback = v => fmtDay(labels[v]);
  opt.plugins.tooltip.callbacks = {
    title: it => `${weekday(labels[it[0].dataIndex])} ${fmtDate(labels[it[0].dataIndex])}`,
    label: it => ` ${it.dataset.label}: ${fmt(it.raw)} ${unit()} (${G[it.datasetIndex].daily[it.dataIndex].n} of ${G[it.datasetIndex].rows.length} reported)`,
    footer: it => `Plant: ${fmt(it.reduce((x, i) => x + (i.raw || 0), 0))} ${unit()}`,
  };
  mkChart($('#cPlant'), { type: 'line', data: { labels, datasets: G.map(x => ({ label: x.g, data: x.daily.map(d => d.sum), borderColor: gColor(x.g), backgroundColor: alpha(gColor(x.g), .28), fill: true, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: .2 })) }, options: opt });

  const mo = chartBase();
  mo.scales.x.ticks.callback = v => MON[+months[v].key.slice(5) - 1];
  mo.scales.x.ticks.maxTicksLimit = 13;
  mo.plugins.tooltip.callbacks = { title: it => fmtMonth(months[it[0].dataIndex].key) + (it[0].dataIndex === 12 ? ' (to date)' : ''), label: it => ` ${it.dataset.label}: ${fmt(it.raw)} ${unit()}` };
  mkChart($('#cMonthG'), { type: 'bar', data: { labels: months.map(m => m.key), datasets: G.map(x => ({ label: x.g, data: months.map(m => x.rows.reduce((s, r) => s + sumRange(r.a, m.from, m.to).total, 0)), backgroundColor: gColor(x.g), borderRadius: 2, barPercentage: .85, categoryPercentage: .8 })) }, options: mo });
}

/* =========================================================
   Group page — all HF (or all TF) compared
   ========================================================= */
function viewGroup(main) {
  const gs = groupsOf(activeFurnaces());
  if (!gs.includes(S.group)) S.group = gs[0];
  const g = S.group, list = inGroup(g), { from, to } = rangeBounds(), t = todayISO();
  const rows = rowsFor(list, from, to), tot = sumRows(rows);
  const plantTotal = activeFurnaces().reduce((x, f) => x + sumRange(analyse(f), from, to).total, 0);
  const daily = groupDaily(list, from, to), daysWith = daily.filter(d => d.sum != null).length;
  const readToday = list.filter(f => analyse(f).last?.date === t).length;
  const months = last13();
  const ranked = [...rows].sort((p, q) => q.s.total - p.s.total);
  const rankOf = new Map(ranked.map((r, i) => [r.f.id, i + 1]));
  const gi = gs.indexOf(g), prevG = gs[(gi - 1 + gs.length) % gs.length], nextG = gs[(gi + 1) % gs.length];

  main.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>${esc(groupName(g))}</h1><p class="sub">${list.length} furnaces compared · ${fmtDate(from)} to ${fmtDate(to)} · ${esc(unit())}</p></div>
    <div class="actions">${gs.length === 2 ? `<button class="btn" id="gNext" title="Switch group (← →)">Switch to ${esc(nextG)}</button>` : gs.length > 2 ? `<button class="btn" id="gPrev" title="Previous group (←)">‹ ${esc(prevG)}</button><button class="btn" id="gNext" title="Next group (→)">${esc(nextG)} ›</button>` : ''}<button class="btn" id="gCmp">Compare ${esc(g)} furnaces</button><button class="btn" id="gExp">Export ${esc(g)}</button></div>
  </div>
  ${switcher()}
  <div class="page-head" style="margin-top:-6px">${rangeControl()}</div>
  ${libNotice()}
  <section class="figs">
    <div class="fig gfig" style="--gc:${gColor(g)}"><div class="k">${esc(g)} used in period</div><div class="v">${fmt(tot.total)}<small>${esc(unit())}</small></div><div class="n">${plantTotal ? nf1.format(tot.total / plantTotal * 100) : 0}% of plant</div></div>
    <div class="fig"><div class="k">${esc(g)} average per day</div><div class="v">${fmt(daysWith ? tot.total / daysWith : null)}</div><div class="n">All ${list.length} furnaces combined</div></div>
    <div class="fig"><div class="k">Month to date</div><div class="v">${fmt(tot.mtd)}</div><div class="n">${pct(tot.mtd, tot.pmtd) || '–'} vs same days last month</div></div>
    <div class="fig"><div class="k">Readings in today</div><div class="v">${readToday}<small>of ${list.length}</small></div><div class="n">${tot.anomalies} unusual days in period</div></div>
  </section>
  <section class="panel">
    <div class="ph"><h2>Daily consumption by ${esc(g)} furnace</h2><p>Stacked · click a name in the legend to hide it</p></div>
    <div class="chart tall"><canvas id="cGDaily" role="img" aria-label="Daily consumption stacked by furnace"></canvas></div>
  </section>
  <section class="panel">
      <div class="ph"><h2>${esc(g)} furnaces side by side</h2><p>Selected period · click to open</p></div>
      <div class="tw"><table>
        <thead><tr><th>Furnace</th><th class="num">Rank</th><th class="num">Total</th><th>Share of ${esc(g)}</th><th class="num">Avg / running day</th><th class="num">Idle days</th><th class="num">Unusual</th><th>Last reading</th></tr></thead>
        <tbody>${rows.map(({ f, a, s }, i) => `<tr class="click" data-fid="${esc(f.id)}">
          <td class="fcell"><i class="gsw" style="background:${pal(i)}"></i>${esc(f.name)}</td>
          <td class="num muted">${rankOf.get(f.id)}</td>
          <td class="num">${fmt(s.total)}</td>
          <td><div class="sharebar"><div class="bar-bg"><div class="bar-in" style="width:${(s.total / Math.max(1, ...rows.map(r => r.s.total)) * 100).toFixed(1)}%;background:${pal(i)}"></div></div><span>${tot.total ? nf0.format(s.total / tot.total * 100) : 0}%</span></div></td>
          <td class="num">${fmt(s.avg)}</td>
          <td class="num">${s.n - s.running || ''}</td>
          <td class="num">${s.anomalies || ''}</td>
          <td>${lastCell(f, a)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
  </section>
  <section class="panel">
      <div class="ph"><h2>Monthly by ${esc(g)} furnace</h2><p>Last 13 months, stacked</p></div>
      <div class="chart"><canvas id="cGMonth" role="img" aria-label="Monthly totals stacked by furnace"></canvas></div>
  </section>`;
  bindRange(main); bindSwitcher(main);
  $$('tr[data-fid]', main).forEach(tr => tr.addEventListener('click', () => go('furnace', tr.dataset.fid)));
  $('#gPrev')?.addEventListener('click', () => stepGroup(-1));
  $('#gNext')?.addEventListener('click', () => stepGroup(1));
  $('#gExp').addEventListener('click', () => exportWorkbook(list));
  $('#gCmp').addEventListener('click', () => compareWith(list.map(f => f.id)));

  const labels = daily.map(x => x.d);
  const opt = chartBase();
  opt.scales.x.stacked = true; opt.scales.y.stacked = true;
  opt.scales.x.ticks.callback = v => fmtDay(labels[v]);
  opt.plugins.legend = { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: false, padding: 14 } };
  opt.plugins.tooltip.itemSort = (a, b) => (b.raw || 0) - (a.raw || 0);
  opt.plugins.tooltip.filter = it => it.raw != null;
  opt.plugins.tooltip.callbacks = {
    title: it => `${weekday(labels[it[0].dataIndex])} ${fmtDate(labels[it[0].dataIndex])}`,
    label: it => ` ${it.dataset.label}: ${fmt(it.raw)}`,
    footer: it => `${g} total: ${fmt(it.reduce((x, i) => x + (i.raw || 0), 0))} ${unit()}`,
  };
  const ds = rows.map(({ f, a }, i) => ({ label: f.name, data: labels.map(d => { const r = a.daily.get(d); return r && r.c != null ? r.c : null; }), backgroundColor: pal(i), borderWidth: 0, barPercentage: 1, categoryPercentage: .92 }));
  mkChart($('#cGDaily'), { type: 'bar', data: { labels, datasets: ds }, options: opt });

  const mo = chartBase();
  mo.scales.x.stacked = true; mo.scales.y.stacked = true;
  mo.scales.x.ticks.callback = v => MON[+months[v].key.slice(5) - 1];
  mo.scales.x.ticks.maxTicksLimit = 13;
  mo.plugins.tooltip.itemSort = (a, b) => (b.raw || 0) - (a.raw || 0);
  mo.plugins.tooltip.callbacks = { title: it => fmtMonth(months[it[0].dataIndex].key) + (it[0].dataIndex === 12 ? ' (to date)' : ''), label: it => ` ${it.dataset.label}: ${fmt(it.raw)}`, footer: it => `${g} total: ${fmt(it.reduce((x, i) => x + (i.raw || 0), 0))}` };
  mkChart($('#cGMonth'), { type: 'bar', data: { labels: months.map(m => m.key), datasets: rows.map(({ f, a }, i) => ({ label: f.name, data: months.map(m => sumRange(a, m.from, m.to).total), backgroundColor: pal(i), borderWidth: 0 })) }, options: mo });
}

/* =========================================================
   Compare — two or more furnaces, each in its own colour
   ========================================================= */
const CMP_MAX = 12;
function lsJSON(k, d) { try { return JSON.parse(lsGet(k) || 'null') ?? d; } catch { return d; } }
S.cmp = lsJSON('midal-gas-cmp', []);
S.cmpColors = lsJSON('midal-gas-cmp-colors', {});
S.cmpMode = lsGet('midal-gas-cmp-mode') || 'avg7';
S.cmpScale = lsGet('midal-gas-cmp-scale') || 'actual';
function saveCmp() { lsSet('midal-gas-cmp', JSON.stringify(S.cmp)); lsSet('midal-gas-cmp-colors', JSON.stringify(S.cmpColors)); lsSet('midal-gas-cmp-mode', S.cmpMode); lsSet('midal-gas-cmp-scale', S.cmpScale); }
function cmpList() { const ids = new Set(activeFurnaces().map(f => f.id)); S.cmp = S.cmp.filter(id => ids.has(id)); return S.cmp.map(furnace); }
function cmpColor(f) {
  if (S.cmpColors[f.id]) return S.cmpColors[f.id];
  const used = new Set(S.cmp.map(id => S.cmpColors[id]).filter(Boolean));
  const i = Math.max(0, S.cmp.indexOf(f.id));
  // first palette colour not already taken by a custom choice
  let k = i; for (let n = 0; n < PALETTE.length && used.has(pal(k)); n++) k++;
  return pal(k);
}
function compareWith(ids) { S.cmp = [...new Set(ids)].slice(0, CMP_MAX); saveCmp(); go('compare'); }

function viewCompare(main) {
  const sel = cmpList(), act = activeFurnaces(), { from, to } = rangeBounds();
  const selSet = new Set(S.cmp);
  const picker = groupsOf(act).map(g => `<div class="pk-grp">
      <span class="pk-g" style="--gc:${gColor(g)}">${esc(g)}</span>
      ${inGroup(g).map(f => { const on = selSet.has(f.id); return `<button class="pk ${on ? 'on' : ''}" data-pick="${esc(f.id)}" aria-pressed="${on}" ${on ? `style="--c:${cmpColor(f)}"` : ''}>${esc(shortName(f))}</button>`; }).join('')}
      <button class="btn small ghost" data-pickgroup="${esc(g)}">All ${esc(g)}</button>
    </div>`).join('');

  const head = `
  <div class="page-head">
    <div class="grow"><h1>Compare furnaces</h1><p class="sub">Pick two or more furnaces — HF, TF or a mix. Each keeps its colour on every chart; click a swatch to change it.</p></div>
    ${rangeControl()}
  </div>
  <section class="panel picker">
    <div class="pk-row">${picker}</div>
    <div class="pk-foot"><span class="muted">${sel.length} selected${sel.length >= CMP_MAX ? ` (maximum ${CMP_MAX})` : ''}</span>${sel.length ? '<button class="btn small" id="pkClear">Clear</button>' : ''}</div>
  </section>`;

  if (sel.length < 2) {
    main.innerHTML = head + `<div class="empty" style="margin-top:8px"><h1 style="font-size:22px">Pick at least two furnaces</h1><p>Tap numbers above, or use “All HF” / “All TF” to compare a whole group.</p></div>`;
    bindCompare(main); return;
  }

  // ---------- data ----------
  const labels = []; for (let d = from; d <= to; d = addDays(d, 1)) labels.push(d);
  const data = sel.map(f => {
    const a = analyse(f), s = sumRange(a, from, to);
    const daily = labels.map(d => { const r = a.daily.get(d); return r && r.c != null ? r.c : null; });
    const avg7 = daily.map((_, i) => { const w = daily.slice(Math.max(0, i - 6), i + 1).filter(v => v != null); return w.length >= 4 ? w.reduce((x, y) => x + y, 0) / w.length : null; });
    const days = daily.filter(v => v != null).length;
    const mean = days ? s.total / days : null;
    let run = 0; const cum = daily.map(v => { if (v != null) run += v; return v == null && !run ? null : run; });
    return { f, a, s, daily, avg7, mean, cum, color: cmpColor(f) };
  });
  const selTotal = data.reduce((x, d) => x + d.s.total, 0);
  const months = last13();
  const monthly = data.map(d => months.map(m => sumRange(d.a, m.from, m.to).total));
  const idx = S.cmpScale === 'index';
  const series = d => { const src = S.cmpMode === 'daily' ? d.daily : d.avg7; return idx ? src.map(v => v == null || !d.mean ? null : v / d.mean * 100) : src; };
  const mixed = new Set(sel.map(groupOf)).size > 1;

  main.innerHTML = head + `
  ${libNotice()}
  <section class="panel">
    <div class="ph"><h2>Daily consumption</h2>
      <div class="range">
        <div class="seg" role="group" aria-label="Smoothing"><button data-mode="daily" aria-pressed="${S.cmpMode === 'daily'}">Daily</button><button data-mode="avg7" aria-pressed="${S.cmpMode === 'avg7'}">7-day average</button></div>
        <div class="seg" role="group" aria-label="Scale"><button data-scale="actual" aria-pressed="${!idx}">${esc(unit())}</button><button data-scale="index" aria-pressed="${idx}" title="Each furnace shown against its own average for the period (100 = its average day)">Index</button></div>
      </div>
    </div>
    ${idx ? `<p class="muted" style="margin:-4px 0 12px;font-size:13px">Index: 100 = each furnace’s own average day in this period. Use it to compare patterns when furnaces differ in size${mixed ? ', like HF against TF' : ''}.</p>` : ''}
    <div class="chart tall"><canvas id="cCmp" role="img" aria-label="Daily consumption for the selected furnaces"></canvas></div>
    <div class="legend big">${data.map(d => `<span><i class="sw" style="background:${d.color}"></i>${esc(d.f.name)}</span>`).join('')}</div>
  </section>

  <section class="panel">
    <div class="ph"><h2>Side by side</h2><p>${fmtDate(from)} to ${fmtDate(to)} · click a name to open it</p></div>
    <div class="tw"><table class="cmp-t">
      <thead><tr><th>Colour</th><th>Furnace</th><th class="num">Total</th><th>Share of selection</th><th class="num">Avg / running day</th><th class="num">Peak day</th><th class="num">Running</th><th class="num">Idle</th><th class="num">Unusual</th><th class="num">MTD vs last month</th><th></th></tr></thead>
      <tbody>${data.map(d => { const m = monthToDate(d.a); return `<tr>
        <td><label class="swpick" title="Change colour" style="--c:${d.color}"><input type="color" value="${toHex(d.color)}" data-color="${esc(d.f.id)}" aria-label="Colour for ${esc(d.f.name)}"></label></td>
        <td class="fname"><a href="#" data-open="${esc(d.f.id)}">${esc(d.f.name)}</a> <span class="muted">${esc(groupOf(d.f))}</span></td>
        <td class="num"><strong>${fmt(d.s.total)}</strong></td>
        <td><div class="sharebar"><div class="bar-bg"><div class="bar-in" style="width:${selTotal ? (d.s.total / Math.max(...data.map(x => x.s.total)) * 100).toFixed(1) : 0}%;background:${d.color}"></div></div><span>${selTotal ? nf0.format(d.s.total / selTotal * 100) : 0}%</span></div></td>
        <td class="num">${fmt(d.s.avg)}</td>
        <td class="num">${d.s.maxD ? `${fmt(d.s.max)} <span class="muted">${fmtDay(d.s.maxD)}</span>` : '–'}</td>
        <td class="num">${d.s.running}</td>
        <td class="num">${d.s.n - d.s.running}</td>
        <td class="num">${d.s.anomalies || ''}</td>
        <td class="num">${pct(m.cur.total, m.prev.total) || '–'}</td>
        <td class="num"><button class="btn small ghost" data-remove="${esc(d.f.id)}" aria-label="Remove ${esc(d.f.name)}">Remove</button></td>
      </tr>`; }).join('')}</tbody>
    </table></div>
  </section>

  <div class="cols">
    <section class="panel">
      <div class="ph"><h2>Monthly totals</h2><p>Last 13 months, side by side</p></div>
      <div class="chart tall"><canvas id="cCmpM" role="img" aria-label="Monthly totals side by side"></canvas></div>
    </section>
    <section class="panel">
      <div class="ph"><h2>Average per running day</h2><p>Selected period</p></div>
      <div class="chart tall"><canvas id="cCmpA" role="img" aria-label="Average per running day"></canvas></div>
    </section>
  </div>
  <section class="panel">
    <div class="ph"><h2>Running total over the period</h2><p>Where the lines pull apart is where one furnace used more</p></div>
    <div class="chart"><canvas id="cCmpC" role="img" aria-label="Cumulative consumption"></canvas></div>
  </section>`;
  bindCompare(main);

  // ---------- charts ----------
  const o = chartBase();
  o.scales.x.ticks.callback = v => fmtDay(labels[v]);
  if (idx) { o.scales.y.beginAtZero = true; o.scales.y.ticks.callback = v => v; }
  o.plugins.tooltip.itemSort = (p, q) => (q.raw || 0) - (p.raw || 0);
  o.plugins.tooltip.filter = it => it.raw != null;
  o.plugins.tooltip.callbacks = {
    title: it => `${weekday(labels[it[0].dataIndex])} ${fmtDate(labels[it[0].dataIndex])}`,
    label: it => idx ? ` ${it.dataset.label}: ${nf0.format(it.raw)} (${fmt(data[it.datasetIndex].daily[it.dataIndex])} ${unit()})` : ` ${it.dataset.label}: ${fmt(it.raw)} ${unit()}${S.cmpMode === 'avg7' ? ' (7-day avg)' : ''}`,
  };
  mkChart($('#cCmp'), { type: 'line', data: { labels, datasets: data.map(d => ({ label: d.f.name, data: series(d), borderColor: d.color, backgroundColor: d.color, borderWidth: S.cmpMode === 'daily' ? 1.4 : 2.2, pointRadius: 0, pointHoverRadius: 4, tension: .25, spanGaps: S.cmpMode !== 'daily' })) }, options: o, plugins: idx ? [hundredLine] : [] });

  const mo = chartBase();
  mo.scales.x.ticks.callback = v => MON[+months[v].key.slice(5) - 1];
  mo.scales.x.ticks.maxTicksLimit = 13;
  mo.plugins.tooltip.itemSort = (p, q) => (q.raw || 0) - (p.raw || 0);
  mo.plugins.tooltip.callbacks = { title: it => fmtMonth(months[it[0].dataIndex].key) + (it[0].dataIndex === 12 ? ' (to date)' : ''), label: it => ` ${it.dataset.label}: ${fmt(it.raw)} ${unit()}` };
  mkChart($('#cCmpM'), { type: 'bar', data: { labels: months.map(m => m.key), datasets: data.map((d, i) => ({ label: d.f.name, data: monthly[i], backgroundColor: d.color, borderRadius: 2, barPercentage: .9, categoryPercentage: .8 })) }, options: mo });

  const ao = chartBase();
  ao.indexAxis = 'y';
  ao.interaction = { mode: 'nearest', intersect: true };
  ao.scales = { x: { beginAtZero: true, grid: { color: css('--line') }, border: { display: false }, ticks: { callback: v => compact(v), maxTicksLimit: 6 } }, y: { grid: { display: false }, border: { color: css('--line-strong') } } };
  ao.plugins.tooltip.callbacks = { label: it => ` ${fmt(it.raw)} ${unit()} per running day` };
  mkChart($('#cCmpA'), { type: 'bar', data: { labels: data.map(d => d.f.name), datasets: [{ data: data.map(d => d.s.avg || 0), backgroundColor: data.map(d => d.color), borderRadius: 3, barPercentage: .7 }] }, options: ao });

  const co = chartBase();
  co.scales.x.ticks.callback = v => fmtDay(labels[v]);
  co.plugins.tooltip.itemSort = (p, q) => (q.raw || 0) - (p.raw || 0);
  co.plugins.tooltip.callbacks = { title: it => fmtDate(labels[it[0].dataIndex]), label: it => ` ${it.dataset.label}: ${fmt(it.raw)} ${unit()} so far` };
  mkChart($('#cCmpC'), { type: 'line', data: { labels, datasets: data.map(d => ({ label: d.f.name, data: d.cum, borderColor: d.color, backgroundColor: d.color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .1 })) }, options: co });
}
const hundredLine = { id: 'hundred', afterDraw(c) { const y = c.scales.y; if (!y) return; const py = y.getPixelForValue(100); const { left, right } = c.chartArea; const g = c.ctx; g.save(); g.strokeStyle = css('--muted'); g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(left, py); g.lineTo(right, py); g.stroke(); g.restore(); } };
function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = String(c).match(/\d+/g); if (!m) return '#0b109f';
  return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
}
function bindCompare(main) {
  bindRange(main);
  $$('[data-pick]', main).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.pick;
    if (S.cmp.includes(id)) S.cmp = S.cmp.filter(x => x !== id);
    else if (S.cmp.length >= CMP_MAX) { toast(`Compare up to ${CMP_MAX} at a time.`, true); return; }
    else S.cmp.push(id);
    saveCmp(); render(true);
  }));
  $$('[data-pickgroup]', main).forEach(b => b.addEventListener('click', () => { S.cmp = inGroup(b.dataset.pickgroup).map(f => f.id).slice(0, CMP_MAX); saveCmp(); render(true); }));
  $('#pkClear', main)?.addEventListener('click', () => { S.cmp = []; saveCmp(); render(true); });
  $$('[data-mode]', main).forEach(b => b.addEventListener('click', () => { S.cmpMode = b.dataset.mode; saveCmp(); render(true); }));
  $$('[data-scale]', main).forEach(b => b.addEventListener('click', () => { S.cmpScale = b.dataset.scale; saveCmp(); render(true); }));
  $$('[data-remove]', main).forEach(b => b.addEventListener('click', () => { S.cmp = S.cmp.filter(x => x !== b.dataset.remove); saveCmp(); render(true); }));
  $$('[data-open]', main).forEach(a => a.addEventListener('click', e => { e.preventDefault(); go('furnace', a.dataset.open); }));
  $$('[data-color]', main).forEach(inp => inp.addEventListener('change', () => { S.cmpColors[inp.dataset.color] = inp.value; saveCmp(); render(true); }));
}

/* =========================================================
   Shared bits
   ========================================================= */
function rangeControl() {
  const opts = [['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All'], ['custom', 'Custom']];
  const { from, to } = rangeBounds();
  return `<div class="range">
    <div class="seg" role="group" aria-label="Period">${opts.map(([k, l]) => `<button data-range="${k}" aria-pressed="${S.range === k}">${l}</button>`).join('')}</div>
    ${S.range === 'custom' ? `<span class="custom"><input type="date" id="rgFrom" value="${from}" aria-label="From"> to <input type="date" id="rgTo" value="${to}" aria-label="To"></span>` : ''}
  </div>`;
}
function bindRange(root) {
  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.range === 'custom' && S.range !== 'custom') { const r = rangeBounds(); S.from = r.from; S.to = r.to; }
    S.range = b.dataset.range; render(true);
  }));
  const f = $('#rgFrom', root), t = $('#rgTo', root);
  f && f.addEventListener('change', () => { if (f.value) { S.from = f.value; render(true); } });
  t && t.addEventListener('change', () => { if (t.value) { S.to = t.value; render(true); } });
}
function pct(cur, prev) {
  if (!prev) return '';
  const p = (cur - prev) / prev * 100;
  const cls = p > 0.5 ? 'up' : p < -0.5 ? 'down' : '';
  return `<span class="${cls}">${p > 0 ? '+' : ''}${nf1.format(p)}%</span>`;
}
const statusLabel = { ok: 'Normal', high: 'High', low: 'Low', idle: 'Idle', est: 'Spread', drop: 'Meter drop' };
function statusPill(r) {
  if (!r) return '';
  return `<span class="pill ${r.status}">${statusLabel[r.status] || ''}</span>`;
}
function chartBase() {
  Chart.defaults.font.family = "Lato, 'Segoe UI', Arial, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css('--ink'), titleColor: css('--surface'), bodyColor: css('--surface'), padding: 10, cornerRadius: 6, displayColors: true, boxPadding: 4 } },
    scales: {
      x: { grid: { display: false }, border: { color: css('--line-strong') }, ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 10 } },
      y: { beginAtZero: true, grid: { color: css('--line') }, border: { display: false }, ticks: { callback: v => compact(v), maxTicksLimit: 6 } },
    },
  };
}
function mkChart(canvas, cfg) { if (!window.Chart || !canvas) return; const c = new Chart(canvas, cfg); S.charts.push(c); return c; }
function alpha(hex, a) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function libNotice() { return window.Chart ? '' : '<div class="notice warn">Charts could not load. Check the internet connection and reload.</div>'; }

/* =========================================================
   Empty state
   ========================================================= */
function viewEmpty() {
  const ro = !S.canWrite;
  setTimeout(() => {
    const q = $('#quickHT'); q && q.addEventListener('submit', async e => {
      e.preventDefault();
      const nh = Math.max(0, Math.min(60, Math.round(+$('#qHF').value || 0))), nt = Math.max(0, Math.min(60, Math.round(+$('#qTF').value || 0)));
      if (!nh && !nt) { toast('Enter how many HF and TF furnaces you have.', true); return; }
      let order = 0;
      for (let i = 1; i <= nh; i++) await saveFurnace({ id: newId('f'), name: 'HF ' + i, code: 'HF' + i, group: 'HF', mode: 'meter', active: true, order: ++order });
      for (let i = 1; i <= nt; i++) await saveFurnace({ id: newId('f'), name: 'TF ' + i, code: 'TF' + i, group: 'TF', mode: 'meter', active: true, order: ++order });
      toast(`Created ${nh} HF and ${nt} TF furnaces`);
    });
    const im = $('#goImport'); im && im.addEventListener('click', () => go('data'));
  });
  return `<div class="empty">
    <h1>Start with your furnace data</h1>
    <p>Import the Excel sheet you already keep — HF and TF furnaces are created from its column names — or set them up here first.</p>
    ${ro ? '<p>You have view-only access. Ask the owner to add the furnaces.</p>' : `<div class="actions"><button class="btn primary" id="goImport">Import Excel sheet</button></div>
    <form id="quickHT" class="addrow" style="justify-content:center;margin-top:24px">
      <label class="f">HF furnaces<input type="number" id="qHF" min="0" max="60" value="9" style="width:90px"></label>
      <label class="f">TF furnaces<input type="number" id="qTF" min="0" max="60" value="9" style="width:90px"></label>
      <button class="btn" type="submit">Create HF 1… and TF 1…</button>
    </form>`}
  </div>`;
}

/* =========================================================
   Furnace detail
   ========================================================= */
function viewFurnace(main) {
  const f = furnace(S.fid);
  if (!f) { S.view = 'overview'; return viewOverview(main); }
  const a = analyse(f), { from, to } = rangeBounds(), s = sumRange(a, from, to), m = monthToDate(a);
  const labels = [], vals = [], base = [], colors = [];
  const brand = css('--brand'), amber = css('--amber'), idle = css('--idle'), red = css('--red');
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = a.daily.get(d);
    labels.push(d); vals.push(r && r.c != null ? r.c : null); base.push(r ? r.base ?? null : null);
    colors.push(!r ? brand : r.status === 'high' || r.status === 'low' ? amber : r.status === 'est' ? alpha(brand, .35) : r.status === 'idle' ? idle : r.status === 'drop' ? red : brand);
  }
  // monthly totals, last 13 months
  const t = todayISO(); const mLabels = [], mVals = [];
  let [y, mo] = t.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 13; i++) { months.unshift(ymd(y, mo, 1)); mo--; if (!mo) { mo = 12; y--; } }
  months.forEach((m0, i) => {
    const end = i < 12 ? addDays(months[i + 1], -1) : t;
    mLabels.push(m0.slice(0, 7)); mVals.push(sumRange(a, m0, end).total);
  });
  // readings table month
  const monthsWithData = [...new Set(a.entries.map(e => e.date.slice(0, 7)))].sort().reverse();
  if (!S.tableMonth || S.tableFid !== f.id || !monthsWithData.includes(S.tableMonth)) { S.tableMonth = monthsWithData[0] || t.slice(0, 7); S.tableFid = f.id; }
  const tm = S.tableMonth;
  const tRows = a.entries.filter(e => e.date.startsWith(tm)).reverse();
  const last = a.last;

  const g = groupOf(f), peers = inGroup(g);
  const peerTotals = peers.map(p => ({ id: p.id, t: sumRange(analyse(p), from, to).total })).sort((x, y) => y.t - x.t);
  const gTotal = peerTotals.reduce((x, p) => x + p.t, 0);
  const rank = peerTotals.findIndex(p => p.id === f.id) + 1;
  const ord = activeFurnaces(), oi = ord.findIndex(x => x.id === f.id);
  const prevF = ord.length > 1 ? ord[(oi - 1 + ord.length) % ord.length] : null, nextF = ord.length > 1 ? ord[(oi + 1) % ord.length] : null;
  main.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>${esc(f.name)}</h1><p class="sub"><a href="#" id="toGroup">${esc(groupName(g))}</a>${peers.length > 1 && gTotal ? ` · ${nf1.format(sumRange(a, from, to).total / gTotal * 100)}% of ${esc(g)} use, ranked ${rank} of ${peers.length}` : ''} · ${a.meter ? 'meter readings' : 'daily consumption'} · ${esc(unit())}</p></div>
    <div class="actions">${prevF ? `<button class="btn" id="fPrev" title="Previous furnace (←)">‹ ${esc(prevF.name)}</button><button class="btn" id="fNext" title="Next furnace (→)">${esc(nextF.name)} ›</button>` : ''}${S.canWrite ? `<button class="btn primary" id="addR">Add reading</button>` : ''}<button class="btn" id="cmpF">Compare with…</button><button class="btn" id="expF">Export</button></div>
  </div>
  ${switcher()}
  <div class="page-head" style="margin-top:-6px">${rangeControl()}</div>
  ${libNotice()}
  <section class="figs">
    <div class="fig"><div class="k">Used in period</div><div class="v">${fmt(s.total)}<small>${esc(unit())}</small></div><div class="n">${s.n} days with data${s.est ? `, ${s.est} spread over gaps` : ''}</div></div>
    <div class="fig"><div class="k">Average per running day</div><div class="v">${fmt(s.avg)}</div><div class="n">${s.running} running · ${s.n - s.running} idle days</div></div>
    <div class="fig"><div class="k">Month to date</div><div class="v">${fmt(m.cur.total)}</div><div class="n">${pct(m.cur.total, m.prev.total) || '–'} vs same days last month</div></div>
    <div class="fig"><div class="k">Last reading</div><div class="v">${last ? fmt(last.v, 2) : '–'}</div><div class="n">${last ? `${weekday(last.date)} ${fmtDate(last.date)}${diffDays(last.date, t) > 0 ? ` · ${diffDays(last.date, t)} day${diffDays(last.date, t) > 1 ? 's' : ''} ago` : ' · today'}` : 'No readings yet'}</div></div>
  </section>
  <section class="panel">
    <div class="ph"><h2>Daily consumption</h2>
      <div class="legend"><span><i class="sw" style="background:${brand}"></i>Normal</span><span><i class="sw" style="background:${amber}"></i>Unusual (±${esc(S.settings.threshold)}%)</span><span><i class="sw" style="background:${alpha(brand, .35)}"></i>Spread over a missed day</span>${a.meter ? `<span><i class="sw" style="background:${red}"></i>Meter drop</span>` : ''}<span><i class="sw line"></i>${esc(S.settings.window)}-day median</span></div>
    </div>
    ${s.n ? `<div class="chart tall"><canvas id="cDaily" role="img" aria-label="Daily consumption chart for ${esc(f.name)}"></canvas></div>` : `<p class="muted">No consumption in this period.${a.meter && a.entries.length === 1 ? ' One meter reading is stored — consumption appears once the next reading is in.' : ''}</p>`}
    ${s.drops ? `<p class="notice warn" style="margin:14px 0 0">${s.drops} reading${s.drops > 1 ? 's are' : ' is'} lower than the reading before. Check for a typo or a meter change in the table below.</p>` : ''}
  </section>
  <div class="cols">
    <section class="panel">
      <div class="ph"><h2>Readings</h2>
        <select id="tMonth" aria-label="Month">${(monthsWithData.length ? monthsWithData : [tm]).map(x => `<option value="${x}" ${x === tm ? 'selected' : ''}>${fmtMonth(x)}</option>`).join('')}</select>
      </div>
      ${tRows.length ? `<div class="tw"><table>
        <thead><tr><th>Date</th><th class="num">${a.meter ? 'Meter reading' : 'Entered'}</th><th class="num">Used</th><th></th><th>Note</th>${S.canWrite ? '<th></th>' : ''}</tr></thead>
        <tbody>${tRows.map(e => { const r = a.daily.get(e.date); return `<tr>
          <td>${weekday(e.date)} ${fmtDay(e.date)}</td>
          <td class="num"><strong>${fmt(e.v, 2)}</strong></td>
          <td class="num">${r && r.c != null ? fmt(r.c) + (r.span > 1 ? ` <span class="muted">/day</span>` : '') : a.meter && e === a.entries[0] ? '<span class="muted">First</span>' : '–'}</td>
          <td>${r ? statusPill(r) : ''}${r && r.base && (r.status === 'high' || r.status === 'low') ? ` <span class="muted">usual ${fmt(r.base)}</span>` : ''}</td>
          <td class="muted">${esc(e.note)}${e.by ? `${e.note ? ' · ' : ''}${esc(e.by)}` : ''}</td>
          ${S.canWrite ? `<td class="num"><button class="btn small ghost" data-edit="${e.date}">Edit</button></td>` : ''}
        </tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">No readings this month.</p>'}
    </section>
    <section class="panel">
      <div class="ph"><h2>Monthly totals</h2><p>Last 13 months</p></div>
      <div class="chart"><canvas id="cMonthly" role="img" aria-label="Monthly totals chart"></canvas></div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Peak day in period: ${s.maxD ? `${fmt(s.max)} on ${fmtDate(s.maxD)}` : '–'}</p>
    </section>
  </div>`;
  bindRange(main); bindSwitcher(main);
  $('#fPrev')?.addEventListener('click', () => stepFurnace(-1));
  $('#fNext')?.addEventListener('click', () => stepFurnace(1));
  $('#toGroup').addEventListener('click', e => { e.preventDefault(); S.group = g; go('group'); });
  $('#tMonth').addEventListener('change', e => { S.tableMonth = e.target.value; render(true); });
  const ab = $('#addR'); ab && ab.addEventListener('click', () => openReading(f.id, null));
  $$('[data-edit]', main).forEach(b => b.addEventListener('click', () => openReading(f.id, b.dataset.edit)));
  $('#expF').addEventListener('click', () => exportWorkbook([f]));
  $('#cmpF').addEventListener('click', () => compareWith([f.id, ...S.cmp.filter(x => x !== f.id)]));

  if (s.n) {
    const opt = chartBase();
    opt.scales.x.ticks.callback = v => fmtDay(labels[v]);
    opt.plugins.tooltip.filter = it => it.raw != null;
    opt.plugins.tooltip.callbacks = {
      title: it => `${weekday(labels[it[0].dataIndex])} ${fmtDate(labels[it[0].dataIndex])}`,
      label: it => { const r = a.daily.get(labels[it.dataIndex]); if (it.datasetIndex === 1) return ` Usual: ${fmt(it.raw)}`; return ` Used: ${fmt(it.raw)} ${unit()}${r && r.status !== 'ok' ? ' · ' + statusLabel[r.status] : ''}`; },
    };
    mkChart($('#cDaily'), { type: 'bar', data: { labels, datasets: [
      { type: 'bar', data: vals, backgroundColor: colors, borderRadius: 2, barPercentage: .92, categoryPercentage: 1, order: 2 },
      { type: 'line', data: base, borderColor: css('--muted'), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: .3, spanGaps: true, order: 1 },
    ] }, options: opt });
  }
  const mo2 = chartBase();
  mo2.scales.x.ticks.callback = v => MON[+mLabels[v].slice(5) - 1];
  mo2.scales.x.ticks.maxTicksLimit = 13;
  mo2.plugins.tooltip.callbacks = { title: it => fmtMonth(mLabels[it[0].dataIndex]) + (it[0].dataIndex === 12 ? ' (to date)' : ''), label: it => ` ${fmt(it.raw)} ${unit()}` };
  mkChart($('#cMonthly'), { type: 'bar', data: { labels: mLabels, datasets: [{ data: mVals, backgroundColor: mLabels.map((_, i) => i === 12 ? alpha(brand, .4) : brand), borderRadius: 3 }] }, options: mo2 });
}

/* =========================================================
   Daily entry (supervisor)
   ========================================================= */
function baselineBefore(a, date) {
  const win = +S.settings.window || 30, vals = [];
  for (let i = a.days.length - 1; i >= 0 && vals.length < win; i--) {
    const d = a.days[i]; if (d >= date) continue;
    const r = a.daily.get(d); if (r.c > 0) vals.push(r.c);
  }
  return vals.length >= 7 ? median(vals) : null;
}
function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s]/g, '').replace(/[^0-9.\-eE]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s); return isFinite(n) ? n : null;
}
function entryCalc(f, date, str) {
  const a = analyse(f);
  let prev = null;
  for (let i = a.entries.length - 1; i >= 0; i--) if (a.entries[i].date < date) { prev = a.entries[i]; break; }
  const raw = String(str ?? '').trim();
  if (!raw) return { prev, v: null };
  const v = parseNum(raw);
  if (v == null) return { prev, err: 'Enter a number' };
  let used = null, gap = 1, warn = '', err = '';
  if (a.meter) {
    if (prev) {
      gap = diffDays(prev.date, date);
      if (v < prev.v) err = `Lower than ${fmt(prev.v, 2)} on ${fmtDay(prev.date)}`;
      else used = (v - prev.v) / gap;
    }
  } else used = v;
  if (used != null) {
    const b = baselineBefore(a, date), thr = +S.settings.threshold || 40;
    if (b > 0 && used > 0 && Math.abs(used - b) / b * 100 > thr) warn = `${used > b ? '+' : ''}${nf0.format((used - b) / b * 100)}% vs usual ${fmt(b)}`;
  }
  return { prev, v, used, gap, warn, err };
}
function viewEntry(main) {
  const date = S.entryDate, act = activeFurnaces(), t = todayISO();
  if (S.draftDate !== date) loadDraft(date);
  const by = lsGet('midal-gas-by') || '';
  const filled = act.filter(f => entryAt(f.id, date)).length;
  main.innerHTML = `
  <div class="page-head">
    <div class="grow"><h1>Daily entry</h1><p class="sub">${weekday(date)} ${fmtDate(date)} · ${filled} of ${act.length} furnaces already saved for this day</p></div>
  </div>
  ${S.canWrite ? '' : '<div class="notice">You have view-only access, so readings can’t be saved. Ask the owner for Contributor access.</div>'}
  <div class="entry-bar">
    <label class="f">Reading date
      <span style="display:flex;gap:6px"><button class="btn small" id="dPrev" aria-label="Previous day">‹</button><input type="date" id="eDate" value="${date}" max="${t}"><button class="btn small" id="dNext" aria-label="Next day" ${date >= t ? 'disabled' : ''}>›</button>${date !== t ? '<button class="btn small" id="dToday">Today</button>' : ''}</span>
    </label>
    <label class="f">Entered by<input type="text" id="eBy" value="${esc(by)}" placeholder="Your name" style="width:200px"></label>
  </div>
  <section class="panel entry">
    <div class="tw"><table>
      <thead><tr><th>Furnace</th><th class="num">Previous reading</th><th class="num">Reading on ${fmtDay(date)}</th><th class="num">Used</th><th>Check</th><th style="min-width:180px">Note</th></tr></thead>
      <tbody class="grp">${act.map((f, i) => {
        const d = S.draft[f.id] || { v: '', note: '' };
        const g = groupOf(f), head = i === 0 || groupOf(act[i - 1]) !== g;
        return `${head ? `<tr class="gsum" style="--gc:${gColor(g)}"><td colspan="6"><strong>${esc(groupName(g))}</strong> <span class="muted">${inGroup(g).filter(x => entryAt(x.id, date)).length} of ${inGroup(g).length} saved</span></td></tr>` : ''}<tr data-row="${esc(f.id)}">
          <td><div class="fn">${esc(f.name)}</div><div class="fs">${f.mode === 'consumption' ? 'Daily consumption' : 'Meter reading'}</div></td>
          <td class="num prev"></td>
          <td class="num"><input class="val" id="v-${esc(f.id)}" data-fid="${esc(f.id)}" inputmode="decimal" autocomplete="off" value="${esc(d.v)}" ${S.canWrite ? '' : 'disabled'} aria-label="${esc(f.name)} reading"></td>
          <td class="num used"></td>
          <td class="chk"></td>
          <td><input class="note" id="n-${esc(f.id)}" data-fid="${esc(f.id)}" value="${esc(d.note)}" ${S.canWrite ? '' : 'disabled'} aria-label="${esc(f.name)} note"></td>
        </tr>`; }).join('')}</tbody>
    </table></div>
  </section>
  ${S.canWrite ? `<div class="savebar"><span id="eSummary" class="muted"></span><span class="actions"><button class="btn" id="eReset">Discard changes</button><button class="btn primary" id="eSave">Save readings</button></span></div>` : ''}`;
  refreshEntryRows();
  const setDate = async d => { if (!d) return; if (d > t) d = t; if (hasDraftChanges() && !await confirmBox({ title: 'Discard unsaved readings?', body: `Readings typed for ${fmtDate(S.entryDate)} haven’t been saved yet.`, ok: 'Discard', danger: true })) { render(true); return; } S.entryDate = d; S.draftDate = null; render(true); };
  $('#eDate').addEventListener('change', e => setDate(e.target.value));
  $('#dPrev').addEventListener('click', () => setDate(addDays(date, -1)));
  $('#dNext').addEventListener('click', () => setDate(addDays(date, 1)));
  const td = $('#dToday'); td && td.addEventListener('click', () => setDate(t));
  $('#eBy').addEventListener('input', e => lsSet('midal-gas-by', e.target.value.trim()));
  $$('input.val, input.note', main).forEach(inp => {
    inp.addEventListener('input', () => {
      const fid = inp.dataset.fid; S.draft[fid] = S.draft[fid] || { v: '', note: '' };
      S.draft[fid][inp.classList.contains('val') ? 'v' : 'note'] = inp.value;
      refreshEntryRows(fid);
    });
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const cls = inp.classList.contains('val') ? 'input.val' : 'input.note';
      const all = $$(cls, main), i = all.indexOf(inp);
      if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select(); } else $('#eSave')?.focus();
    });
  });
  const rs = $('#eReset'); rs && rs.addEventListener('click', () => { S.draftDate = null; render(true); });
  const sv = $('#eSave'); sv && sv.addEventListener('click', saveEntry);
}
function loadDraft(date) {
  S.draft = {}; S.draftDate = date;
  activeFurnaces().forEach(f => { const e = entryAt(f.id, date); S.draft[f.id] = e ? { v: String(e.v), note: e.note || '', orig: e.v, origNote: e.note || '' } : { v: '', note: '' }; });
}
function draftChanges() {
  const out = [];
  for (const f of activeFurnaces()) {
    const d = S.draft[f.id]; if (!d) continue;
    const raw = String(d.v).trim(), v = raw ? parseNum(raw) : null;
    if (raw && v == null) { out.push({ f, bad: true }); continue; }
    if (v == null && d.orig == null) continue;
    if (v === d.orig && (d.note || '') === (d.origNote || '')) continue;
    out.push({ f, v, note: (d.note || '').trim(), remove: v == null });
  }
  return out;
}
function hasDraftChanges() { return S.view === 'entry' && draftChanges().length > 0; }
function refreshEntryRows(only) {
  const date = S.entryDate;
  $$('tr[data-row]').forEach(tr => {
    const fid = tr.dataset.row; if (only && only !== fid) return;
    const f = furnace(fid); if (!f) return;
    const d = S.draft[fid] || { v: '' };
    const c = entryCalc(f, date, d.v);
    tr.querySelector('.prev').innerHTML = f.mode === 'consumption' ? '<span class="muted">–</span>' : c.prev ? `${fmt(c.prev.v, 2)}<div class="fs">${fmtDay(c.prev.date)}</div>` : '<span class="muted">None</span>';
    tr.querySelector('.used').innerHTML = c.used != null ? `<strong>${fmt(c.used)}</strong>${c.gap > 1 ? `<div class="fs">per day over ${c.gap} days</div>` : ''}` : '';
    const chk = c.err ? `<span class="pill err">${esc(c.err)}</span>` : c.warn ? `<span class="pill warn">${esc(c.warn)}</span>` : c.v != null ? (f.mode !== 'consumption' && !c.prev ? '<span class="pill est">First reading</span>' : '<span class="pill ok">Looks normal</span>') : '';
    tr.querySelector('.chk').innerHTML = chk;
    tr.classList.toggle('filled', c.v != null && !c.err && !c.warn);
    tr.classList.toggle('has-warn', !!c.warn && !c.err);
    tr.classList.toggle('has-err', !!c.err);
  });
  const sum = $('#eSummary');
  if (sum) {
    const ch = draftChanges(), n = ch.filter(x => !x.bad && !x.remove).length, r = ch.filter(x => x.remove).length;
    sum.textContent = ch.length ? `${n} to save${r ? `, ${r} to remove` : ''}` : 'No unsaved changes';
    $('#eSave').disabled = !ch.length;
  }
}
async function saveEntry() {
  const ch = draftChanges();
  if (ch.some(x => x.bad)) { toast('Some readings are not numbers. Fix the highlighted rows.', true); return; }
  const drops = ch.filter(x => !x.remove && entryCalc(x.f, S.entryDate, String(x.v)).err);
  if (drops.length && !await confirmBox({ title: 'Save lower readings?', body: `${drops.map(x => x.f.name).join(', ')} ${drops.length > 1 ? 'are' : 'is'} lower than the previous reading. This is usually a typo or a meter change. Save anyway?`, ok: 'Save anyway' })) return;
  const removes = ch.filter(x => x.remove);
  if (removes.length && !await confirmBox({ title: `Remove ${removes.length} reading${removes.length > 1 ? 's' : ''}?`, body: `You cleared ${removes.map(x => x.f.name).join(', ')} for ${fmtDate(S.entryDate)}. Their saved readings for this day will be deleted.`, ok: 'Save and remove', danger: true })) return;
  const btn = $('#eSave'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const ok = await putEntries(ch.map(x => ({ fid: x.f.id, date: S.entryDate, v: x.remove ? null : x.v, note: x.note })));
  if (ok) {
    const n = ch.length - removes.length;
    toast(`Saved ${n} reading${n === 1 ? '' : 's'} for ${fmtDate(S.entryDate)}`);
    S.draftDate = null;
  }
  render(true);
}

/* =========================================================
   Reading dialog (add / edit single reading)
   ========================================================= */
const dlgR = $('#dlgReading');
let drCtx = null;
function openReading(fid, date) {
  if (!S.canWrite) return;
  const existing = date ? entryAt(fid, date) : null;
  drCtx = { fid, origDate: existing ? date : null };
  $('#drTitle').textContent = existing ? 'Edit reading' : 'Add reading';
  $('#drFurnace').innerHTML = S.furnaces.map(f => `<option value="${esc(f.id)}" ${f.id === fid ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  $('#drDate').value = date || todayISO(); $('#drDate').max = todayISO();
  $('#drVal').value = existing ? existing.v : '';
  $('#drNote').value = existing ? existing.note || '' : '';
  $('#drDelete').hidden = !existing;
  drHint();
  dlgR.showModal();
  setTimeout(() => $('#drVal').focus(), 30);
}
function drHint() {
  const f = furnace($('#drFurnace').value); if (!f) return;
  $('#drValLabel').textContent = f.mode === 'consumption' ? `Daily consumption (${unit()})` : 'Meter reading';
  const c = entryCalc(f, $('#drDate').value || todayISO(), $('#drVal').value);
  const parts = [];
  if (f.mode !== 'consumption') parts.push(c.prev ? `Previous: ${fmt(c.prev.v, 2)} on ${fmtDate(c.prev.date)}` : 'No earlier reading.');
  if (c.used != null) parts.push(`Used: ${fmt(c.used)} ${unit()}${c.gap > 1 ? ` per day over ${c.gap} days` : ''}`);
  if (c.err) parts.push(`⚠ ${c.err}`); else if (c.warn) parts.push(`⚠ ${c.warn}`);
  if (entryAt(f.id, $('#drDate').value) && $('#drDate').value !== drCtx?.origDate) parts.push('A reading already exists on this date and will be replaced.');
  $('#drHint').textContent = parts.join(' · ');
}
['#drFurnace', '#drDate', '#drVal'].forEach(s => $(s).addEventListener('input', drHint));
$('#drCancel').addEventListener('click', () => dlgR.close());
$('#formReading').addEventListener('submit', async e => {
  e.preventDefault();
  const fid = $('#drFurnace').value, date = $('#drDate').value, v = parseNum($('#drVal').value);
  if (!date || date > todayISO()) { toast('Pick a date up to today.', true); return; }
  if (v == null) { toast('Enter a number.', true); return; }
  const changes = [];
  if (drCtx.origDate && (drCtx.origDate !== date || drCtx.fid !== fid)) changes.push({ fid: drCtx.fid, date: drCtx.origDate, v: null });
  changes.push({ fid, date, v, note: $('#drNote').value.trim() });
  dlgR.close();
  if (await putEntries(changes)) toast(`Saved reading for ${fmtDate(date)}`);
});
$('#drDelete').addEventListener('click', async () => {
  const { fid, origDate } = drCtx; dlgR.close();
  if (!await confirmBox({ title: 'Delete this reading?', body: `${furnace(fid)?.name} on ${fmtDate(origDate)} will be removed.`, ok: 'Delete reading', danger: true })) return;
  if (await putEntries([{ fid, date: origDate, v: null }])) toast('Deleted reading');
});

/* =========================================================
   Confirm + toast
   ========================================================= */
function confirmBox({ title, body, ok = 'OK', danger = false, typeWord = '' }) {
  return new Promise(res => {
    const d = $('#dlgConfirm');
    $('#dcTitle').textContent = title; $('#dcBody').textContent = body;
    const okB = $('#dcOk'); okB.textContent = ok; okB.className = 'btn ' + (danger ? 'danger' : 'primary');
    const tw = $('#dcTypeWrap'), ti = $('#dcType');
    tw.hidden = !typeWord; ti.value = ''; $('#dcTypeLabel').textContent = `Type ${typeWord} to confirm`;
    okB.disabled = !!typeWord;
    ti.oninput = () => { okB.disabled = ti.value.trim() !== typeWord; };
    const done = v => { d.close(); res(v); };
    okB.onclick = () => done(true); $('#dcCancel').onclick = () => done(false);
    d.oncancel = () => res(false);
    d.showModal();
  });
}
let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', err ? 5000 : 2800);
}

/* =========================================================
   Furnaces & settings
   ========================================================= */
function viewManage(main) {
  const ro = !S.canWrite;
  const counts = new Map();
  for (const b of S.months.values()) counts.set(b.furnace, (counts.get(b.furnace) || 0) + Object.keys(b.days || {}).length);
  const dis = ro ? 'disabled' : '';
  main.innerHTML = `
  <div class="page-head"><div class="grow"><h1>Furnaces &amp; settings</h1><p class="sub">Changes save as you edit. Rename, group, reorder or retire furnaces at any time — readings stay attached.</p></div></div>
  ${ro ? '<div class="notice">You have view-only access.</div>' : ''}
  <section class="panel">
    <div class="ph"><h2>Furnaces</h2><p>${S.furnaces.length} total · ${activeFurnaces().length} active</p></div>
    <div class="tw"><table class="mg">
      <thead><tr><th>Order</th><th>Name</th><th>Code</th><th>Group</th><th>Values entered as</th><th>Active</th><th class="num">Readings</th><th></th></tr></thead>
      <tbody>${S.furnaces.map((f, i) => `<tr data-id="${esc(f.id)}">
        <td><span class="order"><button data-mv="-1" ${i === 0 || ro ? 'disabled' : ''} aria-label="Move up">↑</button><button data-mv="1" ${i === S.furnaces.length - 1 || ro ? 'disabled' : ''} aria-label="Move down">↓</button></span></td>
        <td><input class="nm" data-k="name" value="${esc(f.name)}" ${dis} aria-label="Name"></td>
        <td><input class="cd" data-k="code" value="${esc(f.code || '')}" ${dis} aria-label="Code"></td>
        <td><input class="gp" data-k="group" value="${esc(f.group || '')}" ${dis} placeholder="HF or TF" aria-label="Group" list="groups"></td>
        <td><select data-k="mode" ${dis} aria-label="Values entered as"><option value="meter" ${f.mode !== 'consumption' ? 'selected' : ''}>Meter reading</option><option value="consumption" ${f.mode === 'consumption' ? 'selected' : ''}>Daily consumption</option></select></td>
        <td><label class="check"><input type="checkbox" data-k="active" ${f.active !== false ? 'checked' : ''} ${dis}><span class="sr-only">Active</span></label></td>
        <td class="num">${counts.get(f.id) || 0}</td>
        <td class="num">${ro ? '' : '<button class="btn small danger" data-del>Delete</button>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <datalist id="groups">${[...new Set(['HF', 'TF', ...S.furnaces.map(f => f.group).filter(Boolean)])].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    ${ro ? '' : `<form class="addrow" id="addF">
      <label class="f">Type<select id="aType"><option value="HF">HF</option><option value="TF">TF</option></select></label>
      <label class="f">Name<input id="aName" required value="HF ${nextNum('HF')}" style="width:140px"></label>
      <label class="f">Code<input id="aCode" value="HF${nextNum('HF')}" style="width:100px"></label>
      <label class="f">Values entered as<select id="aMode"><option value="meter">Meter reading</option><option value="consumption">Daily consumption</option></select></label>
      <button class="btn primary" type="submit">Add furnace</button>
    </form>`}
  </section>
  <section class="panel">
    <div class="ph"><h2>Analysis settings</h2></div>
    <form class="settings" id="setF">
      <label class="f">Unit<input id="sUnit" value="${esc(S.settings.unit)}" style="width:110px" ${dis}></label>
      <label class="f">Flag a day when it differs from usual by more than (%)<input type="number" id="sThr" min="5" max="500" value="${esc(S.settings.threshold)}" style="width:110px" ${dis}></label>
      <label class="f">“Usual” is the median of the last (days)<input type="number" id="sWin" min="7" max="120" value="${esc(S.settings.window)}" style="width:110px" ${dis}></label>
      ${ro ? '' : '<button class="btn primary" type="submit">Save settings</button>'}
    </form>
    <p class="muted" style="font-size:13px;margin:14px 0 0">Meter readings are turned into daily use by subtracting the previous reading. When days are missed, the difference is spread evenly across them and marked “Spread”. Zero-use days count as idle and are never flagged.</p>
  </section>
  ${accessPanel()}
  ${ro ? '' : `<section class="panel">
    <div class="ph"><h2>Clear readings</h2><p>Keeps furnaces and settings</p></div>
    <p class="muted" style="margin:0 0 12px">Use this before re-importing a corrected Excel file. Export a backup first.</p>
    <button class="btn danger" id="clearAll">Delete all readings</button>
  </section>`}`;

  $$('tr[data-id]', main).forEach(tr => {
    const f = () => furnace(tr.dataset.id);
    tr.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', async () => {
      const cur = f(); if (!cur) return;
      const k = inp.dataset.k;
      let val = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
      if (k === 'name' && !val) { inp.value = cur.name; toast('A furnace needs a name.', true); return; }
      if (k === 'name') { val = hfName(val); inp.value = val; if (S.furnaces.some(x => x.id !== cur.id && norm(x.name) === norm(val))) { inp.value = cur.name; toast(`${val} already exists.`, true); return; } }
      if (k === 'group') val = val.toUpperCase() === 'HF' || val.toUpperCase() === 'TF' ? val.toUpperCase() : val;
      if (k === 'mode' && !await confirmBox({ title: 'Change how values are read?', body: val === 'meter' ? 'Stored values will be treated as cumulative meter readings, and daily use will be calculated from differences.' : 'Stored values will be treated as daily consumption, not meter readings.', ok: 'Change' })) { inp.value = cur.mode || 'meter'; return; }
      if (await saveFurnace({ ...cur, [k]: val })) toast('Saved');
    }));
    tr.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', async () => {
      const i = S.furnaces.findIndex(x => x.id === tr.dataset.id), j = i + +b.dataset.mv;
      if (j < 0 || j >= S.furnaces.length) return;
      const list = [...S.furnaces];[list[i], list[j]] = [list[j], list[i]];
      const updates = list.map((x, n) => ({ ...x, order: n + 1 })).filter((x, n) => S.furnaces.find(y => y.id === x.id).order !== n + 1);
      for (const u of updates) await saveFurnace(u);
      render(true);
    }));
    const del = tr.querySelector('[data-del]');
    del && del.addEventListener('click', async () => {
      const cur = f(); const n = counts.get(cur.id) || 0;
      if (!await confirmBox({ title: `Delete ${cur.name}?`, body: n ? `This also deletes its ${n} readings. To keep the history, untick Active instead.` : 'It has no readings.', ok: 'Delete furnace', danger: true, typeWord: n ? 'DELETE' : '' })) return;
      await removeFurnace(cur.id); toast(`Deleted ${cur.name}`);
    });
  });
  const af = $('#addF');
  af && $('#aType').addEventListener('change', e => { const t = e.target.value, n = nextNum(t); $('#aName').value = `${t} ${n}`; $('#aCode').value = `${t}${n}`; });
  af && af.addEventListener('submit', async e => {
    e.preventDefault();
    const type = $('#aType').value;
    const name = hfName($('#aName').value); if (!name) return;
    if (S.furnaces.some(x => norm(x.name) === norm(name))) { toast(`${name} already exists.`, true); return; }
    // place the new furnace at the end of its HF / TF block
    const same = S.furnaces.filter(x => (x.group || hfType(x.name)) === type);
    const after = same.length ? Math.max(...same.map(x => x.order || 0)) : (type === 'HF' ? 0 : Math.max(0, ...S.furnaces.map(x => x.order || 0)));
    for (const x of S.furnaces.filter(x => (x.order || 0) > after)) await saveFurnace({ ...x, order: (x.order || 0) + 1 });
    if (await saveFurnace({ id: newId('f'), name, code: $('#aCode').value.trim(), group: hfType(name) || type, mode: $('#aMode').value, active: true, order: after + 1 })) toast(`Added ${name}`);
    render(true);
    $('#aName')?.focus();
  });
  const sf = $('#setF');
  sf.addEventListener('submit', async e => {
    e.preventDefault();
    const s = { unit: $('#sUnit').value.trim() || 'Nm³', threshold: Math.min(500, Math.max(5, +$('#sThr').value || 40)), window: Math.min(120, Math.max(7, Math.round(+$('#sWin').value || 30))) };
    S.settings = s; changed(true);
    try { await Store.setSettings(s); toast('Settings saved'); } catch (err) { writeError(err); }
  });
  const ca = $('#clearAll');
  ca && ca.addEventListener('click', async () => {
    const n = [...S.months.values()].reduce((x, b) => x + Object.keys(b.days || {}).length, 0);
    if (!await confirmBox({ title: 'Delete all readings?', body: `All ${n} readings for every furnace will be deleted. This can’t be undone.`, ok: 'Delete all readings', danger: true, typeWord: 'DELETE' })) return;
    const ids = [...S.months.keys()]; S.months = new Map(); changed(true);
    if (Store.mode === 'sb') { const { error } = await SB.client.from('readings').delete().gte('reading_date', '1900-01-01'); toast(error ? sbErr(error) : 'All readings deleted', !!error); return; }
    try { await pool(ids.map(id => () => queued('m:' + id, () => Store.delMonth(id))), 4); toast('All readings deleted'); } catch (err) { writeError(err); }
  });
}

/* =========================================================
   Roles — Manager (Editor/Owner) sees everything,
   Supervisor (Contributor) can only submit daily readings.
   Enforced by the server's access rules, not by the page:
     ""            read admin,    write admin      → readings, furnaces, settings
     "public"      read interact, write admin      → furnace list + last reading only
     "inbox"       read admin,    write admin      → manager reads every submission
     "inbox/{self}" read+write interact            → each supervisor's own submissions
   ========================================================= */
S.role = 'manager';
S.pub = { furnaces: null, last: null };
S.mine = null; S.uid = null; S.inbox = []; S.loaded.p = false;
S.sDate = todayISO(); S.sDraft = {}; S.sDraftDate = null;

function setRoleBadge() {
  const b = $('#roleBadge'); if (!b) return;
  if (Store.mode !== 'db') { b.hidden = true; return; }
  b.hidden = false; b.textContent = S.role === 'supervisor' ? 'Supervisor' : 'Manager';
  b.className = 'role-badge ' + S.role;
}

/* ---------------- Supervisor side ---------------- */
async function startSupervisor(db, user) {
  S.role = 'supervisor';
  document.body.classList.add('sup');
  $('.app-name').textContent = 'Daily gas readings';
  setRoleBadge();
  try { S.uid = user ? await user.id() : null; } catch { S.uid = null; }
  try { S.supWrite = user && typeof user.can === 'function' ? await user.can('data.write') : null; } catch { S.supWrite = null; }
  try { const me = user ? await user.me() : null; if (me && me.name && !lsGet('midal-gas-by')) lsSet('midal-gas-by', me.name); } catch {}
  let gotF = false, gotL = false;
  db.doc('public/furnaces').onSnapshot(s => { S.pub.furnaces = s.exists ? clone(s.data()).list || [] : []; gotF = true; S.loaded.p = gotF && gotL; changed(); }, e => onDbError(e));
  db.doc('public/last').onSnapshot(s => { S.pub.last = s.exists ? clone(s.data()).last || {} : {}; gotL = true; S.loaded.p = gotF && gotL; changed(); }, e => onDbError(e));
  db.doc('public/requests').onSnapshot(s => { S.requests = s.exists ? clone(s.data()).items || {} : {}; changed(); }, () => {});
  if (S.uid) db.doc('inbox/' + S.uid).onSnapshot(s => { S.mine = s.exists ? clone(s.data()) : null; changed(); }, e => onDbError(e));
}
function supFurnaces() { return (S.pub.furnaces || []).filter(f => f.active !== false).sort(byOrder); }
function supPrev(fid, date) {
  let best = null;
  const l = S.pub.last && S.pub.last[fid];
  if (l && l.date < date) best = { date: l.date, v: l.v };
  else if (l && l.pd && l.pd < date) best = { date: l.pd, v: l.pv };
  const days = (S.mine && S.mine.days) || {};
  for (const [d, day] of Object.entries(days)) {
    const x = day && day.values && day.values[fid];
    if (d < date && x && typeof x.v === 'number' && (!best || d > best.date)) best = { date: d, v: x.v };
  }
  return best;
}
function supLoadDraft() {
  S.sDraft = {}; S.sDraftDate = S.sDate;
  const day = S.mine && S.mine.days && S.mine.days[S.sDate];
  supFurnaces().forEach(f => { const x = day && day.values && day.values[f.id]; S.sDraft[f.id] = { v: x && typeof x.v === 'number' ? String(x.v) : '', note: (x && x.note) || '' }; });
}
function supCalc(f, str) {
  const prev = f.mode === 'consumption' ? null : supPrev(f.id, S.sDate);
  const raw = String(str ?? '').trim(); if (!raw) return { prev, v: null };
  const v = parseNum(raw); if (v == null) return { prev, err: 'Enter a number' };
  if (f.mode === 'consumption') return { prev, v, used: v };
  if (!prev) return { prev, v, first: true };
  const gap = diffDays(prev.date, S.sDate);
  if (v < prev.v) return { prev, v, err: `Lower than ${fmt(prev.v, 2)} on ${fmtDay(prev.date)}` };
  const used = (v - prev.v) / gap, typ = S.pub.last && S.pub.last[f.id] && S.pub.last[f.id].typ;
  const warn = typ && used > 0 && (used > typ * 3 || used < typ / 3) ? `Very ${used > typ ? 'high' : 'low'} — please check the meter` : '';
  return { prev, v, used, gap, warn };
}
function renderSupervisor() {
  const main = $('#main');
  if (!S.loaded.p) { main.innerHTML = '<div class="loading">Loading…</div>'; return; }
  if (editingInMain() && S._lastView === 'sup' && S.sDraftDate === S.sDate) { supRefresh(); return; }
  S._lastView = 'sup';
  const list = supFurnaces(), t = todayISO(), date = S.sDate;
  if (S.sDraftDate !== date) supLoadDraft();
  const day = S.mine && S.mine.days && S.mine.days[date];
  const recent = Object.entries((S.mine && S.mine.days) || {}).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 10);
  if (!list.length) {
    main.innerHTML = S.supWrite === false || !S.uid
      ? `<div class="empty"><h1>View-only access</h1><p>Your account can open this page but not send readings, so the furnace list stays hidden. Ask the manager to open <strong>Share</strong> and change your access to <strong>Contributor</strong> (not Viewer or Commenter). You must be signed in with your Midal Claude account.</p></div>`
      : `<div class="empty"><h1>Furnace list not available</h1><p>This page can’t load the furnace list for your account. Ask the manager to check in <strong>Share</strong> that you are listed as <strong>Contributor</strong> with your Midal Claude account, then reload this page.</p></div>`;
    return;
  }
  main.innerHTML = `
  <div class="sup-wrap">
  <div class="page-head">
    <div class="grow"><h1>Daily readings</h1><p class="sub">${weekday(date)} ${fmtDate(date)}${day ? ` · <span class="pill ${day.mergedAt >= day.at ? 'ok' : 'est'}">${day.mergedAt >= day.at ? 'Received by manager' : 'Sent, waiting for manager'}</span>` : ''}</p></div>
  </div>
  ${supRequestsBlock()}
  ${S.uid ? '' : '<div class="notice warn">Your account can’t submit here. Ask the manager to share the page with you as <strong>Contributor</strong>.</div>'}
  <div class="entry-bar">
    <label class="f">Reading date
      <span style="display:flex;gap:6px"><button class="btn small" id="sPrev" aria-label="Previous day">‹</button><input type="date" id="sDate" value="${date}" max="${t}" min="${addDays(t, -30)}"><button class="btn small" id="sNext" aria-label="Next day" ${date >= t ? 'disabled' : ''}>›</button>${date !== t ? '<button class="btn small" id="sToday">Today</button>' : ''}</span>
    </label>
    <label class="f">Entered by<input type="text" id="sBy" value="${esc(lsGet('midal-gas-by') || '')}" placeholder="Your name" style="width:200px"></label>
  </div>
  <section class="panel entry">
    <div class="tw"><table>
      <thead><tr><th>Furnace</th><th class="num">Previous reading</th><th class="num">Reading on ${fmtDay(date)}</th><th class="num">Used</th><th>Check</th><th style="min-width:160px">Note</th></tr></thead>
      <tbody class="grp">${list.map((f, i) => { const g = groupOf(f), head = i === 0 || groupOf(list[i - 1]) !== g; const d = S.sDraft[f.id] || { v: '', note: '' };
        return `${head ? `<tr class="gsum" style="--gc:${gColor(g)}"><td colspan="6"><strong>${esc(groupName(g))}</strong></td></tr>` : ''}
        <tr data-srow="${esc(f.id)}">
          <td><div class="fn">${esc(f.name)}</div><div class="fs">${f.mode === 'consumption' ? 'Daily consumption' : 'Meter reading'}</div></td>
          <td class="num prev"></td>
          <td class="num"><input class="val" data-fid="${esc(f.id)}" inputmode="decimal" autocomplete="off" value="${esc(d.v)}" aria-label="${esc(f.name)} reading" ${S.uid ? '' : 'disabled'}></td>
          <td class="num used"></td><td class="chk"></td>
          <td><input class="note" data-fid="${esc(f.id)}" value="${esc(d.note)}" aria-label="${esc(f.name)} note" ${S.uid ? '' : 'disabled'}></td>
        </tr>`; }).join('')}</tbody>
    </table></div>
  </section>
  ${S.uid ? `<div class="savebar"><span id="sSummary" class="muted"></span><button class="btn primary" id="sSend">${day ? 'Update readings' : 'Send readings'}</button></div>` : ''}
  ${recent.length ? `<section class="panel" style="margin-top:20px"><div class="ph"><h2>Your recent submissions</h2><p>Tap a day to open it</p></div>
    <div class="tw"><table><thead><tr><th>Date</th><th class="num">Furnaces</th><th>Status</th><th>Sent</th></tr></thead><tbody>
    ${recent.map(([d, x]) => `<tr class="click" data-sday="${d}"><td>${weekday(d)} ${fmtDate(d)}</td><td class="num">${Object.values(x.values || {}).filter(v => v && typeof v.v === 'number').length}</td><td><span class="pill ${x.mergedAt >= x.at ? 'ok' : 'est'}">${x.mergedAt >= x.at ? 'Received' : 'Waiting'}</span></td><td class="muted">${new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}
    </tbody></table></div></section>` : ''}
  </div>`;
  supRefresh();
  const setD = d => { if (!d) return; if (d > t) d = t; S.sDate = d; S.sDraftDate = null; render(true); };
  $('#sDate').addEventListener('change', e => setD(e.target.value));
  $('#sPrev').addEventListener('click', () => setD(addDays(date, -1)));
  $('#sNext').addEventListener('click', () => setD(addDays(date, 1)));
  $('#sToday')?.addEventListener('click', () => setD(t));
  $('#sBy').addEventListener('input', e => lsSet('midal-gas-by', e.target.value.trim()));
  $$('[data-sday]', main).forEach(tr => tr.addEventListener('click', () => setD(tr.dataset.sday)));
  $$('input.val, input.note', main).forEach(inp => {
    inp.addEventListener('input', () => { const id = inp.dataset.fid; S.sDraft[id] = S.sDraft[id] || { v: '', note: '' }; S.sDraft[id][inp.classList.contains('val') ? 'v' : 'note'] = inp.value; supRefresh(id); });
    inp.addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const all = $$(inp.classList.contains('val') ? 'input.val' : 'input.note', main), i = all.indexOf(inp); if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select(); } else $('#sSend')?.focus(); });
  });
  $('#sSend')?.addEventListener('click', supSend);
  bindSupRequests(main);
}
function supRefresh(only) {
  const list = supFurnaces();
  $$('tr[data-srow]').forEach(tr => {
    const id = tr.dataset.srow; if (only && only !== id) return;
    const f = list.find(x => x.id === id); if (!f) return;
    const c = supCalc(f, (S.sDraft[id] || {}).v);
    tr.querySelector('.prev').innerHTML = f.mode === 'consumption' ? '<span class="muted">–</span>' : c.prev ? `${fmt(c.prev.v, 2)}<div class="fs">${fmtDay(c.prev.date)}</div>` : '<span class="muted">None</span>';
    tr.querySelector('.used').innerHTML = c.used != null ? `<strong>${fmt(c.used)}</strong>${c.gap > 1 ? `<div class="fs">per day over ${c.gap} days</div>` : ''}` : '';
    tr.querySelector('.chk').innerHTML = c.err ? `<span class="pill err">${esc(c.err)}</span>` : c.warn ? `<span class="pill warn">${esc(c.warn)}</span>` : c.v != null ? `<span class="pill ${c.first ? 'est' : 'ok'}">${c.first ? 'First reading' : 'OK'}</span>` : '';
    tr.classList.toggle('filled', c.v != null && !c.err && !c.warn); tr.classList.toggle('has-warn', !!c.warn && !c.err); tr.classList.toggle('has-err', !!c.err);
  });
  const n = list.filter(f => parseNum((S.sDraft[f.id] || {}).v) != null).length;
  const s = $('#sSummary'); if (s) s.textContent = `${n} of ${list.length} furnaces filled`;
}
async function supSend() {
  const list = supFurnaces(), values = {};
  let bad = 0, drops = [];
  for (const f of list) {
    const d = S.sDraft[f.id] || {}, raw = String(d.v || '').trim();
    const v = raw ? parseNum(raw) : null;
    if (raw && v == null) bad++;
    if (v != null && supCalc(f, raw).err) drops.push(f.name);
    values[f.id] = { v, note: (d.note || '').trim() };
  }
  if (bad) { toast('Some readings are not numbers.', true); return; }
  if (!Object.values(values).some(x => x.v != null)) { toast('Enter at least one reading.', true); return; }
  if (drops.length && !await confirmBox({ title: 'Send lower readings?', body: `${drops.join(', ')} ${drops.length > 1 ? 'are' : 'is'} lower than the previous reading. Please double-check the meter. Send anyway?`, ok: 'Send anyway' })) return;
  const doc = clone(S.mine) || { days: {} };
  doc.days = doc.days || {};
  doc.days[S.sDate] = { values, by: lsGet('midal-gas-by') || '', at: Date.now(), mergedAt: 0 };
  // keep the document small: drop received days older than 45 days
  const cut = addDays(todayISO(), -45);
  for (const [d, x] of Object.entries(doc.days)) if (d < cut && x.mergedAt >= x.at) delete doc.days[d];
  const btn = $('#sSend'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await queued('inbox', () => Store.db.doc('inbox/' + S.uid).set(doc));
    S.mine = doc; S.sDraftDate = null;
    toast(`Sent ${Object.values(values).filter(x => x.v != null).length} readings for ${fmtDate(S.sDate)}`);
  } catch (e) {
    if (e && e.code === 'invalid_argument') toast('You don’t have permission to send. Ask the manager to share the page with you as Contributor.', true);
    else writeError(e);
  }
  render(true);
}

/* ---------------- Manager side ---------------- */
const merging = new Set();
let mergeT = 0;
function managerHooks() { if (S.role !== 'manager' || Store.mode !== 'db' || !S.loaded.f || !S.loaded.r) return; clearTimeout(mergeT); mergeT = setTimeout(() => { tryMerge(); syncPublic(); }, 800); }
async function tryMerge() {
  if (!S.canWrite) return;
  for (const doc of S.inbox) {
    for (const [date, day] of Object.entries(doc.days || {})) {
      if (!day || !(day.at > (day.mergedAt || 0))) continue;
      const key = `${doc.id}|${date}|${day.at}`; if (merging.has(key)) continue; merging.add(key);
      const changes = Object.entries(day.values || {}).filter(([fid, x]) => furnace(fid) && x && typeof x.v === 'number').map(([fid, x]) => ({ fid, date, v: x.v, note: x.note || '', by: day.by || 'Supervisor' }));
      const ok = !changes.length || await putEntries(changes);
      if (!ok) { merging.delete(key); continue; }
      try { await queued('inbox:' + doc.id, () => Store.db.doc('inbox/' + doc.id).update({ days: { [date]: { mergedAt: Date.now() } } })); } catch {}
      if (changes.length) toast(`Received ${changes.length} readings from ${day.by || 'the supervisor'} for ${fmtDate(date)}`);
    }
  }
}
let pubSig = { furnaces: null, last: null };
/* key-order-independent JSON, so the stored copy compares equal to ours */
const canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => (a[x] = v[x], a), {}) : v);
async function syncPublic() {
  if (!S.canWrite) return;
  const list = S.furnaces.map(f => ({ id: f.id, name: f.name, group: groupOf(f), mode: f.mode || 'meter', active: f.active !== false, order: f.order || 0 }));
  const last = {};
  S.furnaces.forEach(f => {
    const a = analyse(f); if (!a.last) return;
    const e = a.entries, p = e.length > 1 ? e[e.length - 2] : null;
    const recent = a.days.slice(-40).map(d => a.daily.get(d).c).filter(c => c > 0);
    last[f.id] = { date: a.last.date, v: a.last.v, pd: p ? p.date : null, pv: p ? p.v : null, typ: recent.length >= 7 ? Math.round(median(recent)) : null };
  });
  const fs = canon(list), ls = canon(last);
  try {
    if (fs !== pubSig.furnaces) { pubSig.furnaces = fs; await queued('pub:f', () => Store.db.doc('public/furnaces').set({ list })); }
    if (ls !== pubSig.last) { pubSig.last = ls; await queued('pub:l', () => Store.db.doc('public/last').set({ last })); }
  } catch { pubSig = { furnaces: null, last: null }; }
}
function subscribeManagerExtras(db) {
  db.collection('inbox').onSnapshot(snap => { S.inbox = snap.docs.map(d => ({ id: d.id, ...clone(d.data()) })); changed(); }, () => {});
  db.doc('public/furnaces').onSnapshot(s => { if (s.exists) pubSig.furnaces = canon(clone(s.data()).list || []); managerHooks(); }, () => {});
  db.doc('public/last').onSnapshot(s => { if (s.exists) pubSig.last = canon(clone(s.data()).last || {}); managerHooks(); }, () => {});
}

/* Access panel shown on the manager's Furnaces & settings page */
function accessPanel() {
  if (Store.mode !== 'db') return '';
  const subs = [];
  S.inbox.forEach(d => Object.entries(d.days || {}).forEach(([date, x]) => subs.push({ date, by: x.by || 'Supervisor', n: Object.values(x.values || {}).filter(v => v && typeof v.v === 'number').length, at: x.at, ok: x.mergedAt >= x.at })));
  subs.sort((a, b) => b.at - a.at);
  return `<section class="panel">
    <div class="ph"><h2>Who can do what</h2><p>Set in the Share menu of this page</p></div>
    <div class="roles">
      <div><span class="role-badge manager">Manager</span><p>Share as <strong>Editor</strong> (you are the owner, so you already are). Sees every page, report and export, and can edit furnaces and readings.</p></div>
      <div><span class="role-badge supervisor">Supervisor</span><p>Share as <strong>Contributor</strong>. Sees only the daily entry sheet with each furnace’s last reading, and can send readings. Reports, charts and history stay hidden — the server refuses them, not just the page.</p></div>
      <div><span class="role-badge">Viewer</span><p>Viewer or Commenter sees nothing. Everyone must be signed in to your organization’s Claude account.</p></div>
    </div>
    <h2 style="font-size:15px;margin:18px 0 8px">Latest supervisor submissions</h2>
    ${subs.length ? `<div class="tw"><table><thead><tr><th>Reading date</th><th>By</th><th class="num">Furnaces</th><th>Sent</th><th>Status</th></tr></thead><tbody>${subs.slice(0, 8).map(s => `<tr><td>${fmtDate(s.date)}</td><td>${esc(s.by)}</td><td class="num">${s.n}</td><td class="muted">${new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td><span class="pill ${s.ok ? 'ok' : 'est'}">${s.ok ? 'Added to data' : 'Adding…'}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No submissions yet.</p>'}
  </section>`;
}

/* =========================================================
   Recently added data + "ask to change" requests
   Requests live in public/requests (manager writes, supervisor reads).
   ========================================================= */
S.requests = {};          // id -> {fid, date, msg, at, status:'open'|'closed'}
S.recentOnly = lsGet('midal-gas-recent-only') === '1';
S.recentOpen = null;

async function saveRequests() {
  changed(true);
  if (Store.mode === 'db') {
    try { await queued('pub:r', () => Store.db.doc('public/requests').set({ items: S.requests })); }
    catch (e) { writeError(e); }
  } else Store.persistLocal();
}
function reqFor(fid, date) { return Object.entries(S.requests).find(([, r]) => r.fid === fid && r.date === date && r.status === 'open'); }
/* a request counts as answered once the reading was changed after it was sent */
function reqAnswered(r) {
  if (S.role === 'supervisor') { const d = S.mine && S.mine.days && S.mine.days[r.date]; return !!(d && d.at > r.at); }
  const e = entryAt(r.fid, r.date); return !!(e && e.at > r.at);
}

/* ---------- batches of recently added readings ---------- */
function recentBatches() {
  const since = Date.now() - 21 * 864e5, map = new Map();
  for (const f of activeFurnaces()) {
    for (const e of entriesOf(f.id)) {
      if (!e.at || e.at < since || e.by === 'Import') continue;
      const key = e.date + '|' + (e.by || '');
      if (!map.has(key)) map.set(key, { date: e.date, by: e.by || '', at: 0, rows: [] });
      const b = map.get(key); b.at = Math.max(b.at, e.at); b.rows.push({ f, e });
    }
  }
  const out = [...map.values()].sort((a, b) => b.at - a.at).slice(0, 6);
  out.forEach(b => b.rows.sort((p, q) => byOrder(p.f, q.f)));
  return out;
}
const whenStr = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function recentPanel() {
  const batches = recentBatches();
  const open = Object.entries(S.requests).filter(([, r]) => r.status === 'open' && furnace(r.fid)).sort((a, b) => b[1].at - a[1].at);
  if (!batches.length && !open.length) return '';
  if (S.recentOpen == null && batches[0]) S.recentOpen = batches[0].date + '|' + batches[0].by;
  const rowInfo = (f, e) => {
    const a = analyse(f), r = a.daily.get(e.date);
    let warn = !!(r && ['high', 'low', 'drop'].includes(r.status)), extra = '';
    if (r && r.c > 0 && !warn) {   // also check readings spread over missed days
      const b = baselineBefore(a, e.date), thr = +S.settings.threshold || 40;
      if (b > 0 && Math.abs(r.c - b) / b * 100 > thr) { warn = true; extra = `<span class="pill warn">${r.c > b ? 'High' : 'Low'} · usual ${fmt(b)}</span>`; }
    }
    return { r, warn, extra };
  };
  const reqList = open.length ? `<div class="req-list">
    <h3>Change requests</h3>
    ${open.map(([id, r]) => { const f = furnace(r.fid), done = reqAnswered(r), e = entryAt(r.fid, r.date);
      return `<div class="req ${done ? 'done' : ''}">
        <div><strong>${esc(f.name)}</strong> · ${weekday(r.date)} ${fmtDay(r.date)} <span class="pill ${done ? 'ok' : 'warn'}">${done ? `Updated to ${fmt(e?.v, 2)}` : 'Waiting for supervisor'}</span>
        <div class="req-msg">“${esc(r.msg)}”</div></div>
        <div class="actions"><button class="btn small ghost" data-redit="${esc(r.fid)}|${r.date}">Edit myself</button><button class="btn small" data-rclose="${esc(id)}">${done ? 'Close' : 'Cancel request'}</button></div>
      </div>`; }).join('')}
  </div>` : '';
  const body = batches.map(b => {
    const key = b.date + '|' + b.by, notes = b.rows.filter(x => x.e.note).length, warns = b.rows.filter(x => rowInfo(x.f, x.e).warn).length;
    const rows = S.recentOnly ? b.rows.filter(x => x.e.note || rowInfo(x.f, x.e).warn || reqFor(x.f.id, x.e.date)) : b.rows;
    return `<details class="batch" data-key="${esc(key)}" ${S.recentOpen === key ? 'open' : ''}>
      <summary>
        <span class="b-date"><strong>${weekday(b.date)} ${fmtDate(b.date)}</strong></span>
        <span>${b.rows.length} reading${b.rows.length > 1 ? 's' : ''}${b.by ? ` by <strong>${esc(b.by)}</strong>` : ''}</span>
        <span class="muted">sent ${whenStr(b.at)}</span>
        <span class="b-tags">${notes ? `<span class="pill est">${notes} note${notes > 1 ? 's' : ''}</span>` : ''}${warns ? `<span class="pill warn">${warns} to check</span>` : ''}</span>
      </summary>
      ${rows.length ? `<div class="tw"><table class="recent-t">
        <thead><tr><th>Furnace</th><th class="num">Reading</th><th class="num">Used</th><th>Check</th><th>Note</th><th></th></tr></thead>
        <tbody class="grp">${rows.map(({ f, e }, i) => { const { r, extra } = rowInfo(f, e), rq = reqFor(f.id, e.date); const g = groupOf(f), head = i === 0 || groupOf(rows[i - 1].f) !== g;
          return `${head ? `<tr class="gsum" style="--gc:${gColor(g)}"><td colspan="6"><strong>${esc(g)}</strong></td></tr>` : ''}<tr>
          <td class="fcell"><a href="#" data-openf="${esc(f.id)}">${esc(f.name)}</a></td>
          <td class="num"><strong>${fmt(e.v, 2)}</strong></td>
          <td class="num">${r && r.c != null ? fmt(r.c) + (r.span > 1 ? ' <span class="muted">/day</span>' : '') : '–'}</td>
          <td class="nowrap">${r ? statusPill(r) : ''} ${extra}${rq ? ` <span class="pill ${reqAnswered(rq[1]) ? 'ok' : 'warn'}">${reqAnswered(rq[1]) ? 'Updated' : 'Asked'}</span>` : ''}</td>
          <td class="note-cell">${e.note ? `<span class="note-txt">${esc(e.note)}</span>` : '<span class="muted">–</span>'}</td>
          <td class="num nowrap">${S.canWrite ? `${rq ? '' : `<button class="btn small" data-ask="${esc(f.id)}|${e.date}">Ask to change</button>`} <button class="btn small ghost" data-redit="${esc(f.id)}|${e.date}">Edit</button>` : ''}</td>
        </tr>`; }).join('')}</tbody></table></div>` : '<p class="muted" style="margin:10px 0 0">Nothing with notes or warnings in this batch.</p>'}
    </details>`;
  }).join('');
  return `<section class="panel recent">
    <div class="ph"><h2>Recently added</h2>
      <label class="check"><input type="checkbox" id="recentOnly" ${S.recentOnly ? 'checked' : ''}>Only notes, warnings and requests</label>
    </div>
    ${reqList}
    ${body || '<p class="muted">No readings added in the last three weeks.</p>'}
  </section>`;
}
function bindRecent(main) {
  const ro = $('#recentOnly', main);
  ro && ro.addEventListener('change', () => { S.recentOnly = ro.checked; lsSet('midal-gas-recent-only', ro.checked ? '1' : '0'); render(true); });
  $$('details.batch', main).forEach(d => d.addEventListener('toggle', () => { if (d.open) S.recentOpen = d.dataset.key; else if (S.recentOpen === d.dataset.key) S.recentOpen = ''; }));
  $$('[data-openf]', main).forEach(a => a.addEventListener('click', e => { e.preventDefault(); go('furnace', a.dataset.openf); }));
  $$('[data-redit]', main).forEach(b => b.addEventListener('click', () => { const [fid, date] = b.dataset.redit.split('|'); openReading(fid, date); }));
  $$('[data-ask]', main).forEach(b => b.addEventListener('click', () => { const [fid, date] = b.dataset.ask.split('|'); openAsk(fid, date); }));
  $$('[data-rclose]', main).forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.rclose, r = S.requests[id]; if (!r) return;
    r.status = 'closed'; r.closedAt = Date.now();
    if (Store.mode === 'sb') { changed(true); const { error } = await SB.client.from('requests').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id); if (error) toast(sbErr(error), true); return; }
    await saveRequests();
  }));
}

/* ---------- data entry check: missed days, readings to check, latest activity ---------- */
S.chkDays = [7, 14, 30].includes(+lsGet('midal-gas-check-days')) ? +lsGet('midal-gas-check-days') : 14;
const isoOf = t => { const d = new Date(t); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const agoStr = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
/* ['2026-09-03','2026-09-04','2026-09-09'] -> "3–4 Sep, 9 Sep" */
function dayRanges(ds) {
  const out = [];
  for (const d of ds) { const l = out[out.length - 1]; if (l && addDays(l[1], 1) === d) l[1] = d; else out.push([d, d]); }
  return out.map(([a, b]) => a === b ? fmtDay(a) : `${fmtDay(a)}–${fmtDay(b)}`).join(', ');
}
/* same ideas as the supervisor's typo warnings, applied to what was saved */
function entryIssue(a, e, prev) {
  const r = a.daily.get(e.date);
  if (a.meter && prev && e.v < prev.v) return { r, label: 'Lower than last reading', cls: 'err' };
  if (!r || !(r.c > 0)) return null;
  const b = r.base ?? baselineBefore(a, e.date), thr = +S.settings.threshold || 40;
  if (!(b > 0)) return null;
  if (a.meter && prev && r.c > b * 3) {
    const alt = (e.v / 10 - prev.v) / Math.max(1, diffDays(prev.date, e.date));
    if (alt >= 0 && alt <= b * 3) return { r, b, label: 'Extra digit?', cls: 'err' };
  }
  if (Math.abs(r.c - b) / b * 100 > thr) return { r, b, label: r.c > b ? 'High' : 'Low', cls: 'warn' };
  return null;
}
function checkPanel() {
  const act = activeFurnaces();
  if (!act.length) return '';
  const n = S.chkDays, t = todayISO(), y = addDays(t, -1), from = addDays(t, -(n - 1));
  let latest = null, expected = 0, got = 0;
  const missing = [], issues = [], notes = [], late = [], noData = [], have = new Map();
  for (const f of act) {
    const a = analyse(f), es = a.entries;
    if (!es.length) { noData.push(f); continue; }
    const set = new Set(es.map(e => e.date)); have.set(f.id, { set, first: es[0].date });
    const miss = [];
    for (let d = es[0].date > from ? es[0].date : from; d <= y; d = addDays(d, 1)) { expected++; if (set.has(d)) got++; else miss.push(d); }
    if (miss.length) missing.push({ f, miss });
    es.forEach((e, i) => {
      if (e.at && (!latest || e.at > latest.at)) latest = { ...e, f };
      if (e.date < from) return;
      const iss = entryIssue(a, e, es[i - 1]);
      if (iss) issues.push({ f, e, ...iss });
      if (e.note) notes.push({ f, e });
      if (e.at && e.by !== 'Import' && diffDays(e.date, isoOf(e.at)) >= 2) late.push({ f, e });
    });
  }
  const todayIn = act.filter(f => have.get(f.id)?.set.has(t)).length;
  let complete = null;
  for (let i = 0, d = t; i < 90 && have.size; i++, d = addDays(d, -1)) {
    if ([...have.values()].every(h => h.first > d || h.set.has(d))) { complete = d; break; }
  }
  const fill = expected ? Math.round(got / expected * 100) : null;
  missing.sort((p, q) => q.miss.length - p.miss.length || byOrder(p.f, q.f));
  issues.sort((p, q) => p.e.date < q.e.date ? 1 : p.e.date > q.e.date ? -1 : byOrder(p.f, q.f));
  const extra = [...notes.map(x => ({ ...x, k: 'note' })), ...late.filter(x => !x.e.note).map(x => ({ ...x, k: 'late' }))]
    .sort((p, q) => q.e.at - p.e.at);
  const more = (list, max) => list.length > max ? `<p class="muted chk-more">+ ${list.length - max} more</p>` : '';
  const fLink = f => `<a href="#" data-openf="${esc(f.id)}">${esc(f.name)}</a>`;
  const lateTag = e => diffDays(e.date, isoOf(e.at)) >= 2 ? ` <span class="pill est">sent ${diffDays(e.date, isoOf(e.at))} days later</span>` : '';

  const missBox = missing.length || noData.length ? missing.slice(0, 12).map(({ f, miss }) => `<div class="chk-row">
      ${fLink(f)} <span class="pill err">${miss.length} day${miss.length > 1 ? 's' : ''}</span>
      <span class="muted grow">${dayRanges(miss)}</span>
      ${S.canWrite ? `<button class="btn small ghost" data-fill="${miss[miss.length - 1]}">Enter</button>` : ''}
    </div>`).join('') + more(missing, 12)
    + (noData.length ? `<div class="chk-row"><span class="grow"><strong>No readings yet:</strong> <span class="muted">${noData.map(f => esc(f.name)).join(', ')}</span></span></div>` : '')
    : `<p class="muted">Every furnace has a reading for each day up to yesterday.</p>`;

  const issueBox = issues.length ? issues.slice(0, 12).map(({ f, e, r, b, label, cls }) => { const rq = reqFor(f.id, e.date);
    return `<div class="chk-row">
      ${fLink(f)} <span class="muted">${weekday(e.date)} ${fmtDay(e.date)}</span> <span class="pill ${cls}">${esc(label)}</span>
      <span class="grow chk-sub">Reading <strong>${fmt(e.v, 2)}</strong>${r && r.c != null ? ` · used ${fmt(r.c)}${r.span > 1 ? '/day' : ''}` : ''}${b ? ` · usual ${fmt(b)}` : ''}${e.by ? ` · by ${esc(e.by)}` : ''}</span>
      ${S.canWrite ? `${rq ? `<span class="pill ${reqAnswered(rq[1]) ? 'ok' : 'warn'}">${reqAnswered(rq[1]) ? 'Updated' : 'Asked'}</span>` : `<button class="btn small" data-ask="${esc(f.id)}|${e.date}">Ask to change</button>`} <button class="btn small ghost" data-redit="${esc(f.id)}|${e.date}">Edit</button>` : ''}
    </div>`; }).join('') + more(issues, 12)
    : `<p class="muted">No readings look unrealistic in this period.</p>`;

  const noteBox = extra.length ? extra.slice(0, 10).map(({ f, e, k }) => `<div class="chk-row">
      ${fLink(f)} <span class="muted">${weekday(e.date)} ${fmtDay(e.date)}</span>${lateTag(e)}
      <span class="grow chk-sub">${k === 'note' ? `<span class="note-txt">${esc(e.note)}</span>` : `Reading ${fmt(e.v, 2)}`}${e.by ? ` <span class="muted">· ${esc(e.by)}</span>` : ''}${e.at ? ` <span class="muted">· ${whenStr(e.at)}</span>` : ''}</span>
    </div>`).join('') + more(extra, 10)
    : `<p class="muted">No notes or late entries in this period.</p>`;

  return `<section class="panel chk">
    <div class="ph"><h2>Data entry check</h2>
      <div class="seg" role="group" aria-label="Check period">${[7, 14, 30].map(k => `<button data-chk="${k}" aria-pressed="${n === k}">${k} days</button>`).join('')}</div>
    </div>
    <div class="chk-stats">
      <div class="${latest && Date.now() - latest.at > 2 * 864e5 ? 'bad' : ''}"><div class="k">Latest data added</div>
        <div class="v">${latest ? agoStr(latest.at) : 'Nothing yet'}</div>
        <div class="n">${latest ? `${esc(latest.f.name)} for ${weekday(latest.date)} ${fmtDay(latest.date)}${latest.by ? ` · by ${esc(latest.by)}` : ''} · ${whenStr(latest.at)}` : 'No readings have been saved'}</div></div>
      <div class="${todayIn < act.length ? 'warn' : 'good'}"><div class="k">Today’s readings</div>
        <div class="v">${todayIn} of ${act.length}</div><div class="n">${fmtDate(t)}</div></div>
      <div class="${complete === t || complete === y ? 'good' : 'warn'}"><div class="k">Last complete day</div>
        <div class="v">${complete ? `${weekday(complete)} ${fmtDay(complete)}` : 'None'}</div><div class="n">${complete ? 'All furnaces have a reading' : 'No day in the last 90 has every reading'}</div></div>
      <div class="${fill == null ? '' : fill >= 100 ? 'good' : fill >= 90 ? 'warn' : 'bad'}"><div class="k">Filled in, last ${n} days</div>
        <div class="v">${fill == null ? '–' : fill + '%'}</div><div class="n">${got} of ${expected} furnace-days, up to yesterday</div></div>
    </div>
    <div class="chk-cols">
      <div class="chk-box"><h3>Missing readings ${missing.length ? `<span class="pill err">${missing.reduce((s, x) => s + x.miss.length, 0)}</span>` : '<span class="pill ok">None</span>'}</h3>${missBox}</div>
      <div class="chk-box"><h3>Readings to check ${issues.length ? `<span class="pill warn">${issues.length}</span>` : '<span class="pill ok">None</span>'}</h3>${issueBox}</div>
      <div class="chk-box"><h3>Notes and late entries ${extra.length ? `<span class="pill est">${extra.length}</span>` : ''}</h3>${noteBox}</div>
    </div>
  </section>`;
}
function bindCheck(main) {
  $$('[data-chk]', main).forEach(b => b.addEventListener('click', () => { S.chkDays = +b.dataset.chk; lsSet('midal-gas-check-days', String(S.chkDays)); render(true); }));
  $$('[data-fill]', main).forEach(b => b.addEventListener('click', () => { S.entryDate = b.dataset.fill; go('entry'); }));
}

/* ---------- ask dialog ---------- */
const dlgA = $('#dlgAsk'); let askCtx = null;
function openAsk(fid, date) {
  const f = furnace(fid), e = entryAt(fid, date); if (!f || !e) return;
  askCtx = { fid, date };
  $('#askTitle').textContent = `Ask to change ${f.name}`;
  const r = analyse(f).daily.get(date);
  $('#askInfo').textContent = `${weekday(date)} ${fmtDate(date)} · reading ${fmt(e.v, 2)}${r && r.c != null ? ` · used ${fmt(r.c)} ${unit()}` : ''}${e.note ? ` · note: “${e.note}”` : ''}`;
  $('#askMsg').value = '';
  dlgA.showModal(); setTimeout(() => $('#askMsg').focus(), 30);
}
$$('#dlgAsk [data-q]').forEach(b => b.addEventListener('click', () => { const t = $('#askMsg'); t.value = (t.value ? t.value.trim() + ' ' : '') + b.dataset.q; t.focus(); }));
$('#askCancel').addEventListener('click', () => dlgA.close());
$('#formAsk').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#askMsg').value.trim(); if (!msg) { toast('Write what should be checked.', true); return; }
  dlgA.close();
  if (Store.mode === 'sb') {
    const { data, error } = await SB.client.from('requests').insert({ furnace_id: askCtx.fid, reading_date: askCtx.date, message: msg }).select().single();
    if (error) { toast(sbErr(error), true); return; }
    S.requests[data.id] = { fid: data.furnace_id, date: data.reading_date, msg: data.message, at: Date.parse(data.created_at), status: 'open' };
    changed(true); toast('Request sent — the supervisor will see it on his entry page'); return;
  }
  S.requests[newId('r')] = { fid: askCtx.fid, date: askCtx.date, msg, at: Date.now(), status: 'open' };
  // prune closed requests older than 60 days
  const cut = Date.now() - 60 * 864e5;
  for (const [k, r] of Object.entries(S.requests)) if (r.status !== 'open' && (r.closedAt || r.at) < cut) delete S.requests[k];
  await saveRequests();
  toast(`Request sent — the supervisor will see it on his entry page`);
});

/* ---------- supervisor side: show open requests ---------- */
function supRequestsBlock() {
  const list = Object.entries(S.requests).filter(([, r]) => r.status === 'open' && !reqAnswered(r)).sort((a, b) => a[1].date < b[1].date ? -1 : 1);
  if (!list.length) return '';
  const name = id => (S.pub.furnaces || []).find(f => f.id === id)?.name || 'Furnace';
  return `<section class="panel sreq">
    <div class="ph"><h2>The manager asked you to check ${list.length === 1 ? 'a reading' : list.length + ' readings'}</h2></div>
    ${list.map(([, r]) => `<div class="req"><div><strong>${esc(name(r.fid))}</strong> · ${weekday(r.date)} ${fmtDate(r.date)}<div class="req-msg">“${esc(r.msg)}”</div></div>
      <button class="btn small primary" data-fix="${esc(r.fid)}|${r.date}">Open and correct</button></div>`).join('')}
  </section>`;
}
function bindSupRequests(main) {
  $$('[data-fix]', main).forEach(b => b.addEventListener('click', () => {
    const [fid, date] = b.dataset.fix.split('|');
    S.sDate = date; S.sDraftDate = null; render(true);
    setTimeout(() => { const i = $(`input.val[data-fid="${CSS.escape(fid)}"]`); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); i.select(); } }, 50);
  }));
}

/* =========================================================
   Stand-alone website mode (GitHub Pages + Supabase)
   ---------------------------------------------------------
   • Authentication: Supabase Auth (passwords are checked on the
     server and never stored in this file).
   • Authorization: the database's row-level security. The page
     only decides which screen to show; the database decides
     what each login may read or write.
   ========================================================= */
const SB = { client: null, user: null, role: null, maxAt: '', pollT: 0 };
const sbOn = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseKey && window.supabase);

/* ---------------- i18n (login + supervisor) ---------------- */
const TXT = {
  en: {
    appTitle: 'Daily gas readings', who: 'Who are you?', manager: 'Manager', supervisor: 'Supervisor',
    managerSub: 'Reports, charts and settings', supervisorSub: 'Enter today’s readings',
    password: 'Password', signIn: 'Log in', back: 'Back', wrongPw: 'Wrong password. Try again.',
    wrongRole: 'This login is not set up as {r}. Ask the manager.', noConn: 'Cannot reach the database. Check the internet and try again.',
    notConfigured: 'The database is not connected yet.', practice: 'Open practice mode (saved in this browser only)',
    logout: 'Log out', lang: 'عربي',
    today: 'Today', yesterday: 'Yesterday', start: 'Start readings', cont: 'Continue', of: 'of',
    sent: 'Sent', notSent: 'Not sent yet', editSent: 'Change sent readings', sentAt: 'Sent at',
    last: 'Last reading', noPrev: 'No earlier reading', used: 'Used', perDay: 'per day', since: 'since',
    next: 'Next', prev: 'Back', skip: 'Skip', review: 'Review', send: 'Send readings', sending: 'Sending…',
    stopped: 'Stopped', stoppedHint: 'same as last', zeroHint: 'use 0', maint: 'Maintenance', meter: 'Meter problem',
    lower: 'Lower than the last reading', decimal: 'Too high — did you miss the decimal point?', missing: 'Too low — is a digit missing?',
    high: 'Not realistic — much higher than usual', low: 'Not realistic — much lower than usual', ok: 'Looks right', first: 'First reading for this furnace', zero: 'No gas used',
    confirmT: 'This number looks wrong', confirmB: 'Please look at the meter again before you continue.', fix: 'Fix it', correct: 'It is correct',
    entered: 'entered', skipped: 'skipped', check: 'to check', tapToChange: 'Tap a furnace to change it',
    fixRed: 'Fix or confirm the red readings first', nothing: 'Enter at least one reading first',
    doneT: 'Sent successfully', doneB: '{n} readings for {d}', home: 'Back to start',
    offline: 'Not sent — no connection. Your readings are kept on this phone. Try again.',
    asks: 'The manager asks you to check', checkNow: 'Check now', noFurnaces: 'The manager has not added furnaces yet.',
    loading: 'Loading…', typed: 'Type the meter reading', confirmedNote: 'Checked by supervisor',
  },
  ar: {
    appTitle: 'قراءات الغاز اليومية', who: 'من أنت؟', manager: 'المدير', supervisor: 'المشرف',
    managerSub: 'التقارير والرسوم والإعدادات', supervisorSub: 'إدخال قراءات اليوم',
    password: 'كلمة المرور', signIn: 'دخول', back: 'رجوع', wrongPw: 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
    wrongRole: 'هذا الحساب غير مسجل كـ {r}. اسأل المدير.', noConn: 'لا يمكن الوصول إلى قاعدة البيانات. تحقق من الإنترنت وحاول مرة أخرى.',
    notConfigured: 'قاعدة البيانات غير متصلة بعد.', practice: 'فتح وضع التجربة (يحفظ في هذا المتصفح فقط)',
    logout: 'خروج', lang: 'English',
    today: 'اليوم', yesterday: 'أمس', start: 'ابدأ القراءات', cont: 'أكمل', of: 'من',
    sent: 'تم الإرسال', notSent: 'لم تُرسل بعد', editSent: 'تعديل القراءات المرسلة', sentAt: 'أُرسلت الساعة',
    last: 'آخر قراءة', noPrev: 'لا توجد قراءة سابقة', used: 'الاستهلاك', perDay: 'في اليوم', since: 'منذ',
    next: 'التالي', prev: 'رجوع', skip: 'تخطي', review: 'مراجعة', send: 'إرسال القراءات', sending: 'جارٍ الإرسال…',
    stopped: 'متوقف', stoppedHint: 'نفس القراءة السابقة', zeroHint: 'الاستهلاك 0', maint: 'صيانة', meter: 'مشكلة في العداد',
    lower: 'أقل من القراءة السابقة', decimal: 'مرتفعة جداً — هل نسيت الفاصلة العشرية؟', missing: 'منخفضة جداً — هل هناك رقم ناقص؟',
    high: 'غير واقعية — أعلى بكثير من المعتاد', low: 'غير واقعية — أقل بكثير من المعتاد', ok: 'تبدو صحيحة', first: 'أول قراءة لهذا الفرن', zero: 'لا يوجد استهلاك',
    confirmT: 'هذا الرقم يبدو غير صحيح', confirmB: 'انظر إلى العداد مرة أخرى قبل المتابعة.', fix: 'تصحيح', correct: 'الرقم صحيح',
    entered: 'مُدخلة', skipped: 'متخطاة', check: 'تحتاج مراجعة', tapToChange: 'اضغط على الفرن لتعديله',
    fixRed: 'صحّح أو أكّد القراءات الحمراء أولاً', nothing: 'أدخل قراءة واحدة على الأقل',
    doneT: 'تم الإرسال بنجاح', doneB: '{n} قراءة ليوم {d}', home: 'العودة للبداية',
    offline: 'لم يتم الإرسال — لا يوجد اتصال. قراءاتك محفوظة في هذا الهاتف. حاول مرة أخرى.',
    asks: 'المدير يطلب منك مراجعة', checkNow: 'راجع الآن', noFurnaces: 'لم يضف المدير الأفران بعد.',
    loading: 'جارٍ التحميل…', typed: 'اكتب قراءة العداد', confirmedNote: 'أكّد المشرف الرقم',
  },
};
let LANG = lsGet('midal-lang') || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en');
const T = (k, vars) => { let s = (TXT[LANG] && TXT[LANG][k]) || TXT.en[k] || k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number), wd = new Date(toUTC(iso)).getUTCDay();
  return LANG === 'ar' ? `${AR_DAYS[wd]} ${d} ${AR_MON[m - 1]}` : `${weekday(iso)} ${d} ${MON[m - 1]}`;
}
function setLang(l) { LANG = l; lsSet('midal-lang', l); }

/* ---------------- Login screen ---------------- */
function loginShell() {
  let el = $('#login');
  if (!el) { el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
  document.body.classList.add('locked');
  return el;
}
function showLogin(msg, role) {
  const el = loginShell();
  el.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  const cfg = sbOn();
  el.innerHTML = `<div class="lg-card">
    <div class="lg-top"><img src="${$('.logo').src}" alt="Midal Cables" class="lg-logo"><button class="lg-lang" id="lgLang">${T('lang')}</button></div>
    <h1>${role ? esc(T(role)) : T('who')}</h1>
    ${!cfg ? `<div class="lg-msg warn">${T('notConfigured')}</div><button class="lg-btn ghost" id="lgPractice">${T('practice')}</button>` :
    !role ? `<div class="lg-roles">
        <button class="lg-role" data-role="supervisor"><span class="lg-ico">✎</span><strong>${T('supervisor')}</strong><small>${T('supervisorSub')}</small></button>
        <button class="lg-role" data-role="manager"><span class="lg-ico">▦</span><strong>${T('manager')}</strong><small>${T('managerSub')}</small></button>
      </div>` :
    `<form id="lgForm" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="${esc(role)}" hidden>
        <label class="lg-lbl" for="lgPw">${T('password')}</label>
        <div class="lg-pw"><input id="lgPw" type="password" autocomplete="current-password" required autofocus><button type="button" id="lgEye" aria-label="Show password">👁</button></div>
        ${msg ? `<div class="lg-msg err" role="alert">${esc(msg)}</div>` : ''}
        <button class="lg-btn" type="submit" id="lgGo">${T('signIn')}</button>
        <button class="lg-btn ghost" type="button" id="lgBack">${T('back')}</button>
      </form>`}
    ${!role && msg ? `<div class="lg-msg err" role="alert">${esc(msg)}</div>` : ''}
  </div>`;
  $('#lgLang').onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); showLogin(msg, role); };
  $('#lgPractice') && ($('#lgPractice').onclick = () => { el.remove(); document.body.classList.remove('locked'); Store.initLocal(); });
  $$('.lg-role', el).forEach(b => b.onclick = () => { lsSet('midal-last-role', b.dataset.role); showLogin('', b.dataset.role); });
  if (role) {
    $('#lgBack').onclick = () => showLogin('');
    $('#lgEye').onclick = () => { const i = $('#lgPw'); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); };
    $('#lgForm').onsubmit = async e => {
      e.preventDefault();
      const b = $('#lgGo'); b.disabled = true; b.textContent = '…';
      const err = await sbSignIn(role, $('#lgPw').value);
      if (err) showLogin(err, role);
    };
    setTimeout(() => $('#lgPw')?.focus(), 50);
  }
}
async function sbSignIn(role, pw) {
  const email = role === 'manager' ? CONFIG.managerEmail : CONFIG.supervisorEmail;
  let res;
  try { res = await SB.client.auth.signInWithPassword({ email, password: pw }); }
  catch { return T('noConn'); }
  if (res.error) return /fetch|network/i.test(res.error.message || '') ? T('noConn') : T('wrongPw');
  const r = await sbProfileRole(res.data.user);
  if (r === undefined) { await SB.client.auth.signOut(); return T('noConn'); }
  if (r !== role) { await SB.client.auth.signOut(); return T('wrongRole', { r: T(role) }); }
  await sbStart(res.data.user, r);
  return null;
}
async function sbProfileRole(user) {
  const { data, error } = await SB.client.from('profiles').select('role, display_name').eq('id', user.id).maybeSingle();
  if (error) return undefined;          // could not ask the database
  if (!data) return null;               // login exists but has no profile
  SB.name = data.display_name || '';
  return data.role;
}
async function sbLogout() { try { await SB.client.auth.signOut(); } catch {} lsSet('midal-last-role', ''); location.reload(); }

/* ---------------- Boot ---------------- */
async function sbBoot() {
  SB.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  Store.mode = 'sb';
  let session = null;
  try { session = (await SB.client.auth.getSession()).data.session; } catch {}
  if (session) {
    const r = await sbProfileRole(session.user);
    if (r) { await sbStart(session.user, r); return; }
    await SB.client.auth.signOut();
  }
  const idle = lsGet('midal-idle-out') === '1'; lsSet('midal-idle-out', '');
  showLogin(idle ? (LANG === 'ar' ? 'تم تسجيل الخروج تلقائياً بعد 30 دقيقة دون نشاط.' : 'Logged out after 30 minutes without activity.') : '');
  SB.client.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && SB.user) location.reload(); });
}
async function sbStart(user, role) {
  SB.user = user; SB.role = role;
  $('#login')?.remove(); document.body.classList.remove('locked');
  $('#logoutBtn').hidden = false;
  $('#logoutBtn').onclick = sbLogout;
  setSync('sb');
  if (role === 'supervisor') { S.role = 'supervisor'; document.body.classList.add('sup'); startSimpleSup(); return; }
  S.role = 'manager'; const b = $('#roleBadge'); b.hidden = false; b.textContent = 'Manager'; b.className = 'role-badge manager';
  // manager screens show sensitive data: log out automatically after 30 idle minutes
  let lastAct = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
  setInterval(() => { if (Date.now() - lastAct > 30 * 60000) { lsSet('midal-idle-out', '1'); sbLogout(); } }, 30000);
  await sbLoadAll();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sbPoll(); });
  SB.pollT = setInterval(() => { if (!document.hidden) sbPoll(); }, 60000);
}

/* ---------------- Manager data ---------------- */
const rowToF = r => ({ id: r.id, name: r.name, code: r.code || '', group: r.grp || '', mode: r.mode || 'meter', active: r.active !== false, order: r.sort || 0 });
const fToRow = f => ({ id: f.id, name: f.name, code: f.code || '', grp: f.group || '', mode: f.mode || 'meter', active: f.active !== false, sort: f.order || 0 });
function sbApplyRows(rows) {
  let newest = SB.maxAt;
  for (const r of rows) {
    const id = monthId(r.furnace_id, r.reading_date);
    const body = S.months.get(id) || { furnace: r.furnace_id, month: r.reading_date.slice(0, 7), days: {} };
    body.days[r.reading_date.slice(8)] = { v: r.value, note: r.note || '', by: r.entered_by || '', at: Date.parse(r.entered_at) || 0 };
    S.months.set(id, body);
    if (r.entered_at > newest) newest = r.entered_at;
  }
  SB.maxAt = newest;
}
async function sbFetchAllReadings(sinceIso) {
  const out = [], page = 1000;
  for (let from = 0; ; from += page) {
    let q = SB.client.from('readings').select('furnace_id, reading_date, value, note, entered_by, entered_at').order('furnace_id').order('reading_date').range(from, from + page - 1);
    if (sinceIso) q = q.gt('entered_at', sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}
async function sbLoadRequests() {
  const { data } = await SB.client.from('requests').select('*').order('created_at');
  S.requests = {};
  (data || []).forEach(q => { S.requests[q.id] = { fid: q.furnace_id, date: q.reading_date, msg: q.message, at: Date.parse(q.created_at), status: q.status, closedAt: q.closed_at ? Date.parse(q.closed_at) : 0 }; });
}
async function sbLoadAll() {
  try {
    const [f, s] = await Promise.all([SB.client.from('furnaces').select('*'), SB.client.from('settings').select('*').eq('id', 1).maybeSingle()]);
    if (f.error) throw f.error;
    S.furnaces = (f.data || []).map(rowToF).sort(byOrder);
    if (s.data) S.settings = { unit: s.data.unit, threshold: +s.data.threshold, window: s.data.window_days };
    S.months = new Map(); SB.maxAt = '';
    sbApplyRows(await sbFetchAllReadings());
    await sbLoadRequests();
    S.loaded.f = S.loaded.r = true;
    changed(true);
  } catch (e) { toast('Could not load data. Check the internet and reload.', true); }
}
async function sbPoll() {
  if (SB.role !== 'manager' || !S.loaded.r) return;
  try {
    const since = SB.maxAt;
    const rows = await sbFetchAllReadings(since);
    const fromSup = rows.filter(r => r.entered_by && r.entered_by !== (lsGet('midal-gas-by') || 'Manager') && r.entered_by !== 'Import');
    const f = await SB.client.from('furnaces').select('*');
    if (!f.error) S.furnaces = (f.data || []).map(rowToF).sort(byOrder);
    await sbLoadRequests();
    if (rows.length) sbApplyRows(rows);
    changed();
    if (fromSup.length && since) toast(`Received ${fromSup.length} new reading${fromSup.length > 1 ? 's' : ''} from ${fromSup[0].entered_by}`);
  } catch {}
}
async function sbWrite(changes, onProgress) {
  const by = lsGet('midal-gas-by') || 'Manager', now = new Date().toISOString();
  const ups = changes.filter(c => c.v != null).map(c => ({ furnace_id: c.fid, reading_date: c.date, value: c.v, note: c.note || '', entered_by: c.by ?? by, entered_by_id: SB.user.id, entered_at: now }));
  const dels = changes.filter(c => c.v == null);
  const batches = []; for (let i = 0; i < ups.length; i += 500) batches.push(ups.slice(i, i + 500));
  const delBy = new Map(); dels.forEach(c => { if (!delBy.has(c.fid)) delBy.set(c.fid, []); delBy.get(c.fid).push(c.date); });
  const total = batches.length + delBy.size; let done = 0;
  try {
    for (const b of batches) {
      const { error } = await SB.client.from('readings').upsert(b, { onConflict: 'furnace_id,reading_date' });
      if (error) throw error; onProgress && onProgress(++done, total);
    }
    for (const [fid, dates] of delBy) {
      const { error } = await SB.client.from('readings').delete().eq('furnace_id', fid).in('reading_date', dates);
      if (error) throw error; onProgress && onProgress(++done, total);
    }
    return true;
  } catch (e) { toast(sbErr(e), true); return false; }
}
function sbErr(e) {
  const m = (e && (e.message || e.details)) || '';
  if (/row-level security|permission denied|JWT/i.test(m)) return 'Not allowed for this login. Log out and log in as manager.';
  if (/fetch|network/i.test(m)) return 'No connection. Check the internet and try again.';
  return 'Could not save: ' + m.slice(0, 120);
}

/* ================= Simple supervisor app ================= */
const SS = { date: null, furnaces: [], last: {}, mine: {}, subs: [], reqs: [], idx: 0, screen: 'home', loading: true, sending: false, err: '' };
const draftKey = () => 'midal-sup-draft-' + (SB.user ? SB.user.id : 'x');
function drafts() { try { return JSON.parse(lsGet(draftKey()) || '{}'); } catch { return {}; } }
function saveDrafts(d) { lsSet(draftKey(), JSON.stringify(d)); }
function dayDraft() { const d = drafts(); return d[SS.date] || {}; }
function setDayDraft(obj) { const d = drafts(); d[SS.date] = obj; for (const k of Object.keys(d)) if (k < addDays(todayISO(), -35)) delete d[k]; saveDrafts(d); }
function supToday() { return todayISO(); }

async function startSimpleSup() {
  $('.app-name').textContent = T('appTitle');
  const lb = $('#langBtn'); lb.hidden = false; lb.textContent = T('lang');
  lb.onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); lb.textContent = T('lang'); $('.app-name').textContent = T('appTitle'); $('#logoutBtn').textContent = T('logout'); renderSimpleSup(); };
  $('#logoutBtn').textContent = T('logout');
  SS.date = supToday();
  await supLoad();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && SS.screen === 'home') supLoad(); });
}
async function supLoad() {
  SS.loading = true; renderSimpleSup();
  try {
    const [f, last, mine, subs, reqs] = await Promise.all([
      SB.client.from('furnaces').select('*'),
      SB.client.rpc('last_readings', { p_date: SS.date }),
      SB.client.rpc('my_day', { p_date: SS.date }),
      SB.client.rpc('my_submissions'),
      SB.client.rpc('my_requests'),
    ]);
    if (f.error) throw f.error;
    SS.furnaces = (f.data || []).map(rowToF).filter(x => x.active).sort(byOrder);
    SS.last = {}; (last.data || []).forEach(r => { SS.last[r.furnace_id] = r; });
    SS.mine = {}; (mine.data || []).forEach(r => { SS.mine[r.furnace_id] = r; });
    SS.subs = subs.data || []; SS.reqs = (reqs.data || []).filter(r => !r.answered);
    SS.err = '';
  } catch (e) { SS.err = T('noConn'); }
  SS.loading = false; renderSimpleSup();
}
function supVal(fid) { const d = dayDraft()[fid]; if (d) return d; const m = SS.mine[fid]; return m ? { v: String(m.value), note: m.note || '', ok: true } : { v: '', note: '' }; }
function supSet(fid, patch) { const dd = dayDraft(); dd[fid] = { ...supVal(fid), ...patch }; setDayDraft(dd); }

/* red / green check — every rule is about a real reading mistake */
function supCheck(f, s) {
  const out = { state: 'empty' };
  if (!s || s === '.') return out;
  const v = Number(s); if (!isFinite(v)) return { state: 'red', msg: T('high') };
  const L = SS.last[f.id], typ = L && L.typical > 0 ? L.typical : null;
  if (f.mode === 'consumption') {
    if (typ && (v > typ * 3 || (v > 0 && v < typ / 3))) return { state: 'red', msg: v > typ ? T('high') : T('low'), used: v };
    return { state: 'ok', msg: v === 0 ? T('zero') : T('ok'), used: v };
  }
  if (!L || L.prev_value == null) return { state: 'ok', msg: T('first') };
  const p = L.prev_value, gap = Math.max(1, diffDays(L.prev_date, SS.date));
  if (v < p) return { state: 'red', msg: v * 10 >= p && v * 10 <= p * 1.5 ? T('missing') : T('lower') };
  const used = (v - p) / gap;
  if (used === 0) return { state: 'ok', msg: T('zero'), used, gap };
  if (typ) {
    if (used > typ * 3) { const alt = (v / 10 - p) / gap; return { state: 'red', msg: alt >= 0 && alt <= typ * 3 ? T('decimal') : T('high'), used, gap }; }
    if (used < typ / 3) return { state: 'red', msg: T('low'), used, gap };
  } else if (p > 1000 && v > p * 1.5) return { state: 'red', msg: T('decimal'), used, gap };
  return { state: 'ok', msg: T('ok'), used, gap };
}
function supStatus(f) { const d = supVal(f.id), c = supCheck(f, d.v); return c.state === 'red' && d.ok ? { ...c, state: 'confirmed' } : c; }

function renderSimpleSup() {
  const main = $('#main');
  main.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  main.classList.add('sp-main');
  if (SS.loading) { main.innerHTML = `<div class="sp"><div class="loading">${T('loading')}</div></div>`; return; }
  if (SS.err && !SS.furnaces.length) { main.innerHTML = `<div class="sp"><div class="sp-msg red">${esc(SS.err)}</div><button class="sp-big" id="spRetry">↻</button></div>`; $('#spRetry').onclick = supLoad; return; }
  if (!SS.furnaces.length) { main.innerHTML = `<div class="sp"><div class="sp-msg">${T('noFurnaces')}</div></div>`; return; }
  ({ home: spHome, entry: spEntry, review: spReview, done: spDone })[SS.screen](main);
}
function spCounts() {
  let entered = 0, red = 0;
  SS.furnaces.forEach(f => { const st = supStatus(f); if (st.state !== 'empty') entered++; if (st.state === 'red') red++; });
  return { entered, red, total: SS.furnaces.length };
}
function spHome(main) {
  const t = supToday(), y = addDays(t, -1);
  const sub = SS.subs.find(s => s.reading_date === SS.date);
  const draftN = Object.values(dayDraft()).filter(x => x && x.v).length;
  main.innerHTML = `<div class="sp">
    ${SS.reqs.length ? `<div class="sp-reqs"><div class="sp-reqs-t">⚠ ${T('asks')}</div>${SS.reqs.map(r => { const f = SS.furnaces.find(x => x.id === r.furnace_id); return `<button class="sp-req" data-req="${esc(r.furnace_id)}|${r.reading_date}"><strong>${esc(f ? f.name : '')}</strong> · ${dayLabel(r.reading_date)}<span>“${esc(r.message)}”</span><em>${T('checkNow')} ›</em></button>`; }).join('')}</div>` : ''}
    <div class="sp-days">
      ${[t, y].map(d => `<button class="sp-day ${SS.date === d ? 'on' : ''}" data-day="${d}"><strong>${d === t ? T('today') : T('yesterday')}</strong><span>${dayLabel(d)}</span></button>`).join('')}
    </div>
    <div class="sp-state ${sub ? 'sent' : ''}">${sub ? `✓ ${T('sent')} · ${sub.furnaces} / ${SS.furnaces.length} · ${T('sentAt')} ${new Date(sub.sent_at).toLocaleTimeString(LANG === 'ar' ? 'ar-BH' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}` : T('notSent')}</div>
    <button class="sp-big" id="spStart">${sub ? T('editSent') : draftN ? `${T('cont')} (${draftN} ${T('of')} ${SS.furnaces.length})` : T('start')}</button>
  </div>`;
  $$('[data-day]', main).forEach(b => b.onclick = async () => { SS.date = b.dataset.day; await supLoad(); });
  $('#spStart').onclick = () => { const i = SS.furnaces.findIndex(f => supStatus(f).state === 'empty'); SS.idx = sub || i < 0 ? 0 : i; SS.screen = 'entry'; renderSimpleSup(); };
  $$('[data-req]', main).forEach(b => b.onclick = async () => {
    const [fid, date] = b.dataset.req.split('|');
    if (date !== SS.date) { SS.date = date; await supLoad(); }
    SS.idx = Math.max(0, SS.furnaces.findIndex(f => f.id === fid)); SS.screen = 'entry'; renderSimpleSup();
  });
}
function spEntry(main) {
  const f = SS.furnaces[SS.idx], d = supVal(f.id), st = supStatus(f), L = SS.last[f.id];
  /* Stopped / Maintenance / Meter problem = no gas counted: the meter stays at the last reading */
  const same = f.mode === 'consumption' ? '0' : L && L.prev_value != null ? String(L.prev_value) : null;
  const n = SS.furnaces.length, isLast = SS.idx === n - 1;
  const g = groupOf(f);
  main.innerHTML = `<div class="sp sp-entry">
    <div class="sp-dots">${SS.furnaces.map((x, i) => { const s = supStatus(x).state; return `<button class="sp-dot ${s} ${i === SS.idx ? 'cur' : ''}" data-go="${i}" aria-label="${esc(x.name)}"></button>`; }).join('')}</div>
    <div class="sp-head"><span class="sp-step">${SS.idx + 1} ${T('of')} ${n} · ${dayLabel(SS.date)}</span></div>
    <div class="sp-card" style="--gc:${gColor(g)}">
      <div class="sp-name">${esc(f.name)}</div>
      <div class="sp-last">${f.mode === 'consumption' ? '' : L && L.prev_value != null ? `${T('last')}: <strong dir="ltr">${fmt(L.prev_value, 2)}</strong> · ${dayLabel(L.prev_date)}` : T('noPrev')}</div>
      <div class="sp-num ${st.state}" dir="ltr" aria-live="polite">${d.v ? esc(d.v) : `<span class="ph">${T('typed')}</span>`}</div>
      <div class="sp-check ${st.state}">${st.state === 'empty' ? '&nbsp;' : `${st.state === 'red' ? '✕' : '✓'} ${esc(st.msg)}${st.used != null && st.state !== 'empty' && f.mode !== 'consumption' ? ` · ${T('used')} <span dir="ltr">${fmt(st.used)}</span>${st.gap > 1 ? ' ' + T('perDay') : ''}` : ''}`}</div>
      <div class="sp-chips">
        ${['stopped', 'maint', 'meter'].map(k => `<button class="sp-chip ${d.note === T(k) ? 'on' : ''}" data-chip="${k}">${T(k)}${same != null ? `<small>${T(f.mode === 'consumption' ? 'zeroHint' : 'stoppedHint')}</small>` : ''}</button>`).join('')}
      </div>
    </div>
    <div class="sp-pad" dir="ltr">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button class="sp-key ${k === '⌫' ? 'del' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="sp-nav">
      <button class="sp-btn ghost" id="spPrev">${SS.idx === 0 ? '⌂' : (LANG === 'ar' ? '› ' : '‹ ') + T('prev')}</button>
      <button class="sp-btn ${st.state === 'red' ? 'red' : ''}" id="spNext">${!d.v ? T('skip') : isLast ? T('review') : T('next')} ${LANG === 'ar' ? '‹' : '›'}</button>
    </div>
  </div>`;
  const press = k => {
    let v = supVal(f.id).v || '';
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
    else { if (v === '0') v = ''; const [ip, dp] = v.split('.'); if (dp != null ? dp.length >= 3 : (ip || '').length >= 10) return; v += k; }
    supSet(f.id, { v, ok: false }); renderSimpleSup();
  };
  $$('[data-k]', main).forEach(b => b.onclick = () => press(b.dataset.k));
  SS.keyHandler && document.removeEventListener('keydown', SS.keyHandler);
  SS.keyHandler = e => { if (SS.screen !== 'entry' || $$('dialog').some(x => x.open)) return; if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === '.' || e.key === ',') press('.'); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Enter') $('#spNext')?.click(); };
  document.addEventListener('keydown', SS.keyHandler);
  $$('[data-chip]', main).forEach(b => b.onclick = () => {
    const kind = b.dataset.chip, label = T(kind), cur = supVal(f.id);
    if (cur.note === label) supSet(f.id, { note: '', ...(same != null && cur.v === same ? { v: '' } : {}) });
    else supSet(f.id, { note: label, ...(same != null ? { v: same, ok: false } : {}) });
    renderSimpleSup();
  });
  $$('[data-go]', main).forEach(b => b.onclick = () => { SS.idx = +b.dataset.go; renderSimpleSup(); });
  $('#spPrev').onclick = () => { if (SS.idx === 0) { SS.screen = 'home'; } else SS.idx--; renderSimpleSup(); };
  $('#spNext').onclick = async () => {
    if (st.state === 'red') {
      const ok = await confirmBox({ title: T('confirmT'), body: `${f.name}: ${d.v} — ${st.msg}. ${T('confirmB')}`, ok: T('correct'), danger: true });
      if (!ok) return;
      supSet(f.id, { ok: true, note: supVal(f.id).note || T('confirmedNote') });
    }
    if (isLast) SS.screen = 'review'; else SS.idx++;
    renderSimpleSup();
  };
}
function spReview(main) {
  const c = spCounts();
  main.innerHTML = `<div class="sp">
    <div class="sp-sum"><span class="g">${c.entered} ${T('entered')}</span><span>${c.total - c.entered} ${T('skipped')}</span>${c.red ? `<span class="r">${c.red} ${T('check')}</span>` : ''}</div>
    <p class="sp-hint">${T('tapToChange')}</p>
    <div class="sp-list">${SS.furnaces.map((f, i) => { const d = supVal(f.id), st = supStatus(f); return `<button class="sp-row ${st.state}" data-edit="${i}">
      <span class="nm">${esc(f.name)}</span><span class="v" dir="ltr">${d.v ? esc(d.v) : '—'}</span><span class="s">${st.state === 'red' ? '✕' : st.state === 'empty' ? '' : st.state === 'confirmed' ? '!' : '✓'}</span>
      ${d.note ? `<span class="nt">${esc(d.note)}</span>` : ''}</button>`; }).join('')}</div>
    <div class="sp-nav"><button class="sp-btn ghost" id="spBackE">${LANG === 'ar' ? '› ' : '‹ '}${T('prev')}</button><button class="sp-btn send" id="spSend" ${SS.sending ? 'disabled' : ''}>${SS.sending ? T('sending') : T('send')}</button></div>
    ${SS.err ? `<div class="sp-msg red">${esc(SS.err)}</div>` : ''}
  </div>`;
  $$('[data-edit]', main).forEach(b => b.onclick = () => { SS.idx = +b.dataset.edit; SS.screen = 'entry'; renderSimpleSup(); });
  $('#spBackE').onclick = () => { SS.idx = SS.furnaces.length - 1; SS.screen = 'entry'; renderSimpleSup(); };
  $('#spSend').onclick = spSend;
}
async function spSend() {
  const c = spCounts();
  if (c.red) { toast(T('fixRed'), true); return; }
  const items = SS.furnaces.map(f => ({ f, d: supVal(f.id) })).filter(x => x.d.v && x.d.v !== '.' && isFinite(Number(x.d.v)))
    .map(x => ({ furnace_id: x.f.id, value: Number(x.d.v), note: x.d.note || '' }));
  if (!items.length) { toast(T('nothing'), true); return; }
  SS.sending = true; SS.err = ''; renderSimpleSup();
  try {
    const { data, error } = await SB.client.rpc('submit_readings', { p_date: SS.date, p_items: items, p_by: '' });
    if (error) throw error;
    const d = drafts(); delete d[SS.date]; saveDrafts(d);
    SS.sent = { n: data, date: SS.date }; SS.screen = 'done';
    SS.sending = false;
    await supLoad(); SS.screen = 'done'; renderSimpleSup();
  } catch (e) {
    SS.sending = false;
    SS.err = /fetch|network|Failed/i.test((e && e.message) || '') ? T('offline') : ((e && e.message) || T('offline'));
    renderSimpleSup();
  }
}
function spDone(main) {
  main.innerHTML = `<div class="sp sp-done"><div class="sp-tick">✓</div><h2>${T('doneT')}</h2><p>${T('doneB', { n: SS.sent ? SS.sent.n : '', d: dayLabel(SS.sent ? SS.sent.date : SS.date) })}</p><button class="sp-big" id="spHome">${T('home')}</button></div>`;
  $('#spHome').onclick = () => { SS.screen = 'home'; renderSimpleSup(); };
}

/* =========================================================
   Import & export
   ========================================================= */
function parseDate(v, dayFirst) {
  if (v == null || v === '') return null;
  let y, m, d;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return fromUTC(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
  }
  if (v instanceof Date && !isNaN(v)) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); }
  else {
    const s = String(v).trim();
    let r;
    if ((r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { y = +r[3]; if (y < 100) y += 2000; if (dayFirst) { d = +r[1]; m = +r[2]; } else { m = +r[1]; d = +r[2]; } }
    else if ((r = s.match(/^(\d{1,2})[\s\-/.]*([A-Za-z]{3,})[\s\-/.,]*(\d{2,4})/))) { d = +r[1]; m = MON.findIndex(x => r[2].toLowerCase().startsWith(x.toLowerCase())) + 1; y = +r[3]; if (y < 100) y += 2000; }
    else if ((r = s.match(/^([A-Za-z]{3,})[\s\-/.]*(\d{1,2}),?[\s\-/.]*(\d{4})/))) { m = MON.findIndex(x => r[1].toLowerCase().startsWith(x.toLowerCase())) + 1; d = +r[2]; y = +r[3]; }
    else return null;
  }
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = ymd(y, m, d);
  return fromUTC(toUTC(iso)) === iso ? iso : null;
}
function detectDayFirst(values) {
  let df = 0, mf = 0;
  values.forEach(v => { const r = typeof v === 'string' && v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/); if (r) { if (+r[1] > 12) df++; if (+r[2] > 12) mf++; } });
  return mf > df ? false : true;
}

function loadSheet(imp, name) {
  const ws = imp.wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  imp.sheet = name; imp.rows = rows;
  imp.nCols = rows.reduce((x, r) => Math.max(x, r.length), 0);
  // header row: first row in top 15 with 2+ text cells
  let hr = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) { const t = (rows[i] || []).filter(c => typeof c === 'string' && c.trim()).length; if (t >= 2) { hr = i; break; } }
  imp.headerRow = hr;
  autoDetect(imp);
}
function colValues(imp, c) { return imp.rows.slice(imp.headerRow + 1).map(r => (r || [])[c]).filter(v => v != null && v !== ''); }
function header(imp, c) { const h = (imp.rows[imp.headerRow] || [])[c]; return h == null || h === '' ? `Column ${XLSX.utils.encode_col(c)}` : String(h).trim(); }
function autoDetect(imp) {
  const cols = [...Array(imp.nCols).keys()];
  const allStr = cols.flatMap(c => colValues(imp, c).slice(0, 200)).filter(v => typeof v === 'string');
  imp.dayFirst = detectDayFirst(allStr);
  let best = -1, bestN = 0;
  cols.forEach(c => { const vs = colValues(imp, c).slice(0, 200); const n = vs.filter(v => parseDate(v, imp.dayFirst)).length; if (n > bestN && n >= vs.length * .5) { best = c; bestN = n; } });
  imp.dateCol = best;
  // long layout?
  const others = cols.filter(c => c !== best);
  const textCols = others.filter(c => { const vs = colValues(imp, c); const t = vs.filter(v => typeof v === 'string' && parseNum(v) == null).length; return vs.length && t / vs.length > .7; });
  const numCols = others.filter(c => { const vs = colValues(imp, c); return vs.length && vs.filter(v => parseNum(v) != null).length / vs.length > .7; });
  const textDistinct = textCols.map(c => ({ c, n: new Set(colValues(imp, c).map(v => String(v).trim())).size })).filter(x => x.n >= 2 && x.n <= 80).sort((a, b) => b.n - a.n);
  if (textDistinct.length && numCols.length >= 1 && numCols.length <= 3) {
    imp.layout = 'long'; imp.furnaceCol = textDistinct[0].c;
    imp.valueCol = numCols.sort((a, b) => colValues(imp, b).length - colValues(imp, a).length)[0];
  } else {
    imp.layout = 'wide'; imp.furnaceCol = textCols[0] ?? -1; imp.valueCol = numCols[0] ?? -1;
  }
  buildMapping(imp);
}
function matchFurnace(name) {
  const n = norm(hfName(name)); if (!n) return null;
  return S.furnaces.find(f => norm(hfName(f.name)) === n || (f.code && norm(f.code) === n)) || null;
}
function buildMapping(imp) {
  imp.map = {};
  if (imp.layout === 'wide') {
    for (let c = 0; c < imp.nCols; c++) {
      if (c === imp.dateCol) continue;
      const vs = colValues(imp, c), nums = vs.filter(v => parseNum(v) != null).length;
      const h = header(imp, c), m = matchFurnace(h);
      const skipWord = /total|sum|remark|comment|note|day|shift|average|avg/i.test(h);
      imp.map[c] = m ? m.id : nums && !skipWord ? 'new' : 'skip';
    }
  } else if (imp.furnaceCol >= 0) {
    const names = [...new Set(colValues(imp, imp.furnaceCol).map(v => String(v).trim()))];
    names.forEach(n => { const m = matchFurnace(n); imp.map[n] = m ? m.id : 'new'; });
  }
}
function collectReadings(imp) {
  const out = new Map(); // key target|date -> {target, name, date, v}
  let badDates = 0;
  const rows = imp.rows.slice(imp.headerRow + 1);
  let ri = 0;
  for (const r of rows) {
    ri++;
    if (!r) continue;
    const date = parseDate(r[imp.dateCol], imp.dayFirst);
    if (!date) { if (r.some(v => v != null && v !== '')) badDates++; continue; }
    if (imp.layout === 'wide') {
      for (const [c, t] of Object.entries(imp.map)) {
        if (t === 'skip') continue;
        const v = parseNum(r[c]); if (v == null) continue;
        const name = header(imp, +c), target = t === 'new' ? 'new:' + name : t;
        out.set(target + '|' + date, { target, name, date, v, ord: +c });
      }
    } else {
      const name = String(r[imp.furnaceCol] ?? '').trim(), t = imp.map[name];
      if (!name || !t || t === 'skip') continue;
      const v = parseNum(r[imp.valueCol]); if (v == null) continue;
      const target = t === 'new' ? 'new:' + name : t;
      const k = target + '|' + date;
      out.set(k, { target, name, date, v, ord: out.get(k)?.ord ?? ri });
    }
  }
  const list = [...out.values()].sort((a, b) => a.date < b.date ? -1 : 1);
  return { list, badDates };
}

function viewData(main) {
  const imp = S.imp;
  const ro = !S.canWrite;
  const hasXLSX = !!window.XLSX;
  let body = '';
  if (!hasXLSX) body = '<div class="notice warn">The spreadsheet reader could not load. Check the internet connection and reload.</div>';
  else if (ro) body = '<p class="muted">You have view-only access, so data can’t be imported.</p>';
  else if (!imp) body = `
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose an Excel or CSV file">
      <strong>Drop your Excel sheet here</strong>
      <span class="muted">or click to choose a file · .xlsx, .xls or .csv</span>
      <input type="file" id="file" accept=".xlsx,.xls,.xlsm,.csv" hidden>
    </div>
    <p class="muted" style="font-size:13px;margin:12px 0 0">Two layouts work: one row per day with a column for each furnace, or one row per reading with date, furnace and value columns. You can check the mapping before anything is saved. <a href="#" id="tpl">Download a blank template</a> with your current furnaces.</p>`;
  else body = importMapper(imp);

  main.innerHTML = `
  <div class="page-head"><div class="grow"><h1>Import &amp; export</h1><p class="sub">Bring in your historic Excel sheet, or take everything out as a workbook for reports and backup.</p></div></div>
  <section class="panel"><div class="ph"><h2>Import from Excel</h2>${imp ? `<p>${esc(imp.fileName)}</p>` : ''}</div>${body}</section>
  <section class="panel">
    <div class="ph"><h2>Export</h2><p>${S.furnaces.length} furnaces · ${[...S.months.values()].reduce((x, b) => x + Object.keys(b.days || {}).length, 0)} readings</p></div>
    <p class="muted" style="margin:0 0 14px">The Excel workbook has sheets for raw readings, daily consumption, monthly totals, flagged days and the furnace list.</p>
    <div class="actions"><button class="btn primary" id="xAll" ${!hasXLSX || !S.furnaces.length ? 'disabled' : ''}>Export Excel workbook</button><button class="btn" id="xCsv" ${!S.furnaces.length ? 'disabled' : ''}>Export CSV</button></div>
  </section>`;

  const drop = $('#drop'), file = $('#file');
  if (drop) {
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; f && readFile(f); });
    file.addEventListener('change', () => file.files[0] && readFile(file.files[0]));
  }
  const tpl = $('#tpl'); tpl && tpl.addEventListener('click', e => { e.preventDefault(); exportTemplate(); });
  $('#xAll').addEventListener('click', () => exportWorkbook(S.furnaces));
  $('#xCsv').addEventListener('click', exportCsv);
  if (imp) bindMapper(main, imp);
}
async function readFile(f) {
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
    const imp = { fileName: f.name, wb, valueType: 'meter', conflict: 'replace' };
    const best = wb.SheetNames.map(n => ({ n, size: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false }) || []).length })).sort((a, b) => b.size - a.size)[0];
    loadSheet(imp, best.n);
    S.imp = imp; render(true);
  } catch (e) { toast('That file could not be read. Save it as .xlsx and try again.', true); }
}
function importMapper(imp) {
  const colOpts = sel => [...Array(imp.nCols).keys()].map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>${esc(header(imp, c))}</option>`).join('');
  const target = (key, cur, label, sub) => `<div class="map-row"><div class="hd" title="${esc(label)}">${esc(label)} <small>${esc(sub)}</small></div>
    <select data-map="${esc(key)}"><option value="skip" ${cur === 'skip' ? 'selected' : ''}>Don’t import</option><option value="new" ${cur === 'new' ? 'selected' : ''}>New furnace “${esc(hfName(label))}”</option>${S.furnaces.map(f => `<option value="${esc(f.id)}" ${cur === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>`;
  let mapping = '';
  if (imp.layout === 'wide') {
    mapping = Object.keys(imp.map).map(c => target(c, imp.map[c], header(imp, +c), `${colValues(imp, +c).filter(v => parseNum(v) != null).length} values`)).join('');
  } else {
    const counts = {}; colValues(imp, imp.furnaceCol).forEach(v => { const k = String(v).trim(); counts[k] = (counts[k] || 0) + 1; });
    mapping = Object.keys(imp.map).map(n => target(n, imp.map[n], n, `${counts[n] || 0} rows`)).join('');
  }
  const { list, badDates } = imp.dateCol >= 0 ? collectReadings(imp) : { list: [], badDates: 0 };
  const newCount = new Set(list.filter(x => x.target.startsWith('new:')).map(x => x.target)).size;
  const tgtCount = new Set(list.map(x => x.target)).size;
  const existing = list.filter(x => !x.target.startsWith('new:') && entryAt(x.target, x.date)).length;
  const sample = list.slice(0, 8);
  return `
  <div class="opts">
    <label class="f">Sheet<select id="iSheet">${imp.wb.SheetNames.map(n => `<option ${n === imp.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label class="f">Header row<input type="number" id="iHdr" min="1" value="${imp.headerRow + 1}" style="width:80px"></label>
    <label class="f">Layout<select id="iLayout"><option value="wide" ${imp.layout === 'wide' ? 'selected' : ''}>One column per furnace</option><option value="long" ${imp.layout === 'long' ? 'selected' : ''}>One row per reading</option></select></label>
    <label class="f">Date column<select id="iDate">${imp.dateCol < 0 ? '<option value="-1">Choose…</option>' : ''}${colOpts(imp.dateCol)}</select></label>
    <label class="f">Dates written as<select id="iDF"><option value="1" ${imp.dayFirst ? 'selected' : ''}>Day first (31/12/2025)</option><option value="0" ${!imp.dayFirst ? 'selected' : ''}>Month first (12/31/2025)</option></select></label>
    ${imp.layout === 'long' ? `<label class="f">Furnace column<select id="iFC">${colOpts(imp.furnaceCol)}</select></label><label class="f">Value column<select id="iVC">${colOpts(imp.valueCol)}</select></label>` : ''}
  </div>
  <h2 style="font-size:15px;margin:4px 0 10px">Match ${imp.layout === 'wide' ? 'columns' : 'names'} to furnaces</h2>
  <div class="map-grid">${mapping || '<p class="muted">No columns found.</p>'}</div>
  <div class="opts">
    <label class="f">New furnaces’ values are<select id="iVT"><option value="meter" ${imp.valueType === 'meter' ? 'selected' : ''}>Cumulative meter readings</option><option value="consumption" ${imp.valueType === 'consumption' ? 'selected' : ''}>Daily consumption</option></select></label>
    <label class="f">When a day already has a value<select id="iCf"><option value="replace" ${imp.conflict === 'replace' ? 'selected' : ''}>Replace with the file’s value</option><option value="keep" ${imp.conflict === 'keep' ? 'selected' : ''}>Keep the saved value</option></select></label>
  </div>
  ${imp.dateCol < 0 ? '<div class="notice warn">No date column was found. Pick the column that holds the reading dates.</div>' : ''}
  ${badDates ? `<div class="notice warn">${badDates} rows have a date that couldn’t be read and will be skipped. Check “Dates written as” or the header row.</div>` : ''}
  ${list.length ? `<div class="notice">Ready to import <strong>${nf0.format(list.length)}</strong> values for ${tgtCount} furnaces, ${fmtDate(list[0].date)} to ${fmtDate(list[list.length - 1].date)}.${newCount ? ` ${newCount} new furnace${newCount > 1 ? 's' : ''} will be created.` : ''}${existing ? ` ${existing} days already have saved values.` : ''}</div>
  <div class="tw"><table class="preview"><thead><tr><th>Date</th><th>Furnace</th><th class="num">Value</th></tr></thead><tbody>${sample.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.target.startsWith('new:') ? hfName(x.name) + ' (new)' : furnace(x.target)?.name)}</td><td class="num">${fmt(x.v, 2)}</td></tr>`).join('')}${list.length > 8 ? `<tr><td colspan="3" class="muted">and ${nf0.format(list.length - 8)} more</td></tr>` : ''}</tbody></table></div>` : ''}
  <div id="iProg" hidden style="margin-top:14px"><div class="progress"><i></i></div><p class="muted" style="font-size:13px;margin:6px 0 0" id="iProgT"></p></div>
  <div class="actions" style="margin-top:16px"><button class="btn primary" id="iGo" ${list.length ? '' : 'disabled'}>Import ${list.length ? nf0.format(list.length) + ' values' : ''}</button><button class="btn" id="iCancel">Choose another file</button></div>`;
}
function bindMapper(main, imp) {
  const on = (id, fn) => { const el = $(id, main); el && el.addEventListener('change', () => { fn(el.value); render(true); }); };
  on('#iSheet', v => loadSheet(imp, v));
  on('#iHdr', v => { imp.headerRow = Math.max(0, Math.min(imp.rows.length - 1, (+v || 1) - 1)); autoDetect(imp); });
  on('#iLayout', v => { imp.layout = v; if (v === 'long' && imp.furnaceCol < 0) imp.furnaceCol = [...Array(imp.nCols).keys()].find(c => c !== imp.dateCol) ?? 0; if (v === 'long' && imp.valueCol < 0) imp.valueCol = [...Array(imp.nCols).keys()].reverse().find(c => c !== imp.dateCol) ?? 0; buildMapping(imp); });
  on('#iDate', v => { imp.dateCol = +v; buildMapping(imp); });
  on('#iDF', v => { imp.dayFirst = v === '1'; });
  on('#iFC', v => { imp.furnaceCol = +v; buildMapping(imp); });
  on('#iVC', v => { imp.valueCol = +v; });
  on('#iVT', v => { imp.valueType = v; });
  on('#iCf', v => { imp.conflict = v; });
  $$('[data-map]', main).forEach(s => s.addEventListener('change', () => { imp.map[s.dataset.map] = s.value; render(true); }));
  $('#iCancel', main).addEventListener('click', () => { S.imp = null; render(true); });
  $('#iGo', main).addEventListener('click', () => runImport(imp));
}
async function runImport(imp) {
  const { list } = collectReadings(imp);
  if (!list.length) return;
  $('#iGo').disabled = true; $('#iCancel').disabled = true;
  const prog = $('#iProg'), bar = prog.querySelector('i'), txt = $('#iProgT'); prog.hidden = false;
  // create new furnaces
  const firstOrd = {};
  list.forEach(x => { if (x.target.startsWith('new:') && !(firstOrd[x.target] <= x.ord)) firstOrd[x.target] = x.ord; });
  const rank = t => { const n = hfName(t.slice(4)), ty = hfType(n); return ty === 'HF' ? 0 : ty === 'TF' ? 1 : 2; };
  const numOf = t => +(hfName(t.slice(4)).match(/\d+/) || [0])[0];
  const newNames = Object.keys(firstOrd).sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? numOf(a) - numOf(b) : firstOrd[a] - firstOrd[b]));
  // group by name prefix, e.g. "HF 3" -> HF, when several share it
  const prefix = n => { const m = n.match(/^([A-Za-z]{1,6})[\s\-_#]*\d+/); return m ? m[1].toUpperCase() : ''; };
  const pc = {}; newNames.forEach(t => { const p = prefix(t.slice(4)); if (p) pc[p] = (pc[p] || 0) + 1; });
  const idFor = {};
  let order = Math.max(0, ...S.furnaces.map(f => f.order || 0));
  for (const t of newNames) {
    const name = hfName(t.slice(4)), ty = hfType(name);
    const f = { id: newId('f'), name, code: ty ? name.replace(' ', '') : '', group: ty || (pc[prefix(name)] >= 2 ? prefix(name) : ''), mode: imp.valueType, active: true, order: ++order };
    txt.textContent = `Creating ${name}…`;
    if (!await saveFurnace(f)) { $('#iGo').disabled = false; $('#iCancel').disabled = false; return; }
    idFor[t] = f.id;
  }
  let changes = list.map(x => ({ fid: idFor[x.target] || x.target, date: x.date, v: x.v, note: '' , by: 'Import' }));
  if (imp.conflict === 'keep') changes = changes.filter(c => !entryAt(c.fid, c.date));
  txt.textContent = `Saving ${nf0.format(changes.length)} values…`;
  const ok = await putEntries(changes, (d, n) => { bar.style.width = (d / n * 100).toFixed(0) + '%'; txt.textContent = `Saving month ${d} of ${n}…`; });
  if (ok) { toast(`Imported ${nf0.format(changes.length)} values`); S.imp = null; go('overview'); }
  else { $('#iGo').disabled = false; $('#iCancel').disabled = false; }
}

/* ---------- export ---------- */
async function saveFile(filename, data) {
  let dl = null;
  if (window.claude && typeof window.claude.use === 'function') { try { dl = await window.claude.use('downloads'); } catch {} }
  if (dl) {
    try { await dl.save({ filename, data }); return; }
    catch (e) { if (e && (e.code === 'declined')) return; if (e && e.code === 'rate_limited') { toast('A save prompt is already open.', true); return; } }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch { toast('Downloads aren’t available here.', true); }
}
const stamp = () => todayISO();
function exportWorkbook(list) {
  if (!window.XLSX) { toast('The spreadsheet library didn’t load.', true); return; }
  const wb = XLSX.utils.book_new();
  list = [...list].sort(byOrder);
  const an = list.map(f => ({ f, a: analyse(f) }));
  const gl = groupsOf(list), multi = gl.length > 1;
  const gHead = multi ? gl.map(g => g + ' total') : [];
  const names = an.map(x => x.f.name);
  // readings
  const rDates = [...new Set(an.flatMap(x => x.a.entries.map(e => e.date)))].sort();
  const rd = [['Date', ...names]];
  const byDate = an.map(x => new Map(x.a.entries.map(e => [e.date, e.v])));
  rDates.forEach(d => rd.push([d, ...byDate.map(m => m.has(d) ? m.get(d) : null)]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rd), 'Readings');
  // daily consumption
  const cDates = [...new Set(an.flatMap(x => x.a.days))].sort();
  const cs = [['Date', ...names, ...gHead, 'Total']];
  cDates.forEach(d => { let t = 0; const gt = {}; const row = an.map(x => { const r = x.a.daily.get(d); if (r && r.c != null) { t += r.c; const g = groupOf(x.f); gt[g] = (gt[g] || 0) + r.c; return Math.round(r.c * 100) / 100; } return null; }); cs.push([d, ...row, ...(multi ? gl.map(g => Math.round((gt[g] || 0) * 100) / 100) : []), Math.round(t * 100) / 100]); });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cs), 'Daily consumption');
  // monthly
  const months = [...new Set(cDates.map(d => d.slice(0, 7)))].sort();
  const ms = [['Month', ...names, ...gHead, 'Total']];
  months.forEach(m => { let t = 0; const gt = {}; const row = an.map(x => { let s = 0; x.a.days.forEach(d => { if (d.startsWith(m)) { const r = x.a.daily.get(d); if (r.c != null) s += r.c; } }); t += s; const g = groupOf(x.f); gt[g] = (gt[g] || 0) + s; return Math.round(s); }); ms.push([m, ...row, ...(multi ? gl.map(g => Math.round(gt[g] || 0)) : []), Math.round(t)]); });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ms), 'Monthly totals');
  // flags
  const fl = [['Date', 'Furnace', 'Used', 'Usual', 'Status']];
  an.forEach(({ f, a }) => a.days.forEach(d => { const r = a.daily.get(d); if (['high', 'low', 'drop'].includes(r.status)) fl.push([d, f.name, r.c == null ? null : Math.round(r.c * 100) / 100, r.base == null ? null : Math.round(r.base), statusLabel[r.status]]); }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fl), 'Flagged days');
  const fs = [['Name', 'Code', 'Group', 'Values entered as', 'Active']];
  list.forEach(f => fs.push([f.name, f.code || '', f.group || '', f.mode === 'consumption' ? 'Daily consumption' : 'Meter reading', f.active !== false ? 'Yes' : 'No']));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fs), 'Furnaces');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const fname = list.length === 1 ? `${list[0].name.replace(/[^\w\- ]+/g, '')} gas ${stamp()}.xlsx` : !multi && list.length < activeFurnaces().length ? `Midal ${gl[0]} furnaces gas ${stamp()}.xlsx` : `Midal furnace gas ${stamp()}.xlsx`;
  saveFile(fname, new Blob([out]));
}
function exportCsv() {
  const q = v => { let s = String(v ?? ''); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Date', 'Furnace', 'Code', 'Group', 'Value', 'Used', 'Status', 'Note', 'Entered by'].join(',')];
  S.furnaces.forEach(f => { const a = analyse(f); a.entries.forEach(e => { const r = a.daily.get(e.date); lines.push([e.date, f.name, f.code, f.group, e.v, r && r.c != null ? Math.round(r.c * 100) / 100 : '', r ? statusLabel[r.status] : '', e.note, e.by].map(q).join(',')); }); });
  saveFile(`Midal furnace gas ${stamp()}.csv`, lines.join('\n'));
}
function exportTemplate() {
  if (!window.XLSX) return;
  const wb = XLSX.utils.book_new();
  const names = activeFurnaces().map(f => f.name);
  const ws = XLSX.utils.aoa_to_sheet([['Date', ...(names.length ? names : [...Array.from({ length: 9 }, (_, i) => 'HF ' + (i + 1)), ...Array.from({ length: 9 }, (_, i) => 'TF ' + (i + 1))])], [todayISO()]]);
  XLSX.utils.book_append_sheet(wb, ws, 'Readings');
  saveFile('Furnace gas template.xlsx', new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })]));
}

/* =========================================================
   Boot
   ========================================================= */
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render(true)); } catch {}
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => S.charts.forEach(c => c.resize()), 150); });
Store.init();
})();
