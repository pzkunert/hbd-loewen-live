const LIVE_STATES = new Set([
  'live', 'in_progress', 'in progress', 'running', 'started', 'first_half',
  'second_half', 'halftime', 'break', 'pause', '1st_half', '2nd_half'
]);
const FINAL_STATES = new Set([
  'finished', 'final', 'ended', 'post', 'completed', 'closed', 'after_game'
]);
const CANCELLED_STATES = new Set([
  'cancelled', 'canceled', 'postponed', 'abgesetzt', 'verlegt'
]);

const pick = (object, paths, fallback = null) => {
  for (const path of paths) {
    const value = path.split('.').reduce((cursor, key) => cursor?.[key], object);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value, fallback = '') => value === null || value === undefined ? fallback : String(value);

export function extractCollection(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.matches, payload?.items, payload?.results, payload?.content,
    payload?.data?.matches, payload?.data?.items, payload?.data?.results,
    payload?.data?.content, payload?.data?.data, payload?.data
  ];
  return candidates.find(Array.isArray) ?? [];
}

export function extractPagination(payload) {
  const current = numberOrNull(pick(payload, ['page', 'current_page', 'meta.current_page', 'pagination.page'], 1)) ?? 1;
  const last = numberOrNull(pick(payload, ['last_page', 'meta.last_page', 'pagination.last_page', 'pages'], current)) ?? current;
  const next = pick(payload, ['next_page_url', 'links.next', 'pagination.next'], null);
  return { current, last, hasNext: Boolean(next) || current < last };
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const numeric = Number(value);
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function team(raw, side) {
  const prefix = side === 'home' ? 'home' : 'away';
  const camel = `${prefix}Team`;
  const nested = raw?.[camel] ?? raw?.[prefix] ?? raw?.teams?.[prefix] ?? {};
  return {
    id: text(pick(raw, [
      `${prefix}_team_id`, `${prefix}TeamId`, `${camel}.id`, `${prefix}.id`,
      `teams.${prefix}.id`, `${prefix}_team.id`
    ], pick(nested, ['id', 'team_id'], ''))),
    name: text(pick(raw, [
      `${prefix}_team_name`, `${prefix}TeamName`, `${camel}.name`, `${prefix}.name`,
      `teams.${prefix}.name`, `${prefix}_team.name`
    ], pick(nested, ['name', 'label'], side === 'home' ? 'Heim' : 'Gast'))),
    logo: text(pick(raw, [
      `${prefix}_team_logo`, `${prefix}TeamLogo`, `${camel}.logo`, `${prefix}.logo`,
      `teams.${prefix}.logo`, `${prefix}_team.logo`
    ], pick(nested, ['logo', 'image'], '')))
  };
}

function stateValue(raw) {
  return text(pick(raw, ['state', 'status', 'match_status', 'matchStatus', 'game_state', 'gameState'], 'scheduled')).toLowerCase();
}

export function isLiveState(state) {
  const normalized = text(state).toLowerCase();
  return LIVE_STATES.has(normalized) || normalized.includes('live') || normalized.includes('half');
}

export function isFinalState(state) {
  const normalized = text(state).toLowerCase();
  return FINAL_STATES.has(normalized) || normalized.includes('finish') || normalized.includes('beendet');
}

export function normalizeMatch(raw, configuredTeams = []) {
  const home = team(raw, 'home');
  const away = team(raw, 'away');
  const state = stateValue(raw);
  const id = text(pick(raw, ['id', 'match_id', 'matchId', 'game_id', 'gameId', 'uuid']));
  const phaseId = text(pick(raw, ['phase_id', 'phaseId', 'phase.id', 'competition.phase_id', 'league.phase_id']));
  const configured = configuredTeams.find((entry) =>
    String(entry.id) === home.id || String(entry.id) === away.id
  );
  const explicitLive = pick(raw, ['is_live', 'isLive', 'live'], null);
  const explicitFinal = pick(raw, ['is_finished', 'isFinished', 'finished'], null);
  const cancelled = CANCELLED_STATES.has(state) || state.includes('cancel');
  const homeScore = numberOrNull(pick(raw, [
    'home_goals', 'home_score', 'homeScore', 'score.home', 'result.home',
    'goals.home', 'results.home', 'home_team.score', 'home.score'
  ]));
  const awayScore = numberOrNull(pick(raw, [
    'away_goals', 'away_score', 'awayScore', 'score.away', 'result.away',
    'goals.away', 'results.away', 'away_team.score', 'away.score'
  ]));
  const startsAt = normalizeDate(pick(raw, [
    'starts_at', 'startsAt', 'start_time', 'startTime', 'scheduled_at',
    'scheduledAt', 'date', 'datetime', 'kickoff'
  ]));
  const sourceUrl = text(pick(raw, ['url', 'web_url', 'match_url', 'links.web'], id ? `https://www.handball.net/match/${id}` : ''));

  return {
    id,
    teamId: text(configured?.id ?? ''),
    teamLabel: text(configured?.label ?? ''),
    category: text(configured?.category ?? ''),
    phaseId,
    phaseName: text(pick(raw, ['phase_name', 'phaseName', 'phase.name', 'league.name', 'competition.name', 'tournament.name'])),
    startsAt,
    state,
    isLive: explicitLive === true || explicitLive === 1 || isLiveState(state),
    isFinished: explicitFinal === true || explicitFinal === 1 || isFinalState(state),
    isCancelled: cancelled,
    minute: text(pick(raw, ['minute', 'match_minute', 'matchMinute', 'clock.minute', 'time'], '')),
    home,
    away,
    score: {
      home: homeScore,
      away: awayScore,
      halfHome: numberOrNull(pick(raw, ['home_goals_half', 'home_half_score', 'half_score.home', 'halftime.home'])),
      halfAway: numberOrNull(pick(raw, ['away_goals_half', 'away_half_score', 'half_score.away', 'halftime.away']))
    },
    venue: {
      name: text(pick(raw, ['venue_name', 'venue.name', 'hall.name', 'location.name'])),
      address: text(pick(raw, ['venue_address', 'venue.address', 'hall.address', 'location.address'])),
      city: text(pick(raw, ['venue_city', 'venue.city', 'hall.city', 'location.city']))
    },
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

export function normalizeEvent(raw, matchId) {
  return {
    id: text(pick(raw, ['id', 'event_id', 'eventId', 'sequence'])),
    matchId: text(matchId),
    type: text(pick(raw, ['type', 'event_type', 'eventType', 'name'], 'event')),
    time: text(pick(raw, ['time', 'clock', 'minute', 'match_time'])),
    elapsedSeconds: numberOrNull(pick(raw, ['elapsed_seconds', 'elapsedSeconds', 'seconds'])),
    team: text(pick(raw, ['team', 'side', 'team_side'])),
    playerName: text(pick(raw, ['player_name', 'playerName', 'player.name'])),
    playerNumber: numberOrNull(pick(raw, ['player_number', 'playerNumber', 'player.number'])),
    scoreHome: numberOrNull(pick(raw, ['score_home', 'scoreHome', 'score.home'])),
    scoreAway: numberOrNull(pick(raw, ['score_away', 'scoreAway', 'score.away'])),
    message: text(pick(raw, ['message', 'description', 'text', 'label']))
  };
}

export function extractEvents(payload, matchId) {
  const arrays = [payload?.events, payload?.ticker, payload?.timeline, payload?.data?.events, payload?.data?.ticker];
  return (arrays.find(Array.isArray) ?? []).map((entry) => normalizeEvent(entry, matchId));
}

export function normalizeStanding(raw, index = 0) {
  const teamRaw = raw?.team ?? {};
  return {
    rank: numberOrNull(pick(raw, ['rank', 'position', 'place'], index + 1)),
    teamId: text(pick(raw, ['team_id', 'teamId', 'team.id'], pick(teamRaw, ['id'], ''))),
    teamName: text(pick(raw, ['team_name', 'teamName', 'team.name', 'name'], pick(teamRaw, ['name'], ''))),
    games: numberOrNull(pick(raw, ['games', 'played', 'matches'])) ?? 0,
    wins: numberOrNull(pick(raw, ['wins', 'won'])) ?? 0,
    draws: numberOrNull(pick(raw, ['draws', 'draw'])) ?? 0,
    losses: numberOrNull(pick(raw, ['losses', 'lost'])) ?? 0,
    goalsFor: numberOrNull(pick(raw, ['goals_for', 'goalsFor', 'goals.plus'])) ?? 0,
    goalsAgainst: numberOrNull(pick(raw, ['goals_against', 'goalsAgainst', 'goals.minus'])) ?? 0,
    pointsPlus: numberOrNull(pick(raw, ['points_pos', 'points_plus', 'pointsPlus', 'points'])) ?? 0,
    pointsMinus: numberOrNull(pick(raw, ['points_neg', 'points_minus', 'pointsMinus'])) ?? 0
  };
}

export function extractStandings(payload) {
  const candidates = [
    payload?.standings, payload?.table, payload?.rows,
    payload?.data?.standings, payload?.data?.table, payload?.data?.rows
  ];
  return (candidates.find(Array.isArray) ?? extractCollection(payload))
    .map(normalizeStanding)
    .filter((row) => row.teamName);
}

export function computeStandings(matches) {
  const table = new Map();
  const ensure = (team) => {
    if (!table.has(team.id || team.name)) {
      table.set(team.id || team.name, {
        rank: 0, teamId: team.id, teamName: team.name, games: 0, wins: 0,
        draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, pointsPlus: 0, pointsMinus: 0
      });
    }
    return table.get(team.id || team.name);
  };

  for (const match of matches.filter((entry) => entry.isFinished && entry.score.home !== null && entry.score.away !== null)) {
    const home = ensure(match.home);
    const away = ensure(match.away);
    home.games += 1; away.games += 1;
    home.goalsFor += match.score.home; home.goalsAgainst += match.score.away;
    away.goalsFor += match.score.away; away.goalsAgainst += match.score.home;
    if (match.score.home > match.score.away) {
      home.wins += 1; home.pointsPlus += 2; away.losses += 1; away.pointsMinus += 2;
    } else if (match.score.home < match.score.away) {
      away.wins += 1; away.pointsPlus += 2; home.losses += 1; home.pointsMinus += 2;
    } else {
      home.draws += 1; away.draws += 1;
      home.pointsPlus += 1; home.pointsMinus += 1; away.pointsPlus += 1; away.pointsMinus += 1;
    }
  }

  return [...table.values()]
    .sort((a, b) => b.pointsPlus - a.pointsPlus ||
      (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor || a.teamName.localeCompare(b.teamName, 'de'))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function deduplicateMatches(matches) {
  const byId = new Map();
  for (const match of matches) {
    if (!match.id) continue;
    const current = byId.get(match.id);
    byId.set(match.id, current ? {
      ...current,
      ...match,
      teamId: current.teamId || match.teamId,
      teamLabel: current.teamLabel || match.teamLabel,
      category: current.category || match.category
    } : match);
  }
  return [...byId.values()].sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
}
