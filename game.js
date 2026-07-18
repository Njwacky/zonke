/* ==========================================================================
   ZONKE - THE KASI PAPER SOLDIER
   game.js - Main Game Engine, Audio Synthesizer, 4 Custom Soldier Outfits, & Physics
   ========================================================================== */

const STAGES = [
    { id: 1, name: "Head & Hat/Helmet", class: "stage-1" },
    { id: 2, name: "Neck/Collar", class: "stage-2" },
    { id: 3, name: "Shirt/Armor/Ribs", class: "stage-3" },
    { id: 4, name: "Arms/Stance", class: "stage-4" },
    { id: 5, name: "Lower Body/Belt", class: "stage-5" },
    { id: 6, name: "Legs & Shoes/Boots", class: "stage-6" },
    { id: 7, name: "Gun/Laser/Bone Rifle", class: "stage-7" },
    { id: 8, name: "Bullet 1", class: "stage-8" },
    { id: 9, name: "Bullet 2", class: "stage-9" },
    { id: 10, name: "Bullet 3", class: "stage-10" },
    { id: 11, name: "Bullet 4", class: "stage-11" },
    { id: 12, name: "Bullet 5 (Complete & Shoot 1st!)", class: "stage-12" }
];

const TOTAL_ROWS = 9;
const WIN_MAJORITY = 5;
let player1Rows = new Array(TOTAL_ROWS).fill(0);
let player2Rows = new Array(TOTAL_ROWS).fill(0);

let currentPlayer = 1;
let phase = 'IDLE'; // 'IDLE', 'MOVING', 'SNAPPING', 'LANDED', 'RETURNING'
let gameOver = false;
let soundEnabled = true;
let hapticsEnabled = true;
let currentTheme = 'theme-kasi';
let currentOutfit = 'outfit-soldier';
let currentGun = 'akm'; // 'akm', 'm416', 'scarl', 'beryl', 'groza', 'aug', 'ump45', 'vector', 'tommy', 's12k'
let isAiBotMode = false;
let aiBotDifficulty = 'MEDIUM'; // 'EASY', 'MEDIUM', 'HARD'
let unlockedOutfits = ['outfit-soldier'];

// Breakthrough Special Ammo & Stoep Wind state:
let p1Sticky = 1, p2Sticky = 1;
let p1Foil = 1, p2Foil = 1;
let activeSpecialShot = 'NORMAL'; // 'NORMAL', 'STICKY', 'FOIL'
let currentWind = 0.0;
let turnCount = 0;

// Dual Player Time Tracking (`add time taken by two players`) & Guided Tour:
let p1Seconds = 0, p2Seconds = 0;
let timerInterval = null;
let currentTourStep = 1;
let isTourActive = false;

let powerVal = 0;
let launchSide = 'LEFT'; // 'LEFT' or 'RIGHT'
let powerDir = 1;
let powerSpeed = 2.4; // Boosted power bar oscillation speed for fast reflex timing!

const ball = {
    el: null,
    x: 0,
    y: 0,
    vy: 0,
    radius: 7, // 14px compact ball ("smaller so wont stack between lines")
    rotation: 0,
    vRot: 0,
    bounceCount: 0,
    targetBoardRowIndex: -1 // 0..11 or 'BONUS'
};

/* ==========================================================================
   PLAYER PROFILE & CAREER IDENTITY ENGINE (`if playing online need profile`)
   ========================================================================== */
let myProfile = {
    username: "Sipho_Durban_" + Math.floor(Math.random() * 90 + 10),
    avatar: "🧢",
    xp: 2450,
    coins: 340,
    wins: 42,
    losses: 14,
    kills: 240,
    goats: 318
};

function getRankInfo(xp) {
    if (xp >= 7500) return "👑 ARENA GOAT LEGEND";
    if (xp >= 4000) return "💎 Tactical Master";
    if (xp >= 2200) return "🥇 Street Boss";
    if (xp >= 1200) return "Arena Commander";
    if (xp >= 600) return "Tactical Striker";
    if (xp >= 250) return "Arena Hustler";
    return "Street Novice";
}

function loadProfile() {
    try {
        const saved = localStorage.getItem('zonke_player_profile');
        if (saved) myProfile = JSON.parse(saved);
        const unlocks = localStorage.getItem('zonke_unlocks');
        if (unlocks) unlockedOutfits = JSON.parse(unlocks);
    } catch(e) {}
    updateProfileUI();
    updateStoreUI();
}

function updateStoreUI() {
    const sCoins = document.getElementById('store-coins-display');
    if (sCoins) sCoins.textContent = `Your Balance: 🪙 ${myProfile.coins} Coins`;

    document.querySelectorAll('.store-item-btn').forEach(btn => {
        const key = btn.getAttribute('data-unlock');
        const cost = parseInt(btn.getAttribute('data-cost')) || 150;
        if (unlockedOutfits.includes(key)) {
            btn.disabled = true;
            btn.innerHTML = `<span>✔ ${key.replace('outfit-','').toUpperCase()} OUTFIT</span><span style="color: var(--green); font-weight: 900;">UNLOCKED</span>`;
        } else {
            btn.disabled = myProfile.coins < cost;
            btn.innerHTML = `<span>🔒 ${key.replace('outfit-','').toUpperCase()} OUTFIT</span><span class="store-cost-badge">🪙 ${cost}</span>`;
        }
    });
}

function saveProfile() {
    try {
        const input = document.getElementById('profile-username-input');
        if (input && input.value.trim().length > 0) {
            // Clamped to max 16 chars and stripped of HTML/script tags right on input save:
            myProfile.username = input.value.replace(/<[^>]*>?/gm, '').replace(/[^a-zA-Z0-9_\-]/g, '').trim().slice(0, 16) || "KasiPlayer";
        }
        myProfile.xp = Math.max(0, Math.floor(Number(myProfile.xp) || 0));
        myProfile.coins = Math.max(0, Math.floor(Number(myProfile.coins) || 0));
        localStorage.setItem('zonke_player_profile', JSON.stringify(myProfile));
        ZonkeTelemetry.logEvent("LOGIN_SUCCESS", `Profile saved: ${myProfile.username} (${getRankInfo(myProfile.xp)})`, "info");
    } catch(e) {}
    updateProfileUI();
}

function updatePlayerFooterUI() {
    // Player 1
    const p1Av = document.getElementById('p1-footer-avatar');
    const p1Name = document.getElementById('p1-footer-name');
    const p1Rank = document.getElementById('p1-footer-rank');
    if (p1Av && myProfile) p1Av.textContent = myProfile.avatar || "🧢";
    if (p1Name && myProfile) p1Name.textContent = myProfile.username || "PLAYER 1";
    if (p1Rank && myProfile) p1Rank.textContent = getRankInfo(myProfile.xp) || "🥇 Street Boss";

    // Player 2
    const p2Av = document.getElementById('p2-footer-avatar');
    const p2Name = document.getElementById('p2-footer-name');
    const p2Rank = document.getElementById('p2-footer-rank');
    if (p2Av && p2Name && p2Rank) {
        if (isOnlineMode && typeof opponentProfile !== 'undefined' && opponentProfile) {
            p2Av.textContent = opponentProfile.avatar || "💀";
            p2Name.textContent = opponentProfile.username || "OPPONENT";
            p2Rank.textContent = getRankInfo(opponentProfile.xp || 0);
        } else if (isAiBotMode) {
            p2Av.textContent = "🤖";
            p2Name.textContent = "SIPHO AI BOT";
            p2Rank.textContent = "🦾 Stoep King";
        } else {
            p2Av.textContent = "👨‍🚀";
            p2Name.textContent = "PLAYER 2";
            p2Rank.textContent = "🥈 Local Rival";
        }
    }
}

function updateProfileUI() {
    updatePlayerFooterUI();
    const rankTitle = getRankInfo(myProfile.xp);
    // Menu card display:
    const menuAv = document.getElementById('menu-avatar-display');
    const menuUser = document.getElementById('menu-username-display');
    const menuRank = document.getElementById('menu-rank-display');
    const menuCoins = document.getElementById('menu-coins-display');
    if (menuAv) menuAv.textContent = myProfile.avatar;
    if (menuUser) menuUser.textContent = myProfile.username;
    if (menuRank) menuRank.textContent = `${rankTitle} (${myProfile.xp} XP)`;
    if (menuCoins) menuCoins.textContent = `🪙 ${myProfile.coins} Coins | W/L: ${myProfile.wins} - ${myProfile.losses}`;

    // Profile modal stats display:
    const input = document.getElementById('profile-username-input');
    if (input) input.value = myProfile.username;
    const sRank = document.getElementById('stat-rank-val');
    const sXp = document.getElementById('stat-xp-val');
    const sCoins = document.getElementById('stat-coins-val');
    const sWr = document.getElementById('stat-wr-val');
    const sGoats = document.getElementById('stat-goats-val');
    const sKills = document.getElementById('stat-kills-val');
    if (sRank) sRank.textContent = rankTitle;
    if (sXp) sXp.textContent = `${myProfile.xp} XP`;
    if (sCoins) sCoins.textContent = `🪙 ${myProfile.coins}`;
    const totalM = myProfile.wins + myProfile.losses;
    const wr = totalM > 0 ? Math.round((myProfile.wins / totalM) * 100) : 0;
    if (sWr) sWr.textContent = `${wr}% (${myProfile.wins}W - ${myProfile.losses}L)`;
    if (sGoats) sGoats.textContent = `🐐 ${myProfile.goats}`;
    if (sKills) sKills.textContent = `💀 ${myProfile.kills}`;
}


// Strict HTML & String Sanitization Helper (`Zero XSS & Prototype Pollution Protection`)
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

let p1Wrapper, p2Wrapper, middleBoard, targetRowsContainer, launchPadArea;
let powerFill, powerMarker, turnBadge, statusBox, p1ScoreLbl, p2ScoreLbl;
let btnFlick, btnClear, btnSticky, btnFoil, windBadge, hypemanBar, btnSoundQuick, btnMenu, btnAimGear;
let p1AimGear = 'MID', p2AimGear = 'MID';
let isPaused = false;
let btnPauseQuick, pauseOverlay, btnResumeModal, btnRulesPause;
let btnHapticsQuick, btnHapticsMenu;
let menuModal, btnCloseMenu, btnNewMenu, btnRulesMenu, btnSoundMenu;
let btnFeedbackMenu, feedbackModal, btnCloseFeedback, btnSendGmail, btnSendOutlook, btnSubmitCloudFeedback;
let btnCloseRules, btnPlayAgain, rulesModal, winModal;

let boardRect = { width: 480, height: 520 };
let targetAreaHeight = 420;
let launchPadCenterY = 490;

/* ==========================================================================
   CAPACITOR NATIVE HAPTICS ENGINE (`triggerHaptic`)
   ========================================================================== */
function triggerHaptic(type) {
    if (!hapticsEnabled) return;
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
        const { Haptics } = window.Capacitor.Plugins;
        try {
            if (type === 'flick') Haptics.impact({ style: 'LIGHT' });
            else if (type === 'bounce') Haptics.impact({ style: 'MEDIUM' });
            else if (type === 'hit' || type === 'bonus') Haptics.impact({ style: 'HEAVY' });
            else if (type === 'kill' || type === 'win') Haptics.vibrate({ duration: 350 });
        } catch (e) {
            // Graceful fallback if haptics unavailable
        }
    }
}

/* ==========================================================================
   WEB AUDIO API SOUND GENERATOR (Boosted High Volume across all effects!)
   ========================================================================== */
let audioCtx = null;

function getAudioContext() {
    if (audioCtx) return audioCtx;
    try {
        const AudioCtxClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (AudioCtxClass) {
            audioCtx = new AudioCtxClass();
        }
    } catch(e) {
        console.warn("AudioContext creation error/sandbox restriction:", e);
    }
    return audioCtx;
}

function playSound(type) {
    triggerHaptic(type); // Native mobile vibration via Capacitor!
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        if (type === 'flick') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(280, now);
            osc.frequency.exponentialRampToValueAtTime(1050, now + 0.18);
            gain.gain.setValueAtTime(0.75, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.18);
        } else if (type === 'bounce') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(95, now);
            osc.frequency.exponentialRampToValueAtTime(32, now + 0.12);
            gain.gain.setValueAtTime(0.8, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } else if (type === 'hit') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(650, now);
            osc.frequency.exponentialRampToValueAtTime(140, now + 0.16);
            gain.gain.setValueAtTime(0.75, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.16);
        } else if (type === 'bonus') {
            [440, 554.37, 659.25, 880].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.75, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.35);
            });
        } else if (type === 'kill') {
            [220, 164.81, 110, 82.41].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, now + idx * 0.1);
                gain.gain.setValueAtTime(0.8, now + idx * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.1);
                osc.stop(now + idx * 0.1 + 0.4);
            });
        } else if (type === 'wasted') {
            [130, 120, 110, 95].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.09);
                gain.gain.setValueAtTime(0.7, now + idx * 0.09);
                gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.09 + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.09);
                osc.stop(now + idx * 0.09 + 0.35);
            });
        } else if (type === 'select') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'win') {
            [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.85, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.4);
            });
        }
    } catch(err) {
        console.warn("Audio generation error:", err);
    }
}

/* ==========================================================================
   PRODUCTION OBSERVABILITY & TELEMETRY CLIENT ENGINE (`App Dashboard Monitoring`)
   ========================================================================== */
// Automatic Backend Detection for Netlify / Cloudflare / Local deployment:
const SERVER_API_URL = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? "http://localhost:3000"
    : "https://zonke-server.onrender.com"; // Replace with your live Render/Railway server URL when deploying backend!


/* ==========================================================================
   SUPABASE CLOUD DATABASE & FRIENDS ENGINE (`ZonkeSupabase`)
   URL: https://osfkjqmtfvwqmernwcis.supabase.co
   ========================================================================== */
const SUPABASE_URL = "https://osfkjqmtfvwqmernwcis.supabase.co";
let SUPABASE_ANON_KEY = "sb_publishable_Wo44LtJ0WaZXxw7_kI4BaA_HdwOgNMH"; // Paste your Supabase anon public key here or via UI!

