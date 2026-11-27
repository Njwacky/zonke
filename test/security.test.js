/**
 * test/security.test.js — Stage 1 security hardening tests (doc §5.5).
 *
 * Covers, against a REAL spawned server process per scenario:
 *   5.1 Socket.IO  — origin allowlist, handshake identity, payload size cap,
 *                     per-event rate limits, malformed-payload rejection,
 *                     duplicate in-match actions, reconnect-token validation
 *   5.2 Static     — public-asset allowlist; private files return 404
 *   5.3 Telemetry  — optional write/dashboard keys, field validation,
 *                     malformed JSON / oversized body, per-IP rate limits,
 *                     CORS origin reflection
 *   5.4 Reconnect  — server-issued expiring per-seat tokens, no seat takeover,
 *                     per-role disconnect timers (regression: one player's
 *                     reconnect must NOT cancel the other player's window)
 *
 * Offline gameplay is proven by the other suites (syntax / canonical rules /
 * entrypoint) staying green alongside this file.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/* ------------------------------------------------------------------ utils */

let nextPort = 3210;

function spawnServer(env = {}) {
    const port = nextPort++;
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server not ready on ${port}:\n${output}`)), 8000);
        const onData = (buf) => {
            output += buf.toString();
            if (output.includes('RUNNING ON PORT')) {
                clearTimeout(timer);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited early (${code}):\n${output}`));
        });
    });
    return {
        port,
        child,
        ready,
        output: () => output,
        stop() {
            try { child.kill('SIGTERM'); } catch { /* already dead */ }
        }
    };
}

async function withServer(fn, env = {}) {
    const s = spawnServer(env);
    try {
        await s.ready;
        await fn(s.port, s);
    } finally {
        s.stop();
    }
}

function connect(port, opts = {}) {
    return new Promise((resolve, reject) => {
        const socket = io(`http://localhost:${port}`, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 4000,
            ...opts
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('connect timeout'));
        }, 5000);
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
        socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
}

/** Connect expecting a middleware rejection; resolves with the error message. */
function connectExpectError(port, opts = {}) {
    return new Promise((resolve, reject) => {
        const socket = io(`http://localhost:${port}`, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 4000,
            ...opts
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('expected connect_error, but connected instead'));
        }, 5000);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.close();
            reject(new Error('expected connect_error, but connected instead'));
        });
        socket.once('connect_error', (err) => {
            clearTimeout(timer);
            resolve(err.message || String(err));
        });
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

function closeAll(...sockets) {
    for (const s of sockets) { try { s.close(); } catch { /* ignore */ } }
}

/** Pair two fresh sockets into a live match. Resolves { a, b, roomId, tokA, tokB }. */
async function makeMatch(port, graceEnv) {
    const a = await connect(port);
    const b = await connect(port);
    const foundA = waitFor(a, 'match_found');
    const foundB = waitFor(b, 'match_found');
    a.emit('find_match', { name: 'Alpha', wins: 3 });
    b.emit('find_match', { name: 'Bravo', wins: 7 });
    const [ma, mb] = await Promise.all([foundA, foundB]);
    assert.ok(ma.reconnectToken, 'P1 must receive a reconnect token in match_found');
    assert.ok(mb.reconnectToken, 'P2 must receive a reconnect token in match_found');
    assert.notEqual(ma.reconnectToken, mb.reconnectToken, 'tokens must be per-seat');
    return { a, b, roomId: ma.role === 1 ? ma.roomId : mb.roomId, tokA: ma.reconnectToken, tokB: mb.reconnectToken, roleA: ma.role };
}

async function get(port, p, opts = {}) {
    const res = await fetch(`http://localhost:${port}${p}`, opts);
    const body = await res.text(); // read exactly once
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* non-JSON body (e.g. dashboard HTML) */ }
    return { status: res.status, headers: res.headers, body, json: async () => parsed };
}

