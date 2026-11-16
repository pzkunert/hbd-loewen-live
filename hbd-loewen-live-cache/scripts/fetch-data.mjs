import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  computeStandings,
  deduplicateMatches,
  extractCollection,
  extractEvents,
  extractPagination,
  extractStandings,
  normalizeMatch
} from './lib/normalize.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const configPath = resolve(process.env.CONFIG_FILE || `${root}/config/teams.json`);
const outputDir = resolve(process.env.OUTPUT_DIR || `${root}/public/data`);
const apiBase = (process.env.HANDBALL_API_BASE || 'https://www.handball.net/api/new').replace(/\/$/, '');
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || 15_000);
const requestDelayMs = Number(process.env.REQUEST_DELAY_MS || 700);
const maxPages = Number(process.env.MAX_PAGES || 20);
const detailTemplate = process.env.MATCH_DETAIL_PATH || 'matches/{id}';
const standingsTemplate = process.env.STANDINGS_PATH || 'standings?phase_id={phaseId}';
const fetchStandings = process.env.FETCH_STANDINGS !== 'false';
const generatedAt = new Date().toISOString();
const diagnostics = { requests: 0, successes: 0, failures: [], strategy: [] };

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, json(value));
  await rename(temporary, path);
}

function buildUrl(path, params = {}) {
  const url = new URL(`${apiBase}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

async function requestJson(path, params = {}, label = path) {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  diagnostics.requests += 1;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
        'user-agent': process.env.HANDBALL_USER_AGENT || 'HBD-Loewen-Live/1.0 (public cache fetcher; contact via repository)',
        'referer': 'https://www.handball.net/'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    diagnostics.successes += 1;
    return body;
  } catch (error) {
    diagnostics.failures.push({ label, error: error.name === 'AbortError' ? 'timeout' : String(error.message || error) });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPaginated(path, params, label) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await requestJson(path, { ...params, page, per_page: 100 }, `${label}:page:${page}`);
    const collection = extractCollection(payload);
    all.push(...collection);
    const pagination = extractPagination(payload);
    if (!pagination.hasNext || collection.length === 0) break;
    await sleep(requestDelayMs);
  }
  return all;
}

function sourceParams(config) {
  return {
    date_from: process.env.SEASON_START || config.season?.from,
    date_to: process.env.SEASON_END || config.season?.to,
    season_id: process.env.SEASON_ID || config.season?.id
  };
}

async function fetchRawMatches(config) {
  const params = sourceParams(config);
  const clubId = process.env.HANDBALL_CLUB_ID || config.club?.apiClubId;
  if (clubId) {
    try {
      diagnostics.strategy.push('club');
      const clubMatches = await fetchPaginated('matches', { ...params, club_id: clubId }, 'club');
      if (clubMatches.length) return clubMatches;
    } catch { /* team fallback below */ }
  }

  diagnostics.strategy.push('teams-sequential');
  const all = [];
  for (const team of config.teams) {
    try {
      const teamMatches = await fetchPaginated('matches', { ...params, team_id: team.id }, `team:${team.id}`);
      all.push(...teamMatches);
    } catch { /* preserve other teams and eventually last-good cache */ }
    await sleep(requestDelayMs);
  }
  return all;
}

async function fetchLiveDetails(liveMatches, rawById) {
  const events = {};
  for (const match of liveMatches) {
    const inline = extractEvents(rawById.get(match.id), match.id);
    if (inline.length) events[match.id] = inline;
    try {
      const path = detailTemplate.replace('{id}', encodeURIComponent(match.id));
      const payload = await requestJson(path, {}, `detail:${match.id}`);
      const detailEvents = extractEvents(payload, match.id);
      if (detailEvents.length) events[match.id] = detailEvents;
    } catch { /* events are optional */ }
    await sleep(requestDelayMs);
  }
  return events;
}

async function getStandings(config, matches, previousStandings) {
  if (!fetchStandings) return previousStandings?.phases || {};
  const previousAge = previousStandings?.generatedAt ? Date.now() - new Date(previousStandings.generatedAt).valueOf() : Infinity;
  if (previousAge < 6 * 60 * 60 * 1000 && Object.keys(previousStandings?.phases || {}).length) {
    return previousStandings.phases;
  }

  const phases = [...new Set(matches.map((match) => match.phaseId).filter(Boolean))];
  const output = {};
  for (const phaseId of phases) {
    const selected = config.teams.some((team) => team.standings !== false && matches.some((match) =>
      match.phaseId === phaseId && (match.home.id === String(team.id) || match.away.id === String(team.id))
    ));
    if (!selected) continue;

    let rows = [];
    let source = 'official';
    try {
      const separator = standingsTemplate.includes('?') ? '&' : '?';
      const resolved = standingsTemplate.replace('{phaseId}', encodeURIComponent(phaseId));
      const [path, query = ''] = resolved.split('?');
      const params = Object.fromEntries(new URLSearchParams(query));
      const payload = await requestJson(path, params, `standings:${phaseId}`);
      rows = extractStandings(payload);
    } catch { /* optional computed fallback */ }

    if (!rows.length && process.env.COMPUTE_STANDINGS_FROM_PHASE === 'true') {
      try {
        const rawPhaseMatches = await fetchPaginated('matches', { ...sourceParams(config), phase_id: phaseId }, `phase:${phaseId}`);
        const phaseMatches = rawPhaseMatches.map((raw) => normalizeMatch(raw, config.teams));
        rows = computeStandings(phaseMatches);
        source = 'computed';
      } catch { /* retain previous phase below */ }
    }

    if (rows.length) {
      const phaseMatch = matches.find((match) => match.phaseId === phaseId);
      output[phaseId] = { phaseId, name: phaseMatch?.phaseName || '', source, rows };
    } else if (previousStandings?.phases?.[phaseId]) {
      output[phaseId] = previousStandings.phases[phaseId];
    }
    await sleep(requestDelayMs);
  }
  return { ...(previousStandings?.phases || {}), ...output };
}

async function main() {
  const config = await readJson(configPath, null);
  if (!config?.teams?.length) throw new Error(`Ungültige Konfiguration: ${configPath}`);
  await mkdir(outputDir, { recursive: true });

  const paths = Object.fromEntries(['matches', 'live', 'events', 'standings', 'teams', 'meta'].map((name) => [name, `${outputDir}/${name}.json`]));
  const previous = {
    matches: await readJson(paths.matches, { matches: [] }),
    live: await readJson(paths.live, { matches: [] }),
    events: await readJson(paths.events, { byMatch: {} }),
    standings: await readJson(paths.standings, { phases: {} }),
    meta: await readJson(paths.meta, {})
  };

  const rawMatches = await fetchRawMatches(config);
  const normalized = deduplicateMatches(rawMatches.map((raw) => normalizeMatch(raw, config.teams)));

  if (!normalized.length) {
    const staleMeta = {
      schemaVersion: 1,
      status: previous.matches.matches?.length ? 'stale' : 'error',
      generatedAt,
      lastSuccessfulAt: previous.meta.lastSuccessfulAt || previous.meta.generatedAt || null,
      message: previous.matches.matches?.length
        ? 'Die Aktualisierung ist fehlgeschlagen. Der letzte erfolgreiche Datenstand bleibt sichtbar.'
        : 'Die Datenquelle lieferte keine Spiele. Bitte den Workflow später erneut ausführen und die Konfiguration prüfen.',
      source: 'cache',
      counts: previous.meta.counts || { matches: 0, live: 0, events: 0, standings: 0 },
      diagnostics
    };
    await writeJsonAtomic(paths.meta, staleMeta);
    console.warn(staleMeta.message);
    process.exitCode = 2;
    return;
  }

  const rawById = new Map(rawMatches.map((raw) => [String(raw.id ?? raw.match_id ?? raw.matchId ?? ''), raw]));
  const liveMatches = normalized.filter((match) => match.isLive);
  const freshEvents = await fetchLiveDetails(liveMatches, rawById);
  const byMatch = { ...previous.events.byMatch, ...freshEvents };
  const phases = await getStandings(config, normalized, previous.standings);
  const teamPhaseMap = Object.fromEntries(config.teams.map((team) => [String(team.id), [...new Set(normalized
    .filter((match) => match.home.id === String(team.id) || match.away.id === String(team.id))
    .map((match) => match.phaseId).filter(Boolean))]]));
  const teams = config.teams.map((team) => ({ ...team, phaseIds: teamPhaseMap[String(team.id)] || [] }));
  const eventCount = Object.values(byMatch).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);
  const counts = { matches: normalized.length, live: liveMatches.length, events: eventCount, standings: Object.keys(phases).length };

  await Promise.all([
    writeJsonAtomic(paths.matches, { schemaVersion: 1, generatedAt, matches: normalized }),
    writeJsonAtomic(paths.live, { schemaVersion: 1, generatedAt, matches: liveMatches }),
    writeJsonAtomic(paths.events, { schemaVersion: 1, generatedAt, byMatch }),
    writeJsonAtomic(paths.standings, { schemaVersion: 1, generatedAt, phases }),
    writeJsonAtomic(paths.teams, { schemaVersion: 1, generatedAt, club: config.club, teams }),
    writeJsonAtomic(paths.meta, {
      schemaVersion: 1,
      status: 'ok',
      generatedAt,
      lastSuccessfulAt: generatedAt,
      message: 'Daten erfolgreich aktualisiert.',
      source: 'handball.net-cache',
      counts,
      diagnostics
    })
  ]);

  console.log(`Cache aktualisiert: ${counts.matches} Spiele, ${counts.live} live, ${counts.events} Ereignisse, ${counts.standings} Tabellen.`);
}

await main();
