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
