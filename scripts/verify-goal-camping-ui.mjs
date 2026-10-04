import assert from 'node:assert/strict';
import {browser} from './browser.mjs';

// Controller regression fixtures, not evidence that a model won a native game.
// Native play is exercised by verify-hybrid-ui and verify:football separately.
const b=await browser();
const score=(human,bot,flags={})=>({state:'gameplay',ready:true,match:{score1:human,score2:bot},core:{isPlaying:true,isEnd:false,...flags},clock:{frames:0,simulationSeconds:0},players:[{human:true,x:78,y:245,vx:0,onGround:true,superPower:0,superReady:true,superCharge:12}],ball:{x:130,y:245}});
async function check(mode,baseline,sequence,expectedDecisions,outcome){
  const page=await b.newPage(),requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route('**/ui.js',route=>route.fulfill({contentType:'text/javascript',body:`
      let current=${JSON.stringify(baseline)},index=0;
      const samples=${JSON.stringify(sequence)};
      window.gameAgent={observe:()=>structuredClone(current),stop(){},releaseKeys(){},capture:()=> 'data:image/png;base64,dGVzdA==',act:async action=>{
        if(!samples[index])throw Error('The controller continued after the test target.');
        const frames=current.clock.frames+action.frames;current={...samples[index++],clock:{frames,simulationSeconds:frames/40}};return structuredClone(current);
      }};
      document.querySelector('#game-title').textContent='Football Legends · controller fixture';
    `}));
    await page.route('**/api/agent/config?*',route=>route.fulfill({json:{model:'chatgpt-gpt-6-luna-fast',configured:true,transport:'ChatGPT subscription',hybrid:{configured:true,strategies:['routed','tactical']}}}));
    for(const endpoint of ['agent','hybrid'])await page.route('**/api/'+endpoint+'/decision',async route=>{
      const input=route.request().postDataJSON();requests.push({endpoint,input});
      await route.fulfill({json:{action:{keys:[],frames:20,holdFrames:20,phase:'Wait for charge',reason:'Controller test fixture.'},plan:{phase:'Wait for charge',initialScore:baseline.match.score1},stepsSinceVisual:0,model:'test-fixture',latencyMs:0}});
    });
    await page.goto('http://localhost:4173/football-legends/findings/goal-camping');
    await page.waitForFunction(()=>window.swarm&&!document.querySelector('#agent-run').disabled);
    await page.locator('#agent-mode').selectOption(mode);
    await page.evaluate(()=>swarm.start({playbackFps:1000}));
    const result=await page.evaluate(()=>({history:swarm.history,running:swarm.running,status:document.querySelector('#agent-status').textContent,progress:document.querySelector('#agent-goal-progress').textContent}));
    assert.equal(result.running,false);assert.equal(result.history.length,expectedDecisions);assert.equal(requests.length,expectedDecisions);
    assert.equal(await page.locator('#finding-report').getAttribute('data-outcome'),outcome);
    assert.ok(requests.every(r=>r.endpoint===(mode==='live'?'agent':'hybrid')));
    if(mode==='live')assert.ok(requests.every(r=>r.input.initialScore===baseline.match.score1));
    if(outcome==='goal-target-reached')assert.match(result.status,/Goal target reached/);else assert.match(result.status,/Match ended.*target not reached/);
    assert.deepEqual(errors,[]);return {mode,decisions:expectedDecisions,outcome,progress:result.progress};
  }finally{await page.close();}
}
try{
  const checks=[];
  for(const mode of ['live','hybrid','tactical']){
    checks.push(await check(mode,score(0,0),[score(1,0,{isGoal:true}),score(1,0,{isPlaying:false,isCountDown:true}),score(2,0,{isGoal:true}),score(3,0,{isGoal:true}),score(4,0,{isGoal:true})],5,'goal-target-reached'));
    checks.push(await check(mode,score(0,0),[score(1,1),score(2,2),score(3,3),score(4,3),score(5,3)],5,'goal-target-reached'));
    checks.push(await check(mode,score(0,0),[score(1,0),score(2,0),score(3,1,{isEnd:true})],3,'goal-target-unmet'));
  }
  checks.push(await check('tactical',score(2,0),[score(3,0),score(4,1),score(5,2),score(6,3)],4,'goal-target-reached'));
  console.log(JSON.stringify({controllerFixtures:true,realModelCalls:0,checks},null,2));
}finally{await b.close();}
