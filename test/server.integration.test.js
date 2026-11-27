/* ==========================================================================
   Stage 0 — Multiplayer integration tests (server event validation).
   Spawns the REAL server.js on an isolated port and exercises it over real
   Socket.IO connections + HTTP, covering:
     - application starts and serves the canonical entry point
     - telemetry endpoints answer (documented Stage 0 surface)
     - quick-match pairing (find_match -> match_found roles 1/2)
     - payload clamping (power/wind/specialShot sanitisation)
     - turn anti-cheat (out-of-turn events are dropped)
     - landing -> turn flip relay (player_landing -> sync_landing)
     - private invite room lifecycle
     - malformed payloads do not crash the server
   These are behaviour tests, NOT syntax checks (see "zonke improvement" §4.3).
   ========================================================================== */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io: ioc } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 3300 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc;
const openSockets = [];

/* ------------------------------ helpers ---------------------------------- */

function startServer() {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
            cwd: ROOT,
            env: { ...process.env, PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                proc.kill('SIGKILL');
                reject(new Error(`server did not start in 15s. output:\n${out}`));
            }
        }, 15000);
        const onData = (chunk) => {
            out += chunk.toString();
            if (!settled && out.includes('RUNNING ON PORT')) {
                settled = true;
                clearTimeout(timer);
                resolve(proc);
            }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('exit', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error(`server exited early (code ${code}). output:\n${out}`));
            }
        });
    });
}

function connect() {
    const sock = ioc(BASE, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true
    });
    openSockets.push(sock);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
        sock.on('connect', () => { clearTimeout(timer); resolve(sock); });
        sock.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
}

function waitFor(socket, event, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for "${event}"`));
        }, timeoutMs);
        const handler = (data) => { clearTimeout(timer); resolve(data); };
        socket.once(event, handler);
    });
}

function expectSilence(socket, event, ms = 500) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve({ received: false });
        }, ms);
        const handler = (data) => {
            clearTimeout(timer);
            resolve({ received: true, data });
        };
        socket.once(event, handler);
    });
}

/* ----------------------------- lifecycle --------------------------------- */

before(async () => {
    serverProc = await startServer();
});

after(async () => {
    for (const s of openSockets) {
        try { s.close(); } catch { /* already closed */ }
    }
    if (serverProc && serverProc.exitCode === null) {
        await new Promise((resolve) => {
            const t = setTimeout(() => { serverProc.kill('SIGKILL'); resolve(); }, 3000);
            serverProc.on('exit', () => { clearTimeout(t); resolve(); });
            serverProc.kill('SIGTERM');
        });
    }
});

/* ------------------------------ HTTP layer ------------------------------- */

test('integration: server starts and serves the canonical entry point', async () => {
    const root = await fetch(`${BASE}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.ok(html.includes('game.js'), '/ must serve index.html (canonical entry)');

    const entry = await fetch(`${BASE}/index.html`);
    assert.equal(entry.status, 200);
});

