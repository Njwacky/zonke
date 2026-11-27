/* ==========================================================================
   Stage 0 — Entry-point & configuration contract tests.
   Locks down the answer to "which file is the real application entry point"
   (see "zonke improvement" §4): index.html is canonical; zonke.html is a
   preserved legacy snapshot. If anyone flips the PWA/manifest/server to a
   different entry, these tests fail.
   ========================================================================== */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const indexHtml = read('index.html');
const swSrc = read('sw.js');
const readme = read('README.md');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

test('entrypoint: index.html is the canonical entry (links external CSS/JS only)', () => {
    assert.ok(indexHtml.includes('<link rel="stylesheet" href="style.css">'),
        'index.html must link style.css');
    assert.ok(indexHtml.includes('<script src="game.js"></script>'),
        'index.html must load game.js');
    // RULES.md §Clean Separation: no inline <style>/<script> blocks in index.html.
    assert.ok(!indexHtml.includes('<style>'), 'index.html must not contain inline <style>');
    assert.ok(!indexHtml.includes('<script>'), 'index.html must not contain inline <script>');
});

test('entrypoint: PWA manifest launches index.html', () => {
    assert.equal(manifest.start_url, 'index.html',
        'manifest.start_url must stay on index.html');
    assert.ok(manifest.icons && manifest.icons.length > 0, 'manifest must keep icons');
});

test('entrypoint: service worker caches index.html and never caches live API traffic', () => {
    assert.match(swSrc, /'index\.html'/, 'sw.js must precache index.html');
    assert.match(swSrc, /'style\.css'/, 'sw.js must precache style.css');
    assert.match(swSrc, /'game\.js'/, 'sw.js must precache game.js');
    assert.match(swSrc, /NEVER_CACHE = \['\/api\/', '\/socket\.io\/', '\/telemetry'\]/,
        'sw.js must bypass cache for API/socket/telemetry traffic');
    assert.ok(!swSrc.includes('zonke.html'), 'service worker must not cache the legacy zonke.html');
});

test('entrypoint: zonke.html is preserved but is NOT wired as an entry point', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'zonke.html')),
        'legacy zonke.html must be preserved (no feature/file removal in Stage 0)');
    assert.ok(!JSON.stringify(manifest).includes('zonke.html'),
        'zonke.html must not become the PWA entry without an approved decision');
    assert.ok(!readme.includes('zonke.html](') || readme.includes('legacy'),
        'README must describe zonke.html as legacy if it mentions it');
});

test('entrypoint: README quick-start points at index.html and canonical rules', () => {
    assert.ok(readme.includes('index.html'), 'README must document the real entry point');
    assert.ok(readme.includes('docs/CANONICAL_RULES.md'),
        'README must link the canonical rules definition');
    assert.ok(readme.includes('12 stages') || readme.includes('12-stage'),
        'README must keep the (correct) 12-stage construction description');
});

test('contract: package.json exposes syntax check + test gates, engines >= 18', () => {
    assert.ok(pkg.scripts.check, 'npm run check (syntax gate) must exist');
    assert.ok(pkg.scripts.test, 'npm test (test gate) must exist');
    assert.match(pkg.engines.node, />=18/);
    assert.ok(pkg.devDependencies && pkg.devDependencies['socket.io-client'],
        'socket.io-client is required by the multiplayer integration tests');
});

test('contract: canonical rules artifacts exist and agree on the headline numbers', () => {
    const rulesDoc = read(path.join('docs', 'CANONICAL_RULES.md'));
    const rulesJs = read('canonical_rules.js');
    assert.ok(rulesDoc.includes('TOTAL_ROWS = 9'), 'rules doc must state 9 rows');
    assert.ok(rulesDoc.includes('WIN_MAJORITY = 5'), 'rules doc must state first-to-5');
    assert.ok(rulesJs.includes('totalRows: 9'), 'canonical_rules.js must state 9 rows');
    assert.ok(rulesJs.includes('winMajority: 5'), 'canonical_rules.js must state first-to-5');
    // Legacy claims must not survive in README as current truth.
    assert.ok(!/12-row alignment/.test(readme),
        'README must not claim a 12-row battlefield (engine is 9 rows)');
});
