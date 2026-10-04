import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
import {captureGame} from './verify-helpers.mjs';

// This checks frontend routing against mocked model replies. All game actions,
// frame advancement, captures, cancellation, and report rendering remain real.
const visualModel='chatgpt-gpt-6-luna-fast',jevModel='typesafe/jev';
const config={model:visualModel,configured:true,transport:'ChatGPT subscription',hybrid:{configured:true,model:jevModel,visualModel,strategies:['routed','tactical']}};
const plan={id:'mock-ui-plan',phase:'Approach wall',goal:'Inspect the left gate.',notes:'Mock visual response for UI verification.'};
const action=(keys,holdFrames)=>({keys,holdFrames,frames:30,phase:'navigate',reason:'Mock controller reply; exercise ordinary native movement.',hypothesis:'Exercise the supplied route without claiming completion.'});
const visual=(keys,holdFrames,latencyMs,cost)=>({action:action(keys,holdFrames),plan,stepsSinceVisual:0,visualReview:true,model:visualModel,transport:'ChatGPT subscription',thinkingLevel:'low',latencyMs,apiEquivalentCostUsd:cost,usage:{inputTokens:10,outputTokens:5},routing:{choice:'visual_review',confidence:null}});
const routine={action:action(['ArrowLeft'],3),plan,stepsSinceVisual:1,visualReview:false,model:jevModel,transport:'OpenRouter',latencyMs:10,apiEquivalentCostUsd:.002,usage:{inputTokens:5,outputTokens:1},routing:{choice:'continue',confidence:.95}};
const escalation={needsVisual:true,reason:'Jev requested review through low confidence',plan,stepsSinceVisual:1,latencyMs:7,apiEquivalentCostUsd:.001,jev:{model:jevModel,choice:'request_visual_review',confidence:.3,latencyMs:6,costUsd:.001}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const gameplayState=state=>{const {scrollX,scrollY,...layout}=state.layout;return {...state,layout};};
const b=await browser();
try {
 const page=await b.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
 const errors=[],external=[],unexpectedModelCalls=[],requests=[],routeErrors=[];
 let pendingRoute,resolvePending,releasePending;
 const pendingSeen=new Promise(resolve=>{resolvePending=resolve;});
 const pendingRelease=new Promise(resolve=>{releasePending=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(!/^(localhost|127\.0\.0\.1)$/.test(new URL(request.url()).hostname))external.push(request.url());});
 await page.route('**/api/agent/config?*',route=>route.fulfill({json:config}));
 await page.route('**/api/agent/decision',async route=>{unexpectedModelCalls.push(route.request().url());await route.fulfill({status:500,json:{error:'Visual-only endpoint unexpectedly called by hybrid UI test.'}});});
 await page.route('**/api/hybrid/decision',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  try {
   assert.equal(body.strategy,'routed');
   if(requests.length===1) {
    assert.match(body.image,/^data:image\/png;base64,/);assert.equal(body.plan,null);assert.equal(body.history.length,0);assert.equal(body.stepsSinceVisual,0);
    await route.fulfill({json:visual(['ArrowRight'],3,100,.01)});
   }else if(requests.length===2) {
    assert.equal(Object.hasOwn(body,'image'),false);assert.equal(body.plan.id,plan.id);assert.equal(body.history.length,1);assert.ok(body.history[0].before&&body.history[0].after,'Hybrid history must retain before and after telemetry.');assert.equal(body.stepsSinceVisual,0);
    await route.fulfill({json:routine});
   }else if(requests.length===3) {
    assert.equal(Object.hasOwn(body,'image'),false);assert.equal(body.history.length,2);assert.equal(body.stepsSinceVisual,1);
    await route.fulfill({json:escalation});
   }else if(requests.length===4) {
    assert.match(body.image,/^data:image\/png;base64,/);assert.equal(body.reviewReason,escalation.reason);assert.deepEqual(body.state,requests[2].state,'Escalation must obtain a screenshot without advancing the native game.');assert.deepEqual(body.history,requests[2].history);
    await route.fulfill({json:visual(['ArrowLeft'],30,300,.03)});
   }else if(requests.length===5) {
    assert.equal(Object.hasOwn(body,'image'),false);assert.equal(body.history.length,3);pendingRoute=route;resolvePending();await pendingRelease;
   }else throw Error('Unexpected additional hybrid request.');
  }catch(error){routeErrors.push(error.message);resolvePending();await route.fulfill({status:500,json:{error:error.message}});}
 });
 await page.goto('http://localhost:4173/ovo/findings/left-wall-shortcut');
 await page.waitForFunction(()=>window.gameAgent?.observe().ready&&window.swarm&&!document.querySelector('#agent-run').disabled,{},{timeout:15000});
 assert.equal(await page.locator('#agent-mode').inputValue(),'tactical');
 await page.locator('#agent-mode').selectOption('live');
 await page.locator('#agent-horizon').selectOption('native');
 await page.locator('#agent-mode').selectOption('hybrid');
 assert.equal(await page.locator('#agent-horizon').inputValue(),'2hz');assert.equal(await page.locator('#agent-horizon').isDisabled(),true);
 assert.equal(await page.locator('#agent-run').textContent(),'Run Jev + Luna agent →');assert.match(await page.locator('#agent-model').textContent(),/Jev \+ Luna Fast/);
 await page.locator('#agent-mode').selectOption('live');assert.equal(await page.locator('#agent-horizon').isDisabled(),false);
 await page.locator('#agent-mode').selectOption('hybrid');await page.locator('#agent-rate').selectOption('20');
 await page.evaluate(()=>{
  const win=document.querySelector('#game').contentWindow;window.__hybridKeyEvents=[];
  for(const type of ['keydown','keyup'])win.document.addEventListener(type,event=>window.__hybridKeyEvents.push({type:event.type,code:event.code,frame:gameAgent.observe().clock.frames}));
 });
 assert.equal(/\bfrozen\b/i.test(await page.locator('body').innerText()),false,'Product copy must not describe the game as frozen.');
 await page.locator('#agent-run').click();
 let timer;
 try{await Promise.race([pendingSeen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out waiting for mocked hybrid request: '+routeErrors.join('; '))),15000);})]);}finally{clearTimeout(timer);}
 assert.deepEqual(routeErrors,[]);assert.ok(pendingRoute,'The next routine decision must be pending.');
 const beforeStop=await page.evaluate(()=>({state:gameAgent.observe(),history:swarm.history,events:window.__hybridKeyEvents}));
 assert.equal(beforeStop.history.length,3);assert.equal(beforeStop.history[0].visualReview,true);assert.equal(beforeStop.history[1].model,jevModel);assert.equal(beforeStop.history[2].visualReview,true);
 assert.equal(beforeStop.history[2].latencyMs,307,'Visual review must include the preceding escalation latency exactly once.');
 assert.ok(Math.abs(beforeStop.history[2].apiEquivalentCostUsd-.031)<1e-12,'Visual review must include Jev escalation cost exactly once.');
 assert.equal(beforeStop.history[2].jev.model,jevModel);assert.equal(beforeStop.history[2].reviewReason,escalation.reason);
 for(const entry of beforeStop.history){assert.equal(entry.after.clock.frames-entry.before.clock.frames,30);assert.ok(Math.abs(entry.after.clock.performanceMs-entry.before.clock.performanceMs-500)<1e-6);}
 const player=state=>state.players.find(p=>p.behaviors?.[0]?.enabled);
 assert.notEqual(player(beforeStop.history[0].before).x,player(beforeStop.history[0].after).x,'Mocked replies must execute real native movement.');
 assert.equal(beforeStop.events.at(-1).type,'keydown');assert.equal(beforeStop.events.at(-1).code,'ArrowLeft','The pending-request fixture must retain a held key.');
 await sleep(200);assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),beforeStop.state,'Pending inference must not advance simulation state.');
 const aborted=page.waitForEvent('requestfailed',{predicate:request=>request===pendingRoute.request(),timeout:5000});
 await page.locator('#agent-stop').click();
 const failed=await aborted;assert.match(failed.failure()?.errorText||'',/ABORTED|cancelled/i,'Stop must abort the pending browser request.');
 releasePending();
 const stopped=await page.evaluate(()=>({state:gameAgent.observe(),history:swarm.history,running:swarm.running,events:window.__hybridKeyEvents}));
 assert.equal(stopped.running,false);assert.equal(stopped.history.length,3);assert.equal(stopped.events.at(-1).type,'keyup');assert.equal(stopped.events.at(-1).code,'ArrowLeft');assert.equal(stopped.events.at(-1).frame,beforeStop.state.clock.frames,'Stop must release the key without advancing a frame.');
 await sleep(200);assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),stopped.state,'Stopped game state must remain unchanged.');
 assert.equal(await page.locator('#agent-stop').isDisabled(),true);assert.equal(await page.locator('#agent-mode').isDisabled(),false);assert.equal(await page.locator('#agent-run').isDisabled(),false);
 assert.equal(await page.locator('#agent-status').textContent(),'Stopped');
 assert.match(await page.locator('#finding-report').innerText(),/Guided hybrid/i);assert.match(await page.locator('#finding-report').innerText(),/Visual reviews/);assert.match(await page.locator('#finding-report').innerText(),/Jev calls/);
 await mkdir('evidence',{recursive:true});
 const downloading=page.waitForEvent('download');await page.locator('#finding-report .report-download').click();const download=await downloading;await download.saveAs('evidence/hybrid-ui-mocked-export.json');
 const report=JSON.parse(await readFile('evidence/hybrid-ui-mocked-export.json','utf8'));
 assert.equal(report.mode,'hybrid');assert.equal(report.strategy,'routed');assert.equal(report.guided,true);assert.equal(report.outcome,'unconfirmed');assert.equal(report.metrics.decisions,3);assert.equal(report.metrics.visualReviews,2);assert.equal(report.metrics.jevCalls,2);assert.equal(report.metrics.totalInferenceMs,417);
 assert.deepEqual(report.metrics.models,[visualModel,jevModel]);assert.match(report.provenance,/visual LLM/);assert.match(report.provenance,/Jev routed routine decisions/);assert.match(report.provenance,/local code calculated exact key timing/);
 assert.equal(report.decisions[2].jev.model,jevModel);assert.equal(report.decisions[2].routing.choice,'visual_review');assert.ok(Math.abs(report.decisions[2].apiEquivalentCostUsd-.031)<1e-12);
 assert.equal(JSON.stringify(report).includes('data:image/'),false);
 const viewports=[];
 for(const [name,viewport]of [['desktop',{width:1440,height:1080}],['mobile',{width:390,height:844}]]){
  await page.setViewportSize(viewport);await page.waitForTimeout(150);
  assert.ok(isDeepStrictEqual(gameplayState(await page.evaluate(()=>gameAgent.observe())),gameplayState(stopped.state)),'Resizing may adjust camera scroll, but must preserve native clocks, players, globals, geometry and completion.');
  const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
  assert.ok(layout.documentWidth<=layout.width+1&&layout.bodyWidth<=layout.width+1,name+' hybrid UI must not overflow horizontally.');
  assert.equal(/\bfrozen\b/i.test(await page.locator('body').innerText()),false,'Visible hybrid product copy must not say frozen.');
  await captureGame(page,{label:name+' hybrid game capture'});await page.screenshot({path:'evidence/hybrid-ui-mocked-'+name+'.png',fullPage:true});viewports.push({name,...layout});
 }
 assert.deepEqual(unexpectedModelCalls,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(routeErrors,[]);
 async function verifyTacticalCase(escalateFirst) {
  const tacticalPage=await b.newPage({viewport:{width:1280,height:1040},acceptDownloads:true});
  const calls=[],faults=[],pageErrors=[],unexpected=[],outside=[];
  const seedPlan={...plan,id:escalateFirst?'mock-initial-escalation-plan':'mock-direct-tactical-plan',notes:'Mock seeded tactical plan; no initial visual planning call.'};
  tacticalPage.on('pageerror',error=>pageErrors.push(error.message));
  tacticalPage.on('request',request=>{if(!/^(localhost|127\.0\.0\.1)$/.test(new URL(request.url()).hostname))outside.push(request.url());});
  await tacticalPage.route('**/api/agent/config?*',route=>route.fulfill({json:config}));
  await tacticalPage.route('**/api/agent/decision',async route=>{unexpected.push(route.request().url());await route.fulfill({status:500,json:{error:'Tactical mode must use its hybrid endpoint.'}});});
  await tacticalPage.route('**/api/hybrid/decision',async route=>{
   const body=route.request().postDataJSON();calls.push(body);
   try {
    assert.equal(body.strategy,'tactical');
    if(calls.length===1) {
     assert.equal(Object.hasOwn(body,'image'),false,'Direct Jev mode must not capture an initial screenshot.');
     assert.equal(body.plan,null);assert.equal(body.history.length,0);
     if(escalateFirst) await route.fulfill({json:{...escalation,plan:seedPlan,stepsSinceVisual:0}});
     else await route.fulfill({json:{...routine,plan:seedPlan,action:action(['ArrowRight'],3),routing:{choice:'move_right',confidence:.97}}});
    }else if(escalateFirst&&calls.length===2) {
     assert.match(body.image,/^data:image\/png;base64,/);
     assert.deepEqual(body.plan,seedPlan,'The first uncertain Jev reply must pass its returned seed plan into visual review.');
     assert.equal(body.reviewReason,escalation.reason);assert.ok(isDeepStrictEqual(body.state,calls[0].state),'An initial escalation must not advance simulation.');
     assert.equal(body.history.length,0);
     await route.fulfill({json:{...visual(['ArrowRight'],3,300,.03),plan:seedPlan}});
    }else {
     assert.equal(calls.length,escalateFirst?3:2,'Only two tactical actions are requested by this test.');
     assert.equal(Object.hasOwn(body,'image'),false);assert.deepEqual(body.plan,seedPlan);assert.equal(body.history.length,1);assert.ok(body.history[0].before&&body.history[0].after);
     await route.fulfill({json:{...routine,plan:seedPlan,stepsSinceVisual:escalateFirst?1:2,routing:{choice:'move_left',confidence:.97}}});
    }
   }catch(error){faults.push(error.message);await route.fulfill({status:500,json:{error:error.message}});}
  });
  try {
   await tacticalPage.goto('http://localhost:4173/ovo/findings/left-wall-shortcut');
   await tacticalPage.waitForFunction(()=>window.gameAgent?.observe().ready&&window.swarm&&!document.querySelector('#agent-run').disabled,{},{timeout:15000});
   assert.equal(await tacticalPage.locator('#agent-mode').inputValue(),'tactical');
   assert.equal(await tacticalPage.locator('#agent-run').textContent(),'Run Jev + Luna agent →');
   assert.equal(await tacticalPage.locator('#agent-horizon').inputValue(),'2hz');assert.equal(await tacticalPage.locator('#agent-horizon').isDisabled(),true);
   await tacticalPage.evaluate(()=>swarm.start({limit:2,playbackFps:20}));
   assert.deepEqual(faults,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(outside,[]);
   const run=await tacticalPage.evaluate(()=>({history:swarm.history,running:swarm.running,state:gameAgent.observe()}));
   assert.equal(run.running,false);assert.equal(run.history.length,2);
   for(const entry of run.history){assert.equal(entry.action.frames,30);assert.equal(entry.after.clock.frames-entry.before.clock.frames,30);assert.ok(Math.abs(entry.after.clock.performanceMs-entry.before.clock.performanceMs-500)<1e-6);}
   assert.notEqual(player(run.history[0].before).x,player(run.history[0].after).x,'Direct Jev replies must execute real native movement.');
   const downloading=tacticalPage.waitForEvent('download');await tacticalPage.locator('#finding-report .report-download').click();const download=await downloading;
   const name=escalateFirst?'initial-escalation':'without-review';
   await download.saveAs('evidence/tactical-ui-mocked-'+name+'-export.json');
   const report=JSON.parse(await readFile('evidence/tactical-ui-mocked-'+name+'-export.json','utf8'));
   assert.equal(report.mode,'hybrid');assert.equal(report.strategy,'tactical');assert.equal(report.guided,true);assert.equal(report.outcome,'unconfirmed');
   assert.equal(report.metrics.decisions,2);assert.equal(report.metrics.jevCalls,2);assert.equal(report.metrics.visualReviews,escalateFirst?1:0);
   assert.match(report.provenance,/Jev chose movement actions/);assert.match(report.provenance,/local code calculated exact key timing/);assert.doesNotMatch(report.provenance,/established and reviewed/);
   assert.equal(calls.filter(call=>Object.hasOwn(call,'image')).length,escalateFirst?1:0);
   if(escalateFirst) {
    assert.match(report.provenance,/A visual LLM reviewed uncertain situations/);assert.equal(report.decisions[0].plan.id,seedPlan.id);assert.equal(report.decisions[0].jev.model,jevModel);
    assert.equal(report.decisions[0].latencyMs,307);assert.ok(Math.abs(report.decisions[0].apiEquivalentCostUsd-.031)<1e-12);
    assert.deepEqual(report.metrics.models,[visualModel,jevModel]);
   }else {
    assert.match(report.provenance,/No visual LLM calls were needed/);assert.deepEqual(report.metrics.models,[jevModel]);
    assert.equal(run.history.every(entry=>entry.visualReview===false),true);
    assert.equal(report.metrics.totalInferenceMs,20);
   }
   assert.match(await tacticalPage.locator('#finding-report').innerText(),/Guided hybrid/i);
   assert.equal(/\bfrozen\b/i.test(await tacticalPage.locator('body').innerText()),false);
   assert.equal(JSON.stringify(report).includes('data:image/'),false);
   await captureGame(tacticalPage,{label:'Tactical '+name+' native capture'});
   await tacticalPage.screenshot({path:'evidence/tactical-ui-mocked-'+name+'.png',fullPage:true});
   return {case:name,strategy:report.strategy,requests:calls.length,imageRequests:report.metrics.visualReviews,nativeActions:run.history.length,jevCalls:report.metrics.jevCalls,visualReviews:report.metrics.visualReviews,seedPlanPreserved:escalateFirst?report.decisions[0].plan.id===seedPlan.id:null,provenanceVerified:true};
  }finally{await tacticalPage.close();}
 }
 const tacticalCases=[];
 for(const escalateFirst of [false,true])tacticalCases.push(await verifyTacticalCase(escalateFirst));
 const fallback=await b.newPage();
 await fallback.route('**/api/agent/config?*',route=>route.fulfill({json:{...config,hybrid:{...config.hybrid,strategies:['routed']}}}));
 await fallback.goto('http://localhost:4173/ovo/findings/left-wall-shortcut');await fallback.waitForFunction(()=>window.gameAgent?.observe().ready&&!document.querySelector('#agent-run').disabled,{},{timeout:15000});
 assert.equal(await fallback.locator('#agent-mode').inputValue(),'live');assert.equal(await fallback.locator('#agent-mode option[value=tactical]').isDisabled(),true);
 await fallback.close();
 async function verifySetupCancellation(game) {
  const setupPage=await b.newPage({viewport:{width:1280,height:1040}});
  const modelCalls=[],faults=[];
  setupPage.on('pageerror',error=>faults.push(error.message));
  await setupPage.route('**/api/agent/config?*',route=>route.fulfill({json:config}));
  for(const endpoint of ['agent','hybrid'])await setupPage.route('**/api/'+endpoint+'/decision',async route=>{modelCalls.push(route.request().url());await route.fulfill({status:500,json:{error:'No model decision is allowed during cancelled setup verification.'}});});
  try {
   await setupPage.goto('http://localhost:4173/'+game+'/findings/'+(game==='ovo'?'left-wall-shortcut':'goal-camping'));
   await setupPage.waitForFunction(()=>window.gameAgent?.observe().ready&&window.swarm&&!document.querySelector('#agent-run').disabled,{},{timeout:15000});
   const before=await setupPage.evaluate(()=>gameAgent.observe());
   const rejected=await setupPage.evaluate(async game=>{
    const controller=new AbortController();controller.abort();
    try {
     if(game==='ovo')await gameAgent.startLevel(9,{signal:controller.signal});
     else await gameAgent.startQuickMatch({fireball:true,signal:controller.signal});
     return null;
    }catch(error){return error.name;}
   },game);
   assert.equal(rejected,'AbortError','Pre-aborted '+game+' setup must reject immediately.');
   assert.ok(isDeepStrictEqual(await setupPage.evaluate(()=>gameAgent.observe()),before),'Pre-aborted '+game+' setup must leave all native state unchanged.');
   if(game==='ovo')return {game,preAbortedStateUnchanged:true,modelRequests:0};
   // Delay only the existing parent-page setup yield. No native engine state,
   // input, clock, asset, or game API is replaced by the fixture.
   await setupPage.evaluate(()=>{
    const schedule=window.setTimeout.bind(window);
    window.__setupYieldReached=false;
    window.setTimeout=(callback,delay,...args)=>{
     if(delay===30){window.__setupYieldReached=true;return schedule(callback,1000,...args);}
     return schedule(callback,delay,...args);
    };
   });
   await setupPage.locator('#agent-run').click();
   await setupPage.waitForFunction(()=>window.__setupYieldReached&&swarm.running,{},{timeout:5000});
   const atYield=await setupPage.evaluate(()=>({state:gameAgent.observe(),running:swarm.running,loaded:document.querySelector('#game').contentWindow.Phaser.GAMES[0].state.getCurrentState().constructor.loadedLevel}));
   assert.equal(atYield.running,true);assert.ok(atYield.state.clock.frames>before.clock.frames,'The test must stop setup after real native frames have already advanced.');
   assert.notEqual(atYield.loaded,true,'The setup must still be awaiting completion when Stop is clicked.');
   assert.deepEqual(modelCalls,[]);
   await setupPage.locator('#agent-stop').click();
   const stopped=await setupPage.evaluate(()=>({state:gameAgent.observe(),running:swarm.running,history:swarm.history}));
   assert.equal(stopped.running,false);assert.equal(stopped.history.length,0);assert.equal(stopped.state.clock.frames,atYield.state.clock.frames);
   await sleep(1200);
   const settled=await setupPage.evaluate(()=>gameAgent.observe());
   assert.ok(isDeepStrictEqual(settled,stopped.state),'Cancelled Football setup must not resume advancing native frames after its asynchronous yield.');
   assert.deepEqual(modelCalls,[],'Cancelled setup must never reach either model decision endpoint.');
   assert.deepEqual(faults,[]);assert.equal(await setupPage.locator('#agent-status').textContent(),'Stopped');
   return {game,preAbortedStateUnchanged:true,stoppedDuringNativeSetup:true,setupFramesBeforeStop:atYield.state.clock.frames-before.clock.frames,framesAfterStop:settled.clock.frames-stopped.state.clock.frames,modelRequests:modelCalls.length};
  }finally{await setupPage.close();}
 }
 const setupCancellation=[];
 for(const game of ['football-legends','ovo'])setupCancellation.push(await verifySetupCancellation(game));
 const checks={mockedModelReplies:true,realModelCalls:0,requests:requests.length,imageRequests:requests.filter(request=>Object.hasOwn(request,'image')).length,routineRequestsWithoutImage:3,nativeActions:3,framesPerAction:30,escalationMetadataPreserved:true,escalationCostCountedOnce:true,stopAbortsRequest:true,stopReleasesHeldKey:true,pendingStateUnchanged:true,reportRolesVerified:true,tacticalDefaultVerified:true,tacticalFallbackVerified:true,tacticalCases,setupCancellation,noFrozenProductCopy:true,viewports,errors,external};
 await writeFile('evidence/hybrid-ui-mocked-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks},null,2));console.log(JSON.stringify(checks,null,2));
}finally{await b.close();}
