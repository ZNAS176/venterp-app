/* Ventero CBV · app de temporada 2026/27 (base: El Ventero CBV; datos de todo el grupo B-A) */
(() => {
  'use strict';
  const CFG = window.VENTERO_CONFIG || {};
  const TZ = 'Europe/Madrid';
  const GAME = 150 * 60000; // un partido se considera "en curso" hasta 2h30 tras el inicio
  const $view = document.getElementById('view');
  let D = null;      // El Ventero: calendario, avisos, clasificación
  let LG = null;     // todo el grupo: jornadas y marcadores
  let EQ = null;     // acumulados por equipo y jugador
  const ACTAS = {};  // actas de partido ya descargadas
  let filt = 'todos';
  let statTeam = null;
  let tick = null;

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso, o) => new Date(iso).toLocaleDateString('es-ES', Object.assign({ timeZone: TZ }, o));
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayKey = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const one = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
  };
  const feb = (p) => `https://baloncestoenvivo.feb.es/Partido.aspx?p=${p}`;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function repoSlug() {
    if (CFG.repo) return CFG.repo;
    const h = location.hostname;
    if (h.endsWith('.github.io')) {
      const owner = h.replace('.github.io', '');
      const repo = location.pathname.split('/').filter(Boolean)[0];
      return repo ? `${owner}/${repo}` : `${owner}/${h}`;
    }
    return '';
  }

  // ---------- modelo ----------
  function model() {
    const TEAM = D.team, SHORT = D.short || {};
    const now = Date.now();
    const ms = D.matches.map((m) => {
      const home = m.home === TEAM;
      const rival = home ? m.away : m.home;
      const played = m.st === 'final' && m.sh != null && m.sa != null;
      const ours = home ? m.sh : m.sa, theirs = home ? m.sa : m.sh;
      return {
        ...m, t: new Date(m.ko).getTime(), home, rival, rs: SHORT[rival] || rival,
        vs: home ? 'vs' : 'en', cf: home ? 'En casa' : 'Fuera',
        date: fmt(m.ko, { weekday: 'short', day: 'numeric', month: 'short' }),
        dateLong: fmt(m.ko, { weekday: 'long', day: 'numeric', month: 'long' }),
        time: hhmm(m.ko),
        where: m.venue || (home ? D.homeVenue : 'Pabellón por confirmar'),
        prevLabel: m.prev ? `${fmt(m.prev, { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(m.prev)}` : '',
        played, ours, theirs, win: played && ours > theirs,
        hasStats: !!(D.stats[m.j] && D.stats[m.j].players && D.stats[m.j].players.length)
      };
    });
    const next = ms.find((m) => m.st === 'pendiente' && m.t + GAME > now) || null;
    const played = ms.filter((m) => m.played);
    const bal = played.reduce((a, m) => ({ w: a.w + (m.win ? 1 : 0), l: a.l + (m.win ? 0 : 1), pf: a.pf + m.ours, pa: a.pa + m.theirs }), { w: 0, l: 0, pf: 0, pa: 0 });
    return { ms, next, played, last: played[played.length - 1] || null, bal, now };
  }

  // ---------- piezas ----------
  const bell = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const check = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function countdown(next, now) {
    const diff = Math.max(0, next.t - now);
    return { d: Math.floor(diff / 864e5), h: Math.floor(diff / 36e5) % 24, m: Math.floor(diff / 6e4) % 60, diff };
  }

  function alertFor(M) {
    const n = M.next;
    if (!n) return null;
    const cd = countdown(n, M.now);
    const today = dayKey(new Date(M.now)), tomorrow = dayKey(new Date(M.now + 864e5)), gd = dayKey(new Date(n.t));
    const place = n.home ? 'en casa' : `en ${n.rs}`;
    if (n.prev) return { t: `Cambio de horario · J${n.j}`, b: `Ahora ${n.date} ${n.time} (antes ${n.prevLabel})` };
    if (M.now >= n.t) return { t: 'En juego ahora', b: `J${n.j} · ${n.vs} ${n.rs}` };
    if (gd === today) return { t: `Hoy hay partido · ${n.time}`, b: `${n.vs} ${n.rs}, ${place}` };
    if (gd === tomorrow) return { t: `Mañana a las ${n.time}`, b: `${n.vs} ${n.rs}, ${place}` };
    if (cd.diff < 3 * 864e5) return { t: `Partido en ${cd.d} días`, b: `${n.dateLong} · ${n.time}` };
    return null;
  }

  function resultRow(m, withBtn) {
    return `<div class="card stack">
      <div class="res-line">
        <span class="chip ${m.win ? 'v' : 'd'}" aria-label="${m.win ? 'Victoria' : 'Derrota'}">${m.win ? 'V' : 'D'}</span>
        <div class="who"><b>J${m.j} · ${m.vs} ${esc(m.rs)}</b><span class="small muted">${esc(m.date)} · ${m.cf}</span></div>
        <span class="score">${m.ours}–${m.theirs}</span>
      </div>
      ${withBtn && m.played ? `<a class="btn block" href="#partido-${m.p}">Estadísticas del partido</a>` : ''}
    </div>`;
  }

  // ---------- avisos push ----------
  function pushCard() {
    const reg = store.get('ventero-registrado');
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let body;
    if (isIOS() && !isStandalone()) {
      body = `<p>Para recibir avisos en iPhone, primero instala la app:</p>
        <ol><li>Pulsa <b>Compartir</b> en Safari.</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li><li>Abre la app desde el icono y vuelve aquí.</li></ol>`;
    } else if (!supported) {
      body = '<p>Este navegador no admite notificaciones. Prueba con Chrome (Android) o con la app instalada en iPhone (iOS 16.4 o posterior).</p>';
    } else if (Notification.permission === 'denied') {
      body = '<p>Las notificaciones están bloqueadas. Actívalas en los ajustes del teléfono para esta app y vuelve a intentarlo.</p>';
    } else if (reg && Notification.permission === 'granted') {
      body = `<div class="ok">${check} Avisos activados en este móvil</div>
        <p class="small muted">Víspera del partido (20:00), 2 horas antes, resultado final y cambios de horario.</p>
        <button type="button" class="btn" data-act="push">Volver a registrar este móvil</button>`;
    } else {
      body = `<p>Recibe la víspera y 2 horas antes de cada partido, el resultado y la estadística al terminar, y cualquier cambio de horario.</p>
        <button type="button" class="btn primary block" data-act="push">${bell} Activar avisos</button>`;
    }
    return `<section class="card setup" aria-labelledby="h-avisos"><h2 id="h-avisos" class="h2">Avisos</h2>${body}</section>`;
  }

  async function enablePush(btn) {
    try {
      btn.disabled = true;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { render(); return; }
      const sw = await navigator.serviceWorker.ready;
      let sub = await sw.pushManager.getSubscription();
      if (!sub) sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
      const device = `${isIOS() ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Navegador'} · ${new Date().toLocaleDateString('es-ES')}`;
      const payload = JSON.stringify({ device, subscription: sub.toJSON() }, null, 1);
      const slug = repoSlug();
      if (!slug) { alert('No encuentro el repositorio. Rellena "repo" en config.js.'); return; }
      const url = `https://github.com/${slug}/issues/new?title=${encodeURIComponent('Registrar dispositivo · ' + device)}&body=${encodeURIComponent('Pulsa **Submit new issue** (Crear incidencia) para activar los avisos en este móvil. No edites el código.\n\n```json\n' + payload + '\n```')}`;
      store.set('ventero-registrado', '1');
      showRegisterStep(url);
    } catch (e) {
      alert('No se pudieron activar los avisos: ' + e.message);
    } finally { btn.disabled = false; }
  }

  function showRegisterStep(url) {
    const box = document.querySelector('.setup');
    box.innerHTML = `<h2 class="h2">Último paso</h2>
      <p>Se abrirá GitHub con el registro de este móvil ya escrito. Inicia sesión si te lo pide y pulsa <b>Create</b> (Crear incidencia). En un minuto recibirás una notificación de prueba.</p>
      <a class="btn primary block" href="${esc(url)}" target="_blank" rel="noopener">Registrar este móvil en GitHub</a>`;
  }

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // ---------- instalación ----------
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (route().tab === 'inicio') render(); });
  function installCard() {
    if (isStandalone() || store.get('ventero-no-instalar')) return '';
    if (deferredInstall) return `<section class="card setup"><p><b>Instala la app</b> para tenerla en tu pantalla de inicio, a pantalla completa y sin conexión.</p>
      <div class="filters"><button type="button" class="btn primary" data-act="install">Instalar</button><button type="button" class="btn" data-act="noinstall">Ahora no</button></div></section>`;
    if (isIOS()) return ''; // en iPhone las instrucciones van en la tarjeta de avisos
    return '';
  }

  // ---------- vistas ----------
  function viewInicio(M) {
    const a = alertFor(M), n = M.next, L = M.last;
    let h = installCard();
    if (a) h += `<div class="alert" role="status">${bell}<div><strong>${esc(a.t)}</strong><span>${esc(a.b)}</span></div></div>`;
    if (n) {
      const cd = countdown(n, M.now);
      h += `<section class="hero" aria-label="Próximo partido">
        <div class="hero-top"><span>Próximo · Jornada ${n.j}</span><span class="pill">${n.cf}</span></div>
        <div><div class="small">${n.vs}</div><div class="hero-rival">${esc(n.rs)}</div><div class="small" style="opacity:.9">${esc(n.rival)}</div></div>
        <div class="count" aria-label="Cuenta atrás"><div><b id="cd-d">${cd.d}</b><span>días</span></div><div><b id="cd-h">${cd.h}</b><span>horas</span></div><div><b id="cd-m">${cd.m}</b><span>min</span></div></div>
        <div class="hero-when"><strong>${esc(n.dateLong)} · ${n.time}</strong><span style="opacity:.92">${esc(n.where)}</span>${n.prev ? `<em>Horario cambiado · antes ${esc(n.prevLabel)}</em>` : ''}</div>
        <a class="btn light" style="align-self:flex-start" href="${feb(n.p)}" target="_blank" rel="noopener">Ficha en la FEB</a>
      </section>`;
    } else {
      h += '<p class="empty">Temporada regular terminada.</p>';
    }
    if (L) h += `<section class="stack" aria-label="Último resultado"><h2 class="h2">Último resultado</h2>${resultRow(L, true)}</section>`;
    if (M.played.length) {
      h += `<section class="kpis" aria-label="Balance"><div><b>${M.bal.w}</b><span>Victorias</span></div><div><b>${M.bal.l}</b><span>Derrotas</span></div><div><b>${M.bal.pf}</b><span>Pts favor</span></div><div><b>${M.bal.pa}</b><span>Pts contra</span></div></section>`;
    } else {
      h += '<p class="empty">La temporada arranca el fin de semana del 3–4 de octubre. Los resultados aparecerán aquí en cuanto la FEB publique el acta.</p>';
    }
    h += pushCard();
    const ch = (D.changes || []).slice(-5).reverse();
    h += `<section class="stack" aria-labelledby="h-cambios"><h2 id="h-cambios" class="h2">Cambios de horario</h2>${ch.length
      ? ch.map((c) => `<div class="change"><b>${esc(c.text)}</b><span class="small muted">${esc(fmt(c.at, { day: 'numeric', month: 'short' }))} ${hhmm(c.at)}</span></div>`).join('')
      : '<p class="small muted" style="margin:0">Sin cambios por ahora.</p>'}</section>`;
    return h;
  }

  function viewCalendario(M) {
    const f = [['todos', 'Todos'], ['casa', 'En casa'], ['fuera', 'Fuera']];
    const list = M.ms.filter((m) => filt === 'todos' || (filt === 'casa' ? m.home : !m.home));
    return `<h2 class="visually-hidden">Calendario</h2>
      <div class="filters" role="group" aria-label="Filtrar partidos">${f.map(([id, l]) => `<button type="button" class="seg" data-filt="${id}" aria-pressed="${filt === id}">${l}</button>`).join('')}</div>
      <ol class="list">${list.map((m) => `<li><a class="row${M.next && M.next.j === m.j ? ' next' : ''}${m.prev ? ' moved' : ''}" href="${m.played ? `#partido-${m.p}` : feb(m.p)}"${m.played ? '' : ' target="_blank" rel="noopener"'}>
        <span class="j">J${m.j}</span>
        <span class="mid"><b>${m.vs} ${esc(m.rs)}</b><span>${esc(m.date)} · ${m.time}</span>${m.prev ? `<i>Cambiado · antes ${esc(m.prevLabel)}</i>` : ''}</span>
        <span class="end"><span class="tag ${m.home ? 'casa' : 'fuera'}">${m.home ? 'CASA' : 'FUERA'}</span><b>${m.played ? `${m.ours}–${m.theirs}` : m.st === 'aplazado' ? 'Aplazado' : '—'}</b></span>
      </a></li>`).join('')}</ol>`;
  }

  const nm = (t) => (t === D.team ? 'El Ventero' : ((LG && LG.short) || D.short || {})[t] || t);

  function resTabs(active) {
    return `<div class="filters" role="group" aria-label="Ver resultados de">
      <a class="seg${active === 'v' ? ' on' : ''}" href="#resultados"${active === 'v' ? ' aria-current="page"' : ''}>El Ventero</a>
      <a class="seg${active === 'j' ? ' on' : ''}" href="#jornada"${active === 'j' ? ' aria-current="page"' : ''}>Por jornada</a></div>`;
  }

  function viewResultados(M) {
    if (!M.played.length) return `<h2 class="h2">Resultados</h2>${resTabs('v')}<p class="empty">Todavía no hay resultados de El Ventero.</p>`;
    return `<h2 class="h2">Resultados</h2>${resTabs('v')}${M.played.slice().reverse().map((m) => resultRow(m, true)).join('')}`;
  }

  function currentJornada() {
    if (!LG) return 1;
    const last = LG.jornadas.filter((J) => J.matches.some((m) => m.st === 'final')).pop();
    return last ? last.j : 1;
  }

  function viewJornada(n) {
    if (!LG) return `<h2 class="h2">Resultados</h2>${resTabs('j')}<p class="empty">Cargando el calendario del grupo…</p>`;
    const J = LG.jornadas.find((x) => x.j === n) || LG.jornadas[0];
    const fecha = fmt(J.matches[0].ko, { day: 'numeric', month: 'short' });
    return `<h2 class="h2">Resultados</h2>${resTabs('j')}
      <nav class="jornadas" aria-label="Jornadas">${LG.jornadas.map((x) => `<a class="seg${x.j === J.j ? ' on' : ''}" href="#jornada-${x.j}"${x.j === J.j ? ' aria-current="page"' : ''}>J${x.j}</a>`).join('')}</nav>
      <p class="small muted" style="margin:0">Jornada ${J.j} · fin de semana del ${esc(fecha)}</p>
      <ol class="list">${J.matches.map((m) => {
        const fin = m.st === 'final', us = m.home === D.team || m.away === D.team;
        const hw = fin && m.sh > m.sa, aw = fin && m.sa > m.sh;
        const inner = `<span class="mid">
            <b class="${hw ? 'win' : ''}">${esc(nm(m.home))}</b>
            <b class="${aw ? 'win' : ''}">${esc(nm(m.away))}</b>
            <span>${esc(fmt(m.ko, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${hhmm(m.ko)}</span></span>
          <span class="end score-col">${fin ? `<b class="${hw ? 'win' : ''}">${m.sh}</b><b class="${aw ? 'win' : ''}">${m.sa}</b>` : `<b>${m.st === 'aplazado' ? 'Apl.' : '—'}</b>`}</span>`;
        return `<li><a class="row match${us ? ' us' : ''}" href="${fin ? `#partido-${m.p}` : feb(m.p)}"${fin ? '' : ' target="_blank" rel="noopener"'}>${inner}</a></li>`;
      }).join('')}</ol>
      <p class="legend">Toca un partido terminado para ver la estadística de los dos equipos.</p>`;
  }

  const boxTable = (rows, title, us) => `<section class="stack"><h3 class="h3${us ? ' us-title' : ''}">${esc(title)}</h3>
    <div class="table"><table><thead><tr><th scope="col">Jugador</th><th scope="col">MIN</th><th scope="col">PT</th><th scope="col">T2</th><th scope="col">T3</th><th scope="col">TL</th><th scope="col">RT</th><th scope="col">AS</th><th scope="col">BR</th><th scope="col">VA</th><th scope="col">+/-</th></tr></thead><tbody>
    ${rows.slice().sort((a, b) => b.pts - a.pts).map((p) => `<tr><td title="${esc(p.n)}">${p.ini ? '<span aria-label="titular">*</span>' : ''}${pname(p.n)}</td><td>${esc(p.min)}</td><td class="hi">${p.pts}</td><td>${esc(p.t2)}</td><td>${esc(p.t3)}</td><td>${esc(p.tl)}</td><td>${p.reb}</td><td>${p.ast}</td><td>${p.rob}</td><td>${p.val}</td><td>${esc(p.pm)}</td></tr>`).join('')}
    </tbody></table></div></section>`;

  function viewPartido(p) {
    const A = ACTAS[p];
    if (!A) {
      loadActa(p);
      return '<p class="empty">Cargando el acta del partido…</p>';
    }
    if (A === 'error') return `<p class="empty">No se pudo cargar el acta. <a href="${feb(p)}" target="_blank" rel="noopener">Ver en la FEB</a></p>`;
    const hw = A.sh > A.sa;
    const homeFirst = A.away !== D.team; // El Ventero siempre primero
    const tables = [[A.home_box, A.home], [A.away_box, A.away]];
    if (!homeFirst) tables.reverse();
    return `<a class="small" href="#jornada-${A.j}">← Jornada ${A.j}</a>
      <section class="card stack" aria-label="Marcador">
        <div class="small muted">Jornada ${A.j} · ${esc(fmt(A.ko, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hhmm(A.ko)}</div>
        <div class="score-board">
          <span class="${hw ? 'win' : ''}">${esc(nm(A.home))}</span><b class="${hw ? 'win' : ''}">${A.sh}</b>
          <span class="${!hw ? 'win' : ''}">${esc(nm(A.away))}</span><b class="${!hw ? 'win' : ''}">${A.sa}</b>
        </div>
        ${A.quarters && A.quarters.length ? `<div class="small muted">Parciales: ${A.quarters.map(esc).join(' · ')}</div>` : ''}
        ${A.venue ? `<div class="small muted">${esc(A.venue)}</div>` : ''}
      </section>
      ${tables.map(([rows, team]) => boxTable(rows, nm(team), team === D.team)).join('')}
      <a class="small" href="${feb(p)}" target="_blank" rel="noopener">Acta completa en la FEB</a>`;
  }

  async function loadActa(p) {
    try {
      const r = await fetch(`data/partidos/${p}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      ACTAS[p] = await r.json();
    } catch { ACTAS[p] = 'error'; }
    if (route().tab === 'partido' && route().p === p) render();
  }

  function viewClasificacion() {
    const S = D.standings;
    const next = 'sábado 23:30, domingo 22:00 y a medianoche cuando hay partidos entre semana';
    if (!S || !S.rows || !S.rows.length) return `<h2 class="h2">Clasificación</h2><p class="empty">La clasificación del grupo B-A aparecerá tras la primera jornada. Se actualiza el ${next}.</p>`;
    const SHORT = D.short || {};
    const nm = (t) => (t === D.team ? 'El Ventero' : SHORT[t] || t);
    return `<section class="stack" aria-labelledby="h-clas">
      <h2 id="h-clas" class="h2">Clasificación</h2>
      <p class="small muted" style="margin:0">Grupo B-A · ${esc(S.jornada || '')} · act. ${esc(fmt(S.updated, { weekday: 'short', day: 'numeric', month: 'short' }))} ${hhmm(S.updated)}</p>
      <div class="table"><table class="standings"><thead><tr><th scope="col" aria-label="Posición">#</th><th scope="col" class="team">Equipo</th><th scope="col" title="Partidos jugados">PJ</th><th scope="col" title="Ganados">G</th><th scope="col" title="Perdidos">P</th><th scope="col" title="Diferencia">DIF</th><th scope="col" title="Puntos de clasificación">PT</th><th scope="col" title="Racha">R</th></tr></thead><tbody>
      ${S.rows.map((r) => {
        const dif = r.pf - r.pc;
        const rc = /^\+/.test(r.racha) ? 'racha-pos' : 'racha-neg';
        return `<tr class="${r.team === D.team ? 'me' : ''}"><td>${r.pos}</td><td class="team" title="${esc(r.team)}">${esc(nm(r.team))}</td><td>${r.pj}</td><td>${r.pg}</td><td>${r.pp}</td><td title="${r.pf} a favor, ${r.pc} en contra">${dif > 0 ? '+' : ''}${dif}</td><td class="pt">${r.pt}</td><td class="${rc}">${esc(r.racha)}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      <p class="legend">DIF: puntos a favor menos en contra. PT: 2 por victoria y 1 por derrota. R: racha (+ victorias, − derrotas seguidas). Se actualiza el ${next}.</p>
    </section>`;
  }

  const pname = (n) => { const [ap, no] = n.split(','); return esc(no ? `${no.trim().split(' ')[0]} ${ap.trim().split(' ')[0]}` : n); };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  function viewStats() {
    const team = statTeam || D.team;
    const teams = (LG && LG.teams) || [D.team];
    const ordered = [D.team, ...teams.filter((t) => t !== D.team).sort((a, b) => nm(a).localeCompare(nm(b), 'es'))];
    const T = EQ && EQ.teams && EQ.teams[team];
    let h = `<h2 class="h2">Estadísticas</h2>
      <label class="pick"><span class="small muted">Equipo</span>
        <select id="team-pick">${ordered.map((t) => `<option value="${esc(t)}"${t === team ? ' selected' : ''}>${esc(t === D.team ? 'El Ventero CBV' : nm(t))}</option>`).join('')}</select></label>`;
    if (!T || !T.pj) return h + `<p class="empty">Todavía no hay actas de ${esc(nm(team))}. Se cargan desde la FEB en cuanto termina cada partido.</p>`;
    const rows = T.players.slice().sort((a, b) => b.pts / b.pj - a.pts / a.pj);
    h += `<section class="kpis" aria-label="Balance de ${esc(nm(team))}"><div><b>${T.pj}</b><span>Jugados</span></div><div><b>${T.pg}–${T.pj - T.pg}</b><span>V–D</span></div><div><b>${one(T.pf / T.pj)}</b><span>Pts favor</span></div><div><b>${one(T.pc / T.pj)}</b><span>Pts contra</span></div></section>
      <section class="stack" aria-labelledby="h-prom"><h3 id="h-prom" class="h3">Promedios por partido</h3>
      <div class="table"><table><thead><tr><th scope="col">Jugador</th><th scope="col">PJ</th><th scope="col">MIN</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">VAL</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td title="${esc(a.n)}">${pname(a.n)}</td><td>${a.pj}</td><td>${mmss(a.sec / a.pj)}</td><td class="hi">${one(a.pts / a.pj)}</td><td>${one(a.reb / a.pj)}</td><td>${one(a.ast / a.pj)}</td><td>${one(a.val / a.pj)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    const games = T.games.slice().sort((a, b) => b.j - a.j).map((g) => {
      const J = LG && LG.jornadas.find((x) => x.j === g.j);
      const m = J && J.matches.find((x) => x.p === g.p);
      if (!m) return '';
      const home = m.home === team, f = home ? m.sh : m.sa, c = home ? m.sa : m.sh, win = f > c;
      return `<li><a class="row" href="#partido-${m.p}"><span class="chip ${win ? 'v' : 'd'}">${win ? 'V' : 'D'}</span>
        <span class="mid"><b>J${g.j} · ${home ? 'vs' : 'en'} ${esc(nm(home ? m.away : m.home))}</b><span>${esc(fmt(m.ko, { day: 'numeric', month: 'short' }))}</span></span>
        <span class="end"><b>${f}–${c}</b></span></a></li>`;
    }).join('');
    return h + `<section class="stack" aria-labelledby="h-par"><h3 id="h-par" class="h3">Partidos</h3><ol class="list">${games}</ol></section>`;
  }

  // ---------- render / navegación ----------
  function route() {
    const h = (location.hash || '#inicio').slice(1);
    let m;
    if ((m = /^partido-(\d+)$/.exec(h))) return { tab: 'partido', nav: 'resultados', p: m[1] };
    if ((m = /^jornada(?:-(\d+))?$/.exec(h))) return { tab: 'jornada', nav: 'resultados', j: m[1] ? Number(m[1]) : currentJornada() };
    if (/^stats-\d+$/.test(h)) return { tab: 'stats', nav: 'stats' }; // enlaces antiguos
    const tab = ['inicio', 'calendario', 'resultados', 'clasificacion', 'stats'].includes(h) ? h : 'inicio';
    return { tab, nav: tab };
  }

  function render() {
    if (!D) return;
    const r = route(), M = model();
    document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.tab === r.nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const me = D.standings && D.standings.rows && D.standings.rows.find((x) => x.team === D.team);
    document.getElementById('record').textContent = me ? `${me.pos}º · ${M.bal.w}–${M.bal.l}` : `${M.bal.w}–${M.bal.l}`;
    document.getElementById('updated').textContent = `Act. ${fmt(D.updated, { day: 'numeric', month: 'short' })} ${hhmm(D.updated)}`;
    $view.innerHTML = r.tab === 'calendario' ? viewCalendario(M) : r.tab === 'resultados' ? viewResultados(M) : r.tab === 'clasificacion' ? viewClasificacion() : r.tab === 'stats' ? viewStats() : r.tab === 'jornada' ? viewJornada(r.j) : r.tab === 'partido' ? viewPartido(r.p) : viewInicio(M);
    clearInterval(tick);
    if (r.tab === 'inicio' && M.next) tick = setInterval(() => {
      const cd = countdown(M.next, Date.now());
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('cd-d', cd.d); set('cd-h', cd.h); set('cd-m', cd.m);
    }, 30000);
  }

  $view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filt],[data-act]');
    if (!b) return;
    if (b.dataset.filt) { filt = b.dataset.filt; render(); }
    else if (b.dataset.act === 'push') enablePush(b);
    else if (b.dataset.act === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; render(); }); }
    else if (b.dataset.act === 'noinstall') { store.set('ventero-no-instalar', '1'); render(); }
  });
  $view.addEventListener('change', (e) => {
    if (e.target.id === 'team-pick') { statTeam = e.target.value; store.set('ventero-equipo', statTeam); render(); }
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  async function load(manual) {
    const btn = document.getElementById('refresh');
    btn.classList.add('spin');
    try {
      const get = (f) => fetch(`data/${f}?t=${Date.now()}`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [d, lg, eq] = await Promise.all([get('season.json'), get('liga.json').catch(() => null), get('equipos.json').catch(() => null)]);
      D = d; if (lg) LG = lg; if (eq) EQ = eq;
      store.set('ventero-data', JSON.stringify(D));
      if (LG) store.set('ventero-liga', JSON.stringify(LG));
      if (EQ) store.set('ventero-equipos', JSON.stringify(EQ));
    } catch (e) {
      if (!D) { const c = store.get('ventero-data'); if (c) D = JSON.parse(c); }
      if (!LG) { const c = store.get('ventero-liga'); if (c) LG = JSON.parse(c); }
      if (!EQ) { const c = store.get('ventero-equipos'); if (c) EQ = JSON.parse(c); }
      if (!D) $view.innerHTML = '<p class="empty">No se pudieron cargar los datos. Comprueba la conexión y vuelve a intentarlo.</p>';
    } finally {
      btn.classList.remove('spin');
      render();
      if (manual) btn.blur();
    }
  }
  document.getElementById('refresh').addEventListener('click', () => load(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

  statTeam = store.get('ventero-equipo');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  load();
})();
