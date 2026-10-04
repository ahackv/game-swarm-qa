// Exact geometry and key timing stay local. A text policy may authorize only
// the current action or this controller's next phase; it never invents keys.
export const POLICY_PHASES=Object.freeze({
 'football-legends':Object.freeze(['Approach net','Adjust camp','Wait for charge','Fire super','Verify goal']),
 ovo:Object.freeze(['Approach wall','Face away','Climb wall','Cross wall','Smash to flag','Observe completion']),
});
export const POLICY_INITIAL_PHASE=Object.freeze({'football-legends':'Approach net',ovo:'Approach wall'});
const hypotheses={
 'football-legends':'Camping inside the raised left goal and waiting for the naturally charged fireball can score against the built-in bot.',
 ovo:'Facing away from the left wall permits repeated jump taps to climb it and bypass the normal Level 9 route.',
};
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const playerOf=(game,state)=>game==='ovo'?state?.players?.find(p=>p.behaviors?.[0]?.enabled):state?.players?.find(p=>p.human);
function stalled(game,history,phase){
 if(!['Approach net','Adjust camp','Approach wall','Climb wall','Cross wall'].includes(phase))return false;
 const recent=history.slice(-6);
 if(recent.length<6||recent.some(h=>h.action?.phase!==phase))return false;
 const first=playerOf(game,recent[0].before),last=playerOf(game,recent.at(-1).after);
 if(!first||!last)return false;
 return Math.hypot(last.x-first.x,last.y-first.y)<6;
}
export function evaluatePolicy({game,state,history=[],plan={}}){
 if(!POLICY_PHASES[game])throw Error('Unsupported game policy.');
 const frames=game==='ovo'?30:20;
 const phase=plan.phase||history.at(-1)?.action?.phase||POLICY_INITIAL_PHASE[game];
 const action=(keys,holdFrames,phase,reason)=>({keys,frames,holdFrames,phase,reason,hypothesis:hypotheses[game]});
 const wait=(phase,reason)=>action([],frames,phase,reason);
 const player=playerOf(game,state),previous=history.at(-1)?.before;
 let completed=game==='ovo'?Boolean(state?.completed||Number(/^Level (\d+)$/.exec(state?.state)?.[1])>9):Boolean(state?.match?.score1>(plan.initialScore??history[0]?.before?.match?.score1??0));
 let reason=null;
 if(!POLICY_PHASES[game].includes(phase))reason='Unrecognized controller phase.';
 else if(!state?.ready&&state?.ready!==undefined)reason='Native game is not ready.';
 else if(!player&&!completed)reason='The active native player is unavailable.';
 const base={currentPhase:phase,completed};
 if(reason||completed){
  const a=wait(phase,completed?'Native completion observed.':'Wait for visual review.');
  return {...base,features:{game,completed,playerAvailable:Boolean(player),unexpectedState:Boolean(reason),progressStalled:false},suggestedPhase:phase,phaseReady:false,proposedAction:a,continuationAction:a,requiresVisualReason:reason};
 }
 const result=game==='ovo'?ovoPolicy(state,history,phase,player,action,wait):footballPolicy(state,history,phase,player,action,wait);
 const isStalled=stalled(game,history,phase);
 let reset=false;
 if(previous){
  const old=playerOf(game,previous);
  reset=Boolean(old&&game==='ovo'&&state.state===previous.state&&player.y>1200&&player.x>300&&(old.x<200||old.y<1000||Math.hypot(old.x-player.x,old.y-player.y)>450));
 }
 if(reset){result.suggestedPhase=POLICY_INITIAL_PHASE[game];result.proposedAction=wait(result.suggestedPhase,'Review the native respawn before restarting the route.');}
 const levelChanged=game==='ovo'&&state.state!==(plan.expectedLevel||'Level 9');
 const unexpected=levelChanged||(game==='football-legends'&&state.state!=='gameplay');
 result.requiresVisualReason=reset?'The native player respawned.':unexpected?'The native game changed to an unexpected level or screen.':result.requiresVisualReason||(isStalled?'Movement has not progressed across six control intervals.':null);
 return {...base,...result,phaseReady:result.suggestedPhase!==phase,features:{game,...result.features,completed,playerAvailable:true,unexpectedState:unexpected,respawned:reset,progressStalled:isStalled}};
}
function ovoPolicy(state,history,phase,p,action,wait){
 const wallReached=p.x<=177,aboveWall=p.y<=535,crossedWall=p.x<=145;
 const facingAway=p.facing===1;
 const features={levelNine:state.state==='Level 9',wallReached,facingAway,aboveWall,crossedWall,abovePlatform:p.y<984,falling:(p.behaviors[0]?.dy??0)>0,inputLocked:Boolean(p.behaviors[0]?.ignoreInput)};
 const approaching=()=>wallReached?wait('Approach wall','The wall is reached; release horizontal movement.'):action(['ArrowLeft'],30,'Approach wall','Cross the floor button and approach the lowered left gate.');
 const face=()=>action(['ArrowRight'],1,'Face away','Tap right for one native frame to face away while staying beside the wall.');
 const climb=()=>action(['ArrowUp'],1,'Climb wall','Tap jump for one frame with horizontal input released to repeat the wall-jump behavior.');
 const cross=()=>action(['ArrowLeft'],10,'Cross wall','Cross above the wall with ten left-input frames, then release.');
 const smash=()=>action(['ArrowDown'],1,'Smash to flag','Tap down to halt lateral drift and dive through the platform toward the flag.');
 let next=phase,continuation=wait(phase,'Let the native movement finish.'),proposed=continuation,reason=null;
 if(phase==='Approach wall'){
  continuation=approaching();if(wallReached){next='Face away';proposed=face();}
 }else if(phase==='Face away'){
  if(!facingAway){continuation=face();}else {next='Climb wall';proposed=climb();}
 }else if(phase==='Climb wall'){
  continuation=aboveWall?wait(phase,'The wall top is cleared; await the crossing phase.'):climb();
  if(!facingAway&&!aboveWall){continuation=wait(phase,'Release input until the required facing direction is restored.');next='Face away';proposed=face();reason='Facing changed during the wall climb; review and restore the required orientation.';}
  else if(aboveWall){next='Cross wall';proposed=cross();}
 }else if(phase==='Cross wall'){
  continuation=crossedWall?wait(phase,'The wall is crossed; release left to avoid overshooting.'):cross();
  if(crossedWall){next='Smash to flag';proposed=smash();}
 }else if(phase==='Smash to flag'){
  continuation=wait(phase,'Let the ground-pound carry the player toward the flag.');
  if(history.at(-1)?.action?.phase==='Smash to flag'){next='Observe completion';proposed=wait(next,'Release inputs and inspect native level completion.');}else continuation=smash();
 }else if(phase==='Observe completion'){
  continuation=wait(phase,'Release inputs while the native fall reaches the exit.');
 }
 if(next===phase)proposed=continuation;
 return {features,suggestedPhase:next,proposedAction:proposed,continuationAction:continuation,requiresVisualReason:reason};
}
function footballPolicy(state,history,phase,p,action,wait){
 const ball=state.ball,core=state.core||{},inNet=p.x>=55&&p.x<=96&&p.y<280,settled=Boolean(p.onGround)&&Math.abs(p.vx)<20;
 const ready=Boolean(p.superReady),inRange=Boolean(ball&&Math.abs(p.x-ball.x)<=80&&Math.abs(p.y-ball.y)<=80);
 const prior=playerOf('football-legends',history.at(-1)?.before);
 const fired=Boolean(ball?.superHit||prior?.superReady&&p.superCharge<1);
 const playing=!core.isCountDown&&!core.isGoal&&!core.isEnd&&core.isPlaying!==false;
 const features={nativeMatchActive:playing,countdown:Boolean(core.isCountDown),goalAnimation:Boolean(core.isGoal),insideNet:inNet,settled,superReady:ready,ballInFiringRange:inRange,fireballInFlight:Boolean(ball?.superHit),abilityActivated:fired,expectedAbility:p.superPower===0};
 const move=target=>{
  const direction=p.x>target?'ArrowLeft':'ArrowRight',distance=Math.abs(p.x-target);
  // The original controller moves at 370 units/s and retains 90% of lateral
  // speed per air frame after release. Leave room for that native coasting.
  const coast=p.onGround&&p.y>280?75:(!p.onGround?75:12);
  const hold=clamp(Math.round((distance-coast)/8.325)+1,1,20);
  return {direction,hold};
 };
 const approach=()=>{
  if(inNet||p.x<125&&!p.onGround)return wait('Approach net','Release input and let the jump settle inside the raised net.');
  const m=move(80),keys=[m.direction];if(p.onGround&&p.y>280)keys.push('ArrowUp');
  return action(keys,m.hold,'Approach net','Jump left over the raised goal step, allowing for native momentum after release.');
 };
 const adjust=()=>{
  if(!p.onGround&&Math.abs(p.vx)>15)return wait('Adjust camp','Let lateral momentum settle before correcting the camp position.');
  if(inNet)return wait('Adjust camp','The player is inside the net; release all movement.');
  const m=move(78),keys=[m.direction];if(p.onGround&&p.y>280)keys.push('ArrowUp');
  return action(keys,m.hold,'Adjust camp','Use a short directional hold to place the player inside the raised net.');
 };
 let next=phase,continuation=wait(phase,'Wait for the native match state.'),proposed=continuation,reason=null;
 if(!playing)return {features,suggestedPhase:phase,proposedAction:continuation,continuationAction:continuation,requiresVisualReason:core.isEnd?'The native match ended before this hypothesis produced a recorded goal.':null};
 if(p.superPower!==0)reason='The active character does not have the fireball ability required by this guided strategy.';
 if(phase==='Approach net'){
  continuation=approach();if(p.x<125&&p.y<280){next='Adjust camp';proposed=adjust();}
 }else if(phase==='Adjust camp'){
  continuation=adjust();if(inNet&&settled){next='Wait for charge';proposed=wait(next,'Remain in the goal while the native ability recharges.');}
 }else if(phase==='Wait for charge'){
  continuation=wait(phase,'Remain inside the raised net while the fireball charges naturally.');
  if(!inNet){next='Adjust camp';proposed=adjust();}else if(ready){next='Fire super';proposed=action(['KeyZ'],20,next,'Hold the charged super shot so it launches when the ball enters native firing range.');}
 }else if(phase==='Fire super'){
  continuation=action(['KeyZ'],20,phase,'Keep the charged super shot held while waiting for the ball to enter range.');
  if(fired||!ready){next='Verify goal';proposed=wait(next,'The charged ability activated; inspect the native scoreboard.');}
  else if(!inNet){next='Adjust camp';proposed=adjust();}
 }else if(phase==='Verify goal'){
  continuation=wait(phase,'Wait for the launched ball and read the native scoreboard.');
  const attempts=history.slice(-4).filter(h=>h.action?.phase==='Verify goal').length;
  if(!ball?.superHit&&attempts>=3){next=inNet?'Wait for charge':'Adjust camp';proposed=inNet?wait(next,'No goal is recorded yet; wait for the next native charge.'):adjust();}
 }
 if(next===phase)proposed=continuation;
 return {features,suggestedPhase:next,proposedAction:proposed,continuationAction:continuation,requiresVisualReason:reason};
}
