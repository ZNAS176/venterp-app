// Registra un móvil para recibir avisos. Se ejecuta cuando el propietario del
// repositorio abre una incidencia "Registrar dispositivo" desde la app.
import fs from 'node:fs';
import { readJSON, writeJSON, sendPush } from './lib.mjs';

const SUBS = 'push/subscriptions.json';
const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const out = (msg) => fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `message=${msg}\n`);

const owner = (process.env.GITHUB_REPOSITORY_OWNER || '').toLowerCase();
if ((ev.issue?.user?.login || '').toLowerCase() !== owner) {
  out('Solo el propietario del repositorio puede registrar dispositivos.');
  process.exit(0);
}

const m = /```json\s*([\s\S]*?)```/.exec(ev.issue.body || '');
let data;
try { data = JSON.parse(m[1]); } catch { out('No encuentro el código de suscripción en la incidencia.'); process.exit(0); }
const sub = data.subscription;
if (!sub?.endpoint?.startsWith('https://') || !sub?.keys?.p256dh || !sub?.keys?.auth) {
  out('El código de suscripción no es válido.'); process.exit(0);
}

const subs = readJSON(SUBS, []).filter((s) => s.subscription.endpoint !== sub.endpoint);
const entry = { name: String(data.device || 'Móvil').slice(0, 60), added: new Date().toISOString(), subscription: sub };
subs.push(entry);
writeJSON(SUBS, subs);

const tmp = 'push/.one.json';
writeJSON(tmp, [entry]);
const { sent } = await sendPush(tmp, { title: 'El Ventero CBV', body: 'Avisos activados en este dispositivo.', url: './', tag: 'registro' });
fs.unlinkSync(tmp);
out(sent ? `Dispositivo "${entry.name}" registrado. Te he enviado una notificación de prueba.` : `Dispositivo "${entry.name}" guardado, pero la notificación de prueba no salió: revisa los secretos VAPID.`);
