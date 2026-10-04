import {creditsObservation,creditsUnlocked,validateCreditsAction,CREDITS_LEVELS} from './credits-policy.js';
import {renderReport} from './report.js';
import {createDecisionInspector,formatLatency} from './decision-inspector.js';

const $=selector=>document.querySelector(selector),api=()=>window.gameAgent;
const run=$('#agent-run'),stop=$('#agent-stop'),status=$('#agent-status'),history=[];
let configured=false,running=false,controller,generation=0,current=null;
const inspector=createDecisionInspector({dialog:$('#decision-inspector'),content:$('#inspection-content'),title:$('#inspection-title'),closeButton:$('#inspection-close')});
const target=document.createElement('span');target.className='credits-target';target.hidden=true;target.setAttribute('aria-hidden','true');$('.screen').append(target);
document.body.classList.add('credits-finding');
$('.agent-top .eyebrow').textContent='LUNA / VISUAL REPRODUCTION';
$('.agent-top h2').textContent='One click target. 52 levels.';
for(const id of ['#agent-mode','#agent-horizon','#agent-rate','#agent-rehearse'])$(id).hidden=true;
run.textContent='Run Luna demonstration ↗';
$('#agent-description').textContent='Luna chooses the click position from a screenshot. The game handles the double-click and records the result.';
$('#agent-hypothesis').textContent='Supplied hypothesis: double-clicking the DEDRA logo unlocks every level. Each run uses a fresh temporary save.';
const progress=$('#agent-goal-progress');progress.classList.add('credits-progress');progress.hidden=false;
$('#rate').textContent='Luna visual input · native progression verification';
$('#agent-ledger').addEventListener('click',event=>{
  const button=event.target.closest('button[data-decision-id]');if(button)inspector.open(Number(button.dataset.decisionId));
});

function pause(ms,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,ms),abort=()=>{clearTimeout(timer);reject(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
function controls(active){
  run.disabled=active||!configured;stop.disabled=!active;
  for(const button of document.querySelectorAll('.controls button'))button.disabled=active;
  document.body.classList.toggle('is-running',active);
}
function update(state){
  progress.textContent=(current?.baseline?current.baseline.unlockedLevels+' → ':'')+(state?.unlockedLevels??'—')+' / '+CREDITS_LEVELS+' levels unlocked';
  $('#agent-count').textContent=history.length;
  $('#agent-count-label').textContent=history.length===1?'decision':'decisions';
}
function report(){
  if(!current?.baseline)return;
  $('#finding-report').hidden=false;
  renderReport({game:'ovo',finding:'credits-unlock',mode:'live',history,baseline:current.baseline,final:creditsObservation(api().observe()),status:status.textContent,startedAt:current.startedAt,finishedAt:Date.now()});
}
function log(entry,image,inspection){
  history.push(entry);
  inspector.add(history.length,{action:entry.action,calls:inspection?[inspection]:[],image,decisionMode:'luna'});
  const li=document.createElement('li'),button=document.createElement('button'),meta=document.createElement('span'),outcome=document.createElement('span');
  button.type='button';button.className='credits-move';button.dataset.decisionId=history.length;button.setAttribute('aria-haspopup','dialog');
  button.textContent=history.length+' · '+entry.action.reason;
  meta.className='credits-move-meta';meta.textContent='Luna · '+formatLatency(entry.latencyMs)+' · '+(entry.action.type==='double_click'?'double-click at '+Math.round(entry.action.x*100)+'%, '+Math.round(entry.action.y*100)+'%':'stop')+' ↗';
  outcome.className='event';outcome.textContent='Native levels: '+entry.before.unlockedLevels+' → '+entry.after.unlockedLevels;
  button.append(meta,outcome);li.append(button);$('#agent-ledger').prepend(li);
}
async function start(){
  if(running||!configured)return;
  running=true;controller=new AbortController();const signal=controller.signal,token=++generation;
  inspector.clear();history.length=0;$('#agent-ledger').replaceChildren();$('#finding-report').hidden=true;$('#finding-report').replaceChildren();target.hidden=true;
  current={startedAt:Date.now()};controls(true);update();
  try{
    status.textContent='Opening credits with a fresh temporary save…';
    // Finish the short native bootstrap even after Stop, so the replacement
    // iframe reaches its clock barrier. An aborted run takes no further input.
    await api().reset();signal.throwIfAborted();controls(true);
    await api().openCredits({signal});signal.throwIfAborted();
    current.baseline=creditsObservation(api().observe());update(current.baseline);
    if(current.baseline.unlockedLevels!==1)throw Error('The fresh game did not start with one unlocked level.');
    for(let attempt=0;attempt<3;attempt++){
      const before=creditsObservation(api().observe());
      if(before.state!=='Credits')throw Error('The game left the credits screen.');
      status.textContent=attempt?'The level count did not change. Luna is checking the target again…':'Luna is locating the logo in the screenshot…';
      let image=api().capture();
      const canvas=$('#game').contentDocument.querySelector('canvas'),viewport={width:canvas.width,height:canvas.height};
      const response=await fetch('/api/credits/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:'ovo',state:before,image,history,inspect:true}),signal});
      const data=await response.json();signal.throwIfAborted();
      if(!response.ok)throw Error(data.error||'The visual model request failed.');
      const {inspection,...decision}=data,action=validateCreditsAction(decision.action);
      if(JSON.stringify(before)!==JSON.stringify(creditsObservation(api().observe())))throw Error('The game changed during the decision. Run the test again.');
      let after=before;
      if(action.type==='double_click'){
        status.textContent='Luna chose a target. Sending the double-click…';
        target.style.left=action.x*100+'%';target.style.top=action.y*100+'%';target.hidden=false;
        await pause(450,signal);
        after=creditsObservation(await api().pointer({...action,viewport},{signal}));
      }
      signal.throwIfAborted();
      log({...decision,before,after},image,inspection);image=undefined;update(after);
      if(creditsUnlocked(before,after)){status.textContent='Verified: the native count changed from '+before.unlockedLevels+' to 52 unlocked levels.';break;}
      if(action.type==='stop'){status.textContent='Stopped by Luna: '+action.reason;break;}
      status.textContent='Unlock unconfirmed after '+history.length+' attempts. Inspect the model decisions and try again.';
    }
  }catch(error){if(token===generation)status.textContent=signal.aborted?'Demonstration stopped.':error.message;}
  finally{
    if(token===generation){running=false;target.hidden=true;api().releaseKeys();controls(false);update(api().observe());report();}
  }
}
function halt(){controller?.abort();}
run.onclick=start;stop.onclick=halt;
window.addEventListener('pagehide',()=>{
  generation++;controller?.abort();running=false;inspector.clear();history.length=0;current=null;target.hidden=true;
  api()?.releaseKeys();$('#agent-ledger').replaceChildren();$('#finding-report').replaceChildren();$('#finding-report').hidden=true;controls(false);
  status.textContent='Run Luna to reproduce the unlock from a fresh save.';update(api()?.observe());
});
window.swarm={start,stop:halt,get history(){return history;},get running(){return running;}};
const token=generation;
try{
  const response=await fetch('/api/agent/config?game=ovo');if(!response.ok)throw Error('Agent configuration is unavailable.');
  const config=await response.json();configured=config.configured;$('#agent-model').textContent=config.model;
  while(!api()?.observe().ready){if(token!==generation)break;await pause(50);}
  if(token===generation){await api().openCredits();update(api().observe());controls(false);status.textContent=configured?'Ready. Luna will choose the logo’s position from the game screen.':'Sign in to Codex or configure the visual model to start.';}
}catch(error){if(token===generation)status.textContent=error.message;}
