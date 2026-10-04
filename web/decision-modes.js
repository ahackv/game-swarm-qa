export const decisionModes={
  hybrid:{label:'Jev + Luna',description:'Jev moves. Luna reviews when needed.'},
  luna:{label:'Luna only',description:'Luna sees and chooses each move.'},
};

export function validateDecisionMode(mode){
  if(!Object.hasOwn(decisionModes,mode))throw Error('Choose Jev + Luna or Luna only.');
  return decisionModes[mode];
}
