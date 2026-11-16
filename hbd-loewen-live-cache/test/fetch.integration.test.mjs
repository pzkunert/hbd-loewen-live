import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const script = join(projectRoot, 'scripts/fetch-data.mjs');
const asJson = (response, value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };

function runFetch(env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], { cwd: projectRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hbd-live-'));
  const output = join(directory, 'data');
  await mkdir(output, { recursive: true });
  const config = join(directory, 'teams.json');
  await writeFile(config, JSON.stringify({
    club: { name: 'HBD Löwen Oberberg', apiClubId: 'club-test' },
    season: { id: '2627', from: '2026-07-01', to: '2027-06-30' },
    teams: [{ id: '74318', label: 'Damen 1', category: 'Erwachsene', standings: true }]
  }));
  for (const [name, value] of Object.entries({
    matches: { matches: [] }, live: { matches: [] }, events: { byMatch: {} },
    standings: { phases: {} }, teams: { teams: [] }, meta: {}
  })) await writeFile(join(output, `${name}.json`), JSON.stringify(value));
  return { directory, output, config };
}

test('Fetch-Job erzeugt getrennte Cache-Dateien aus einem Club-Abruf', async (context) => {
  const { output, config } = await fixture();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/matches/live-1') return asJson(response, { events: [{ id: 'e1', type: 'Goal', time: '42:10', player_name: 'L. Löwe', score_home: 21, score_away: 19 }] });
    if (url.pathname === '/standings') return asJson(response, { standings: [
      { rank: 1, team_id: '74318', team_name: 'HBD Löwen Oberberg', games: 4, wins: 4, points_pos: 8, points_neg: 0 },
      { rank: 2, team_id: '99', team_name: 'Gast', games: 4, wins: 3, losses: 1, points_pos: 6, points_neg: 2 }
    ] });
    if (url.pathname === '/matches' && url.searchParams.get('club_id')) return asJson(response, { items: [
      { id: 'done-1', starts_at: '2026-11-08T18:00:00+01:00', state: 'finished', home_team_id: '99', home_team_name: 'Gast', away_team_id: '74318', away_team_name: 'HBD Löwen Oberberg', home_goals: 22, away_goals: 25, phase_id: 'p1', phase_name: 'Regionalliga' },
      { id: 'live-1', starts_at: '2026-11-16T14:00:00+01:00', state: 'live', minute: '42:10', home_team_id: '74318', home_team_name: 'HBD Löwen Oberberg', away_team_id: '99', away_team_name: 'Gast', home_goals: 21, away_goals: 19, phase_id: 'p1', phase_name: 'Regionalliga' },
      { id: 'next-1', starts_at: '2026-11-28T19:15:00+01:00', state: 'scheduled', home_team_id: '74318', home_team_name: 'HBD Löwen Oberberg', away_team_id: '100', away_team_name: 'Adler Königshof', phase_id: 'p1', phase_name: 'Regionalliga' }
    ] });
    return asJson(response, { error: 'not found' }, 404);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await runFetch({ CONFIG_FILE: config, OUTPUT_DIR: output, HANDBALL_API_BASE: base, REQUEST_DELAY_MS: '0', FETCH_TIMEOUT_MS: '2000' });
  assert.equal(result.code, 0, result.stderr);
  const matches = JSON.parse(await readFile(join(output, 'matches.json'), 'utf8'));
  const live = JSON.parse(await readFile(join(output, 'live.json'), 'utf8'));
  const events = JSON.parse(await readFile(join(output, 'events.json'), 'utf8'));
  const standings = JSON.parse(await readFile(join(output, 'standings.json'), 'utf8'));
  const meta = JSON.parse(await readFile(join(output, 'meta.json'), 'utf8'));
  assert.equal(matches.matches.length, 3);
  assert.equal(live.matches.length, 1);
  assert.equal(events.byMatch['live-1'][0].playerName, 'L. Löwe');
  assert.equal(standings.phases.p1.rows.length, 2);
  assert.equal(meta.status, 'ok');
  assert.equal(meta.counts.matches, 3);
});

test('Fehler überschreibt den letzten erfolgreichen Spiel-Cache nicht', async (context) => {
  const { output, config } = await fixture();
  const existing = { schemaVersion: 1, generatedAt: '2026-11-16T10:00:00Z', matches: [{ id: 'keep-me' }] };
  await writeFile(join(output, 'matches.json'), JSON.stringify(existing));
  await writeFile(join(output, 'meta.json'), JSON.stringify({ status: 'ok', generatedAt: '2026-11-16T10:00:00Z', lastSuccessfulAt: '2026-11-16T10:00:00Z', counts: { matches: 1 } }));
  const server = createServer((_request, response) => asJson(response, { error: 'forbidden' }, 403));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  context.after(() => server.close());
  const result = await runFetch({ CONFIG_FILE: config, OUTPUT_DIR: output, HANDBALL_API_BASE: `http://127.0.0.1:${server.address().port}`, REQUEST_DELAY_MS: '0', FETCH_TIMEOUT_MS: '1000' });
  assert.equal(result.code, 2);
  const matches = JSON.parse(await readFile(join(output, 'matches.json'), 'utf8'));
  const meta = JSON.parse(await readFile(join(output, 'meta.json'), 'utf8'));
  assert.deepEqual(matches, existing);
  assert.equal(meta.status, 'stale');
  assert.equal(meta.lastSuccessfulAt, '2026-11-16T10:00:00Z');
});
