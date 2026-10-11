// Builds dist/bookmarklet.txt, dist/install.html and copies the script into extension/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { minify } from 'terser';

const src = readFileSync('src/tov.js', 'utf8');
const { code } = await minify(src, { compress: { passes: 2 }, mangle: true, format: { comments: false } });

const bookmarklet = 'javascript:' + encodeURIComponent(code);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/tov.min.js', code);
writeFileSync('dist/bookmarklet.txt', bookmarklet);
copyFileSync('src/tov.js', 'extension/tov.js');

const install = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install Tab Order Visualizer</title>
<style>
  body { font: 17px/1.55 system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; color: #18203a; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .drag { display: inline-block; margin: 20px 0; padding: 12px 20px; border-radius: 999px; background: #2547d0; color: #fff;
          font-weight: 700; text-decoration: none; border: 3px dashed transparent; }
  .drag:focus-visible { outline: 3px solid #e2008a; outline-offset: 3px; }
  ol li { margin-bottom: 6px; }
  textarea { width: 100%; height: 90px; font: 12px ui-monospace, monospace; }
</style></head><body>
<h1>Tab Order Visualizer</h1>
<p>Shows the keyboard path through any page, and flags the stops that break it.</p>
<a class="drag" href="${bookmarklet.replace(/"/g, '&quot;')}">Tab Order Visualizer</a>
<ol>
  <li>Show your bookmarks bar (Ctrl/Cmd + Shift + B).</li>
  <li>Drag the blue button above onto the bar.</li>
  <li>On any page, click the bookmark. Click it again (or press Esc) to close.</li>
</ol>
<p>Can't drag? Create a bookmark by hand and paste this as its URL:</p>
<label for="code">Bookmarklet code</label>
<textarea id="code" readonly>${bookmarklet.replace(/</g, '&lt;')}</textarea>
<p>Keys while open: <b>P</b> play the path, <b>R</b> re-scan, <b>Esc</b> stop or close.</p>
</body></html>`;
writeFileSync('dist/install.html', install);

// GitHub Pages site (served from /docs): install page plus both demo stores
mkdirSync('docs/demo', { recursive: true });
writeFileSync('docs/index.html', install.replace('</body>',
  '<h2>Try it</h2><p><a href="demo/broken-store.html">Broken demo store</a> · <a href="demo/fixed-store.html">Fixed demo store</a> · ' +
  '<a href="https://github.com/YOUR-USERNAME/tab-order-visualizer">Source on GitHub</a></p></body>'));
copyFileSync('demo/broken-store.html', 'docs/demo/broken-store.html');
copyFileSync('demo/fixed-store.html', 'docs/demo/fixed-store.html');

// Chrome Web Store upload package
rmSync('dist/tab-order-visualizer-extension.zip', { force: true });
execSync('zip -qr ../dist/tab-order-visualizer-extension.zip .', { cwd: 'extension' });
console.log(`Built: ${code.length} bytes minified, bookmarklet ${bookmarklet.length} chars`);
