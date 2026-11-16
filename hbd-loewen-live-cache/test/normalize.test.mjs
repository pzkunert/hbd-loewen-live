import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, deduplicateMatches, extractEvents, normalizeMatch } from '../scripts/lib/normalize.mjs';

const teams = [{ id: '74318', label: 'Damen 1', category: 'Erwachsene' }];

test('normalisiert Spiel, Live-Status, Ergebnis und Metadaten', () => {
  const match = normalizeMatch({
    id: 'm1', starts_at: '2026-11-16T19:00:00+01:00', state: 'live', match_minute: 42,
    home_team_id: '74318', home_team_name: 'HBD Löwen Oberberg', away_team_id: '99', away_team_name: 'Gast',
    home_goals: 21, away_goals: 19, home_goals_half: 12, away_goals_half: 10,
    phase_id: 'p1', phase_name: 'Regionalliga', venue_name: 'Löwenhalle'
  }, teams);
  assert.equal(match.id, 'm1');
  assert.equal(match.teamLabel, 'Damen 1');
  assert.equal(match.isLive, true);
  assert.equal(match.score.home, 21);
  assert.equal(match.score.halfAway, 10);
  assert.equal(match.phaseId, 'p1');
});

test('extrahiert Ereignisse und berechnet eine Tabelle aus vollständigen Ergebnissen', () => {
  const payload = { events: [{ event_id: 1, type: 'Goal', time: '01:22', player_name: 'L. Löwe', score_home: 1, score_away: 0 }] };
  assert.deepEqual(extractEvents(payload, 'm1')[0], {
    id: '1', matchId: 'm1', type: 'Goal', time: '01:22', elapsedSeconds: null,
    team: '', playerName: 'L. Löwe', playerNumber: null, scoreHome: 1, scoreAway: 0, message: ''
  });
  const matches = [
    normalizeMatch({ id: '1', state: 'finished', home_team_id: 'a', home_team_name: 'A', away_team_id: 'b', away_team_name: 'B', home_score: 20, away_score: 18 }, []),
    normalizeMatch({ id: '2', state: 'finished', home_team_id: 'b', home_team_name: 'B', away_team_id: 'a', away_team_name: 'A', home_score: 22, away_score: 22 }, [])
  ];
  const table = computeStandings(matches);
  assert.equal(table[0].teamName, 'A');
  assert.equal(table[0].pointsPlus, 3);
  assert.equal(table[1].pointsPlus, 1);
});

test('entfernt doppelte Spiele', () => {
  const base = normalizeMatch({ id: 'same', home_team_name: 'A', away_team_name: 'B' }, []);
  assert.equal(deduplicateMatches([base, { ...base, isLive: true }]).length, 1);
  assert.equal(deduplicateMatches([base, { ...base, isLive: true }])[0].isLive, true);
});