const ZonkeSupabase = {
    isConfigured: function() {
        return SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY_HERE" && SUPABASE_ANON_KEY.length > 10;
    },

    setAnonKey: function(key) {
        if (key && key.trim().length > 10) {
            SUPABASE_ANON_KEY = key.trim();
            localStorage.setItem('zonke_supabase_anon_key', SUPABASE_ANON_KEY);
            console.log("[ZonkeSupabase] Anon Key saved and configured!");
            return true;
        }
        return false;
    },

    init: function() {
        const savedKey = localStorage.getItem('zonke_supabase_anon_key');
        if (savedKey && savedKey.length > 10) {
            SUPABASE_ANON_KEY = savedKey;
        }
        if (this.isConfigured()) {
            this.syncProfile(myProfile);
        }
    },

    // Upsert player profile to Supabase `profiles` table
    syncProfile: async function(profile) {
        if (!this.isConfigured() || !navigator.onLine || !profile || !profile.username) return;
        try {
            // Clamped and sanitized before emitting over PostgREST boundary:
            const cleanTag = String(profile.username).replace(/<[^>]*>?/gm, '').trim().slice(0, 16) || "KasiPlayer";
            const cleanXp = Math.max(0, Math.min(1000000, Math.floor(Number(profile.xp) || 0)));
            const cleanCoins = Math.max(0, Math.min(1000000, Math.floor(Number(profile.coins) || 0)));
            const cleanWins = Math.max(0, Math.min(100000, Math.floor(Number(profile.wins) || 0)));
            const cleanLosses = Math.max(0, Math.min(100000, Math.floor(Number(profile.losses) || 0)));

            await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
                method: "POST",
                headers: {
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify({
                    username: cleanTag,
                    avatar: String(profile.avatar || "🧢").slice(0, 4),
                    xp: cleanXp,
                    coins: cleanCoins,
                    wins: cleanWins,
                    losses: cleanLosses,
                    rank: getRankInfo(cleanXp),
                    outfit: String(profile.outfit || "outfit-soldier").slice(0, 24),
                    gun: String(profile.gun || "akm").slice(0, 16),
                    updated_at: new Date().toISOString()
                })
            });
            console.log(`[ZonkeSupabase] Synced profile ${profile.username} to Supabase cloud!`);
        } catch(e) {
            console.warn("[ZonkeSupabase] Profile sync error:", e);
        }
    },

    // Add friend to Supabase `friends` table
    addFriend: async function(myTag, friendTag, friendAvatar, friendRank) {
        if (!this.isConfigured() || !navigator.onLine) return false;
        try {
            const cleanMy = String(myTag).replace(/<[^>]*>?/gm, '').trim().slice(0, 16);
            const cleanFr = String(friendTag).replace(/<[^>]*>?/gm, '').trim().slice(0, 16);
            if (!cleanMy || !cleanFr) return false;

            const resp = await fetch(`${SUPABASE_URL}/rest/v1/friends`, {
                method: "POST",
                headers: {
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify({
                    user_username: cleanMy,
                    friend_username: cleanFr,
                    friend_avatar: String(friendAvatar || "👨‍🚀").slice(0, 4),
                    friend_rank: String(friendRank || "Tactical Striker").slice(0, 30),
                    created_at: new Date().toISOString()
                })
            });
            return resp.status === 201 || resp.status === 200 || resp.status === 204;
        } catch(e) {
            console.warn("[ZonkeSupabase] Add friend error:", e);
            return false;
        }
    },

    // Fetch global leaderboard top 20 from Supabase `profiles` table
    fetchLeaderboard: async function() {
        if (!this.isConfigured() || !navigator.onLine) return null;
        try {
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=username,avatar,xp,wins,rank&order=xp.desc&limit=20`, {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
                }
            });
            if (resp.ok) {
                return await resp.json();
            }
        } catch(e) {
            console.warn("[ZonkeSupabase] Fetch leaderboard error:", e);
        }
        return null;
    }
};

const ZonkeTelemetry = {
    appId: "com.zonke.kasiwars",
    serverUrl: SERVER_API_URL,
    metrics: { lcp: 0, inp: 0, cls: 0, fps: 60, frameCount: 0, lastFpsTime: Date.now() },

    init: function() {
        this.logEvent("APP_OPEN", "Zonke native/web client launched", "info");
        this.startHeartbeatLoop();
        this.setupPerformanceObservers();
    },

    sendHeartbeat: async function() {
        try {
            await fetch(`${ZonkeTelemetry.serverUrl}/api/heartbeat/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    appId: ZonkeTelemetry.appId,
                    status: navigator.onLine ? "online" : "offline",
                    device: window.Capacitor ? "Capacitor Mobile" : "Web Browser",
                    version: "1.0.0"
                })
            });
        } catch(e) {}
    },

    startHeartbeatLoop: function() {
        this.sendHeartbeat();
        setInterval(() => this.sendHeartbeat(), 30000); // 30-sec heartbeat
    },

    logEvent: async function(type, message, severity = "info", details = {}) {
        try {
            await fetch(`${ZonkeTelemetry.serverUrl}/api/events/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: type,
                    message: message,
                    username: myProfile ? myProfile.username : "Anonymous",
                    severity: severity,
                    details: details
                })
            });
        } catch(e) {}
    },

    reportPerformance: async function() {
        try {
            await fetch(`${ZonkeTelemetry.serverUrl}/api/performance/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lcp: ZonkeTelemetry.metrics.lcp,
                    inp: ZonkeTelemetry.metrics.inp,
                    cls: ZonkeTelemetry.metrics.cls,
                    fps: ZonkeTelemetry.metrics.fps
                })
            });
        } catch(e) {}
    },

    setupPerformanceObservers: function() {
        // Measure LCP (Largest Contentful Paint)
        try {
            new PerformanceObserver((entryList) => {
                const entries = entryList.getEntries();
                if (entries.length > 0) {
                    ZonkeTelemetry.metrics.lcp = entries[entries.length - 1].startTime;
                }
            }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch(e) {}

        // Measure CLS (Cumulative Layout Shift)
        try {
            new PerformanceObserver((entryList) => {
                for (const entry of entryList.getEntries()) {
                    if (!entry.hadRecentInput) {
                        ZonkeTelemetry.metrics.cls += entry.value;
                    }
                }
            }).observe({ type: 'layout-shift', buffered: true });
        } catch(e) {}

        // Measure INP (Interaction to Next Paint / FID)
        try {
            new PerformanceObserver((entryList) => {
                const entries = entryList.getEntries();
                if (entries.length > 0) {
                    ZonkeTelemetry.metrics.inp = entries[entries.length - 1].duration;
                }
            }).observe({ type: 'first-input', buffered: true });
        } catch(e) {}

        // Report performance metrics every 60 seconds:
        setInterval(() => this.reportPerformance(), 60000);
    }
};

// Trap global critical errors automatically:
window.onerror = function(message, source, lineno, colno, error) {
    ZonkeTelemetry.logEvent("CRITICAL_ALERT", `Uncaught Error: ${message} (${source}:${lineno})`, "critical");
    return false;
};

/* ==========================================================================
   DUAL PLAYER TIME TRACKING (`time taken by two players`) & GUIDED TOUR
   ========================================================================== */
function formatTime(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateTimerDisplay() {
    const badge = document.getElementById('timer-badge');
    if (badge) {
        badge.innerHTML = `<span>⏱️ P1:${formatTime(p1Seconds)}|P2:${formatTime(p2Seconds)}</span>`;
    }
}

function startTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!isPaused && !gameOver && !isTourActive && (phase === 'IDLE' || phase === 'MOVING' || phase === 'SNAPPING' || phase === 'LANDED' || phase === 'RETURNING')) {
            if (currentPlayer === 1) p1Seconds++;
            else p2Seconds++;
            updateTimerDisplay();
        }
    }, 1000);
}

const TOUR_STEPS = [
    {
        badge: "STEP 1 OF 6",
        title: "👋 WELCOME TO ZONKE TACTICAL DUEL!",
        text: "On the LEFT (`Player 1 ->`) is your 9-Soldier Army. Your goal is to flick the ball and unlock all 12 stages on each row (`Head -> Torso -> Gun -> 5 Bullets`) first!",
        selector: "#player1-zone"
    },
    {
        badge: "STEP 2 OF 6",
        title: "🎯 9 TARGET BULLSEYES",
        text: "In the MIDDLE are the 9 Target Rows (`🎯`). The 14x14px ball has plenty of room to land. When the ball snaps onto a row, it adds +1 stage to your soldier on that row!",
        selector: "#target-rows-container"
    },
    {
        badge: "STEP 3 OF 6",
        title: "⭐ THE CENTER BONUS JACKPOT",
        text: "Look right at the middle line between Row 6 and Row 7! This is the `--⭕-- BONUS +1` target! Land here to upgrade ALL your surviving soldiers by +1 stage instantly!",
        selector: ".floating-bonus-badge"
    },
    {
        badge: "STEP 4 OF 6",
        title: "🎯 POWER FOCUS & AIM ZONE GEAR",
        text: "Down here is your Launch Cradle & Power Bar! Click `[🎯 FULL]` or press Key [A]/[Z] anytime to lock your Aim Gear (`📉 BOTTOM 5-40%`, `🎯 MID 35-70%`, or `📈 TOP 65-100%`) so the bar sweeps right where your soldiers need it!",
        selector: "#launch-pad-area"
    },
    {
        badge: "STEP 5 OF 6",
        title: "⚡ ONE-TIME SPECIAL AMMO",
        text: "Need to snipe a difficult row? Arm `🍬 STICKY (1)` for zero wall bounce that sticks on contact! Or arm `🪙 REVIVE (1)` to resurrect a dead soldier (`-1`) back to life!",
        selector: ".controls-row"
    },
    {
        badge: "STEP 6 OF 6",
        title: "🔥 SHOOT 1st OR DIE (`💀 vs 🐐`)",
        text: "On the RIGHT is Player 2 (`<-`). Remember: whoever completes Stage 12 on a row FIRST fires and kills (`💀 DEAD`) the opponent's soldier on that row! First to 5 GOATs wins!",
        selector: "#player2-zone"
    }
];

function startGuidedTour() {
    isTourActive = true;
    currentTourStep = 1;
    const tourOverlay = document.getElementById('onboarding-tour-overlay');
    if (tourOverlay) tourOverlay.classList.add('active');
    renderTourStep();
}

