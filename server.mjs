import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import {handleApi} from './api-handler.mjs';

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.eot':'application/vnd.ms-fontobject', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.svg':'image/svg+xml' };
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/')){await handleApi(req,res,pathname);return;}
    if(req.method!=='GET'){json(res,405,{error:'Use GET.'});return;}
    let filename;
    const gameMatch=pathname.match(/^\/game\/(football-legends|ovo)\/(.+)$/);
    if (gameMatch) {
      const gameRoot=resolve(root,gameMatch[1]==='ovo'?'private/ovo':'private/game');
      filename=resolve(gameRoot,gameMatch[2]);
      if(!filename.startsWith(gameRoot+sep)){res.writeHead(403);res.end('Forbidden');return;}
    }
    else if(['/football-legends','/ovo'].includes(pathname))filename=resolve(root,'web/game.html');
    else if(/^\/(football-legends|ovo)\/explore$/.test(pathname))filename=resolve(root,'web/explore.html');
    else if(['/football-legends/findings/goal-camping','/ovo/findings/left-wall-shortcut','/ovo/findings/credits-unlock'].includes(pathname))filename=resolve(root,'web/player.html');
    else if(/^\/previews\/(football-legends|ovo)\.png$/.test(pathname))filename=resolve(root,'assets',pathname.slice(1));
    else if (['/', '/index.html', '/ui.js', '/agent-ui.js', '/observations.js', '/report.js', '/rehearsal.js', '/clock.js','/ovo-bootstrap.js','/games.js','/game-home.js','/workspace.css','/explore-ui.js','/explore-policy.js','/decision-modes.js','/decision-inspector.js','/decision-inspector.css','/finding.js','/finding-agent.js','/goal-camping.js','/credits-ui.js','/credits-policy.js','/credits.css'].includes(pathname)) filename = resolve(root, 'web', pathname === '/' ? 'index.html' : pathname.slice(1));
    else if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    else { res.writeHead(404); res.end('Not found'); return; }
    if (!filename.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store', 'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'self'" });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Agent clock games: http://localhost:${port}`));