test('integration: telemetry endpoints answer as documented', async () => {
    const dash = await fetch(`${BASE}/telemetry`);
    assert.equal(dash.status, 200);
    assert.ok((await dash.text()).includes('ZONKE TELEMETRY'));

    const post = await fetch(`${BASE}/api/events/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'APP_OPEN', message: 'stage0 test', severity: 'info' })
    });
    assert.equal(post.status, 201);
    const posted = await post.json();
    assert.equal(posted.status, 'success');

    const detail = await fetch(`${BASE}/api/app-detail/`);
    assert.equal(detail.status, 200);
    const json = await detail.json();
    assert.ok(json.metrics && typeof json.metrics.appOpens === 'number');
    assert.ok(typeof json.activeSocketConnections === 'number');
});

/* --------------------------- matchmaking --------------------------------- */

test('integration: two clients pairing via find_match receive roles 1 and 2', async () => {
    const a = await connect();
    const b = await connect();

    const aFound = waitFor(a, 'match_found');
    const bFound = waitFor(b, 'match_found');

    a.emit('find_match', { name: 'Stage0_P1' });
    await waitFor(a, 'waiting_for_opponent');
    b.emit('find_match', { name: 'Stage0_P2' });

    const [aMatch, bMatch] = await Promise.all([aFound, bFound]);
    assert.equal(aMatch.role, 1);
    assert.equal(bMatch.role, 2);
    assert.equal(aMatch.roomId, bMatch.roomId);
    assert.match(aMatch.roomId, /^Zonke-Room-/);
    assert.equal(aMatch.opponentProfile.username, 'Stage0_P2');
    assert.equal(bMatch.opponentProfile.username, 'Stage0_P1');
});

test('integration: payload clamping — power/wind/specialShot sanitised in relay', async () => {
    const a = await connect();
    const b = await connect();

    const aFound = waitFor(a, 'match_found');
    const bFound = waitFor(b, 'match_found');
    a.emit('find_match', { name: 'Clamp_P1' });
    await waitFor(a, 'waiting_for_opponent');
    b.emit('find_match', { name: 'Clamp_P2' });
    await Promise.all([aFound, bFound]);

    const relayed = waitFor(b, 'opponent_flick');
    a.emit('player_flick', { power: 99999, wind: 99, specialShot: '<script>x</script>' });
    const flick = await relayed;

    assert.equal(flick.power, 100, 'power must clamp to 0..100');
    assert.equal(flick.wind, 2.0, 'wind must clamp to -2..2');
    assert.equal(flick.specialShot, 'NORMAL', 'unknown specialShot must fall back to NORMAL');
    assert.equal(flick.playerRole, 1);
});

test('integration: turn anti-cheat — out-of-turn flick is dropped', async () => {
    const a = await connect();
    const b = await connect();

    const aFound = waitFor(a, 'match_found');
    const bFound = waitFor(b, 'match_found');
    a.emit('find_match', { name: 'Turn_P1' });
    await waitFor(a, 'waiting_for_opponent');
    b.emit('find_match', { name: 'Turn_P2' });
    await Promise.all([aFound, bFound]);

    // It is Player 1's turn: Player 2 flicks -> nobody may be notified.
    b.emit('player_flick', { power: 50, wind: 0 });
    const silent = await expectSilence(a, 'opponent_flick');
    assert.equal(silent.received, false, 'out-of-turn flick must NOT be relayed');

    // Player 1 flicks (in turn) -> Player 2 must be notified.
    const relayed = waitFor(b, 'opponent_flick');
    a.emit('player_flick', { power: 55, wind: 0 });
    const flick = await relayed;
    assert.equal(flick.playerRole, 1);
});

test('integration: player_landing flips the turn and relays sync_landing', async () => {
    const a = await connect();
    const b = await connect();

    const aFound = waitFor(a, 'match_found');
    const bFound = waitFor(b, 'match_found');
    a.emit('find_match', { name: 'Land_P1' });
    await waitFor(a, 'waiting_for_opponent');
    b.emit('find_match', { name: 'Land_P2' });
    await Promise.all([aFound, bFound]);

    const synced = waitFor(b, 'sync_landing');
    a.emit('player_landing', { rowIdx: 3, newWind: 1.4 });
    const landing = await synced;

    assert.equal(landing.rowIdx, 3);
    assert.equal(landing.playerRole, 1);
    assert.equal(landing.nextTurn, 2, 'landing must hand the turn to Player 2');
    assert.equal(landing.newWind, 1.4);

    // Now it is P2's turn: a landing from P2 is legal and flips back to P1.
    const synced2 = waitFor(a, 'sync_landing');
    b.emit('player_landing', { rowIdx: 5 });
    const landing2 = await synced2;
    assert.equal(landing2.nextTurn, 1);

    // It is P1's turn again: a landing from P2 must be dropped (register the
    // silence window BEFORE emitting, then assert nothing arrived).
    const silence = expectSilence(a, 'sync_landing', 500);
    b.emit('player_landing', { rowIdx: 6 });
    const late = await silence;
    assert.equal(late.received, false,
        'out-of-turn landing must NOT be relayed');
});

/* --------------------------- invite rooms -------------------------------- */

test('integration: private invite room lifecycle (create -> join -> match)', async () => {
    const host = await connect();
    const guest = await connect();

    const created = waitFor(host, 'invite_room_created');
    host.emit('create_invite_room', { name: 'Host_P1', roomCode: 'DUEL-STAGE0' });
    const room = await created;
    assert.equal(room.roomCode, 'DUEL-STAGE0');

    const hostBroadcast = waitFor(host, 'match_found_broadcast');
    const guestFound = waitFor(guest, 'match_found');
    guest.emit('join_invite_room', { roomCode: 'DUEL-STAGE0', name: 'Guest_P2' });

    const [broadcast, guestMatch] = await Promise.all([hostBroadcast, guestFound]);
    assert.equal(broadcast.roomId, 'DUEL-STAGE0');
    assert.equal(guestMatch.role, 2);
    assert.equal(guestMatch.opponentProfile.username, 'Host_P1');
});

test('integration: joining a non-existent room returns a clear error', async () => {
    const guest = await connect();
    const err = waitFor(guest, 'invite_join_error');
    guest.emit('join_invite_room', { roomCode: 'DUEL-NOPE' });
    const result = await err;
    assert.match(result.message, /not found|expired/i);
});

/* ------------------------- robustness smoke ------------------------------ */

test('integration: malformed payloads do not crash the server', async () => {
    const a = await connect();
    // Garbage in every field — server must sanitise, not throw.
    a.emit('find_match', { name: { evil: true }, avatar: ['x'], rank: 999, wins: 'NaN' });
    a.emit('player_loadout_change', { outfit: null, gun: undefined });
    a.emit('create_invite_room', { roomCode: { obj: 1 } });

    // Server must still answer HTTP afterwards.
    const heartbeat = await fetch(`${BASE}/api/heartbeat/`);
    assert.equal(heartbeat.status, 200);
    const json = await heartbeat.json();
    assert.ok(json.lastHeartbeat, 'server must still be serving after malformed events');
});