function renderTourStep() {
    document.querySelectorAll('.tour-highlight-box').forEach(el => el.classList.remove('tour-highlight-box'));

    const stepData = TOUR_STEPS[currentTourStep - 1];
    if (!stepData) {
        skipGuidedTour();
        return;
    }

    const badge = document.getElementById('tour-step-badge');
    const title = document.getElementById('tour-dialog-title');
    const text = document.getElementById('tour-dialog-text');
    const nextBtn = document.getElementById('btn-next-tour');

    if (badge) badge.textContent = stepData.badge;
    if (title) title.textContent = stepData.title;
    if (text) text.textContent = stepData.text;
    if (nextBtn) nextBtn.textContent = currentTourStep === 6 ? "FINISH TOUR & DUEL! ➔" : "NEXT STEP ➔";

    const targetEl = document.querySelector(stepData.selector);
    if (targetEl) {
        targetEl.classList.add('tour-highlight-box');
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    positionTourCard(currentTourStep);
}

function positionTourCard(stepIdx) {
    const card = document.getElementById('tour-dialog-card');
    if (!card) return;

    card.style.top = 'auto';
    card.style.bottom = 'auto';
    card.style.left = 'auto';
    card.style.right = 'auto';
    card.style.transform = 'none';

    if (stepIdx === 1) {
        card.style.left = '34%';
        card.style.top = '22%';
    } else if (stepIdx === 2) {
        card.style.left = '50%';
        card.style.bottom = '12px';
        card.style.transform = 'translateX(-50%)';
    } else if (stepIdx === 3) {
        card.style.left = '50%';
        card.style.top = '14px';
        card.style.transform = 'translateX(-50%)';
    } else if (stepIdx === 4 || stepIdx === 5) {
        card.style.left = '50%';
        card.style.top = '16px';
        card.style.transform = 'translateX(-50%)';
    } else if (stepIdx === 6) {
        card.style.left = '5%';
        card.style.top = '22%';
    }
}

function nextTourStep() {
    if (currentTourStep >= 6) {
        skipGuidedTour();
    } else {
        currentTourStep++;
        renderTourStep();
    }
}

function skipGuidedTour() {
    isTourActive = false;
    document.querySelectorAll('.tour-highlight-box').forEach(el => el.classList.remove('tour-highlight-box'));
    const tourOverlay = document.getElementById('onboarding-tour-overlay');
    if (tourOverlay) tourOverlay.classList.remove('active');
    try {
        localStorage.setItem('zonke_tour_completed', 'true');
    } catch(e) {}
    statusBox.textContent = `Guided Tour completed! Player 1's turn—aim from the Launch Pad and click FLICK! 🚀`;
    triggerNdiso(`Sho! Tour complete! Now show the arena your precision paper-flicking dominance! 🚀`);
}

/* ==========================================================================
   INITIALIZATION & DOM BUILDER
   ========================================================================== */
function init() {
    ball.el = document.getElementById('paper-ball');
    p1Wrapper = document.getElementById('p1-rows-wrapper');
    p2Wrapper = document.getElementById('p2-rows-wrapper');
    middleBoard = document.getElementById('middle-board');
    targetRowsContainer = document.getElementById('target-rows-container');
    launchPadArea = document.getElementById('launch-pad-area');
    powerFill = document.getElementById('power-bar-fill');
    powerMarker = document.getElementById('power-bar-marker');
    turnBadge = document.getElementById('turn-badge');
    statusBox = document.getElementById('status-box');
    if (statusBox) {
        statusBox.style.setProperty('display', 'none', 'important');
        let _statusText = '';
        Object.defineProperty(statusBox, 'textContent', {
            get: function() { return _statusText; },
            set: function(val) { _statusText = val; },
            configurable: true
        });
    }
    p1ScoreLbl = document.getElementById('p1-score-lbl');
    p2ScoreLbl = document.getElementById('p2-score-lbl');
    btnFlick = document.getElementById('btn-flick');
    btnClear = document.getElementById('btn-clear');
    btnSticky = document.getElementById('btn-sticky');
    btnFoil = document.getElementById('btn-foil');
    btnAimGear = document.getElementById('btn-aim-gear');
    if (btnAimGear) btnAimGear.addEventListener('click', cycleAimGear);
    updateAimGearUI();
    windBadge = document.getElementById('wind-badge');
    updateWind();
    const cradleEl = document.getElementById('launch-pad-cradle') || document.querySelector('.launch-pad-cradle');
    const powerEl = document.getElementById('power-bar-container') || document.querySelector('.power-bar-container');
    if (cradleEl) cradleEl.addEventListener('click', () => swapLaunchSide());
    if (powerEl) powerEl.addEventListener('click', () => swapLaunchSide());
    btnSoundQuick = document.getElementById('btn-sound-quick');
    btnHapticsQuick = document.getElementById('btn-haptics-quick');
    btnHapticsMenu = document.getElementById('btn-haptics-menu');
    btnPauseQuick = document.getElementById('btn-pause-quick');
    pauseOverlay = document.getElementById('pause-overlay');
    btnResumeModal = document.getElementById('btn-resume-modal');
    btnRulesPause = document.getElementById('btn-rules-pause');
    if (btnPauseQuick) btnPauseQuick.addEventListener('click', togglePauseGame);
    if (btnResumeModal) btnResumeModal.addEventListener('click', togglePauseGame);
    if (btnRulesPause) btnRulesPause.addEventListener('click', () => {
        if (pauseOverlay) pauseOverlay.classList.remove('active');
        if (rulesModal) rulesModal.classList.add('active');
    });
    btnMenu = document.getElementById('btn-menu');
    menuModal = document.getElementById('menu-modal');
    btnCloseMenu = document.getElementById('btn-close-menu');
    btnNewMenu = document.getElementById('btn-new-menu');
    btnRulesMenu = document.getElementById('btn-rules-menu');
    btnSoundMenu = document.getElementById('btn-sound-menu');
    btnCloseRules = document.getElementById('btn-close-rules');
    btnPlayAgain = document.getElementById('btn-play-again');
    rulesModal = document.getElementById('rules-modal');
    winModal = document.getElementById('win-modal');

    buildSoldierBoxes(p1Wrapper, 'p1', currentOutfit);
    buildSoldierBoxes(p2Wrapper, 'p2', currentOutfit);
    buildBoardRows();

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    window.addEventListener('load', updateDimensions);

    resetBallToLaunch();
    updateScores();
    updateTimerDisplay();
    loadProfile();
    updatePlayerFooterUI();
    ZonkeTelemetry.init(); // Initialize App Observability & Telemetry loops
    startTimerLoop();
    setupSocketClient();
    setupEventListeners();

    // Check if player joined via Direct Invite Link (`?room=DUEL-...`)
    try {
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const inviteRoom = urlParams ? urlParams.get('room') : null;
        if (inviteRoom) {
            isOnlineMode = true;
            if (!socket) setupSocketClient();
            const checkSock = setInterval(() => {
                if (socket && socket.connected) {
                    clearInterval(checkSock);
                    socket.emit('join_invite_room', { roomCode: inviteRoom, name: myProfile.username, avatar: myProfile.avatar, rank: getRankInfo(myProfile.xp) });
                }
            }, 300);
        }
    } catch(e) {}

    // Check if 1st time for player (`make tour around the screen if 1st time for player`)
    try {
        if (!localStorage.getItem('zonke_tour_completed')) {
            setTimeout(startGuidedTour, 900);
        }
    } catch(e) {}

    requestAnimationFrame(gameLoop);
}

function buildSoldierBoxes(wrapperEl, prefix, outfitStyle, gunType) {
    if (!wrapperEl) return;
    const progressArray = prefix === 'p1' ? player1Rows : player2Rows;
    wrapperEl.querySelectorAll('.soldier-box, .zone-bonus-divider').forEach(el => el.remove());

    const strokeColor = 'var(--ink-black)';
    const bulletColor = prefix === 'p1' ? 'var(--p1-blue-border)' : 'var(--p2-red-border)';

    for (let i = 0; i < TOTAL_ROWS; i++) {
        const box = createSingleSoldierBox(prefix, i, strokeColor, bulletColor, outfitStyle, gunType || currentGun);
        wrapperEl.appendChild(box);
        applyBoxProgressState(box, progressArray[i]);
    }
}

function applyBoxProgressState(boxEl, progressVal) {
    if (!boxEl) return;
    if (progressVal === -1) {
        boxEl.classList.add('dead-soldier');
        return;
    }
    for (let s = 1; s <= progressVal; s++) {
        const partEl = boxEl.querySelector(`.stage-${s}`);
        if (partEl) partEl.classList.add('show');
    }
    if (progressVal === 12) {
        boxEl.classList.add('completed-soldier');
    }
}

/* ==========================================================================
   10 PUBG GUNS SILHOUETTE GENERATOR (NO SNIPERS!)
   ========================================================================== */
function getPubgGunPath(gunType, isP1, strokeColor) {
    if (!gunType) gunType = 'akm';
    if (isP1) {
        if (gunType === 'akm') return `<path class="part stage-7 gun" d="M 50 39 L 77 39 L 77 36 L 50 36 Z M 57 39 L 61 48 L 56 48 Z M 65 39 Q 68 47 65 48 L 61 48 Q 64 43 61 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'm416') return `<path class="part stage-7 gun" d="M 48 39 L 78 39 L 78 36 L 48 36 Z M 55 39 L 53 47 L 57 47 Z M 64 39 L 66 47 L 62 47 Z M 69 39 L 70 44 L 68 44 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'scarl') return `<path class="part stage-7 gun" d="M 48 38 L 77 38 L 77 35 L 48 35 Z M 55 38 L 53 46 L 57 46 Z M 64 38 L 65 46 L 61 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'beryl') return `<path class="part stage-7 gun" d="M 48 39 L 77 39 L 77 36 L 48 36 Z M 56 39 L 54 48 L 58 48 Z M 64 39 Q 67 48 64 49 L 60 49 Q 63 43 60 39 Z M 70 39 L 70 46 L 68 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'groza') return `<path class="part stage-7 gun" d="M 50 38 L 75 38 L 75 35 L 50 35 Z M 55 38 Q 57 47 54 48 L 50 48 Q 53 43 50 38 Z M 63 38 L 61 46 L 65 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'aug') return `<path class="part stage-7 gun" d="M 48 38 L 76 38 L 76 35 L 48 35 Z M 54 35 L 66 35 L 66 33 L 54 33 Z M 54 38 L 52 46 L 56 46 Z M 64 38 L 62 46 L 66 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'ump45') return `<path class="part stage-7 gun" d="M 50 39 L 74 39 L 74 36 L 50 36 Z M 56 39 L 54 47 L 58 47 Z M 63 39 L 63 48 L 60 48 L 60 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'vector') return `<path class="part stage-7 gun" d="M 50 39 L 73 39 L 73 36 L 50 36 Z M 56 39 L 54 47 L 58 47 Z M 61 39 L 57 48 L 60 48 L 64 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'tommy') return `<path class="part stage-7 gun" d="M 48 39 L 75 39 L 75 36 L 48 36 Z M 55 39 L 53 47 L 57 47 Z M 63 43 A 4.5 4.5 0 1 1 63 43.1 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 's12k') return `<path class="part stage-7 gun" d="M 48 39 L 78 40 L 78 36 L 48 36 Z M 56 39 L 54 48 L 58 48 Z M 65 39 L 65 48 L 61 48 L 61 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        return `<path class="part stage-7 gun" d="M 50 39 L 77 39 L 77 36 L 50 36 Z M 57 39 L 61 48 L 56 48 Z M 65 39 Q 68 47 65 48 L 61 48 Q 64 43 61 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
    } else {
        if (gunType === 'akm') return `<path class="part stage-7 gun" d="M 110 39 L 83 39 L 83 36 L 110 36 Z M 103 39 L 99 48 L 104 48 Z M 95 39 Q 92 47 95 48 L 99 48 Q 96 43 99 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'm416') return `<path class="part stage-7 gun" d="M 112 39 L 82 39 L 82 36 L 112 36 Z M 105 39 L 107 47 L 103 47 Z M 96 39 L 94 47 L 98 47 Z M 91 39 L 90 44 L 92 44 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'scarl') return `<path class="part stage-7 gun" d="M 112 38 L 83 38 L 83 35 L 112 35 Z M 105 38 L 107 46 L 103 46 Z M 96 38 L 95 46 L 99 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'beryl') return `<path class="part stage-7 gun" d="M 112 39 L 83 39 L 83 36 L 112 36 Z M 104 39 L 106 48 L 102 48 Z M 96 39 Q 93 48 96 49 L 100 49 Q 97 43 100 39 Z M 90 39 L 90 46 L 92 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'groza') return `<path class="part stage-7 gun" d="M 110 38 L 85 38 L 85 35 L 110 35 Z M 105 38 Q 103 47 106 48 L 110 48 Q 107 43 110 38 Z M 97 38 L 99 46 L 95 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'aug') return `<path class="part stage-7 gun" d="M 112 38 L 84 38 L 84 35 L 112 35 Z M 106 35 L 94 35 L 94 33 L 106 33 Z M 106 38 L 108 46 L 104 46 Z M 96 38 L 98 46 L 94 46 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'ump45') return `<path class="part stage-7 gun" d="M 110 39 L 86 39 L 86 36 L 110 36 Z M 104 39 L 106 47 L 102 47 Z M 97 39 L 97 48 L 100 48 L 100 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'vector') return `<path class="part stage-7 gun" d="M 110 39 L 87 39 L 87 36 L 110 36 Z M 105 39 L 107 47 L 103 47 Z M 99 39 L 103 48 L 100 48 L 96 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 'tommy') return `<path class="part stage-7 gun" d="M 112 39 L 85 39 L 85 36 L 112 36 Z M 105 39 L 107 47 L 103 47 Z M 97 43 A 4.5 4.5 0 1 1 97 43.1 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        if (gunType === 's12k') return `<path class="part stage-7 gun" d="M 112 39 L 82 40 L 82 36 L 112 36 Z M 104 39 L 106 48 L 102 48 Z M 95 39 L 95 48 L 99 48 L 99 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
        return `<path class="part stage-7 gun" d="M 110 39 L 83 39 L 83 36 L 110 36 Z M 103 39 L 99 48 L 104 48 Z M 95 39 Q 92 47 95 48 L 99 48 Q 96 43 99 39 Z" stroke="${strokeColor}" stroke-width="2" fill="none" />`;
    }
}

/* ==========================================================================
   MINI MILITIA / DOODLE ARMY 2 CHIBI TACTICAL CHARACTER ART (`chubby filled tactical characters + 10 PUBG guns`)
   ========================================================================== */
function createSingleSoldierBox(prefix, index, strokeColor, bulletColor, outfitStyle, gunType) {
    const box = document.createElement('div');
    box.className = 'soldier-box';
    box.id = `${prefix}-box-${index}`;

    const isP1 = prefix === 'p1';
    // Cropped viewBox (width 72, height 76) eliminates 50% empty space so the character draws 2x larger inside the cell!
    const vb = isP1 ? "12 2 68 76" : "96 2 68 76";
    const cx = isP1 ? 34 : 126;
    const armX1 = isP1 ? 20 : 106;
    const armX2 = isP1 ? 52 : 140;
    const hipX1 = isP1 ? 26 : 116;
    const hipX2 = isP1 ? 42 : 134;
    const legL_X = isP1 ? 22 : 112;
    const legR_X = isP1 ? 46 : 138;
    const legTopL_X = isP1 ? 30 : 120;
    const legTopR_X = isP1 ? 38 : 130;

    let outfitPaths = '';

    if (outfitStyle === 'outfit-gangstar') {
        // STYLE B: MINI MILITIA STREET GANGSTAR (Chibi filled head, Street Sunglasses, Snapback Cap, Hoodie Vest, High-Top Sneakers)
        outfitPaths = `
            <g class="part stage-1">
                <circle cx="${cx}" cy="16" r="8.5" fill="#d7ccc8" stroke="${strokeColor}" stroke-width="2" />
                <!-- Street Sunglasses -->
                <rect x="${isP1 ? cx-3 : cx-6}" y="14" width="9" height="3" rx="1.5" fill="#1a1a1a" />
            </g>
            <path class="part stage-2 neck" d="${isP1 ? `M ${cx-8} 10 L ${cx+8} 13 L ${cx+11} 10 Z` : `M ${cx+8} 10 L ${cx-8} 13 L ${cx-11} 10 Z`}" fill="#c0392b" stroke="${strokeColor}" stroke-width="1.8" />
            <path class="part stage-3 body" d="M ${cx-8} 28 L ${cx+8} 28 L ${cx+6} 51 L ${cx-6} 51 Z" fill="#2c3e50" stroke="${strokeColor}" stroke-width="2" />
            <path class="part stage-4 arms" d="M ${armX1} 38 L ${armX2} 38 L ${armX2} 43 L ${armX1} 43 Z" fill="#d7ccc8" stroke="${strokeColor}" stroke-width="1.8" />
            <rect class="part stage-5 lower-body" x="${hipX1}" y="50" width="${hipX2 - hipX1}" height="4" rx="2" fill="#1565c0" stroke="${strokeColor}" stroke-width="1.5" />
            <g class="part stage-6">
                <path d="M ${legTopL_X-3} 54 L ${legTopL_X+3} 54 L ${legL_X+3} 72 L ${legL_X-3} 72 Z M ${legTopR_X-3} 54 L ${legTopR_X+3} 54 L ${legR_X+3} 72 L ${legR_X-3} 72 Z" fill="#1565c0" stroke="${strokeColor}" stroke-width="1.8" />
                <!-- Street High-Top Sneakers -->
                <path d="M ${isP1 ? legL_X-4 : legL_X-2} 71 L ${isP1 ? legL_X+5 : legL_X+3} 71 L ${isP1 ? legL_X+5 : legL_X+3} 74 L ${isP1 ? legL_X-4 : legL_X-2} 74 Z M ${isP1 ? legR_X-4 : legR_X-2} 71 L ${isP1 ? legR_X+5 : legR_X+3} 71 L ${isP1 ? legR_X+5 : legR_X+3} 74 L ${isP1 ? legR_X-4 : legR_X-2} 74 Z" fill="#ffffff" stroke="#c0392b" stroke-width="1.8" />
            </g>
        `;
    } else if (outfitStyle === 'outfit-pilot') {
        // STYLE C: MINI MILITIA SPACE PILOT (Chibi head, Astronaut Visor Helmet, Cyber Armor, Mag-Boots)
        outfitPaths = `
            <g class="part stage-1">
                <circle cx="${cx}" cy="16" r="9.5" fill="#eceff1" stroke="${strokeColor}" stroke-width="2" />
                <path d="${isP1 ? `M ${cx-2} 11 Q ${cx+7} 16 ${cx-2} 21 Z` : `M ${cx+2} 11 Q ${cx-7} 16 ${cx+2} 21 Z`}" fill="rgba(0,229,255,0.4)" stroke="#00e5ff" stroke-width="1.8" />
            </g>
            <line class="part stage-2 neck" x1="${cx}" y1="25" x2="${cx}" y2="30" stroke="#00e5ff" stroke-width="4" stroke-linecap="round" />
            <path class="part stage-3 body" d="M ${cx-9} 29 L ${cx+9} 29 L ${cx+7} 51 L ${cx-7} 51 Z" fill="#eceff1" stroke="${strokeColor}" stroke-width="2" />
            <path class="part stage-4 arms" d="M ${armX1} 38 L ${armX2} 38 L ${armX2} 43 L ${armX1} 43 Z" fill="#b0bec5" stroke="${strokeColor}" stroke-width="1.8" />
            <rect class="part stage-5 lower-body" x="${hipX1}" y="50" width="${hipX2 - hipX1}" height="4" rx="2" fill="#00bcd4" stroke="${strokeColor}" stroke-width="1.5" />
            <g class="part stage-6">
                <path d="M ${legTopL_X-3} 54 L ${legTopL_X+3} 54 L ${legL_X+3} 72 L ${legL_X-3} 72 Z M ${legTopR_X-3} 54 L ${legTopR_X+3} 54 L ${legR_X+3} 72 L ${legR_X-3} 72 Z" fill="#eceff1" stroke="${strokeColor}" stroke-width="1.8" />
                <!-- Mag-Boots -->
                <path d="M ${legL_X-4} 71 L ${legL_X+4} 71 L ${legL_X+4} 75 L ${legL_X-4} 75 Z M ${legR_X-4} 71 L ${legR_X+4} 71 L ${legR_X+4} 75 L ${legR_X-4} 75 Z" fill="#263238" stroke="#00e5ff" stroke-width="1.8" />
            </g>
        `;
    } else if (outfitStyle === 'outfit-skeleton') {
        // STYLE D: MINI MILITIA UNDEAD SKELETON WARRIOR (Chibi Bone Skull, Hollow Eyes/Teeth, Ribcage Armor, Bone Feet)
        outfitPaths = `
            <g class="part stage-1">
                <circle cx="${cx}" cy="16" r="8.8" fill="#fff9c4" stroke="${strokeColor}" stroke-width="2" />
                <circle cx="${isP1 ? cx+3 : cx-3}" cy="15" r="2.2" fill="#d32f2f" />
                <path d="M ${cx-4} 21 L ${cx+4} 21 M ${cx-2} 21 L ${cx-2} 23 M ${cx} 21 L ${cx} 23 M ${cx+2} 21 L ${cx+2} 23" stroke="${strokeColor}" stroke-width="1.5" />
            </g>
            <line class="part stage-2 neck" x1="${cx}" y1="24" x2="${cx}" y2="30" stroke="#fff9c4" stroke-width="3" stroke-linecap="round" />
            <path class="part stage-3 body" d="M ${cx-7} 29 Q ${cx} 32 ${cx+7} 29 L ${cx+6} 51 L ${cx-6} 51 Z" fill="#3e2723" stroke="${strokeColor}" stroke-width="2" />
            <path class="part stage-4 arms" d="M ${armX1} 39 L ${armX2} 39 L ${armX2} 42 L ${armX1} 42 Z" fill="#fff9c4" stroke="${strokeColor}" stroke-width="1.8" />
            <rect class="part stage-5 lower-body" x="${hipX1}" y="50" width="${hipX2 - hipX1}" height="4" rx="2" fill="#fff9c4" stroke="${strokeColor}" stroke-width="1.5" />
            <g class="part stage-6">
                <path d="M ${legTopL_X-2} 54 L ${legTopL_X+2} 54 L ${legL_X+2} 72 L ${legL_X-2} 72 Z M ${legTopR_X-2} 54 L ${legTopR_X+2} 54 L ${legR_X+2} 72 L ${legR_X-2} 72 Z" fill="#fff9c4" stroke="${strokeColor}" stroke-width="1.8" />
                <!-- Bone Claws -->
                <path d="M ${legL_X-4} 72 L ${legL_X+4} 72 M ${legR_X-4} 72 L ${legR_X+4} 72" stroke="#fff9c4" stroke-width="3" stroke-linecap="round" />
            </g>
        `;
    } else {
        // STYLE A: MINI MILITIA COMBAT SOLDIER (Default: Chibi filled head, Tactical Combat Helmet, Armor Vest, Combat Boots)
        outfitPaths = `
            <g class="part stage-1">
                <circle cx="${cx}" cy="16" r="8.5" fill="#e0ac69" stroke="${strokeColor}" stroke-width="2" />
                <!-- Tactical Goggles -->
                <rect x="${isP1 ? cx-2 : cx-6}" y="14" width="8" height="3" rx="1.5" fill="#2e7d32" />
            </g>
            <path class="part stage-2 neck" d="${isP1 ? `M ${cx-9} 9 Q ${cx} 6 ${cx+9} 9 L ${cx+9} 14 L ${cx-9} 14 Z` : `M ${cx-9} 9 Q ${cx} 6 ${cx+9} 9 L ${cx+9} 14 L ${cx-9} 14 Z`}" fill="#2e7d32" stroke="${strokeColor}" stroke-width="1.8" />
            <path class="part stage-3 body" d="M ${cx-8} 28 L ${cx+8} 28 L ${cx+7} 51 L ${cx-7} 51 Z" fill="#33691e" stroke="${strokeColor}" stroke-width="2" />
            <path class="part stage-4 arms" d="M ${armX1} 38 L ${armX2} 38 L ${armX2} 43 L ${armX1} 43 Z" fill="#33691e" stroke="${strokeColor}" stroke-width="1.8" />
            <rect class="part stage-5 lower-body" x="${hipX1}" y="50" width="${hipX2 - hipX1}" height="4" rx="2" fill="#1a1a1a" stroke="${strokeColor}" stroke-width="1.5" />
            <g class="part stage-6">
                <path d="M ${legTopL_X-3} 54 L ${legTopL_X+3} 54 L ${legL_X+3} 72 L ${legL_X-3} 72 Z M ${legTopR_X-3} 54 L ${legTopR_X+3} 54 L ${legR_X+3} 72 L ${legR_X-3} 72 Z" fill="#2e7d32" stroke="${strokeColor}" stroke-width="1.8" />
                <!-- Combat Boots -->
                <path d="M ${isP1 ? legL_X-4 : legL_X-2} 71 L ${isP1 ? legL_X+5 : legL_X+3} 71 L ${isP1 ? legL_X+5 : legL_X+3} 75 L ${isP1 ? legL_X-4 : legL_X-2} 75 Z M ${isP1 ? legR_X-4 : legR_X-2} 71 L ${isP1 ? legR_X+5 : legR_X+3} 71 L ${isP1 ? legR_X+5 : legR_X+3} 75 L ${isP1 ? legR_X-4 : legR_X-2} 75 Z" fill="#1a1a1a" stroke="${strokeColor}" stroke-width="1.8" />
            </g>
        `;
    }

    const gunElem = getPubgGunPath(gunType, isP1, strokeColor);

    const bulletsPath = isP1
        ? `
            <circle class="part stage-8 bullet" cx="87" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-9 bullet" cx="100" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-10 bullet" cx="113" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-11 bullet" cx="126" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-12 bullet" cx="139" cy="39" r="2.8" fill="${bulletColor}" />
        `
        : `
            <circle class="part stage-8 bullet" cx="73" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-9 bullet" cx="60" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-10 bullet" cx="47" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-11 bullet" cx="34" cy="39" r="2.8" fill="${bulletColor}" />
            <circle class="part stage-12 bullet" cx="21" cy="39" r="2.8" fill="${bulletColor}" />
        `;

    box.innerHTML = `
        <svg class="soldier-svg" viewBox="${vb}">
            ${outfitPaths}
            ${gunElem}
            ${bulletsPath}
        </svg>
    `;
    return box;
}

function buildBoardRows() {
    if (!targetRowsContainer) return;
    targetRowsContainer.querySelectorAll('.board-row, .floating-bonus-badge').forEach(r => r.remove());

    // Exactly 12 target rows aligning 1-to-1 with Box 0..11, without `ROW 1..12` text ("remove those words row1-12")!
    for (let r = 0; r < TOTAL_ROWS; r++) {
        const row = document.createElement('div');
        row.className = 'board-row';
        row.id = `board-row-${r}`;
        row.innerHTML = `<span class="target-icon">🎯</span>`;
        targetRowsContainer.appendChild(row);
    }

    const floatingBadge = document.createElement('div');
    floatingBadge.className = 'floating-bonus-badge';
    floatingBadge.innerHTML = `<span style="font-size: 13px; line-height: 1;">⭕</span><span style="font-size: 8px; font-weight: 900;">+1</span>`;
    targetRowsContainer.appendChild(floatingBadge);
}

function updateDimensions() {
    if (!middleBoard) return;
    boardRect = {
        width: middleBoard.clientWidth || 480,
        height: middleBoard.clientHeight || 514
    };
    targetAreaHeight = targetRowsContainer ? targetRowsContainer.clientHeight : (boardRect.height - 74);
    const padHeight = launchPadArea ? launchPadArea.clientHeight : 60;
    launchPadCenterY = boardRect.height - (padHeight / 2);

    if (phase === 'IDLE') {
        resetBallToLaunch();
    }
}

function swapLaunchSide(forceSide = null) {
    if (isPaused && !forceSide) return;
    if (phase !== 'IDLE' && !forceSide) return;
    if (isOnlineMode && !forceSide && currentPlayer !== onlineRole) return;

    if (forceSide === 'LEFT' || forceSide === 'RIGHT') {
        if (launchSide === forceSide) return; // already on that side
        launchSide = forceSide;
    } else {
        launchSide = launchSide === 'LEFT' ? 'RIGHT' : 'LEFT';
    }

    const cradle = document.getElementById('launch-pad-cradle') || document.querySelector('.launch-pad-cradle');
    const powerBox = document.getElementById('power-bar-container') || document.querySelector('.power-bar-container');

    if (cradle && powerBox) {
        if (launchSide === 'RIGHT') {
            cradle.style.order = '2';
            powerBox.style.order = '1';
            cradle.classList.add('side-right');
            cradle.innerHTML = `⇄ 🏀`;
        } else {
            cradle.style.order = '1';
            powerBox.style.order = '2';
            cradle.classList.remove('side-right');
            cradle.innerHTML = `🏀 ⇄`;
        }
    }

    updateBallToCradleCenter();

    if (!forceSide) {
        playSound('select');
        triggerNdiso(`Sho! Swapped Launch Cradle to the ${launchSide} side to use the air drift for the center bonus! 🌬️🎯`);
    }
}

function updateBallToCradleCenter() {
    const cradle = document.querySelector('.launch-pad-cradle');
    if (cradle && middleBoard && ball.el) {
        const cradleRect = cradle.getBoundingClientRect();
        const boardBoxRect = middleBoard.getBoundingClientRect();
        if (cradleRect.width > 0) {
            ball.x = (cradleRect.left - boardBoxRect.left) + (cradleRect.width / 2) - ball.radius;
            ball.y = (cradleRect.top - boardBoxRect.top) + (cradleRect.height / 2) - ball.radius;
            updateBallVisual();
            return;
        }
    }
    ball.x = (boardRect.width / 3) - ball.radius;
    ball.y = launchPadCenterY - ball.radius;
    updateBallVisual();
}

function resetBallToLaunch() {
    if (isPaused) return;
    ball.vy = 0;
    ball.vRot = 0;
    ball.bounceCount = 0;
    ball.capturedByBonus = false;
    ball.targetBoardRowIndex = -1;
    updateBallToCradleCenter();
}

/* ==========================================================================
   MAIN GAME HEARTBEAT (60fps requestAnimationFrame)
   ========================================================================== */
function togglePauseGame() {
    if (gameOver || phase === 'SNAPPING') return;
    isPaused = !isPaused;

    const btnP = btnPauseQuick || document.getElementById('btn-pause-quick');
    const overlay = pauseOverlay || document.getElementById('pause-overlay');

    if (isPaused) {
        if (btnP) {
            btnP.innerHTML = `<span>▶️ RESUME</span>`;
            btnP.classList.add('paused');
        }
        if (overlay) overlay.classList.add('active');
        playSound('select');
        triggerNdiso(`Sho! Match paused! Take a breather or check your strategy! ⏸️`);
    } else {
        if (btnP) {
            btnP.innerHTML = `<span>⏸️ PAUSE</span>`;
            btnP.classList.remove('paused');
        }
        if (overlay) overlay.classList.remove('active');
        playSound('select');
        triggerNdiso(`Match resumed! Back to the action! 🚀`);
    }
}

function gameLoop() {
    if (!gameOver && !isPaused) {
        if (phase === 'IDLE') {
            updatePowerBar();
            if (ball.el && middleBoard && middleBoard.clientWidth > 0 && middleBoard.clientHeight > 0) {
                boardRect.width = middleBoard.clientWidth;
                boardRect.height = middleBoard.clientHeight;
                targetAreaHeight = targetRowsContainer.clientHeight || (boardRect.height - 74);
                updateBallToCradleCenter();
            }
        } else if (phase === 'MOVING') {
            updatePhysics();
        } else if (phase === 'SNAPPING') {
            updateSnapping();
        } else if (phase === 'LANDED') {
            updateHoverLanded();
        } else if (phase === 'RETURNING') {
            updateReturning();
        }
    }
    requestAnimationFrame(gameLoop);
}

function getActiveAimGear() {
    return currentPlayer === 1 ? p1AimGear : p2AimGear;
}

function getActiveAimBounds() {
    const gear = getActiveAimGear();
    if (gear === 'LOW') {
        return { speed: 1.25, label: 'PWR (LOW 🟢)', rgb: 'G', className: 'speed-low', fillClass: 'fill-low', glowClass: 'glow-low', desc: 'Slow precision speed across full bar! Perfect when you need exact time to cover bottom soldiers!' };
    } else if (gear === 'HIGH') {
        return { speed: 3.8, label: 'PWR (HIGH 🔴)', rgb: 'R', className: 'speed-high', fillClass: 'fill-high', glowClass: 'glow-high', desc: 'Rapid acceleration across full bar! Whips fast for high ceiling ricochets!' };
    }
    return { speed: 2.3, label: 'PWR (MID 🔵)', rgb: 'B', className: 'speed-mid', fillClass: 'fill-mid', glowClass: 'glow-mid', desc: 'Balanced medium speed across full bar!' };
}

function cycleAimGear() {
    if (isPaused || phase !== 'IDLE' || gameOver) return;
    if (isOnlineMode && currentPlayer !== onlineRole) return;

    let current = getActiveAimGear();
    const sequence = ['MID', 'LOW', 'HIGH'];
    const nextIdx = (sequence.indexOf(current) + 1) % sequence.length;
    const nextGear = sequence[nextIdx];

    if (currentPlayer === 1) {
        p1AimGear = nextGear;
    } else {
        p2AimGear = nextGear;
    }

    updateAimGearUI();
    const bounds = getActiveAimBounds();

    playSound('select');
}

function updateAimGearUI() {
    const btnGear = document.getElementById('btn-aim-gear') || btnAimGear;
    const powerLabel = document.querySelector('.power-bar-label');
    const powerContainer = document.querySelector('.power-bar-container');
    const bounds = getActiveAimBounds();
    const gear = getActiveAimGear();

    if (btnGear) {
        btnGear.className = `btn-aim-gear ${bounds.className}`;
        let letter = 'M';
        if (gear === 'LOW') letter = 'L';
        else if (gear === 'HIGH') letter = 'H';
        btnGear.innerHTML = `<span>${letter}</span>`;
        btnGear.setAttribute('title', `Active Speed: ${gear} (${bounds.rgb} Color) — ${bounds.desc} (Click or press Key [A] / [Z] anytime!)`);
    }

    if (powerFill) {
        powerFill.className = `power-bar-fill ${bounds.fillClass}`;
    }
    if (powerContainer) {
        powerContainer.classList.remove('glow-low', 'glow-mid', 'glow-high');
        powerContainer.classList.add(bounds.glowClass);
    }

    if (powerLabel) {
        powerLabel.textContent = bounds.label;
    }
}

function updatePowerBar() {
    if (!powerFill || !powerMarker) return;
    const bounds = getActiveAimBounds();

    powerVal += powerDir * bounds.speed;
    if (powerVal >= 100) {
        powerVal = 100;
        powerDir = -1;
    } else if (powerVal <= 0) {
        powerVal = 0;
        powerDir = 1;
    }

    powerFill.style.width = `${powerVal}%`;
    powerMarker.style.left = `${powerVal}%`;
}

function updatePhysics() {
    const gravity = 0.44;
    const damping = activeSpecialShot === 'STICKY' ? 0.12 : 0.82; // Sticky shot has almost zero wall bounce!

    ball.vy += gravity;
    ball.y += ball.vy;
    ball.x += currentWind; // Stoep Wind pushes the ball sideways during flight!
    if (ball.x < 2) ball.x = 2;
    if (ball.x > boardRect.width - (ball.radius * 2) - 2) {
        ball.x = boardRect.width - (ball.radius * 2) - 2;
    }
    ball.rotation += ball.vRot + (currentWind * 2);

    // Top Ceiling Bounce
    if (ball.y < 0) {
        ball.y = 0;
        ball.vy = -ball.vy * (activeSpecialShot === 'STICKY' ? 0.1 : 0.76);
        ball.bounceCount++;
        playSound('bounce');
    }

    const maxBottom = boardRect.height - (ball.radius * 2);
    if (ball.y > maxBottom) {
        ball.y = maxBottom;
        ball.vy = -ball.vy * damping;
        ball.bounceCount++;
        playSound('bounce');
    }

        const topOffset = targetRowsContainer ? targetRowsContainer.offsetTop : 22;
    const isSoftApex = (ball.bounceCount === 0 && ball.vy > -1.5 && ball.vy < 2.2 && ball.y > topOffset + (targetAreaHeight * 0.40));
    const canSnapNormal = ((ball.bounceCount >= 2 && Math.abs(ball.vy) < 4.2) || (ball.bounceCount >= 1 && Math.abs(ball.vy) < 3.2 && ball.vy > -0.5) || isSoftApex);
    const canSnapSticky = activeSpecialShot === 'STICKY' && (ball.bounceCount >= 1 || (ball.vy > -1.5 && Math.abs(ball.vy) < 4.8) || isSoftApex);

    if ((canSnapNormal || canSnapSticky) && ball.y < boardRect.height - 24 && ball.y > 4) {
        const relativeBallY = (ball.y + ball.radius) - topOffset;
        const rowHeight = targetAreaHeight / TOTAL_ROWS;
        let closestRow = Math.floor(relativeBallY / rowHeight);
        if (closestRow < 0) closestRow = 0;
        if (closestRow > TOTAL_ROWS - 1) closestRow = TOTAL_ROWS - 1;

        const ballCenterX = ball.x + ball.radius;
        const ballCenterY = ball.y + ball.radius;
        const bonusCenterX = boardRect.width * 0.50;
        const bonusCenterY = topOffset + (targetAreaHeight * 0.50);
        const distToBonus = Math.hypot(ballCenterX - bonusCenterX, ballCenterY - bonusCenterY);

        // Strict Inside-Circle Check (`"it must only go to inside the circle to get a bonus"`):
        // Only trigger BONUS when the settling ball center is strictly within 30px of the exact circle midpoint (`distToBonus <= 30.0`).
        // If the ball lands anywhere else on Row 5 outside the circle, it cleanly awards normal Row 5 target progression (`closestRow = 4`)!
        if (distToBonus <= 30.0) {
            ball.targetBoardRowIndex = 'BONUS';
        } else {
            ball.targetBoardRowIndex = closestRow;
        }
        phase = 'SNAPPING';
    }

    updateBallVisual();
}

function updateSnapping() {
    const topOffset = targetRowsContainer ? targetRowsContainer.offsetTop : 22;
    let targetBallY;
    if (ball.targetBoardRowIndex === 'BONUS') {
        targetBallY = topOffset + (targetAreaHeight * 0.5) - ball.radius;
        const targetBallX = (boardRect.width * 0.50) - ball.radius;
        const diffX = targetBallX - ball.x;
        ball.x += diffX * 0.24; // Pull directly inside the center circle!
    } else {
        const rowHeight = targetAreaHeight / TOTAL_ROWS;
        const targetCenterY = topOffset + ((ball.targetBoardRowIndex + 0.5) * rowHeight);
        targetBallY = targetCenterY - ball.radius;
    }

    const diff = targetBallY - ball.y;
    ball.vy = (ball.vy * 0.55) + (diff * 0.18);
    ball.y += ball.vy;
    ball.rotation += ball.vRot * 0.35;

    updateBallVisual();

    if (Math.abs(diff) < 1.2 && Math.abs(ball.vy) < 1.2) {
        ball.y = targetBallY;
        updateBallVisual();
        phase = 'LANDED';
        handleLanding(ball.targetBoardRowIndex);
    }
}

function updateHoverLanded() {
    const topOffset = targetRowsContainer ? targetRowsContainer.offsetTop : 22;
    let targetBallY;
    if (ball.targetBoardRowIndex === 'BONUS') {
        targetBallY = topOffset + (targetAreaHeight * 0.5) - ball.radius;
        ball.x = (boardRect.width * 0.50) - ball.radius;
    } else {
        const rowHeight = targetAreaHeight / TOTAL_ROWS;
        const targetCenterY = topOffset + ((ball.targetBoardRowIndex + 0.5) * rowHeight);
        targetBallY = targetCenterY - ball.radius;
    }

    ball.y = targetBallY + Math.sin(Date.now() / 140) * 2.2;
    ball.rotation += 0.6;
    updateBallVisual();
}

function updateReturning() {
    const cradle = document.querySelector('.launch-pad-cradle');
    let startX = (boardRect.width / 3) - ball.radius;
    let startY = launchPadCenterY - ball.radius;
    if (cradle && middleBoard) {
        const cradleRect = cradle.getBoundingClientRect();
        const boardBoxRect = middleBoard.getBoundingClientRect();
        if (cradleRect.width > 0) {
            startX = (cradleRect.left - boardBoxRect.left) + (cradleRect.width / 2) - ball.radius;
            startY = (cradleRect.top - boardBoxRect.top) + (cradleRect.height / 2) - ball.radius;
        }
    }

    const dx = startX - ball.x;
    const dy = startY - ball.y;

    ball.x += dx * 0.15;
    ball.y += dy * 0.15;
    ball.rotation += 14;

    updateBallVisual();

    if (Math.abs(dx) < 1.2 && Math.abs(dy) < 1.2) {
        ball.x = startX;
        ball.y = startY;
        ball.rotation = 0;
        updateBallVisual();
        phase = 'IDLE';
        completeTurnSwitch();
    }
}

function updateRealTimeRowIndicator() {
    if (!targetRowsContainer) return;
    const topOffset = targetRowsContainer.offsetTop || 22;
    const relativeBallY = (ball.y + ball.radius) - topOffset;
    const rowHeight = targetAreaHeight / TOTAL_ROWS;
    let activeRowIdx = Math.floor(relativeBallY / rowHeight);
    if (activeRowIdx < 0) activeRowIdx = 0;
    if (activeRowIdx > TOTAL_ROWS - 1) activeRowIdx = TOTAL_ROWS - 1;

    if (phase === 'IDLE' || phase === 'RETURNING') {
        targetRowsContainer.querySelectorAll('.board-row').forEach(r => r.classList.remove('ball-tracking-row'));
        return;
    }

    targetRowsContainer.querySelectorAll('.board-row').forEach((r, idx) => {
        if (idx === activeRowIdx) {
            if (!r.classList.contains('ball-tracking-row')) {
                r.classList.add('ball-tracking-row');
            }
        } else {
            r.classList.remove('ball-tracking-row');
        }
    });
}

function updateBallVisual() {
    if (!ball.el) return;
    ball.el.style.left = `${ball.x}px`;
    ball.el.style.top = `${ball.y}px`;
    ball.el.style.transform = `rotate(${ball.rotation}deg)`;
    updateRealTimeRowIndicator();
}

/* ==========================================================================
   SOCKET.IO REAL-TIME 1v1 CLIENT ENGINE
   ========================================================================== */
let socket = null;
let isOnlineMode = false;
let onlineRole = 1; // 1 or 2
let onlineRoomId = null;
let opponentProfile = null;

function setupSocketClient() {
    if (typeof io !== 'undefined' && !socket) {
        try {
            const sockUrl = typeof SERVER_API_URL !== 'undefined' ? SERVER_API_URL : 'http://localhost:3000';
            socket = io(sockUrl, { reconnectionAttempts: 3, transports: ['websocket', 'polling'] });
            socket.on('connect', () => {
                const badge = document.getElementById('online-mode-badge');
                if (badge) badge.innerHTML = `<span>🟢 ONLINE READY</span>`;
                if (isOnlineMode && onlineRoomId && onlineRole) {
                    console.log(`[Low Network Reconnect] Automatically rejoining match ${onlineRoomId}...`);
                    socket.emit('reconnect_to_match', {
                        roomId: onlineRoomId,
                        role: onlineRole,
                        name: myProfile.username
                    });
                }
            });
            socket.on('waiting_for_opponent', data => {
                const msg = document.getElementById('online-status-msg');
                if (msg) msg.textContent = data.message;
            });
            socket.on('match_found_broadcast', data => {
                if (!isOnlineMode) return;
                if (window._inviteMaintainInterval) clearInterval(window._inviteMaintainInterval);
                if (window._acceptWatchdog) clearInterval(window._acceptWatchdog);
                const onlineModal = document.getElementById('online-waiting-modal');
                const inviteModal = document.getElementById('invite-accept-modal');
                if ((onlineModal && onlineModal.classList.contains('active')) || (inviteModal && inviteModal.classList.contains('active')) || onlineRoomId === data.roomId) {
                    console.log(`[Online Match Broadcast] Synchronizing match start inside ${data.roomId}`);
                    onlineRoomId = data.roomId;
                    if (onlineModal) onlineModal.classList.remove('active');
                    if (inviteModal) inviteModal.classList.remove('active');
                    if (menuModal) menuModal.classList.remove('active');
                    const role = (inviteModal && inviteModal.classList.contains('active')) ? 2 : (onlineRole || 1);
                    onlineRole = role;
                    opponentProfile = role === 1 ? data.p2Profile : data.p1Profile;
                    startOnlineDuel({
                        roomId: data.roomId,
                        role: role,
                        myProfile: role === 1 ? (data.p1Profile || myProfile) : (data.p2Profile || myProfile),
                        opponentProfile: opponentProfile
                    });
                }
            });
            socket.on('match_found', data => {
                isOnlineMode = true;
                if (window._inviteMaintainInterval) clearInterval(window._inviteMaintainInterval);
                if (window._acceptWatchdog) clearInterval(window._acceptWatchdog);
                onlineRole = data.role;
                onlineRoomId = data.roomId;
                const modal = document.getElementById('online-waiting-modal');
                if (modal) modal.classList.remove('active');
                const inviteModal = document.getElementById('invite-accept-modal');
                if (inviteModal) inviteModal.classList.remove('active');
                if (menuModal) menuModal.classList.remove('active');

                const vsModal = document.getElementById('online-vs-modal');
                if (data.opponentProfile) opponentProfile = data.opponentProfile;
                if (vsModal && data.myProfile && data.opponentProfile) {
                    const myProf = data.myProfile;
                    const oppProf = data.opponentProfile;
                    const p1Prof = onlineRole === 1 ? myProf : oppProf;
                    const p2Prof = onlineRole === 2 ? myProf : oppProf;

                    const p1Av = document.getElementById('vs-p1-avatar');
                    const p1Name = document.getElementById('vs-p1-name');
                    const p1Rank = document.getElementById('vs-p1-rank');
                    const p1Loadout = document.getElementById('vs-p1-loadout');
                    if (p1Av) p1Av.textContent = p1Prof.avatar || "🧢";
                    if (p1Name) p1Name.textContent = p1Prof.username || "Player 1";
                    if (p1Rank) p1Rank.textContent = `${p1Prof.rank || 'Street Novice'} (${p1Prof.wins || 0}W)`;
                    if (p1Loadout) p1Loadout.textContent = `${(p1Prof.gun || 'akm').toUpperCase()} & ${(p1Prof.outfit || 'soldier').replace('outfit-','')}`;

                    const p2Av = document.getElementById('vs-p2-avatar');
                    const p2Name = document.getElementById('vs-p2-name');
                    const p2Rank = document.getElementById('vs-p2-rank');
                    const p2Loadout = document.getElementById('vs-p2-loadout');
                    if (p2Av) p2Av.textContent = p2Prof.avatar || "👨‍🚀";
                    if (p2Name) p2Name.textContent = p2Prof.username || "Player 2";
                    if (p2Rank) p2Rank.textContent = `${p2Prof.rank || 'Street Novice'} (${p2Prof.wins || 0}W)`;
                    if (p2Loadout) p2Loadout.textContent = `${(p2Prof.gun || 'akm').toUpperCase()} & ${(p2Prof.outfit || 'soldier').replace('outfit-','')}`;

                    vsModal.classList.add('active');
                    let countdown = 3;
                    const secSpan = document.getElementById('vs-countdown-sec');
                    const cInt = setInterval(() => {
                        countdown--;
                        if (secSpan) secSpan.textContent = countdown;
                        if (countdown <= 0) {
                            clearInterval(cInt);
                            vsModal.classList.remove('active');
                            startOnlineDuel(data);
                        }
                    }, 1000);
                } else {
                    startOnlineDuel(data);
                }
            });
            socket.on('opponent_flick', data => {
                if (!isOnlineMode) return;
                powerVal = data.power;
                currentWind = data.wind;
                activeSpecialShot = data.specialShot;
                triggerFlick(true); // true means triggered by remote opponent
            });
            socket.on('sync_landing', data => {
                if (!isOnlineMode) return;
                console.log(`[Online Sync] Opponent confirmed landing on Row ${data.rowIdx}`);
                currentWind = data.newWind !== undefined ? data.newWind : currentWind;
            });
            socket.on('opponent_loadout_change', data => {
                if (!isOnlineMode || !data) return;
                const oppPrefix = onlineRole === 1 ? 'p2' : 'p1';
                const oppWrapper = onlineRole === 1 ? p2Wrapper : p1Wrapper;
                buildSoldierBoxes(oppWrapper, oppPrefix, data.outfit, data.gun);
                console.log(`[Online Loadout] Opponent switched to ${data.gun} & ${data.outfit}`);
            });
            socket.on('opponent_disconnected', data => {
                if (!isOnlineMode) return;
                statusBox.textContent = data.message;
                triggerNdiso(`Opponent ran away from the battlefield! You win by forfeit! 🏆`);
                handleVictory(onlineRole);
            });
            socket.on('opponent_network_lag', data => {
                if (!isOnlineMode) return;
                const lagBanner = document.getElementById('network-lag-banner');
                const lagTimer = document.getElementById('lag-timer');
                if (lagBanner) {
                    lagBanner.style.display = 'block';
                    lagBanner.style.background = 'linear-gradient(90deg, #b71c1c, #d32f2f, #b71c1c)';
                    lagBanner.innerHTML = `📶 FRIEND ON LOW NETWORK SIGNAL: Waiting to resume... (<span id="lag-timer">${data.graceSeconds || 45}</span>s)`;
                }
                let left = data.graceSeconds || 45;
                if (window._lagCountdownInterval) clearInterval(window._lagCountdownInterval);
                window._lagCountdownInterval = setInterval(() => {
                    left--;
                    const tEl = document.getElementById('lag-timer');
                    if (tEl) tEl.textContent = left;
                    if (left <= 0) {
                        clearInterval(window._lagCountdownInterval);
                    }
                }, 1000);
            });
            socket.on('match_resumed_from_lag', data => {
                if (!isOnlineMode) return;
                if (window._lagCountdownInterval) clearInterval(window._lagCountdownInterval);
                const lagBanner = document.getElementById('network-lag-banner');
                if (lagBanner) {
                    lagBanner.style.background = 'linear-gradient(90deg, #114b3e, #2ecc71, #114b3e)';
                    lagBanner.innerHTML = `🟢 SIGNAL RESTORED! Friend reconnected. Match resuming synchronously!`;
                    setTimeout(() => { if (lagBanner) lagBanner.style.display = 'none'; }, 2600);
                }
                if (data.currentTurn !== undefined) {
                    currentPlayer = data.currentTurn;
                    updateTurnIndicator();
                }
                if (data.wind !== undefined) {
                    currentWind = data.wind;
                    updateWind();
                }
            });
            socket.on('invite_join_error', data => {
                if (window._acceptWatchdog) clearInterval(window._acceptWatchdog);
                const statusEl = document.getElementById('invite-accept-status') || document.getElementById('online-status-msg');
                if (statusEl) statusEl.innerHTML = `<span style="color: #ea4335;">❌ ${data.message || 'Room not found or host disconnected. Double-check the 4-digit code or ask your friend to create a fresh room!'}</span>`;
            });
        } catch (e) {
            console.log(`[Socket.io] Client offline fallback`);
        }
    }
}

function startOnlineDuel(data) {
    resetGame();
    const p1NameStr = data.opponentProfile && onlineRole === 2 ? data.opponentProfile.username : myProfile.username;
    const p2NameStr = data.opponentProfile && onlineRole === 1 ? data.opponentProfile.username : myProfile.username;
    if (p1ScoreLbl) p1ScoreLbl.textContent = `${p1NameStr} (P1): 12 Alive | 0 GOATs`;
    if (p2ScoreLbl) p2ScoreLbl.textContent = `${p2NameStr} (P2): 12 Alive | 0 GOATs`;

    statusBox.textContent = `🌐 ONLINE MATCH ACTIVE! You are Player ${onlineRole} (${onlineRole === 1 ? '🔵 P1' : '🔴 P2'}) in Room ${onlineRoomId}`;
    triggerNdiso(`Sho! Online match live! ${p1NameStr} vs ${p2NameStr}! Show the arena who is the true Tactical GOAT! 🚀`);
    updateOnlineTurnLock();
}

function updateOnlineTurnLock() {
    if (!isOnlineMode) return;
    const isMyTurn = currentPlayer === onlineRole;
    if (btnFlick) {
        btnFlick.disabled = !isMyTurn;
        if (!isMyTurn) {
            btnFlick.innerHTML = `<span>⏳ OPPONENT TURN</span>`;
        } else {
            btnFlick.innerHTML = `<span>🚀</span><span class="launch-sub">FLICK</span>`;
        }
    }
}

/* ==========================================================================
   FLICK LAUNCH LOGIC
   ========================================================================== */
function triggerFlick(isRemoteOpponent = false) {
    if (isPaused || phase !== 'IDLE' || gameOver) return;
    if (isOnlineMode && !isRemoteOpponent && currentPlayer !== onlineRole) return;

    if (isOnlineMode && !isRemoteOpponent && socket && socket.connected) {
        socket.emit('player_flick', { power: powerVal, wind: currentWind, specialShot: activeSpecialShot });
    }

    const gear = typeof getActiveAimGear === 'function' ? getActiveAimGear() : 'MID';
    let minLaunch = 14.0;
    let maxLaunch = 33.5;

    if (gear === 'LOW') {
        // Tuned specifically so soft lobs (5% - 30%) gently arc into and perfectly capture the bottom/last 2 soldiers (Row 11 & 12)!
        minLaunch = 10.5;
        maxLaunch = 26.0;
    } else if (gear === 'HIGH') {
        minLaunch = 18.0;
        maxLaunch = 36.0;
    }

    const launchSpeed = minLaunch + (powerVal / 100) * (maxLaunch - minLaunch);

    ball.vy = -launchSpeed;
    ball.vRot = (Math.random() - 0.5) * 18;
    ball.bounceCount = 0;
    ball.capturedByBonus = false;

    phase = 'MOVING';
    playSound('flick');
    statusBox.textContent = `Player ${currentPlayer} flicked (${Math.round(powerVal)}% Power)! High speed launch...`;
}

/* ==========================================================================
   NDISO COMMENTARY TEXT BANNER (`triggerNdiso`)
   ========================================================================== */
function triggerNdiso(text) {
    // Stripped per user direction ("Remove Ndiso narrator... keep the game clean not everything need to be right in front of screen").
    return;
}
window.triggerHypeman = triggerNdiso;
window.triggerNdiso = triggerNdiso;

function updateWind() {
    turnCount++;
    if (turnCount % 3 === 0) {
        const winds = [-1.4, -0.7, 0.0, 0.0, +0.7, +1.4];
        currentWind = winds[Math.floor(Math.random() * winds.length)];
    }
    const wb = windBadge || document.getElementById('wind-badge');
    if (wb) {
        const textSpan = wb.querySelector('.wind-text') || wb;
        wb.classList.remove('gust-left', 'gust-right', 'gust-calm');

        if (currentWind < -0.1) {
            wb.classList.add('gust-left');
            if (textSpan) textSpan.innerHTML = `◀◀ DRIFT LEFT (${currentWind.toFixed(1)}) 🌬️`;
        } else if (currentWind > 0.1) {
            wb.classList.add('gust-right');
            if (textSpan) textSpan.innerHTML = `🌬️ DRIFT RIGHT (+${currentWind.toFixed(1)}) ▶▶`;
        } else {
            wb.classList.add('gust-calm');
            if (textSpan) textSpan.innerHTML = `🌬️ CALM AIR (0.0 DRIFT) 🎯`;
        }
    }
}

function updateSpecialShotButtons() {
    if (!btnSticky || !btnFoil) return;
    const hasSticky = currentPlayer === 1 ? p1Sticky > 0 : p2Sticky > 0;
    const hasFoil = currentPlayer === 1 ? p1Foil > 0 : p2Foil > 0;

    btnSticky.disabled = !hasSticky;
    btnFoil.disabled = !hasFoil;

    const sCount = currentPlayer === 1 ? p1Sticky : p2Sticky;
    const fCount = currentPlayer === 1 ? p1Foil : p2Foil;
    btnSticky.innerHTML = `<span>🍬<sup>${sCount}</sup></span>`;
    btnFoil.innerHTML = `<span>🪙<sup>${fCount}</sup></span>`;

    btnSticky.classList.toggle('active-shot', activeSpecialShot === 'STICKY');
    btnFoil.classList.toggle('active-shot', activeSpecialShot === 'FOIL');
}

function triggerBonusScreenCelebration(playerPrefix, partsAdded, killsTriggered) {
    const overlay = document.getElementById('bonus-celebration-overlay');
    if (overlay) {
        const sub = overlay.querySelector('.bonus-celebration-sub');
        if (sub) {
            if (killsTriggered > 0) {
                sub.textContent = `UPGRADED ARMY & SHOT ${killsTriggered} ENEMY ROW(S) DEAD! 🔥💀`;
            } else if (partsAdded > 0) {
                sub.textContent = `ALL ${partsAdded} ALIVE SOLDIERS LEVELED UP AT ONCE! 🎉👑`;
            } else {
                sub.textContent = `BONUS HIT! BUT YOUR ALIVE ARMY IS ALREADY 100% GOAT! 🐐`;
            }
        }
        overlay.classList.add('active');
        setTimeout(() => {
            if (overlay) overlay.classList.remove('active');
        }, 1500);
    }

    // Turn All Alive Soldier Cells GOLD (`cells turn gold for that victory`)
    for (let i = 0; i < TOTAL_ROWS; i++) {
        const soldierBox = document.getElementById(`${playerPrefix}-box-${i}`);
        if (soldierBox && !soldierBox.classList.contains('dead-soldier')) {
            soldierBox.classList.add('bonus-gold-cell');
            setTimeout(() => {
                if (soldierBox) soldierBox.classList.remove('bonus-gold-cell');
            }, 1480);
        }
    }
}

/* ==========================================================================
   LANDING & DUEL KILL ENGINE (`DEAD 💀😭` vs `GOAT 🐐🤣`)
   ========================================================================== */
function handleLanding(boardRowIdx) {
    if (isOnlineMode && currentPlayer === onlineRole && socket && socket.connected) {
        socket.emit('player_landing', { rowIdx: boardRowIdx, newWind: currentWind });
    }

    const currentRows = currentPlayer === 1 ? player1Rows : player2Rows;
    const opponentRows = currentPlayer === 1 ? player2Rows : player1Rows;
    const playerPrefix = currentPlayer === 1 ? 'p1' : 'p2';
    const opponentPrefix = currentPlayer === 1 ? 'p2' : 'p1';

    if (boardRowIdx === 'BONUS') {
        playSound('bonus');
        const floatingBadge = document.querySelector('.floating-bonus-badge');
        if (floatingBadge) {
            floatingBadge.style.background = 'var(--gold)';
            floatingBadge.style.color = '#1a1a1a';
        }

        let partsAdded = 0;
        let killsTriggered = 0;

        for (let i = 0; i < TOTAL_ROWS; i++) {
            if (currentRows[i] >= 0 && currentRows[i] < 12) {
                currentRows[i]++;
                const newVal = currentRows[i];
                const soldierBox = document.getElementById(`${playerPrefix}-box-${i}`);
                if (soldierBox) {
                    const partEl = soldierBox.querySelector(`.stage-${newVal}`);
                    if (partEl) partEl.classList.add('show');
                }
                partsAdded++;

                if (newVal === 12 && soldierBox) {
                    soldierBox.classList.add('completed-soldier');
                    if (opponentRows[i] >= 0 && opponentRows[i] < 12) {
                        eliminateOpponentSoldier(opponentPrefix, i, opponentRows);
                        killsTriggered++;
                    }
                }
            }
        }

        if (killsTriggered > 0) {
            playSound('kill');
            statusBox.textContent = `💥 SUPER BONUS --⭕-- HIT! Upgraded alive soldiers & ELIMINATED ${killsTriggered} OPPONENT ROW(S)! 💀😭`;
            triggerNdiso(`Yoh! Center Jackpot hit! Upgraded your army and shot ${killsTriggered} enemies dead! 🚀🔥`);
        } else if (partsAdded > 0) {
            statusBox.textContent = `💥 SUPER BONUS --⭕-- HIT! Player ${currentPlayer} upgraded all alive soldiers (+1 stage each)! 🚀`;
            triggerNdiso(`Sho! That +1 to all your alive soldiers is shaking the table! 🌟`);
        } else {
            statusBox.textContent = `Player ${currentPlayer} hit the Bonus Arena, but no eligible soldiers needed parts!`;
            triggerNdiso(`Eish! Bonus hit, but all your alive soldiers are already complete!`);
        }

        triggerBonusScreenCelebration(playerPrefix, partsAdded, killsTriggered);

        if (activeSpecialShot === 'STICKY') { if (currentPlayer === 1) p1Sticky--; else p2Sticky--; }
        if (activeSpecialShot === 'FOIL') { if (currentPlayer === 1) p1Foil--; else p2Foil--; }
        activeSpecialShot = 'NORMAL';
        updateSpecialShotButtons();
        updateScores();
        checkWinCondition();

        setTimeout(() => {
            if (floatingBadge) {
                floatingBadge.style.background = 'var(--ink-black)';
                floatingBadge.style.color = 'var(--gold)';
            }
            initiateReturnRoll();
        }, 1450);
        return;
    }

    const targetRowEl = document.getElementById(`board-row-${boardRowIdx}`);
    const soldierIdx = boardRowIdx;
    const currentProgress = currentRows[soldierIdx];

    // Check if THIS player's soldier is DEAD (`-1`)
    if (currentProgress === -1) {
        // If TINFOIL REVIVE SHOT (`🪙`), resurrect BOTH players on this row starting from fresh (`Stage 1 Head`)!
        if (activeSpecialShot === 'FOIL') {
            currentRows[soldierIdx] = 1; // Resurrect current player to Stage 1 Head!
            opponentRows[soldierIdx] = 1; // Reset opponent player on this exact row to Stage 1 (`both players starting fresh in that line`)!

            if (currentPlayer === 1) p1Foil--; else p2Foil--;
            activeSpecialShot = 'NORMAL';
            updateSpecialShotButtons();

            playSound('bonus');
            if (targetRowEl) targetRowEl.classList.add('hit-bonus');

            // Update visual DOM state for CURRENT player box (`resurrected fresh at Stage 1`):
            const soldierBox = document.getElementById(`${playerPrefix}-box-${soldierIdx}`);
            if (soldierBox) {
                soldierBox.classList.remove('dead-soldier', 'completed-soldier');
                soldierBox.querySelectorAll('.part.show').forEach(p => p.classList.remove('show'));
                const partEl = soldierBox.querySelector(`.stage-1`);
                if (partEl) partEl.classList.add('show');
            }

            // Update visual DOM state for OPPONENT player box (`starting fresh at Stage 1`):
            const oppBox = document.getElementById(`${opponentPrefix}-box-${soldierIdx}`);
            if (oppBox) {
                oppBox.classList.remove('dead-soldier', 'completed-soldier');
                oppBox.querySelectorAll('.part.show').forEach(p => p.classList.remove('show'));
                const oppPartEl = oppBox.querySelector(`.stage-1`);
                if (oppPartEl) oppPartEl.classList.add('show');
            }

            statusBox.textContent = `🪙 MIRACLE REVIVE! Row ${soldierIdx + 1} reset! Both players start fresh from Stage 1! ✨`;
            triggerNdiso(`Tactical Miracle! Both players start fresh from Stage 1 on Row ${soldierIdx + 1}! 🪙✨`);
            updateScores();
            checkWinCondition();

            setTimeout(() => {
                if (targetRowEl) targetRowEl.classList.remove('hit-bonus');
                initiateReturnRoll();
            }, 1450);
            return;
        }

        playSound('wasted');
        if (targetRowEl) targetRowEl.classList.add('hit-wasted');
        statusBox.textContent = `❌ Row ${soldierIdx + 1} – YOUR SOLDIER WAS ELIMINATED & IS DEAD! 💀😭 Turn Wasted!`;
        triggerNdiso(`Ayi no man! That soldier is dead! Use a Tinfoil Revive shot next time or focus on your alive army!`);

        activeSpecialShot = 'NORMAL';
        setTimeout(() => {
            if (targetRowEl) targetRowEl.classList.remove('hit-wasted');
            initiateReturnRoll();
        }, 1300);
        return;
    }

    if (currentProgress >= 12) {
        playSound('wasted');
        if (targetRowEl) targetRowEl.classList.add('hit-wasted');
        statusBox.textContent = `Player ${currentPlayer} landed on Row ${soldierIdx + 1} – Soldier is ALREADY COMPLETE (GOAT 🐐)! Turn Wasted.`;
        triggerNdiso(`Sho! That soldier is already a GOAT 🐐! Aim at your incomplete rows next turn!`);

        if (activeSpecialShot === 'STICKY') { if (currentPlayer === 1) p1Sticky--; else p2Sticky--; }
        if (activeSpecialShot === 'FOIL') { if (currentPlayer === 1) p1Foil--; else p2Foil--; }
        activeSpecialShot = 'NORMAL';

        setTimeout(() => {
            if (targetRowEl) targetRowEl.classList.remove('hit-wasted');
            initiateReturnRoll();
        }, 1300);
        return;
    }

    // Normal progression
    if (activeSpecialShot === 'STICKY') { if (currentPlayer === 1) p1Sticky--; else p2Sticky--; }
    if (activeSpecialShot === 'FOIL') { if (currentPlayer === 1) p1Foil--; else p2Foil--; }
    const wasSticky = activeSpecialShot === 'STICKY';
    activeSpecialShot = 'NORMAL';
    updateSpecialShotButtons();

    const newProgress = currentProgress + 1;
    currentRows[soldierIdx] = newProgress;

    playSound('hit');
    if (targetRowEl) targetRowEl.classList.add('hit-active');

    const soldierBox = document.getElementById(`${playerPrefix}-box-${soldierIdx}`);
    if (soldierBox) {
        const partEl = soldierBox.querySelector(`.stage-${newProgress}`);
        if (partEl) partEl.classList.add('show');
    }

    const stageInfo = STAGES[newProgress - 1];
    statusBox.textContent = `Player ${currentPlayer} landed on Row ${soldierIdx + 1}${wasSticky ? ' (🍬 Sticky Shot)' : ''}! Added: ${stageInfo.name} (${newProgress}/12)`;
    triggerNdiso(`Sharp shot! Added ${stageInfo.name} on Row ${soldierIdx + 1}! (${newProgress}/12 to shoot first!)`);

    if (newProgress === 12 && soldierBox) {
        soldierBox.classList.add('completed-soldier');
        statusBox.textContent = `🔥 Player ${currentPlayer} COMPLETED Soldier #${soldierIdx + 1} & SHOT FIRST! 🐐🤣`;
        triggerNdiso(`BOOM! Player ${currentPlayer}'s Soldier #${soldierIdx + 1} reached Stage 12 and fired! 🐐🤣`);

        if (opponentRows[soldierIdx] >= 0 && opponentRows[soldierIdx] < 12) {
            playSound('kill');
            eliminateOpponentSoldier(opponentPrefix, soldierIdx, opponentRows);
            statusBox.textContent = `🔫 SHOT FIRED! Player ${currentPlayer}'s Soldier #${soldierIdx + 1} ELIMINATED Player ${currentPlayer === 1 ? 2 : 1}'s row! 💀😭`;
            triggerNdiso(`Haibo! Sho shot first on Row ${soldierIdx + 1} and sent the enemy straight to the graveyard! Wasted! 💀😭`);
        }
    }

    updateScores();
    checkWinCondition();

    setTimeout(() => {
        if (targetRowEl) targetRowEl.classList.remove('hit-active');
        initiateReturnRoll();
    }, 1350);
}

