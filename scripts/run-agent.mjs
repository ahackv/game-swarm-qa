import {browser} from './browser.mjs';
import {decide,modelForGame} from '../agent.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {describe} from '../web/observations.js';
import {captureGame} from './verify-helpers.mjs';
const game=process.argv[2]||'football-legends';
assert.ok(['football-legends','ovo'].includes(game),'Choose football-legends or ovo.');
const model=modelForGame(game);
const directory=process.env.AGENT_EVIDENCE_DIR||'evidence/agent-'+game+'-'+model.replace(/[^a-zA-Z0-9-]/g,'-');
const limit=Number(process.env.AGENT_DECISIONS||120);
assert.ok(Number.isInteger(limit)&&limit>0,'AGENT_DECISIONS must be a positive integer.');
// AGENT_FRAME_LIMIT remains an explicit opt-in to the old variable batch mode.
const cadence=process.env.AGENT_CADENCE||(process.env.AGENT_FRAME_LIMIT?'adaptive':'2hz');
assert.ok(['2hz','4hz','native','adaptive'].includes(cadence),'AGENT_CADENCE must be 2hz, 4hz, native, or adaptive.');
const nativeFps=game==='ovo'?60:40;
const maxFrames=cadence==='2hz'?nativeFps/2:cadence==='4hz'?nativeFps/4:cadence==='native'?1:Number(process.env.AGENT_FRAME_LIMIT||120);
const minFrames=cadence==='adaptive'?1:maxFrames;
assert.ok(Number.isInteger(maxFrames)&&maxFrames>=1&&maxFrames<=120,'AGENT_FRAME_LIMIT must be an integer from 1 to 120.');
const b=await browser();
const history=[];let scored=false,interrupted=false;
try{
 const page=await b.newPage({viewport:{width:1280,height:1040}});
 await page.goto('http://localhost:4173/'+game+'/findings/'+(game==='ovo'?'left-wall-shortcut':'goal-camping'));
 await page.waitForFunction(()=>window.gameAgent?.observe().ready,{},{timeout:15000});
 if(game==='football-legends')await page.evaluate(()=>gameAgent.startQuickMatch({fireball:true}));
 else await page.evaluate(()=>gameAgent.startLevel(9));
 await mkdir(directory,{recursive:true});
 const initial=await page.evaluate(()=>gameAgent.observe());
 for(let i=0;i<limit;i++){
  const before=await page.evaluate(()=>gameAgent.observe());
  const image=await captureGame(page,{path:directory+'/frame-'+String(i).padStart(3,'0')+'.png'});
  const input={game,minFrames,maxFrames,state:describe(game,before),image:image.dataUrl,history:history.map(h=>({action:h.action,after:h.after}))};
  const result=await decide(input);
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),before,'Simulation must stay frozen during model inference.');
  const afterInference=await captureGame(page);
  assert.deepEqual(afterInference.bytes,image.bytes,'Game pixels must stay frozen during model inference.');
  const after=await page.evaluate(action=>gameAgent.act(action),result.action);
  assert.equal(after.clock.frames-before.clock.frames,result.action.frames,'Only the chosen native frames may advance.');
  assert.ok(Math.abs(after.clock.performanceMs-before.clock.performanceMs-result.action.frames*1000/nativeFps)<1e-6,'Only the chosen game time may advance.');
  const epochTolerance=result.action.frames*Number.EPSILON*Math.abs(before.clock.epochMs);
  assert.ok(Math.abs(after.clock.epochMs-before.clock.epochMs-result.action.frames*1000/nativeFps)<=epochTolerance,'The Date epoch must agree within native floating-point precision.');
  assert.ok(result.action.frames>=minFrames&&result.action.frames<=maxFrames,'The action must respect the selected observation cadence.');
  const entry={decision:i+1,...result,captureStats:image.stats,before:describe(game,before),after:describe(game,after)};
  history.push(entry);
  if(game==='football-legends' && after.match.score1>initial.match.score1)scored=true;
  if(game==='ovo'&&(after.completed||Number(/^Level (\d+)$/.exec(after.state)?.[1])>9))scored=true;
  if(game==='ovo'&&after.state!=='Level 9'&&!scored)interrupted=true;
  await writeFile(directory+'/run.json',JSON.stringify({model,game,guided:true,cadence,nativeFps,minFrames,maxFrames,frozenDuringInference:true,pixelsFrozenDuringInference:true,productionCaptureVerified:true,scored,interrupted,decisions:history},null,2));
  const player=after.players.find(p=>p.human)||after.players.find(p=>p.behaviors?.[0]?.enabled);
  console.log(JSON.stringify({decision:i+1,model:result.model,ms:result.latencyMs,action:result.action,player:{x:player?.x,y:player?.y,charge:player?.superCharge},score:after.match,state:after.state}));
  if(scored||interrupted)break;
 }
 await captureGame(page,{path:directory+'/final-game.png'});
 await page.screenshot({path:directory+'/final.png',fullPage:true});
 console.log(JSON.stringify({finished:true,model,game,cadence,decisions:history.length,scored,interrupted}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{await b.close();}
