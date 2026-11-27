# STAGE 2 — SERVER-AUTHORITATIVE GAME ENGINE REPORT

> Implements doc `zonke improvement` §6. Builds on Stage 0 (baseline) and
> Stage 1 (security hardening), both already merged to `main`.
> Owner constraint honoured: **flick physics and animations are untouched** —
> the client engine was not rewritten; no gameplay rule changed; no
> production environment variable, secret, or SQL was touched.

## Architecture: rules authority, not physics port

```
 CLIENT (unchanged physics/UX)                 SERVER (official)
 ─────────────────────────────                 ─────────────────────────────
 triggerFlick  ──player_flick──────►  validateFlick (turn, ammo, in-flight)
                                      beginShot → shot_accepted {shotId}
 updatePhysics (rAF, DOM metrics,    opponent_flick {power, wind: SERVER wind}
  bounces, snap heuristics)                 │
 handleLanding (prediction)          validateLanding (shotId, rowIdx, bonus
  ──player_landing{rowId,near}────►          plausibility)  ← rejects duplicates/
                                      resolveLanding: OFFICIAL transition
 applyOfficialState(match_state) ◄──   construction · shoot-first kill · centre
  reconcile rows/ammo/wind/turn           bonus · tinfoil revive · ammo usage ·
                                          wind roll · VICTORY
```

