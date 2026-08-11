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

- Game: <http://localhost:3000/index.html>
- Live telemetry dashboard: <http://localhost:3000/telemetry>
- API: `/api/heartbeat/`, `/api/events/`, `/api/performance/`, `/api/app-detail/`

Requires **Node.js 18+**. `npm run check` syntax-checks all JS files;
`npm run dev` restarts the server on file changes (`node --watch`).

## 🗂️ Project Structure

| File | Purpose |
|---|---|
| `index.html` | Game UI shell |
| `style.css` | Themes, outfits, 12-row alignment |
| `game.js` | Game engine: physics, audio synth, AI, Socket.io client |
| `server.js` | Express + Socket.io server & telemetry API |
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
