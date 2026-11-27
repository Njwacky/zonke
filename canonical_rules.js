/* ==========================================================================
   ZONKE - CANONICAL GAME RULES (Stage 0 single source of truth)
   --------------------------------------------------------------------------
   This file is the ONE authoritative, machine-readable definition of Zonke's
   gameplay rules as actually implemented by game.js (client engine) and
   server.js (multiplayer relay). Human-readable copy: docs/CANONICAL_RULES.md

   Stage 0 contract (see "zonke improvement" §4.2):
   - Documentation, comments and tests must match THIS file.
   - This file must match the engine (enforced by test/canonical_rules.test.js).
   - Changing a value here WITHOUT changing the engine fails CI, and changing
     gameplay rules requires explicit owner approval — this file only records
     what the engine already does.

   Verified against: game.js @ fe7b760, server.js @ fe7b760
   ========================================================================== */

const ZONKE_RULES = Object.freeze({
    // --- Battlefield -------------------------------------------------------
    totalRows: 9, // game.js: `const TOTAL_ROWS = 9;` (UI rows are 1-indexed Row 1..Row 9; code indices 0..8)
    winMajority: 5, // game.js: `const WIN_MAJORITY = 5;` (first to 5 completed soldiers wins)

    // --- Soldier construction (per row) ------------------------------------
    // Row state values: -1 = DEAD, 0 = untouched, 1..11 = in progress, 12 = complete (GOAT).
    stages: [
        { id: 1, name: "Head & Hat/Helmet" },
        { id: 2, name: "Neck/Collar" },
        { id: 3, name: "Shirt/Armor/Ribs" },
        { id: 4, name: "Arms/Stance" },
        { id: 5, name: "Lower Body/Belt" },
        { id: 6, name: "Legs & Shoes/Boots" },
        { id: 7, name: "Gun/Laser/Bone Rifle" },
        { id: 8, name: "Bullet 1" },
        { id: 9, name: "Bullet 2" },
        { id: 10, name: "Bullet 3" },
        { id: 11, name: "Bullet 4" },
        { id: 12, name: "Bullet 5 (Complete & Shoot 1st!)" }
    ],
    completeValue: 12, // a row is a GOAT exactly when its value === 12
    deadValue: -1,

    // --- Elimination ("Shoot First or Die") --------------------------------
    // Completing row i (value 12) kills the opponent's row i when it is alive
    // but incomplete (0..11). Dead rows (-1) can never be built on again.
    shootFirstKill: true,

    // --- Center bonus (--⭕--) --------------------------------------------
    // Circle at the exact geometric center of the 9-row target area:
    //   centerX = boardWidth * 0.50, centerY = topOffset + targetHeight * 0.50
    // i.e. on the boundary between Row 5 and Row 6 (1-indexed).
    // Awarded only when the settling ball CENTER is within bonusRadiusPx.
    bonus: {
        radiusPx: 30.0,
        centerYFactor: 0.50,
        centerXFactor: 0.50,
        // Effect: +1 stage to EVERY alive incomplete soldier of the landing
        // player; any soldier that reaches 12 from the bonus fires and kills
        // the opponent's matching row ("SUPER BONUS").
        affectsAllAliveSoldiers: true,
        bonusKillsOnCompletion: true
    },

    // --- Special ammo (1 each per match, per player) -----------------------
    specialAmmoPerMatch: 1,
    sticky: { damping: 0.12 }, // near-zero wall bounce
    normalDamping: 0.82,
    // Tinfoil revive on OWN dead row: resets BOTH players on that row to
    // stage 1 (fresh race), consumes the foil.
    foilRevive: { resetsBothPlayersToStage: 1 },

    // --- Dynamic Stoep Wind ------------------------------------------------
    // Re-rolled on every 3rd turn switch: turnCount % 3 === 0.
    wind: {
        everyNTurns: 3,
        pool: [-1.4, -0.7, 0.0, 0.0, +0.7, +1.4] // weighted: calm appears twice
    },

    // --- Victory conditions ------------------------------------------------
    // 1) First to `winMajority` completed (12) rows wins immediately.
    // 2) If every row on BOTH sides is resolved (completed or dead), the
    //    higher goat count wins; an exact tie awards the win to the player
    //    whose turn it is (as implemented in checkWinCondition()).
    victory: {
        primary: "first-to-majority",
        tieBreak: "all-rows-resolved: higher goat count wins, exact tie -> current player"
    },

    // --- Career rewards (client-awarded today; must become server-authoritative in Stage 4) ---
    rewards: {
        win: { xp: 150, coins: 50 },
        loss: { xp: 35, coins: 15 }
    },
    ranks: [
        { minXp: 7500, title: "👑 ARENA GOAT LEGEND" },
        { minXp: 4000, title: "💎 Tactical Master" },
        { minXp: 2200, title: "🥇 Street Boss" },
        { minXp: 1200, title: "Arena Commander" },
        { minXp: 600, title: "Tactical Striker" },
        { minXp: 250, title: "Arena Hustler" },
        { minXp: 0, title: "Street Novice" }
    ],

    // --- Multiplayer server enforcement (server.js + match_engine.js) ------
    server: {
        // Payload clamps applied to every incoming game event:
        powerClamp: [0, 100],
        // Stage 2: rowIdx must be an integer 0..totalRows-1 or the literal
        // 'BONUS' — out-of-range landing reports are REJECTED (not clamped).
        rowIdxValidation: "integer 0..totalRows-1 or 'BONUS', else rejected",
        // Turn anti-cheat: an event from the player whose turn it is NOT is dropped.
        turnLock: true,
        // Stage 2: the server owns the wind (rolls from wind.pool every
        // wind.everyNTurns turn switches); client wind claims are ignored.
        windOwnedByServer: true,
        // Stage 2: every flick gets a server-issued shot id; landings must
        // reference the open pending shot (duplicate/replay protection).
        shotIdsReplayProtected: true,
        // Reliability / abuse limits:
        disconnectGraceSeconds: 45,
        inviteRoomTtlMinutes: 15,
        inviteRoomMax: 500,
        hostSurvivalGraceMinutes: 5
    },

    // --- Trust model (honest current-state declaration) --------------------
    // Stage 2 status: the server runs a deterministic rules engine
    // (match_engine.js) that owns match state, turns, wind, shot inventory,
    // construction/elimination, bonus/foil interactions and official victory.
    // Flick PHYSICS and animations remain client-side for prediction and UX;
    // the server validates shot parameters and applies the official transition
    // to every accepted landing, and clients reconcile to match_state.
    authority: "server-authoritative rules engine (state/turns/wind/ammo/transitions/victory); client-predicted flick physics + animations"
});

// Load in Node (tests) and in a browser via a plain <script> tag if desired.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZONKE_RULES;
}
if (typeof globalThis !== 'undefined') {
    globalThis.ZONKE_RULES = ZONKE_RULES;
}
