const DATA_FILES = ['meta', 'matches', 'live', 'events', 'standings', 'teams'];
const emptyData = {
  meta: { status: 'error', message: 'Der JSON-Cache konnte nicht geladen werden.', counts: {} },
  matches: { matches: [] }, live: { matches: [] }, events: { byMatch: {} },
  standings: { phases: {} }, teams: { teams: [] }
};

const state = { data: structuredClone(emptyData), teamId: 'all', gameFilter: 'all', phaseId: '', view: 'home' };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

const dateFormatter = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const updatedFormatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
}

function formatKickoff(value) {
  const date = validDate(value);
  return date ? `${dateFormatter.format(date)} · ${timeFormatter.format(date)} Uhr` : 'Termin offen';
}

function score(value) { return value === null || value === undefined ? '–' : escapeHtml(value); }
function initials(name) { return String(name || '?').split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase(); }
function selectedTeam() { return state.data.teams.teams.find((team) => String(team.id) === state.teamId); }
function belongsToTeam(match, id = state.teamId) {
  return id === 'all' || String(match.teamId) === id || String(match.home?.id) === id || String(match.away?.id) === id;
}

function statusLabel(match) {
  if (match.isLive) return match.minute ? `LIVE · ${escapeHtml(match.minute)}` : 'LIVE';
  if (match.isCancelled) return 'ABGESETZT';
  if (match.isFinished) return 'BEENDET';
  return formatKickoff(match.startsAt);
}

function eventMarkup(matchId) {
  const events = state.data.events.byMatch?.[matchId];
  if (!Array.isArray(events) || !events.length) return '';
  return `<div class="event-list" aria-label="Letzte Spielereignisse">${events.slice(-3).reverse().map((event) => `
    <div class="event"><time>${escapeHtml(event.time || '')}</time><b>${escapeHtml(event.message || event.playerName || event.type)}</b><span>${event.scoreHome ?? ''}${event.scoreHome !== null && event.scoreHome !== undefined ? ':' : ''}${event.scoreAway ?? ''}</span></div>
  `).join('')}</div>`;
}

function matchMarkup(match, options = {}) {
  const liveClass = match.isLive ? ' live' : '';
  const venue = [match.venue?.name, match.venue?.city].filter(Boolean).join(' · ');
  const link = /^https:\/\//.test(match.sourceUrl || '') ? `<a href="${escapeHtml(match.sourceUrl)}" target="_blank" rel="noopener">Spielbericht ↗</a>` : '';
  return `<article class="card match-card${liveClass}">
    <div class="match-meta"><strong>${escapeHtml(match.teamLabel || match.phaseName || 'HBD Löwen')}</strong><span>${statusLabel(match)}</span></div>
    <div class="teams">
      <div class="team-row"><div class="team-name"><span class="team-badge">${escapeHtml(initials(match.home?.name))}</span><span>${escapeHtml(match.home?.name || 'Heim')}</span></div><span class="team-score">${score(match.score?.home)}</span></div>
      <div class="team-row"><div class="team-name"><span class="team-badge">${escapeHtml(initials(match.away?.name))}</span><span>${escapeHtml(match.away?.name || 'Gast')}</span></div><span class="team-score">${score(match.score?.away)}</span></div>
    </div>
    <div class="match-footer"><span>${escapeHtml(match.phaseName || 'Wettbewerb')}</span>${venue ? `<span>· ${escapeHtml(venue)}</span>` : ''}${link}</div>
    ${options.events ? eventMarkup(match.id) : ''}
  </article>`;
}

function emptyMarkup(title, text) {
  return `<div class="empty"><div><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div></div>`;
}

function filteredMatches() {
  return state.data.matches.matches.filter((match) => belongsToTeam(match));
}

function renderStatus() {
  const meta = state.data.meta;
  const dot = $('#statusDot');
  dot.className = `status-dot ${meta.status || 'error'}`;
  $('#statusText').textContent = meta.status === 'ok' ? 'Cache aktuell' : meta.status === 'stale' ? 'Letzter Datenstand' : 'Cache nicht aktuell';
  const date = validDate(meta.lastSuccessfulAt || meta.generatedAt);
  $('#statusTime').textContent = date ? updatedFormatter.format(date) : '';
  const notice = $('#notice');
  if (meta.status === 'ok') notice.innerHTML = '';
  else notice.innerHTML = `<div class="notice ${meta.status === 'error' ? 'error' : ''}">${escapeHtml(meta.message || 'Der letzte verfügbare Datenstand wird angezeigt.')}</div>`;
}

