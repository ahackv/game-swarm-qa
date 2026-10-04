import {evaluatePolicy,POLICY_INITIAL_PHASE,POLICY_PHASES} from './hybrid-policy.js';

// Candidate availability protects physical preconditions; Jev chooses an
// actual direction or ability. Local code alone converts it to native keys.
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function evaluateTactics({game,state,history=[],plan={}}){
 const normalizedPlan={...plan,phase:POLICY_PHASES[game]?.includes(plan.phase)?plan.phase:POLICY_INITIAL_PHASE[game]};
 const policy=evaluatePolicy({game,state,history,plan:normalizedPlan});
 const player=game==='ovo'?state?.players?.find(p=>p.behaviors?.[0]?.enabled):state?.players?.find(p=>p.human);
 const frames=game==='ovo'?30:20,candidates={};
 const hypothesis=policy.continuationAction.hypothesis;
 function add(id,keys,holdFrames,phase,description,criteria){
  const action={keys,frames,holdFrames,phase,reason:description,hypothesis};
  candidates[id]={id,description,criteria,phase,action};
 }
 const base={...policy,candidates};
 if(policy.completed)return {...base,strategyHints:[]};
 if(!player||policy.features.unexpectedState||policy.features.respawned){
  add('wait',[],frames,policy.currentPhase,'Release controls while reviewing the native game state.','The game screen, active player, or respawn is unresolved.');
  return {...base,strategyHints:['An unfamiliar screen or respawn needs visual review.']};
 }
 if(game==='football-legends')return footballTactics(base,state,player,history,normalizedPlan,add);
 return ovoTactics(base,state,player,history,normalizedPlan,add);
}
function footballTactics(base,state,p,history,plan,add){
 const f=base.features,ball=state.ball;
 const airborne=!p.onGround;
 const targetDirection=p.x<65?'right':p.x>90?'left':'hold';
 const movingLeft=p.vx< -15,movingRight=p.vx>15;
 const settlingNearNet=airborne&&p.x<125&&((movingLeft&&p.x>60)||Math.abs(p.vx)<=15);
 const nativePaused=!f.nativeMatchActive;
 const shotInProgress=f.fireballInFlight||f.abilityActivated||(plan.phase==='Verify goal'&&!base.phaseReady);
 const waitPhase=shotInProgress?'Verify goal':f.insideNet?'Wait for charge':p.x<125?'Adjust camp':'Approach net';
 add('wait',[],20,waitPhase,'Release movement and let the native trajectory, charge, or shot resolve.',
  'Prefer waiting during a native countdown, while an airborne approach is coasting into the net, when already settled in the camp and charging, or after a fireball has launched. A ready super shot that has not launched is a reason to use super instead of merely waiting.');
 const features={...f,targetDirection,airborne,movingLeft,movingRight,settlingNearNet,raisedStepBetweenPlayerAndCamp:p.x>=105&&p.y>280,campHeightReached:p.y<280,ballDirection:!ball?'unknown':ball.x<p.x?'left':'right',shotInProgress};
 if(!nativePaused){
  const preferred=[base.continuationAction,base.proposedAction];
  function move(direction,jump=false){
   const key=direction==='left'?'ArrowLeft':'ArrowRight';
   const exact=preferred.find(a=>a.keys.includes(key)&&a.keys.includes('ArrowUp')===jump);
   if(exact)return exact.holdFrames;
   const towardCamp=direction===targetDirection;
   if(!towardCamp)return 1;
   const distance=Math.abs(p.x-78),coast=jump||airborne?75:12;
   return clamp(Math.round((distance-coast)/8.325)+1,1,20);
  }
  const movementPhase=p.y<280?'Adjust camp':'Approach net';
  // Short alternatives remain available inside the field. Boundary guards
  // remove moves that would knowingly drive out of the useful goal area.
  if(p.x>45)add('move_left',['ArrowLeft'],move('left'),movementPhase,'Move left with a locally bounded input hold.',
   'The camp is to the left and a grounded horizontal correction or approach is useful. If the raised step blocks the route, jump_left crosses it; if already coasting into the net, wait allows momentum to settle. Do not chase a distant ball out of the camp.');
  if(p.x<745)add('move_right',['ArrowRight'],move('right'),movementPhase,'Move right with a locally bounded input hold.',
   'The player is too far left of the camp and needs a rightward correction, or must recover from excessive leftward drift. A camp to the left is not a reason to move right. Stay inside the camp rather than chasing the ball.');
  if(p.onGround&&p.x>105)add('jump_left',['ArrowLeft','ArrowUp'],move('left',true),'Approach net','Jump left across the raised goal step; release early enough for native coasting.',
   'The left goal camp is still ahead, the player is grounded below its raised floor, and the raised step must be crossed. Jumping traverses that step while moving toward the camp.');
  if(f.superReady&&f.expectedAbility)add('super',['KeyZ'],20,'Fire super','Hold the charged fireball while staying in place.',
   'The player is inside the camp and the super is ready but has not fired. Hold it even if the ball is currently outside firing range: the native game launches when contact becomes possible. This keeps the defense in place.');
 }
 return {...base,features,strategyHints:[
  'The supplied strategy is to camp inside the raised left net, wait for natural charge, and hold the fireball when ready; the opponent brings the ball into range.',
  'Directional choices are genuine alternatives. Use targetDirection and the raised-step/settling observations to choose whether to move, jump, or let momentum settle.',
  'No movement while charging is expected, not a stall. Confirm success only through the native scoreboard.',
 ]};
}
function ovoTactics(base,state,p,history,plan,add){
 const b=p.behaviors[0],f=base.features;
 const besideWall=p.x>=174&&p.x<=177.5;
 const exitShaft=p.x<=145,aboveWall=p.y<=535;
 const alignedWithFlag=p.x>=48&&p.x<=144;
 const lateralDrift=Math.abs(b.dx||0)>20;
 const diving=Boolean(b.ignoreInput&&b.dy>0&&Math.abs(b.dx||0)<1&&exitShaft);
 const onFloor=Boolean(b.wasOnFloor);
 const targetDirection=exitShaft?(alignedWithFlag?'down':p.x<48?'right':'left'):aboveWall?'left':besideWall?'up':'left';
 const routeRegion=exitShaft?'exit_shaft':aboveWall?'above_wall':besideWall?'beside_wall':'approach_floor';
 const unsafeToCoast=exitShaft&&lateralDrift&&p.y<984;
 const gate=state.objects?.find(o=>o.id===10123);
 const features={...f,targetDirection,routeRegion,besideWall,onFloor,alignedWithFlag,lateralDrift,diving,unsafeToCoast,gateLowered:gate?gate.y>=1023:undefined};
 const waitPhase=exitShaft?'Observe completion':aboveWall?'Cross wall':besideWall?(p.facing===1?'Climb wall':'Face away'):'Approach wall';
 if(!unsafeToCoast)add('wait',[],30,waitPhase,'Release keys and let the current native motion finish.',
  'Wait after the smash has already stopped horizontal drift and the player is falling toward the exit, or when a native transition is underway. Before reaching the exit shaft, passive waiting does not climb or approach the wall. Brief falling during wall jumps is expected and does not by itself require waiting or visual review.');
 if(!exitShaft&&!aboveWall&&!besideWall){
  add('move_left',['ArrowLeft'],30,'Approach wall','Move left across the floor button toward the lowered wall.',
   'The player is still right of the target wall. Moving left reaches the gate button and the wall used by the supplied shortcut.');
  add('move_right',['ArrowRight'],4,'Approach wall','Take a short rightward step away from the left wall.',
   'A retreat right is useful only if approaching the left wall is currently blocked by an unexpected hazard or the strategy requires abandoning the wall route. It moves away from the supplied shortcut target.');
 }
 if(besideWall&&!aboveWall&&!exitShaft){
  add('face_right',['ArrowRight'],1,'Face away','Tap right for one native frame to face away without leaving the wall.',
   'The player is beside the left wall but still faces left. The supplied wall-jump behavior needs a right-facing character. If already facing right, a wall_jump gains height without changing this orientation.');
  if(p.facing===1)add('wall_jump',['ArrowUp'],1,'Climb wall','Pulse jump with all horizontal keys released.',
   'The player is beside the wall, faces right, and has not cleared the wall top. Repeated isolated jump taps exploit the facing-dependent impulse to gain height. An input lock or a brief falling segment is part of this native jump cycle, not by itself a contradiction.');
 }
 if(aboveWall&&!exitShaft){
  add('cross_left',['ArrowLeft'],10,'Cross wall','Move left over the wall top for ten frames, then release.',
   'The player has cleared the wall top and the exit shaft lies left. Crossing now advances the shortcut; waiting can lose the gained height.');
  add('move_right',['ArrowRight'],1,'Cross wall','Make a small rightward adjustment above the wall.',
   'A rightward adjustment is useful only to retreat from a newly identified hazard on the left. The known exit shaft is on the left, so this does not advance that route.');
 }
 if(exitShaft){
  if(!diving)add('smash',['ArrowDown'],1,'Smash to flag','Ground-pound toward the flag, stopping lateral drift and breaking through the platform.',
   'The player has crossed into the exit shaft and the smash is not already active. Smashing arrests horizontal drift and descends through the platform to the exit. At high lateral drift it prevents coasting out of the narrow shaft.');
  if(!unsafeToCoast&&!diving){
   if(p.x<48)add('move_right',['ArrowRight'],1,'Cross wall','Tap right to correct alignment with the exit shaft.',
    'The player is left of the flag corridor and horizontal alignment is needed before diving.');
   if(p.x>144)add('move_left',['ArrowLeft'],1,'Cross wall','Tap left to align with the exit shaft.',
    'The player is right of the flag corridor and horizontal alignment is needed before diving.');
  }
 }
 // Wrong orientation is an ordinary tactical correction with an available
 // face_right action, rather than evidence that a screenshot is needed.
 const recoverableFacing=besideWall&&!aboveWall&&p.facing!==1&&base.requiresVisualReason?.startsWith('Facing changed');
 const requiresVisualReason=recoverableFacing?null:base.requiresVisualReason;
 return {...base,features,requiresVisualReason,strategyHints:[
  'Supplied shortcut: approach left, face right beside the wall, jump repeatedly without horizontal input, cross left only after clearing the top, then smash through the platform to the flag.',
  'During the wall climb, the character can briefly fall or show inputLocked while still making overall upward progress. Those native cycle states are expected.',
  'After crossing left, a down tap arrests dangerous lateral drift. Once the dive is active and aligned, release controls and let the native exit trigger complete the level.',
 ]};
}
