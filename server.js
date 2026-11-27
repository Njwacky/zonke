/* ==========================================================================
   ZONKE - THE KASI PAPER SOLDIER
   server.js - Node.js + Socket.io Multiplayer Server & Telemetry/Observability Endpoints
   ==========================================================================
   Stage 1 (Security hardening) — see docs/STAGE1_SECURITY.md:
     5.1 Socket.IO : origin allowlist, handshake identity, per-event payload
                     validation, 8KB payload cap, per-event rate limits,
                     duplicate/replay guards, in-match membership checks
     5.2 Static    : explicit public-asset allowlist (no more express.static('.'))
     5.3 Telemetry : per-IP rate limits, strict field validation, optional
                     write/dashboard keys, safe generic error responses
     5.4 Reconnect : server-issued per-seat reconnect tokens (crypto random,
                     expiring, match-bound), per-role disconnect timers
   ========================================================================== */

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');

/* ==========================================================================
   SECURITY CONFIGURATION (env-overridable; defaults preserve existing
   deployments — no production environment variables are changed by Stage 1)
   ========================================================================== */

const DEFAULT_ORIGINS = [
    // Local development
    'http://localhost:3000', 'http://localhost',
    'http://127.0.0.1:3000', 'http://127.0.0.1',
    'https://localhost', 'https://127.0.0.1',
    // Capacitor native wrapper (Android WebView / iOS WKWebView)
    'capacitor://localhost', 'ionic://localhost',
    // Known deployment origins
    'https://zonke.netlify.app',          // production PWA frontend (Netlify)
    'https://zonke-server.onrender.com',  // self-hosted frontend (same server)
    'https://*.e2b.app'                   // Arena sandbox previews
];

function parseOriginList(raw) {
    if (!raw || !raw.trim()) return { allowAll: false, entries: DEFAULT_ORIGINS.slice() };
    if (raw.trim() === '*') return { allowAll: true, entries: [] };
    return { allowAll: false, entries: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

const ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS);

// Compile each entry once at startup:
//   - entries containing '*' become anchored regexes, so BOTH bare wildcards
//     ('*.example.com') and scheme-prefixed wildcards ('https://*.e2b.app')
//     work (the old startsWith('*.') check silently never matched the latter);
//   - entries with a scheme must match the full origin (scheme-sensitive);
//   - scheme-less entries ('localhost:3000') match the scheme-less origin.
const ORIGIN_MATCHERS = ORIGINS.entries.map((entry) => {
    if (entry.includes('*')) {
        const m = entry.match(/^([a-z][a-z0-9+.-]*:\/\/)?(.*)$/i);
        const scheme = (m[1] || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const host = m[2].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
        // Optional explicit port: browsers omit default ports, but a preview on
        // :8443 must still match a wildcard host entry.
        const re = new RegExp('^' + scheme + host + '(:[0-9]+)?$');
        return (origin) => re.test(origin);
    }
    if (entry.includes('://')) return (origin) => origin === entry;
    return (origin) => origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') === entry;
});

function originAllowed(origin) {
    if (ORIGINS.allowAll) return true;
    if (!origin || typeof origin !== 'string') return true; // non-browser clients (tests, curl, native)
    return ORIGIN_MATCHERS.some((match) => match(origin));
}

function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const ENV = {
    requireHandshake: process.env.REQUIRE_HANDSHAKE === '1',
    telemetryWriteKey: process.env.TELEMETRY_WRITE_KEY || '',
    telemetryDashboardKey: process.env.TELEMETRY_DASHBOARD_KEY || '',
    reconnectTokenTtlMs: intEnv('RECONNECT_TOKEN_TTL_MS', 15 * 60 * 1000),
    disconnectGraceMs: intEnv('DISCONNECT_GRACE_MS', 45 * 1000),
    maxHttpBufferSize: 8 * 1024 // Socket.IO payload cap (profiles/telemetry are < 1KB)
};

const app = express();
app.set('trust proxy', 1); // single trusted proxy hop (Render/Netlify style) so per-IP limits see real clients

// CORS: explicit origin allowlist for HTTP (telemetry) — no more wildcard.
app.use(cors({
    origin: (origin, cb) => cb(null, originAllowed(origin) ? (origin || '*') : false),
    methods: ['GET', 'POST'],
    maxAge: 600
}));

// Lightweight security headers on every response (no external deps needed):
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Parse JSON payloads for /api/heartbeat, /api/events, /api/performance.
// 16kb cap blocks oversized-body DoS attempts while leaving plenty of room for telemetry.
app.use(express.json({ limit: '16kb' }));

/* ==========================================================================
   5.2 STATIC FILE SECURITY — explicit public-asset allowlist
   The whole project directory is NO LONGER served. Only the files the game
   actually needs in a browser are reachable; server code, SQL, docs, tests,
   config, patches and dotfiles are invisible to the public.
   ========================================================================== */
const PUBLIC_ASSETS = new Set([
    '/', '/index.html', '/style.css', '/game.js', '/sw.js',
    '/manifest.json', '/icon.svg', '/zonke.html' // zonke.html: preserved legacy snapshot (Stage 0 decision)
]);

function isPublicPath(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return true; // routes handle the rest
    let p;
    try { p = decodeURIComponent(req.path); } catch { return false; } // malformed encoding
    p = path.posix.normalize(p);
    if (p.includes('..')) return false;
    if (PUBLIC_ASSETS.has(p)) return true;
    if (p === '/api/' || p.startsWith('/api/')) return true; // telemetry API routes
    if (p === '/telemetry') return true;                     // ops dashboard route
    return false;
}

app.use((req, res, next) => {
    if (isPublicPath(req)) return next();
    console.warn(`[Static Guard] Blocked non-public path: ${req.method} ${req.path}`);
    return res.status(404).type('text').send('Not Found');
});

app.use(express.static('.', { index: 'index.html', dotfiles: 'deny' })); // only reachable for allowlisted paths above

// HTML-escape helper: telemetry values (username, message, type...) come from untrusted
// client POST bodies, so escape them before rendering into the /telemetry dashboard.
function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: ENV.maxHttpBufferSize, // 5.1: payload size restriction
    cors: {
        origin: (origin, cb) => cb(null, originAllowed(origin) ? (origin || '*') : false),
        methods: ['GET', 'POST']
    }
});

