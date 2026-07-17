/* ==========================================================================
   ZONKE - THE KASI PAPER SOLDIER
   server.js - Node.js + Socket.io Multiplayer Server & Telemetry/Observability Endpoints
   ========================================================================== */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON payloads for /api/heartbeat, /api/events, /api/performance
app.use(express.static('.')); // Serve static game files (`index.html`, `style.css`, `game.js`) off port 3000

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/* ==========================================================================
   IN-MEMORY TELEMETRY & OBSERVABILITY STORE (`App Dashboard Monitoring`)
   ========================================================================== */
const telemetryStore = {
    appId: "com.zonke.kasiwars",
    appName: "Zonke: The Kasi Paper Soldier",
    status: "online",
    lastHeartbeat: new Date().toISOString(),
    lastHeartbeatTimestamp: Date.now(),
    metrics: {
        appOpens: 1,
        logins: 0,
        failedLogins: 0,
        errors: 0,
        criticalAlerts: 0,
        notifications: 0,
        incidents: 0
    },
    performance: {
        lcp: 580.0, // Largest Contentful Paint (ms)
        inp: 42.0,  // Interaction to Next Paint (ms)
        cls: 0.001, // Cumulative Layout Shift
        averageFps: 60.0
    },
    eventLogs: [
        {
            id: 1,
            type: "APP_OPEN",
            message: "Zonke Multiplayer Server & Telemetry Engine initialized",
            timestamp: Date.now(),
            severity: "info"
        }
    ]
};

let eventLogCounter = 1;

/* ==========================================================================
   EXPRESS TELEMETRY ENDPOINTS (`/api/heartbeat/`, `/api/events/`, `/api/performance/`)
   ========================================================================== */

// 1. POST /api/heartbeat/ (and GET /api/heartbeat/)
app.post('/api/heartbeat/', (req, res) => {
    const { appId, status, device, version } = req.body || {};
    telemetryStore.lastHeartbeat = new Date().toISOString();
    telemetryStore.lastHeartbeatTimestamp = Date.now();
    if (status) telemetryStore.status = status;

    console.log(`[Telemetry Heartbeat] Received from ${appId || 'client'} (${device || 'Web'}) at ${telemetryStore.lastHeartbeat}`);

    return res.status(200).json({
        status: "success",
        appId: telemetryStore.appId,
        serverStatus: "online",
        lastHeartbeat: telemetryStore.lastHeartbeat,
        activeConnections: io.engine.clientsCount
    });
});

app.get('/api/heartbeat/', (req, res) => {
    return res.status(200).json({
        status: telemetryStore.status,
        lastHeartbeat: telemetryStore.lastHeartbeat,
        lastHeartbeatTimestamp: telemetryStore.lastHeartbeatTimestamp,
        activeConnections: io.engine.clientsCount
    });
});

// 2. POST /api/events/ (and GET /api/events/)
app.post('/api/events/', (req, res) => {
    const { type, message, username, severity, details } = req.body || {};
    const eventType = type || "INFO";
    const sev = severity || "info";

    // Increment specific metric counters:
    if (eventType === 'APP_OPEN') telemetryStore.metrics.appOpens++;
    else if (eventType === 'LOGIN_SUCCESS') telemetryStore.metrics.logins++;
    else if (eventType === 'LOGIN_FAILED') telemetryStore.metrics.failedLogins++;
    else if (eventType === 'ERROR') telemetryStore.metrics.errors++;
    else if (eventType === 'CRITICAL_ALERT') telemetryStore.metrics.criticalAlerts++;
    else if (eventType === 'INCIDENT') telemetryStore.metrics.incidents++;
    else if (eventType === 'NOTIFICATION') telemetryStore.metrics.notifications++;

    const newEvent = {
        id: ++eventLogCounter,
        type: eventType,
        message: message || "Event triggered",
        username: username || "Anonymous",
        severity: sev,
        details: details || {},
        timestamp: Date.now(),
        isoTime: new Date().toISOString()
    };

    // Keep latest 100 event logs in memory:
    telemetryStore.eventLogs.unshift(newEvent);
    if (telemetryStore.eventLogs.length > 100) {
        telemetryStore.eventLogs.pop();
    }

    console.log(`[Telemetry Event: ${sev.toUpperCase()}] [${eventType}] ${newEvent.message} (${newEvent.username})`);

    return res.status(201).json({
        status: "success",
        eventId: newEvent.id,
        metricsSnapshot: telemetryStore.metrics
    });
});

