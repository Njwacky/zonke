/**
 * test/match_authority.test.js — Stage 2 server-authoritative rules engine.
 *
 * Doc §6 test matrix:
 *   - invalid landing reports      - impossible shots
 *   - out-of-turn actions          - duplicate actions
 *   - replayed actions             - invalid ammunition
 *   - illegal soldier transitions  - incorrect victory claims
 *
 * Part 1: pure unit tests against match_engine.js (no sockets, fast, exact).
 * Part 2: integration against a real spawned server over Socket.IO — proves
 *         the wire protocol (shot_accepted / action_rejected / match_state)
 *         and a full scripted match to an official victory.
 *
 * Flick PHYSICS is intentionally NOT re-simulated (owner constraint:
 * preserve existing physics/animations) — the engine validates shot
 * parameters and applies official transitions; clients reconcile.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const engine = require(path.join(ROOT, 'match_engine.js'));
const RULES = require(path.join(ROOT, 'canonical_rules.js'));

const POOL = RULES.wind.pool; // [-1.4, -0.7, 0, 0, +0.7, +1.4]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fresh() {
    return engine.createMatchState();
}

/* ========================================================================== */
/* Part 1 — pure rules-engine unit tests                                      */
/* ========================================================================== */

describe('match_engine: initial state mirrors the client reset', () => {
    test('rows all 0, ammo 1/1, wind 0.0, turnCount 1 (post-resetGame updateWind)', () => {
        const m = fresh();
        assert.deepEqual(m.rows[1], new Array(9).fill(0));
        assert.deepEqual(m.rows[2], new Array(9).fill(0));
        assert.deepEqual(m.ammo[1], { sticky: 1, foil: 1 });
        assert.deepEqual(m.ammo[2], { sticky: 1, foil: 1 });
        assert.equal(m.wind, 0.0, 'match starts calm (resetGame: turnCount 0 -> 1, no roll)');
        assert.equal(m.turnCount, 1);
        assert.equal(m.pendingShot, null);
        assert.equal(m.winner, 0);
        assert.equal(m.gameOver, false);
    });

    test('wind re-rolls ONLY on every 3rd switch, values from the canonical pool', () => {
        const m = fresh(); // turnCount 1
        engine.advanceWind(m); // 2 — no roll
        assert.equal(m.turnCount, 2);
        assert.equal(m.wind, 0.0);
        engine.advanceWind(m); // 3 — roll
        assert.equal(m.turnCount, 3);
        assert.ok(POOL.includes(m.wind), `wind ${m.wind} must come from the pool`);
        const afterRoll = m.wind;
        engine.advanceWind(m); // 4 — no roll
        assert.equal(m.turnCount, 4);
        assert.equal(m.wind, afterRoll, 'wind unchanged after a non-roll switch');
    });
});

describe('match_engine: flick validation (impossible shots / ammunition)', () => {
    test('rejects flicks after game over', () => {
        const m = fresh();
        m.gameOver = true;
        const r = engine.validateFlick(m, 1, { power: 50 });
        assert.deepEqual(r, { ok: false, reason: 'game_over' });
    });

    test('rejects a second flick while a shot is in flight (duplicate action)', () => {
        const m = fresh();
        const shot = engine.beginShot(m, 1, 50, 'NORMAL');
        assert.equal(shot.id, 1);
        const r = engine.validateFlick(m, 1, { power: 40 });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shot_in_flight');
    });

    test('supersedes a stale in-flight shot after 15s (no room deadlock)', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'NORMAL');
        m.pendingShot.at = Date.now() - 16000;
        const r = engine.validateFlick(m, 1, { power: 40 });
        assert.equal(r.ok, true, 'stale pending shot must not block the room forever');
        assert.equal(m.pendingShot, null, 'the stale shot is cleared during validation');
        const next = engine.beginShot(m, 1, 40, 'NORMAL');
        assert.equal(next.id, 2, 'a fresh shot then supersedes with the next id');
    });

    test('rejects special shots without ammunition (invalid ammunition)', () => {
        const m = fresh();
        m.ammo[1].sticky = 0;
        const r = engine.validateFlick(m, 1, { power: 50, specialShot: 'STICKY' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_ammo');
        m.ammo[1].foil = 0;
        const r2 = engine.validateFlick(m, 1, { power: 50, specialShot: 'FOIL' });
        assert.equal(r2.reason, 'no_ammo');
        // Unknown specials fall back to NORMAL (never bypass the check).
        const r3 = engine.validateFlick(m, 1, { power: 50, specialShot: '<script>' });
        assert.equal(r3.ok, true);
        assert.equal(r3.special, 'NORMAL');
    });
});