/* ==========================================================================
   5.1 CONNECTION IDENTITY — origin allowlist + handshake validation
   Runs for BOTH transports (websocket + polling). Migration plan: new clients
   send { client: 'zonke-web', v: 1 }; legacy clients (no auth) are accepted
   while REQUIRE_HANDSHAKE is unset, and rejected once it is set to '1'.
   ========================================================================== */
io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (!originAllowed(origin)) {
        console.warn(`[Security] Rejected connection from disallowed origin: ${origin || '(none)'}`);
        return next(new Error('origin_not_allowed'));
    }
    const auth = socket.handshake.auth;
    const authIsObject = auth !== null && typeof auth === 'object' && !Array.isArray(auth);
    if (ENV.requireHandshake) {
        if (!authIsObject || auth.client !== 'zonke-web' || auth.v !== 1) {
            console.warn(`[Security] Rejected connection without valid handshake from ${socket.id}`);
            return next(new Error('handshake_required'));
        }
    } else if (authIsObject && auth.client !== undefined && auth.client !== 'zonke-web') {
        console.warn(`[Security] Rejected connection with invalid handshake identity from ${socket.id}`);
        return next(new Error('invalid_handshake'));
    }
    socket.data.legacyClient = !authIsObject || auth.client === undefined;
    socket.data.clientVersion = authIsObject && typeof auth.v === 'number' ? auth.v : null;
    return next();
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
   5.3 TELEMETRY HARDENING — shared validation / auth / rate-limit helpers
   ========================================================================== */

// Plain-object guard (rejects arrays, null, primitives — "reject malformed requests").
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Free-text log field: strip tags/control chars, cap length (safe error + storage hygiene).
function sanitizeLogString(value, maxLen, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return value
        .replace(/<[^>]*>?/gm, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, maxLen) || fallback;
}

// Per-IP HTTP rate limiting (telemetry). Bounded map + periodic sweep so the
// limiter itself can never become a memory vector.
const httpLimits = new Map();
function httpRateLimit(req, res, bucket, max, windowMs) {
    const ip = req.ip || 'unknown';
    const key = `${bucket}@${ip}`;
    const now = Date.now();
    let b = httpLimits.get(key);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        httpLimits.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
        res.status(429).json({ error: 'rate_limited' });
        return false;
    }
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of httpLimits) if (now >= v.resetAt) httpLimits.delete(k);
    if (httpLimits.size > 5000) httpLimits.clear(); // fail-open safety valve
}, 60000);

