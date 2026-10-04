import {randomUUID} from 'node:crypto';
import {generateJson,isChatGptModelId} from '@ljoukov/llm';
import {z} from 'zod';
import {agentConfig} from './agent.mjs';
import {jevConfig,jevRoute,jevChooseAction} from './jev.mjs';
import {evaluatePolicy,POLICY_PHASES,POLICY_INITIAL_PHASE} from './web/hybrid-policy.js';
import {evaluateTactics} from './web/jev-actions.js';
import {goalCampingInstruction} from './web/goal-camping.js';

export const VISUAL_CHECKPOINT_EVERY=10;
export const MIN_ROUTING_CONFIDENCE=0.8;
const screenshot=/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const visualGoals={
 'football-legends':'Test the supplied strategy: jump into the left goal, stay near x65–90, let the fireball charge naturally, then use it against the built-in bot. '+goalCampingInstruction+' This is a guided reproduction, not an independently discovered exploit.',
 ovo:'Reproduce the supplied Level 9 shortcut: move left to the wall, tap right to face away, repeatedly tap up with horizontal keys released to climb, cross left above the wall, and smash down to the flag. Verify the native level completion. This is a guided reproduction, not an independently discovered exploit.'
};
function visualConfig(game){
 const config=agentConfig(game);
 if(!isChatGptModelId(config.model))return {...config,configured:false,error:'Hybrid visual review requires a chatgpt-* subscription model.'};
 return {...config,model:config.model.endsWith('-fast')?config.model:config.model+'-fast'};
}
export function hybridConfig(game){
 const visual=visualConfig(game),jev=jevConfig();
 return {model:jev.model,visualModel:visual.model,configured:visual.configured&&jev.configured,visualConfigured:visual.configured,jevConfigured:jev.configured,transport:'Jev via OpenRouter + ChatGPT subscription',thinkingLevel:'low',checkpointEvery:VISUAL_CHECKPOINT_EVERY,strategies:['routed','tactical'],strategySettings:{routed:{initialVisual:true,checkpointEvery:VISUAL_CHECKPOINT_EVERY},tactical:{initialVisual:false,checkpointEvery:null}},intervalMs:500,error:visual.error};
}
function validateInput({game,state,image,history,plan,stepsSinceVisual}){
 if(!POLICY_PHASES[game])throw Error('Unsupported game.');
 if(!state||typeof state!=='object'||Array.isArray(state))throw Error('A game observation is required.');
 if(!Array.isArray(history))throw Error('history must be an array.');
 if(!Number.isInteger(stepsSinceVisual)||stepsSinceVisual<0||stepsSinceVisual>10000)throw Error('stepsSinceVisual must be a nonnegative integer.');
 if(image!==undefined&&(typeof image!=='string'||!screenshot.test(image)||image.length>3_000_000))throw Error('A valid game screenshot is required for visual review.');
 if(plan!==undefined&&plan!==null&&(typeof plan!=='object'||Array.isArray(plan)))throw Error('Invalid hybrid plan.');
}
function normalizePlan(game,state,plan){
 if(!plan)return null;
 return {id:typeof plan.id==='string'?plan.id.slice(0,80):randomUUID(),goal:typeof plan.goal==='string'?plan.goal.slice(0,500):visualGoals[game],phase:typeof plan.phase==='string'?plan.phase.slice(0,80):POLICY_INITIAL_PHASE[game],notes:typeof plan.notes==='string'?plan.notes.slice(0,700):'',source:plan.source==='seed'?'seed':'visual',initialScore:Number.isFinite(plan.initialScore)?plan.initialScore:Number(state.match?.score1)||0,expectedLevel:'Level 9'};
}
function reviewPhases(policy,game){
 if(policy.candidates){
  const phases=[...new Set(Object.values(policy.candidates).map(candidate=>candidate.action?.phase).filter(phase=>POLICY_PHASES[game].includes(phase)))];
  if(phases.length)return phases;
 }
 const possible=[policy.requiresVisualReason&&policy.phaseReady?null:policy.currentPhase,policy.phaseReady?policy.suggestedPhase:null,policy.recoveryPhase];
 const allowed=[...new Set(possible.filter(phase=>POLICY_PHASES[game].includes(phase)))];
 return allowed.length?allowed:[POLICY_INITIAL_PHASE[game]];
}
export async function reviewHybridPlan({game,state,image,history=[],plan,policy,reason},signal){
 const {model,configured,transport,error}=visualConfig(game);
 if(!configured)throw Error(error||'Sign in to Codex or configure a ChatGPT token provider.');
 signal?.throwIfAborted();
 const phases=reviewPhases(policy,game),started=Date.now();
 const candidates=policy.candidates,tactical=Boolean(candidates);
 if(tactical&&!Object.keys(candidates).length)throw Error('No safe local action is available for visual review.');
 const schema=z.object({goal:z.string().min(1).max(500),...(tactical?{movement:z.enum(Object.keys(candidates))}:{phase:z.enum(phases)}),notes:z.string().max(360)}).strict();
 const selection=tactical?'Jev requested help choosing a movement. Select the actual movement ID from availableActions that best fits the supplied goal and screenshot. Each candidate already contains safe native input timing.':'Select one allowed controller phase. phaseReady means the current phase is finished and the suggested next phase is permitted. Prefer the suggested phase when phaseReady is true, and a recovery phase when supplied.';
 const {value,result}=await generateJson({model,thinkingLevel:'low',maxAttempts:2,signal:signal||AbortSignal.timeout(60000),schema,openAiSchemaName:'game_qa_plan',instructions:`You are the visual planner for Swarm QA. ${visualGoals[game]} Inspect the screenshot and compact native telemetry. ${selection} Local code owns exact geometry, collision predictions and key timing; do not generate keys or edit game state. Preserve a working plan when observations support it. Keep notes to one or two short sentences describing the durable strategy and any concrete visual concern. Avoid caching volatile positions or readiness flags in the plan. Do not invent completion, independent discovery, or general game quality conclusions. The routine controller will consult Jev between visual reviews.`,input:[{role:'user',content:[{type:'text',text:JSON.stringify({reason,plan,state,controller:{currentPhase:policy.currentPhase,suggestedPhase:policy.suggestedPhase,phaseReady:policy.phaseReady,recoveryPhase:policy.recoveryPhase,features:policy.features,...(tactical?{availableActions:Object.fromEntries(Object.entries(candidates).map(([id,candidate])=>[id,candidate.description]))}:{})},recentActions:history.slice(-4).map(entry=>({phase:entry.action?.phase,reason:entry.action?.reason,event:entry.event||null}))})},{type:'input_image',image_url:image,detail:'high'}]}]});
 const nextPlan=tactical?{goal:value.goal,phase:candidates[value.movement].action.phase,notes:value.notes}:value;
 return {plan:nextPlan,...(tactical?{movement:value.movement}:{}),model:result.model,modelVersion:result.modelVersion,transport,thinkingLevel:'low',latencyMs:Date.now()-started,usage:result.usage,apiEquivalentCostUsd:result.costUsd,requestId:result.openAi?.responseId};
}
const expectedMotion={
 'Approach wall':'Move left toward the wall and trigger the gate.',
 'Face away':'A brief right tap sets the orientation needed for the supplied wall-jump route.',
 'Climb wall':'Repeated jump pulses gain height overall. Falling briefly and inputLocked=true are normal parts of each wall jump, not failures by themselves.',
 'Cross wall':'Move left across the wall top, then release horizontal input.',
 'Smash to flag':'Dive downward through the platform toward the flag.',
 'Observe completion':'Wait for the native fall and level transition; incomplete remains normal until the flag is reached.',
 'Approach net':'Jump left over the raised goal step, then coast and settle inside the net.',
 'Adjust camp':'Short directional corrections and waits for momentum place the player in the net.',
 'Wait for charge':'Remain still while the ability charges naturally. Waiting and no positional change are expected.',
 'Fire super':'Hold super while waiting for the ball to enter range. Waiting is expected; the controller checks activation.',
 'Verify goal':'Wait for the launched ball and read the native scoreboard. A goal can take several control intervals.'
};
const activePlayer=(game,state)=>game==='ovo'?state?.players?.find(player=>player.behaviors?.[0]?.enabled):state?.players?.find(player=>player.human);
export function routingProgress(game,state,history,policy){
 const phase=policy.currentPhase,player=activePlayer(game,state);
 const nativePause=game==='football-legends'&&(policy.features?.countdown||policy.features?.goalAnimation||policy.features?.nativeMatchActive===false);
 const inPhase=[];
 for(let i=history.length-1;i>=0&&inPhase.length<3;i--){if(history[i].action?.phase!==phase)break;inPhase.unshift(history[i]);}
 const prior=activePlayer(game,inPhase[0]?.before);
 let trend=nativePause?'expected_native_pause':policy.phaseReady?'phase_condition_reached':!prior||!player?'first_observation_in_phase':'expected_wait';
 if(!nativePause&&!policy.phaseReady&&prior&&player){
  let advance=null;
  if(['Approach wall','Cross wall'].includes(phase))advance=prior.x-player.x;
  else if(phase==='Climb wall')advance=prior.y-player.y;
  else if(['Smash to flag','Observe completion'].includes(phase))advance=player.y-prior.y;
  else if(['Approach net','Adjust camp'].includes(phase))advance=Math.abs(prior.x-78)-Math.abs(player.x-78);
  else if(phase==='Wait for charge')advance=player.superCharge-prior.superCharge;
  if(Number.isFinite(advance))trend=advance>(phase==='Wait for charge'?0:0.5)?'advancing_toward_phase_goal':advance< -6?'moving_away_from_phase_goal':phase==='Wait for charge'?'expected_wait':inPhase.length<3?'brief_pause':'no_recent_progress';
 }
 return {trend,expectedMotion:nativePause?'The native countdown or goal animation is still running; waiting through its movement or reset is expected.':expectedMotion[phase]||'Review the current phase.',recentPhases:history.slice(-3).map(entry=>String(entry.action?.phase||'unknown').slice(0,80)),latestEvent:typeof history.at(-1)?.event==='string'?history.at(-1).event.slice(0,180):null};
}
function validateAction(action,game){
 const frames=game==='ovo'?30:20;
 const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyZ','KeyX','Space','KeyR'];
 if(!action||action.frames!==frames||!Number.isInteger(action.holdFrames)||action.holdFrames<1||action.holdFrames>frames||!Array.isArray(action.keys)||action.keys.some(key=>!keys.includes(key)))throw Error('Local controller returned an invalid action.');
 return action;
}

