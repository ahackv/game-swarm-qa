import {describe as describeState} from './observations.js';
import {renderReport} from './report.js';
import {ovoRehearsalAction} from './rehearsal.js';

const game=location.pathname.slice(1);
const api=()=>window.gameAgent;
const run=document.querySelector('#agent-run'),stop=document.querySelector('#agent-stop'),rehearse=document.querySelector('#agent-rehearse'),status=document.querySelector('#agent-status'),ledger=document.querySelector('#agent-ledger');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let running=false,generation=0,controller=null,configured=false,runContext=null,modelBadge='',modelId='';
const history=[];
const describe=s=>describeState(game,s);
document.querySelector('#agent-hypothesis').textContent=game==='football-legends'?'Seed hypothesis: camp inside your own raised goal, charge the fireball naturally, then score across the field.':'Seed hypothesis: lower the left gate, face right at the wall, tap jump with horizontal keys released, then cross left and dive to the exit.';
rehearse.hidden=game!=='ovo';
function add(entry){
 const li=document.createElement('li');
 const keys=entry.action.keys.length?entry.action.keys.join(' + '):'release / wait';
 li.textContent=String(history.length).padStart(2,'0')+' · '+keys+' · hold '+entry.action.holdFrames+' / '+entry.action.frames+' frames · '+entry.action.reason;
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
 run.disabled=active||!configured;rehearse.disabled=active;stop.disabled=!active;
 if(game==='football-legends'&&api()?.observe().state!=='menu')document.querySelector('#quick').disabled=true;
}
function halt(){generation++;running=false;controller?.abort();api()?.releaseKeys();controls(false);status.textContent='Stopped · game frozen';report();}
async function start({limit=120,playbackFps=Number(document.querySelector('#agent-rate').value),minFrames,maxFrames,mode='live'}={}){
 if(running)return;
 if(mode==='scripted'&&game!=='ovo')throw Error('This rehearsal is for OvO.');
 history.length=0;ledger.replaceChildren();document.querySelector('#agent-count').textContent='0';document.querySelector('#finding-report').hidden=true;
 const cadence=document.querySelector('#agent-horizon').value;
 if(mode==='scripted'){minFrames=30;maxFrames=30;}
 else if(maxFrames===undefined){maxFrames=cadence==='2hz'?(game==='ovo'?30:20):cadence==='4hz'?(game==='ovo'?15:10):cadence==='native'?1:120;minFrames=cadence==='adaptive'?1:maxFrames;}
 minFrames??=1;
 running=true;const token=++generation;controls(true);runContext={mode,startedAt:Date.now()};
 document.querySelector('#agent-count-label').textContent=mode==='scripted'?'input batches':'decisions';
 document.querySelector('#agent-model').textContent=mode==='scripted'?'Scripted · no model calls':modelBadge;
 document.querySelector('#agent-model').title=mode==='scripted'?'Deterministic ordinary-input reproduction':modelId;
 try{
  api().stop();
  if(game==='football-legends'&&api().observe().state==='menu')await api().startQuickMatch({fireball:true});
  if(game==='ovo')await api().startLevel(9);
  if(token!==generation)return;
  runContext.baseline=api().observe();let ended=false;
  for(let n=0;n<limit&&token===generation;n++){
   const before=api().observe();let decision;
   if(mode==='scripted'){
    decision={action:ovoRehearsalAction(before,history),model:'Scripted rehearsal',transport:'Local script · no model call',latencyMs:0};
   }else{
    status.textContent='Inspecting screenshot · game clock frozen';controller=new AbortController();
    const response=await fetch('/api/agent/decision',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({game,minFrames,maxFrames,state:describe(before),image:api().capture(),history:history.slice(-6).map(h=>({action:h.action,after:h.after}))})});
    decision=await response.json();if(!response.ok)throw Error(decision.error);
   }
   if(token!==generation)break;
   const {action}=decision;status.textContent=(mode==='scripted'?'Rehearsal · ':'')+action.phase+' · '+action.reason;
   const after=await api().act(action);
   const human=after.players.find(p=>p.human),oldHuman=before.players.find(p=>p.human);
   const event=game==='football-legends'&&after.match.score1>before.match.score1?'Observed: human scored. Native scoreboard '+after.match.score1+'–'+after.match.score2:game==='football-legends'&&oldHuman?.superReady&&human?.superCharge<1?'Observed: charged ability activated. Score remains '+after.match.score1+'–'+after.match.score2:game==='ovo'&&after.completed&&!before.completed?'Observed: native level completion card appeared':game==='ovo'&&after.state!==before.state?'Observed: native layout changed to '+after.state:null;
   const entry={...decision,before:describe(before),after:describe(after),event,guided:true};history.push(entry);add(entry);
   if(game==='football-legends'&&after.match.score1>runContext.baseline.match.score1){ended=true;status.textContent='Goal observed · game frozen · evidence recorded';}
   if(game==='ovo'&&(after.completed||Number(/^Level (\d+)$/.exec(after.state)?.[1])>9)){ended=true;status.textContent='Native level completion observed · evidence recorded';}
   if(game==='ovo'&&after.state!=='Level 9'&&!ended){ended=true;status.textContent='Level exited · shortcut remains unconfirmed';}
   report();if(ended)break;
   await sleep(1000/playbackFps);
  }
  if(token===generation&&!ended)status.textContent='Decision limit reached · game frozen · hypothesis unconfirmed';
 }catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
 finally{if(token===generation){running=false;controls(false);api().releaseKeys();report();}}
}
run.onclick=()=>start();rehearse.onclick=()=>start({mode:'scripted'});stop.onclick=halt;
window.swarm={start,stop:halt,get history(){return history;},get running(){return running;}};
try{
 const config=await(await fetch('/api/agent/config?game='+encodeURIComponent(game))).json();
 configured=config.configured;
 const family=config.model.includes('luna')?'Luna':config.model.includes('astra')?'Astra':'Sol';
 const label=family+(config.model.endsWith('-fast')?' Fast':'');
 modelBadge=label+' · '+(config.transport==='ChatGPT subscription'?'subscription':'API')+' · low effort';modelId=config.model;
 document.querySelector('#agent-model').textContent=modelBadge;
 document.querySelector('#agent-model').title=modelId;run.textContent='Run '+label+' agent →';
 while(!api()?.observe().ready)await sleep(50);
 controls(false);status.textContent=configured?'Ready · screenshot → model → keys → next observation':config.transport==='ChatGPT subscription'?'Sign in to Codex or configure a subscription token provider.':'Add OPENAI_API_KEY to .env and restart the local server.';
}catch(error){status.textContent=error.message;}
