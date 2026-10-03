/* El Ventero CBV · app de temporada 2026/27 */
(() => {
  'use strict';
  const CFG = window.VENTERO_CONFIG || {};
  const TZ = 'Europe/Madrid';
  const GAME = 150 * 60000; // un partido se considera "en curso" hasta 2h30 tras el inicio
  const $view = document.getElementById('view');
  let D = null;
  let filt = 'todos';
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
      ${withBtn && m.hasStats ? `<a class="btn block" href="#stats-${m.j}">Estadísticas del partido</a>` : ''}
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
      <ol class="list">${list.map((m) => `<li><a class="row${M.next && M.next.j === m.j ? ' next' : ''}${m.prev ? ' moved' : ''}" href="${m.hasStats ? `#stats-${m.j}` : feb(m.p)}"${m.hasStats ? '' : ' target="_blank" rel="noopener"'}>
        <span class="j">J${m.j}</span>
        <span class="mid"><b>${m.vs} ${esc(m.rs)}</b><span>${esc(m.date)} · ${m.time}</span>${m.prev ? `<i>Cambiado · antes ${esc(m.prevLabel)}</i>` : ''}</span>
        <span class="end"><span class="tag ${m.home ? 'casa' : 'fuera'}">${m.home ? 'CASA' : 'FUERA'}</span><b>${m.played ? `${m.ours}–${m.theirs}` : m.st === 'aplazado' ? 'Aplazado' : '—'}</b></span>
      </a></li>`).join('')}</ol>`;
  }

  function viewResultados(M) {
    if (!M.played.length) return '<h2 class="h2">Resultados</h2><p class="empty">Todavía no se ha disputado ningún partido. El primero: domingo 4 de octubre, 12:00, en Villarrobledo.</p>';
    return `<h2 class="h2">Resultados</h2>${M.played.slice().reverse().map((m) => resultRow(m, true)).join('')}`;
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

  function viewStats(M, sel) {
    const games = M.ms.filter((m) => m.hasStats);
    if (!games.length) return '<h2 class="h2">Estadísticas</h2><p class="empty">Las estadísticas de El Ventero se cargan desde el acta FEB de cada partido en cuanto termina.</p>';
    const agg = {};
    games.forEach((m) => D.stats[m.j].players.forEach((p) => {
      const a = agg[p.n] || (agg[p.n] = { n: p.n, pj: 0, pts: 0, reb: 0, ast: 0, rob: 0, val: 0 });
      a.pj++; a.pts += p.pts; a.reb += p.reb; a.ast += p.ast; a.rob += p.rob || 0; a.val += p.val;
    }));
    const season = Object.values(agg).sort((a, b) => b.pts / b.pj - a.pts / a.pj);
    const g = games.find((m) => m.j === sel) || games[games.length - 1];
    const box = D.stats[g.j].players.slice().sort((a, b) => b.pts - a.pts);
    const name = (n) => { const [ap, no] = n.split(','); return esc(no ? `${no.trim().split(' ')[0]} ${ap.trim().split(' ')[0]}` : n); };
    return `<section class="stack" aria-labelledby="h-prom"><h2 id="h-prom" class="h2">Promedios temporada</h2>
      <div class="table"><table><thead><tr><th scope="col">Jugador</th><th scope="col">PJ</th><th scope="col">PTS</th><th scope="col">REB</th><th scope="col">AST</th><th scope="col">ROB</th><th scope="col">VAL</th></tr></thead><tbody>
      ${season.map((a) => `<tr><td title="${esc(a.n)}">${name(a.n)}</td><td>${a.pj}</td><td class="hi">${one(a.pts / a.pj)}</td><td>${one(a.reb / a.pj)}</td><td>${one(a.ast / a.pj)}</td><td>${one(a.rob / a.pj)}</td><td>${one(a.val / a.pj)}</td></tr>`).join('')}
      </tbody></table></div></section>
      <section class="stack" aria-labelledby="h-part"><h2 id="h-part" class="h2">Por partido</h2>
      <div class="games" role="group" aria-label="Elegir jornada">${games.map((m) => `<a class="seg${m.j === g.j ? ' on' : ''}" href="#stats-${m.j}"${m.j === g.j ? ' aria-current="true"' : ''}>J${m.j}</a>`).join('')}</div>
      ${resultRow(g, false)}
      <div class="table"><table><thead><tr><th scope="col">Jugador</th><th scope="col">MIN</th><th scope="col">PT</th><th scope="col">T2</th><th scope="col">T3</th><th scope="col">TL</th><th scope="col">RT</th><th scope="col">AS</th><th scope="col">BR</th><th scope="col">VA</th><th scope="col">+/-</th></tr></thead><tbody>
      ${box.map((p) => `<tr><td title="${esc(p.n)}">${p.ini ? '<span aria-label="titular">*</span>' : ''}${name(p.n)}</td><td>${esc(p.min)}</td><td class="hi">${p.pts}</td><td>${esc(p.t2)}</td><td>${esc(p.t3)}</td><td>${esc(p.tl)}</td><td>${p.reb}</td><td>${p.ast}</td><td>${p.rob}</td><td>${p.val}</td><td>${esc(p.pm)}</td></tr>`).join('')}
      </tbody></table></div>
      <a class="small" href="${feb(g.p)}" target="_blank" rel="noopener">Acta completa en la FEB</a></section>`;
  }

  // ---------- render / navegación ----------
  function route() {
    const h = (location.hash || '#inicio').slice(1);
    const m = /^stats-(\d+)$/.exec(h);
    if (m) return { tab: 'stats', sel: Number(m[1]) };
    return { tab: ['inicio', 'calendario', 'resultados', 'clasificacion', 'stats'].includes(h) ? h : 'inicio' };
  }

  function render() {
    if (!D) return;
    const r = route(), M = model();
    document.querySelectorAll('.tabs a').forEach((a) => (a.dataset.tab === r.tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const me = D.standings && D.standings.rows && D.standings.rows.find((x) => x.team === D.team);
    document.getElementById('record').textContent = me ? `${me.pos}º · ${M.bal.w}–${M.bal.l}` : `${M.bal.w}–${M.bal.l}`;
    document.getElementById('updated').textContent = `Act. ${fmt(D.updated, { day: 'numeric', month: 'short' })} ${hhmm(D.updated)}`;
    $view.innerHTML = r.tab === 'calendario' ? viewCalendario(M) : r.tab === 'resultados' ? viewResultados(M) : r.tab === 'clasificacion' ? viewClasificacion() : r.tab === 'stats' ? viewStats(M, r.sel) : viewInicio(M);
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
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  async function load(manual) {
    const btn = document.getElementById('refresh');
    btn.classList.add('spin');
    try {
      const r = await fetch(`data/season.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      D = await r.json();
      store.set('ventero-data', JSON.stringify(D));
    } catch (e) {
      if (!D) { const c = store.get('ventero-data'); if (c) D = JSON.parse(c); }
      if (!D) $view.innerHTML = '<p class="empty">No se pudieron cargar los datos. Comprueba la conexión y vuelve a intentarlo.</p>';
    } finally {
      btn.classList.remove('spin');
      render();
      if (manual) btn.blur();
    }
  }
  document.getElementById('refresh').addEventListener('click', () => load(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  load();
})();
