import {generateJson} from '@ljoukov/llm';
import {z} from 'zod';
import {agentConfig} from './agent.mjs';
import {jevConfig,jevChooseAction} from './jev.mjs';
import {explorationPolicy,profiles,validateProfile} from './web/explore-policy.js';

export function exploreConfig(game){return {configured:agentConfig(game).configured,jevConfigured:jevConfig().configured,profiles:Object.keys(profiles)};}
export async function reviewExploration({game,state,image,profile,policy,history=[]},signal){
  const config=agentConfig(game);
  if(!config.configured)throw Error('Sign in to Codex or configure the visual model.');
  if(typeof image!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>3_000_000)throw Error('A game screenshot is required for visual review.');
  const started=Date.now();
  const {value,result}=await generateJson({model:config.model,thinkingLevel:'low',maxAttempts:2,signal,
    instructions:`You are playing ${game} for a Swarm QA ordinary playtest. ${profiles[profile].prompt} Select an available action using the current screen and observations. Keep your reason to one concise sentence describing the move. Never claim a goal or completion before native telemetry confirms it. Local code maps actions to ordinary keys. No game state may be edited.`,
    input:[{role:'user',content:[{type:'text',text:JSON.stringify({features:policy.features,state,actions:Object.fromEntries(Object.entries(policy.candidates).map(([id,c])=>[id,c.description])),recentActions:history.slice(-4).map(h=>({action:h.action,after:h.after}))})},{type:'input_image',image_url:image,detail:'high'}]}],
    schema:z.object({movement:z.enum(Object.keys(policy.candidates)),reason:z.string().max(240)}).strict(),openAiSchemaName:'ordinary_play_action'});
  return {choice:value.movement,reason:value.reason,model:result.model,latencyMs:Date.now()-started,usage:result.usage,apiEquivalentCostUsd:result.costUsd,transport:config.transport};
}

export function createExploreDecider({choose=jevChooseAction,review=reviewExploration,hasJev=()=>jevConfig().configured}={}){
  return async function decideExplore({game,state,profile,history=[],image},signal){
    validateProfile(profile);
    if(!state||typeof state!=='object'||Array.isArray(state))throw Error('A game observation is required.');
    if(!Array.isArray(history))throw Error('history must be an array.');
    const policy=explorationPolicy({game,state,profile,history:history.slice(-6)});
    signal?.throwIfAborted();
    // Countdown/goal screens accept no meaningful player choice. Advance the
    // native animation explicitly, and label this as an engine wait, not AI.
    if(policy.features.nativePause)return {action:policy.candidates.wait.action,purpose:'explore',profile,guided:false,engineWait:true,visualReview:false,model:'Native transition',transport:'Local clock',latencyMs:0};
    let result,visualReview=Boolean(image);
    if(image)result=await review({game,state,profile,history,policy,image},signal);
    else if(hasJev()){
      try{result=await choose({game,plan:{goal:policy.goal,phase:'Ordinary play',source:'player-profile'},features:policy.features,currentPhase:'Ordinary play',progress:policy.progress||{},candidates:policy.candidates,playerPrompt:policy.goal,strategyHints:[]},signal);}
      catch(error){signal?.throwIfAborted();return {needsVisual:true,reason:error.message,purpose:'explore',profile,guided:false};}
      if(result.choice==='request_visual_review'||result.confidence<.75)return {needsVisual:true,reason:'Review the next move from the game screen.',latencyMs:result.latencyMs,jev:result,purpose:'explore',profile,guided:false};
    }else return {needsVisual:true,reason:'Visual player selected.',purpose:'explore',profile,guided:false};
    signal?.throwIfAborted();
    const selected=policy.candidates[result.choice];
    if(!selected)throw Error('The player selected an unavailable action.');
    return {action:{...selected.action,...(result.reason?{reason:result.reason}:{})},purpose:'explore',profile,guided:false,visualReview,model:result.model,transport:result.transport||'OpenRouter',latencyMs:result.latencyMs,usage:result.usage,apiEquivalentCostUsd:result.apiEquivalentCostUsd??result.costUsd,routing:{choice:result.choice,confidence:result.confidence}};
  };
}
export const exploreDecide=createExploreDecider();
