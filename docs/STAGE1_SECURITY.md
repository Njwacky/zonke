# STAGE 1 — SECURITY HARDENING REPORT

> Implements doc `zonke improvement` §5 (items 5.1–5.5).
> Branch: `arena/c6d75a8b-zonke` · Follows `docs/STAGE0_BASELINE.md` (R1–R13).
> Owner rule honoured: **no production environment variables, secrets or SQL were changed.**

## What was built (5.1–5.5)

### 5.1 Socket.IO connection & event hardening — `server.js`
| Control | Implementation |
|---|---|
| Origin allowlist | `io.use()` middleware + HTTP CORS share one `originAllowed()` matcher (exact + `*.wildcard` entries). Default list: localhost dev, Capacitor/Ionic schemes, `https://zonke.netlify.app`, `https://zonke-server.onrender.com`, `https://*.e2b.app`. `ALLOWED_ORIGINS` env replaces it (`*` restores old behavior). |
| Connection identity | Handshake `auth: { client: 'zonke-web', v: 1 }`. Default mode: legacy (no-auth) clients still accepted, spoofed `client` values rejected. `REQUIRE_HANDSHAKE=1` rejects missing auth. |
| Payload size | `maxHttpBufferSize: 8192` — oversized frames/POSTs drop the offending socket (or 413 HTTP), server stays up. |
| Per-event rate limits | Per-socket buckets: `find_match` 10/10s, `create_invite_room` 6/10s, `join_invite_room` 15/10s (fits the 1.8 s client watchdog), `maintain_invite_room` 12/10s, `reconnect_to_match` 10/10s, `player_flick` 6/5s, `player_landing` 6/5s, `player_loadout_change` 30/5s. First breach emits `rate_limited` (old clients ignore unknown events); further bursts are silent. |
| Malformed payloads | `isPlainObject` guards on every handler (`find_match`, flick, landing, loadout, invite create/join/maintain, reconnect). Room codes validated against `^[A-Za-z0-9_-]{4,24}$`. |
| Duplicate/replayed actions | `find_match` while already seated in a live room → `matchmaking_error` (no queue corruption). Turn-lock + membership guards (`room.p1/p2 === socket`) on flick/landing/loadout keep Stage 0's anti-cheat. |
| In-match-only actions | flick/landing/loadout require room existence **and** seat occupancy — foreign/ghost sockets cannot act. |

### 5.2 Static file exposure — `server.js`
- Replaced `express.static('.')` with a **default-deny allowlist guard**: `/` (index.html), `style.css`, `game.js`, `sw.js`, `manifest.json`, `icon.svg`, `zonke.html` (+ `/api/*`, `/telemetry` for routes).
- `server.js`, `package.json`, `supabase_setup.sql`, `README.md`, `.git/*`, `docs/*`, `test/*`, `.github/*`, the `zonke improvement` doc, encoded traversals (`..%2f`, `%2e%2e`) and malformed encodings → **404 with a generic body** (no path echo, no stack).
- `dotfiles: 'deny'` remains on the static layer as second defense.

### 5.3 Telemetry (`/api/*`, `/telemetry`)
- **Per-IP rate limits** (swept map, fail-open valve): writes 60/min → 429 `{error:'rate_limited'}`; private reads 30/min; public reads 120/min.
- **Optional keys** (timing-safe compare): `TELEMETRY_WRITE_KEY` gates the three POST endpoints (`x-zonke-telemetry-key` or `Authorization: Bearer`); `TELEMETRY_DASHBOARD_KEY` gates `/telemetry`, `/api/app-detail/`, `/api/events/` (`?key=` works for browsers). **Unset = Phase 1 open behavior** (rate-limited) so no deployment breaks.
- **Strict validation**: event `type` regex-whitelisted (else `INFO`), `severity` enum (else `info`), message ≤200 stripped of markup/control chars, username ≤24, `details` plain-object ≤500 B, heartbeat `status` enum, performance values via `Number.isFinite` (closes the `typeof NaN === 'number'` class of hole), `limit` query clamped 1–100.
- **Safe errors**: JSON body errors → 400 `invalid_json`; >16 KB → 413 `payload_too_large`; unexpected → 500 `internal_error` — never a stack trace.
- CORS is no longer `*`: only allowlisted origins get `Access-Control-Allow-Origin` reflected.
- `trust proxy = 1` so limits see real client IPs behind Render/Netlify.

