import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
import {captureGame} from './verify-helpers.mjs';
import {buildReport} from '../web/report.js';

const baseline={state:'Level 9',completed:false,clock:{frames:0,simulationSeconds:0},players:[]};
const action={keys:[],frames:30,holdFrames:30,phase:'observe',reason:'Inspect native state.',hypothesis:'Test the supplied route.'};
for(const state of ['Main Menu','Credits','Level 1','Level 9']) {
  const final={...baseline,state,clock:{frames:30,simulationSeconds:.5}};
  for(const mode of ['live','scripted']) {
    const report=buildReport({game:'ovo',baseline,final,history:[{action,before:baseline,after:final}],mode});
    assert.equal(report.outcome,'unconfirmed',state+' must not count as a completed shortcut.');
    assert.equal(report.mode,mode);
  }
}
const sentinel='EXPORT_MUST_NOT_CONTAIN_THIS_SENTINEL';
const reportWithPrivateFields=buildReport({
  game:'ovo',mode:'scripted',
  baseline:{...baseline,secret:sentinel,clock:{...baseline.clock,apiKey:sentinel},players:[{x:336,y:1240,authorization:sentinel}]},
  final:baseline,
  history:[{action,before:baseline,after:baseline,image:'data:image/png;base64,'+sentinel,apiKey:sentinel,request:{secret:sentinel},usage:{inputTokens:4,accessToken:sentinel}}],
});
assert.equal(JSON.stringify(reportWithPrivateFields).includes(sentinel),false,'The report must omit private metadata, credentials, and images.');
assert.match(reportWithPrivateFields.provenance,/scripted input sequence/);
assert.match(reportWithPrivateFields.provenance,/No model inference or independent discovery is claimed/);
const liveReport=buildReport({game:'ovo',mode:'live',baseline,final:baseline,history:[]});
assert.match(liveReport.provenance,/guided exploration/);
assert.notEqual(liveReport.provenance,reportWithPrivateFields.provenance);

