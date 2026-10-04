import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const base='https://ovo-classic.github.io/ovo/';
const translationsUrl='https://docs.google.com/spreadsheets/d/e/2PACX-1vSOU_pMce0njTy64pTFVI7yLN2t5ReGYaRCmJDdj_KRSSbAEL7XPixR80X4Jzm0r8sDL0KHq1QRkVGC/pub?output=tsv';
const root=new URL('../private/ovo/',import.meta.url);
const manifest=[];
const unavailable=[];
const modified=new Set(['index.html','GameAnalytics.js','websdkwrapper.js','data.js','c2runtime.js','unlockalllevels.js']);
async function acquire(path, url=new URL(path,base).href) {
  if(!path || path.startsWith('/') || path.includes('..') || /^https?:/.test(path)) throw Error('Unexpected asset path: '+path);
  const target=new URL(path+(modified.has(path)?'.original':''),root);
  await mkdir(dirname(fileURLToPath(target)),{recursive:true});
  let exists=false;try{exists=(await stat(target)).size>0;}catch{}
  if(!exists) {
    try {await run('curl',['-sSL','--fail','--retry','2','--max-time','60',url,'-o',fileURLToPath(target)]);}
    catch(error) {
      if(path.startsWith('media/') && /404/.test(error.stderr||'')) {unavailable.push(path);return '';}
      throw error;
    }
  }
  const bytes=await readFile(target);
  manifest.push({path,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  return bytes.toString('utf8');
}
const html=await acquire('index.html');
const offline=JSON.parse((await acquire('offline.js')).replace(/^\uFEFF/,''));
const paths=[...new Set([...offline.fileList,'sw.js','appmanifest.json','icon-256.png'])];
let next=0;
await Promise.all(Array.from({length:8},async()=>{
  while(next<paths.length) {const path=paths[next++];await acquire(path);if(next%25===0) console.log(`Downloaded ${next}/${paths.length}`);}
}));
// Preserve the project runtime/data and assets. Startup uses our local bootstrap
// so no surrounding-site scripts, visibility suspension or service worker run.
const bootstrap=new URL('../web/ovo-bootstrap.js',import.meta.url);
let local=html.replace(/<script src="\/js\/main\.js"><\/script>/,'<script src="/clock.js"></script>');
local=local.replace(/<script>\s*\/\/ Issue a warning[\s\S]*?<\/script>/,'');
local=local.replace(/<script>\s*\/\/ Start the Construct 2 project[\s\S]*?<\/script>/,'<script src="/ovo-bootstrap.js"></script>');
await stat(bootstrap);
await writeFile(new URL('index.html',root),local);
await writeFile(new URL('GameAnalytics.js',root),'window.GameAnalytics = {}; window.gameanalytics = {GameAnalytics: new Proxy({}, {get: () => function () {}})};\n');
const sdk=await readFile(new URL('websdkwrapper.js.original',root),'utf8');
const init='async init(name, debug = false, data = {}) {';
if(sdk.split(init).length!==2)throw Error('Unexpected SDK wrapper.');
await writeFile(new URL('websdkwrapper.js',root),sdk.replace(init,init+'\n      name = "Local demo";'));
const runtime=await readFile(new URL('c2runtime.js.original',root),'utf8');
const detector=/var xhttp = new XMLHttpRequest \(\);[\s\S]*?xhttp.send \(\);/g;
if([...runtime.matchAll(detector)].length!==1)throw Error('Unexpected ad detector.');
await writeFile(new URL('c2runtime.js',root),runtime.replace(detector,'// External ad probe omitted in the local demo.'));
const project=await readFile(new URL('data.js.original',root),'utf8');
await writeFile(new URL('data.js',root),project.replaceAll('https://dedragames.com/games/ovo/1.3.2/tips.json','tips.json'));
const helpers=await readFile(new URL('unlockalllevels.js.original',root),'utf8');
if(!helpers.includes(translationsUrl))throw Error('Unexpected translation loader.');
await acquire('translations.tsv',translationsUrl);
await writeFile(new URL('unlockalllevels.js',root),helpers.replaceAll(translationsUrl,'translations.tsv'));
await writeFile(new URL('../ovo-manifest.json',root),JSON.stringify({retrievedAt:new Date().toISOString(),sourcePage:'https://ovo-classic.github.io/play.html',base,version:offline.version,files:manifest.sort((a,b)=>a.path.localeCompare(b.path)),unavailable,modifications:['Install local clock before runtime','Use local bootstrap without service worker or visibility suspension','Replace analytics with a local no-op','Force existing SDK wrapper into its no-SDK mode','Remove external ad detector request','Use local tips and translation data','Disable audio loads','Omit decorative CSS layout transitions while retaining their native triggers','Use native bounded cameras on gameplay layouts to keep the embedded viewport inside the level','Resize and redraw the frozen viewport without ticking the game']},null,2));
console.log(`Extracted ${manifest.length} OvO files; ${unavailable.length} unavailable audio files.`);