describe('match_engine: landing validation (invalid/replayed reports)', () => {
    test('rejects a landing with no open pending shot', () => {
        const m = fresh();
        const r = engine.validateLanding(m, 1, { rowIdx: 3 });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_pending_shot');
    });

    test('rejects a landing from the non-owner of the pending shot', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'NORMAL');
        const r = engine.validateLanding(m, 2, { rowIdx: 3 });
        assert.equal(r.reason, 'not_shot_owner');
    });

    test('rejects a replayed/stale landing bound to an old shot id', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'NORMAL'); // id 1
        engine.resolveLanding(m, 1, 3);
        engine.beginShot(m, 2, 50, 'NORMAL'); // id 2
        const r = engine.validateLanding(m, 2, { rowIdx: 4, shotId: 1 });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shot_mismatch', 'a landing from the previous shot must never apply');
        const ok = engine.validateLanding(m, 2, { rowIdx: 4, shotId: 2 });
        assert.equal(ok.ok, true);
    });

    test('rejects out-of-range rowIdx reports (invalid landing reports)', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'NORMAL');
        for (const bad of [9, -1, 3.5, '4', null, {}, 'X']) {
            const r = engine.validateLanding(m, 1, { rowIdx: bad });
            assert.equal(r.ok, false, `rowIdx ${JSON.stringify(bad)} must be rejected`);
            assert.equal(r.reason, 'invalid_row');
        }
        assert.equal(engine.validateLanding(m, 1, { rowIdx: 8 }).ok, true);
        assert.equal(engine.validateLanding(m, 1, { rowIdx: 'BONUS' }).ok, true);
    });

    test('rejects implausible BONUS claims (nearest row outside the centre band)', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'NORMAL');
        const r = engine.validateLanding(m, 1, { rowIdx: 'BONUS', near: 0 });
        assert.equal(r.reason, 'implausible_bonus');
        assert.equal(engine.validateLanding(m, 1, { rowIdx: 'BONUS', near: 4 }).ok, true);
        // Legacy clients that omit `near` are still accepted (documented).
        assert.equal(engine.validateLanding(m, 1, { rowIdx: 'BONUS' }).ok, true);
    });
});