Why not re-simulate physics on the server: the flick simulation is
frame-based (`requestAnimationFrame` delta-time), depends on **live DOM
metrics** (`boardRect`, `targetRowsContainer.offsetTop`), and uses visual
heuristics (bounce counters, soft-apex snap, `Math.random` spin). A port
would diverge from what players see and would require rewriting the client
engine — explicitly forbidden by the owner and by §6 ("preserve the
flick physics and user experience", "do not replace the physics engine
without first creating regression tests"). Instead:

- **Shot parameters are validated** (turn, power clamp, special ammo owned,
  one shot in flight, stale-flight supersede after 15 s).
- **The landing report is validated** against the open pending shot
  (server-issued shot id → duplicate/replay protection), row index range,
  and bonus-claim plausibility (nearest row must be in the centre band).
- **The official transition is computed by the server** with a deterministic
  rules engine (`match_engine.js`) driven entirely by `canonical_rules.js`
  values — construction, elimination, bonus, foil, ammo, wind, victory.
- **Both clients reconcile** to the broadcast `match_state`; prediction
  errors, cheaters and cross-client physics drift are all corrected to the
  official snapshot.

## What each §6 requirement maps to

| §6 requirement | Implementation |
|---|---|
| Server-controlled match state | `room.match` (rows ×2, ammo ×2, wind, turnCount, pending shot, winner) created in `createMatchRoom`; broadcast as `match_state` |
| Server-controlled player turns | existing turn lock (Stage 0/1) now feeds `action_rejected{not_your_turn}`; `room.currentTurn` flipped only by `resolveLanding` |
| Validated shot parameters | `validateFlick` — power clamp, special whitelist, `isPlainObject`; client wind claim **ignored** (server wind relayed) |
| Server-controlled ammunition | ammo validated at flick (`no_ammo`), consumed at landing **exactly per client rules** (normal/bonus/complete consume; dead-row waste preserves sticky; foil revive consumes foil) and reported in `match_state` |
| Soldier construction & elimination | `resolveLanding`: +1 capped at 12; completion kills opponent row only when alive-incomplete (0..11); dead/GOAT rows immutable |
| Server-controlled wind & bonus | wind rolled only by `advanceWind` (every 3rd switch, canonical pool); centre bonus (+1 all alive, super-bonus kill) applied officially; BONUS claims sanity-gated by nearest-row band |
| Official victory calculation | `checkVictory`: first-to-5 → all-resolved tiebreak (higher GOATs, exact tie → landing player), mirrors client order incl. "majority before tiebreak"; client `checkWinCondition` is gated off in online mode; loser's client no longer awards itself a win (bug fixed) |
| Duplicate & replay protection | one pending shot per room; server-issued `shotId` on every flick; landings must reference the open shot (`shot_mismatch`/`no_pending_shot`); stale flights superseded after 15 s |
| Preserve flick physics & animations | **zero changes** to `updatePhysics`, `updateSnapping`, `triggerFlick` trajectory, sounds, or celebrations — only additive emits/handlers around them |

## New wire events (all additive — old clients ignore them)

- `shot_accepted {shotId, wind}` — server → shooter (client stores id for the landing).
- `action_rejected {event, reason}` — `not_your_turn`, `shot_in_flight`,
  `no_ammo`, `game_over`, `invalid_row`, `shot_mismatch`, `no_pending_shot`,
  `implausible_bonus`, `malformed_payload`, `not_shot_owner`.
- `match_state {rows, ammo, wind, turnCount, currentTurn, pendingShot, winner, gameOver}`
  — broadcast to both seats after every accepted landing (and on rejection, to
  resync the shooter); also embedded in `match_found` and
  `match_resumed_from_lag` as `matchState`.
- `opponent_flick` / `sync_landing` keep their old shapes (wind value is now
  server-owned; `shotId`/`events` fields added).

## Test evidence (§6 test matrix)

**New `test/match_authority.test.js` — 26 tests** (18 pure unit + 8 integration
against real spawned servers):

| §6 test item | Coverage |
|---|---|
| Invalid landing reports | out-of-range/typed rowIdx (9, −1, 3.5, `'4'`, null…), implausible BONUS `near`, malformed payloads |
| Impossible shots | flick after game over, second flick in flight, special without ammo, stale-flight supersede |
| Out-of-turn actions | engine + integration (`not_your_turn`, silence on relay) |
| Duplicate actions | double flick, landing with no pending shot, landing by non-owner |
| Replayed actions | stale `shotId` (`shot_mismatch`) — unit + integration |
| Invalid ammunition | `no_ammo` for sticky/foil; official consumption matrix incl. sticky-preserved-on-dead-row |
| Illegal soldier transitions | +1 cap, dead/GOAT immutability, kill only when alive-incomplete, foil revive resets both to 1, bonus parts/kill counts |
| Incorrect victory claims | first-to-5, majority-before-tiebreak, all-resolved higher-count, exact tie → landing player, no victory while unresolved, post-win freeze (no flip/no roll/`game_over`) |

Plus wire-protocol integration: full official state broadcast on both seats,
server-owned wind (roll at switch 3 from the canonical pool), ammo snapshots,
a **full scripted match to an official P1 victory** (bonus rush: 11 bonuses +
5 normals, paced under the Stage 1 rate limit), and reconnect resuming with the
full `matchState`.

**Mutation evidence:** (1) victory majority 5→4 → 3 tests fail; (2) replay
check disabled → 2 fail; (3) `rowIdx` validation disabled → 2 fail; restored
→ byte-identical, 90/90.

**Total suite: 90/90** (`node --check` ×5, canonical 18, entrypoint 7,
integration 10, security 24, authority 26 + guards) · `npm audit` 0 · live
smoke unchanged (static matrix, telemetry, CORS).

Also fixed while integrating: `match_resumed_from_lag` used to call a
**non-existent `updateTurnIndicator()`** (ReferenceError → wind restore was
skipped on resume); the resume path now applies the full official state.

## Migration plan (client-first, no breaking protocol change)

1. **Deploy order:** ship the new `game.js` first (it only *adds* fields —
   `shotId`, `near`, `matchState` handling — and ignores anything old servers
   don't send), then this server. New server + old client: landings without a
   `shotId` are accepted while the pending shot matches (legacy path); old
   clients simply ignore `match_state` and keep their local prediction, which
   the server will correct for every new client in the room.
2. No environment variables, no SQL, no gameplay-rule change: wind pool,
   stage count, majority, bonus radius and tiebreak all come from the same
   canonical values the client already uses.
3. Offline / vs-AI / legacy `zonke.html` paths are untouched (all new logic
   is gated on `isOnlineMode` / room presence).

## Known limitations (honest)

- **Trajectory truth stays client-predicted.** The server validates that a
  landing is *rules-legal* and bound to a real shot, but it does not re-run
  the physics, so a modified client could still claim a landing row it did
  not physically hit (mitigated for BONUS by the nearest-row plausibility
  band; normal rows remain prediction-based). True trajectory verification
  needs a deterministic fixed-timestep simulator + client replay — a future
  stage, explicitly out of scope while preserving the current physics.
- Single-process, in-memory state (same as Stage 1): a server crash ends all
  matches; multi-instance needs shared state (Stage 3/infrastructure notes).
- Career XP/coins are still client-awarded on victory (Stage 4 item); Stage 2
  only makes the *winner determination* official.
- The scripted-match integration test is paced at ~900 ms/iteration to stay
  under the Stage 1 per-socket flick rate limit (6/5 s) — it takes ~15 s.

## Files changed in Stage 2

- `match_engine.js` — **new** pure rules module (driven by `canonical_rules.js`).
- `server.js` — engine wiring: `room.match`, flick/landing validation +
  official resolution, `shot_accepted`/`action_rejected`/`match_state`,
  server-owned wind, `matchState` in `match_found`/resume.
- `game.js` — additive only: `pendingShotId`, `shot_accepted`/
  `action_rejected`/`match_state` handlers, `applyOfficialState` +
  `syncRowsToDom` + `renderWindBadge` helpers, gated online victory, online
  wind/turn now server-driven, landing emit gains `shotId`/`near`, resume
  applies full state (fixes the `updateTurnIndicator` crash).
- `test/match_authority.test.js` — **new** (26 tests).
- `test/canonical_rules.test.js` — rowIdx/wind/authority assertions moved to
  the Stage 2 reality (engine source + new trust-model string).
- `test/server.integration.test.js` — landing test now flicks first (new
  official flow); clamp test asserts server-owned wind.
- `canonical_rules.js` + `docs/CANONICAL_RULES.md` — trust model + server
  enforcement section updated to Stage 2 (values unchanged).
- `package.json` — `check` script covers `match_engine.js`.
- `README.md` — testing section mentions the authority suite.
