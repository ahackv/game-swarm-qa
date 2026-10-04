// A source-guided reproduction using ordinary keyboard inputs. This is a
// deterministic rehearsal, not an LLM decision or independent discovery.
const hypothesis='Facing away from the left wall lets repeated jump taps climb it, bypassing the normal Level 9 route.';
export function ovoRehearsalAction(state, history=[], {frames=30}={}) {
  if(![15,30].includes(frames))throw Error('OvO rehearsal supports 15 or 30 frames per observation.');
  const action=(keys,holdFrames,phase,reason)=>({keys,frames,holdFrames,phase,reason,hypothesis});
  if(state.state!=='Level 9'||state.completed)return action([],frames,'Observe completion','Inspect the native level transition or completion card.');
  const player=state.players.find(p=>p.behaviors?.[0]?.enabled);
  if(!player)return action([],frames,'Wait for player','Wait for the native player to become available.');
  const prior=history.at(-1)?.action?.phase;
  let phase=prior==='Face away'?'Climb wall':prior||'Approach wall';
  if(phase==='Wait for player')phase='Approach wall';
  if(phase==='Approach wall'){
    if(player.x>177)return action(['ArrowLeft'],frames,'Approach wall','Move left across the floor button to the lowered wall.');
    return action(['ArrowRight'],1,'Face away','Tap right for one physics frame, then release for '+(frames-1)+' frames to face away without leaving the wall.');
  }
  if(phase==='Climb wall'){
    if(player.y>535)return action(['ArrowUp'],1,'Climb wall','Tap jump alone, then release for '+(frames-1)+' frames. Leave both horizontal keys released so facing stays right.');
    phase='Cross wall';
  }
  if(phase==='Cross wall'){
    if(player.x>145)return action(['ArrowLeft'],frames===30?10:15,'Cross wall','The player has cleared the wall top. Move left over it toward the flag.');
    return action(['ArrowDown'],1,'Smash to flag','Ground-pound immediately to stop horizontal drift and drop through the platform toward the flag.');
  }
  return action([],frames,'Observe completion','Release all keys while the native ground-pound carries the player to the flag.');
}
