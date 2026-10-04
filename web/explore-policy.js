// Ordinary play has no dependency on the finding policies or seeded routes.
// Profiles change perception, available skills, and control precision only.
export const profiles = {
  beginner: {
    label: 'Beginner',
    prompt: 'Play as a first-time casual player who wants to win but has only learned the basic movement and jump or kick buttons. React to the current ball or nearby obstacle. Follow the obvious route. Use one simple intention at a time, commit to broad movements, and learn through trial and error. Do not anticipate future ball trajectories, plan precise landings, chain advanced mechanics, or use special abilities. Do not deliberately lose or invent mistakes. You have no knowledge of any finding or exploit.',
  },
  experienced: {
    label: 'Experienced',
    prompt: 'Play as an experienced player trying to win through ordinary play. Anticipate the next interception or landing, preserve a useful position, and use precise short inputs near targets. Time jumps before obstacles and gaps, release jump to allow another jump, and use a charged ability when the ball is in range. In a platformer, use ordinary wall jumps and smash through breakable floors by jumping then pressing down. Use the intended level route. Do not camp inside the goal, search for hidden unlocks, or repeat facing-dependent wall jumps. You have no supplied exploit route.',
  },
};
export function validateProfile(profile) {
  if (!Object.hasOwn(profiles, profile)) throw Error('Choose beginner or experienced.');
  return profiles[profile];
}
const clamp=(n,low,high)=>Math.min(high,Math.max(low,n));
const playerOf=(game,state)=>state.players?.find(p=>game==='ovo'?p.behaviors?.[0]?.enabled:p.human);

