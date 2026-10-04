import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {API_PATHS,createApiHandler,sameOrigin} from '../api-handler.mjs';

const root=resolve(import.meta.dirname,'..');
const request=(origin,forwarded,encrypted=false)=>({headers:{host:'swarm.example',origin,'x-forwarded-proto':forwarded},socket:{encrypted}});
assert.equal(sameOrigin(request('https://swarm.example','https'),{hosted:true}),true);
assert.equal(sameOrigin(request('https://attacker.example','https'),{hosted:true}),false);
assert.equal(sameOrigin(request('http://swarm.example','https'),{hosted:true}),false);
assert.equal(sameOrigin(request('https://swarm.example','https'),{hosted:false}),false);
assert.equal(sameOrigin(request('http://swarm.example'),{hosted:false}),true);

let calls=0,aborted=false;
const decisionHandlers=Object.fromEntries(API_PATHS.filter(path=>path.endsWith('/decision')).map(path=>[path,async(input,signal)=>{
  calls++;
  if(input.wait)await new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
  });
  return {action:{reason:path},inspection:{request:{ephemeral:true}}};
}]));
const handler=createApiHandler({decisionHandlers,configuration:game=>({game,configured:true}),hosted:true,timeoutMs:150});
const server=http.createServer((req,res)=>handler(req,res));
server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
try{
  assert.deepEqual(await (await fetch(url+'/api/agent/config?game=ovo')).json(),{game:'ovo',configured:true});
  for(const path of API_PATHS.filter(path=>path.endsWith('/decision'))){
    const response=await fetch(url+path,{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{"game":"ovo"}'});
    assert.equal(response.status,200);assert.equal((await response.json()).action.reason,path);
  }
  const before=calls;
  assert.equal((await fetch(url+'/api/agent/decision',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/agent/decision')).status,405);
  assert.equal((await fetch(url+'/api/agent/config',{method:'POST'})).status,405);
  assert.equal((await fetch(url+'/api/agent/decision',{method:'POST',body:'{broken'})).status,400);
  assert.equal((await fetch(url+'/api/agent/decision',{method:'POST',body:'x'.repeat(3_500_001)})).status,413);
  assert.equal(calls,before,'Rejected requests must not invoke a model.');
  const timeout=await fetch(url+'/api/agent/decision',{method:'POST',body:'{"wait":true}'});
  assert.equal(timeout.status,502);assert.equal(aborted,true,'Timeout must cancel the model request.');
  aborted=false;
  const controller=new AbortController();
  const pending=fetch(url+'/api/agent/decision',{method:'POST',body:'{"wait":true}',signal:controller.signal}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,25));controller.abort();await pending;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(aborted,true,'Closing the browser request must cancel the model request.');
}finally{server.closeAllConnections();server.close();await once(server,'close');}

const config=JSON.parse(await readFile(resolve(root,'vercel.json'),'utf8'));
assert.equal(config.framework,null);assert.equal(config.outputDirectory,'dist');
assert.equal(config.functions['api/index.mjs'].supportsCancellation,true);
assert.ok(config.functions['api/index.mjs'].maxDuration>=60);
for(const page of ['index.html','game.html','player.html','explore.html','game/football-legends/index.html','game/ovo/index.html','previews/football-legends.png','previews/ovo.png']){
  assert.ok((await stat(resolve(root,'dist',page))).size>0,page+' must be available after a fresh deployment.');
}
async function inspect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name),name=relative(resolve(root,'dist'),path);
    assert.ok(!entry.name.startsWith('.env')&&!name.includes('private/')&&!entry.name.endsWith('.original')&&!name.startsWith('runs/'),'Private file in static build: '+name);
    if(entry.isDirectory())await inspect(path);
  }
}
await inspect(resolve(root,'dist'));
console.log('Deployment: HTTPS origins, all API routes, method/body limits, model cancellation, static pages/game assets and private-file exclusion verified without model calls.');