function eliminateOpponentSoldier(opponentPrefix, soldierIdx, opponentRowsArray) {
    opponentRowsArray[soldierIdx] = -1;
    const oppBox = document.getElementById(`${opponentPrefix}-box-${soldierIdx}`);
    if (oppBox) {
        oppBox.classList.add('dead-soldier');
    }
}

function checkWinCondition() {
    const p1Goats = player1Rows.filter(r => r === 12).length;
    const p2Goats = player2Rows.filter(r => r === 12).length;
    const p1Dead = player1Rows.filter(r => r === -1).length;
    const p2Dead = player2Rows.filter(r => r === -1).length;

    if (p1Goats >= WIN_MAJORITY) {
        gameOver = true;
        setTimeout(() => handleVictory(1), 800);
    } else if (p2Goats >= WIN_MAJORITY) {
        gameOver = true;
        setTimeout(() => handleVictory(2), 800);
    } else if (p1Goats + p1Dead === TOTAL_ROWS && p2Goats + p2Dead === TOTAL_ROWS) {
        gameOver = true;
        setTimeout(() => {
            if (p1Goats > p2Goats) handleVictory(1);
            else if (p2Goats > p1Goats) handleVictory(2);
            else handleVictory(currentPlayer);
        }, 800);
    }
}

function initiateReturnRoll() {
    if (gameOver) return;
    statusBox.textContent = `Ball smoothly returning to the Launch Pad Arena...`;
    phase = 'RETURNING';
}