export function explorationPolicy({game,state,profile,history=[]}) {
  const persona=validateProfile(profile),expert=profile==='experienced';
  if (!['football-legends','ovo'].includes(game)) throw Error('Unsupported game.');
  const frames=game==='ovo'?30:20, p=playerOf(game,state), candidates={};
  const add=(id,keys,holdFrames,description,criteria)=>{
    candidates[id]={description,criteria,action:{keys,holdFrames,frames,phase:description,reason:description}};
  };
  const wait=(description='Watch the next moment')=>add('wait',[],frames,description,'Wait during the native countdown, goal animation, transition or while an airborne player is already aligned. Do not wait instead of making forward progress.');
  if(!p || (game==='football-legends'&&(state.core?.isCountDown||state.core?.isGoal||state.core?.isPlaying===false)) || (game==='ovo'&&state.completed)) {
    wait('Wait for the game to resume');
    return {candidates,features:{nativePause:true},profile,goal:persona.prompt};
  }
  const previous=history.at(-1),old=playerOf(game,previous?.before||{});
  const stuck=history.length>=3&&history.slice(-3).every(h=>h.after?.state===state.state&&Math.abs((playerOf(game,h.before)?.x??-999)-p.x)<12);
  let features;
  if(game==='football-legends') {
    const ball=state.ball;
    if(!ball){wait();return {candidates,features:{ballVisible:false},profile,goal:persona.prompt};}
    const target=expert?clamp(ball.x+(ball.vx||0)*.14-36,125,700):clamp(ball.x,120,720);
    const dx=target-p.x,near=Math.abs(ball.x-p.x)<(expert?80:46)&&Math.abs(ball.y-p.y)<(expert?80:48);
    const elevated=ball.y<p.y-80&&Math.abs(ball.x-p.x)<85;
    features={nativePause:false,ballSide:ball.x<p.x?'left':'right',ballNearby:near,ballAbove:elevated,onGround:Boolean(p.onGround),targetSide:dx< -18?'left':dx>18?'right':'here',ballBehindPlayer:ball.x<p.x-15,superReady:Boolean(p.superReady),stuck};
    const hold=expert?clamp(Math.round((Math.abs(dx)-25)/8.3),1,frames):frames;
    add('move_left',['ArrowLeft'],hold,'Move left toward the ball','targetSide is left AND ballNearby is false AND ballAbove is false. Close the distance before kicking.');
    add('move_right',['ArrowRight'],hold,'Move right toward the ball','targetSide is right AND ballNearby is false AND ballAbove is false. Close the distance before kicking.');
    add('kick',['KeyX'],expert?frames:3,'Kick toward the opposing goal',expert?'ballNearby is true, superReady is false, and ballSide is left. Shoot while the ball is in range.':'ballNearby is true. Use the basic kick; this player has not learned special moves.');
    if(expert){
      add('attack',['ArrowRight','KeyX'],hold,'Advance and shoot','ballNearby is true, ballSide is right, and superReady is false. Move into the ball while shooting.');
      add('jump_shoot',['ArrowUp','KeyX'],5,'Jump to meet the ball','ballAbove is true AND onGround is true. The ball is overhead, within a jump contest, but above ordinary kicking range.');
      if(p.superReady)add('super',['KeyZ'],frames,'Use the charged shot','ballNearby is true AND superReady is true. Prefer the charged ability over an ordinary kick while it can reach.');
    }else if(p.onGround)add('jump',['ArrowUp'],4,'Jump toward the ball','ballAbove is true AND onGround is true. Try a simple jump at the overhead ball.');
    wait();
    candidates.wait.criteria='targetSide is here and ballNearby is false, OR ballAbove is true and onGround is false. Hold position under the ball or let the jump finish. Otherwise keep pursuing the ball.';
  }else{
    const behavior=p.behaviors[0],grounded=Boolean(behavior.wasOnFloor),direction='ArrowRight';
    const surfaces=(state.objects||[]).filter(o=>['t51','t49','t45'].includes(o.type)&&o.bounds);
    const feet=p.y+p.height/2;
    const floor=surfaces.filter(o=>Math.abs(o.bounds.top-feet)<14&&o.bounds.left<=p.x+12&&o.bounds.right>=p.x-12).sort((a,b)=>b.bounds.right-a.bounds.right)[0];
    const lookahead=expert?145:28;
    let floorRight=floor?.bounds.right;
    for(let i=0;floor&&i<surfaces.length;i++){
      const adjoining=surfaces.find(o=>Math.abs(o.bounds.top-floor.bounds.top)<14&&o.bounds.left<=floorRight+2&&o.bounds.right>floorRight);
      if(!adjoining)break;floorRight=adjoining.bounds.right;
    }
    const edgeDistance=floor?floorRight-p.x:Infinity;
    const edge=Boolean(floor&&edgeDistance<lookahead);
    const wallSurface=surfaces.find(o=>o.bounds.left>=p.x-10&&o.bounds.left-p.x<lookahead&&o.bounds.top<feet-18&&o.bounds.bottom>p.y-16);
    const wall=Boolean(wallSurface),wallClose=Boolean(wallSurface&&wallSurface.bounds.left-p.x<38);
    const flag=(state.objects||[]).find(o=>o.type==='t44');
    const breakableBelow=surfaces.some(o=>o.type==='t45'&&o.bounds.left<=p.x&&o.bounds.right>=p.x&&o.bounds.top>=feet-14&&o.bounds.top-feet<220);
    const goalNear=Boolean(flag&&Math.abs(flag.x-p.x)<70);
    const takeoffReady=edge&&edgeDistance<38;
    features={onGround:grounded,falling:behavior.dy>0,obstacleAhead:wall,gapAhead:edge,wallClose,takeoffReady,needsApproach:expert&&edge&&!takeoffReady,stuck,goalNearby:goalNear,goalDirection:flag&&flag.x<p.x-35?'left':'right',jumpHeld:previous?.action?.keys?.includes('ArrowUp')&&previous?.action?.holdFrames===frames};
    const hold=expert&&goalNear?clamp(Math.round(Math.abs(flag.x-p.x)/5.5)-2,1,frames):frames;
    add('run_right',[direction],hold,'Run along the course',expert?'jumpHeld is false, goalDirection is right, and either onGround is false with wallClose false OR onGround is true with gapAhead, wallClose and stuck all false. Maintain forward momentum in the air to reach the next platform.':'jumpHeld is false, goalDirection is right, and either onGround is false OR obstacleAhead, gapAhead and stuck are all false. Continue right through clear space or carry an airborne jump.');
    add('jump_right',[direction,'ArrowUp'],expert?29:frames,'Jump forward',expert?'onGround is true AND jumpHeld is false AND takeoffReady, wallClose or stuck is true. Jump from near the edge and keep forward momentum to reach the next platform.':'onGround is true AND jumpHeld is false AND at least one of obstacleAhead, gapAhead, stuck is true. Jump forward over the obstacle.');
    add('release_jump',[direction],expert?8:frames,'Release jump and move','jumpHeld is true. Release the jump key for this interval so the next press can trigger a new jump, while moving forward.');
    if(expert){
      // Integrate the reported native acceleration/deceleration to stop near
      // an edge. This selects key duration, never a position or score edit.
      let approachHold=0,bestError=Infinity;
      for(let n=0;n<=frames;n++){
        let x=p.x,v=behavior.dx||0;
        for(let t=0;t<frames;t++){v=t<n?Math.min(behavior.maxspeed||330,v+(behavior.acc||1500)/60):Math.max(0,v-(behavior.dec||1500)/60);x+=v/60;}
        const error=Math.abs(x-(floorRight-22));
        if(error<bestError&&x<(floorRight||Infinity)-8){approachHold=n;bestError=error;}
      }
      add('approach_edge',approachHold?[direction]:[],Math.max(1,approachHold),'Set up the takeoff','onGround is true AND needsApproach is true AND jumpHeld is false. Approach or brake near the edge before jumping; jumping too early will miss the landing.');
      add('wall_jump',['ArrowUp'],1,'Wall-jump onto the ledge','onGround is false AND wallClose is true AND jumpHeld is false. Use an ordinary wall jump away from the right wall to gain height, then steer onto the ledge.');
      add('prepare_smash',['ArrowUp'],1,'Jump above the breakable floor','Terrain is smashable_platform. Jump in place so the next down input can break through the floor.');
      add('smash',['ArrowDown'],1,'Smash through the platform','Terrain is above_smashable_platform. Press down while airborne to break the floor and follow the ordinary route below.');
      add('move_left',['ArrowLeft'],8,'Correct the landing','The exit is behind on the left or a failed landing requires a small correction.');
      add('slide',[direction,'ArrowDown'],10,'Slide under the obstacle','A low ceiling blocks the standing player and the screenshot confirms a low passage. Do not slide toward an open gap.');
    }
    wait('Let the landing settle');
    candidates.wait.criteria='The player is airborne and aligned with the exit, with goalNearby true. Otherwise keep forward momentum or set up the next jump; an airborne jump over a gap needs forward movement.';
    // A single terrain classification avoids asking the fast model to resolve
    // long Boolean expressions. It still selects the actual movement.
    features.terrain=features.jumpHeld?'jump_button_still_held':expert&&breakableBelow?(grounded?'smashable_platform':'above_smashable_platform'):!grounded?(wallClose&&expert?'airborne_beside_wall':'crossing_in_air'):expert&&edge&&!takeoffReady?'approaching_gap':edge?'edge_of_gap':wallClose||!expert&&wall?'wall_on_ground':stuck?'blocked_on_ground':'clear_ground';
    candidates.run_right.criteria='Terrain is clear_ground or crossing_in_air. Run right to make progress or maintain an airborne jump. Never run across edge_of_gap without jumping.';
    candidates.jump_right.criteria='Terrain is edge_of_gap, wall_on_ground, or blocked_on_ground. Jump forward to clear it.';
    candidates.release_jump.criteria='Terrain is jump_button_still_held. Release the previous jump so the next jump can trigger.';
    if(expert){
      candidates.approach_edge.criteria='Terrain is approaching_gap. Move into takeoff position before jumping.';
      candidates.wall_jump.criteria='Terrain is airborne_beside_wall. Perform a normal wall jump to reach the ledge.';
    }
  }
  return {candidates,features,profile,goal:persona.prompt,progress:{stuck,movedSinceLastObservation:Boolean(old&&Math.hypot(old.x-p.x,old.y-p.y)>10)}};
}
