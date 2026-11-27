# 📋 ZONKE — Stage 0 Baseline & Quality Gates Report

**Stage:** 0 — Baseline and quality gates (`zonke improvement` §4)
**Commit under review:** `fe7b760a87100eda71d025c98c494e1b3beae2bb` ("Create zonke improvement")
**Branch:** `arena/c6d75a8b-zonke` (session feature branch — see §8)
**Role framing:** senior/high architect · method: **5 Whys** root-cause analysis
**Status:** ✅ All Stage 0 completion requirements (§4.4) met — see §10

---

## 1. Ten-point Stage 0 briefing (`zonke improvement` §13)

1. **Current repository commit:** `fe7b760a87100eda71d025c98c494e1b3beae2bb`
   (branch `arena/c6d75a8b-zonke`, branched from `main` @ same commit; working tree was clean at start).
2. **Complete feature inventory:** §4 of this report (24 features, all preserved).
3. **Entry-point analysis:** §5 — `index.html` is canonical; `zonke.html` is a preserved legacy snapshot.
4. **Game-rules discrepancies:** §6 — docs claimed 12 rows/first-to-7; engine is **9 rows/first-to-5**; reconciled via `canonical_rules.js` + `docs/CANONICAL_RULES.md`.
5. **Current testing & CI situation:** §7 — *before:* syntax-check only, zero tests, zero CI, 4 dependency CVEs (1 critical). *after:* 39 tests + GitHub Actions on 3 Node versions + 0 CVEs.
6. **Identified risks:** §9 (R1–R13).
7. **Proposed Stage 0 implementation tasks:** §8 (delivered).
8. **Feature branch:** `arena/c6d75a8b-zonke` — the Arena session pins this session to one branch, so the Stage 0 work lands here and opens a PR against `main` from it (no other branch may be created in this session).
9. **Expected/actual files changed:** §8 table.
10. **Tests run:** `npm run check`, `npm test` (39/39), `npm audit --audit-level=high` (0 vulns) — evidence in §7/§10.

---

## 2. The 5 Whys (root-cause analysis)

**Problem statement:** *Zonke cannot be changed safely — there is no baseline: no tests, no CI, and the documentation contradicts the running engine.*

| # | Question | Answer (evidence) |
|---|---|---|
| **Why 1** | Why is there no automated test/CI foundation? | Because the only quality gate ever added was `npm run check` (`node --check` syntax) and **no `.github/` directory existed at all** — nothing ran on push or PR. |
| **Why 2** | Why was syntax checking the only gate? | Because quality has been verified by **opening the browser and playing** — the preview *is* the test suite, so writing tests never became necessary. |
| **Why 3** | Why does manual browser play suffice as "testing"? | Because the game's rules live **inline in one 2,900-line DOM-coupled `game.js`** — there is no importable rules module, so nothing can be tested without a full browser. |
| **Why 4** | Why are the rules buried in DOM code with no single source of truth? | Because features were stacked on feature-by-feature with **no canonical rules artifact** — so docs silently drifted (RULES.md: 12 rows, first-to-7 · engine: 9 rows, first-to-5) and nobody noticed. |
| **Why 5** | Why did the drift go unnoticed? | Because **no automated gate compares engine ↔ docs ↔ configuration** on every change — no CI, no tests, no PR checks. |

