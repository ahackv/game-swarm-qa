import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import vm from 'node:vm';

const run = promisify(execFile);
const base = 'https://7a87b324-4ae6-4ae6-9e0d-2b0b455a99a6.gdn.poki.com/d091143b-dcb7-4386-976e-65616dfc134f/';
const root = new URL('../private/game/', import.meta.url);
const files = new Set(['index.html?country=US&hoist=yes&csp=1', 'football_legends.min.js?3d62133755811302233b', 'assets/lib/nape.min.js', 'assets/lib/pksl.js', 'assets/css/app.css', 'assets/css/Calibri-Bold.css']);
const manifest = [];

async function acquire(path) {
  const relative = path.split('?')[0];
  const target = new URL(relative, root);
  await mkdir(dirname(target.pathname), { recursive: true });
  // Preserve originals separately; the served document/bundle are generated below.
  const original = ['index.html', 'football_legends.min.js'].includes(relative) ? new URL(relative + '.original', root) : target;
  let exists = false;
  try { exists = (await stat(original)).size > 0; } catch {}
  if (!exists) await run('curl', ['-sSL', '--fail', '--retry', '2', '--max-time', '60', '-A', 'Mozilla/5.0', '-e', 'https://games.poki.com/', base + path, '-o', original.pathname]);
  const bytes = await readFile(original);
  manifest.push({ path: relative, url: base + path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes.toString('utf8');
}

const source = await acquire('football_legends.min.js?3d62133755811302233b');
for (const match of source.matchAll(/["'](assets\/[A-Za-z0-9_./-]+\.(?:js|css|json|png))["']/g)) files.add(match[1]);
const marker = 'e(e.s=56)';
if (source.split(marker).length !== 2) throw Error('Unexpected bundle; re-inspect before patching.');
// Run only the constant-definition modules in a context without Node APIs.
const context = vm.createContext({});
vm.runInContext(source.replace(marker, 'this.inspectModules=e'), context, { timeout: 3000 });
const definitions = context.inspectModules(0);
const values = object => Object.values(object).filter(value => typeof value === 'string');
for (const name of values(definitions.Images)) files.add(`assets/images/${name}.png`);
for (const name of values(definitions.JSONData)) files.add(`assets/data/${name}.json`);
for (const name of values(definitions.Atlases)) for (const ext of ['png', 'json']) files.add(`assets/atlases/${name}.${ext}`);
// This desktop demo supports both codecs. No remote audio or fonts are used.
for (const name of new Set(values(definitions.Sounds))) for (const ext of ['ogg', 'mp3']) files.add(`assets/sound/${name}.${ext}`);
const fontCSS = await acquire('assets/css/Calibri-Bold.css');
for (const match of fontCSS.matchAll(/url\(['"]?([^)'"?#]+)/g)) files.add(new URL(match[1], base + 'assets/css/Calibri-Bold.css').pathname.split('/d091143b-dcb7-4386-976e-65616dfc134f/')[1]);
const remaining = [...files].filter(path => !['football_legends.min.js?3d62133755811302233b', 'assets/css/Calibri-Bold.css'].includes(path));
let next = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (next < remaining.length) {
    const path = remaining[next++];
    await acquire(path);
    console.log(path);
  }
}));

const domainCheck = 't.prototype.checkDomain=function(t){for(var e=0;e<this.brandDomains.length;e++){var i=this.brandDomains[e];if(-1!==t.indexOf(i))return!0}return!1}';
if (source.split(domainCheck).length !== 2) throw Error('Unexpected domain check; re-inspect before extracting.');
// Adapt the acquired build for the requested hosted QA demo. Originals remain
// preserved; only the domain gate changes, not inputs, physics or outcomes.
await writeFile(new URL('football_legends.min.js', root), source
  .replace(marker, 'window.__footballRequire=e,e(e.s=56)')
  .replace(domainCheck, 't.prototype.checkDomain=function(){return!0}'));
const html = await readFile(new URL('index.html.original', root), 'utf8');
const portalRedirect = '<script type="text/javascript" src="assets/lib/pksl.js"></script>';
if (html.split(portalRedirect).length !== 2) throw Error('Unexpected portal bootstrap; re-inspect before extracting.');
await writeFile(new URL('index.html', root), html
  .replace('<script src="//game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>', '<script src="/clock.js"></script>')
  .replace(portalRedirect, ''));
await writeFile(new URL('../manifest.json', root), JSON.stringify({ retrievedAt: new Date().toISOString(), sourcePage: 'https://poki.com/en/g/football-legends', base, files: manifest.sort((a,b) => a.path.localeCompare(b.path)), modifications: ['Remove external Poki SDK script', 'Remove portal navigation and domain gate for the hosted QA demo', 'Install controllable clock before game scripts', 'Expose Webpack require for local state inspection'] }, null, 2));
console.log(`Extracted ${manifest.length} files. Run npm start, then open http://localhost:4173/football-legends.`);
