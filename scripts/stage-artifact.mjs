/**
 * Stage the built app for publishing as a Claude artifact.
 *
 * The artifact page is not `dist/index.html` verbatim: it needs a small wrapper
 * so the app sizes itself to the artifact host's viewport rather than to
 * `100vh`, which the sandbox's safe-area padding otherwise breaks. What it must
 * never do is carry hand-written asset names.
 *
 * It used to. The links were patched before each publish with a regex that had
 * `.js` hard-coded, so the stylesheet href was never updated. That went
 * unnoticed while the CSS hash happened not to change, and the moment it did,
 * the published page linked to a file that the same publish had just deleted:
 * a 404 stylesheet, every Tailwind class inert, and the whole app rendered as
 * bare unstyled HTML.
 *
 * So this script derives everything from the real build, and refuses to hand
 * over a page that references an asset it is not also publishing.
 *
 *   npm run stage:artifact
 *
 * It prints the `files` map to pass to the Artifact tool.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(root, '.artifact');

/** Every `assets/...` path the built index references, whatever its extension. */
function referencedAssets(html) {
  return [...new Set([...html.matchAll(/(?:href|src)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]))];
}

/** The <link> and <script> tags for those assets, in a stable order. */
function tagsFor(assets) {
  const css = assets.filter((a) => a.endsWith('.css'));
  const js = assets.filter((a) => a.endsWith('.js'));
  return [
    ...css.map((a) => `<link rel="stylesheet" href="${a}">`),
    ...js.map((a) => `<script type="module" src="${a}"></script>`),
  ];
}

const distIndex = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = referencedAssets(distIndex);
if (assets.length === 0) {
  throw new Error('dist/index.html references no assets - was the app built?');
}

const [stylesheets, scripts] = [
  tagsFor(assets).filter((t) => t.startsWith('<link')),
  tagsFor(assets).filter((t) => t.startsWith('<script')),
];

const page = `<title>Arplace Panel Studio</title>
${stylesheets.join('\n')}
<style>
  /* The app sizes itself to the host viewport rather than 100vh, so it fits
     inside the safe-area padding the artifact skeleton applies to :root. */
  html,
  body {
    height: 100%;
    background: #f1f5f9;
  }

  #root {
    height: 100%;
  }
</style>
<div id="root"></div>
${scripts.join('\n')}
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });

const built = readdirSync(join(dist, 'assets'));
for (const name of built) {
  copyFileSync(join(dist, 'assets', name), join(outDir, 'assets', name));
}

const pagePath = join(outDir, 'panel-studio.html');
writeFileSync(pagePath, page);

// The check that would have caught the broken publish. Every asset the page
// asks for must be one this staging directory actually holds, so a stale or
// mistyped hash fails here instead of reaching the published page.
const staged = new Set(built.map((name) => `assets/${name}`));
const missing = referencedAssets(page).filter((asset) => !staged.has(asset));
if (missing.length > 0) {
  throw new Error(
    `The artifact page references ${missing.length} asset(s) that are not staged, so publishing ` +
      `it would 404:\n  ${missing.join('\n  ')}\n` +
      `Staged assets are:\n  ${[...staged].join('\n  ')}`,
  );
}

const files = Object.fromEntries([...staged].map((asset) => [asset, asset]));

console.log(`page:  ${pagePath}`);
console.log(`root:  ${outDir}`);
console.log(`page references ${referencedAssets(page).length} of ${staged.size} staged assets`);
console.log('files:');
console.log(JSON.stringify(files, null, 2));