### 5.4 Reconnect with server-issued credentials
- Every live match (quick-match **and** invite) issues **two 256-bit `base64url` tokens** (`crypto.randomBytes(32)`), one per seat, expiring after `RECONNECT_TOKEN_TTL_MS` (default 15 min), delivered in `match_found.reconnectToken`.
- `reconnect_to_match` now authenticates by **token → seat derivation**; client-supplied `role` is ignored. Missing/forged/expired token → `invite_join_error`; a valid token detaches any zombie socket still holding the seat (anti-takeover).
- **Per-role disconnect timers** (`disconnectTimers = {1,2}`) fix the Stage-1 bug where player A's reconnect cleared the single shared timer and player B's forfeit never fired (regression-tested).
- Grace timer only starts if the departing socket **is** the seat occupant (ghost sockets cannot trigger forfeits); `graceSeconds` in `opponent_network_lag` is computed from `DISCONNECT_GRACE_MS` (default 45 000 ms — unchanged behavior).
- Invite hosts get a `hostToken` in `invite_room_created`; `maintain_invite_room` requires it — knowing a room code alone no longer lets a third socket steal the host seat (5.5).

## Test evidence (§5.5)
- **New `test/security.test.js` — 24 tests**, each spawning a real server on a dedicated port: static matrix (18 blocked + 8 allowed paths), generic-404 body, telemetry validation/keys/rate-limit/malformed-JSON/413/CORS, socket origin (default list incl. `*.e2b.app` wildcard, suffix-spoof rejection, env-replaced list), handshake (both modes), 8 KB payload drop + survival (hard timeout so a regression fails fast), malformed `find_match`, rate-limit event, duplicate in-match rejection, token accept/reject/expiry (both quick-match and invite paths), **per-role timer regression**, room-lifetime token bound, host-token reattach matrix, plus source-contract guards.
- **Offline gameplay functional** (§5.5): all pre-existing suites stay green against the hardened server — `40/40 → 64/64` total (`node --check` ×4, canonical rules 18, entrypoint 7, integration 10, security 24 + guards).
- **Mutation evidence (recheck turn):** reintroducing the original wildcard defect (scheme-prefixed `*.e2b.app` entries never matching) makes exactly 2 security tests fail; restoring the fix returns 64/64.
- Live smoke: `/server.js` `/package.json` traversal → 404; `/` `/game.js` → 200; telemetry 200/201; evil `Origin` gets no CORS header; boot log prints the active security posture.

## Migration plan (no breaking protocol change without one)
1. **Client-first deploy (mandatory):** ship the new `game.js` (handshake auth, `reconnectToken` capture, `invite_room_created`/`hostToken` handling) **before** rolling the new server to any environment. The new server accepts legacy clients in default mode; legacy servers ignore the additive fields. Order: Netlify → Render/self-host.
2. Keys are opt-in per environment (`TELEMETRY_WRITE_KEY`, `TELEMETRY_DASHBOARD_KEY`) — owner sets them when ready; nothing changes while unset.
3. `REQUIRE_HANDSHAKE=1` is a follow-up flip once all clients are confirmed new (Phase 2).
4. Existing socket events and payloads are unchanged in shape; only additive fields (`reconnectToken`, `hostToken`) and new server→client events (`rate_limited`, `matchmaking_error`, `invite_room_created` — all safely ignored by old clients).

## Phase 2 limitations (deliberately out of scope)
- **Legacy `zonke.html` snapshot:** its inline client sends no handshake auth and no `hostToken`. Quick-match, invite create/join and gameplay all still work, but *host resume* (backgrounded tab reconnecting into an invite room) is now rejected without the token — recreate the room instead. The primary client (`game.js`) is updated in this PR and unaffected; this is the documented cost of the client-first migration.
- Telemetry **keys are unset by default** (open writes/reads behind rate limits) — enabling them is an environment change reserved for the owner.
- Reconnect tokens are issued at match start (not on demand) and live in process memory — fine for one node; a multi-node deploy needs shared state.
- Origin allowlist is hostname-based (no TLS client certs/mTLS); HTTP telemetry origin checks are browser-side (CORS) — server-side key auth is the real control there.
- `server.js` is still a single file with in-memory state: crash = all matches lost (Stage 2 territory: persistence/authoritative sim).
- Rate-limit buckets are in-memory per process (reset on restart; not shared across instances).

## Files changed in Stage 1
- `server.js` — hardened (config block, origin/handshake middleware, static allowlist, telemetry hardening, room/token/timer engine, safe error handler).
- `game.js` — handshake auth, reconnect/host token capture + emit, telemetry key header helper (8 surgical edits; engine untouched).
- `test/security.test.js` — **new** (24 tests).
- `test/canonical_rules.test.js` — 2 assertions reworded to test *properties* instead of Stage-0 syntax (optional-chaining form, hardcoded `45000`) that Stage 1 intentionally restructured; defaults still pinned at 45 s.
- `docs/STAGE1_SECURITY.md` — this file; `README.md` — security section.