function completeTurnSwitch() {
    if (gameOver) return;
    currentPlayer = currentPlayer === 1 ? 2 : 1;

    if (currentPlayer === 1) {
        turnBadge.className = 'turn-badge p1-turn';
        turnBadge.innerHTML = isAiBotMode ? '<span>🔵 P1 TURN vs AI 🤖</span>' : '<span>🔵 P1 TURN</span>';
    } else {
        turnBadge.className = 'turn-badge p2-turn';
        turnBadge.innerHTML = isAiBotMode ? '<span>🤖 SIPHO AI TURN...</span>' : '<span>🔴 P2 TURN</span>';
    }

    activeSpecialShot = 'NORMAL';
    updateWind();
    updateSpecialShotButtons();
    updateOnlineTurnLock();
    updateAimGearUI();

    statusBox.textContent = `Player ${currentPlayer}'s turn! Aim the Power Bar and FLICK from the Launch Pad!`;
    triggerNdiso(`Player ${currentPlayer}'s turn! Check the wind (${currentWind === 0 ? 'Calm' : (currentWind < 0 ? 'Left Gust' : 'Right Gust')}) and aim your shot!`);

    // AI Bot (`Sipho The Stoep King 🤖`) automated turn trigger:
    if (!isOnlineMode && isAiBotMode && currentPlayer === 2 && !gameOver) {
        if (btnFlick) btnFlick.disabled = true;
        setTimeout(() => {
            if (gameOver || phase !== 'IDLE' || currentPlayer !== 2 || !isAiBotMode) return;
            powerVal = Math.floor(Math.random() * 65 + 32);
            if (btnFlick) btnFlick.disabled = false;
            triggerFlick(false);
        }, 1300);
    }
}