app.get('/api/events/', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    return res.status(200).json({
        totalEventsLogged: eventLogCounter,
        metrics: telemetryStore.metrics,
        events: telemetryStore.eventLogs.slice(0, limit)
    });
});

// 3. POST /api/performance/ (and GET /api/performance/)
app.post('/api/performance/', (req, res) => {
    const { lcp, inp, cls, fps } = req.body || {};

    if (typeof lcp === 'number') telemetryStore.performance.lcp = Number(lcp.toFixed(2));
    if (typeof inp === 'number') telemetryStore.performance.inp = Number(inp.toFixed(2));
    if (typeof cls === 'number') telemetryStore.performance.cls = Number(cls.toFixed(4));
    if (typeof fps === 'number') telemetryStore.performance.averageFps = Number(fps.toFixed(1));

    console.log(`[Telemetry Performance] LCP=${telemetryStore.performance.lcp}ms | INP=${telemetryStore.performance.inp}ms | CLS=${telemetryStore.performance.cls} | FPS=${telemetryStore.performance.averageFps}`);

    return res.status(200).json({
        status: "success",
        performance: telemetryStore.performance
    });
});

app.get('/api/performance/', (req, res) => {
    return res.status(200).json({
        status: "success",
        performance: telemetryStore.performance
    });
});

// 4. GET /api/app-detail/ (Complete JSON summary for external monitoring dashboard)
app.get('/api/app-detail/', (req, res) => {
    return res.status(200).json({
        appId: telemetryStore.appId,
        appName: telemetryStore.appName,
        status: telemetryStore.status,
        lastHeartbeat: telemetryStore.lastHeartbeat,
        lastHeartbeatTimestamp: telemetryStore.lastHeartbeatTimestamp,
        activeSocketConnections: io.engine.clientsCount,
        metrics: telemetryStore.metrics,
        performance: telemetryStore.performance,
        recentEvents: telemetryStore.eventLogs.slice(0, 20)
    });
});

