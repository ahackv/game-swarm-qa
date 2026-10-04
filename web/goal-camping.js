export const GOAL_CAMPING_TARGET=4;
export const GOAL_CAMPING_LEAD=2;
export const GOAL_CAMPING_DECISION_LIMIT=480;
export const goalCampingInstruction=`Keep repeating the goal-camping strategy until the human has scored ${GOAL_CAMPING_TARGET} goals during this run and leads the opponent by at least ${GOAL_CAMPING_LEAD} goals. One goal is only progress. Wait through native goal celebrations and countdowns, return to the raised left goal after each kickoff, recharge naturally and fire again. Only the native scoreboard can confirm the target. Stop if the native match ends; never invent a win.`;

export function goalCampingProgress(state,initialScore=0){
  const score=state?.match?.score1,opponent=state?.match?.score2;
  const known=[score,opponent,initialScore].every(value=>Number.isInteger(value)&&value>=0);
  const goalsScored=known?Math.max(0,score-initialScore):null,lead=known?score-opponent:null;
  return {targetGoals:GOAL_CAMPING_TARGET,requiredLead:GOAL_CAMPING_LEAD,goalsScored,goalsRemaining:known?Math.max(0,GOAL_CAMPING_TARGET-goalsScored):null,lead,targetReached:known&&goalsScored>=GOAL_CAMPING_TARGET&&lead>=GOAL_CAMPING_LEAD,matchEnded:Boolean(state?.core?.isEnd)};
}