function updateScores() {
    if (!p1ScoreLbl || !p2ScoreLbl) return;
    const p1Goats = player1Rows.filter(r => r === 12).length;
    const p2Goats = player2Rows.filter(r => r === 12).length;
    const p1Alive = player1Rows.filter(r => r >= 0 && r < 12).length;
    const p2Alive = player2Rows.filter(r => r >= 0 && r < 12).length;
    const p1Dead = player1Rows.filter(r => r === -1).length;
    const p2Dead = player2Rows.filter(r => r === -1).length;

    p1ScoreLbl.textContent = `P1 Alive:${p1Alive} | GOATs:${p1Goats}${p1Dead > 0 ? ` | Dead:${p1Dead}` : ''}`;
    p2ScoreLbl.textContent = `P2 Alive:${p2Alive} | GOATs:${p2Goats}${p2Dead > 0 ? ` | Dead:${p2Dead}` : ''}`;
}

function handleVictory(winner) {
    if (timerInterval) clearInterval(timerInterval);
    playSound('win');

    // Career Profile XP & Coin award:
    if (winner === currentPlayer || (isOnlineMode && winner === onlineRole)) {
        myProfile.wins++;
        myProfile.xp += 150;
        myProfile.coins += 50;
    } else {
        myProfile.losses++;
        myProfile.xp += 35;
        myProfile.coins += 15;
    }
    saveProfile();
    ZonkeSupabase.syncProfile(myProfile);

    const winTitle = document.getElementById('win-title');
    const winSub = document.getElementById('win-subtitle');

    if (winTitle && winSub) {
        if (winner === 1) {
            winTitle.textContent = "🏆 PLAYER 1 IS THE GOAT! 🐐🤣";
            winTitle.style.color = "var(--p1-blue)";
            winSub.textContent = `Player 1 won the Tactical Duel in ${formatTime(p1Seconds + p2Seconds)} (P1: ${formatTime(p1Seconds)} | P2: ${formatTime(p2Seconds)})!`;
        } else {
            winTitle.textContent = "🏆 PLAYER 2 IS THE GOAT! 🐐🤣";
            winTitle.style.color = "var(--p2-red)";
            winSub.textContent = `Player 2 won the Tactical Duel in ${formatTime(p1Seconds + p2Seconds)} (P1: ${formatTime(p1Seconds)} | P2: ${formatTime(p2Seconds)})!`;
        }
    }

    if (winModal) winModal.classList.add('active');
    statusBox.textContent = `🎉 TACTICAL DUEL OVER! Player ${winner} reigns supreme as THE GOAT 🐐!`;
}

