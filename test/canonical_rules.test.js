/* ==========================================================================
   Stage 0 — Game-rule regression tests.
   Asserts that the canonical rules definition (canonical_rules.js) and the
   actual engine (game.js) / server (server.js) source AGREE. Any drift —
   someone changing a rule in code without updating the canonical definition,
   or vice versa — fails CI. This is the enforcement arm of "zonke improvement"
   §4.2 (one canonical rules definition).
   ========================================================================== */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RULES = require(path.join(ROOT, 'canonical_rules.js'));
const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractStages(src) {
    const m = src.match(/const STAGES = \[([\s\S]*?)\];/);
    assert.ok(m, 'game.js must declare the STAGES array');
    // Trusted repo source only — parses the literal array of object literals.
    return Function(`return [${m[1]}]`)();
}

function extractRankFn(src) {
    const m = src.match(/function getRankInfo\(xp\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'game.js must declare getRankInfo()');
    return Function(`${m[0]}; return getRankInfo;`)();
}

/* ---------------------------- Battlefield -------------------------------- */

test('rules: TOTAL_ROWS in engine matches canonical rules (9 rows)', () => {
    assert.match(gameSrc, /const TOTAL_ROWS = 9;/, 'engine must declare TOTAL_ROWS = 9');
    assert.equal(RULES.totalRows, 9);
});

test('rules: WIN_MAJORITY in engine matches canonical rules (first to 5)', () => {
    assert.match(gameSrc, /const WIN_MAJORITY = 5;/, 'engine must declare WIN_MAJORITY = 5');
    assert.equal(RULES.winMajority, 5);
});

test('rules: server rowIdx clamp matches canonical rows (0..8, BONUS passthrough)', () => {
    assert.equal(RULES.server.rowIdxClamp[1], RULES.totalRows - 1,
        'canonical row clamp must match totalRows');
    assert.match(serverSrc, /clampNumber\(cleanRowIdx, 0, 8, 0\)/,
        'server must clamp rowIdx to 0..8 (totalRows - 1)');
    assert.match(serverSrc, /cleanRowIdx !== 'BONUS'/,
        'server must allow the literal BONUS rowIdx');
});

/* --------------------------- Construction -------------------------------- */

test('rules: 12 construction stages match engine STAGES exactly', () => {
    const engineStages = extractStages(gameSrc);
    assert.equal(engineStages.length, RULES.stages.length, 'stage count drift');
    for (let i = 0; i < RULES.stages.length; i++) {
        assert.equal(engineStages[i].id, RULES.stages[i].id, `stage ${i} id drift`);
        assert.equal(engineStages[i].name, RULES.stages[i].name, `stage ${i} name drift`);
    }
    assert.equal(RULES.stages.length, 12);
    assert.equal(RULES.completeValue, 12);
});

test('rules: completion (GOAT) detection uses value === 12', () => {
    assert.match(gameSrc, /player1Rows\.filter\(r => r === 12\)\.length/,
        'engine must count completed rows as value 12');
    assert.match(gameSrc, /newProgress === 12/, 'engine must complete a soldier at stage 12');
});

/* --------------------------- Elimination --------------------------------- */

test('rules: shoot-first kill logic present (kills incomplete opponent row)', () => {
    assert.equal(RULES.shootFirstKill, true);
    assert.match(gameSrc,
        /opponentRows\[soldierIdx\] >= 0 && opponentRows\[soldierIdx\] < 12/,
        'engine must only kill an alive, incomplete opponent row');
    assert.match(gameSrc, /opponentRowsArray\[soldierIdx\] = -1/,
        'engine must mark killed rows as -1 (dead)');
});

/* ------------------------------ Bonus ------------------------------------ */

test('rules: center bonus circle geometry + radius match canonical rules', () => {
    assert.equal(RULES.bonus.radiusPx, 30.0);
    assert.match(gameSrc, /distToBonus <= 30\.0/,
        'engine must award BONUS only inside the 30px circle');
    assert.match(gameSrc, /bonusCenterX = boardRect\.width \* 0\.50/,
        'engine must center the bonus horizontally at 50%');
    assert.match(gameSrc, /bonusCenterY = topOffset \+ \(targetAreaHeight \* 0\.50\)/,
        'engine must center the bonus vertically at 50% (Row 5 / Row 6 boundary)');
});

test('rules: bonus upgrades ALL alive incomplete soldiers and can trigger kills', () => {
    assert.equal(RULES.bonus.affectsAllAliveSoldiers, true);
    assert.match(gameSrc, /if \(currentRows\[i\] >= 0 && currentRows\[i\] < 12\) \{\s*\n\s*currentRows\[i\]\+\+;/,
        'engine must +1 every alive incomplete soldier on BONUS');
    assert.match(gameSrc, /eliminateOpponentSoldier\(opponentPrefix, i, opponentRows\)/,
        'engine must apply shoot-first kills from bonus completions');
});

/* --------------------------- Special ammo -------------------------------- */

test('rules: sticky damping 0.12 / normal damping 0.82 match engine', () => {
    assert.equal(RULES.sticky.damping, 0.12);
    assert.equal(RULES.normalDamping, 0.82);
    assert.match(gameSrc,
        /const damping = activeSpecialShot === 'STICKY' \? 0\.12 : 0\.82/,
        'engine damping constants drifted from canonical rules');
});

test('rules: tinfoil revive resets BOTH players on the row to stage 1', () => {
    assert.equal(RULES.foilRevive.resetsBothPlayersToStage, 1);
    assert.match(gameSrc,
        /currentRows\[soldierIdx\] = 1;[\s\S]{0,160}opponentRows\[soldierIdx\] = 1;/,
        'engine must reset both players on a FOIL revive');
});

test('rules: special ammo limited to 1 per player per match', () => {
    assert.equal(RULES.specialAmmoPerMatch, 1);
    assert.match(gameSrc, /let p1Sticky = 1, p2Sticky = 1;/);
    assert.match(gameSrc, /let p1Foil = 1, p2Foil = 1;/);
});

/* ------------------------------- Wind ------------------------------------ */

test('rules: wind re-rolls every 3rd turn from the canonical pool', () => {
    assert.match(gameSrc, /if \(turnCount % 3 === 0\)/,
        'engine must re-roll wind every 3 turns');
    const m = gameSrc.match(/const winds = \[([^\]]+)\];/);
    assert.ok(m, 'engine must declare the wind pool');
    const enginePool = m[1].split(',').map((s) => Number(s.trim()));
    assert.deepEqual(enginePool, RULES.wind.pool, 'wind pool drifted from canonical rules');
    assert.equal(RULES.wind.everyNTurns, 3);
});

/* ----------------------------- Victory ----------------------------------- */

test('rules: victory = first to WIN_MAJORITY, with all-rows-resolved fallback', () => {
    assert.match(gameSrc, /if \(p1Goats >= WIN_MAJORITY\)/);
    assert.match(gameSrc, /else if \(p2Goats >= WIN_MAJORITY\)/);
    assert.match(gameSrc,
        /p1Goats \+ p1Dead === TOTAL_ROWS && p2Goats \+ p2Dead === TOTAL_ROWS/,
        'engine must end the match when every row is resolved');
});

/* ------------------------- Rewards & ranks ------------------------------- */

test('rules: XP/coin rewards match engine', () => {
    assert.equal(RULES.rewards.win.xp, 150);
    assert.equal(RULES.rewards.win.coins, 50);
    assert.equal(RULES.rewards.loss.xp, 35);
    assert.equal(RULES.rewards.loss.coins, 15);
    assert.match(gameSrc, /myProfile\.xp \+= 150;/);
    assert.match(gameSrc, /myProfile\.coins \+= 50;/);
    assert.match(gameSrc, /myProfile\.xp \+= 35;/);
    assert.match(gameSrc, /myProfile\.coins \+= 15;/);
});

test('rules: rank ladder matches engine getRankInfo() at every threshold', () => {
    const getRankInfo = extractRankFn(gameSrc);
    for (const { minXp, title } of RULES.ranks) {
        assert.equal(getRankInfo(minXp), title,
            `rank drift at xp=${minXp}`);
    }
    assert.equal(getRankInfo(100000), '👑 ARENA GOAT LEGEND');
});

/* --------------------- Server enforcement (current state) ---------------- */

test('server: turn lock + payload clamps enforced (anti-cheat baseline)', () => {
    assert.equal(RULES.server.turnLock, true);
    assert.match(serverSrc, /room\.currentTurn !== socket\.playerRole/,
        'server must reject out-of-turn events');
    assert.match(serverSrc, /clampNumber\(data\?\.power, 0, 100, 50\)/);
    assert.match(serverSrc, /clampNumber\(data\?\.wind, -2\.0, 2\.0/);
    assert.equal(RULES.server.powerClamp[1], 100);
    assert.deepEqual(RULES.server.windClamp, [-2.0, 2.0]);
});

test('server: reliability limits (45s grace, 15m TTL, 500 room cap, 5m host grace)', () => {
    assert.match(serverSrc, /}, 45000\)/, '45s disconnect grace window');
    assert.match(serverSrc, /15 \* 60 \* 1000/, '15-minute invite room TTL');
    assert.match(serverSrc, /Object\.keys\(inviteRooms\)\.length >= 500/, '500 invite room cap');
    assert.match(serverSrc, /}, 300000\)/, '5-minute host survival grace');
    assert.equal(RULES.server.disconnectGraceSeconds, 45);
    assert.equal(RULES.server.inviteRoomTtlMinutes, 15);
    assert.equal(RULES.server.inviteRoomMax, 500);
    assert.equal(RULES.server.hostSurvivalGraceMinutes, 5);
});

/* --------------------------- Trust model --------------------------------- */

test('canonical rules honestly declare the Stage 0 trust model', () => {
    assert.equal(RULES.authority,
        'client-predicted physics; server validates turn order + payload clamps',
        'Stage 0 must NOT claim server-authoritative physics (that is Stage 2)');
});