**Root cause (architect's conclusion):** the absence of *(a) a single source of truth* for the rules and *(b) an enforced verification harness* at every change. Everything else — doc drift, undetectable regressions, unverifiable security work in Stage 1+ — is a symptom.

**Stage 0 fix (this change):** introduce exactly those two missing pillars:
`canonical_rules.js` (truth) → 39 tests asserting engine/docs/config agree with it (harness) → GitHub Actions CI enforcing the harness on every push/PR (gate). All later stages now stand on verifiable ground.

---

## 3. What was inspected (§4 inventory of files)

| File | Size / shape | Verdict |
|---|---|---|
| `game.js` | 2,906 lines · 62 top-level `function` declarations | Client engine: physics, rules, AI, audio, socket client, Supabase client |
| `server.js` | 648 lines | Express + Socket.IO relay/rooms + telemetry API (in-memory) |
| `index.html` | 563 lines · zero inline `<style>/<script>` | **Canonical entry point** (§5) |
| `zonke.html` | 5,385 lines · inline `<style>` + inline `<script>` + **duplicate** socket.io CDN tags (L2584–2585) | Legacy self-contained snapshot — preserved, not wired to anything |
| `style.css` | Themes/outfits/layout, `.floating-bonus-badge` at `left/top: 50%` | Consistent with 9-row board |
| `RULES.md` | 79 KB Pros&Cons history | Internally conflicted (§2 says 12 rows/first-to-7; "Why #1" and matrix #24 say 9 rows/first-to-5) |
| `README.md` | Quick-start, structure | Had stale "12-row alignment" line (corrected) |
| `supabase_setup.sql` | profiles/friends/zonkedb + RLS | Read-only this stage; **no SQL executed** (§3 production rules) |
| `sw.js` | Cache `zonke-cache-v2` | Precaches `index.html` + assets; never caches `/api/`, `/socket.io/`, `/telemetry` |
| `package.json` / lock | express/socket.io/cors | See §7 security audit |
| `capacitor.config.json` | `webDir: "."` | Native wrapper loads the same web dir → same entry point |
| `manifest.json` | `start_url: "index.html"` | Confirms canonical entry |
| `ignore_me.py` | 2-line tkinter scratch file | Harmless; kept (no removal without owner sign-off) |
| `zonke_github_update.patch` | 25 KB stale patch artifact | Kept; candidate for later removal **with approval** |

---

## 4. Complete feature inventory (§4.1)

Legend — **Tests now:** S = syntax · R = rules-regression · E = entry contract · I = integration · — = not yet covered.

| # | Feature | Where / how it works | Dependencies | Tests now | Known problems | Disposition |
|---|---|---|---|---|---|---|
| 1 | Pass & Play (local, default) | `game.js` turn state machine, `completeTurnSwitch()` | DOM only | R (turn/victory rules) | — | **Preserve** |
| 2 | Sipho AI opponent | `isAiBotMode`, auto-flick after 1.3 s, power `rand(32..96)` | DOM | — | `aiBotDifficulty` declared but **never read** (EASY/HARD inert) | **Preserve**; improve later (behaviour change needs approval) |
| 3 | Online matchmaking | server `find_match` ↔ single global `waitingSocket` → `match_found` roles 1/2 | socket.io | **I** (pairing, clamps, turn-lock) | No queue cancellation; in-memory → single instance only | **Preserve** → Stage 3 |
| 4 | Private invite rooms | `create/join_invite_room`, `DUEL-####`, `?room=` links, host re-attach | socket.io | **I** (lifecycle + not-found error) | TTL/DoS caps present (15 min, 500); identity not cryptographically bound | **Preserve** → Stage 1/3 hardening |
| 5 | Player reconnection | `reconnect_to_match`, 45 s grace, `opponent_network_lag` | socket.io | — (manual) | **Role claimed by client** (security issue 5.4) | **Preserve** → Stage 1 |
| 6 | Flick physics | `updatePhysics()` multi-bounce, apex/snap thresholds, damping 0.82 | DOM/canvas | R (damping, snap constants pinned) | **Client-authoritative** (Stage 2 target) | **Preserve**; regression-pinned before any change |
| 7 | Power gears (LOW/MID/H) | `powerSpeed` + RGB circle `L/M/H` | DOM | — | — | **Preserve** |
| 8 | Dynamic Stoep Wind | `updateWind()` every 3rd turn, pool `[-1.4,-0.7,0,0,+0.7,+1.4]` | DOM | **R** (pool + cadence) | Docs claimed only 3 wind states (§6) | **Preserve** |
| 9 | Center bonus envelope | 30 px circle at exact board center, +1 to all alive, super-bonus kills | DOM | **R** (geometry + effects) | — | **Preserve** |
| 10 | Sticky & Foil ammo | damping 0.12 · revive resets **both** rows to stage 1 | DOM | **R** | — | **Preserve** |
| 11 | Soldier construction | `handleLanding` +1 → stage 12, `STAGES[12]` | DOM | **R** (stage list parity) | — | **Preserve** |
| 12 | Soldier elimination | shoot-first kill → `-1` dead, dead rows wasted | DOM | **R** | — | **Preserve** |
| 13 | Player profiles | `myProfile` localStorage + `ZonkeSupabase.syncProfile` | Supabase PostgREST | — | Client-held state | **Preserve** → Stage 4 |
| 14 | XP & coins | win +150/+50, loss +35/+15 (`handleVictory`) | localStorage | **R** (values) | **Browser awards XP** — must become server-authoritative (Stage 4) | **Preserve** → Stage 4 |
| 15 | Ranks & leaderboard | `getRankInfo()` 7-rank ladder; Supabase `profiles` leaderboard | Supabase | **R** (every threshold) | Leaderboard reads client-written XP | **Preserve** → Stage 4 |
| 16 | Friends | `ZonkeSupabase.addFriend`, win-modal 🤝, local fallback | Supabase `friends` | — | — | **Preserve** → Stage 5 |
| 17 | Themes & outfits | `currentTheme`/`currentOutfit`, 4×4 combos, localStorage | DOM/CSS | **E** (buttons exist in entry) | — | **Preserve** |
| 18 | Weapons & loadouts | 10 guns, `player_loadout_change` → `opponent_loadout_change` | socket.io | I (event sanitised in malformed-payload test) | — | **Preserve** |
| 19 | Audio & haptics | WebAudio synth `playSound`, `triggerHaptic` (Capacitor/web) | AudioContext, Capacitor | — | Lazy-init guards present | **Preserve** |
| 20 | PWA offline | `sw.js` v2 precache + never-cache list; offline modes need no socket | Service worker | **E** (cache contract) | socket.io loaded from CDN (not cached) — offline *online-mode* degrades gracefully (`typeof io` guard) | **Preserve** |
| 21 | Capacitor mobile | `capacitor.config.json` `webDir:"."`, `build:mobile` script | Android/Xcode SDK | — | Native build untested in Stage 0 (no SDK in CI) | **Preserve** → Stage 6 |
| 22 | Telemetry & monitoring | client `ZonkeTelemetry` → `/api/heartbeat|events|performance|app-detail`, `/telemetry` dashboard | Express | **I** (all four surfaces) | **Unauthenticated & unrate-limited** (issue 5.3) | **Preserve** → Stage 1 |
| 23 | Entry structure | `index.html` canonical vs `zonke.html` legacy (§5) | — | **E** (locked by tests) | `zonke.html` drifted (inline snapshot, double CDN include) | **Preserve both**; removal decision deferred to owner |
| 24 | Rules documentation | `RULES.md` history + `canonical_rules.js` + `docs/CANONICAL_RULES.md` | — | **R + E** | RULES.md body still contains legacy 12-row prose (banner supersedes it; full rewrite deferred) | **Improve** (done: canonical source + banner) |

No feature was removed, renamed or disabled in Stage 0.

---

## 5. Entry-point analysis (§4.1 relationship `index.html` ↔ `zonke.html`)

**Verdict: `index.html` is the actual application entry point. `zonke.html` is a legacy standalone snapshot that nothing references.**

| Evidence | `index.html` | `zonke.html` |
|---|---|---|
| Express `GET /` (static index default) | ✅ served | ❌ only by direct URL |
| `manifest.json` `start_url` | ✅ `index.html` | ❌ |
| `sw.js` precache list | ✅ cached | ❌ explicitly absent |
| README quick start | ✅ | ❌ |
| Structure | external `style.css` + `game.js`, **zero inline blocks** (RULES.md clean-separation rule ✅) | inline `<style>` (L15) + inline `<script>` (L2586) engine snapshot, **duplicate** socket.io CDN tags (L2584–2585), no external game.js/style.css |
| Engine constants | via `game.js` (`TOTAL_ROWS=9`) | duplicated inline at L2607 (same values today, but can silently drift) |

**Are both required?** Not for the application to run — `zonke.html` is not loaded by any wiring. It is **kept** because Stage 0 rules forbid removing files without establishing usage, and it may serve as a historical fallback. It is now **locked out of becoming an entry point** by `test/entrypoint.test.js` (manifest/sw must never point at it), so any future decision to delete or re-wire it must be explicit.

---

## 6. Game-rules discrepancies found (§4.2)

| Source | Claim | Engine truth (`game.js`) | Resolution in Stage 0 |
|---|---|---|---|
| `RULES.md` §2 | 12-Row Battlefield, armies of 12 | `TOTAL_ROWS = 9` | Superseded via banner → canonical doc |
| `RULES.md` §2.6 | "First to 7 GOATs wins" | `WIN_MAJORITY = 5` | Superseded via banner → canonical doc |
| `RULES.md` §2.4 | Bonus on "Row 6/Row 7 border" | center = `topOffset + height*0.5` → **Row 5/6 boundary** | Canonical doc §4 |
| `RULES.md` "Why #1" & matrix #24 | 9 rows, first-to-5 | ✅ matches engine | Now the canonical text |
| `README.md` structure | "12-row alignment" | 9 rows | **Corrected** |
| `index.html` rules modal | "armies of 12", "Row 11/Row 12", "all 12 rows" | 9 rows; bottom = Row 8/9 | **Corrected** (text only) |
| `game.js` tour step 3 | "middle line between Row 6 and Row 7" | Row 5/6 | **Corrected** (text only) |
| `game.js` comments L65/L1139/L1789 | `0..11`, "12 target rows", "Row 11 & 12" | `0..8`, 9 rows | **Corrected** (comments only) |
| Wind docs | Calm / −1.4 / +1.4 only | 6-value pool incl. ±0.7 | Canonical doc §6 |
| Everywhere | **12 stages per soldier** | ✅ `STAGES.length === 12` | Kept as-is |

**No gameplay behaviour was changed.** Only documentation/comments/one-time info strings were reconciled with the engine, plus the machine-checked canonical definition. Any *actual* rule change requires owner approval (§3 rules).

---

## 7. Testing & CI situation (§4.3) — before vs after

### Before Stage 0
- `npm run check` = `node --check` on 3 files (syntax only).
- **0** automated tests · **0** CI workflows (`.github/` did not exist).
- `npm audit`: **4 vulnerabilities — 1 critical (proxy-addr), 2 high (engine.io, body-parser), 1 moderate (qs)**.

### After Stage 0
| Gate | Command | Evidence |
|---|---|---|
| Syntax | `npm run check` (now also checks `canonical_rules.js`) | ✅ exit 0 |
| Game-rule regression | `test/canonical_rules.test.js` — **18 tests** asserting engine ↔ canonical parity (rows, stages, kills, bonus geometry, ammo, wind pool, victory, rewards, ranks, server clamps/limits, honest trust-model declaration) | ✅ 18/18 |
| Entry-point contract | `test/entrypoint.test.js` — **7 tests** locking `index.html` as entry (manifest, sw, README, no inline blocks, `zonke.html` preserved-but-not-wired) | ✅ 7/7 |
| Multiplayer integration | `test/server.integration.test.js` — **9 tests** spawning the real `server.js`: boot+static serve, telemetry surfaces, quick-match pairing, payload clamping (power/wind/specialShot), out-of-turn flick **and** landing rejection, turn-flip relay, invite lifecycle, malformed-payload crash safety | ✅ 9/9 |
| Syntax-of-suite | `test/syntax.test.js` — **5 tests** | ✅ 5/5 |
| **Total** | `npm test` (Node's built-in runner, zero new runtime deps) | ✅ **39/39 pass** |
| Dependency security | `npm audit fix` (lockfile-only, within semver ranges) → `npm audit --audit-level=high` | ✅ **0 vulnerabilities** |
| CI | `.github/workflows/ci.yml`: on push to `main` + every PR → `npm ci` → check → test → audit on **Node 18.x / 20.x / 22.x** | ✅ verified running on the Stage 0 PR (see PR for run link) |

A syntax check is explicitly *not* treated as a gameplay test (§4.3) — behaviour now has its own suite.

---

## 8. Stage 0 implementation tasks — delivered

| # | Task | Files |
|---|---|---|
| 1 | Canonical rules source of truth | `canonical_rules.js` (new), `docs/CANONICAL_RULES.md` (new) |
| 2 | Rule-drift regression tests (engine ↔ truth) | `test/canonical_rules.test.js` (new) |
| 3 | Entry-point contract tests | `test/entrypoint.test.js` (new) |
| 4 | Syntax gate incl. new files | `test/syntax.test.js` (new), `package.json` (`check` extended) |
| 5 | Multiplayer integration tests (real server, real sockets) | `test/server.integration.test.js` (new), `package.json` (`test` script), devDep `socket.io-client` |
| 6 | GitHub Actions CI + dependency audit gate | `.github/workflows/ci.yml` (new) |
| 7 | Dependency CVE remediation (lockfile-only) | `package-lock.json` |
| 8 | Documentation reconciliation (no rule changes) | `README.md`, `RULES.md` (supersession banner), `game.js` (3 comments + 1 tour info string), `index.html` (4 info/comment strings) |
| 9 | This baseline report | `docs/STAGE0_BASELINE.md` (new) |

**Not touched (deliberately):** `server.js` runtime logic, physics/snapping logic, `supabase_setup.sql` (no SQL executed), `sw.js`, `capacitor.config.json`, `zonke.html`, any environment/deployment configuration — per production-safety rules (§3).

**Branch:** `arena/c6d75a8b-zonke` → PR against `main`. The Arena session forbids creating/switching branches, so this session branch plays the role of the "dedicated feature branch"; PR will not be merged without explicit owner approval (§2 rules).

---

## 9. Identified risks (§13.6)

| ID | Risk | Severity | Stage that addresses it |
|---|---|---|---|
| R1 | Physics/landings are client-authoritative — a hacked client can report any result | **Critical** (competitive integrity) | Stage 2 server-authoritative engine |
| R2 | Socket.IO `cors.origin: "*"`, no event schemas, no rate limits, no replay protection | High | Stage 1 (5.1) |
| R3 | `express.static('.')` serves the whole repo root (incl. `server.js`, `supabase_setup.sql`, `zonke improvement`, `.patch`) | High | Stage 1 (5.2) |
| R4 | Telemetry endpoints unauthenticated, unrate-limited | Medium | Stage 1 (5.3) |
| R5 | Reconnection role is client-claimed (`reconnect_to_match` trusts `data.role`) | High | Stage 1 (5.4) |
| R6 | Rooms/matchmaking are in-memory — unsafe for >1 instance; no Redis yet | Medium | Stage 3 (document infra first) |
| R7 | XP/coins/rank awarded by the browser | High (economy) | Stage 4 server-side progression |
| R8 | Non-localhost hosts auto-point the client at `https://zonke-server.onrender.com` unless `window.ZONKE_SERVER_URL` is set — custom previews/deploys can silently hit production backend | Medium (ops) | Owner decision + deployment docs (Stage 7) |
| R9 | Supabase publishable key is client-side (by design) — RLS must be verified before scale; service-role key must never ship | High if mishandled | Stage 4 schema/RLS audit |
| R10 | socket.io client loaded from CDN — offline online-mode relies on the `typeof io` guard | Low | Stage 6 PWA pass |
| R11 | `zonke.html` legacy snapshot can drift from the real app (already has double CDN include) | Low | Owner decision: delete or re-wire (blocked by contract test until explicit) |
| R12 | `RULES.md` body still contains legacy 12-row prose (banner supersedes it) | Low (misleading docs) | Full rewrite pending owner approval |
| R13 | Dependency CVEs had accumulated silently (1 critical) — no audit gate existed | High (was) | ✅ **Closed in Stage 0**: 0 vulns + CI audit gate |

---

## 10. Stage 0 completion checklist (`zonke improvement` §4.4)

- [x] **Application starts successfully** — integration suite boots real `server.js` and serves `/` + `/index.html` + telemetry.
- [x] **Existing features inventoried** — §4, 24 features, none removed.
- [x] **Canonical game rules documented** — `canonical_rules.js` + `docs/CANONICAL_RULES.md`, machine-enforced.
- [x] **Entry-point structure understood** — §5, locked by contract tests.
- [x] **Automated tests established** — 39 tests across 4 suites, runnable locally (`npm test`).
- [x] **CI runs successfully** — `.github/workflows/ci.yml` (check + test + audit × Node 18/20/22), verified on the PR.
- [x] **No existing working feature unnecessarily removed** — zero deletions; only docs/comments corrected.
- [x] **Pull request ready for review** — contains this report, test results and known limitations.

## 11. Known limitations of Stage 0 (honest disclosure)

1. **No browser E2E** — physics, rendering, audio, touch and tour flows are not yet automated (would need Playwright; proposed for a Stage 0.5 follow-up with owner's blessing). Rules constants are pinned, not simulated.
2. **Reconnect grace (45 s) and forfeit timing** are covered by code assertions + manual verification only, not a timed integration test.
3. **Sipho AI behaviour** has no unit tests; its `aiBotDifficulty` inertness is documented, not fixed (fixing changes behaviour → needs approval).
4. **RULES.md was not rewritten** — a supersession banner + canonical document were chosen instead (79 KB doc rewrite is a separate, owner-reviewed task).
5. **Capacitor native builds** were not exercised (no Android/Xcode toolchain in CI).
6. **CI verification** happens once the PR is pushed; local runs prove the same commands pass on Node 22 (CI matrix covers 18/20/22).
7. Tests are CommonJS with Node's built-in runner — no bundler/test-framework dependency was introduced (deliberate: minimal-deps policy).

---

*Prepared as Stage 0 of the `zonke improvement` plan. Next: Stage 0 review & approval → only then Stage 1 (security hardening, starting with 5.1 Socket.IO security).*
