// End-to-end checks in real Chromium: node tests/run.mjs
// 1. The computed tab order matches what pressing Tab actually does.
// 2. Every planted bug in the broken store is found.
// 3. The fixed store produces no findings.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tool = fs.readFileSync(path.join(root, 'src/tov.js'), 'utf8');
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let failures = 0;

async function open(file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => { throw e; });
  await page.goto('file://' + path.join(root, file.includes('/') ? file : path.join('demo', file)));
  return page;
}

const label = () => {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a === document.body ? null : `${a.localName}:${(a.textContent || a.type || '').trim().slice(0, 24)}`;
};

async function realTabOrder(page) {
  const seen = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(label);
    if (!d || d === seen[0]) break;
    seen.push(d);
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  return seen;
}

async function scan(page) {
  await page.keyboard.press('Shift'); // keyboard modality
  await page.addScriptTag({ content: tool });
  return page.evaluate(() => {
    const r = window.__tabOrderVisualizer__.results;
    const name = (el) => `${el.localName}:${(el.textContent || el.type || '').trim().slice(0, 24)}`;
    return {
      order: r.items.map((i) => name(i.el)),
      findings: r.items.flatMap((i) => i.issues.map((x) => `${x.code}@${i.name}`)),
      clickables: r.clickables.map((c) => `${c.sev}@${c.name}`),
    };
  });
}

async function test(title, fn) {
  try { await fn(); console.log(`✓ ${title}`); }
  catch (e) { failures++; console.log(`✗ ${title}\n  ${e.message.split('\n').join('\n  ')}`); }
}

for (const file of ['broken-store.html', 'fixed-store.html']) {
  await test(`${file}: computed order matches real Tab presses`, async () => {
    const page = await open(file);
    const real = await realTabOrder(page);
    const { order } = await scan(page);
    assert.deepEqual(order, real);
    await page.close();
  });
}

await test('broken-store.html: every planted bug is found', async () => {
  const page = await open('broken-store.html');
  const { findings, clickables } = await scan(page);
  const has = (code, name) => assert.ok(findings.includes(`${code}@${name}`), `missing ${code} on "${name}"`);
  has('POSITIVE_TABINDEX', 'Sale');
  has('POSITIVE_TABINDEX', 'Back to top');
  has('FOCUS_JUMP', 'Sale');
  has('FOCUS_JUMP', 'See the lookbook');           // CSS order swap
  for (const n of ['Account', 'Orders', 'Sign out']) has('HIDDEN_FOCUSABLE', n); // closed drawer
  has('CLIPPED_FOCUSABLE', 'Slide 2: Trail runners');
  has('HIDDEN_FOCUSABLE', 'Hidden promo link');
  has('HIDDEN_FOCUSABLE', 'Invisible coupon');
  has('ARIA_HIDDEN_FOCUSABLE', 'Decorative icon link');
  has('NO_FOCUS_INDICATOR', 'Tents');
  has('NO_FOCUS_INDICATOR', 'Open cart');
  assert.deepEqual(clickables.sort(), ['error@Add to bag', 'error@Add to bag', 'warn@Notify me']);
  // correct patterns must stay clean
  // The skip link is off-screen until focused: that's the correct pattern, not a hidden stop.
  // (It does get a FOCUS_JUMP, which is real: tabindex="3" on "Sale" sends focus right-to-left into it.)
  assert.ok(!findings.some((f) => /^(HIDDEN|NO_FOCUS)/.test(f) && f.endsWith('@Skip to content')), 'skip link flagged as hidden');
  for (const n of ['Correct focus style', 'Email', 'Subscribe']) {
    assert.ok(!findings.some((f) => f.endsWith(`@${n}`)), `false positive on "${n}"`);
  }
  await page.close();
});

await test('fixed-store.html: no findings', async () => {
  const page = await open('fixed-store.html');
  const { findings, clickables } = await scan(page);
  assert.deepEqual([...findings, ...clickables], []);
  await page.close();
});

await test('running the script twice toggles it off', async () => {
  const page = await open('broken-store.html');
  await page.addScriptTag({ content: tool });
  await page.addScriptTag({ content: tool });
  assert.equal(await page.evaluate(() => !!document.querySelector('tab-order-visualizer') || !!window.__tabOrderVisualizer__), false);
  await page.close();
});

await test('search panel with a focus trap: scan has no side effects', async () => {
  const page = await open('tests/fixtures/search-trap.html');
  const { findings } = await scan(page);
  assert.deepEqual(findings, [], 'focus trap leaked into the scan');
  assert.equal(await page.evaluate(() => document.getElementById('fly').classList.contains('open')), false, 'scan opened the search panel');
  await page.close();
});

