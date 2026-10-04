import {generateJson} from '@ljoukov/llm';
import {z} from 'zod';
import {agentConfig} from './agent.mjs';
import {jevConfig,jevChooseAction} from './jev.mjs';
import {explorationPolicy,profiles,validateProfile} from './web/explore-policy.js';
import {decisionModes,validateDecisionMode} from './web/decision-modes.js';

export function exploreConfig(game){return {configured:agentConfig(game).configured,jevConfigured:jevConfig().configured,profiles:Object.keys(profiles),decisionModes:Object.keys(decisionModes)};}
export function createExplorationReviewer({generate=generateJson,configure=agentConfig}={}){
 return async function reviewExploration({game,state,image,profile,policy,history=[],inspect=false},signal){
  const config=configure(game);
  if(!config.configured)throw Error('Sign in to Codex or configure the visual model.');
  if(typeof image!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>3_000_000)throw Error('A game screenshot is required for visual review.');
  const started=Date.now();
  const request={model:config.model,thinkingLevel:'low',
    instructions:`You are playing ${game} for a Swarm QA ordinary playtest. ${profiles[profile].prompt} Select an available action using the current screen and observations. Keep your reason to one concise sentence describing the move. Never claim a goal or completion before native telemetry confirms it. Local code maps actions to ordinary keys. No game state may be edited.`,
    input:[{role:'user',content:[{type:'text',text:JSON.stringify({features:policy.features,state,actions:Object.fromEntries(Object.entries(policy.candidates).map(([id,c])=>[id,c.description])),recentActions:history.slice(-4).map(h=>({action:h.action,after:h.after}))})},{type:'input_image',image_url:image,detail:'high'}]}],
  };
  const schema=z.object({movement:z.enum(Object.keys(policy.candidates)),reason:z.string().max(240)}).strict();
  const {value,result}=await generate({...request,maxAttempts:2,signal,schema,openAiSchemaName:'ordinary_play_action'});
  // The browser already owns the exact submitted image. Return its reference,
  // not a second copy of the base64 payload or transport credentials.
  const inspection=inspect===true?{kind:'visual',request:{...request,input:request.input.map(message=>({...message,content:message.content.map(part=>part.type==='input_image'?{type:part.type,image:'Attached screenshot',detail:part.detail}:part)})),outputSchema:z.toJSONSchema(schema)},response:value}:undefined;
  return {choice:value.movement,reason:value.reason,model:result.model,latencyMs:Date.now()-started,usage:result.usage,apiEquivalentCostUsd:result.costUsd,transport:config.transport,...(inspection?{inspection}:{})};
 };
}
export const reviewExploration=createExplorationReviewer();

export function createExploreDecider({choose=jevChooseAction,review=reviewExploration,hasJev=()=>jevConfig().configured}={}){
  return async function decideExplore({game,state,profile,decisionMode='hybrid',history=[],image,inspect=false},signal){
    validateProfile(profile);validateDecisionMode(decisionMode);
    const metadata={purpose:'explore',profile,decisionMode,guided:false};
    if(!state||typeof state!=='object'||Array.isArray(state))throw Error('A game observation is required.');
    if(!Array.isArray(history))throw Error('history must be an array.');
    const policy=explorationPolicy({game,state,profile,history:history.slice(-6)});
    signal?.throwIfAborted();
    // Countdown/goal screens accept no meaningful player choice. Advance the
    // native animation explicitly, and label this as an engine wait, not AI.
    if(policy.features.nativePause)return {action:policy.candidates.wait.action,...metadata,decisionPath:'native',engineWait:true,visualReview:false,model:'Native transition',transport:'Local clock',latencyMs:0};
    let result,visualReview=Boolean(image);
    if(image)result=await review({game,state,profile,history,policy,image,inspect:inspect===true},signal);
    else if(decisionMode==='luna')return {needsVisual:true,reason:'Luna needs the current game screenshot.',latencyMs:0,decisionPath:'luna',...metadata};
    else if(hasJev()){
      const started=Date.now();
      try{result=await choose({game,plan:{goal:policy.goal,phase:'Ordinary play',source:'player-profile'},features:policy.features,currentPhase:'Ordinary play',progress:policy.progress||{},candidates:policy.candidates,playerPrompt:policy.goal,strategyHints:[],inspect:inspect===true},signal);}
      catch(error){signal?.throwIfAborted();return {needsVisual:true,reason:error.message,latencyMs:Date.now()-started,decisionPath:'jev',...metadata};}
      if(result.choice==='request_visual_review'||result.confidence<.75){
        const {inspection,...jev}=result;
        return {needsVisual:true,reason:'Review the next move from the game screen.',latencyMs:result.latencyMs,decisionPath:'jev',jev,...metadata,...(inspect===true&&inspection?{inspection}:{})};
      }
    }else return {needsVisual:true,reason:'Visual player selected.',latencyMs:0,decisionPath:'luna',...metadata};
    signal?.throwIfAborted();
    const selected=policy.candidates[result.choice];
    if(!selected)throw Error('The player selected an unavailable action.');
    return {action:{...selected.action,...(result.reason?{reason:result.reason}:{})},...metadata,decisionPath:visualReview?'luna':'jev',visualReview,model:result.model,transport:result.transport||'OpenRouter',latencyMs:result.latencyMs,usage:result.usage,apiEquivalentCostUsd:result.apiEquivalentCostUsd??result.costUsd,routing:{choice:result.choice,confidence:result.confidence},...(inspect===true&&result.inspection?{inspection:result.inspection}:{})};
  };
}
export const exploreDecide=createExploreDecider();