describe('match_engine: official transitions (illegal soldier transitions)', () => {
    test('normal landing: +1 stage, consumes the active special, flips the turn, rolls wind', () => {
        const m = fresh();
        engine.beginShot(m, 1, 50, 'STICKY');
        const res = engine.resolveLanding(m, 1, 3);
        assert.equal(m.rows[1][3], 1, 'row 4 (idx 3) must progress to stage 1');
        assert.equal(m.ammo[1].sticky, 0, 'sticky consumed on a normal landing');
        assert.equal(res.nextTurn, 2);
        assert.equal(res.windAdvanced, true);
        assert.equal(res.winner, 0);
        assert.equal(m.pendingShot, null, 'pending shot must close after resolution');
    });

    test('landing on own DEAD row without foil: wasted, NO state change, sticky preserved', () => {
        const m = fresh();
        m.rows[1][2] = -1;
        engine.beginShot(m, 1, 50, 'STICKY');
        const res = engine.resolveLanding(m, 1, 2);
        assert.equal(m.rows[1][2], -1, 'dead row stays dead');
        assert.equal(res.events.wasted, true);
        assert.equal(m.ammo[1].sticky, 1, 'client rule: sticky is NOT consumed on a dead-row waste');
    });

    test('tinfoil revive: BOTH rows on that index reset to stage 1, foil consumed', () => {
        const m = fresh();
        m.rows[1][5] = -1;
        m.rows[2][5] = 7;
        engine.beginShot(m, 1, 50, 'FOIL');
        const res = engine.resolveLanding(m, 1, 5);
        assert.equal(m.rows[1][5], 1);
        assert.equal(m.rows[2][5], 1, 'opponent also resets to a fresh race');
        assert.equal(m.ammo[1].foil, 0);
        assert.equal(res.events.foilRevive, true);
    });

    test('landing on an already-complete row: wasted, special consumed', () => {
        const m = fresh();
        m.rows[1][0] = 12;
        engine.beginShot(m, 1, 50, 'FOIL');
        const res = engine.resolveLanding(m, 1, 0);
        assert.equal(m.rows[1][0], 12, 'GOAT row unchanged');
        assert.equal(res.events.wasted, true);
        assert.equal(m.ammo[1].foil, 0, 'foil consumed on the wasted complete-row landing');
    });

    test('completion fires and kills the opponent row ONLY when alive-incomplete', () => {
        const m = fresh();
        m.rows[1][4] = 11;
        m.rows[2][4] = 6; // alive-incomplete -> must die
        engine.beginShot(m, 1, 50, 'NORMAL');
        const res = engine.resolveLanding(m, 1, 4);
        assert.equal(m.rows[1][4], 12);
        assert.equal(m.rows[2][4], -1, 'shoot-first kill applied');
        assert.equal(res.events.kills, 1);
        assert.equal(res.events.completed, true);

        // Opponent already GOAT -> no kill; opponent already dead -> no change.
        const m2 = fresh();
        m2.rows[1][4] = 11;
        m2.rows[2][4] = 12;
        engine.beginShot(m2, 1, 50, 'NORMAL');
        engine.resolveLanding(m2, 1, 4);
        assert.equal(m2.rows[2][4], 12, 'a GOAT row is never killed');

        const m3 = fresh();
        m3.rows[1][4] = 11;
        m3.rows[2][4] = -1;
        engine.beginShot(m3, 1, 50, 'NORMAL');
        engine.resolveLanding(m3, 1, 4);
        assert.equal(m3.rows[2][4], -1, 'a dead row stays dead');
    });

    test('centre bonus: +1 to every alive-incomplete soldier, super-bonus kill on completion, special consumed', () => {
        const m = fresh();
        m.rows[1] = [11, 5, -1, 12, 0, 3, 7, 1, 2];
        m.rows[2] = [0, 4, 9, 0, 0, 0, 0, 0, 0];
        engine.beginShot(m, 1, 50, 'STICKY');
        const res = engine.resolveLanding(m, 1, 'BONUS');
        // Alive-incomplete (0..11) all +1: idx0 11->12 (kill idx0), idx1 5->6,
        // idx2 dead unchanged, idx3 already 12 unchanged, idx4..8 +1 => 7 parts.
        assert.equal(m.rows[1][0], 12);
        assert.equal(m.rows[2][0], -1, 'super-bonus completion kills the matching opponent row');
        assert.equal(m.rows[1][1], 6);
        assert.equal(m.rows[1][2], -1, 'dead rows are never touched by the bonus');
        assert.equal(m.rows[1][3], 12);
        assert.equal(m.rows[1][4], 1);
        assert.equal(m.rows[1][8], 3);
        assert.equal(res.events.partsAdded, 7);
        assert.equal(res.events.kills, 1);
        assert.equal(m.ammo[1].sticky, 0, 'bonus consumes the active special');
    });
});

