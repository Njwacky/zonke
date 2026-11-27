/* ==========================================================================
   Stage 0 — JavaScript syntax quality gate.
   Runs `node --check` on every shipped JS file. This is a SYNTAX gate only;
   gameplay behaviour is covered by canonical_rules.test.js and
   server.integration.test.js (a syntax check is NOT a gameplay test).
   ========================================================================== */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

// Every JavaScript file the product ships (entry points + shared rules + SW).
const SHIPPED_JS = ['server.js', 'game.js', 'sw.js', 'canonical_rules.js'];

for (const file of SHIPPED_JS) {
    test(`syntax: node --check ${file}`, () => {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must exist`);
        execFileSync(process.execPath, ['--check', path.join(ROOT, file)], {
            stdio: 'pipe'
        });
    });
}

test('syntax: all test files parse (guards the test suite itself)', () => {
    const testDir = __dirname;
    const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 4, 'expected the Stage 0 test suite to exist');
    for (const f of files) {
        execFileSync(process.execPath, ['--check', path.join(testDir, f)], {
            stdio: 'pipe'
        });
    }
});