// Optional shared-key auth (timing-safe). Unset key = open (Phase 1 default:
// existing deployments keep working; owner enables keys via env without code
// change — see docs/STAGE1_SECURITY.md migration notes).
function keyMatches(provided, expected) {
    if (!expected) return true;
    if (typeof provided !== 'string' || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
function readProvidedKey(req) {
    const header = req.get('x-zonke-telemetry-key');
    if (header) return header;
    const auth = req.get('authorization') || '';
    return auth.replace(/^Bearer\s+/i, '');
}
function telemetryWriteAuth(req, res, next) {
    if (!keyMatches(readProvidedKey(req), ENV.telemetryWriteKey)) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
}
// Private reads: dashboard + detailed logs/metrics (contain usernames & counters).
function telemetryReadAuth(req, res, next) {
    const provided = readProvidedKey(req) || (typeof req.query.key === 'string' ? req.query.key : '');
    if (!keyMatches(provided, ENV.telemetryDashboardKey)) {
        if (req.path === '/telemetry') return res.status(401).type('text').send('Unauthorized');
        return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
}

/* ==========================================================================
   EXPRESS TELEMETRY ENDPOINTS (`/api/heartbeat/`, `/api/events/`, `/api/performance/`)
   Order per route: rate limit (cheap) -> key auth -> validation -> handler.
   ========================================================================== */

// 1. POST /api/heartbeat/ (and GET /api/heartbeat/)
app.post('/api/heartbeat/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-write', 60, 60000) ? next() : undefined),
    telemetryWriteAuth,
    (req, res) => {
        const body = isPlainObject(req.body) ? req.body : {};
        const appId = sanitizeLogString(body.appId, 64, 'client');
        const status = ['online', 'offline'].includes(body.status) ? body.status : undefined;
        const device = sanitizeLogString(body.device, 32, 'Web');
        telemetryStore.lastHeartbeat = new Date().toISOString();
        telemetryStore.lastHeartbeatTimestamp = Date.now();
        if (status) telemetryStore.status = status;

        console.log(`[Telemetry Heartbeat] Received from ${appId} (${device}) at ${telemetryStore.lastHeartbeat}`);

        return res.status(200).json({
            status: "success",
            appId: telemetryStore.appId,
            serverStatus: "online",
            lastHeartbeat: telemetryStore.lastHeartbeat,
            activeConnections: io.engine.clientsCount
        });
    });

app.get('/api/heartbeat/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-public', 120, 60000) ? next() : undefined),
    (req, res) => {
        return res.status(200).json({
            status: telemetryStore.status,
            lastHeartbeat: telemetryStore.lastHeartbeat,
            lastHeartbeatTimestamp: telemetryStore.lastHeartbeatTimestamp,
            activeConnections: io.engine.clientsCount
        });
    });

// 2. POST /api/events/ (and GET /api/events/)
app.post('/api/events/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-write', 60, 60000) ? next() : undefined),
    telemetryWriteAuth,
    (req, res) => {
        const body = isPlainObject(req.body) ? req.body : null;
        if (!body) return res.status(400).json({ error: 'invalid_body' });

        // Strict field validation — every value is typed, whitelisted or capped.
        const eventType = (typeof body.type === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(body.type))
            ? body.type : 'INFO';
        const sev = ['info', 'warning', 'critical'].includes(body.severity) ? body.severity : 'info';
        const message = sanitizeLogString(body.message, 200, 'Event triggered');
        const username = sanitizeLogString(body.username, 24, 'Anonymous');
        let details = {};
        if (isPlainObject(body.details)) {
            try { if (JSON.stringify(body.details).length <= 500) details = body.details; } catch { details = {}; }
        }

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
            message,
            username,
            severity: sev,
            details,
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

app.get('/api/events/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-private', 30, 60000) ? next() : undefined),
    telemetryReadAuth,
    (req, res) => {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        return res.status(200).json({
            totalEventsLogged: eventLogCounter,
            metrics: telemetryStore.metrics,
            events: telemetryStore.eventLogs.slice(0, limit)
        });
    });

// 3. POST /api/performance/ (and GET /api/performance/)
app.post('/api/performance/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-write', 60, 60000) ? next() : undefined),
    telemetryWriteAuth,
    (req, res) => {
        const body = isPlainObject(req.body) ? req.body : {};

        // Number.isFinite rejects NaN/Infinity/strings (typeof checks did not).
        if (Number.isFinite(body.lcp)) telemetryStore.performance.lcp = Number(body.lcp.toFixed(2));
        if (Number.isFinite(body.inp)) telemetryStore.performance.inp = Number(body.inp.toFixed(2));
        if (Number.isFinite(body.cls)) telemetryStore.performance.cls = Number(body.cls.toFixed(4));
        if (Number.isFinite(body.fps)) telemetryStore.performance.averageFps = Number(body.fps.toFixed(1));

        console.log(`[Telemetry Performance] LCP=${telemetryStore.performance.lcp}ms | INP=${telemetryStore.performance.inp}ms | CLS=${telemetryStore.performance.cls} | FPS=${telemetryStore.performance.averageFps}`);

        return res.status(200).json({
            status: "success",
            performance: telemetryStore.performance
        });
    });

