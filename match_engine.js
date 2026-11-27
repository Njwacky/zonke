/* ==========================================================================
   ZONKE — STAGE 2 SERVER-AUTHORITATIVE MATCH ENGINE (pure rules module)
   --------------------------------------------------------------------------
   Deterministic game-rules engine used by server.js for ONLINE matches.
   It owns: match state, turns, wind, shot inventory (ammo), soldier
   construction/elimination, bonus interactions, special ammo, victory.

   Deliberately does NOT simulate flick physics: the client keeps its
   existing physics + animations for prediction ("zonke improvement" §6:
   preserve flick physics and UX). The server validates shot parameters
   and applies the OFFICIAL rules transition to every accepted landing;
   clients reconcile to the resulting `snapshot()`.

   All rule constants come from canonical_rules.js (Stage 0 single source
   of truth), so engine, docs and tests can never drift apart silently.

   Pure module: no sockets, no DOM, no server listen side effects — unit
   testable via require('./match_engine.js').
   ========================================================================== */

const RULES = require('./canonical_rules.js');

const TOTAL = RULES.totalRows;          // 9
const DONE = RULES.completeValue;       // 12 (GOAT)
const DEAD = RULES.deadValue;           // -1
const WIN_MAJORITY = RULES.winMajority; // 5
const WIND_POOL = RULES.wind.pool;      // [-1.4, -0.7, 0, 0, +0.7, +1.4]
const WIND_EVERY = RULES.wind.everyNTurns; // 3
const SPECIAL_AMMO = RULES.specialAmmoPerMatch; // 1

// A landing claim must be the literal 'BONUS' or an integer row 0..8.
function validRowIdx(v) {
    return v === 'BONUS' || (Number.isInteger(v) && v >= 0 && v < TOTAL);
}

// Bonus-claim plausibility: the centre circle sits on the Row5/Row6 boundary
// (index 4/5), so the reported nearest row must be in the centre band. This
// is a sanity gate on a client-reported value — trajectory truth itself stays
// client-predicted (documented Stage 2 limitation).
function validBonusNear(near) {
    return near === undefined || near === null ||
        (Number.isInteger(near) && near >= 3 && near <= 6);
}

// Fresh match state — mirrors client resetGame() + updateWind():
// rows all 0, turnCount advanced once (0 -> 1, no roll), wind 0.0, ammo 1/1.
function createMatchState() {
    const match = {
        rows: {
            1: new Array(TOTAL).fill(0),
            2: new Array(TOTAL).fill(0)
        },
        turnCount: 0,
        wind: 0.0,
        ammo: {
            1: { sticky: SPECIAL_AMMO, foil: SPECIAL_AMMO },
            2: { sticky: SPECIAL_AMMO, foil: SPECIAL_AMMO }
        },
        pendingShot: null, // { id, shooter, power, special, wind, at }
        shotSeq: 0,
        winner: 0,         // 0 = undecided, else 1 | 2
        gameOver: false
    };
    advanceWind(match);
    return match;
}

// Mirrors client updateWind(): turnCount++ first, re-roll every Nth switch.
function advanceWind(match) {
    match.turnCount++;
    if (match.turnCount % WIND_EVERY === 0) {
        match.wind = WIND_POOL[Math.floor(Math.random() * WIND_POOL.length)];
    }
    return match.wind;
}

function countGoats(rows) {
    let n = 0;
    for (const r of rows) if (r === DONE) n++;
    return n;
}

function allResolved(rows) {
    return rows.every((r) => r === DONE || r === DEAD);
}

// Official victory — mirrors client checkWinCondition(), with the tie-break
// awarded to `tieRole` (the player whose turn it is = the landing player,
// since the client checks before flipping the turn).
function checkVictory(match, tieRole) {
    const g1 = countGoats(match.rows[1]);
    const g2 = countGoats(match.rows[2]);
    if (g1 >= WIN_MAJORITY) return 1;
    if (g2 >= WIN_MAJORITY) return 2;
    if (allResolved(match.rows[1]) && allResolved(match.rows[2])) {
        if (g1 > g2) return 1;
        if (g2 > g1) return 2;
        return tieRole;
    }
    return 0;
}

// Validate an incoming flick BEFORE any state changes (mirror of the client
// button rules: specials disabled at 0 ammo; one shot in flight at a time).
function validateFlick(match, role, data) {
    if (match.gameOver) return { ok: false, reason: 'game_over' };
    if (match.pendingShot) {
        // Stale flight (client died mid-air, never landed): supersede after 15s
        // so a stuck pending shot can never deadlock the room.
        if (Date.now() - match.pendingShot.at > 15000) {
            match.pendingShot = null;
        } else {
            return { ok: false, reason: 'shot_in_flight' };
        }
    }
    const special = (data.specialShot === 'STICKY' || data.specialShot === 'FOIL')
        ? data.specialShot : 'NORMAL';
    if (special === 'STICKY' && match.ammo[role].sticky <= 0) {
        return { ok: false, reason: 'no_ammo', special };
    }
    if (special === 'FOIL' && match.ammo[role].foil <= 0) {
        return { ok: false, reason: 'no_ammo', special };
    }
    return { ok: true, special };
}

