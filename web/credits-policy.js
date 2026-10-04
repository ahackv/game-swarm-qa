export const CREDITS_LEVELS=52;
export function creditsObservation(state){
  return {state:state?.state,unlockedLevels:state?.unlockedLevels,clock:{frames:state?.clock?.frames,simulationSeconds:state?.clock?.simulationSeconds}};
}
export function validateCreditsAction(action){
  if(!action||!['double_click','stop'].includes(action.type)||typeof action.reason!=='string'||!action.reason.trim()||action.reason.length>400)throw Error('Invalid credits action.');
  if(action.type==='double_click'&&![action.x,action.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1))throw Error('Click coordinates must be between 0 and 1.');
  return action;
}
export function creditsUnlocked(before,after){
  return before?.state==='Credits'&&after?.state==='Credits'&&Number.isInteger(before.unlockedLevels)&&before.unlockedLevels>=1&&before.unlockedLevels<CREDITS_LEVELS&&after.unlockedLevels===CREDITS_LEVELS;
}
