import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
const b=await browser();
const logoPosition=()=>{
  const win=document.querySelector('#game').contentWindow,runtime=win.cr_getC2Runtime(),canvas=win.document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
  const logo=runtime.types_by_index.find(type=>type.name==='t112').instances.find(instance=>instance.visible);
  return {x:logo.layer.layerToCanvas(logo.x,logo.y,true)/rect.width,y:logo.layer.layerToCanvas(logo.x,logo.y,false)/rect.height,viewport:{width:canvas.width,height:canvas.height}};
};
await mkdir('evidence/credits-agent',{recursive:true});
try{
  const context=await b.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[],requests=[];
  let mode='hit',pending;
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/agent/config?*',route=>route.fulfill({json:{configured:true,model:'Luna test fixture',hybrid:{configured:false}}}));
  await page.addInitScript(()=>{
    window.imageUrls=new Map();window.revoked=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);if(blob.type.startsWith('image/'))imageUrls.set(url,blob);return url;};
    URL.revokeObjectURL=url=>{if(imageUrls.delete(url))revoked.push(url);revoke(url);};
  });
  // These responses are explicit test fixtures. Native input and progression
  // are real; a separate live check is required to verify Luna visual targeting.
  await page.route('**/api/credits/decision',async route=>{
    const input=route.request().postDataJSON();requests.push(input);
    if(mode==='block'){pending=route;return;}
    const {x,y}=mode==='miss'?{x:.04,y:.04}:await page.evaluate(logoPosition);
    const action={type:'double_click',x,y,frames:1,keys:[],reason:'Fixture: double-click the selected image target.'};
    await route.fulfill({json:{action,model:'Luna test fixture',latencyMs:1234,visualReview:true,inspection:{kind:'visual',latencyMs:1234,request:{instructions:'Guided credits test',state:input.state,image:'Attached screenshot'},response:action}}});
  });
  for(const endpoint of ['agent','hybrid','explore'])await page.route('**/api/'+endpoint+'/decision',()=>{throw Error('Credits must use its own visual prompt.');});

  // Existing browser progress remains separate from this finding's temporary save.
  const saved=await context.newPage();
  await saved.goto('http://localhost:4173/ovo/findings/left-wall-shortcut');
  await saved.waitForFunction(()=>window.gameAgent?.observe().ready);
  await saved.evaluate(()=>gameAgent.openCredits());
  await saved.evaluate(position=>gameAgent.pointer({type:'double_click',...position}),await saved.evaluate(logoPosition));
  assert.equal(await saved.evaluate(()=>gameAgent.observe().unlockedLevels),52);

  await page.goto('http://localhost:4173/ovo/findings/credits-unlock');
  await page.waitForFunction(()=>window.swarm&&!document.querySelector('#agent-run').disabled&&gameAgent.observe().state==='Credits');
  assert.equal(await page.evaluate(()=>gameAgent.observe().unlockedLevels),1);
  assert.equal(await page.locator('.agent-panel').isVisible(),true);assert.equal(await page.locator('#agent-mode').isVisible(),false);
  const position=await page.evaluate(logoPosition),before=await page.evaluate(()=>gameAgent.observe().clock.frames);
  await page.evaluate(position=>gameAgent.pointer({type:'click',...position}),position);
  assert.equal(await page.evaluate(()=>gameAgent.observe().unlockedLevels),1,'Single-click control must not unlock.');
  assert.equal(await page.evaluate(()=>gameAgent.observe().clock.frames),before+1);
  await page.evaluate(()=>swarm.start());
  assert.equal(requests.length,1);assert.equal(await page.evaluate(()=>gameAgent.observe().unlockedLevels),52);
  const entry=await page.evaluate(()=>swarm.history[0]);
  assert.equal(entry.before.unlockedLevels,1);assert.equal(entry.after.unlockedLevels,52);assert.equal(entry.after.clock.frames-entry.before.clock.frames,1);
  assert.equal(entry.inspection,undefined);assert.match(await page.locator('.credits-move-meta').textContent(),/1.23 s/);
  assert.equal(await page.locator('#finding-report').getAttribute('data-outcome'),'levels-unlocked');
  assert.match(await page.locator('#agent-goal-progress').textContent(),/1 → 52/);
  await page.screenshot({path:'evidence/credits-agent/native-unlock.png',fullPage:true});
  await page.locator('.credits-move').click();
  assert.equal(await page.locator('#decision-inspector').isVisible(),true);
  const shown=await page.locator('.inspection-image img').evaluate(img=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(imageUrls.get(img.src));}));
  assert.equal(shown,requests[0].image,'Inspect the exact screenshot submitted before the click.');
  assert.match(await page.locator('#inspection-content').textContent(),/Guided credits test/);
  await page.screenshot({path:'evidence/credits-agent/model-details.png'});
  await page.locator('#inspection-close').click();
  const downloaded=page.waitForEvent('download');await page.locator('.report-download').click();
  const exported=JSON.parse(await readFile(await(await downloaded).path(),'utf8'));
  assert.equal(exported.finding,'credits-unlock');assert.equal(exported.outcome,'levels-unlocked');assert.equal(exported.decisions[0].action.type,'double_click');
  assert.ok(!JSON.stringify(exported).includes('data:image/')&&!JSON.stringify(exported).includes('Guided credits test'));

  await page.evaluate(()=>swarm.start());
  assert.equal(requests.length,2);assert.equal(requests[1].state.unlockedLevels,1,'Every rerun starts from the native default save.');
  assert.equal(await page.evaluate(()=>imageUrls.size),1);assert.equal(await page.evaluate(()=>revoked.length),1);
  await saved.reload();await saved.waitForFunction(()=>window.gameAgent?.observe().ready);
  assert.equal(await saved.evaluate(()=>gameAgent.observe().unlockedLevels),52,'The temporary demonstration cannot reset persistent progress.');
  await saved.close();

  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  await page.evaluate(()=>swarm.start());
  assert.equal(await page.evaluate(()=>gameAgent.observe().unlockedLevels),52,'Normalized input maps correctly after a mobile resize.');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'evidence/credits-agent/mobile.png',fullPage:true});

  mode='miss';const prior=requests.length;await page.evaluate(()=>swarm.start());
  assert.equal(requests.length-prior,3);assert.equal(await page.evaluate(()=>gameAgent.observe().unlockedLevels),1);
  assert.equal(await page.locator('#finding-report').getAttribute('data-outcome'),'unconfirmed','A wrong model target cannot manufacture success.');
  mode='block';await page.locator('#agent-run').click();await page.waitForFunction(()=>document.querySelector('#agent-status').textContent.includes('locating'));
  while(!pending)await new Promise(resolve=>setTimeout(resolve,20));
  const stable=await page.evaluate(()=>gameAgent.observe());await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),stable,'Inference wait cannot advance native time.');
  await page.locator('#agent-stop').click();await page.waitForFunction(()=>!swarm.running);
  await pending.abort().catch(()=>{});pending=null;
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),stable);assert.equal(await page.evaluate(()=>swarm.history.length),0);assert.equal(await page.evaluate(()=>imageUrls.size),0);
  assert.equal(await page.locator('#finding-report').getAttribute('data-outcome'),'unconfirmed');

  await page.evaluate(()=>{void swarm.start();swarm.stop();});
  await page.waitForFunction(()=>!swarm.running);
  assert.equal(await page.locator('#agent-run').isEnabled(),true,'Stopping during iframe setup must still allow a fresh retry.');
  const stoppedSetup=await page.evaluate(()=>gameAgent.observe());
  assert.equal(stoppedSetup.ready,true);assert.equal(stoppedSetup.clock.frozen,true,'A cancelled setup must finish arming the native clock barrier.');
  mode='hit';await page.evaluate(()=>swarm.start());await page.locator('.credits-move').click();
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  assert.equal(await page.locator('#decision-inspector').isVisible(),false);assert.equal(await page.evaluate(()=>imageUrls.size),0);
  assert.equal(await page.evaluate(()=>swarm.history.length),0);assert.equal(await page.locator('#finding-report').innerHTML(),'');
  assert.equal(await page.locator('#agent-ledger').innerHTML(),'');
  mode='block';await page.locator('#agent-run').click();
  while(!pending)await new Promise(resolve=>setTimeout(resolve,20));
  const beforeExit=await page.evaluate(()=>gameAgent.observe());
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await pending.fulfill({json:{action:{type:'double_click',x:.5,y:.31,reason:'Late fixture response.'}}}).catch(()=>{});
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),beforeExit,'A late response cannot act after leaving.');
  assert.equal(await page.evaluate(()=>imageUrls.size),0);assert.equal(await page.evaluate(()=>swarm.history.length),0);assert.deepEqual(errors,[]);
  const checks={nativeUnlock:'1 → 52',singleClickControl:true,modelResponses:'mocked fixtures',inferenceWaitPreserved:true,oneNativeFrame:true,freshReruns:true,persistentSavePreserved:true,wrongTargetUnconfirmed:true,stopAborts:true,setupCancellation:true,inspection:true,latency:true,exports:true,cleanup:true,lateResponseDiscarded:true,mobile:true};
  await writeFile('evidence/credits-agent/verification.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));await context.close();
}finally{await b.close();}
