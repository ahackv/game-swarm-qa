import {games,gameSlug as game} from './games.js';
import {describe} from './observations.js';
import {profiles,validateProfile} from './explore-policy.js';

const api=()=>window.gameAgent, $=selector=>document.querySelector(selector);
const run=$('#explore-run'),stop=$('#explore-stop'),status=$('#agent-status');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const storageKey='swarm-qa-explore-v1-'+game;
let running=false,generation=0,controller,configured=false,needsReset=false,current=null;
const history=[];
let sessions=[];
try{sessions=JSON.parse(localStorage.getItem(storageKey)||'[]').filter(s=>s?.game===game&&Object.hasOwn(profiles,s.profile)&&s.purpose==='explore'&&Array.isArray(s.decisions)&&Number.isFinite(s.gameSeconds)).slice(0,6);}catch{/* A blocked or full browser store does not stop a playtest. */}
const initialProfile=new URLSearchParams(location.search).get('profile');
if(Object.hasOwn(profiles,initialProfile))$(`input[value="${initialProfile}"]`).checked=true;
$('#back-game').href='/'+game;$('#back-game').textContent='← '+games[game].title+' / Overview';
$('#cover-image').src='/previews/'+game+'.png';$('#cover-image').alt=games[game].title+' playtest preview';
if(game==='ovo'){$('#outcome-label').textContent='NATIVE LEVEL';$('#live-outcome').textContent='Level 1';$('#session-setting').textContent='Start at level 1';}

