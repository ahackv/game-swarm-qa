import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {decide,agentConfig} from './agent.mjs';

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.eot':'application/vnd.ms-fontobject', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.svg':'image/svg+xml' };
let busy=false;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname==='/api/agent/config') {json(res,200,agentConfig(new URL(req.url,'http://localhost').searchParams.get('game')));return;}
    if(pathname==='/api/agent/decision') {
      if(req.method!=='POST'){json(res,405,{error:'Use POST.'});return;}
      if(req.headers.origin && req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'Origin rejected.'});return;}
      if(busy){json(res,409,{error:'An agent decision is already running.'});return;}
      busy=true;
      const controller=new AbortController();
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try {
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3_500_000)throw Error('Request too large.');chunks.push(chunk);}
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result=await decide(input,AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]));
        const directory=resolve(root,'private/runs');await mkdir(directory,{recursive:true});
        await writeFile(resolve(directory,randomUUID()+'.json'),JSON.stringify({game:input.game,state:input.state,...result,guided:true,createdAt:new Date().toISOString()},null,2));
        json(res,200,result);
      } catch(error) {json(res,502,{error:error.message});}
      finally {busy=false;}
      return;
    }
    if(req.method!=='GET'){json(res,405,{error:'Use GET.'});return;}
    let filename;
    const gameMatch=pathname.match(/^\/game\/(football-legends|ovo)\/(.+)$/);
    if (gameMatch) {
      const gameRoot=resolve(root,gameMatch[1]==='ovo'?'private/ovo':'private/game');
      filename=resolve(gameRoot,gameMatch[2]);
      if(!filename.startsWith(gameRoot+sep)){res.writeHead(403);res.end('Forbidden');return;}
    }
    else if(['/football-legends','/ovo'].includes(pathname))filename=resolve(root,'web/player.html');
    else if(/^\/previews\/(football-legends|ovo)\.png$/.test(pathname))filename=resolve(root,'private',pathname.slice(1));
    else if (['/', '/index.html', '/ui.js', '/agent-ui.js', '/observations.js', '/report.js', '/rehearsal.js', '/clock.js','/ovo-bootstrap.js'].includes(pathname)) filename = resolve(root, 'web', pathname === '/' ? 'index.html' : pathname.slice(1));
    else if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    else { res.writeHead(404); res.end('Not found'); return; }
    if (!filename.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filename);
    res.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store', 'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'self'" });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Agent clock games: http://localhost:${port}`));
