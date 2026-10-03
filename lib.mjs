// Utilidades compartidas: lectura de la ficha FEB, fechas en Europe/Madrid y envío de avisos push.
import * as cheerio from 'cheerio';
import fs from 'node:fs';

export const TZ = 'Europe/Madrid';
export const FEB_URL = (p) => `https://baloncestoenvivo.feb.es/Partido.aspx?p=${p}`;

export const readJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
export const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

// Desfase horario de Madrid para un instante dado, p. ej. "+02:00"
function madridOffset(date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(date)
    .find((x) => x.type === 'timeZoneName').value; // "GMT+02:00"
  return s === 'GMT' ? '+00:00' : s.replace('GMT', '');
}

// "04/10/2026 - 12:00" (hora de Madrid) -> "2026-10-04T12:00:00+02:00"
export function febDateToISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})/.exec(txt || '');
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const local = `${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:00`;
  // Probar con +01:00 y +02:00 y quedarse con el que coincide con el desfase real de ese instante
  for (const off of ['+01:00', '+02:00']) {
    const dt = new Date(local + off);
    if (madridOffset(dt) === off) return local + off;
  }
  return local + '+01:00';
}

export function madridParts(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

export const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-ES', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const nowISO = () => { const d = new Date(); const p = madridParts(d); return febDateToISO(`${p.day.slice(8, 10)}/${p.day.slice(5, 7)}/${p.day.slice(0, 4)} - ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`); };

const num = (s) => { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : 0; };
const minutesOf = (s) => { const m = /(\d+):(\d{2})/.exec(s || ''); return m ? Number(m[1]) + Number(m[2]) / 60 : 0; };
const shot = (s) => (/(\d+\/\d+)/.exec(s || '') || [, ''])[1];

// Lee la ficha de partido de la FEB
export function parseMatch(html) {
  const $ = cheerio.load(html);
  const txt = (sel) => $(sel).first().text().replace(/\s+/g, ' ').trim();
  const local = txt('#_ctl0_MainContentPlaceHolderMaster_equipoLocalNombre');
  const visitante = txt('#_ctl0_MainContentPlaceHolderMaster_equipoVisitanteNombre');
  const res = $('.box-marcador').first().find('span.resultado').map((i, e) => num($(e).text())).get();
  const fechaTxt = txt('.box-datos-partido .fecha .txt');
  const pabellon = txt('.box-datos-partido .pista .pabellon');
  const direccion = txt('.box-datos-partido .pista .direccion');

  const boxes = {};
  $('h1.titulo-modulo').each((i, h) => {
    const team = $(h).text().replace(/\s+/g, ' ').trim();
    const table = $(h).nextAll('.responsive-scroll').first().find('table').first();
    if (!table.length) return;
    const players = [];
    let totalMin = 0, totalPts = 0;
    table.find('tr').each((j, tr) => {
      const c = (cls) => $(tr).find(`td.${cls.split(' ').join('.')}`).first().text().replace(/\s+/g, ' ').trim();
      if (!$(tr).find('td').length) return;
      if ($(tr).hasClass('row-total')) { totalMin = minutesOf(c('minutos')); totalPts = num(c('puntos')); return; }
      const n = c('nombre jugador');
      if (!n) return;
      const min = c('minutos');
      players.push({
        n, d: c('dorsal'), ini: c('inicial') === '*', min, pts: num(c('puntos')),
        t2: shot(c('tiros dos')), t3: shot(c('tiros tres')), tl: shot(c('tiros libres')),
        reb: num(c('rebotes total')), ast: num(c('asistencias')), rob: num(c('recuperaciones')),
        per: num(c('perdidas')), fc: num(c('faltas cometidas')), val: num(c('valoracion')), pm: c('balance')
      });
    });
    boxes[team] = { players, totalMin, totalPts };
  });

  return {
    local, visitante,
    sh: res[0] ?? null, sa: res[1] ?? null,
    ko: febDateToISO(fechaTxt),
    venue: [pabellon, direccion].filter(Boolean).join(', ') || null,
    boxes
  };
}

// Un partido está terminado cuando ambos equipos suman al menos 200 minutos jugados
// (5 jugadores x 40') y los puntos de las tablas cuadran con el marcador.
export function isFinished(p) {
  const b = Object.values(p.boxes);
  if (b.length < 2) return false;
  const [l, v] = [p.boxes[p.local], p.boxes[p.visitante]];
  if (!l || !v) return false;
  return l.totalMin >= 199.9 && v.totalMin >= 199.9 && l.totalPts === p.sh && v.totalPts === p.sa && (p.sh + p.sa) > 0;
}

export async function fetchMatch(p) {
  // Para pruebas locales: FEB_FIXTURES=carpeta con <p>.html
  if (process.env.FEB_FIXTURES) return parseMatch(fs.readFileSync(`${process.env.FEB_FIXTURES}/${p}.html`, 'utf8'));
  const r = await fetch(FEB_URL(p), { headers: { 'User-Agent': 'Mozilla/5.0 (seguimiento El Ventero CBV)', 'Accept-Language': 'es-ES' } });
  if (!r.ok) throw new Error(`FEB ${p}: HTTP ${r.status}`);
  return parseMatch(await r.text());
}

// Envío de notificaciones push a todos los dispositivos registrados
export async function sendPush(subsFile, payload) {
  const key = process.env.VAPID_PRIVATE_KEY;
  // La clave pública está en docs/config.js (la usa también la app)
  const pub = process.env.VAPID_PUBLIC_KEY || (/vapidPublicKey:\s*'([^']+)'/.exec(fs.readFileSync('docs/config.js', 'utf8')) || [])[1];
  if (!key || !pub) { console.log('[push] Sin claves VAPID; aviso no enviado:', payload.title); return { sent: 0 }; }
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://github.com', pub, key);
  const subs = readJSON(subsFile, []);
  const keep = [];
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
      sent++; keep.push(s);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) console.log('[push] Suscripción caducada, se elimina:', s.name);
      else { console.log('[push] Error', e.statusCode, e.body || e.message); keep.push(s); }
    }
  }
  if (keep.length !== subs.length) writeJSON(subsFile, keep);
  console.log(`[push] "${payload.title}" → ${sent}/${subs.length} dispositivos`);
  return { sent };
}

