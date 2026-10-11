// Records the demo video and a timeline for the audio mix.
//   node video/record.mjs            (needs Playwright; reads video/audio/durations.json if present)
// Writes video/raw/demo.webm and video/raw/timeline.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tool = fs.readFileSync(path.join(root, 'src/tov.js'), 'utf8');
const url = (f, q = '') => 'file://' + path.join(root, f) + q;
const card = (t, s) => url('video/card.html', `?t=${encodeURIComponent(t)}&s=${encodeURIComponent(s || '')}`);
const durFile = path.join(root, 'video/audio/durations.json');
const dur = fs.existsSync(durFile) ? JSON.parse(fs.readFileSync(durFile, 'utf8')) : {};
const need = (id, lead = 0, tail = 0) => Math.round(((dur[id] || 0) + lead + tail) * 1000);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: path.join(root, 'video/raw'), size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const t0 = Date.now();                       // video starts when the page is created
const marks = {};
const mark = (name) => { marks[name] = (Date.now() - t0) / 1000; };
const stops = [];                            // every focus during playback: { t, sev }
const wait = (ms) => page.waitForTimeout(ms);
const panelButton = (sel) => page.locator('tab-order-visualizer').locator(sel);
const untilPlaybackEnds = async () => {
  await wait(500);
  await page.waitForFunction(() => {
    const p = document.querySelector('tab-order-visualizer')?.shadowRoot.querySelector('.panel');
    return p && !p.classList.contains('min');
  }, null, { timeout: 90000 });
};
const watchStops = () => page.evaluate(() => {
  window.__stops = [];
  window.__onStop = (e) => {
    const r = window.__tabOrderVisualizer__ && window.__tabOrderVisualizer__.results;
    const it = r && r.items.find((i) => i.el === e.composedPath()[0]);
    if (it) window.__stops.push({ t: Date.now(), sev: it.sev });
  };
  window.addEventListener('focusin', window.__onStop, true);
});
const collectStops = async () => {
  const s = await page.evaluate(() => { window.removeEventListener('focusin', window.__onStop, true); return window.__stops; });
  for (const x of s) stops.push({ t: (x.t - t0) / 1000, sev: x.sev });
};
// Video only: lift the tool's playback caption so platform subtitles at the bottom don't cover it
const liftCaption = () => page.evaluate(() => {
  document.querySelector('tab-order-visualizer').shadowRoot.querySelector('style').textContent += '.caption{bottom:118px}';
});
const play = async (speed) => {
  await liftCaption();
  await panelButton('select[data-opt="speed"]').selectOption(String(speed));
  await watchStops();
  mark(stops.length ? 'play2' : 'play1');
  await page.keyboard.press('p');
  await untilPlaybackEnds();
  await collectStops();
};

// 1. Title
mark('intro');
await page.goto(card('Can you get through this page with only a keyboard?', 'Most people can’t see the path focus takes. So let’s draw it.'));
await wait(Math.max(4200, need('intro', 0.4, 0.6)));

// 2. Broken store, then playback
mark('broken');
await page.goto(url('demo/broken-store.html'));
await wait(1500);
await page.keyboard.press('Shift');                 // keyboard modality, so :focus-visible is honest
await page.addScriptTag({ content: tool });
await wait(Math.max(4000, need('broken_open', 0.6, 0.5) - 1500));
const speed1 = Math.max(550, Math.ceil(need('broken_play', 0.3, 1.2) / 25));
await play(speed1);
await wait(800);

// 3. Findings
mark('findings');
await panelButton('button[data-act="side"]').click();
await wait(400);
await panelButton('button[data-jump="0"]').click();
await wait(Math.max(3200, need('findings', 0.2, 0.6) - 400));
await page.keyboard.press('Escape');

// 4. Fixed
mark('fixed_card');
await page.goto(card('Same page, fixed', 'No outline removal, no positive tabindex, no hidden stops.'));
await wait(Math.max(2600, need('fixed_card', 0.3, 0.8)));
mark('fixed');
await page.goto(url('demo/fixed-store.html'));
await wait(1000);
await page.keyboard.press('Shift');
await page.addScriptTag({ content: tool });
mark('fixed_scanned');
await wait(2500);
await play(250);
await wait(1500);
await page.keyboard.press('Escape');

// 5. End card
mark('end');
await page.goto(url('video/card.html', '?v=end'));
await wait(Math.max(8500, need('end', 0.6, 1.8)));
mark('finish');

const video = page.video();
await ctx.close();
await browser.close();
fs.renameSync(await video.path(), path.join(root, 'video/raw/demo.webm'));
fs.writeFileSync(path.join(root, 'video/raw/timeline.json'), JSON.stringify({ marks, stops, speed1 }, null, 2));
console.log('video/raw/demo.webm  +  video/raw/timeline.json', marks);
