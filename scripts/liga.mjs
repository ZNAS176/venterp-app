// Resultados y estadísticas de TODOS los partidos del grupo B-A.
//  - docs/data/liga.json         calendario del grupo con marcadores
//  - docs/data/partidos/<p>.json acta de cada partido (estadística de los dos equipos)
//  - docs/data/equipos.json      acumulados por equipo y jugador (para los promedios)
import fs from 'node:fs';
import { readJSON, writeJSON, madridParts } from './lib.mjs';

const LIGA = 'docs/data/liga.json';
const DIR = 'docs/data/partidos';
const EQUIPOS = 'docs/data/equipos.json';
const H = 3600e3;
const MAX_FETCH = 40; // tope de fichas leídas por ejecución, para no saturar la web de la FEB
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (iso) => new Date(iso).getTime();

export async function updateLiga({ feb, now, nowISO, wasSent, markSent }) {
  const L = readJSON(LIGA);
  if (!L) { console.log('Sin liga.json; se omite el grupo'); return false; }
  fs.mkdirSync(DIR, { recursive: true });
  let changed = false, fetched = 0;
  const all = L.jornadas.flatMap((J) => J.matches.map((m) => Object.assign(m, { j: J.j })));

  // 1) Partidos jugados sin acta todavía (o con acta sin guardar)
  for (const m of all) {
    if (fetched >= MAX_FETCH) break;
    const since = now - t(m.ko);
    const missingFile = m.st === 'final' && !fs.existsSync(`${DIR}/${m.p}.json`);
    if (!((m.st === 'pendiente' && since > 1.75 * H && since < 45 * 24 * H) || missingFile)) continue;
    fetched++;
    const p = await feb(m);
    await pause(300);
    if (!p) continue;
    if (p.ko && t(p.ko) !== t(m.ko)) { m.ko = p.ko; changed = true; } // aplazado o movido
    if (!finished(p)) continue;
    m.sh = p.sh; m.sa = p.sa; m.st = 'final';
    if (p.venue) m.venue = p.venue;
    writeJSON(`${DIR}/${m.p}.json`, {
      p: m.p, j: m.j, ko: m.ko, home: m.home, away: m.away, sh: m.sh, sa: m.sa,
      venue: p.venue, quarters: p.quarters || [],
      home_box: p.order[0]?.players || [], away_box: p.order[1]?.players || []
    });
    changed = true;
    console.log(`Grupo J${m.j}: ${m.home} ${m.sh}-${m.sa} ${m.away}`);
  }

  // 2) Una vez al día (desde las 8:00): horarios de la próxima jornada del resto de equipos
  const day = madridParts(new Date(now));
  const key = `liga-horarios-${day.day}`;
  if (day.hour >= 8 && !wasSent(key)) {
    const next = all.filter((m) => m.st === 'pendiente' && t(m.ko) > now && t(m.ko) - now < 10 * 24 * H);
    for (const m of next) {
      if (fetched >= MAX_FETCH) break;
      fetched++;
      const p = await feb(m);
      await pause(300);
      if (!p) continue;
      if (p.ko && t(p.ko) !== t(m.ko)) { m.ko = p.ko; changed = true; }
      if (p.venue && p.venue !== m.venue) { m.venue = p.venue; changed = true; }
    }
    markSent(key);
  }

  if (changed) {
    for (const J of L.jornadas) { J.matches.forEach((m) => delete m.j); J.matches.sort((a, b) => t(a.ko) - t(b.ko)); }
    L.updated = nowISO();
    writeJSON(LIGA, L);
    buildEquipos(L);
  }
  console.log(`Grupo: ${fetched} fichas leídas · cambios: ${changed ? 'sí' : 'no'}`);
  return changed;
}

function finished(p) {
  const [l, v] = p.order;
  return !!(l && v && l.totalMin >= 199.9 && v.totalMin >= 199.9 && l.totalPts === p.sh && v.totalPts === p.sa && p.sh + p.sa > 0);
}

// Acumulados por equipo: partidos, puntos y sumas por jugador
export function buildEquipos(L = readJSON(LIGA)) {
  const teams = {};
  const T = (name) => teams[name] || (teams[name] = { pj: 0, pg: 0, pf: 0, pc: 0, games: [], players: {} });
  for (const J of L.jornadas) for (const m of J.matches) {
    if (m.st !== 'final') continue;
    const A = readJSON(`${DIR}/${m.p}.json`);
    if (!A) continue;
    [[m.home, A.home_box, m.sh, m.sa], [m.away, A.away_box, m.sa, m.sh]].forEach(([name, box, f, c]) => {
      const tm = T(name);
      tm.pj++; tm.pf += f; tm.pc += c; if (f > c) tm.pg++;
      tm.games.push({ j: J.j, p: m.p });
      for (const pl of box) {
        const s = tm.players[pl.n] || (tm.players[pl.n] = { n: pl.n, d: pl.d, pj: 0, sec: 0, pts: 0, reb: 0, ast: 0, rob: 0, val: 0 });
        const mm = /(\d+):(\d{2})/.exec(pl.min || '');
        s.pj++; s.sec += mm ? Number(mm[1]) * 60 + Number(mm[2]) : 0;
        s.pts += pl.pts; s.reb += pl.reb; s.ast += pl.ast; s.rob += pl.rob || 0; s.val += pl.val;
        if (pl.d) s.d = pl.d;
      }
    });
  }
  for (const tm of Object.values(teams)) tm.players = Object.values(tm.players);
  writeJSON(EQUIPOS, { updated: L.updated, teams });
}