describe('match_engine: official victory (incorrect victory claims)', () => {
    test('first to 5 GOATs wins immediately', () => {
        const m = fresh();
        m.rows[1] = [12, 12, 12, 12, 12, 0, 0, 0, 0];
        assert.equal(engine.checkVictory(m, 2), 1, 'P1 with 5 GOATs wins even if it is P2\'s turn');

        // Fresh state: P2 reaches 5 first.
        const m2 = fresh();
        m2.rows[1] = [12, 12, 12, 12, 0, 0, 0, 0, 0]; // 4 goats
        m2.rows[2] = [12, 12, 12, 12, 12, 0, 0, 0, 0]; // 5 goats
        assert.equal(engine.checkVictory(m2, 1), 2, 'P2 reaching 5 first wins');
    });

    test('all rows resolved: higher GOAT count wins; exact tie goes to the current (landing) player', () => {
        const m = fresh();
        // P1: 4 goats + 5 dead = 9 resolved; P2: 3 goats + 6 dead = 9 resolved.
        m.rows[1] = [12, 12, 12, 12, -1, -1, -1, -1, -1];
        m.rows[2] = [12, 12, 12, -1, -1, -1, -1, -1, -1];
        assert.equal(engine.checkVictory(m, 2), 1, 'higher goat count wins');
        // Exact tie 3-3 -> landing player (mirrors client: currentPlayer at check time).
        m.rows[1] = [12, 12, 12, -1, -1, -1, -1, -1, -1];
        assert.equal(engine.checkVictory(m, 2), 2, 'tie awarded to the landing player (P2)');
        assert.equal(engine.checkVictory(m, 1), 1);
    });

    test('majority is checked BEFORE the all-resolved tiebreak (client order)', () => {
        const m = fresh();
        // P1 already at 5 GOATs while P2 still has an unresolved row:
        // majority wins immediately (exactly what client checkWinCondition does).
        m.rows[1] = [12, 12, 12, 12, 12, 0, 0, 0, 0];
        m.rows[2] = [-1, -1, -1, -1, -1, -1, -1, -1, 0];
        assert.equal(engine.checkVictory(m, 1), 1);

        // Below majority with unresolved rows: NO victory yet.
        const m2 = fresh();
        m2.rows[1] = [12, 12, 12, 12, 0, 0, 0, 0, 0]; // 4 goats, unresolved
        m2.rows[2] = [-1, -1, -1, -1, -1, -1, -1, -1, -1]; // fully resolved
        assert.equal(engine.checkVictory(m2, 1), 0,
            'cannot claim victory while any of MY rows is unresolved');
    });

    test('winning landing: no turn flip, no wind roll, gameOver latched (client mirror)', () => {
        const m = fresh();
        m.rows[1] = [12, 12, 12, 12, 11, 0, 0, 0, 0];
        const turnBefore = m.turnCount;
        const windBefore = m.wind;
        engine.beginShot(m, 1, 50, 'NORMAL');
        const res = engine.resolveLanding(m, 1, 4); // completes 5th GOAT
        assert.equal(m.winner, 1);
        assert.equal(m.gameOver, true);
        assert.equal(res.nextTurn, 1, 'no flip after the winning shot');
        assert.equal(res.windAdvanced, false);
        assert.equal(m.turnCount, turnBefore, 'wind counter frozen after victory');
        assert.equal(m.wind, windBefore);
        // Everything afterwards is rejected.
        assert.equal(engine.validateFlick(m, 1, { power: 50 }).reason, 'game_over');
        assert.equal(engine.validateLanding(m, 1, { rowIdx: 0 }).reason, 'no_pending_shot');
    });
});

/* ========================================================================== */
/* Part 2 — integration over a real server                                    */
/* ========================================================================== */

let nextPort = 3810; // above integration's 3300 + pid%500 range (parallel test files)

function spawnServer() {
    const port = nextPort++;
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server not ready:\n${out}`)), 8000);
        child.stdout.on('data', (b) => {
            out += b;
            if (out.includes('RUNNING ON PORT')) { clearTimeout(timer); resolve(); }
        });
        child.stderr.on('data', (b) => { out += b; });
        child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}:\n${out}`)); });
    });
    return { port, child, ready, stop: () => { try { child.kill('SIGTERM'); } catch { /* */ } } };
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const s = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false, timeout: 4000 });
        const t = setTimeout(() => { s.close(); reject(new Error('connect timeout')); }, 5000);
        s.once('connect', () => { clearTimeout(t); resolve(s); });
        s.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
}