// 5. GET /telemetry (Built-in live web dashboard right in your browser!)
app.get('/telemetry', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Zonke Telemetry & Observability Dashboard</title>
            <style>
                body { font-family: 'Courier New', monospace; background: #1a1a1a; color: #00e5ff; padding: 24px; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 20px 0; }
                .card { background: #262b3d; border: 2px solid #00e5ff; border-radius: 12px; padding: 16px; text-align: center; }
                .num { font-size: 32px; font-weight: 900; color: #ffd700; margin: 8px 0; }
                .lbl { font-size: 12px; color: #fff; text-transform: uppercase; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #262b3d; }
                th, td { border: 1px solid #00e5ff; padding: 10px; text-align: left; font-size: 13px; }
                th { background: #00e5ff; color: #1a1a1a; }
                .sev-critical { color: #ff007f; font-weight: bold; }
                .sev-warning { color: #f39c12; }
                .sev-info { color: #2ecc71; }
            </style>
        </head>
        <body>
            <h1>📡 ZONKE TELEMETRY & OBSERVABILITY DASHBOARD</h1>
            <p>App ID: <strong>${telemetryStore.appId}</strong> | Status: <span style="color:#2ecc71;">● ONLINE</span> | Active Socket.io Clients: <strong>${io.engine.clientsCount}</strong></p>
            <p>Last Heartbeat: <strong>${telemetryStore.lastHeartbeat}</strong></p>

            <div class="grid">
                <div class="card"><div class="lbl">App Opens</div><div class="num">${telemetryStore.metrics.appOpens}</div></div>
                <div class="card"><div class="lbl">Logins</div><div class="num">${telemetryStore.metrics.logins}</div></div>
                <div class="card"><div class="lbl">Failed Logins</div><div class="num">${telemetryStore.metrics.failedLogins}</div></div>
                <div class="card"><div class="lbl">Errors & Incidents</div><div class="num">${telemetryStore.metrics.errors + telemetryStore.metrics.incidents}</div></div>
                <div class="card"><div class="lbl">Critical Alerts</div><div class="num">${telemetryStore.metrics.criticalAlerts}</div></div>
                <div class="card"><div class="lbl">LCP (Web Vitals)</div><div class="num">${telemetryStore.performance.lcp} ms</div></div>
                <div class="card"><div class="lbl">INP (Latency)</div><div class="num">${telemetryStore.performance.inp} ms</div></div>
                <div class="card"><div class="lbl">CLS (Shift)</div><div class="num">${telemetryStore.performance.cls}</div></div>
            </div>

            <h2>📝 RECENT EVENT LOGS</h2>
            <table>
                <tr><th>ID</th><th>Type</th><th>Severity</th><th>Username</th><th>Message</th><th>Timestamp</th></tr>
                ${telemetryStore.eventLogs.slice(0, 15).map(e => `
                    <tr>
                        <td>#${e.id}</td>
                        <td><strong>${e.type}</strong></td>
                        <td class="sev-${e.severity}">${e.severity.toUpperCase()}</td>
                        <td>${e.username}</td>
                        <td>${e.message}</td>
                        <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
                    </tr>
                `).join('')}
            </table>
        </body>
        </html>
    `);
});

/* ==========================================================================
   SOCKET.IO REAL-TIME ROOMS & MATCHMAKING ENGINE
   ========================================================================== */
const rooms = {};
const inviteRooms = {};
let waitingSocket = null;
let roomCounter = 1000;

// Strict Sanitization & Anti-Cheat Validation Helpers
function sanitizeString(str, maxLen = 16) {
    if (!str || typeof str !== 'string') return 'Player';
    return str.replace(/<[^>]*>?/gm, '').replace(/[^\w\s\-_.:]/g, '').trim().slice(0, maxLen) || 'Player';
}

function clampNumber(num, min, max, defaultVal) {
    const n = Number(num);
    if (isNaN(n)) return defaultVal;
    return Math.max(min, Math.min(max, n));
}

// 15-Minute TTL auto-cleanup loop for expired invite rooms (`Prevent DOS memory exhaustion`):
setInterval(() => {
    const now = Date.now();
    for (const code in inviteRooms) {
        if (now - (inviteRooms[code].createdAt || 0) > 15 * 60 * 1000) {
            console.log(`[Room TTL Cleanup] Deleting expired invite room: ${code}`);
            delete inviteRooms[code];
        }
    }
}, 60000);

io.on('connection', (socket) => {
    console.log(`[Socket.io] Player connected: ${socket.id}`);

    // Log connection as an APP_OPEN / Connection telemetry event:
    telemetryStore.metrics.appOpens++;
    telemetryStore.lastHeartbeat = new Date().toISOString();
    telemetryStore.lastHeartbeatTimestamp = Date.now();

    socket.on('find_match', (data) => {
        const profile = {
            username: sanitizeString(data?.name || `Warrior-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data?.avatar || "🧢", 4),
            rank: sanitizeString(data?.rank || "Street Novice", 24),
            outfit: sanitizeString(data?.outfit || "outfit-soldier", 24),
            gun: sanitizeString(data?.gun || "akm", 16),
            wins: clampNumber(data?.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;

        if (waitingSocket && waitingSocket.id !== socket.id) {
            const roomId = `Zonke-Room-${++roomCounter}`;
            const p1Prof = waitingSocket.playerProfile;
            const p2Prof = socket.playerProfile;

            rooms[roomId] = {
                id: roomId,
                p1: waitingSocket,
                p2: socket,
                p1Profile: p1Prof,
                p2Profile: p2Prof,
                currentTurn: 1,
                wind: 0.0
            };

            waitingSocket.join(roomId);
            socket.join(roomId);

            waitingSocket.roomId = roomId;
            socket.roomId = roomId;
            waitingSocket.playerRole = 1;
            socket.playerRole = 2;

            console.log(`[Matchmaking] Room ${roomId} created: ${p1Prof.username} (P1) vs ${p2Prof.username} (P2)`);

            // Log event:
            telemetryStore.metrics.logins++;
            telemetryStore.eventLogs.unshift({
                id: ++eventLogCounter,
                type: "LOGIN_SUCCESS",
                message: `Online 1v1 match started: ${p1Prof.username} vs ${p2Prof.username} inside Room ${roomId}`,
                username: p1Prof.username,
                severity: "info",
                timestamp: Date.now()
            });

            waitingSocket.emit('match_found', {
                roomId: roomId,
                role: 1,
                myProfile: p1Prof,
                opponentProfile: p2Prof,
                wind: 0.0
            });

            socket.emit('match_found', {
                roomId: roomId,
                role: 2,
                myProfile: p2Prof,
                opponentProfile: p1Prof,
                wind: 0.0
            });

            waitingSocket = null;
        } else {
            waitingSocket = socket;
            socket.emit('waiting_for_opponent', {
                message: `Searching for an online challenger across the world...`,
                myProfile: profile
            });
            console.log(`[Matchmaking] ${profile.username} (${socket.id}) queued for match...`);
        }
    });

    socket.on('player_flick', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // Turn Anti-Cheat check: Verify it is genuinely this player's turn (`room.currentTurn === socket.playerRole`)
        if (room.currentTurn !== socket.playerRole) {
            console.warn(`[Anti-Cheat Violation] Player ${socket.playerRole} inside ${roomId} attempted to flick during Player ${room.currentTurn}'s turn! Rejected.`);
            return;
        }

        const cleanPower = clampNumber(data?.power, 0, 100, 50);
        const cleanWind = clampNumber(data?.wind, -2.0, 2.0, 0.0);
        const cleanShot = (data?.specialShot === 'STICKY' || data?.specialShot === 'FOIL') ? data.specialShot : 'NORMAL';

        socket.to(roomId).emit('opponent_flick', {
            power: cleanPower,
            wind: cleanWind,
            specialShot: cleanShot,
            playerRole: socket.playerRole
        });
    });


    // Live Online Loadout Synchronization (`sync Character Outfit & Weapon during live duel!`)
    socket.on('player_loadout_change', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        socket.to(roomId).emit('opponent_loadout_change', {
            outfit: sanitizeString(data?.outfit || 'outfit-soldier', 24),
            gun: sanitizeString(data?.gun || 'akm', 16),
            playerRole: socket.playerRole
        });
    });

    socket.on('player_landing', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // Turn Anti-Cheat check: Verify only active turn player reports landing!
        if (room.currentTurn !== socket.playerRole) {
            console.warn(`[Anti-Cheat Violation] Player ${socket.playerRole} reported landing out of turn! Rejected.`);
            return;
        }

        let cleanRowIdx = data?.rowIdx;
        if (cleanRowIdx !== 'BONUS') {
            cleanRowIdx = clampNumber(cleanRowIdx, 0, 8, 0);
        }
        const cleanWind = clampNumber(data?.newWind, -2.0, 2.0, room.wind || 0.0);
        room.wind = cleanWind;
        room.currentTurn = room.currentTurn === 1 ? 2 : 1;

        socket.to(roomId).emit('sync_landing', {
            rowIdx: cleanRowIdx,
            playerRole: socket.playerRole,
            nextTurn: room.currentTurn,
            newWind: cleanWind
        });
    });


    // Create Direct Invite Room (`generate room link/code to play directly with friend far away`)
    socket.on('create_invite_room', (data) => {
        // DOS Protection: Enforce max 500 active invite rooms server-wide
        if (Object.keys(inviteRooms).length >= 500) {
            socket.emit('invite_join_error', { message: "Server invite limit reached. Please try quick match!" });
            return;
        }
        if (socket.roomId && inviteRooms[socket.roomId]) {
            delete inviteRooms[socket.roomId];
        }

        const profile = {
            username: sanitizeString(data?.name || `Host-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data?.avatar || "🧢", 4),
            rank: sanitizeString(data?.rank || "Street Boss", 24),
            outfit: sanitizeString(data?.outfit || "outfit-soldier", 24),
            gun: sanitizeString(data?.gun || "akm", 16),
            wins: clampNumber(data?.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;
        const customCode = sanitizeString(data?.roomCode || `DUEL-${Math.floor(1000 + Math.random() * 9000)}`, 20);

        inviteRooms[customCode] = {
            id: customCode,
            host: socket,
            hostProfile: profile,
            createdAt: Date.now()
        };
        socket.join(customCode);
        socket.roomId = customCode;
        socket.playerRole = 1;

        console.log(`[Invite Room] Created room ${customCode} by ${profile.username}`);
        socket.emit('invite_room_created', { roomCode: customCode, hostProfile: profile });
    });

    // Join Direct Invite Room via Link/Code
    socket.on('join_invite_room', (data) => {
        const roomCode = data && (data.roomCode || data.roomId);
        if (!roomCode || !inviteRooms[roomCode]) {
            socket.emit('invite_join_error', { message: `Room ${roomCode || ''} not found or match already started!` });
            return;
        }
        const invRoom = inviteRooms[roomCode];
        const hostSocket = invRoom.host;
        const p1Prof = invRoom.hostProfile;

        const profile = {
            username: sanitizeString(data?.name || `Challenger-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data?.avatar || "👨‍🚀", 4),
            rank: sanitizeString(data?.rank || "Tactical Striker", 24),
            outfit: sanitizeString(data?.outfit || "outfit-pilot", 24),
            gun: sanitizeString(data?.gun || "m416", 16),
            wins: clampNumber(data?.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;

        rooms[roomCode] = {
            id: roomCode,
            p1: hostSocket,
            p2: socket,
            p1Profile: p1Prof,
            p2Profile: profile,
            currentTurn: 1,
            wind: 0.0
        };
        delete inviteRooms[roomCode];

        socket.join(roomCode);
        socket.roomId = roomCode;
        socket.playerRole = 2;

        console.log(`[Invite Room] Match started inside ${roomCode}: ${p1Prof.username} vs ${profile.username}`);

        hostSocket.emit('match_found', {
            roomId: roomCode,
            role: 1,
            myProfile: p1Prof,
            opponentProfile: profile,
            wind: 0.0
        });

        socket.emit('match_found', {
            roomId: roomCode,
            role: 2,
            myProfile: profile,
            opponentProfile: p1Prof,
            wind: 0.0
        });
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.io] Player disconnected: ${socket.id}`);
        if (socket.roomId && inviteRooms[socket.roomId] && inviteRooms[socket.roomId].host.id === socket.id) {
            console.log(`[Invite Room] Host disconnected, closing invite ${socket.roomId}`);
            delete inviteRooms[socket.roomId];
        }
        if (waitingSocket && waitingSocket.id === socket.id) {
            waitingSocket = null;
        }
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            socket.to(roomId).emit('opponent_disconnected', {
                message: `Opponent lost connection or left the duel! You win by forfeit! 🏆`
            });
            delete rooms[roomId];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🎮 =====================================================================`);
    console.log(`🚀 ZONKE MULTIPLAYER & TELEMETRY SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📡 Telemetry Endpoints Active:`);
    console.log(`   - POST/GET /api/heartbeat/   (App status & heartbeat)`);
    console.log(`   - POST/GET /api/events/      (Logins, errors, critical alerts, logs)`);
    console.log(`   - POST/GET /api/performance/ (LCP, INP, CLS, FPS metrics)`);
    console.log(`   - GET /api/app-detail/       (JSON overview for monitoring dashboard)`);
    console.log(`   - GET /telemetry             (Live web telemetry dashboard)`);
    console.log(`=====================================================================\n`);
});