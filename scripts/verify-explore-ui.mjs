import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
const b=await browser();
await mkdir('evidence/explore-ui',{recursive:true});
const checks=[];
try{
  for(const game of ['football-legends','ovo']){
    const page=await b.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
    const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:4173/'+game);
    assert.equal(await page.locator('.finding-row').count(),game==='ovo'?2:1);
    await page.locator('.finding-row').first().click();await page.waitForURL('**/findings/**');
    assert.match(await page.locator('.finding-intro').innerText(),game==='ovo'?/Wall-jump shortcut/:/Goal camping/);
    await page.locator('.back').click();await page.waitForURL('**/'+game);
    await page.route('**/api/agent/config?*',route=>route.fulfill({json:{configured:true,model:'chatgpt-gpt-6-luna-fast',transport:'ChatGPT subscription',explore:{configured:true,jevConfigured:true}}}));
    for(const path of ['agent','hybrid'])await page.route('**/api/'+path+'/decision',async route=>{errors.push('Explore used a finding endpoint.');await route.abort();});
    let pending=null,block=false,nativeWait=false;
    await page.route('**/api/explore/decision',async route=>{
      const input=route.request().postDataJSON();requests.push(input);
      if(block){pending=route;return;}
      const luna=input.decisionMode==='luna';
      await route.fulfill({json:{purpose:'explore',profile:input.profile,decisionMode:input.decisionMode,guided:false,engineWait:nativeWait,model:luna?'chatgpt-gpt-6-luna-fast':'typesafe/jev-1.13',visualReview:luna&&!nativeWait,latencyMs:nativeWait?0:luna?1250:input.history.length?undefined:185,action:{keys:nativeWait?[]:['ArrowRight'],frames:game==='ovo'?30:20,holdFrames:2,phase:'Move',reason:'Test move along the ordinary route.'}}});
    });
    await page.locator('#explore-link').click();await page.waitForURL('**/explore');
    await page.waitForFunction(()=>window.swarm&&window.gameAgent?.observe().ready&&!document.querySelector('#explore-run').disabled);
    assert.equal(await page.locator('#game-cover').isVisible(),true);
    assert.ok(await page.locator('#cover-image').evaluate(image=>image.complete&&image.naturalWidth>0),'The initial playtest preview must load.');
    assert.equal(await page.locator('input[name=profile]').count(),2);
    assert.equal(await page.locator('#decision-mode option').count(),2);assert.equal(await page.locator('#decision-mode').inputValue(),'hybrid');
    if(game==='football-legends')await page.evaluate(()=>gameAgent.startQuickMatch({fireball:true}));
    for(const decisionMode of ['hybrid','luna'])for(const profile of ['beginner','experienced']){
      await page.locator('#decision-mode').selectOption(decisionMode);
      await page.evaluate(profile=>swarm.start({profile,limit:2,playbackFps:60}),profile);
      const session=await page.evaluate(()=>swarm.sessions[0]);
      assert.equal(session.profile,profile);assert.equal(session.decisionMode,decisionMode);assert.equal(session.guided,false);assert.equal(session.purpose,'explore');assert.equal(session.decisions.length,2);
      assert.equal(session.baseline.state,game==='ovo'?'Level 1':'gameplay');
      assert.equal(await page.locator('#game-cover').isVisible(),false,'A live run must show the actual game canvas.');
      if(game!=='ovo')assert.deepEqual([session.baseline.match.score1,session.baseline.match.score2],[0,0]);
      for(const decision of session.decisions){assert.equal(decision.after.clock.frames-decision.before.clock.frames,game==='ovo'?30:20);assert.equal(decision.guided,false);}
      const modelRequests=requests.filter(r=>r.profile===profile&&r.decisionMode===decisionMode);
      assert.equal(modelRequests.length,2,'Each direct decision makes one request.');
      assert.ok(modelRequests.every(r=>!r.plan&&(decisionMode==='luna'?r.image?.startsWith('data:image/png;base64,'):!r.image)),'Only Luna-only sends a screenshot for each direct decision.');
      assert.equal(await page.locator('[data-decision-id="1"] .decision-latency').textContent(),decisionMode==='luna'?'1.25 s':'185 ms');
      assert.equal(await page.locator('[data-decision-id="2"] .decision-latency').textContent(),decisionMode==='luna'?'1.25 s':'Latency unavailable');
      assert.match(await page.locator('.run-result').first().innerText(),decisionMode==='luna'?/Luna only/:/Jev \+ Luna/);
    }
    await page.screenshot({path:'evidence/explore-ui/'+game+'-model-choice.png',fullPage:true});
    nativeWait=true;await page.evaluate(()=>swarm.start({limit:1,playbackFps:60}));nativeWait=false;
    assert.equal(await page.locator('.decision-latency').textContent(),'No model call');
    block=true;
    await page.locator('#explore-run').click();await page.waitForFunction(()=>swarm.running);
    for(let i=0;!pending&&i<100;i++)await page.waitForTimeout(50);
    assert.ok(pending);assert.equal(await page.locator('input[name=profile]').first().isDisabled(),true);
    assert.equal(await page.locator('#decision-mode').isDisabled(),true,'The selected model stays fixed during a run.');
    const before=await page.evaluate(()=>gameAgent.observe());await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),before);
    await page.locator('#explore-stop').click();
    assert.equal(await page.evaluate(()=>swarm.running),false);assert.equal(await page.locator('input[name=profile]').first().isDisabled(),false);
    assert.equal(await page.locator('#decision-mode').isDisabled(),false);
    await pending.abort().catch(()=>{});block=false;
    await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),before,'Stop must not step the game.');
    const downloadPromise=page.waitForEvent('download');await page.locator('.run-result button').first().click();const download=await downloadPromise;await download.saveAs('evidence/explore-ui/'+game+'-export.json');
    const saved=JSON.parse(await readFile('evidence/explore-ui/'+game+'-export.json','utf8'));assert.equal(saved.guided,false);assert.equal(saved.decisionMode,'luna');assert.equal(saved.status,'Stopped');assert.ok(!JSON.stringify(saved).includes('data:image/'));
    for(const [name,viewport] of [['desktop',{width:1440,height:1050}],['mobile',{width:390,height:844}]]){
      await page.setViewportSize(viewport);await page.waitForTimeout(100);
      const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dims.scroll<=dims.width+1);
      await page.screenshot({path:'evidence/explore-ui/'+game+'-'+name+'.png',fullPage:true});
    }
    await page.reload();await page.waitForFunction(()=>window.swarm);assert.ok(await page.locator('.run-result').count()>=3,'Session history persists in this browser.');
    assert.deepEqual(errors,[]);
    checks.push({game,navigation:true,profiles:2,decisionModes:2,modelLatency:true,nativeWaits:true,freshRuns:true,ordinaryPlayProvenance:true,stopAborts:true,nativeStatePreserved:true,exports:true,persistedHistory:true,responsive:true});
    await page.close();
  }
  const page=await b.newPage();await page.goto('http://localhost:4173/ovo/findings/credits-unlock');await page.waitForFunction(()=>window.gameAgent?.observe().state==='Credits');assert.equal(await page.locator('.agent-panel').isVisible(),true);await page.waitForFunction(()=>!document.querySelector('#agent-run').disabled);assert.match(await page.locator('#agent-run').textContent(),/Luna demonstration/);await page.close();
  await writeFile('evidence/explore-ui/verification.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
}finally{await b.close();}