const b=await browser();
try {
  const page=await b.newPage({viewport:{width:1440,height:1080}});
  const errors=[],external=[],failed=[],modelRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    const url=new URL(request.url());
    if(!/^(localhost|127\.0\.0\.1)$/.test(url.hostname))external.push(request.url());
    if(url.pathname==='/api/agent/decision')modelRequests.push(request.url());
  });
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  await page.goto('http://localhost:4173/ovo/findings/left-wall-shortcut');
  await page.waitForFunction(()=>window.gameAgent?.observe().ready&&window.swarm&&document.querySelector('#agent-rehearse')?.disabled===false,{},{timeout:15000});
  await page.evaluate(()=>window.swarm.start({mode:'scripted',playbackFps:20,limit:30}));
  const result=await page.evaluate(()=>({running:swarm.running,history:swarm.history,final:gameAgent.observe(),status:document.querySelector('#agent-status').textContent}));
  assert.equal(result.running,false,'The native completion must end the rehearsal.');
  assert.equal(result.history.length,15,'The known shortcut must complete in 15 half-second observation batches.');
  assert.equal(result.history[0].before.state,'Level 9');
  assert.equal(result.final.state,'Level 10','The original game must advance from level 9 to level 10.');
  assert.ok(result.final.completed||result.history.some(entry=>entry.after.completed)||result.final.state==='Level 10','Success requires a native completion signal.');
  for(const entry of result.history) {
    assert.equal(entry.action.frames,30,'Every rehearsal observation must advance 500 ms at the native 60 Hz rate.');
    assert.equal(entry.after.clock.frames-entry.before.clock.frames,30);
    assert.ok(Math.abs(entry.after.clock.performanceMs-entry.before.clock.performanceMs-500)<1e-6);
    assert.equal(entry.model,'Scripted rehearsal');
    assert.equal(entry.transport,'Local script · no model call');
    assert.equal(entry.latencyMs,0);
  }
  assert.deepEqual(modelRequests,[],'A scripted rehearsal must make no model decision requests.');
  assert.equal(await page.locator('#finding-report').getAttribute('data-outcome'),'level-completed');
  assert.match(await page.locator('#finding-report').innerText(),/Scripted rehearsal/);
  assert.equal(await page.locator('#agent-model').textContent(),'Scripted · no model calls');
  assert.equal(await page.locator('#agent-count-label').textContent(),'input batches');
  assert.match(await page.locator('#finding-report').innerText(),/Left-wall shortcut reproduced/);
  await mkdir('evidence',{recursive:true});
  await captureGame(page,{path:'evidence/ovo-rehearsal-completed-game.png'});
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#finding-report .report-download').click();
  const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^swarm-qa-ovo-.*\.json$/);
  await download.saveAs('evidence/ovo-rehearsal-export.json');
  const exportText=await readFile('evidence/ovo-rehearsal-export.json','utf8');
  const exported=JSON.parse(exportText);
  assert.equal(exported.mode,'scripted');
  assert.equal(exported.guided,true);
  assert.equal(exported.outcome,'level-completed');
  assert.equal(exported.baseline.state,'Level 9');
  assert.equal(exported.final.state,'Level 10');
  assert.equal(exported.metrics.decisions,result.history.length);
  assert.equal(exported.metrics.totalInferenceMs,0);
  assert.deepEqual(exported.metrics.models,['Scripted rehearsal']);
  assert.match(exported.provenance,/No model inference or independent discovery is claimed/);
  assert.equal(/data:image\/|sk-proj-|Bearer\s+[A-Za-z0-9_-]+/.test(exportText),false,'The download must not include image payloads or credentials.');
  function assertNoPrivateKeys(value) {
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)) {
      assert.equal(/secret|password|authorization|api.?key|access.?token|refresh.?token|image|screenshot/i.test(key),false,'Unexpected private field in exported report: '+key);
      assertNoPrivateKeys(child);
    }
  }
  assertNoPrivateKeys(exported);
  const viewports=[];
  const frozenBeforeResize=await page.evaluate(()=>gameAgent.observe());
  const gameplayState = state => {
    const {scrollX,scrollY,...layout}=state.layout;
    return {...state,layout};
  };
  for(const [name,viewport]of [['desktop',{width:1440,height:1080}],['mobile',{width:390,height:844}]]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    assert.deepEqual(gameplayState(await page.evaluate(()=>gameAgent.observe())),gameplayState(frozenBeforeResize),'Resizing may reframe the camera but must not change native gameplay or advance time.');
    const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,reportWidth:document.querySelector('#finding-report').getBoundingClientRect().width}));
    assert.ok(layout.documentWidth<=layout.width+1&&layout.bodyWidth<=layout.width+1,name+' must not have horizontal page overflow.');
    await captureGame(page,{path:'evidence/ovo-rehearsal-'+name+'-game.png',label:name+' completed-level capture'});
    await page.screenshot({path:'evidence/ovo-rehearsal-'+name+'.png',fullPage:true});
    viewports.push({name,...layout});
  }
  assert.deepEqual(errors,[],'Rehearsal and report UI must have no uncaught browser errors.');
  assert.deepEqual(external,[],'The full rehearsal must remain local.');
  assert.deepEqual(failed,[],'All local UI and game assets must load.');
  const checks={actions:result.history.length,nativeTransition:'Level 9 → '+result.final.state,outcome:exported.outcome,scripted:true,modelRequests:0,framesPerObservation:30,simulationSeconds:exported.metrics.simulationSeconds,exportVerified:true,privateFieldsOmitted:true,negativeClassificationsVerified:true,resizeLeavesNativeStateUnchanged:true,viewports,errors,external,failed};
  await writeFile('evidence/ovo-rehearsal-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks},null,2));
  console.log(JSON.stringify(checks,null,2));
}finally{await b.close();}
