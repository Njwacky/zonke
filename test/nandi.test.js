const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../for-nandi');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

test('Nandi gift preserves the corrected name, language and removed story section', () => {
  assert.match(html, /Nandi Nxumalo/);
  assert.match(html, /Manxumalo/);
  assert.match(html, /lang="zu"/);
  assert.match(html, /noma ukude/);
  assert.doesNotMatch(html + script, /Nobuhle|maGcwanini|noma sikude/i);
  assert.doesNotMatch(html, /<p class="kicker">Indaba yethu<\/p>/i);
});

test('all internal links have unique targets and all six letters contain messages', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `Missing anchor ${target}`);
  }
  const notes = [...html.matchAll(/data-title="([^"]+)" data-body="([^"]+)"/g)];
  assert.equal(notes.length, 6);
  for (const [, title, body] of notes) {
    assert.ok(title.startsWith('Uma '));
    assert.ok(body.length > 50);
  }
});

test('fonts are self-hosted with licenses; unfinished content is hidden by default', () => {
  const fonts = [...css.matchAll(/url\(["']?(fonts\/[^)"']+\.woff2)["']?\)/g)];
  assert.equal(fonts.length, 7);
  for (const [, asset] of fonts) {
    assert.ok(fs.existsSync(path.join(root, asset)), `Missing font ${asset}`);
  }
  assert.ok(fs.existsSync(path.join(root, 'fonts/cormorant-garamond-LICENSE.txt')));
  assert.ok(fs.existsSync(path.join(root, 'fonts/dm-sans-LICENSE.txt')));
  assert.doesNotMatch(html, /fonts\.googleapis\.com|spotify\.com\/search/);
  assert.match(html, /id="memories">/);
  assert.match(html, /id="playlistSection" hidden/);
});

test('animation script parses and exposes reduced-motion and pause controls', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(script, /visibilitychange/);
  assert.match(html, /id="motionToggle" aria-pressed="false"/);
  assert.match(html, /id="modal" role="dialog" aria-modal="true"/);
});

test('gallery includes two portraits and two requested chats with keyboard-accessible viewers', () => {
  const photos = [...html.matchAll(/src="(photos\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(photos, ['photos/photo1.jpg', 'photos/photo2.jpg', 'photos/chat1.jpg', 'photos/chat2.jpg']);
  for (const asset of photos) {
    assert.ok(fs.existsSync(path.join(root, asset)));
  }
  assert.equal((html.match(/class="photo-open" type="button"/g) || []).length, 4);
  assert.doesNotMatch(html, /Screenshot_20261124|WhatsAppBusiness/);
});


test('dialogs have independent scroll regions and gallery works before scripting', () => {
  assert.match(html, /class="modal-content"/);
  assert.match(html, /class="lightbox-viewport"/);
  assert.doesNotMatch(html, /id="memories" hidden/);
  assert.match(script, /element.inert = true/);
  assert.match(script, /inertSnapshot.clear/);
});


test('pink is the page background, not just an accent', () => {
  assert.match(css, /--page:\s*#ffd2e6/);
  assert.match(css, /body\s*\{[^}]*background:\s*var\(--page\)/);
  assert.match(html, /name="theme-color" content="#ffd2e6"/);
});
