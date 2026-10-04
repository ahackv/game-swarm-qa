import {generateJson} from '@ljoukov/llm';
import {z} from 'zod';
import {agentConfig} from './agent.mjs';
import {creditsObservation,validateCreditsAction,CREDITS_LEVELS} from './web/credits-policy.js';

export function createCreditsDecider({generate=generateJson,configure=agentConfig}={}){
  return async function decideCredits({game,state,image,history=[],inspect=false},signal){
    signal?.throwIfAborted();
    if(game!=='ovo'||state?.state!=='Credits')throw Error('Open the OvO credits before this test.');
    if(!Number.isInteger(state.unlockedLevels)||state.unlockedLevels<1||state.unlockedLevels>=CREDITS_LEVELS)throw Error('This test requires a fresh save with locked levels.');
    if(!Array.isArray(history))throw Error('history must be an array.');
    if(typeof image!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>3_000_000)throw Error('A game screenshot is required.');
    const config=configure('ovo');
    if(!config.configured)throw Error('Sign in to Codex or configure the visual model.');
    const schema=z.object({type:z.enum(['double_click','stop']),x:z.number().min(0).max(1).nullable(),y:z.number().min(0).max(1).nullable(),reason:z.string().min(1).max(400)}).strict();
    const request={model:config.model,thinkingLevel:'low',
      instructions:'You are a Swarm QA agent testing the original OvO credits screen. Tester-supplied hypothesis: double-clicking the central DEDRA logo unlocks all 52 levels. This is a guided reproduction, not your discovery. Inspect the attached screenshot and locate the logo itself, rather than the credit text or Back button. Choose the double_click position from the image, using normalized coordinates: x=0 at the left edge, x=1 at the right edge; y=0 at the top, y=1 at the bottom. Click the center of the logo. The local executor will send ordinary mouse events at your exact coordinates and then advance one native frame. It will read the native unlocked-level count to determine the result. Do not claim success before that observation. If a previous click missed, inspect the screenshot again and correct the target. If the logo is absent or you cannot identify it, choose stop with null x and y. Give a short reason describing your chosen input. You cannot modify game state, storage, or progression.',
      input:[{role:'user',content:[{type:'text',text:JSON.stringify({state:creditsObservation(state),recentActions:history.slice(-3).map(entry=>({action:entry.action,after:creditsObservation(entry.after)}))})},{type:'input_image',image_url:image,detail:'high'}]}],
    };
    const started=Date.now();
    const {value,result}=await generate({...request,schema,signal,maxAttempts:2,openAiSchemaName:'credits_logo_action'});
    signal?.throwIfAborted();
    const selected=validateCreditsAction(schema.parse(value));
    const action={...selected,frames:selected.type==='double_click'?1:0,keys:[],phase:'credits'};
    const latencyMs=Date.now()-started;
    const inspection=inspect===true?{kind:'visual',latencyMs,request:{...request,input:request.input.map(message=>({...message,content:message.content.map(part=>part.type==='input_image'?{type:part.type,image:'Attached screenshot',detail:part.detail}:part)})),outputSchema:z.toJSONSchema(schema)},response:selected}:undefined;
    return {action,finding:'credits-unlock',guided:true,visualReview:true,model:result.model,modelVersion:result.modelVersion,transport:config.transport,thinkingLevel:'low',latencyMs,usage:result.usage,apiEquivalentCostUsd:result.costUsd,...(inspection?{inspection}:{})};
  };
}
export const creditsDecide=createCreditsDecider();