async function postJson(port, p, body, opts = {}) {
    const res = await fetch(`http://localhost:${port}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...opts
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* non-json */ }
    return { status: res.status, json: parsed };
}

/* ========================================================================== */
/* 5.2 — Static file exposure                                                 */
/* ========================================================================== */

describe('5.2 static file exposure (allowlist)', () => {
    test('private/server files are NOT served; public assets are', async () => {
        await withServer(async (port) => {
            const blocked = [
                '/server.js',
                '/package.json',
                '/package-lock.json',
                '/supabase_setup.sql',
                '/README.md',
                '/RULES.md',
                '/canonical_rules.js',
                '/.git/config',
                '/.gitignore',
                '/docs/STAGE0_BASELINE.md',
                '/docs/CANONICAL_RULES.md',
                '/test/security.test.js',
                '/test/server.integration.test.js',
                '/.github/workflows/ci.yml',
                '/zonke%20improvement',          // the instruction document itself
                '/..%2f..%2fpackage.json',       // encoded traversal
                '/%2e%2e/%2e%2e/package.json',   // encoded traversal (dot variant)
                '/style.css%2f..%2f..%2fserver.js' // allowlist-entry traversal attempt
            ];
            for (const p of blocked) {
                const r = await get(port, p);
                assert.equal(r.status, 404, `${p} must be 404 (got ${r.status})`);
                assert.ok(!r.body.includes('require('), `${p} must not leak source`);
                assert.ok(!r.body.includes('"scripts"'), `${p} must not leak package.json`);
            }

            const allowed = ['/', '/index.html', '/style.css', '/game.js', '/sw.js', '/manifest.json', '/icon.svg', '/zonke.html'];
            for (const p of allowed) {
                const r = await get(port, p);
                assert.equal(r.status, 200, `${p} must remain publicly served (got ${r.status})`);
            }
        });
    });

    test('404 body is generic (no path echo, no stack)', async () => {
        await withServer(async (port) => {
            const r = await get(port, '/server.js');
            assert.equal(r.status, 404);
            assert.equal(r.body, 'Not Found');
        });
    });
});

/* ========================================================================== */
/* 5.3 — Telemetry                                                            */
/* ========================================================================== */

describe('5.3 telemetry hardening', () => {
    test('Phase 1 default (no keys): writes and reads work, values are validated', async () => {
        await withServer(async (port) => {
            const w = await postJson(port, '/api/events/', {
                type: '<script>alert(1)</script>',
                severity: 'extreme-danger',
                message: '<b>boom</b>' + 'y'.repeat(300),
                username: 'u'.repeat(100),
                details: { ok: true }
            });
            assert.equal(w.status, 201);

            const r = await get(port, '/api/events/');
            assert.equal(r.status, 200);
            const data = await r.json();
            const ev = data.events[0];
            assert.equal(ev.type, 'INFO', 'malformed type must fall back to INFO');
            assert.equal(ev.severity, 'info', 'non-whitelisted severity must fall back to info');
            assert.ok(ev.message.length <= 200, 'message must be length-capped');
            assert.ok(!ev.message.includes('<'), 'markup must be stripped from message');
            assert.ok(ev.username.length <= 24, 'username must be length-capped');

            // Performance: non-numeric values must NOT be stored (typeof NaN === 'number' hole closed).
            const perfBefore = await (await get(port, '/api/performance/')).json();
            await postJson(port, '/api/performance/', { lcp: 'abc', inp: null, cls: {} });
            const perfAfter = await (await get(port, '/api/performance/')).json();
            assert.deepEqual(perfAfter.performance, perfBefore.performance, 'invalid performance values must not mutate state');

            // Heartbeat: status must be an enum.
            await postJson(port, '/api/heartbeat/', { status: '<img src=x onerror=1>', appId: 'x'.repeat(200) });
            const hb = await (await get(port, '/api/heartbeat/')).json();
            assert.ok(['online', 'offline'].includes(hb.status), 'heartbeat status must be enum-constrained');
        });
    });

    test('TELEMETRY_WRITE_KEY: unauthenticated/wrong writes are 401, correct key passes (header and Bearer)', async () => {
        await withServer(async (port) => {
            const noKey = await postJson(port, '/api/events/', { type: 'LOGIN_SUCCESS', message: 'x' });
            assert.equal(noKey.status, 401);
            const wrong = await postJson(port, '/api/events/', { type: 'LOGIN_SUCCESS', message: 'x' }, { headers: { 'x-zonke-telemetry-key': 'nope' } });
            assert.equal(wrong.status, 401);
            const good = await postJson(port, '/api/events/', { type: 'LOGIN_SUCCESS', message: 'x' }, { headers: { 'x-zonke-telemetry-key': 'w-secret' } });
            assert.equal(good.status, 201);
            const bearer = await postJson(port, '/api/events/', { type: 'LOGIN_SUCCESS', message: 'x' }, { headers: { authorization: 'Bearer w-secret' } });
            assert.equal(bearer.status, 201);
        }, { TELEMETRY_WRITE_KEY: 'w-secret' });
    });

    test('TELEMETRY_DASHBOARD_KEY: private reads gated, ?key= works for the browser dashboard', async () => {
        await withServer(async (port) => {
            assert.equal((await get(port, '/api/app-detail/')).status, 401);
            assert.equal((await get(port, '/api/events/')).status, 401);
            assert.equal((await get(port, '/telemetry')).status, 401);
            assert.equal((await get(port, '/api/app-detail/?key=wrong')).status, 401);
            assert.equal((await get(port, '/api/app-detail/?key=d-secret')).status, 200);
            assert.equal((await get(port, '/telemetry?key=d-secret')).status, 200);
            const hdr = await get(port, '/api/events/', { headers: { 'x-zonke-telemetry-key': 'd-secret' } });
            assert.equal(hdr.status, 200);
            // Public endpoints stay open without a key.
            assert.equal((await get(port, '/api/heartbeat/')).status, 200);
            assert.equal((await get(port, '/api/performance/')).status, 200);
        }, { TELEMETRY_DASHBOARD_KEY: 'd-secret' });
    });

    test('malformed JSON and oversized bodies get safe generic errors', async () => {
        await withServer(async (port) => {
            const bad = await postJson(port, '/api/events/', '{not json');
            assert.equal(bad.status, 400);
            assert.equal(bad.json.error, 'invalid_json');

            const big = await postJson(port, '/api/events/', JSON.stringify({ message: 'x'.repeat(17 * 1024) }));
            assert.equal(big.status, 413);
            assert.equal(big.json.error, 'payload_too_large');

            // Server still healthy afterwards.
            assert.equal((await get(port, '/api/heartbeat/')).status, 200);
        });
    });

    test('per-IP write rate limit returns 429 {error:"rate_limited"}', async () => {
        await withServer(async (port) => {
            let saw429 = null;
            for (let i = 0; i < 70; i++) {
                const r = await postJson(port, '/api/events/', { type: 'INFO', message: `flood ${i}` });
                if (r.status === 429) { saw429 = r; break; }
            }
            assert.ok(saw429, 'expected a 429 within 70 rapid writes (limit 60/min)');
            assert.equal(saw429.json.error, 'rate_limited');
        });
    });

    test('CORS reflects only allowlisted origins (browser-level protection)', async () => {
        await withServer(async (port) => {
            const evil = await get(port, '/api/performance/', { headers: { origin: 'https://evil.example' } });
            assert.equal(evil.status, 200); // server still answers (rate limits + keys are the server-side control)
            assert.ok(!evil.headers.get('access-control-allow-origin'), 'evil origin must not receive CORS approval');
            const good = await get(port, '/api/performance/', { headers: { origin: 'http://localhost:3000' } });
            assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:3000');
            // Wildcard default must also apply to HTTP CORS (regression: scheme-prefixed '*.' entries).
            const preview = await get(port, '/api/performance/', { headers: { origin: 'https://preview-42.e2b.app' } });
            assert.equal(preview.headers.get('access-control-allow-origin'), 'https://preview-42.e2b.app');
            const fake = await get(port, '/api/performance/', { headers: { origin: 'https://fakee2b.app' } });
            assert.ok(!fake.headers.get('access-control-allow-origin'), 'suffix spoof must not get CORS approval');
        });
    });
});

/* ========================================================================== */
/* 5.1 — Socket.IO connection identity, validation, limits                    */
/* ========================================================================== */

describe('5.1 socket.io hardening', () => {
    test('disallowed origins are rejected at handshake; allowlisted origins connect', async () => {
        await withServer(async (port) => {
            const err = await connectExpectError(port, { extraHeaders: { origin: 'https://evil.example' } });
            assert.equal(err, 'origin_not_allowed');
            const ok = await connect(port, { extraHeaders: { origin: 'http://localhost:3000' } });
            ok.close();
            // No Origin header at all (tests, curl, native) remains allowed.
            const noOrigin = await connect(port);
            noOrigin.close();
        });
    });

    test('default wildcard origins (*.e2b.app) are honoured — and only genuine suffix matches', async () => {
        await withServer(async (port) => {
            // Regression: scheme-prefixed wildcards in DEFAULT_ORIGINS used to
            // never match (entry.startsWith('*.')), rejecting every Arena preview.
            const preview = await connect(port, { extraHeaders: { origin: 'https://preview-42.e2b.app' } });
            preview.close();
            const nested = await connect(port, { extraHeaders: { origin: 'https://a.b.e2b.app:8443' } });
            nested.close();
            // Suffix attacks must still fail: no dot before e2b, and apex is not covered.
            const fake = await connectExpectError(port, { extraHeaders: { origin: 'https://fakee2b.app' } });
            assert.equal(fake, 'origin_not_allowed');
            const apex = await connectExpectError(port, { extraHeaders: { origin: 'https://e2b.app' } });
            assert.equal(apex, 'origin_not_allowed');
            // Scheme matters: http on an https-only entry is rejected.
            const http = await connectExpectError(port, { extraHeaders: { origin: 'http://zonke.netlify.app' } });
            assert.equal(http, 'origin_not_allowed');
        });
    });

    test('ALLOWED_ORIGINS env replaces the default list', async () => {
        await withServer(async (port) => {
            const ok = await connect(port, { extraHeaders: { origin: 'https://allowed.example' } });
            ok.close();
            const err = await connectExpectError(port, { extraHeaders: { origin: 'https://zonke.netlify.app' } });
            assert.equal(err, 'origin_not_allowed', 'default origins must be replaced by the env list');
        }, { ALLOWED_ORIGINS: 'https://allowed.example' });
    });

    test('handshake: legacy clients accepted by default; REQUIRE_HANDSHAKE=1 enforces identity', async () => {
        await withServer(async (port) => {
            const legacy = await connect(port); // no auth payload
            legacy.close();
            const proper = await connect(port, { auth: { client: 'zonke-web', v: 1 } });
            proper.close();
            const spoof = await connectExpectError(port, { auth: { client: 'someone-else', v: 1 } });
            assert.equal(spoof, 'invalid_handshake');
        });
        await withServer(async (port) => {
            const missing = await connectExpectError(port);
            assert.equal(missing, 'handshake_required');
            const wrongV = await connectExpectError(port, { auth: { client: 'zonke-web', v: 99 } });
            assert.equal(wrongV, 'handshake_required');
            const ok = await connect(port, { auth: { client: 'zonke-web', v: 1 } });
            ok.close();
        }, { REQUIRE_HANDSHAKE: '1' });
    });

    test('payloads over maxHttpBufferSize (8KB) drop the socket; server survives', async () => {
        await withServer(async (port) => {
            const s = await connect(port);
            // Watchers MUST be attached before the emit, with a hard timeout so a
            // regression (payload accepted) fails fast instead of hanging CI.
            const dropWatch = new Promise((resolve) => {
                s.once('disconnect', (r) => resolve(`disconnect:${r}`));
                s.once('connect_error', (e) => resolve(`error:${e.message}`));
                setTimeout(() => resolve('TIMEOUT'), 4000);
            });
            s.emit('find_match', { name: 'BigBoy', pad: 'x'.repeat(20 * 1024) });
            const reason = await dropWatch;
            assert.notEqual(reason, 'TIMEOUT', 'oversized payload must disconnect the client');
            assert.equal((await get(port, '/')).status, 200, 'server must stay up');
            // A fresh client can still connect and play matchmaking.
            const s2 = await connect(port);
            const waiting = waitFor(s2, 'waiting_for_opponent');
            s2.emit('find_match', { name: 'Next' });
            await waiting;
            s2.close();
        });
    });

    test('malformed find_match payloads are rejected with matchmaking_error', async () => {
        await withServer(async (port) => {
            const s = await connect(port);
            const e1 = waitFor(s, 'matchmaking_error');
            s.emit('find_match', 'not-an-object');
            assert.match((await e1).message, /Invalid matchmaking/);
            const e2 = waitFor(s, 'matchmaking_error');
            s.emit('find_match', ['array']);
            await e2;
            s.close();
        });
    });

    test('per-event rate limit emits rate_limited and stops the flood', async () => {
        await withServer(async (port) => {
            const s = await connect(port);
            const limited = waitFor(s, 'rate_limited');
            for (let i = 0; i < 15; i++) s.emit('find_match', { name: `F${i}` });
            const data = await limited;
            assert.equal(data.event, 'find_match');
            s.close();
        });
    });

    test('duplicate find_match while in a live match is rejected (no queue/replay corruption)', async () => {
        await withServer(async (port) => {
            const { a, b } = await makeMatch(port);
            const err = waitFor(a, 'matchmaking_error');
            a.emit('find_match', { name: 'Again' });
            assert.match((await err).message, /already in an active match/);
            closeAll(a, b);
        });
    });

    test('source contract: membership guards + payload guards present in server.js', () => {
        assert.match(serverSrc, /room\.p1 !== socket && room\.p2 !== socket/,
            'flick/landing/loadout must be restricted to seat occupants');
        assert.match(serverSrc, /maxHttpBufferSize: ENV\.maxHttpBufferSize/);
        assert.match(serverSrc, /function isPlainObject/);
        assert.match(serverSrc, /PUBLIC_ASSETS/);
        assert.match(serverSrc, /io\.use\(/, 'connection middleware must exist');
    });
});

/* ========================================================================== */
/* 5.4 / 5.5 — Reconnect credentials, timers, host credential                 */
/* ========================================================================== */

describe('5.4/5.5 reconnect & invite credentials', () => {
    test('valid token reconnects: resumed event received, opponent sees the lag notice', async () => {
        await withServer(async (port) => {
            const { a, b, roomId, tokB } = await makeMatch(port);
            const lagAtA = waitFor(a, 'opponent_network_lag');
            b.close();
            const lag = await lagAtA;
            assert.equal(lag.disconnectedRole, 2);

            const b2 = await connect(port);
            const resumed = waitFor(b2, 'match_resumed_from_lag');
            b2.emit('reconnect_to_match', { roomId, token: tokB, name: 'Bravo' });
            await resumed;
            closeAll(a, b2);
        });
    });

    test('wrong / missing tokens are rejected — no seat takeover', async () => {
        await withServer(async (port) => {
            const { a, b, roomId, tokB } = await makeMatch(port);
            const lagAtA = waitFor(a, 'opponent_network_lag');
            b.close();
            await lagAtA;

            // Attacker knows the room code (it is in the shareable link) but has no token.
            const attacker = await connect(port);
            const rej1 = waitFor(attacker, 'invite_join_error');
            attacker.emit('reconnect_to_match', { roomId, token: 'forged-token-value', name: 'Mugger' });
            await rej1;

            // Old role-spoofing shape: role claimed, token missing entirely.
            const rej2 = waitFor(attacker, 'invite_join_error');
            attacker.emit('reconnect_to_match', { roomId, role: 2, name: 'Mugger' });
            await rej2;

            // Attacker must never receive the resume signal.
            let attackerResumed = false;
            attacker.on('match_resumed_from_lag', () => { attackerResumed = true; });
            await new Promise((r) => setTimeout(r, 200));
            assert.equal(attackerResumed, false, 'forged credentials must never resume a match');

            // The legitimate owner, holding the real token, still gets back in.
            const b2 = await connect(port);
            const resumed = waitFor(b2, 'match_resumed_from_lag');
            b2.emit('reconnect_to_match', { roomId, token: tokB, name: 'Bravo' });
            await resumed;

            closeAll(a, attacker, b2);
        });
    });

    test('expired token (short TTL) is rejected', async () => {
        await withServer(async (port) => {
            const { a, b, roomId, tokB } = await makeMatch(port);
            const lagAtA = waitFor(a, 'opponent_network_lag');
            b.close();
            await lagAtA;
            await new Promise((r) => setTimeout(r, 250)); // TTL is 100ms in this spawn

            const b2 = await connect(port);
            const rej = waitFor(b2, 'invite_join_error');
            b2.emit('reconnect_to_match', { roomId, token: tokB, name: 'Bravo' });
            const err = await rej;
            assert.match(err.message, /expired/i);
            closeAll(a, b2);
        }, { RECONNECT_TOKEN_TTL_MS: '100', DISCONNECT_GRACE_MS: '10000' });
    });

    test('REGRESSION: player A reconnecting must NOT cancel player B\'s disconnect window', async () => {
        // Old code had ONE shared room.disconnectTimer: A's reconnect cleared it,
        // so when B stayed gone the match hung forever instead of forfeiting.
        await withServer(async (port) => {
            const { a, b, roomId, tokA } = await makeMatch(port);
            // A drops first: B is the live observer of the lag notice
            // (socket.to() never sends to the departing socket itself).
            const lagOnB = waitFor(b, 'opponent_network_lag');
            a.close();
            await lagOnB;
            // B drops too: nobody is left in the room to observe the notice,
            // but the server starts B's own per-role grace timer here.
            b.close();

            const a2 = await connect(port);
            const resumed = waitFor(a2, 'match_resumed_from_lag');
            a2.emit('reconnect_to_match', { roomId, token: tokA, name: 'Alpha' });
            await resumed;             // A is back — under the OLD code this cancelled B's window

            // B's timer must STILL fire -> A gets the forfeit win.
            const forfeit = waitFor(a2, 'opponent_disconnected', { timeout: 4000 });
            const msg = await forfeit;
            assert.match(msg.message, /grace period|forfeit/i);
            a2.close();
        }, { DISCONNECT_GRACE_MS: '900' });
    });

    test('reconnect after opponent already left: seat credential still bounded by room lifetime', async () => {
        await withServer(async (port) => {
            const { a, b, roomId, tokB } = await makeMatch(port);
            const lagAtA = waitFor(a, 'opponent_network_lag');
            b.close();
            await lagAtA;
            // Wait past B's grace (1s) -> room is deleted -> even a VALID token is useless.
            await new Promise((r) => setTimeout(r, 1400));
            const b2 = await connect(port);
            const rej = waitFor(b2, 'invite_join_error');
            b2.emit('reconnect_to_match', { roomId, token: tokB, name: 'Bravo' });
            const err = await rej;
            assert.match(err.message, /expired or closed/i);
            closeAll(a, b2);
        }, { DISCONNECT_GRACE_MS: '1000' });
    });

    test('host reattach requires the host credential (code alone is not enough)', async () => {
        await withServer(async (port) => {
            const host = await connect(port);
            const created = waitFor(host, 'invite_room_created');
            host.emit('create_invite_room', { name: 'Host', roomCode: 'DUEL-7777' });
            const roomInfo = await created;
            assert.ok(roomInfo.hostToken, 'invite_room_created must carry a host token');

            // Attacker knows the code (from the shareable link) but not the token.
            const attacker = await connect(port);
            let attackerGotRoom = false;
            attacker.on('invite_room_created', () => { attackerGotRoom = true; });
            attacker.emit('maintain_invite_room', { roomCode: 'DUEL-7777', hostToken: 'guessed-token' });
            await new Promise((r) => setTimeout(r, 250));
            assert.equal(attackerGotRoom, false, 'wrong host token must not reattach the attacker');

            // Legitimate host reattach (polling->websocket upgrade path) works.
            const host2 = await connect(port);
            let reattached = true; // no error event is the success signal
            host2.on('invite_join_error', () => { reattached = false; });
            host2.emit('maintain_invite_room', { roomCode: 'DUEL-7777', hostToken: roomInfo.hostToken });
            await new Promise((r) => setTimeout(r, 250));
            assert.equal(reattached, true, 'correct host token must be accepted');

            // Room is still joinable by a real challenger afterwards.
            const challenger = await connect(port);
            const joined = waitFor(challenger, 'match_found');
            const hostSawMatch = waitFor(host2, 'match_found');
            challenger.emit('join_invite_room', { roomCode: 'DUEL-7777', name: 'Challenger' });
            const [cData] = await Promise.all([joined, hostSawMatch]);
            assert.ok(cData.reconnectToken, 'invite path must also issue per-seat reconnect tokens');
            closeAll(host, attacker, host2, challenger);
        });
    });

    test('source contract: per-role timers and token issuance present in server.js', () => {
        assert.match(serverSrc, /disconnectTimers: \{ 1: null, 2: null \}/,
            'disconnect timers must be per-role (shared timer was the Stage-1 bug)');
        assert.match(serverSrc, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/,
            'credentials must be 256-bit unpredictable values');
        assert.match(serverSrc, /reconnect_to_match[\s\S]*tokenMatches/,
            'reconnect must authenticate via token comparison');
    });
});