// ---------- Clasificación ----------
// La página de resultados de la FEB muestra un grupo cada vez; el grupo se elige
// con un "postback" de ASP.NET (igual que al cambiar el desplegable en la web).
export const STANDINGS_URL = 'https://baloncestoenvivo.feb.es/resultados/ligaeba/5/2026';
const UA = { 'User-Agent': 'Mozilla/5.0 (seguimiento El Ventero CBV)', 'Accept-Language': 'es-ES' };

export function parseStandings(html) {
  const $ = cheerio.load(html);
  const group = $('select[id$="gruposDropDownList"] option[selected]').text().trim();
  const jornada = $('select[id$="jornadasDropDownList"] option[selected]').text().trim();
  const rows = [];
  $('table[id$="clasificacionDataGrid"] tr').each((i, tr) => {
    const td = $(tr).find('td');
    if (td.length < 9) return;
    const v = (k) => $(td[k]).text().replace(/\s+/g, ' ').trim();
    if (!/^\d+$/.test(v(0))) return; // cabecera
    rows.push({
      pos: num(v(0)), team: v(1), pj: num(v(2)), pg: num(v(3)), pp: num(v(4)),
      pf: num(v(5)), pc: num(v(6)), pt: num(v(7)), racha: v(8)
    });
  });
  // Fechas de los partidos que muestra la página (jornada actual y próxima)
  const dates = [];
  $('table[id*="ornada"] tr').each((i, tr) => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec($(tr).text());
    if (m) dates.push(`${m[3]}-${m[2]}-${m[1]}`);
  });
  return { group, jornada, rows, dates: [...new Set(dates)] };
}

export async function fetchStandings(groupLabel, url = STANDINGS_URL) {
  if (process.env.FEB_FIXTURES) return parseStandings(fs.readFileSync(`${process.env.FEB_FIXTURES}/clasificacion.html`, 'utf8'));
  const r0 = await fetch(url, { headers: UA });
  if (!r0.ok) throw new Error(`FEB clasificación: HTTP ${r0.status}`);
  const cookie = (r0.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const $ = cheerio.load(await r0.text());
  const sel = $('select[id$="gruposDropDownList"]');
  const opt = sel.find('option').filter((i, o) => $(o).text().replace(/\s+/g, ' ').trim() === groupLabel).first();
  if (!opt.length) throw new Error(`No encuentro el grupo ${groupLabel} en la FEB`);
  const body = new URLSearchParams();
  $('input[type=hidden]').each((i, e) => body.set($(e).attr('name'), $(e).attr('value') || ''));
  $('select').each((i, s) => body.set($(s).attr('name'), $(s).find('option[selected]').attr('value') || $(s).find('option').first().attr('value') || ''));
  body.set(sel.attr('name'), opt.attr('value'));
  body.set('__EVENTTARGET', sel.attr('name'));
  body.set('__EVENTARGUMENT', '');
  const action = new URL($('form').attr('action') || url, url).href;
  const r = await fetch(action, { method: 'POST', body, headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookie ? { Cookie: cookie } : {}) } });
  if (!r.ok) throw new Error(`FEB clasificación (grupo): HTTP ${r.status}`);
  const out = parseStandings(await r.text());
  if (out.group.replace(/\s+/g, ' ') !== groupLabel) throw new Error(`La FEB devolvió otro grupo: ${out.group}`);
  return out;
}

// ¿Toca actualizar la clasificación? Devuelve un identificador de turno o null.
//  - Sábados desde las 23:30 (margen hasta las 00:30 por los retrasos de GitHub)
//  - Domingos desde las 22:00
//  - Medianoche (00:00–02:00) tras un día laborable con partidos del grupo
export function standingsSlot(date, groupDates = []) {
  const p = madridParts(date);
  const wd = new Date(`${p.day}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
  const mins = p.hour * 60 + p.minute;
  const yesterday = new Date(new Date(`${p.day}T12:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
  const ywd = (wd + 6) % 7;
  if (wd === 6 && mins >= 23 * 60 + 25) return `sab-${p.day}`;
  if (wd === 0 && mins < 35) return `sab-${yesterday}`;
  if (wd === 0 && mins >= 21 * 60 + 55) return `dom-${p.day}`;
  if (wd === 1 && mins < 35) return `dom-${yesterday}`;
  if (mins < 120 && ywd >= 1 && ywd <= 5 && groupDates.includes(yesterday)) return `med-${yesterday}`;
  return null;
}