// Open the official pending shot (shot ids are strictly increasing ->
// landings can be bound to the exact shot they belong to).
function beginShot(match, role, power, special) {
    match.shotSeq += 1;
    match.pendingShot = {
        id: match.shotSeq,
        shooter: role,
        power,
        special,
        wind: match.wind,
        at: Date.now()
    };
    return match.pendingShot;
}

// Validate a landing report against the pending shot (duplicate/replay and
// impossible-report protection) WITHOUT mutating state.
function validateLanding(match, role, data) {
    if (!match.pendingShot) return { ok: false, reason: 'no_pending_shot' };
    if (match.pendingShot.shooter !== role) return { ok: false, reason: 'not_shot_owner' };
    if (data.shotId !== undefined && data.shotId !== null &&
        data.shotId !== match.pendingShot.id) {
        return { ok: false, reason: 'shot_mismatch' }; // replayed/stale landing
    }
    if (!validRowIdx(data.rowIdx)) return { ok: false, reason: 'invalid_row' };
    if (data.rowIdx === 'BONUS' && !validBonusNear(data.near)) {
        return { ok: false, reason: 'implausible_bonus' };
    }
    return { ok: true };
}

function consumeSpecial(match, role, special) {
    if (special === 'STICKY' && match.ammo[role].sticky > 0) match.ammo[role].sticky--;
    else if (special === 'FOIL' && match.ammo[role].foil > 0) match.ammo[role].foil--;
}

// Apply the OFFICIAL transition for an accepted landing. Mirrors client
// handleLanding() state changes exactly (construction, shoot-first kill,
// centre bonus, tinfoil revive, wasted turns, ammo consumption rules) while
// keeping all DOM/sound/animation concerns client-side.
function resolveLanding(match, role, rowIdx) {
    const opp = role === 1 ? 2 : 1;
    const me = match.rows[role];
    const them = match.rows[opp];
    const special = match.pendingShot ? match.pendingShot.special : 'NORMAL';
    const events = {
        bonus: false, partsAdded: 0, kills: 0,
        completed: false, wasted: false, foilRevive: false
    };

    if (rowIdx === 'BONUS') {
        // Centre bonus: +1 to every alive incomplete soldier; reaching 12 from
        // the bonus fires and kills the opponent's matching alive row (SUPER BONUS).
        events.bonus = true;
        for (let i = 0; i < TOTAL; i++) {
            if (me[i] >= 0 && me[i] < DONE) {
                me[i]++;
                events.partsAdded++;
                if (me[i] === DONE) {
                    events.completed = true;
                    if (them[i] >= 0 && them[i] < DONE) {
                        them[i] = DEAD;
                        events.kills++;
                    }
                }
            }
        }
        consumeSpecial(match, role, special); // bonus consumes the active special
    } else {
        const v = me[rowIdx];
        if (v === DEAD) {
            if (special === 'FOIL') {
                // Tinfoil revive: BOTH players reset to Stage 1 on this row.
                me[rowIdx] = 1;
                them[rowIdx] = 1;
                consumeSpecial(match, role, 'FOIL');
                events.foilRevive = true;
            } else {
                // Turn wasted; a sticky selection is preserved (not consumed) —
                // exactly what the client does today.
                events.wasted = true;
            }
        } else if (v >= DONE) {
            // Already a GOAT: wasted turn, active special consumed.
            events.wasted = true;
            consumeSpecial(match, role, special);
        } else {
            // Normal progression (+1, capped at 12 by the branch above).
            me[rowIdx] = v + 1;
            consumeSpecial(match, role, special);
            if (me[rowIdx] === DONE) {
                events.completed = true;
                // Shoot-first kill: only when the opponent's row is alive-incomplete.
                if (them[rowIdx] >= 0 && them[rowIdx] < DONE) {
                    them[rowIdx] = DEAD;
                    events.kills++;
                }
            }
        }
    }

    match.pendingShot = null;

    // Official victory — checked BEFORE the turn flip (client order), tie goes
    // to the landing player. After a winning shot the client's gameOver guard
    // prevents the turn switch and the wind roll: mirror that here.
    match.winner = checkVictory(match, role);
    let nextTurn = role === 1 ? 2 : 1;
    let windAdvanced = false;
    if (match.winner) {
        match.gameOver = true;
        nextTurn = role;
    } else {
        advanceWind(match);
        windAdvanced = true;
    }

    return {
        events,
        nextTurn,
        windAdvanced,
        winner: match.winner,
        gameOver: match.gameOver
    };
}

// Immutable snapshot for `match_found` / `match_state` / resume payloads.
function snapshot(match, currentTurn) {
    return {
        rows: { 1: match.rows[1].slice(), 2: match.rows[2].slice() },
        ammo: { 1: { ...match.ammo[1] }, 2: { ...match.ammo[2] } },
        wind: match.wind,
        turnCount: match.turnCount,
        currentTurn,
        pendingShot: match.pendingShot
            ? { id: match.pendingShot.id, shooter: match.pendingShot.shooter }
            : null,
        winner: match.winner,
        gameOver: match.gameOver
    };
}

module.exports = {
    createMatchState,
    advanceWind,
    checkVictory,
    validateFlick,
    beginShot,
    validateLanding,
    resolveLanding,
    snapshot,
    validRowIdx,
    validBonusNear,
    countGoats,
    allResolved
};