app.get('/api/performance/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-public', 120, 60000) ? next() : undefined),
    (req, res) => {
        return res.status(200).json({
            status: "success",
            performance: telemetryStore.performance
        });
    });

// 4. GET /api/app-detail/ (Complete JSON summary for external monitoring dashboard)
//    PRIVATE: reveals counters + recent event log entries (usernames).
app.get('/api/app-detail/',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-private', 30, 60000) ? next() : undefined),
    telemetryReadAuth,
    (req, res) => {
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
//    PRIVATE when TELEMETRY_DASHBOARD_KEY is configured (?key=... works for browsers).
app.get('/telemetry',
    (req, res, next) => (httpRateLimit(req, res, 'telemetry-private', 30, 60000) ? next() : undefined),
    telemetryReadAuth,
    (req, res) => {
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
                ${telemetryStore.eventLogs.slice(0, 15).map(e => {
                    // Whitelist severity css class so a crafted severity can't inject attributes/HTML
                    const sevClass = ['critical', 'warning', 'info'].includes(e.severity) ? e.severity : 'info';
                    return `
                    <tr>
                        <td>#${Number(e.id) || 0}</td>
                        <td><strong>${escapeHtml(e.type)}</strong></td>
                        <td class="sev-${sevClass}">${escapeHtml(String(e.severity || 'info').toUpperCase())}</td>
                        <td>${escapeHtml(e.username)}</td>
                        <td>${escapeHtml(e.message)}</td>
                        <td>${escapeHtml(new Date(e.timestamp).toLocaleTimeString())}</td>
                    </tr>`;
                }).join('')}
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

// 5.1: invite/match room codes: DUEL-1234 / Zonke-Room-1001 / custom safe codes.
function validRoomCode(code) {
    return typeof code === 'string' && /^[A-Za-z0-9_-]{4,24}$/.test(code);
}

// 5.1: per-socket, per-event rate limiting. First breach per window notifies the
// client (rate_limited — old clients simply ignore unknown events); further
// bursts are dropped silently.
function socketRateLimit(socket, action, max, windowMs) {
    if (!socket._limits) socket._limits = new Map();
    const now = Date.now();
    let b = socket._limits.get(action);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + windowMs, notified: false };
        socket._limits.set(action, b);
    }
    b.count += 1;
    if (b.count <= max) return true;
    if (!b.notified) {
        b.notified = true;
        socket.emit('rate_limited', { event: action });
        console.warn(`[Rate Limit] ${action} exceeded by ${socket.id} (${max}/${windowMs}ms)`);
    }
    return false;
}

// 5.4: server-issued, per-seat, expiring reconnect credential.
function issueReconnectToken(role) {
    return {
        token: crypto.randomBytes(32).toString('base64url'), // 256-bit, unpredictable
        expiresAt: Date.now() + ENV.reconnectTokenTtlMs
    };
}

function tokenMatches(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// Single constructor for live match rooms (both quick-match and invite paths)
// so timers/tokens can never be forgotten in one of them.
function createMatchRoom(id, p1, p2, p1Profile, p2Profile) {
    return {
        id,
        p1, p2,
        p1Profile, p2Profile,
        currentTurn: 1,
        wind: 0.0,
        disconnectTimers: { 1: null, 2: null },   // 5.4: per-role grace timers
        reconnectTokens: {                        // 5.4: per-seat credentials
            1: issueReconnectToken(1),
            2: issueReconnectToken(2)
        }
    };
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
    console.log(`[Socket.io] Player connected: ${socket.id}${socket.data.legacyClient ? ' (legacy client — no handshake)' : ''}`);

    // Log connection as an APP_OPEN / Connection telemetry event:
    telemetryStore.metrics.appOpens++;
    telemetryStore.lastHeartbeat = new Date().toISOString();
    telemetryStore.lastHeartbeatTimestamp = Date.now();

    socket.on('find_match', (data) => {
        if (!socketRateLimit(socket, 'find_match', 10, 10000)) return;
        if (!isPlainObject(data)) {
            console.warn(`[Security] find_match rejected: malformed payload from ${socket.id}`);
            socket.emit('matchmaking_error', { message: 'Invalid matchmaking request.' });
            return;
        }
        // 5.1: a player already inside a live match must not re-enter the queue.
        if (socket.roomId && rooms[socket.roomId]) {
            console.warn(`[Security] find_match rejected: ${socket.id} already in ${socket.roomId}`);
            socket.emit('matchmaking_error', { message: 'You are already in an active match.' });
            return;
        }

        const profile = {
            username: sanitizeString(data.name || `Warrior-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data.avatar || "🧢", 4),
            rank: sanitizeString(data.rank || "Street Novice", 24),
            outfit: sanitizeString(data.outfit || "outfit-soldier", 24),
            gun: sanitizeString(data.gun || "akm", 16),
            wins: clampNumber(data.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;

        if (waitingSocket && waitingSocket.id !== socket.id) {
            const roomId = `Zonke-Room-${++roomCounter}`;
            const p1Prof = waitingSocket.playerProfile;
            const p2Prof = socket.playerProfile;

            const room = createMatchRoom(roomId, waitingSocket, socket, p1Prof, p2Prof);
            rooms[roomId] = room;

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
                wind: 0.0,
                reconnectToken: room.reconnectTokens[1].token
            });

            socket.emit('match_found', {
                roomId: roomId,
                role: 2,
                myProfile: p2Prof,
                opponentProfile: p1Prof,
                wind: 0.0,
                reconnectToken: room.reconnectTokens[2].token
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
        if (!socketRateLimit(socket, 'player_flick', 6, 5000)) return;
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // 5.1: only a seat occupant of THIS room may act (ghost/foreign sockets out).
        if (room.p1 !== socket && room.p2 !== socket) {
            console.warn(`[Security] player_flick from non-occupant ${socket.id} in ${roomId} rejected.`);
            return;
        }
        // Turn Anti-Cheat check: Verify it is genuinely this player's turn (`room.currentTurn === socket.playerRole`)
        if (room.currentTurn !== socket.playerRole) {
            console.warn(`[Anti-Cheat Violation] Player ${socket.playerRole} inside ${roomId} attempted to flick during Player ${room.currentTurn}'s turn! Rejected.`);
            return;
        }
        if (!isPlainObject(data)) {
            console.warn(`[Security] player_flick rejected: malformed payload from ${socket.id}`);
            return;
        }

        const cleanPower = clampNumber(data.power, 0, 100, 50);
        const cleanWind = clampNumber(data.wind, -2.0, 2.0, 0.0);
        const cleanShot = (data.specialShot === 'STICKY' || data.specialShot === 'FOIL') ? data.specialShot : 'NORMAL';

        socket.to(roomId).emit('opponent_flick', {
            power: cleanPower,
            wind: cleanWind,
            specialShot: cleanShot,
            playerRole: socket.playerRole
        });
    });


    // Live Online Loadout Synchronization (`sync Character Outfit & Weapon during live duel!`)
    socket.on('player_loadout_change', (data) => {
        if (!socketRateLimit(socket, 'player_loadout_change', 30, 5000)) return;
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.p1 !== socket && room.p2 !== socket) return;
        if (!isPlainObject(data)) return;
        socket.to(roomId).emit('opponent_loadout_change', {
            outfit: sanitizeString(data.outfit || 'outfit-soldier', 24),
            gun: sanitizeString(data.gun || 'akm', 16),
            playerRole: socket.playerRole
        });
    });

    socket.on('player_landing', (data) => {
        if (!socketRateLimit(socket, 'player_landing', 6, 5000)) return;
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // 5.1: only a seat occupant of THIS room may act.
        if (room.p1 !== socket && room.p2 !== socket) {
            console.warn(`[Security] player_landing from non-occupant ${socket.id} in ${roomId} rejected.`);
            return;
        }
        // Turn Anti-Cheat check: Verify only active turn player reports landing!
        if (room.currentTurn !== socket.playerRole) {
            console.warn(`[Anti-Cheat Violation] Player ${socket.playerRole} reported landing out of turn! Rejected.`);
            return;
        }
        if (!isPlainObject(data)) {
            console.warn(`[Security] player_landing rejected: malformed payload from ${socket.id}`);
            return;
        }

        let cleanRowIdx = data.rowIdx;
        if (cleanRowIdx !== 'BONUS') {
            cleanRowIdx = clampNumber(cleanRowIdx, 0, 8, 0);
        }
        const cleanWind = clampNumber(data.newWind, -2.0, 2.0, room.wind || 0.0);
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
        if (!socketRateLimit(socket, 'create_invite_room', 6, 10000)) return;
        if (!isPlainObject(data)) {
            socket.emit('matchmaking_error', { message: 'Invalid room request.' });
            return;
        }
        // DOS Protection: Enforce max 500 active invite rooms server-wide
        if (Object.keys(inviteRooms).length >= 500) {
            socket.emit('invite_join_error', { message: "Server invite limit reached. Please try quick match!" });
            return;
        }
        if (socket.roomId && inviteRooms[socket.roomId]) {
            delete inviteRooms[socket.roomId];
        }

        const profile = {
            username: sanitizeString(data.name || `Host-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data.avatar || "🧢", 4),
            rank: sanitizeString(data.rank || "Street Boss", 24),
            outfit: sanitizeString(data.outfit || "outfit-soldier", 24),
            gun: sanitizeString(data.gun || "akm", 16),
            wins: clampNumber(data.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;

        // Client proposes DUEL-#### ; anything malformed falls back to a server code.
        let customCode = 'DUEL-' + Math.floor(1000 + Math.random() * 9000);
        if (data.roomCode !== undefined) {
            if (!validRoomCode(data.roomCode)) {
                console.warn(`[Security] create_invite_room: invalid roomCode from ${socket.id} rejected.`);
                socket.emit('matchmaking_error', { message: 'Invalid room code.' });
                return;
            }
            customCode = data.roomCode;
        }

        if (inviteRooms[customCode] && inviteRooms[customCode].cleanupTimer) {
            clearTimeout(inviteRooms[customCode].cleanupTimer);
        }

        const hostToken = crypto.randomBytes(32).toString('base64url'); // 5.4: host reattach credential
        inviteRooms[customCode] = {
            id: customCode,
            host: socket,
            hostId: socket.id,
            hostProfile: profile,
            hostToken,
            createdAt: Date.now()
        };
        socket.join(customCode);
        socket.roomId = customCode;
        socket.playerRole = 1;

        console.log(`[Invite Room] Created room ${customCode} by ${profile.username} (${socket.id})`);
        socket.emit('invite_room_created', { roomCode: customCode, hostProfile: profile, hostToken });
    });

    // Host Room Maintenance & Re-attachment (`keep host alive in room after polling->websocket upgrade or app switch`)
    socket.on('maintain_invite_room', (data) => {
        if (!socketRateLimit(socket, 'maintain_invite_room', 12, 10000)) return;
        if (!isPlainObject(data) || !validRoomCode(data.roomCode)) return;
        const roomCode = data.roomCode;
        if (!inviteRooms[roomCode]) return;
        const invRoom = inviteRooms[roomCode];

        // 5.4: reattachment requires the host credential issued at creation —
        // knowing the room code alone must NOT allow stealing the host seat.
        if (!tokenMatches(data.hostToken, invRoom.hostToken)) {
            console.warn(`[Security] maintain_invite_room from ${socket.id} for ${roomCode} rejected: bad host token.`);
            return;
        }

        if (invRoom.cleanupTimer) {
            clearTimeout(invRoom.cleanupTimer);
            invRoom.cleanupTimer = null;
        }
        if (invRoom.hostId !== socket.id || invRoom.host !== socket) {
            console.log(`[Invite Room Reattach] Host socket updated for room ${roomCode}: ${invRoom.hostId} -> ${socket.id}`);
            invRoom.host = socket;
            invRoom.hostId = socket.id;
            socket.join(roomCode);
            socket.roomId = roomCode;
            socket.playerRole = 1;
        }
    });

    // Join Direct Invite Room via Link/Code
    socket.on('join_invite_room', (data) => {
        if (!socketRateLimit(socket, 'join_invite_room', 15, 10000)) return; // allows the 1.8s client watchdog
        if (!isPlainObject(data)) {
            socket.emit('invite_join_error', { message: 'Invalid join request.' });
            return;
        }
        const roomCode = data.roomCode || data.roomId;
        if (!validRoomCode(roomCode) || !inviteRooms[roomCode]) {
            socket.emit('invite_join_error', { message: `Room ${typeof roomCode === 'string' ? roomCode : ''} not found or match already started!` });
            return;
        }
        const invRoom = inviteRooms[roomCode];
        if (invRoom.cleanupTimer) {
            clearTimeout(invRoom.cleanupTimer);
            invRoom.cleanupTimer = null;
        }
        const hostSocket = invRoom.host;
        const p1Prof = invRoom.hostProfile;

        const profile = {
            username: sanitizeString(data.name || `Challenger-${socket.id.slice(0, 4)}`, 16),
            avatar: sanitizeString(data.avatar || "👨‍🚀", 4),
            rank: sanitizeString(data.rank || "Tactical Striker", 24),
            outfit: sanitizeString(data.outfit || "outfit-pilot", 24),
            gun: sanitizeString(data.gun || "m416", 16),
            wins: clampNumber(data.wins, 0, 100000, 0)
        };
        socket.playerProfile = profile;

        const room = createMatchRoom(roomCode, hostSocket, socket, p1Prof, profile);
        rooms[roomCode] = room;
        delete inviteRooms[roomCode];

        socket.join(roomCode);
        socket.roomId = roomCode;
        socket.playerRole = 2;
        if (hostSocket && typeof hostSocket.join === 'function') {
            // Host may have upgraded transports; make sure its CURRENT socket is in the room.
            try { hostSocket.join(roomCode); } catch { /* room will still broadcast below */ }
        }

        console.log(`[Invite Room] Match started inside ${roomCode}: ${p1Prof.username} vs ${profile.username}`);

        const matchDataP1 = {
            roomId: roomCode,
            role: 1,
            myProfile: p1Prof,
            opponentProfile: profile,
            wind: 0.0,
            reconnectToken: room.reconnectTokens[1].token
        };
        const matchDataP2 = {
            roomId: roomCode,
            role: 2,
            myProfile: profile,
            opponentProfile: p1Prof,
            wind: 0.0,
            reconnectToken: room.reconnectTokens[2].token
        };

        if (hostSocket && typeof hostSocket.emit === 'function') {
            hostSocket.emit('match_found', matchDataP1);
        }
        // Broadcast directly to room so even if host socket ID changed slightly, all joined sockets receive match_found
        io.to(roomCode).emit('match_found_broadcast', {
            roomId: roomCode,
            p1Profile: p1Prof,
            p2Profile: profile,
            wind: 0.0
        });
        socket.emit('match_found', matchDataP2);
    });

    // Low Network / Lag Reconnection (`reconnect_to_match when cellular signal drops temporarily`)
    // 5.4: identity comes from the server-issued token — the client-supplied role is ignored.
    socket.on('reconnect_to_match', (data) => {
        if (!socketRateLimit(socket, 'reconnect_to_match', 10, 10000)) return;
        if (!isPlainObject(data)) return;
        const roomId = data.roomId;
        if (!validRoomCode(roomId) || !rooms[roomId]) {
            socket.emit('invite_join_error', { message: "Match session expired or closed. Please start a new duel!" });
            return;
        }
        const room = rooms[roomId];

        const provided = data.token;
        let role = null;
        if (typeof provided === 'string' && provided) {
            for (const candidate of [1, 2]) {
                const cred = room.reconnectTokens && room.reconnectTokens[candidate];
                if (cred && tokenMatches(provided, cred.token)) {
                    if (Date.now() > cred.expiresAt) {
                        console.warn(`[Security] Expired reconnect token for ${roomId} from ${socket.id}`);
                        socket.emit('invite_join_error', { message: "Reconnect session expired. Please start a new duel!" });
                        return;
                    }
                    role = candidate;
                    break;
                }
            }
        }
        if (!role) {
            console.warn(`[Security] reconnect_to_match rejected (missing/invalid token) from ${socket.id} for ${roomId}`);
            socket.emit('invite_join_error', { message: "Reconnect session expired or closed. Please start a new duel!" });
            return;
        }

        // Clear ONLY this seat's grace timer (another player's window must keep running).
        if (room.disconnectTimers && room.disconnectTimers[role]) {
            clearTimeout(room.disconnectTimers[role]);
            room.disconnectTimers[role] = null;
        }
        room.isPausedForNetwork = Boolean(room.disconnectTimers[1] || room.disconnectTimers[2]);

        // Detach any zombie socket still holding the seat (half-open connections).
        const previousSeatSocket = role === 1 ? room.p1 : room.p2;
        if (previousSeatSocket && previousSeatSocket.id !== socket.id) {
            const live = io.sockets.sockets.get(previousSeatSocket.id);
            if (live) {
                console.warn(`[Security] Disconnecting zombie seat socket ${previousSeatSocket.id} for ${roomId} role ${role}`);
                live.disconnect(true);
            }
        }

        if (role === 1) {
            room.p1 = socket;
        } else {
            room.p2 = socket;
        }
        socket.playerRole = role;
        socket.join(roomId);
        socket.roomId = roomId;
        console.log(`[Low Network Recovery] Player ${role} (${socket.id}) successfully reconnected to ${roomId}!`);
        io.to(roomId).emit('match_resumed_from_lag', {
            currentTurn: room.currentTurn,
            wind: room.wind || 0.0,
            message: "🟢 Cellular / network signal restored! Match resuming synchronously."
        });
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.io] Player disconnected: ${socket.id}`);
        if (socket.roomId && inviteRooms[socket.roomId] && inviteRooms[socket.roomId].hostId === socket.id) {
            const rId = socket.roomId;
            console.log(`[Invite Room] Host disconnected briefly for ${rId}. Starting 5-minute survival grace timer for polling->websocket upgrade...`);
            inviteRooms[rId].cleanupTimer = setTimeout(() => {
                if (inviteRooms[rId]) {
                    console.log(`[Invite Room] 5-minute survival window expired for ${rId}. Room closed.`);
                    delete inviteRooms[rId];
                }
            }, 300000);
        }
        if (waitingSocket && waitingSocket.id === socket.id) {
            waitingSocket = null;
        }
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const role = socket.playerRole;
            const isSeatOccupant = (role === 1 && room.p1 === socket) || (role === 2 && room.p2 === socket);

            if (isSeatOccupant) {
                // Low Network Grace Buffer — per-role so two disconnects can't
                // overwrite each other's timer (Stage 1 fix for the shared-timer bug).
                room.isPausedForNetwork = true;
                const graceSeconds = Math.max(1, Math.ceil(ENV.disconnectGraceMs / 1000));
                socket.to(roomId).emit('opponent_network_lag', {
                    message: `📶 Friend has low network / packet loss! Waiting for auto-reconnect... (${graceSeconds}s grace window)`,
                    graceSeconds,
                    disconnectedRole: role
                });
                console.log(`[Low Network Buffer] Player ${role} inside ${roomId} disconnected. Starting ${graceSeconds}s grace timer...`);

                if (room.disconnectTimers[role]) clearTimeout(room.disconnectTimers[role]);
                const departed = socket;
                room.disconnectTimers[role] = setTimeout(() => {
                    const r = rooms[roomId];
                    if (!r) return;
                    const seat = role === 1 ? r.p1 : r.p2;
                    if (seat !== departed) return; // reconnected — this timer is stale
                    io.to(roomId).emit('opponent_disconnected', {
                        message: `Opponent lost connection after ${graceSeconds}s grace period! You win by forfeit! 🏆`
                    });
                    delete rooms[roomId];
                    console.log(`[Low Network Buffer] ${graceSeconds}s expired for room ${roomId}. Room closed.`);
                }, ENV.disconnectGraceMs);
            } else {
                console.log(`[Socket.io] Stale socket ${socket.id} left ${roomId} without occupying a seat — no grace timer started.`);
            }
        }
    });
});

/* ==========================================================================
   SAFE ERROR RESPONSES (5.3) — never leak stacks/internals to clients
   ========================================================================== */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'payload_too_large' });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'invalid_json' });
    }
    console.error('[Server Error]', err && err.message);
    return res.status(500).json({ error: 'internal_error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🎮 =====================================================================`);
    console.log(`🚀 ZONKE MULTIPLAYER & TELEMETRY SERVER RUNNING ON PORT ${PORT}`);
    console.log(`🛡️  STAGE 1 SECURITY POSTURE:`);
    console.log(`   - Socket/HTTP origins: ${ORIGINS.allowAll ? '*' : ORIGINS.entries.join(', ')}`);
    console.log(`   - Handshake required:  ${ENV.requireHandshake ? 'yes (REQUIRE_HANDSHAKE=1)' : 'no (legacy accepted — Phase 1)'}`);
    console.log(`   - Telemetry write key: ${ENV.telemetryWriteKey ? 'configured' : 'not set (open writes, rate-limited)'}`);
    console.log(`   - Dashboard key:       ${ENV.telemetryDashboardKey ? 'configured' : 'not set (open reads, rate-limited)'}`);
    console.log(`   - Reconnect token TTL: ${ENV.reconnectTokenTtlMs}ms | Disconnect grace: ${ENV.disconnectGraceMs}ms`);
    console.log(`📡 Telemetry Endpoints Active:`);
    console.log(`   - POST/GET /api/heartbeat/   (App status & heartbeat)`);
    console.log(`   - POST/GET /api/events/      (Logins, errors, critical alerts, logs)`);
    console.log(`   - POST/GET /api/performance/ (LCP, INP, CLS, FPS metrics)`);
    console.log(`   - GET /api/app-detail/       (JSON overview for monitoring dashboard)`);
    console.log(`   - GET /telemetry             (Live web telemetry dashboard)`);
    console.log(`=====================================================================\n`);
});
