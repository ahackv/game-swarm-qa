import assert from 'node:assert/strict';
import {jevChooseAction,JEV_MODEL} from '../jev.mjs';
import {createExploreDecider,createExplorationReviewer} from '../explore.mjs';
import {explorationPolicy} from '../web/explore-policy.js';

const state={state:'gameplay',core:{isPlaying:true},match:{score1:0,score2:0},players:[{human:true,x:300,y:336,onGround:true,superReady:true}],ball:{x:350,y:330,vx:100}};
const policy=explorationPolicy({game:'football-legends',state,profile:'beginner'});
const input={game:'football-legends',plan:{goal:policy.goal,phase:'Ordinary play',source:'player-profile'},features:policy.features,currentPhase:'Ordinary play',progress:{},candidates:policy.candidates,playerPrompt:policy.goal};
const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;
let submitted;
try{
  process.env.OPENROUTER_API_KEY='inspection-test';
  globalThis.fetch=async(_url,options)=>{
    submitted=JSON.parse(options.body);
    return Response.json({model:JEV_MODEL,answers:{movement:{choice:'kick',confidence:.94,probabilities:{kick:.94}}},unrelated:'DO NOT EXPOSE',headers:{authorization:'DO NOT EXPOSE'}});
  };
  const regular=await jevChooseAction(input);assert.equal(regular.inspection,undefined);
  const inspected=await jevChooseAction({...input,inspect:true});
  assert.deepEqual(inspected.inspection.request,submitted,'Inspect the same request actually submitted to Jev.');
  assert.equal(inspected.inspection.response.movement.choice,'kick');
  assert.ok(!JSON.stringify(inspected.inspection).includes('DO NOT EXPOSE'));
  assert.ok(!JSON.stringify(inspected.inspection).includes('inspection-test'));
}finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;
}

let visualRequest;
const reviewer=createExplorationReviewer({configure:()=>({configured:true,model:'visual-fixture',transport:'test'}),generate:async options=>{
  visualRequest=options;return {value:{movement:'kick',reason:'Ball in range'},result:{model:'visual-fixture',usage:{},costUsd:0}};
}});
const image='data:image/png;base64,aW1hZ2U=';
const reviewed=await reviewer({game:'football-legends',state,profile:'beginner',policy,image,inspect:true});
assert.equal(visualRequest.input[0].content[1].image_url,image);
assert.equal(reviewed.inspection.request.instructions,visualRequest.instructions);
assert.equal(reviewed.inspection.request.input[0].content[0].text,visualRequest.input[0].content[0].text);
assert.deepEqual(reviewed.inspection.response,{movement:'kick',reason:'Ball in range'});
assert.ok(!JSON.stringify(reviewed.inspection).includes('data:image/'),'Do not echo screenshots into response JSON.');
assert.equal((await reviewer({game:'football-legends',state,profile:'beginner',policy,image})).inspection,undefined);

let optedIn;
const inspection={kind:'jev',request:{example:true},response:{movement:{choice:'kick',confidence:.4}}};
const choose=async options=>{optedIn=options.inspect;return {choice:'kick',confidence:.4,inspection};};
const decider=createExploreDecider({hasJev:()=>true,choose,review:reviewer});
const escalation=await decider({game:'football-legends',state,profile:'beginner',inspect:true});
assert.equal(optedIn,true);assert.equal(escalation.needsVisual,true);assert.deepEqual(escalation.inspection,inspection);
assert.equal(escalation.jev.inspection,undefined,'Saved escalation metadata cannot retain ephemeral prompts.');
assert.equal((await decider({game:'football-legends',state,profile:'beginner'})).inspection,undefined);assert.equal(optedIn,false);
const visual=await decider({game:'football-legends',state,profile:'beginner',image,inspect:true});assert.equal(visual.inspection.kind,'visual');
console.log('Inspection: actual submitted prompts, structured responses, opt-in forwarding, screenshot references, and escalation redaction verified without model calls.');
