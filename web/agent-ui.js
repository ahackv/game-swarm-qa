import {describe as describeState} from './observations.js';
import {renderReport} from './report.js';
import {ovoRehearsalAction} from './rehearsal.js';
import {GOAL_CAMPING_TARGET,GOAL_CAMPING_LEAD,GOAL_CAMPING_DECISION_LIMIT,goalCampingProgress} from './goal-camping.js';

const game=location.pathname.split('/')[1];
const api=()=>window.gameAgent;
const run=document.querySelector('#agent-run'),stop=document.querySelector('#agent-stop'),rehearse=document.querySelector('#agent-rehearse'),status=document.querySelector('#agent-status'),ledger=document.querySelector('#agent-ledger');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let running=false,generation=0,controller=null,configured=false,runContext=null,modelBadge='',modelId='';
const history=[];
let hybridConfigured=false,visualRunLabel='Run agent →';
const modeSelect=document.querySelector('#agent-mode');
const usesJev=mode=>mode==='hybrid'||mode==='tactical';
function syncMode(){
 const hybrid=usesJev(modeSelect.value);
 if(hybrid)document.querySelector('#agent-horizon').value='2hz';
 document.querySelector('#agent-horizon').disabled=running||hybrid;
 run.textContent=hybrid?'Run Jev + Luna agent →':visualRunLabel;
 document.querySelector('#agent-description').textContent=modeSelect.value==='tactical'?'Jev chooses the next movement. Luna reviews the game when the agent needs help.':hybrid?'Luna plans the route. Jev selects each phase, with occasional visual reviews.':'Watch the visual agent try the supplied strategy, then inspect its actions and the outcome.';
 if(!running){run.disabled=hybrid?!hybridConfigured:!configured;document.querySelector('#agent-model').textContent=hybrid?'Jev + '+modelBadge:modelBadge;}
}
modeSelect.onchange=syncMode;
const describe=s=>describeState(game,s);
const goalProgressLabel=document.querySelector('#agent-goal-progress');
goalProgressLabel.hidden=game!=='football-legends';
goalProgressLabel.textContent=`Target: score ${GOAL_CAMPING_TARGET} goals and lead by at least ${GOAL_CAMPING_LEAD}.`;
function footballOutcome(state){
 const progress=goalCampingProgress(state,runContext?.baseline?.match?.score1??0);
 const label=`Goals this run: ${progress.goalsScored??'—'}/${GOAL_CAMPING_TARGET} · Lead: ${progress.lead??'—'} (need ${GOAL_CAMPING_LEAD})`;
 if(goalProgressLabel.textContent!==label)goalProgressLabel.textContent=label;
 if(progress.targetReached)return 'Goal target reached · '+state.match.score1+'–'+state.match.score2+' · evidence recorded';
 if(progress.matchEnded)return 'Match ended · four-goal target not reached';
 return null;
}
document.querySelector('#agent-hypothesis').textContent=game==='football-legends'?'Seed hypothesis: camp inside your own raised goal, charge the fireball naturally, then score across the field.':'Seed hypothesis: lower the left gate, face right at the wall, tap jump with horizontal keys released, then cross left and dive to the exit.';
rehearse.hidden=game!=='ovo';
function add(entry){
 const li=document.createElement('li');
 const keys=entry.action.keys.length?entry.action.keys.join(' + '):'release / wait';
 const route=entry.visualReview?'Visual review':entry.model?.startsWith('typesafe/')?'Jev '+(entry.routing?.choice||'decision'):null;
 li.textContent=(route?route+' · '+(entry.latencyMs/1000).toFixed(2)+' s · ':'')+String(history.length).padStart(2,'0')+' · '+keys+' · hold '+entry.action.holdFrames+' / '+entry.action.frames+' frames · '+entry.action.reason;
 if(entry.event){const line=document.createElement('div');line.className='event';line.textContent=entry.event;li.append(line);}
 ledger.prepend(li);document.querySelector('#agent-count').textContent=String(history.length);
}
function report(){
 if(!runContext?.baseline)return;
 const root=document.querySelector('#finding-report');root.hidden=false;
 renderReport({...runContext,game,history,final:api().observe(),status:status.textContent,finishedAt:Date.now()},root);
}
function controls(active){
 for(const b of document.querySelectorAll('.controls button,.agent-actions select'))b.disabled=active;
 run.disabled=active||(usesJev(modeSelect.value)?!hybridConfigured:!configured);rehearse.disabled=active;stop.disabled=!active;
 if(game==='football-legends'&&api()?.observe().state!=='menu')document.querySelector('#quick').disabled=true;
 if(usesJev(modeSelect.value))document.querySelector('#agent-horizon').disabled=true;
}
function halt(){generation++;running=false;controller?.abort();api()?.releaseKeys();controls(false);status.textContent='Stopped';report();}
async function start({limit=game==='football-legends'?GOAL_CAMPING_DECISION_LIMIT:120,playbackFps=Number(document.querySelector('#agent-rate').value),minFrames,maxFrames,mode=modeSelect.value}={}){
 if(running)return;
 if(mode==='scripted'&&game!=='ovo')throw Error('This rehearsal is for OvO.');
 history.length=0;ledger.replaceChildren();document.querySelector('#agent-count').textContent='0';document.querySelector('#finding-report').hidden=true;
 const cadence=document.querySelector('#agent-horizon').value;
 if(mode==='scripted'){minFrames=30;maxFrames=30;}
 else if(usesJev(mode)){minFrames=maxFrames=game==='ovo'?30:20;}
 else if(maxFrames===undefined){maxFrames=cadence==='2hz'?(game==='ovo'?30:20):cadence==='4hz'?(game==='ovo'?15:10):cadence==='native'?1:120;minFrames=cadence==='adaptive'?1:maxFrames;}
 minFrames??=1;
 running=true;const token=++generation;controls(true);runContext={mode:usesJev(mode)?'hybrid':mode,strategy:mode==='tactical'?'tactical':mode==='hybrid'?'routed':undefined,startedAt:Date.now()};
 document.querySelector('#agent-count-label').textContent=mode==='scripted'?'input batches':'decisions';
 document.querySelector('#agent-model').textContent=mode==='scripted'?'Scripted · no model calls':usesJev(mode)?'Jev + '+modelBadge:modelBadge;
 document.querySelector('#agent-model').title=mode==='scripted'?'Deterministic ordinary-input reproduction':modelId;
 try{
  api().stop();
  controller=new AbortController();
  if(game==='football-legends'){
   if(api().observe().core?.isEnd)await api().reset({signal:controller.signal});
   if(api().observe().state==='menu')await api().startQuickMatch({fireball:true,signal:controller.signal});
  }
  if(game==='ovo')await api().startLevel(9,{signal:controller.signal});
  if(token!==generation)return;
  runContext.baseline=api().observe();let ended=false,plan=null,stepsSinceVisual=0;
  for(let n=0;n<limit&&token===generation;n++){
   const iterationStarted=performance.now(),before=api().observe();let decision;
   if(game==='football-legends'){
    const outcome=footballOutcome(before);
    if(outcome){ended=true;status.textContent=outcome;break;}
   }
   if(mode==='scripted'){
    decision={action:ovoRehearsalAction(before,history),model:'Scripted rehearsal',transport:'Local script · no model call',latencyMs:0};
   }else if(usesJev(mode)){
    controller=new AbortController();
    const input={game,strategy:runContext.strategy,state:describe(before),history:history.slice(-6).map(h=>({action:h.action,before:h.before,after:h.after,event:h.event})),plan,stepsSinceVisual};
    if(!plan&&mode!=='tactical')input.image=api().capture();
    status.textContent=plan||mode==='tactical'?'Jev is choosing the next move':'The visual agent is planning the route';
    const request=async body=>{const response=await fetch('/api/hybrid/decision',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
    decision=await request(input);
    if(decision.needsVisual&&token===generation){
     status.textContent='The visual agent is reviewing the game';
     const escalation=decision;
     decision=await request({...input,plan:escalation.plan||input.plan,image:api().capture(),reviewReason:escalation.reason});
     decision.latencyMs=(decision.latencyMs||0)+(escalation.latencyMs||0);
     decision.apiEquivalentCostUsd=(decision.apiEquivalentCostUsd||0)+(escalation.apiEquivalentCostUsd??escalation.jev?.costUsd??0);
     if(escalation.jev)decision.jev=escalation.jev;
     decision.reviewReason=escalation.reason;
    }
    if(decision.completed||decision.matchEnded){
     const outcome=game==='football-legends'?footballOutcome(before):'Native outcome observed · evidence recorded';
     if(!outcome)throw Error('The controller stopped before the native four-goal target was reached.');
     ended=true;status.textContent=outcome;report();break;
    }
    if(!decision.action)throw Error('Hybrid controller did not return an action.');
    plan=decision.plan;stepsSinceVisual=decision.stepsSinceVisual;
   }else{
    status.textContent='Agent is inspecting the game';controller=new AbortController();
    const response=await fetch('/api/agent/decision',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({game,minFrames,maxFrames,initialScore:runContext.baseline.match?.score1??0,state:describe(before),image:api().capture(),history:history.slice(-6).map(h=>({action:h.action,after:h.after}))})});
    decision=await response.json();if(!response.ok)throw Error(decision.error);
   }
   if(token!==generation)break;
   const {action}=decision;status.textContent=(mode==='scripted'?'Rehearsal · ':'')+action.phase+' · '+action.reason;
   const after=await api().act(action);
   const human=after.players.find(p=>p.human),oldHuman=before.players.find(p=>p.human);
   const event=game==='football-legends'&&after.match.score1>before.match.score1?'Observed: human scored. Native scoreboard '+after.match.score1+'–'+after.match.score2:game==='football-legends'&&oldHuman?.superReady&&human?.superCharge<1?'Observed: charged ability activated. Score remains '+after.match.score1+'–'+after.match.score2:game==='ovo'&&after.completed&&!before.completed?'Observed: native level completion card appeared':game==='ovo'&&after.state!==before.state?'Observed: native layout changed to '+after.state:null;
   const entry={...decision,before:describe(before),after:describe(after),event,guided:true};history.push(entry);add(entry);
   if(game==='football-legends'){
    const outcome=footballOutcome(after);
    if(outcome){ended=true;status.textContent=outcome;}
   }
   if(game==='ovo'&&(after.completed||Number(/^Level (\d+)$/.exec(after.state)?.[1])>9)){ended=true;status.textContent='Native level completion observed · evidence recorded';}
   if(game==='ovo'&&after.state!=='Level 9'&&!ended){ended=true;status.textContent='Level exited · shortcut remains unconfirmed';}
   report();if(ended)break;
   await sleep(Math.max(0,1000/playbackFps-(performance.now()-iterationStarted)));
  }
  if(token===generation&&!ended)status.textContent=game==='football-legends'?'Decision limit reached · four-goal target not reached':'Run complete · hypothesis unconfirmed';
 }catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
 finally{if(token===generation){running=false;controls(false);api().releaseKeys();report();}}
}
run.onclick=()=>start();rehearse.onclick=()=>start({mode:'scripted'});stop.onclick=halt;
window.swarm={start,stop:halt,get history(){return history;},get running(){return running;}};
try{
 const config=await(await fetch('/api/agent/config?game='+encodeURIComponent(game))).json();
 configured=config.configured;hybridConfigured=Boolean(config.hybrid?.configured);
 const family=config.model.includes('luna')?'Luna':config.model.includes('astra')?'Astra':'Sol';
 const label=family+(config.model.endsWith('-fast')?' Fast':'');
 modelBadge=label+' · '+(config.transport==='ChatGPT subscription'?'subscription':'API')+' · low effort';modelId=config.model;
 document.querySelector('#agent-model').textContent=modelBadge;
 document.querySelector('#agent-model').title=modelId;visualRunLabel='Run '+label+' agent →';run.textContent=visualRunLabel;
 modeSelect.querySelector('[value=hybrid]').disabled=!hybridConfigured;
 modeSelect.querySelector('[value=tactical]').disabled=!hybridConfigured||!config.hybrid?.strategies?.includes('tactical');
 if(hybridConfigured&&config.hybrid?.strategies?.includes('tactical'))modeSelect.value='tactical';
 while(!api()?.observe().ready)await sleep(50);
 controls(false);syncMode();status.textContent=configured?'Ready':config.transport==='ChatGPT subscription'?'Sign in to Codex or configure a subscription token provider.':'Add OPENAI_API_KEY to .env and restart the local server.';
}catch(error){status.textContent=error.message;}
