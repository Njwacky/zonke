# 🏆 ZONKE — Canonical Game Rules (Stage 0)

**This document is the human-readable authority for Zonke's gameplay rules.**
Its machine-readable twin is [`canonical_rules.js`](../canonical_rules.js) — the two
must always agree, and `test/canonical_rules.test.js` fails CI if the engine
(`game.js`), the server (`server.js`), or these files drift apart.

> **Supersedes legacy text:** parts of [`RULES.md`](../RULES.md) (Section 2's
> "12-Row Battlefield", "First to 7 GOATs") and older README lines describe a
> previous 12-row design. The **implemented, playable** rules are the ones
> below. Gameplay changes require explicit owner approval — Stage 0 only
> *documents* what the engine already does.

Verified against `game.js` and `server.js` at commit `fe7b760`.

---

## 1. Battlefield

| Rule | Value | Engine evidence |
|---|---|---|
| Rows per side | **9** (`TOTAL_ROWS = 9`) | `game.js` `const TOTAL_ROWS = 9` |
| Row indices | `0..8` in code, **Row 1..Row 9** in UI | `buildBoardRows()` loops `r < TOTAL_ROWS` |
| Stages per soldier | **12** (Head → Neck → Torso → Arms → Lower body → Legs → Gun → 5× Bullet) | `STAGES` array (12 entries) |
| Row state values | `-1` dead · `0` untouched · `1..11` in progress · `12` complete (GOAT) | `player1Rows` / `player2Rows` |

## 2. Turn structure

1. Players alternate turns (Player 1 flicks first).
2. On each turn the player launches the paper ball from the launch pad with a
   timed power value (LOW / MID / HIGH gear) and may pre-arm one special shot.
3. The ball settles (multi-bounce physics, damping `0.82`) onto a target row,
   the center bonus circle, or wastes the turn.
4. The turn then passes; **every 3rd turn switch re-rolls the wind**.

## 3. Construction & elimination ("Shoot First or Die")

- Landing on your row `i` adds **+1 stage** to that soldier (max 12).
- Reaching **stage 12** completes the soldier (**GOAT 🐐**) and it **fires
  first**: the opponent's soldier on the same row is immediately **eliminated
  (`-1`)** — but only if that opponent row is alive and not yet complete.
- A dead row (`-1`) can never be built on again; landing on it wastes the turn
  (the one exception is the Tinfoil revive, §5).

## 4. Center bonus (`--⭕-- +1`)

- A circle at the **exact geometric center** of the 9-row board
  (`boardWidth × 0.50`, `topOffset + targetHeight × 0.50`) — i.e. on the
  boundary between **Row 5 and Row 6**.
- Awarded **only** when the settling ball's center is within **30 px** of that
  point (`distToBonus <= 30.0`). Anything else on Row 5 is a normal Row 5 hit.
- Effect: **+1 stage to every alive incomplete soldier** of the landing player.
  Any soldier that reaches 12 from the bonus fires and kills the opponent's
  matching row(s) too ("SUPER BONUS").

## 5. Special ammo (1 each per player, per match)

| Ammo | Effect |
|---|---|
| 🍬 **Chappies Sticky** | Wall damping drops `0.82 → 0.12` (near-zero bounce) — snaps on contact. Consumed on use. |
| 🪙 **Tinfoil Revive** | Used on **your own dead row**: **both** players on that row reset to **stage 1** (fresh race). Consumed on use. |

## 6. Dynamic Stoep Wind

- Re-rolled **every 3rd turn** from the weighted pool
  `[-1.4, -0.7, 0.0, 0.0, +0.7, +1.4]` (calm is twice as likely).
- During flight the wind applies lateral drift; the `🌬️ WIND` badge shows the
  current value/direction before you flick.
- Launch side (`🏀 SWAP ⇄`) is **manual** — the player chooses left/right.

## 7. Victory conditions

1. **Primary:** first player to **5 completed (GOAT) soldiers** wins
   (`WIN_MAJORITY = 5`, i.e. a 5-of-9 majority).
2. **Fallback** (every row on both sides resolved as completed or dead): the
   higher goat count wins; on an exact full-board tie the win is awarded to the
   player whose turn it is (as implemented in `checkWinCondition()`).

## 8. Career rewards & ranks (current client-side behaviour)

| Result | XP | Coins |
|---|---|---|
| Win | +150 | +50 |
| Loss | +35 | +15 |

Rank ladder (`getRankInfo(xp)`):

| XP | Rank |
|---|---|
| 7500+ | 👑 ARENA GOAT LEGEND |
| 4000+ | 💎 Tactical Master |
| 2200+ | 🥇 Street Boss |
| 1200+ | Arena Commander |
| 600+ | Tactical Striker |
| 250+ | Arena Hustler |
| 0+ | Street Novice |

> ⚠️ **Stage 0 honesty note:** XP/coins/ranks are currently awarded and stored
> **in the browser** (synced to Supabase by the client). Per the improvement
> plan this becomes server-authoritative in **Stage 4** — never trust the
> client for competitive progression.

## 9. Multiplayer server enforcement (as implemented today)

| Control | Value |
|---|---|
| Turn lock | Events from the player whose turn it is NOT are dropped (`room.currentTurn !== socket.playerRole`) |
| Payload clamps | `power 0..100`, strings sanitised/truncated; `rowIdx` must be an integer `0..8` or `'BONUS'` (Stage 2: out-of-range reports are **rejected**, not clamped) |
| Server-owned state (Stage 2) | Wind rolls from `wind.pool` every `wind.everyNTurns` switches on the server (client wind claims ignored); every flick gets a shot id and landings must reference the open pending shot (replay protection); `match_engine.js` applies construction/elimination/bonus/foil/victory officially and broadcasts `match_state` |
| Disconnect grace | 45 s before forfeit |
| Invite room TTL | 15 min sweep; 500-room cap; 5-min host survival grace |
| Trust model | **Client-predicted physics**; server relays + validates turn order and payload shape. A server-authoritative shot-resolution engine is **Stage 2** of the improvement plan. |

## 10. Game modes

| Mode | Implementation |
|---|---|
| Pass & Play (local, default) | Pure `game.js` — no server needed |
| Sipho AI bot | `isAiBotMode`, random power `32..97` per shot |
| Online quick match | `find_match` → `match_found` (server pairs two queue members) |
| Private invite rooms | `create_invite_room` / `join_invite_room` (`DUEL-####` codes + `?room=` links) |
| Reconnection | `reconnect_to_match` within the 45 s grace window |

---

*Stage 0 · part of the baseline defined in [`docs/STAGE0_BASELINE.md`](STAGE0_BASELINE.md).*
