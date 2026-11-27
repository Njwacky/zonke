# 🎮 ZONKE — The Kasi Paper Soldier

A 2D tactical paper-flicking duel game. Build your paper soldier row-by-row (12 stages),
complete soldiers to arm them, and eliminate your opponent's squad by landing flicks on
target rows. Play **Pass & Play**, against the **AI bot (Sipho)**, or **online 1v1** via
Socket.io matchmaking or direct invite links.

## ✨ Features

- 🎯 Timing-based flick mechanic with 3 power gears (LOW 🟢 / MID 🔵 / HIGH 🔴)
- 🌬️ Dynamic "Stoep Wind" that drifts the ball mid-flight
- 💣 Special ammo: Sticky & Foil shots, bonus bullseye circle
- 🧑‍🤝‍🧑 Real-time online multiplayer (quick match + invite-room codes/links)
- 🤝 Friends, profile, career stats & ranks (Supabase-backed cloud sync)
- 🤖 Offline AI bot with multiple difficulties
- 🎨 Themes, outfits, 10 PUBG-style guns, sounds & haptics
- 📱 Installable PWA (offline support) + Capacitor native mobile wrapper
- 📡 Built-in telemetry/observability endpoints & live dashboard (`/telemetry`)

## 🚀 Quick Start

```bash
npm install
npm start          # http://localhost:3000
```

- Game: <http://localhost:3000/index.html> ← **canonical entry point**
- Live telemetry dashboard: <http://localhost:3000/telemetry>
- API: `/api/heartbeat/`, `/api/events/`, `/api/performance/`, `/api/app-detail/`

Requires **Node.js 18+**. `npm run dev` restarts the server on file changes
(`node --watch`).

## 🧪 Testing & quality gates (Stage 0 + Stage 1 + Stage 2)

| Command | What it proves |
|---|---|
| `npm run check` | JavaScript **syntax** gate (`node --check`, incl. `match_engine.js`) |
| `npm test` | **Game-rule regression** (engine ↔ `canonical_rules.js`), **entry-point contract**, **multiplayer integration**, **Stage 1 security** tests (static allowlist, telemetry keys/rate limits, socket origin/handshake/payload caps, reconnect tokens), and **Stage 2 server-authority** tests (shot validation, replay/duplicate rejection, official transitions, wind/ammo ownership, official victory) over real spawned servers |
| `npm audit --audit-level=high` | **Dependency security** audit |

All three run automatically on every push/PR via GitHub Actions
(`.github/workflows/ci.yml`). A syntax check is *not* a gameplay test — the
behaviour suite is `npm test`.

**Canonical rules:** [`canonical_rules.js`](canonical_rules.js) +
[`docs/CANONICAL_RULES.md`](docs/CANONICAL_RULES.md) — **9 rows, 12 stages per
soldier, first-to-5 GOATs wins.** Parts of `RULES.md` still describe the older
12-row/first-to-7 design and are superseded by that document.

## 🔐 Security (Stage 1) & configuration

The server is hardened by default — **no environment variables are required**
to keep everything working (see
[`docs/STAGE1_SECURITY.md`](docs/STAGE1_SECURITY.md) for the full threat model,
controls and migration plan):

- **Socket.IO**: origin allowlist, handshake identity (`{client:'zonke-web',v:1}`),
  8 KB payload cap, per-event rate limits, seat-occupancy checks, expiring
  **per-seat reconnect tokens** (no seat takeover; per-role disconnect timers).
- **Static files**: only the game assets are served (`/`, `index.html`,
  `style.css`, `game.js`, `sw.js`, `manifest.json`, `icon.svg`, `zonke.html`).
  Server code, SQL, docs and config return 404.
- **Telemetry**: per-IP rate limits, strict field validation, generic errors.
  Optional shared keys via environment variables (unset = open, rate-limited):

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | built-in list (localhost, Capacitor, Netlify, Render, `*.e2b.app`) | Comma-separated origin allowlist; `*` restores wildcard |
| `REQUIRE_HANDSHAKE` | off | Set to `1` to reject clients without a valid handshake |
| `TELEMETRY_WRITE_KEY` | unset | If set, telemetry POSTs must send it (`x-zonke-telemetry-key` or `Bearer`) |
| `TELEMETRY_DASHBOARD_KEY` | unset | If set, gates `/telemetry`, `/api/app-detail/`, `/api/events/` (`?key=` works in the browser) |
| `RECONNECT_TOKEN_TTL_MS` | `900000` (15 min) | Lifetime of per-seat reconnect credentials |
| `DISCONNECT_GRACE_MS` | `45000` (45 s) | Forfeit window after a disconnect |

**Server authority (Stage 2):** online matches run on a deterministic rules
engine (`match_engine.js`) — the server owns match state, turns, wind, ammo,
soldier transitions and the official victory; the client keeps its flick
physics and animations for prediction and reconciles to `match_state`.
Details, trust model and limitations: [`docs/STAGE2_AUTHORITY.md`](docs/STAGE2_AUTHORITY.md).

**Deploy order matters:** ship the updated `game.js` to Netlify *before*
rolling this server — see the migration plans in `docs/STAGE1_SECURITY.md`
and `docs/STAGE2_AUTHORITY.md`.

## 🗂️ Project Structure

| File | Purpose |
|---|---|
| `index.html` | Game UI shell — **the canonical entry point** (served at `/`, PWA `start_url`, precached by `sw.js`) |
| `zonke.html` | Legacy standalone snapshot (inline CSS/JS) — **preserved but not an entry point** |
| `style.css` | Themes, outfits, 9-row alignment |
| `game.js` | Game engine: physics, audio synth, AI, Socket.io client |
| `server.js` | Express + Socket.io server & telemetry API |
| `canonical_rules.js` | Single source of truth for gameplay rules (see `docs/CANONICAL_RULES.md`) |
| `test/` | Stage 0 test suite (`npm test`) |
| `sw.js` | Service worker (PWA offline cache) |
| `manifest.json` / `icon.svg` | PWA manifest & icon |
| `capacitor.config.json` | Native mobile wrapper config |
| `RULES.md` | Full game rules & design doc |

## ☁️ Deployment

The client picks its Socket.io backend automatically:

1. `window.ZONKE_SERVER_URL` (inline script before `game.js`) — custom deployments
2. `http://localhost:3000` — local development
3. `https://zonke-server.onrender.com` — production default (change to your host)

Set `PORT` env var to change the server port (default `3000`).

## 🛡️ Notes

- All server-bound payloads are sanitized/clamped server-side; turn cheating is rejected
  by the matchmaking engine (server-authoritative turn order).
- Telemetry dashboard HTML-escapes all client-supplied values.

## 🗄️ Supabase tables

The browser talks to Supabase **directly via PostgREST** with the publishable anon key
(`game.js → ZonkeSupabase`). The Node server does **not** need these tables.

| Table | Used for |
|---|---|
| `profiles` | Career profile sync + global leaderboard |
| `friends` | Friends list |
| `zonkedb` | Player registry — one row per unique player (`id`, `created_at`, `player01 = username`). Written automatically on app open / profile save / victory sync. |

Setup SQL for the **`zonkedb`** table (incl. Row Level Security policies) is in
[`supabase_setup.sql`](supabase_setup.sql): Supabase Dashboard → **SQL Editor** →
paste → **Run**. That file creates *only* `zonkedb` — the `profiles` and `friends`
tables are not defined there; verify their schema and RLS policies directly in the
dashboard (scheduled for audit in Stage 4).
