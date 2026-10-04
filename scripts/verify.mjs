import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { browser } from './browser.mjs';
import {captureGame,verifyQuarterSecondAction,verifyHalfSecondAction} from './verify-helpers.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const b=await browser();
try {
  const page=await b.newPage({viewport:{width:1280,height:1040}});
  const external=[], errors=[], failed=[];
  page.on('request',req=>{if(!new URL(req.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))external.push(req.url());});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('favicon.ico'))failed.push({url:response.url(),status:response.status()});});
  await page.goto('http://localhost:4173/football-legends');
  await page.waitForFunction(()=>window.football?.observe().ready,{},{timeout:15000});
  await page.evaluate(()=>football.startQuickMatch({fireball:true}));
  // Start at the first playable frame, rather than an arbitrary point that can
  // land in the native goal delay, when physics runs but the match timer stops.
  const setup=await page.evaluate(async()=>{
    for(let frames=0;frames<=400;frames++) {
      const state=football.observe(),core=state.core;
      if(state.state==='gameplay'&&core.isPlaying&&!core.isPaused&&!core.isCountDown&&!core.isGoal&&core.deltaDelay<0)return {frames,state};
      if(frames<400)await football.step({frames:1,keys:[]});
    }
    return {frames:400,state:football.observe()};
  });
  const before=setup.state;
  const phase=state=>({frames:state.clock.frames,core:state.core,match:state.match,ball:state.ball});
  assert.ok(before.core.isPlaying&&!before.core.isPaused&&!before.core.isCountDown&&!before.core.isGoal&&before.core.deltaDelay<0,'Fixture must reach active play: '+JSON.stringify(phase(before)));
  assert.equal(before.clock.frozen,true);
  assert.equal(before.state,'gameplay');
  assert.ok(before.bodies.length>0,'Physics bodies must be observable.');
  assert.equal(before.core.isCountDown,false,'Countdown must be finished for the test.');
  await mkdir('evidence',{recursive:true});
  // Establish a presented WebGL buffer before comparing captures. The initial
  // draw can retain anti-aliased edge alpha from the loading framebuffer.
  await captureGame(page);
  await page.waitForTimeout(50);
  const captureBefore=await captureGame(page,{path:'evidence/frozen-before.png'});
  const pixelsBefore=captureBefore.bytes;
  const wallStart=Date.now();
  await sleep(4000);
  const afterWait=await page.evaluate(()=>football.observe());
  const pixelsAfter=(await captureGame(page,{path:'evidence/frozen-after.png'})).bytes;
  const waitWallMs=Date.now()-wallStart;
  assert.deepEqual(afterWait,before,'No simulation state may change while the agent waits.');
  assert.equal(sha(pixelsAfter),sha(pixelsBefore),'The rendered game must remain pixel-identical.');
  const one=await page.evaluate(()=>football.step({frames:1,keys:[]}));
  assert.equal(one.clock.frames,before.clock.frames+1);
  assert.equal(one.clock.epochMs,before.clock.epochMs+25);
  assert.ok(Math.abs(one.physicsSeconds-before.physicsSeconds-.0225)<1e-8,'One gameplay frame must advance the native Nape physics step.');
  assert.ok(Math.abs(one.core.deltaMatchTime-before.core.deltaMatchTime-.025)<1e-8,'One active-play frame must advance the match clock by 25 ms: '+JSON.stringify({before:phase(before),after:phase(one)}));
  const inputBefore=await page.evaluate(()=>football.observe());
  const inputAfter=await page.evaluate(()=>football.step({frames:12,keys:['ArrowRight']}));
  const moved=inputAfter.players[0].x-inputBefore.players[0].x;
  assert.ok(moved>1,'Held right key must move the player right.');
  await page.evaluate(()=>football.releaseKeys());
  const releaseBefore=await page.evaluate(()=>football.observe());
  const releaseAfter=await page.evaluate(()=>football.step({frames:3,keys:[]}));
  assert.ok(Math.abs(releaseAfter.players[0].vx)<Math.abs(inputAfter.players[0].vx),'Releasing the key must stop directional input.');
  const cadence=await verifyQuarterSecondAction(page,'football-legends');
  const defaultCadence=await verifyHalfSecondAction(page,'football-legends');
  const frame=page.frames().find(f=>f.url().includes('/game/football-legends/index.html'));
  const timerResult=await frame.evaluate(()=>{
    window.__timerProbe={count:0};
    setTimeout(()=>window.__timerProbe.count++,100);
    return {count:window.__timerProbe.count,dateNow:Date.now(),dateConstructed:new Date().getTime(),perf:performance.now()};
  });
  await sleep(250);
  assert.equal(await frame.evaluate(()=>window.__timerProbe.count),0,'Game timeouts must wait for virtual time.');
  await page.evaluate(()=>football.step({frames:3}));
  assert.equal(await frame.evaluate(()=>window.__timerProbe.count),0);
  await page.evaluate(()=>football.step({frames:1}));
  assert.equal(await frame.evaluate(()=>window.__timerProbe.count),1);
  assert.equal(timerResult.dateNow,timerResult.dateConstructed,'Date constructor and Date.now must share the synthetic clock.');
  const previewBefore=await page.evaluate(()=>football.observe());
  await page.locator('#preview').click();
  await sleep(1100);
  const previewAfter=await page.evaluate(()=>football.observe());
  const previewFrames=previewAfter.clock.frames-previewBefore.clock.frames;
  assert.ok(previewFrames>=3&&previewFrames<=5,'Preview must advance approximately four frames per real second.');
  assert.equal(previewAfter.clock.epochMs-previewBefore.clock.epochMs,previewFrames*25);
  const agentTakeover=await page.evaluate(()=>football.step({frames:1}));
  assert.equal(await page.locator('#preview').getAttribute('aria-pressed'),'false','Agent step must stop automatic preview.');
  await sleep(350);
  assert.deepEqual(await page.evaluate(()=>football.observe()),agentTakeover,'Agent takeover must leave the game frozen.');
  assert.deepEqual(external,[],'Extracted game must make no external requests.');
  assert.deepEqual(errors,[],'No uncaught browser errors.');
  assert.deepEqual(failed,[],'All required local assets must load.');
  await page.screenshot({path:'evidence/demo.png',fullPage:true});
  await mkdir('private/previews',{recursive:true});
  await captureGame(page,{path:'private/previews/football-legends.png'});
  const report={verifiedAt:new Date().toISOString(),checks:{...defaultCadence.checks,quarterSecondCapability:cadence.checks,setupFramesToActivePlay:setup.frames,waitWallMs,frozenStateUnchanged:true,pixelsIdentical:true,pixelHash:sha(pixelsBefore),singleFrameClockMs:25,singleFramePhysicsSeconds:one.physicsSeconds-before.physicsSeconds,singleFrameMatchSeconds:one.core.deltaMatchTime-before.core.deltaMatchTime,rightKeyMovement:moved,keyReleaseWorks:true,timersUseSyntheticTime:true,previewFramesIn1100ms:previewFrames,agentStepStopsPreview:true,externalRequests:external,uncaughtErrors:errors,failedAssets:failed},before,afterWait,one,inputAfter,releaseAfter};
  await writeFile('evidence/verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.checks,null,2));
} finally {await b.close();}