function resetGame() {
    player1Rows = new Array(TOTAL_ROWS).fill(0);
    player2Rows = new Array(TOTAL_ROWS).fill(0);
    currentPlayer = 1;
    gameOver = false;
    phase = 'IDLE';
    isPaused = false;
    if (btnPauseQuick) {
        btnPauseQuick.innerHTML = `<span>⏸️ PAUSE</span>`;
        btnPauseQuick.classList.remove('paused');
    }
    if (pauseOverlay) pauseOverlay.classList.remove('active');

    p1Seconds = 0; p2Seconds = 0;
    updateTimerDisplay();
    startTimerLoop();

    // Reset Special Ammo & Wind:
    p1Sticky = 1; p2Sticky = 1;
    p1Foil = 1; p2Foil = 1;
    updatePlayerFooterUI();
    p1AimGear = 'MID'; p2AimGear = 'MID';
    updateAimGearUI();
    activeSpecialShot = 'NORMAL';
    turnCount = 0; currentWind = 0.0;
    updateWind();
    updateSpecialShotButtons();

    buildSoldierBoxes(p1Wrapper, 'p1', currentOutfit);
    buildSoldierBoxes(p2Wrapper, 'p2', currentOutfit);

    targetRowsContainer.querySelectorAll('.board-row').forEach(r => {
        r.classList.remove('hit-active', 'hit-wasted', 'hit-bonus');
    });

    turnBadge.className = 'turn-badge p1-turn';
    turnBadge.innerHTML = '<span>🔵 P1 TURN</span>';

    if (winModal) winModal.classList.remove('active');
    resetBallToLaunch();
    updateScores();

    statusBox.textContent = "Duel reset! Aim from the Launch Pad (`🏀`) & complete rows first to kill your opponent!";
    triggerNdiso(`Sho! New match started! Check your wind and make your first shot count! 🚀`);
}

/* ==========================================================================
   CONTROLS & EVENT LISTENERS
   ========================================================================== */
function toggleSound() {
    soundEnabled = !soundEnabled;
    const text = soundEnabled ? '🔊 ON' : '🔇 OFF';
    if (btnSoundQuick) btnSoundQuick.textContent = text;
    if (btnSoundMenu) btnSoundMenu.innerHTML = soundEnabled ? '🔊<span>SOUND: ON</span>' : '🔇<span>SOUND: OFF</span>';
}

function toggleHaptics() {
    hapticsEnabled = !hapticsEnabled;
    if (btnHapticsQuick) btnHapticsQuick.textContent = hapticsEnabled ? '📳 ON' : '📴 OFF';
    if (btnHapticsMenu) btnHapticsMenu.innerHTML = hapticsEnabled ? '📳<span>VIBRATE: ON</span>' : '📴<span>VIBRATE: OFF</span>';
    triggerNdiso(hapticsEnabled ? 'Sho! Native physical vibration & haptics ENABLED! 📳' : 'Native vibration MUTED! Playing silent haptics. 📴');
    if (hapticsEnabled && typeof window !== 'undefined' && window.Capacitor?.Plugins?.Haptics) {
        try { window.Capacitor.Plugins.Haptics.impact({ style: 'MEDIUM' }); } catch(e) {}
    }
}