function controls(active){
  run.disabled=active||!configured;stop.disabled=!active;
  for(const control of document.querySelectorAll('input[name=profile],.controls button'))control.disabled=active;
  document.body.classList.toggle('is-running',active);
}
function outcome(state){
  if(game==='football-legends')return `${state.match?.score1??0} – ${state.match?.score2??0}`;
  return state.state;
}
function update(state){
  $('#live-outcome').textContent=outcome(state);
  $('#play-time').textContent=Math.max(0,(state.clock.simulationSeconds-(current?.baseline?.clock.simulationSeconds||0))).toFixed(1)+' s';
  $('#decision-count').textContent=history.filter(d=>!d.engineWait).length;
  $('#review-count').textContent=history.filter(d=>d.visualReview).length;
}
function exportSession(session){
  const url=URL.createObjectURL(new Blob([JSON.stringify(session,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`swarm-qa-${game}-${session.profile}-${session.startedAt}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderSessions(){
  $('#history-empty').hidden=sessions.length>0;$('#session-history').replaceChildren();
  for(const session of sessions){
    const row=document.createElement('div');row.className='run-result';
    const avatar=document.createElement('span');avatar.className='avatar '+session.profile;avatar.textContent=session.profile[0].toUpperCase();
    const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');
    title.textContent=profiles[session.profile].label+' · '+session.outcome;
    detail.textContent=`${session.decisions.filter(d=>!d.engineWait).length} decisions · ${session.gameSeconds.toFixed(1)} s game time · ${session.status}`;
    const button=document.createElement('button');button.textContent='Export JSON ↓';button.onclick=()=>exportSession(session);
    copy.append(title,detail);row.append(avatar,copy,button);$('#session-history').append(row);
  }
}
function finish(reason){
  if(!current?.baseline||current.saved)return;
  current.saved=true;
  const final=describe(game,api().observe());
  const record={schemaVersion:1,purpose:'explore',guided:false,game,profile:current.profile,profilePrompt:profiles[current.profile].prompt,startedAt:current.startedAt,finishedAt:new Date().toISOString(),status:reason,outcome:outcome(final),gameSeconds:Math.max(0,final.clock.simulationSeconds-current.baseline.clock.simulationSeconds),baseline:current.baseline,final,decisions:[...history],provenance:'Ordinary gameplay by a selected player profile. Jev selects movement from locally timed actions; the visual model reviews uncertain moves. No finding route or game outcome is supplied.'};
  sessions.unshift(record);sessions=sessions.slice(0,6);
  try{localStorage.setItem(storageKey,JSON.stringify(sessions));}catch{/* Export stays available for the current session. */}
  renderSessions();
}
function halt(){
  if(!running)return;
  generation++;controller?.abort();running=false;api()?.releaseKeys();controls(false);
  status.textContent='Playtest stopped. Select either profile to start a fresh run.';$('#session-status').textContent='Stopped';finish('Stopped');
}
async function start({profile=$('input[name=profile]:checked').value,limit=120,playbackFps=2}={}){
  if(running)return;
  validateProfile(profile);
  if(!Number.isInteger(limit)||limit<1||limit>600)throw Error('Decision limit must be between 1 and 600.');
  $(`input[value="${profile}"]`).checked=true;
  const token=++generation;running=true;controller=new AbortController();controls(true);
  history.length=0;$('#action-feed').replaceChildren();current={profile,startedAt:new Date().toISOString()};
  $('#decision-count').textContent='0';$('#review-count').textContent='0';$('#play-time').textContent='0.0 s';
  $('#session-status').textContent=profiles[profile].label+' is playing';status.textContent='Starting a fresh '+(game==='ovo'?'level':'match')+'…';
  $('#game-cover').hidden=false;
  let ending='Session complete';
  try{
    api().stop();api().releaseKeys();
    if(needsReset||api().observe().state!==(game==='ovo'?'Main Menu':'menu'))await api().reset({signal:controller.signal});
    needsReset=true;
    if(game==='ovo')await api().startLevel(1,{signal:controller.signal});
    else await api().startQuickMatch({fireball:true,signal:controller.signal});
    if(token!==generation)return;
    // Native setup enables manual controls. Keep ownership with the running agent.
    controls(true);current.baseline=describe(game,api().observe());api().capture();$('#game-cover').hidden=true;update(api().observe());
    for(let n=0;n<limit&&token===generation;n++){
      const tick=performance.now(),before=api().observe();
      if(game==='football-legends'&&before.core?.isEnd){ending='Match finished';break;}
      if(game==='ovo'&&!/^Level \d+$/.test(before.state)){ending='Level exited';break;}
      const input={game,profile,state:describe(game,before),history:history.slice(-6).map(d=>({action:d.action,before:d.before,after:d.after}))};
      const request=async body=>{
        const response=await fetch('/api/explore/decision',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Agent request failed.');return result;
      };
      $('#thinking-label').textContent='CHOOSING THE NEXT MOVE';
      let decision=await request(input);
      if(decision.needsVisual&&token===generation){
        $('#thinking-label').textContent='LOOKING AT THE GAME';
        const escalation=decision;
        decision=await request({...input,image:api().capture()});
        decision.latencyMs=(decision.latencyMs||0)+(escalation.latencyMs||0);
        decision.apiEquivalentCostUsd=(decision.apiEquivalentCostUsd||0)+(escalation.jev?.costUsd||0);
        if(escalation.jev)decision.jev={model:escalation.jev.model,choice:escalation.jev.choice,confidence:escalation.jev.confidence,latencyMs:escalation.jev.latencyMs};
      }
      if(token!==generation)break;
      if(!decision.action)throw Error('No playable action was returned.');
      status.textContent=decision.action.reason;$('#thinking-label').textContent='PLAYING / '+profiles[profile].label.toUpperCase();
      const after=await api().act(decision.action);
      if(after.state!==before.state)api().releaseKeys();
      const entry={...decision,before:describe(game,before),after:describe(game,after)};
      history.push(entry);update(after);
      const li=document.createElement('li'),detail=document.createElement('code');
      li.textContent=String(history.length).padStart(2,'0')+' · '+decision.action.reason;
      detail.textContent=(decision.engineWait?'Game transition':decision.visualReview?'Visual review':'Jev decision')+' · '+(decision.action.keys.join(' + ')||'Wait');li.append(detail);$('#action-feed').prepend(li);
      if($('#action-feed').children.length>20)$('#action-feed').lastElementChild.remove();
      await sleep(Math.max(0,1000/Math.max(1,Math.min(playbackFps,60))-(performance.now()-tick)));
    }
    if(token===generation){status.textContent=ending+'. Try the other profile to compare its play.';$('#session-status').textContent=ending;finish(ending);}
  }catch(error){if(token===generation){ending=error.name==='AbortError'?'Stopped':'Error: '+error.message;status.textContent=ending;$('#session-status').textContent='Needs attention';finish(ending);}}
  finally{if(token===generation){running=false;api().releaseKeys();controls(false);}}
}
run.onclick=()=>start();stop.onclick=halt;window.addEventListener('pagehide',()=>{controller?.abort();api()?.releaseKeys();});
window.swarm={start,stop:halt,get history(){return history;},get running(){return running;},get sessions(){return sessions;}};
renderSessions();
try{
  const config=await(await fetch('/api/agent/config?game='+game)).json();configured=config.explore?.configured??config.configured;
  $('#engine-label').textContent=config.explore?.jevConfigured?'Jev movement · visual review when needed':'Visual agent · one decision at a time';
  while(!api()?.observe().ready)await sleep(50);
  controls(false);status.textContent=configured?'Choose a player profile, then watch the agent play.':'Sign in to Codex or configure the visual model to start a playtest.';
}catch(error){status.textContent=error.message;}
