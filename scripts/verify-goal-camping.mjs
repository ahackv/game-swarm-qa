import assert from 'node:assert/strict';
import {goalCampingProgress} from '../web/goal-camping.js';
import {evaluatePolicy} from '../web/hybrid-policy.js';
import {evaluateTactics} from '../web/jev-actions.js';
import {createHybridDecider} from '../hybrid.mjs';
import {buildReport} from '../web/report.js';

const state=(score1,score2,core={})=>({ready:true,state:'gameplay',match:{score1,score2},core:{isPlaying:true,isEnd:false,...core},clock:{frames:score1*20,simulationSeconds:score1*.5},players:[{human:true,x:78,y:245,vx:0,onGround:true,superPower:0,superReady:true,superCharge:12}],ball:{x:145,y:250,vx:100}});
const plan={id:'four-goal-test',initialScore:0,phase:'Wait for charge',goal:'Repeat the supplied goal-camping strategy.'};
for(const evaluate of [evaluatePolicy,evaluateTactics]){
  for(const [human,bot,completed] of [[0,0,false],[1,0,false],[2,0,false],[3,0,false],[4,4,false],[4,3,false],[4,2,true],[4,0,true],[5,3,true]]){
    const result=evaluate({game:'football-legends',state:state(human,bot),plan});
    assert.equal(result.completed,completed,`${evaluate.name}: ${human}–${bot}`);
  }
  assert.equal(evaluate({game:'football-legends',state:state(4,0),plan:{...plan,initialScore:2}}).completed,false,'Existing goals cannot count as new scoring evidence.');
  assert.equal(evaluate({game:'football-legends',state:state(6,1),plan:{...plan,initialScore:2}}).completed,true);
  const kickoff=state(1,0,{isCountDown:true,isPlaying:false});kickoff.players[0].x=250;kickoff.players[0].y=336;
  const waits=Array.from({length:6},()=>({action:{phase:'Approach net'},before:kickoff,after:kickoff}));
  const waiting=evaluate({game:'football-legends',state:kickoff,plan:{...plan,phase:'Approach net'},history:waits});
  assert.equal(waiting.completed,false);assert.equal(waiting.requiresVisualReason,null,'A kickoff countdown is expected, not stalled play.');
  const active={...kickoff,core:{isPlaying:true,isCountDown:false}};
  const resumed=evaluate({game:'football-legends',state:active,plan:{...plan,phase:'Verify goal'},history:waits});
  assert.equal(resumed.completed,false);assert.equal(resumed.suggestedPhase,'Approach net');
  assert.deepEqual(resumed.proposedAction.keys,['ArrowLeft','ArrowUp'],'After a kickoff, return to the raised goal.');
}
assert.equal(goalCampingProgress({match:{score1:4}}).targetReached,false,'Both sides of the scoreboard must be known.');

for(const strategy of ['routed','tactical']){
  const calls=[];
  const decide=createHybridDecider({route:async input=>{calls.push('route');return {choice:input.phaseReady?'change_phase':'continue',confidence:1,model:'test'};},chooseAction:async input=>{calls.push('choose');return {choice:Object.keys(input.candidates)[0],confidence:1,model:'test'};},review:async()=>{throw Error('No visual call is needed for these known native states.');}});
  let currentPlan=plan;
  for(const score of [1,2,3]){
    const response=await decide({game:'football-legends',strategy,state:state(score,0,{isGoal:true,isPlaying:false}),plan:currentPlan});
    assert.ok(response.action,'Keep playing after early goals.');assert.ok(!response.completed);
    assert.equal(response.plan.initialScore,0,'Keep the starting score across decisions and kickoffs.');currentPlan=response.plan;
  }
  const before=calls.length;
  const done=await decide({game:'football-legends',strategy,state:state(4,0),plan:currentPlan});
  assert.equal(done.completed,true);assert.equal(done.action,null);assert.equal(calls.length,before);
  const ended=await decide({game:'football-legends',strategy,state:state(3,1,{isEnd:true}),plan:currentPlan});
  assert.equal(ended.completed,false);assert.equal(ended.matchEnded,true);assert.equal(ended.action,null);assert.equal(calls.length,before,'Match end must not spend another model call.');
}

for(const [human,bot,ended,outcome] of [[1,0,false,'goals-in-progress'],[3,0,false,'goals-in-progress'],[4,3,false,'goals-in-progress'],[4,0,false,'goal-target-reached'],[3,1,true,'goal-target-unmet']]){
  const report=buildReport({game:'football-legends',baseline:state(0,0),final:state(human,bot,{isEnd:ended})});
  assert.equal(report.outcome,outcome);assert.equal(report.goalProgress.goalsScored,human);
}
const noBaseline=buildReport({game:'football-legends',final:state(4,0)});assert.notEqual(noBaseline.outcome,'goal-target-reached');
console.log('Goal camping: four new goals, two-goal lead, kickoff recovery, countdown waits, both hybrid modes, match-end stop, and partial-evidence reports verified.');