function waitFor(socket, event, { timeout = 6000, predicate } = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for "${event}"`));
        }, timeout);
        function handler(data) {
            if (predicate && !predicate(data)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(data);
        }
        socket.on(event, handler);
    });
}

async function pair(port) {
    const a = await connect(port);
    const b = await connect(port);
    const fa = waitFor(a, 'match_found');
    const fb = waitFor(b, 'match_found');
    a.emit('find_match', { name: 'Auth_P1' });
    await waitFor(a, 'waiting_for_opponent');
    b.emit('find_match', { name: 'Auth_P2' });
    const [ma, mb] = await Promise.all([fa, fb]);
    assert.ok(ma.matchState, 'match_found must carry the official opening state');
    assert.deepEqual(ma.matchState.rows[1], new Array(9).fill(0));
    return { a, b, ma, mb };
}

/** One full official shot: flick -> shot_accepted -> landing -> match_state on both. */
async function shoot(shooter, observer, rowIdx, extra = {}) {
    const acc = waitFor(shooter, 'shot_accepted');
    shooter.emit('player_flick', { power: 50, wind: 99, ...extra.flick });
    const { shotId } = await acc;
    const sa = waitFor(shooter, 'match_state');
    const sb = waitFor(observer, 'match_state');
    shooter.emit('player_landing', { rowIdx, newWind: 1.4, shotId, ...extra.landing });
    const [s1, s2] = await Promise.all([sa, sb]);
    assert.ok(s1.rows && s2.rows, 'both seats must receive the official snapshot');
    return { shotId, state: s1, observerState: s2 };
}

async function withServer(fn) {
    const s = spawnServer();
    try {
        await s.ready;
        await fn(s.port);
    } finally {
        s.stop();
    }
}

describe('Stage 2 wire protocol (integration)', () => {
    test('flick -> shot_accepted (server wind) -> landing -> official match_state on BOTH seats', async () => {
        await withServer(async (port) => {
            const { a, b } = await pair(port);
            const { state, observerState } = await shoot(a, b, 3);

            assert.equal(state.rows[1][3], 1, 'official state: P1 row idx3 at stage 1');
            assert.equal(observerState.rows[1][3], 1, 'observer receives the same official rows');
            assert.equal(state.currentTurn, 2, 'turn handed to P2');
            assert.equal(state.wind, 0.0, 'server-owned wind (first roll at switch 3)');
            assert.equal(state.ammo[1].sticky, 1, 'NORMAL shot consumes no ammo');
            assert.equal(state.gameOver, false);

            // P2 answers: their landing flips back and rolls the wind (switch 3).
            const r2 = await shoot(b, a, 8);
            assert.equal(r2.state.currentTurn, 1);
            assert.ok(POOL.includes(r2.state.wind), 'wind rolled from the canonical pool');
            assert.equal(r2.state.turnCount, 3);

            a.close(); b.close();
        });
    });

    test('out-of-turn actions, duplicates and impossible shots are rejected', async () => {
        await withServer(async (port) => {
            const { a, b } = await pair(port);

            // Out-of-turn flick (P2 during P1's turn).
            const rej1 = waitFor(b, 'action_rejected');
            b.emit('player_flick', { power: 50 });
            assert.equal((await rej1).reason, 'not_your_turn');

            // P1 flicks once — accepted.
            const acc = waitFor(a, 'shot_accepted');
            a.emit('player_flick', { power: 50 });
            const { shotId } = await acc;

            // Duplicate flick while in flight.
            const rej2 = waitFor(a, 'action_rejected');
            a.emit('player_flick', { power: 60 });
            assert.equal((await rej2).reason, 'shot_in_flight');

            // Invalid landing report (out-of-range row) — pending stays open and
            // the shooter is resynced with the official state.
            const rej3 = waitFor(a, 'action_rejected');
            const resync = waitFor(a, 'match_state');
            a.emit('player_landing', { rowIdx: 99, shotId });
            assert.equal((await rej3).reason, 'invalid_row');
            await resync;

            // Replayed landing bound to an old/foreign shot id (also resyncs —
            // this match_state MUST be consumed before the next waiter).
            const rej4 = waitFor(a, 'action_rejected');
            const resync2 = waitFor(a, 'match_state');
            a.emit('player_landing', { rowIdx: 3, shotId: 999 });
            assert.equal((await rej4).reason, 'shot_mismatch');
            await resync2;

            // The legitimate landing still works (pending was never consumed).
            const sa = waitFor(a, 'match_state');
            a.emit('player_landing', { rowIdx: 3, shotId });
            const st = await sa;
            assert.equal(st.rows[1][3], 1);

            // It is now P2's turn (the landing flipped it) and P2 has never
            // flicked: their landing passes the turn lock but has no pending
            // shot — the "landing without a shot" rejection.
            const rej5 = waitFor(b, 'action_rejected');
            b.emit('player_landing', { rowIdx: 4 });
            assert.equal((await rej5).reason, 'no_pending_shot');

            a.close(); b.close();
        });
    });

    test('special ammunition is enforced and reported officially', async () => {
        await withServer(async (port) => {
            const { a, b } = await pair(port);

            // P1 burns the sticky on a normal landing.
            await shoot(a, b, 0, { flick: { specialShot: 'STICKY' } });
            // P2 takes a filler turn so it is P1's turn again.
            await shoot(b, a, 8);

            // Second sticky flick must be refused (no ammo left).
            const rej = waitFor(a, 'action_rejected');
            a.emit('player_flick', { power: 50, specialShot: 'STICKY' });
            assert.equal((await rej).reason, 'no_ammo');

            // A legal NORMAL shot still works, and the official snapshot
            // reports P1's sticky ammo as consumed (0).
            const r = await shoot(a, b, 1);
            assert.equal(r.state.ammo[1].sticky, 0, 'official ammo: sticky spent');
            assert.equal(r.state.ammo[1].foil, 1, 'foil untouched');

            a.close(); b.close();
        });
    });

    test('a full scripted match reaches an OFFICIAL victory for P1 (first to 5)', async () => {
        await withServer(async (port) => {
            const { a, b } = await pair(port);

            // Bonus rush (a GOAT needs 12 stages, not 5): P1 throws 11 centre
            // bonuses (every alive row -> stage 11), then 5 normal landings on
            // rows 0..4 to complete them -> first to 5 GOATs. P2 fills on
            // row 8 (completes once, then wastes — harmless). Shots alternate
            // exactly like the real turn lock enforces.
            // Paced at ~900ms/iteration to stay under the Stage 1 per-socket
            // flick rate limit (6 per 5s) — a faster script gets rate_limited.
            let lastState = null;
            for (let i = 0; i < 16; i++) {
                const p1Target = i < 11 ? 'BONUS' : (i - 11); // rows 0..4 at the end
                const r1 = await shoot(a, b, p1Target,
                    p1Target === 'BONUS' ? { landing: { near: 4 } } : {});
                lastState = r1.state;
                if (lastState.gameOver) break;
                const r2 = await shoot(b, a, 8);
                lastState = r2.state;
                if (lastState.gameOver) break;
                await sleep(900);
            }

            assert.equal(lastState.gameOver, true, 'match must end officially');
            assert.equal(lastState.winner, 1, 'P1 reaches 5 GOATs first');
            assert.equal(lastState.rows[1].filter((v) => v === 12).length, 5);

            // Nothing may continue after the official result.
            const rej = waitFor(a, 'action_rejected');
            a.emit('player_flick', { power: 50 });
            assert.equal((await rej).reason, 'game_over');

            a.close(); b.close();
        });
    });

    test('reconnect resumes with the full official match_state', async () => {
        await withServer(async (port) => {
            const { a, b, ma } = await pair(port);
            await shoot(a, b, 3); // mutate official state

            b.close();
            const lag = waitFor(a, 'opponent_network_lag');
            await lag;

            const b2 = await connect(port);
            const resumed = waitFor(b2, 'match_resumed_from_lag');
            b2.emit('reconnect_to_match', {
                roomId: ma.roomId,
                token: ma.reconnectToken,
                name: 'Auth_P2'
            });
            const data = await resumed;
            assert.ok(data.matchState, 'resume payload must carry the official state');
            assert.equal(data.matchState.rows[1][3], 1, 'resuming player gets the official rows');
            assert.equal(data.matchState.currentTurn, 2);

            a.close(); b2.close();
        });
    });
});
