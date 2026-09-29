// Actualiza docs/data/season.json desde la web de la FEB y envía los avisos push.
// Se ejecuta cada hora con GitHub Actions (.github/workflows/actualizar.yml).
import {
  readJSON, writeJSON, fetchMatch, isFinished, sendPush, madridParts,
  fmtDay, fmtTime, nowISO
} from './lib.mjs';

const SEASON = 'docs/data/season.json';
const SUBS = 'push/subscriptions.json';
const STATE = 'push/state.json';

const D = readJSON(SEASON);
const state = readJSON(STATE, { sent: [] });
const TEAM = D.team;
const SHORT = D.short || {};
const now = Date.now();
const t = (iso) => new Date(iso).getTime();
const H = 3600e3;
const notes = [];
let changed = false;

const rivalOf = (m) => (m.home === TEAM ? m.away : m.home);
const short = (name) => SHORT[name] || name;
const vs = (m) => (m.home === TEAM ? `vs ${short(rivalOf(m))}` : `en ${short(rivalOf(m))}`);
const wasSent = (k) => state.sent.includes(k);
const markSent = (k) => { state.sent.push(k); state.sent = state.sent.slice(-300); };

if (process.argv.includes('--test-push')) {
  await sendPush(SUBS, { title: 'El Ventero CBV', body: 'Prueba de avisos: todo funciona.', url: './', tag: 'prueba' });
  process.exit(0);
}

const cache = new Map();
async function feb(m) {
  if (!cache.has(m.p)) {
    try { cache.set(m.p, await fetchMatch(m.p)); } catch (e) { console.log('Error leyendo FEB', m.p, e.message); cache.set(m.p, null); }
  }
  return cache.get(m.p);
}

// 1) Resultados y estadísticas de partidos ya jugados
for (const m of D.matches) {
  const since = now - t(m.ko);
  const needStats = m.st === 'final' && !(D.stats[m.j]?.players?.length);
  if (!(m.st === 'pendiente' && since > 1.75 * H && since < 30 * 24 * H) && !needStats) continue;
  const p = await feb(m);
  if (!p || !isFinished(p)) { console.log(`J${m.j}: todavía sin acta final`); continue; }
  const box = p.boxes[TEAM] || Object.entries(p.boxes).find(([k]) => k.includes('VENTERO'))?.[1];
  if (box) D.stats[m.j] = { players: box.players };
  if (m.st !== 'final') {
    m.sh = p.sh; m.sa = p.sa; m.st = 'final';
    const home = m.home === TEAM;
    const ours = home ? m.sh : m.sa, theirs = home ? m.sa : m.sh;
    const top = box ? [...box.players].sort((a, b) => b.pts - a.pts)[0] : null;
    const mvp = box ? [...box.players].sort((a, b) => b.val - a.val)[0] : null;
    const key = `final-${m.j}`;
    if (!wasSent(key)) {
      notes.push({
        title: `${ours > theirs ? 'Victoria' : 'Derrota'} · El Ventero ${ours}–${theirs} ${short(rivalOf(m))}`,
        body: [top && `Máx. anotador: ${top.n.split(',')[0]} (${top.pts})`, mvp && `Valoración: ${mvp.n.split(',')[0]} (${mvp.val})`].filter(Boolean).join(' · ') || `Jornada ${m.j}`,
        url: `./#stats-${m.j}`, tag: key
      });
      markSent(key);
    }
  }
  changed = true;
}

// 2) Cambios de fecha, hora o pabellón en los próximos partidos
const upcoming = D.matches.filter((m) => m.st === 'pendiente' && t(m.ko) + 1.75 * H > now).slice(0, 3);
for (const m of upcoming) {
  const p = await feb(m);
  if (!p) continue;
  if (p.venue && p.venue !== m.venue) { m.venue = p.venue; changed = true; }
  if (p.ko && t(p.ko) !== t(m.ko)) {
    const before = `${fmtDay(m.ko)} ${fmtTime(m.ko)}`;
    const after = `${fmtDay(p.ko)} ${fmtTime(p.ko)}`;
    if (!m.prev) m.prev = m.ko;
    m.ko = p.ko;
    const text = `J${m.j} ${vs(m)}: nuevo horario ${after} (antes ${before})`;
    D.changes.push({ at: nowISO(), j: m.j, text });
    notes.push({ title: 'Cambio de horario', body: text, url: './#calendario', tag: `horario-${m.j}` });
    changed = true;
  }
}

// 3) Recordatorios: víspera (desde las 20:00) y 2 horas antes
const next = D.matches.find((m) => m.st === 'pendiente' && t(m.ko) > now);
if (next) {
  const today = madridParts(new Date(now));
  const tomorrow = madridParts(new Date(now + 24 * H)).day;
  const gameDay = madridParts(new Date(next.ko)).day;
  const where = next.venue || (next.home === TEAM ? D.homeVenue : 'pabellón por confirmar');
  const left = t(next.ko) - now;
  if (gameDay === tomorrow && today.hour >= 20 && !wasSent(`manana-${next.j}-${next.ko}`)) {
    notes.push({ title: `Mañana juega El Ventero · ${fmtTime(next.ko)}`, body: `J${next.j} ${vs(next)} · ${where}`, url: './', tag: `aviso-${next.j}` });
    markSent(`manana-${next.j}-${next.ko}`);
  }
  if (left > 0 && left <= 2 * H && !wasSent(`2h-${next.j}-${next.ko}`)) {
    notes.push({ title: `Hoy a las ${fmtTime(next.ko)} · El Ventero ${vs(next)}`, body: `Faltan ${Math.round(left / 60000)} min · ${where}`, url: './', tag: `aviso-${next.j}` });
    markSent(`2h-${next.j}-${next.ko}`);
  }
}

if (changed) D.updated = nowISO();
writeJSON(SEASON, D);
writeJSON(STATE, state);
for (const n of notes) await sendPush(SUBS, n);
console.log(`Hecho. Cambios: ${changed ? 'sí' : 'no'} · Avisos: ${notes.length}`);