function setupEventListeners() {
    if (btnSoundQuick) btnSoundQuick.addEventListener('click', toggleSound);
    if (btnSoundMenu) btnSoundMenu.addEventListener('click', toggleSound);
    if (btnHapticsQuick) btnHapticsQuick.addEventListener('click', toggleHaptics);
    if (btnHapticsMenu) btnHapticsMenu.addEventListener('click', toggleHaptics);
    if (btnFlick) btnFlick.addEventListener('click', triggerFlick);
    if (btnClear) btnClear.addEventListener('click', () => {
        if (phase !== 'IDLE' && !gameOver) {
            resetBallToLaunch();
            phase = 'IDLE';
            statusBox.textContent = `Ball reset to Launch Pad for Player ${currentPlayer}! Ready to flick.`;
        }
    });
    if (btnPlayAgain) btnPlayAgain.addEventListener('click', resetGame);

    // Special One-Time Ammo Buttons (`🍬 STICKY` and `🪙 FOIL REVIVE`)
    if (btnSticky) btnSticky.addEventListener('click', () => {
        if (phase !== 'IDLE' || gameOver) return;
        const hasSticky = currentPlayer === 1 ? p1Sticky > 0 : p2Sticky > 0;
        if (!hasSticky) return;
        activeSpecialShot = activeSpecialShot === 'STICKY' ? 'NORMAL' : 'STICKY';
        updateSpecialShotButtons();
        if (activeSpecialShot === 'STICKY') {
            statusBox.textContent = `🍬 Ultra Sticky Shot loaded! Ball has zero bounce and snaps on contact!`;
            triggerNdiso(`Sho! Ultra Sticky Shot armed! That ball will stick wherever it touches!`);
        } else {
            statusBox.textContent = `Special shot disarmed. Normal paper ball ready.`;
        }
    });

    if (btnFoil) btnFoil.addEventListener('click', () => {
        if (phase !== 'IDLE' && !gameOver) return;
        const hasFoil = currentPlayer === 1 ? p1Foil > 0 : p2Foil > 0;
        if (!hasFoil) return;
        activeSpecialShot = activeSpecialShot === 'FOIL' ? 'NORMAL' : 'FOIL';
        updateSpecialShotButtons();
        if (activeSpecialShot === 'FOIL') {
            statusBox.textContent = `🪙 Tinfoil Revive Shot loaded! Hit a DEAD row to resurrect your soldier!`;
            triggerNdiso(`Tactical Miracle inbound! Revive Heavy Ball armed—hit a dead soldier's row to bring them back to life! ✨`);
        } else {
            statusBox.textContent = `Special shot disarmed. Normal paper ball ready.`;
        }
    });

    // Profile Modal & Career Controls (`if playing online need profile`)
    const btnProfileQuick = document.getElementById('btn-profile-quick');
    const btnEditProfileMenu = document.getElementById('btn-edit-profile-menu');
    const btnSaveProfile = document.getElementById('btn-save-profile');
    const profileModal = document.getElementById('profile-modal');

    const openProfile = () => {
        if (menuModal) menuModal.classList.remove('active');
        if (profileModal) profileModal.classList.add('active');
        updateProfileUI();
    };
    if (btnProfileQuick) btnProfileQuick.addEventListener('click', openProfile);
    if (btnEditProfileMenu) btnEditProfileMenu.addEventListener('click', openProfile);
    if (btnSaveProfile && profileModal) {
        btnSaveProfile.addEventListener('click', () => {
            saveProfile();
            profileModal.classList.remove('active');
            statusBox.textContent = `🧑 Profile saved: ${myProfile.username} (${getRankInfo(myProfile.xp)})`;
        });
    }

    document.querySelectorAll('.btn-avatar').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-avatar').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            myProfile.avatar = btn.getAttribute('data-avatar') || "🧢";
            saveProfile();
        });
    });

    // Guided Tour Controls (`make tour around the screen`)
    const btnSkipTour = document.getElementById('btn-skip-tour');
    const btnNextTour = document.getElementById('btn-next-tour');
    const btnRetakeTour = document.getElementById('btn-retake-tour');
    if (btnSkipTour) btnSkipTour.addEventListener('click', skipGuidedTour);
    if (btnNextTour) btnNextTour.addEventListener('click', nextTourStep);
    if (btnRetakeTour) btnRetakeTour.addEventListener('click', () => {
        if (menuModal) menuModal.classList.remove('active');
        startGuidedTour();
    });

    // Online, Invite Link, AI Bot, & Offline Mode Switchers inside ☰ MENU

    // PWA Offline Installation Hook (`A2HS - Add to Home Screen`)
    let deferredInstallPrompt = null;
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            const btnPwa = document.getElementById('btn-install-pwa');
            if (btnPwa) btnPwa.style.display = 'flex';
            console.log("[Zonke PWA] Install prompt captured and ready!");
        });
    }

    const btnInstallPwa = document.getElementById('btn-install-pwa');
    if (btnInstallPwa) {
        btnInstallPwa.addEventListener('click', () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                deferredInstallPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('[Zonke PWA] User accepted the install prompt!');
                        btnInstallPwa.style.display = 'none';
                    }
                    deferredInstallPrompt = null;
                });
            } else {
                alert("📲 TO INSTALL ZONKE FOR OFFLINE PLAY:\n\n• On Android (Chrome): Tap the browser 3-dot menu (⋮) at top right and select 'Add to Home Screen' or 'Install App'.\n\n• On iPhone (Safari): Tap the Share icon ([↑]) at the bottom and select 'Add to Home Screen'.");
            }
        });
    }

    const btnOnlineDuel = document.getElementById('btn-online-duel');
    const btnInviteFriend = document.getElementById('btn-invite-friend');
    const btnAiBot = document.getElementById('btn-ai-bot');
    const btnOfflineMode = document.getElementById('btn-offline-mode');
    const btnCancelSearch = document.getElementById('btn-cancel-search');
    const onlineWaitingModal = document.getElementById('online-waiting-modal');

    const btnAddFriend = document.getElementById('btn-add-friend');
    if (btnAddFriend) {
        btnAddFriend.addEventListener('click', () => {
            if (!opponentProfile) return;
            const friends = JSON.parse(localStorage.getItem('zonke_friends_list') || '[]');
            if (!friends.some(f => f.username === opponentProfile.username)) {
                friends.push(opponentProfile);
                localStorage.setItem('zonke_friends_list', JSON.stringify(friends));
            }
            ZonkeSupabase.addFriend(myProfile.username, opponentProfile.username, opponentProfile.avatar, getRankInfo(opponentProfile.xp || 0));
            btnAddFriend.textContent = `✔ ADDED TO FRIENDS LIST (Synced to Supabase Cloud!)`;
            btnAddFriend.disabled = true;
        });
    }

    if (btnInviteFriend) {
        btnInviteFriend.addEventListener('click', () => {
            if (menuModal) menuModal.classList.remove('active');
            if (onlineWaitingModal) onlineWaitingModal.classList.add('active');
            isOnlineMode = true;
            onlineRole = 1;
            const code = "DUEL-" + Math.floor(1000 + Math.random() * 9000);
            onlineRoomId = code;
            if (!socket) setupSocketClient();

            const emitCreate = () => {
                socket.emit('create_invite_room', {
                    roomCode: code,
                    name: myProfile.username,
                    avatar: myProfile.avatar,
                    rank: getRankInfo(myProfile.xp),
                    outfit: currentOutfit,
                    gun: currentGun,
                    wins: myProfile.wins
                });
            };

            if (socket && socket.connected) {
                emitCreate();
            } else if (socket) {
                socket.once('connect', emitCreate);
            }

            // Host Room Maintenance Heartbeat (`ensures host room survives socket reconnects or polling->websocket upgrade`)
            if (window._inviteMaintainInterval) clearInterval(window._inviteMaintainInterval);
            window._inviteMaintainInterval = setInterval(() => {
                if (socket && socket.connected && onlineRoomId && isOnlineMode && onlineWaitingModal && onlineWaitingModal.classList.contains('active')) {
                    socket.emit('maintain_invite_room', { roomCode: onlineRoomId, name: myProfile.username });
                }
            }, 2500);

            const inviteUrl = window.location.origin + window.location.pathname + '?room=' + code;
            const msg = document.getElementById('online-status-msg');
            if (msg) {
                msg.innerHTML = `
                    <div style="font-size: 13px; font-weight: 900; color: #00e5ff; margin-bottom: 6px;">⏳ WAITING FOR FRIEND TO JOIN & ACCEPT...</div>
                    <div style="font-size: 11px; color: var(--ink-grey); margin-bottom: 4px;">Private Room Code: <b style="color: var(--gold); font-size: 15px;">${code}</b></div>
                    <div style="font-size: 10px; margin-bottom: 10px; word-break: break-all; background: rgba(0,0,0,0.5); padding: 6px; border-radius: 6px; color: #fff;">${inviteUrl}</div>
                    <button class="btn btn-primary" id="btn-share-invite" style="padding: 8px 12px; font-size: 11px; width: 100%; margin-bottom: 6px;">📋 COPY / SHARE INVITE LINK</button>
                    <div style="font-size: 10.5px; color: #aaa; line-height: 1.3;">Tell your friend to tap <b style="color: #fff;">📥 ACCEPT FRIEND INVITE</b> inside Menu or open your link!</div>
                `;
                setTimeout(() => {
                    const shareBtn = document.getElementById('btn-share-invite');
                    if (shareBtn) shareBtn.addEventListener('click', () => {
                        if (navigator.share) {
                            navigator.share({ title: 'Challenge me in ZONKE Tactical Duel!', text: `Join my private duel room ${code}!`, url: inviteUrl }).catch(()=>{});
                        } else if (navigator.clipboard) {
                            navigator.clipboard.writeText(inviteUrl);
                            shareBtn.textContent = "✅ LINK COPIED TO CLIPBOARD!";
                        }
                    });
                }, 100);
            }
        });
    }

    if (btnAiBot) {
        btnAiBot.addEventListener('click', () => {
            isAiBotMode = true;
            isOnlineMode = false;
            if (menuModal) menuModal.classList.remove('active');
            const p2Header = document.querySelector('#player2-zone .zone-header');
            if (p2Header) p2Header.textContent = "Sipho AI Bot 🤖";
            updatePlayerFooterUI();
            resetGame();
            if (turnBadge) {
                turnBadge.className = 'turn-badge p1-turn';
                turnBadge.innerHTML = '<span>🔵 P1 TURN vs AI 🤖</span>';
            }
        });
    }

    if (btnOnlineDuel) {
        btnOnlineDuel.addEventListener('click', () => {
            if (menuModal) menuModal.classList.remove('active');
            if (onlineWaitingModal) onlineWaitingModal.classList.add('active');
            if (!socket) setupSocketClient();
            if (socket && socket.connected) {
                socket.emit('find_match', {
                    name: myProfile.username,
                    avatar: myProfile.avatar,
                    rank: getRankInfo(myProfile.xp),
                    outfit: currentOutfit,
                    gun: currentGun,
                    wins: myProfile.wins
                });
            } else if (socket) {
                const msg = document.getElementById('online-status-msg');
                if (msg) msg.innerHTML = `<div>Connecting to Cloud Matchmaking Server...</div><div style="font-size: 10px; color: var(--gold); margin-top: 4px;">(${typeof SERVER_API_URL !== 'undefined' ? SERVER_API_URL : 'http://localhost:3000'})</div>`;
                socket.once('connect', () => {
                    const badge = document.getElementById('online-mode-badge');
                    if (badge) badge.innerHTML = `<span>🟢 ONLINE READY</span>`;
                    socket.emit('find_match', {
                        name: myProfile.username,
                        avatar: myProfile.avatar,
                        rank: getRankInfo(myProfile.xp),
                        outfit: currentOutfit,
                        gun: currentGun,
                        wins: myProfile.wins
                    });
                });
                setTimeout(() => {
                    if (!socket.connected && msg) {
                        msg.innerHTML = `
                            <div style="color: #00e5ff; font-size: 12px; font-weight: 900; margin-bottom: 6px;">⚡ QUICK CONNECTION TIPS</div>
                            <div style="font-size: 10.5px; color: var(--ink-black); text-align: left; background: rgba(0,0,0,0.06); padding: 8px; border-radius: 6px; line-height: 1.4;">
                                • <b>Check Network Signal:</b> Ensure your Wi-Fi or Mobile Data connection is active and stable.<br>
                                • <b>Fast 1v1 Pairing:</b> For the quickest connection, tap <b>🔗 INVITE FRIEND</b> in Menu and share your room link directly with a friend via WhatsApp!<br>
                                • <b>Instant Practice:</b> Tap <b>🤖 DUEL AI BOT</b> for instant zero-latency combat training!
                            </div>
                        `;
                    }
                }, 6500);
            }
        });
    }

    if (btnOfflineMode) {
        btnOfflineMode.addEventListener('click', () => {
            isOnlineMode = false;
            isAiBotMode = false;
            if (menuModal) menuModal.classList.remove('active');
            const p2Header = document.querySelector('#player2-zone .zone-header');
            if (p2Header) p2Header.textContent = "Player 2 (<-)";
            updatePlayerFooterUI();
            resetGame();
            if (turnBadge) {
                turnBadge.className = 'turn-badge p1-turn';
                turnBadge.innerHTML = '<span>🔵 P1 TURN</span>';
            }
        });
    }

    if (btnCancelSearch && onlineWaitingModal) {
        btnCancelSearch.addEventListener('click', () => {
            onlineWaitingModal.classList.remove('active');
            isOnlineMode = false;
        });
    }

    const btnAcceptInvite = document.getElementById('btn-accept-invite');
    const inviteAcceptModal = document.getElementById('invite-accept-modal');
    const btnCloseInviteAccept = document.getElementById('btn-close-invite-accept');
    const btnConfirmAcceptInvite = document.getElementById('btn-confirm-accept-invite');

    if (btnAcceptInvite && inviteAcceptModal) {
        btnAcceptInvite.addEventListener('click', () => {
            if (menuModal) menuModal.classList.remove('active');
            inviteAcceptModal.classList.add('active');
            const statusEl = document.getElementById('invite-accept-status');
            if (statusEl) statusEl.textContent = '';
            const inp = document.getElementById('invite-code-input');
            if (inp) {
                inp.value = '';
                inp.focus();
            }
        });
    }

    if (btnCloseInviteAccept && inviteAcceptModal) {
        btnCloseInviteAccept.addEventListener('click', () => {
            inviteAcceptModal.classList.remove('active');
        });
    }

    if (btnConfirmAcceptInvite && inviteAcceptModal) {
        const handleAcceptSubmit = () => {
            const inp = document.getElementById('invite-code-input');
            let rawVal = inp ? inp.value.trim() : '';
            if (!rawVal) {
                const statusEl = document.getElementById('invite-accept-status');
                if (statusEl) statusEl.innerHTML = `<span style="color: #ea4335;">Please enter a Room Code (e.g. DUEL-4921)</span>`;
                return;
            }
            if (rawVal.includes('?room=')) {
                const parts = rawVal.split('?room=');
                if (parts.length > 1) rawVal = parts[1].split('&')[0].trim();
            } else if (rawVal.includes('DUEL-')) {
                const idx = rawVal.indexOf('DUEL-');
                rawVal = rawVal.slice(idx).split(' ')[0].trim();
            }
            if (!rawVal.startsWith('DUEL-')) {
                rawVal = 'DUEL-' + rawVal.replace(/^DUEL-?/i, '');
            }
            isOnlineMode = true;
            if (!socket) setupSocketClient();
            const cleanCode = rawVal.toUpperCase();
            const statusEl = document.getElementById('invite-accept-status');
            if (statusEl) statusEl.innerHTML = `<span style="color: var(--gold);">⚡ Connecting to Room ${cleanCode}... Pairing instantly!</span>`;
            
            const emitJoin = () => {
                if (socket) {
                    socket.emit('join_invite_room', {
                        roomCode: cleanCode,
                        name: myProfile.username,
                        avatar: myProfile.avatar,
                        rank: getRankInfo(myProfile.xp),
                        outfit: currentOutfit,
                        gun: currentGun,
                        wins: myProfile.wins
                    });
                }
            };

            if (socket && socket.connected) {
                emitJoin();
            } else if (socket) {
                if (socket.connect) socket.connect();
                socket.once('connect', emitJoin);
            }

            // Auto-Retry Watchdog (`if connection or transport upgrade was pending, retry automatically so it never stops or gets stuck`)
            if (window._acceptWatchdog) clearInterval(window._acceptWatchdog);
            let retries = 0;
            window._acceptWatchdog = setInterval(() => {
                if (!inviteAcceptModal.classList.contains('active')) {
                    clearInterval(window._acceptWatchdog);
                    return;
                }
                retries++;
                if (socket && socket.connected) {
                    emitJoin();
                } else if (socket && socket.connect) {
                    socket.connect();
                }
                if (retries >= 3 && statusEl) {
                    statusEl.innerHTML = `
                        <div style="color: #00e5ff; font-size: 11px; margin-top: 4px;">⚡ Trying to connect to host room... Ensure both you and the host have active mobile data/Wi-Fi!</div>
                    `;
                }
                if (retries >= 6 && statusEl) {
                    clearInterval(window._acceptWatchdog);
                    statusEl.innerHTML = `
                        <div style="color: #ea4335; font-size: 11px; margin-top: 4px;">❌ Could not reach room ${cleanCode}. Ask your friend if the room is still open or tap <b>🔗 INVITE FRIEND</b> to create your own!</div>
                    `;
                }
            }, 1800);
        };

        btnConfirmAcceptInvite.addEventListener('click', handleAcceptSubmit);
        const inp = document.getElementById('invite-code-input');
        if (inp) {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleAcceptSubmit();
            });
        }
    }

    // Hamburger Menu Controls
    if (btnMenu && menuModal) {
        btnMenu.addEventListener('click', () => {
            updateProfileUI();
            menuModal.classList.add('active');
        });
    }
    if (btnCloseMenu && menuModal) btnCloseMenu.addEventListener('click', () => menuModal.classList.remove('active'));
    
    if (btnNewMenu) btnNewMenu.addEventListener('click', () => {
        if (menuModal) menuModal.classList.remove('active');
        resetGame();
    });

    // Rules shown ONLY from Menu as requested ("rules must shown only in menu...")
    const openRules = () => {
        if (menuModal) menuModal.classList.remove('active');
        if (rulesModal) rulesModal.classList.add('active');
    };
    if (btnRulesMenu) btnRulesMenu.addEventListener('click', openRules);
    if (btnCloseRules && rulesModal) btnCloseRules.addEventListener('click', () => rulesModal.classList.remove('active'));

    // Developer Feedback Hub (`njwayelodlamini@gmail.com / @outlook.com`)
    const btnFeedbackMenu = document.getElementById('btn-feedback-menu');
    const feedbackModal = document.getElementById('feedback-modal');
    const btnCloseFeedback = document.getElementById('btn-close-feedback');
    const btnSendGmail = document.getElementById('btn-send-gmail');
    const btnSendOutlook = document.getElementById('btn-send-outlook');
    const btnSubmitCloudFeedback = document.getElementById('btn-submit-cloud-feedback');

    if (btnFeedbackMenu) {
        btnFeedbackMenu.addEventListener('click', () => {
            if (menuModal) menuModal.classList.remove('active');
            if (feedbackModal) feedbackModal.classList.add('active');
        });
    }
    if (btnCloseFeedback && feedbackModal) {
        btnCloseFeedback.addEventListener('click', () => feedbackModal.classList.remove('active'));
    }

    const getFeedbackText = () => {
        const inp = document.getElementById('feedback-msg-input');
        return inp && inp.value.trim().length > 0 ? inp.value.trim() : "General ZONKE Feedback";
    };

    if (btnSendGmail) {
        btnSendGmail.addEventListener('click', () => {
            const msg = getFeedbackText();
            const body = encodeURIComponent(`Player Tag: ${myProfile.username}
Rank: ${getRankInfo(myProfile.xp)}
Mode: ${isOnlineMode ? 'Online PvP' : (isAiBotMode ? 'AI Bot' : 'Pass & Play')}

Feedback:
${msg}`);
            window.open(`mailto:njwayelodlamini@gmail.com?subject=${encodeURIComponent('[ZONKE Feedback] from ' + myProfile.username)}&body=${body}`, '_blank');
            const lbl = document.getElementById('feedback-status-lbl');
            if (lbl) lbl.textContent = "✔ Gmail client opened! Thank you for supporting ZONKE!";
        });
    }

    if (btnSendOutlook) {
        btnSendOutlook.addEventListener('click', () => {
            const msg = getFeedbackText();
            const body = encodeURIComponent(`Player Tag: ${myProfile.username}
Rank: ${getRankInfo(myProfile.xp)}
Mode: ${isOnlineMode ? 'Online PvP' : (isAiBotMode ? 'AI Bot' : 'Pass & Play')}

Feedback:
${msg}`);
            window.open(`mailto:njwayelodlamini@outlook.com?subject=${encodeURIComponent('[ZONKE Feedback] from ' + myProfile.username)}&body=${body}`, '_blank');
            const lbl = document.getElementById('feedback-status-lbl');
            if (lbl) lbl.textContent = "✔ Outlook client opened! Thank you for supporting ZONKE!";
        });
    }

    if (btnSubmitCloudFeedback) {
        btnSubmitCloudFeedback.addEventListener('click', () => {
            const msg = getFeedbackText();
            ZonkeTelemetry.logEvent("PLAYER_FEEDBACK", msg, "info", { username: myProfile.username, rank: getRankInfo(myProfile.xp), targetEmail: "njwayelodlamini@gmail.com" });
            const lbl = document.getElementById('feedback-status-lbl');
            if (lbl) lbl.textContent = "☁️ Feedback logged to server telemetry! We will review right away.";
            const inp = document.getElementById('feedback-msg-input');
            if (inp) inp.value = "";
        });
    }





    // Menu Tabs & Powers Guide Switching (`🎨 THEMES` vs `🔫 ARMORY` vs `⚡ POWERS GUIDE`)
    const openPowersTab = () => {
        document.querySelectorAll('.menu-tab-btn').forEach(b => {
            if (b.getAttribute('data-tab') === 'menu-tab-powers') b.classList.add('active');
            else b.classList.remove('active');
        });
        const tabCustom = document.getElementById('menu-tab-custom');
        const tabArmory = document.getElementById('menu-tab-armory');
        const tabPowers = document.getElementById('menu-tab-powers');
        if (tabCustom) tabCustom.style.display = 'none';
        if (tabArmory) tabArmory.style.display = 'none';
        if (tabPowers) tabPowers.style.display = 'block';
    };

    const btnPowersMenu = document.getElementById('btn-powers-menu');
    if (btnPowersMenu) btnPowersMenu.addEventListener('click', openPowersTab);

    document.querySelectorAll('.menu-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.menu-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const tabCustom = document.getElementById('menu-tab-custom');
            const tabArmory = document.getElementById('menu-tab-armory');
            const tabPowers = document.getElementById('menu-tab-powers');
            if (tabCustom) tabCustom.style.display = targetId === 'menu-tab-custom' ? 'block' : 'none';
            if (tabArmory) tabArmory.style.display = targetId === 'menu-tab-armory' ? 'block' : 'none';
            if (tabPowers) tabPowers.style.display = targetId === 'menu-tab-powers' ? 'block' : 'none';
        });
    });

    // 4 Theme Switching Buttons
    document.querySelectorAll('.btn-theme').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-theme').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const themeClass = btn.getAttribute('data-theme');
            currentTheme = themeClass;
            document.body.className = '';
            if (themeClass !== 'theme-kasi') {
                document.body.classList.add(themeClass);
            }
            if (statusBox) statusBox.textContent = `Theme switched to ${btn.textContent}!`;
        });
    });

    // 4 Soldier Outfit Switching Buttons (Independent character class selection!)
    document.querySelectorAll('.btn-outfit').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-outfit').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const outfitClass = btn.getAttribute('data-outfit');
            currentOutfit = outfitClass;

            buildSoldierBoxes(p1Wrapper, 'p1', currentOutfit);
            buildSoldierBoxes(p2Wrapper, 'p2', currentOutfit);
            if (isOnlineMode && socket && socket.connected) {
                socket.emit('player_loadout_change', { outfit: currentOutfit, gun: currentGun });
            }
            if (statusBox) statusBox.textContent = `Soldier Outfit changed to ${btn.textContent}! Upgraded armies.`;
        });
    });

    // 10 PUBG Gun Switching Buttons (Triggers instant weapon transform across all 24 boxes!)
    document.querySelectorAll('.btn-gun').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-gun').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const gunClass = btn.getAttribute('data-gun');
            currentGun = gunClass;

            buildSoldierBoxes(p1Wrapper, 'p1', currentOutfit);
            buildSoldierBoxes(p2Wrapper, 'p2', currentOutfit);
            if (isOnlineMode && socket && socket.connected) {
                socket.emit('player_loadout_change', { outfit: currentOutfit, gun: currentGun });
            }
            if (statusBox) statusBox.textContent = `PUBG Weapon changed to ${btn.textContent}! Armed across armies.`;
            triggerNdiso(`Sho! Whole army equipped with ${btn.textContent}! Ready to spray! 🔫`);
        });
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyP' || (e.code === 'Escape' && !menuModal?.classList.contains('active') && !rulesModal?.classList.contains('active'))) {
            togglePauseGame();
            e.preventDefault();
            return;
        }

        if (isPaused) {
            if (e.code === 'Space' || e.code === 'Enter') {
                togglePauseGame();
                e.preventDefault();
            }
            return;
        }

        if (e.code === 'Space' || e.code === 'Enter') {
            if (rulesModal && rulesModal.classList.contains('active')) {
                rulesModal.classList.remove('active');
                e.preventDefault();
                return;
            }
            if (menuModal && menuModal.classList.contains('active')) {
                menuModal.classList.remove('active');
                e.preventDefault();
                return;
            }
            if (winModal && winModal.classList.contains('active')) {
                resetGame();
                e.preventDefault();
                return;
            }
            triggerFlick();
            e.preventDefault();
        } else if (e.code === 'KeyC' || e.code === 'KeyR') {
            if (phase !== 'IDLE' && !gameOver && !isPaused) {
                resetBallToLaunch();
                phase = 'IDLE';
                statusBox.textContent = `Ball reset to Launch Pad for Player ${currentPlayer}! Ready to flick.`;
            }
        } else if (e.code === 'Digit1' || e.code === 'KeyS') {
            if (btnSticky && !btnSticky.disabled) btnSticky.click();
        } else if (e.code === 'Digit2' || e.code === 'KeyF') {
            if (btnFoil && !btnFoil.disabled) btnFoil.click();

        } else if (e.code === 'KeyX' || e.code === 'Tab') {
            if (phase === 'IDLE' && !gameOver) {
                swapLaunchSide();
                e.preventDefault();
            }
        } else if (e.code === 'KeyA' || e.code === 'KeyZ') {
            if (phase === 'IDLE' && !gameOver) {
                cycleAimGear();
            }
        } else if (e.code === 'KeyM') {
            if (menuModal) menuModal.classList.toggle('active');
        }
    });
}

// Start Game on load
window.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
}

// PWA Service Worker Registration (`Offline Installable Web App`)
if ('serviceWorker' in navigator && typeof window !== 'undefined' && !window.Capacitor) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('PWA SW error:', err));
    });
}