function renderTeamPicker() {
  const select = $('#teamSelect');
  const groups = state.data.teams.teams.reduce((output, team) => {
    const category = team.category || 'Weitere';
    (output[category] ||= []).push(team);
    return output;
  }, {});
  select.innerHTML = '<option value="all">Alle Löwen-Teams</option>' + Object.entries(groups).map(([category, teams]) => `
    <optgroup label="${escapeHtml(category)}">${teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.label)}</option>`).join('')}</optgroup>
  `).join('');
  select.value = state.teamId;
}

function renderHome() {
  const matches = filteredMatches();
  const now = Date.now();
  const live = matches.filter((match) => match.isLive);
  const upcoming = matches.filter((match) => !match.isLive && !match.isFinished && !match.isCancelled && (validDate(match.startsAt)?.valueOf() ?? Infinity) >= now)
    .sort((a, b) => (a.startsAt || '').localeCompare(b.startsAt || ''));
  const results = matches.filter((match) => match.isFinished)
    .sort((a, b) => (b.startsAt || '').localeCompare(a.startsAt || ''));
  $('#liveCount').textContent = live.length;
  $('#liveMatches').innerHTML = live.length ? live.map((match) => matchMarkup(match, { events: true })).join('') : emptyMarkup('Gerade kein Löwen-Spiel live', 'Sobald ein Live-Status im Cache ankommt, erscheint das Spiel hier.');
  $('#nextMatch').innerHTML = upcoming.length ? matchMarkup(upcoming[0]) : emptyMarkup('Kein kommendes Spiel im Cache', 'Der Fetch-Job ergänzt neue Termine automatisch.');
  $('#lastResult').innerHTML = results.length ? matchMarkup(results[0]) : emptyMarkup('Noch kein Ergebnis im Cache', 'Abgeschlossene Spiele erscheinen hier automatisch.');
}

function renderGames() {
  let matches = filteredMatches();
  const now = Date.now();
  if (state.gameFilter === 'live') matches = matches.filter((match) => match.isLive);
  if (state.gameFilter === 'upcoming') matches = matches.filter((match) => !match.isFinished && !match.isCancelled && (validDate(match.startsAt)?.valueOf() ?? Infinity) >= now);
  if (state.gameFilter === 'results') matches = matches.filter((match) => match.isFinished);
  matches.sort((a, b) => state.gameFilter === 'results' ? (b.startsAt || '').localeCompare(a.startsAt || '') : (a.startsAt || '').localeCompare(b.startsAt || ''));
  $('#gamesList').innerHTML = matches.length ? matches.map((match) => matchMarkup(match, { events: match.isLive })).join('') : emptyMarkup('Keine passenden Spiele', 'Ändere den Filter oder wähle eine andere Mannschaft.');
}

function renderPhasePicker() {
  const phases = state.data.standings.phases || {};
  const team = selectedTeam();
  const allowed = team?.phaseIds?.length ? team.phaseIds : Object.keys(phases);
  const options = allowed.filter((id) => phases[id]);
  if (!options.includes(state.phaseId)) state.phaseId = options[0] || '';
  $('#phaseSelect').innerHTML = options.length ? options.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(phases[id].name || `Staffel ${id}`)}</option>`).join('') : '<option value="">Keine Tabelle verfügbar</option>';
  $('#phaseSelect').value = state.phaseId;
}

function renderStandings() {
  renderPhasePicker();
  const phase = state.data.standings.phases?.[state.phaseId];
  if (!phase?.rows?.length) {
    $('#standings').innerHTML = emptyMarkup('Keine Tabelle im Cache', 'Tabellen werden angezeigt, sobald die öffentliche Quelle sie bereitstellt.');
    return;
  }
  $('#standings').innerHTML = `
    <div class="table-head"><span>Pl.</span><span>Team</span><span>Sp.</span><span>Pkt.</span></div>
    ${phase.rows.map((row) => `<div class="table-row ${/hbd|löwen/i.test(row.teamName) ? 'hbd' : ''}"><span class="rank">${escapeHtml(row.rank)}</span><span class="club">${escapeHtml(row.teamName)}</span><span class="games">${escapeHtml(row.games)}</span><span class="points">${escapeHtml(row.pointsPlus)}:${escapeHtml(row.pointsMinus)}</span></div>`).join('')}
    <div class="table-note">${phase.source === 'computed' ? 'Aus vollständigen Staffelergebnissen berechnet.' : 'Offizielle, gecachte Tabellendaten.'}</div>`;
}

function renderAll() {
  renderStatus(); renderTeamPicker(); renderHome(); renderGames(); renderStandings();
}

async function readCache(name, cacheBust = false) {
  const suffix = cacheBust ? `?v=${Date.now()}` : '';
  const response = await fetch(`data/${name}.json${suffix}`, { cache: cacheBust ? 'reload' : 'default' });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

async function loadData(cacheBust = false) {
  const button = $('#refreshButton');
  button.classList.add('loading');
  const results = await Promise.allSettled(DATA_FILES.map((name) => readCache(name, cacheBust)));
  results.forEach((result, index) => {
    const name = DATA_FILES[index];
    state.data[name] = result.status === 'fulfilled' ? result.value : structuredClone(emptyData[name]);
  });
  if (!state.data.teams.teams.length && state.data.matches.matches.length) {
    state.data.teams.teams = [...new Map(state.data.matches.matches.filter((match) => match.teamId).map((match) => [match.teamId, { id: match.teamId, label: match.teamLabel || match.teamId, category: match.category, phaseIds: [match.phaseId].filter(Boolean) }])).values()];
  }
  renderAll();
  button.classList.remove('loading');
}

$('#teamSelect').addEventListener('change', (event) => { state.teamId = event.target.value; state.phaseId = ''; renderHome(); renderGames(); renderStandings(); });
$('#phaseSelect').addEventListener('change', (event) => { state.phaseId = event.target.value; renderStandings(); });
$('#refreshButton').addEventListener('click', () => loadData(true));
$$('.filter').forEach((button) => button.addEventListener('click', () => {
  state.gameFilter = button.dataset.filter;
  $$('.filter').forEach((item) => item.classList.toggle('active', item === button));
  renderGames();
}));
$$('.nav-item').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.target;
  $$('.nav-item').forEach((item) => { item.classList.toggle('active', item === button); item.toggleAttribute('aria-current', item === button); });
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === state.view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#main').focus({ preventScroll: true });
}));

$('#liveMatches').innerHTML = '<div class="skeleton" aria-label="Lädt"></div>';
$('#nextMatch').innerHTML = '<div class="skeleton" aria-label="Lädt"></div>';
$('#lastResult').innerHTML = '<div class="skeleton" aria-label="Lädt"></div>';
loadData();
setInterval(() => loadData(true), 60_000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