// Dependency injection keeps escalation, confidence and cancellation checks
// reproducible without spending model calls or changing any game state.
export function createHybridDecider({route=jevRoute,chooseAction=jevChooseAction,review=reviewHybridPlan,evaluate=evaluatePolicy,evaluateTactical=evaluateTactics}={}){
 return async function hybridDecision({game,state,history=[],plan:inputPlan,stepsSinceVisual=0,image,reviewReason,strategy='routed'},signal){
  const started=Date.now();
  signal?.throwIfAborted();
  if(!['routed','tactical'].includes(strategy))throw Error('Unsupported hybrid strategy.');
  validateInput({game,state,image,history,plan:inputPlan,stepsSinceVisual});
  const recent=history.slice(-8);
  let plan=normalizePlan(game,state,inputPlan);
  const tactical=strategy==='tactical',evaluateCurrent=tactical?evaluateTactical:evaluate;
  if(tactical&&!plan)plan=normalizePlan(game,state,{goal:visualGoals[game],phase:POLICY_INITIAL_PHASE[game],notes:'Tester-supplied guided strategy.',source:'seed'});
  let policy=evaluateCurrent({game,state,history:recent,plan:plan||{initialScore:Number(state.match?.score1)||0,expectedLevel:'Level 9'}});
  if(policy.completed||policy.matchEnded)return {strategy,completed:policy.completed,matchEnded:Boolean(policy.matchEnded),goalProgress:policy.goalProgress,needsVisual:false,action:null,plan,stepsSinceVisual,visualReview:false,latencyMs:Date.now()-started};
  const reason=!plan?'Initial visual plan':policy.requiresVisualReason|| (!tactical&&stepsSinceVisual>=VISUAL_CHECKPOINT_EVERY?'Periodic visual checkpoint':null);
  if(image){
   const result=await review({game,state,image,history:recent,plan,policy,reason:reason||(typeof reviewReason==='string'?reviewReason.slice(0,240):'Requested visual review')},signal);
   signal?.throwIfAborted();
   if(!result.plan||!reviewPhases(policy,game).includes(result.plan.phase))throw Error('Visual review selected a phase without a valid local transition.');
   if(tactical&&(!Object.hasOwn(policy.candidates,result.movement)||policy.candidates[result.movement].action.phase!==result.plan.phase))throw Error('Visual review selected an unavailable movement.');
   const previous=plan;
   plan=normalizePlan(game,state,{...plan,...result.plan,id:plan?.id||randomUUID(),source:'visual'});
   const reviewedPolicy=evaluateCurrent({game,state,history:recent,plan});
   // The selected phase executes only its own controller action. A visual
   // review cannot skip another phase by executing its proposed transition.
   const action=validateAction(tactical?policy.candidates[result.movement].action:reviewedPolicy.continuationAction,game);
   return {...result,strategy,action,plan,stepsSinceVisual:0,visualReview:true,visualLatencyMs:result.latencyMs,latencyMs:Date.now()-started,routing:{choice:'visual_review',confidence:null,reason:reason||(typeof reviewReason==='string'?reviewReason.slice(0,240):'Requested visual review'),fromPhase:previous?.phase||null,toPhase:plan.phase},guided:true};
  }
  if(reason)return {strategy,needsVisual:true,reason,plan,stepsSinceVisual,latencyMs:Date.now()-started};
  let decision;
  try{
   const progress=routingProgress(game,state,recent,policy);
   decision=tactical?await chooseAction({game,plan,features:policy.features,currentPhase:policy.currentPhase,progress,candidates:policy.candidates,strategyHints:policy.strategyHints},signal):await route({game,plan,features:policy.features,currentPhase:policy.currentPhase,suggestedPhase:policy.suggestedPhase,phaseReady:policy.phaseReady,progress},signal);
  }catch(error){
   if(signal?.aborted)throw signal.reason;
   // No key action is substituted for a failed Jev decision.
   return {strategy,needsVisual:true,reason:typeof error?.message==='string'&&/^Jev |^OPENROUTER_API_KEY/.test(error.message)?error.message:'Jev decision failed.',plan,stepsSinceVisual,latencyMs:Date.now()-started};
  }
  signal?.throwIfAborted();
  const {choice,confidence}=decision;
  const allowedChoices=tactical?[...Object.keys(policy.candidates||{}),'request_visual_review']:['continue','change_phase','request_visual_review'];
  if(!allowedChoices.includes(choice)||typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1)return {strategy,needsVisual:true,reason:'Jev returned an invalid routing decision.',jev:decision,plan,stepsSinceVisual,latencyMs:Date.now()-started};
  const escalation=confidence<MIN_ROUTING_CONFIDENCE?'Jev requested review through low confidence':choice==='request_visual_review'?'Jev requested visual review':!tactical&&choice==='change_phase'&&!policy.phaseReady?'Jev proposed a phase change before its local preconditions were met':null;
  if(escalation)return {strategy,needsVisual:true,reason:escalation,jev:decision,apiEquivalentCostUsd:decision.costUsd,plan,stepsSinceVisual,latencyMs:Date.now()-started};
  const changed=choice==='change_phase';
  const action=validateAction(tactical?policy.candidates[choice].action:changed?policy.proposedAction:policy.continuationAction,game);
  if(tactical||changed)plan={...plan,phase:tactical?action.phase:policy.suggestedPhase};
  return {strategy,action,plan,stepsSinceVisual:stepsSinceVisual+1,visualReview:false,model:decision.model,transport:'OpenRouter',latencyMs:Date.now()-started,usage:decision.usage,apiEquivalentCostUsd:decision.costUsd,requestId:decision.requestId,routing:{choice,confidence,probabilities:decision.probabilities,latencyMs:decision.latencyMs,fromPhase:policy.currentPhase,toPhase:plan.phase},guided:true};
 };
}
export const hybridDecide=createHybridDecider();