await test('Esc in a search box goes to the page, not the tool', async () => {
  const page = await open('tests/fixtures/search-trap.html');
  await page.addScriptTag({ content: tool });
  await page.focus('#q');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('fly').classList.contains('open')), false, 'site search did not close');
  assert.equal(await page.evaluate(() => !!window.__tabOrderVisualizer__), true, 'tool closed');
  await page.keyboard.press('Alt+Shift+KeyR');               // re-scan works while typing
  assert.ok(await page.evaluate(() => window.__tabOrderVisualizer__.results.items.length === 6));
  await page.close();
});

await test('reports download as HTML, CSV and Markdown', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('file://' + path.join(root, 'demo/broken-store.html'));
  await page.addScriptTag({ content: tool });
  const ui = (sel) => page.locator('tab-order-visualizer').locator(sel);
  for (const [fmt, ext, must] of [['html', 'html', '<h1>Tab order report</h1>'], ['csv', 'csv', 'CSS selector'], ['md', 'md', '## Findings']]) {
    await ui('select[data-opt="format"]').selectOption(fmt);
    const [dl] = await Promise.all([page.waitForEvent('download'), ui('button[data-act="download"]').click()]);
    assert.match(dl.suggestedFilename(), new RegExp(`^tab-order-report-.+\\.${ext}$`));
    const text = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(text.includes(must), `${fmt} report missing "${must}"`);
    const sel = 'header > nav > a:nth-of-type(3)';
    assert.ok(text.includes(fmt === 'html' ? sel.replace(/>/g, '&gt;') : sel), `${fmt} report missing selector`);
  }
  await page.close();
});

await test('privacy: no network requests, no cookies or storage, no residue on the page', async () => {
  const context = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto('file://' + path.join(root, 'demo/broken-store.html'));
  await page.evaluate(() => { localStorage.setItem('k', 'v'); sessionStorage.setItem('k', 'v'); });
  const before = await page.evaluate(() => ({
    html: document.documentElement.outerHTML, ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), cookie: document.cookie }));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.evaluate(tool);                                 // same way the bookmarklet runs it
  const ui = (sel) => page.locator('tab-order-visualizer').locator(sel);
  await page.keyboard.press('r');
  await ui('select[data-opt="speed"]').selectOption('250');
  await page.keyboard.press('p');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');                      // stop playback
  for (const fmt of ['html', 'csv', 'md']) {
    await ui('select[data-opt="format"]').selectOption(fmt);
    await Promise.all([page.waitForEvent('download'), ui('button[data-act="download"]').click()]);
  }
  await ui('button[data-act="copy"]').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__tabOrderVisualizer__.destroy());
  const after = await page.evaluate(() => ({
    html: document.documentElement.outerHTML, ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), cookie: document.cookie }));
  const external = requests.filter((u) => !u.startsWith('blob:') && !u.startsWith('file:'));
  assert.deepEqual(external, [], `network requests made: ${external.join(', ')}`);
  assert.equal(after.ls, before.ls, 'localStorage changed');
  assert.equal(after.ss, before.ss, 'sessionStorage changed');
  assert.equal(after.cookie, before.cookie, 'cookies changed');
  assert.equal(after.html, before.html, 'page DOM changed after closing the tool');
  await context.close();
});

await test('security: hostile page text cannot run code in the panel or reports', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss());
  await page.goto('file://' + path.join(root, 'tests/fixtures/hostile.html'));
  await page.addScriptTag({ content: tool });
  await page.locator('tab-order-visualizer').locator('li button').first().hover();
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'code ran in the panel');
  const ui = (sel) => page.locator('tab-order-visualizer').locator(sel);
  await ui('select[data-opt="format"]').selectOption('html');
  const [dl] = await Promise.all([page.waitForEvent('download'), ui('button[data-act="download"]').click()]);
  const reportPath = await dl.path();
  const viewer = await context.newPage();
  viewer.on('dialog', (d) => d.dismiss());
  await viewer.goto('file://' + reportPath);
  assert.equal(await viewer.evaluate(() => window.__pwned), undefined, 'code ran in the HTML report');
  assert.equal(await viewer.evaluate(() => document.querySelectorAll('script, svg, img').length), 0, 'markup injected into report');
  await ui('select[data-opt="format"]').selectOption('csv');
  const [csv] = await Promise.all([page.waitForEvent('download'), ui('button[data-act="download"]').click()]);
  const text = fs.readFileSync(await csv.path(), 'utf8');
  const cells = text.split(/\r\n/).slice(1).flatMap((l) => l.match(/("([^"]|"")*"|[^,]*)/g));
  assert.ok(!cells.some((c) => /^"?[=+\-@]/.test(c)), 'CSV cell could run as a spreadsheet formula');
  await context.close();
});

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
