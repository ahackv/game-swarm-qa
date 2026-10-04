const iframe = document.querySelector('#game');
const isOvo = location.pathname === '/ovo';
const config = isOvo ? {slug:'ovo',title:'OvO',fps:60,author:'DEDRA GAMES'} : {slug:'football-legends',title:'Football Legends',fps:40,author:'MADPUFFERS'};
const frameMs = 1000 / config.fps;
document.title = config.title + ' · Swarm QA';
document.querySelector('#game-title').textContent = config.title;
document.querySelector('#credit').textContent = 'Original game by ' + config.author + ' · local assets · muted audio';
document.querySelector('#rate').textContent = config.fps + ' native physics fps · 2 observations / game second';
document.querySelector('#note').innerHTML = '<strong>Time moves only when the agent is ready.</strong> By default, it sees a screenshot every 500 ms of game time. The game stays frozen during inference. You can step individual physics frames below.';
document.querySelector('#quick').textContent = isOvo ? 'Start level 1' : 'Start quick match';
document.querySelector('#credits').hidden = !isOvo;
document.querySelector('#progression').hidden = !isOvo;
iframe.title = 'Extracted ' + config.title;
iframe.src = '/game/' + config.slug + '/index.html';
const buttons = [...document.querySelectorAll('.controls button')];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let preview = null, ready = false, stepping = false;
const held = new Set();
function runtime() {
  const win = iframe.contentWindow;
  return {win, clock:win.__gameClock, game:isOvo ? win.cr_getC2Runtime?.() : win.Phaser?.GAMES[0], require:win.__footballRequire};
}
function scalarFields(object) {
  if (!object) return null;
  return Object.fromEntries(Object.entries(object).filter(([,v]) => v === null || ['number','string','boolean'].includes(typeof v)));
}
function observe() {
  const {clock, game, require} = runtime();
  if (!ready) return {ready:false};
  if (isOvo) return observeOvo(clock, game);
  const core = require(13).FootballGameCore.instance;
  const match = require(34).MatchData;
  const bodies = [];
  const space = require(27).NapePhysics.space;
  if (space?.bodies) for (let i=0;i<space.bodies.length;i++) {
    const b=space.bodies.at(i);
    bodies.push({id:b.id,x:b.position.x,y:b.position.y,vx:b.velocity.x,vy:b.velocity.y,rotation:b.rotation});
  }
  const entity = object => object?.body ? {id:object.body.id,x:object.body.position.x,y:object.body.position.y,vx:object.body.velocity.x,vy:object.body.velocity.y,direction:object.direction,playerID:object.playerID,state:object.state,...(object.controller ? {human:object.energyID>0,superPower:object.superPower,superCharge:object.superShotCount,superThreshold:object.superShotPts,superReady:object.superShotCount>=object.superShotPts,onGround:object.isOnGround,canAct:object.canAct} : {superHit:object.superHit})} : null;
  return {ready:true, clock:{...clock.status,simulationSeconds:clock.status.frames*.025}, state:game.state.current, match:scalarFields(match), core:scalarFields(core), physicsSeconds:space?.elapsedTime, ball:entity(core.ball), players:core.playersAll.flat().map(entity), bodies};
}
function observeOvo(clock, game) {
  const collider = game.types_by_index.find(type => type.sid === 980093774729797);
  const players = (collider?.instances || []).map(instance => ({id:instance.uid,x:instance.x,y:instance.y,width:instance.width,height:instance.height,facing:instance.instance_vars?.[2],behaviors:instance.behavior_insts.map(scalarFields)}));
  const objects = game.types_by_index.filter(type => !type.is_family).flatMap(type => type.instances.filter(instance => Number.isFinite(instance.x) && Number.isFinite(instance.y)).map(instance => ({id:instance.uid,type:type.name,x:instance.x,y:instance.y,width:instance.width,height:instance.height,angle:instance.angle,visible:instance.visible,...(typeof instance.text === 'string' ? {text:instance.text} : {})})));
  const variables = Object.fromEntries(game.all_global_vars.map(variable => [variable.name, variable.getValue()]));
  const layout = game.running_layout;
  const progression = game.types_by_index.find(type=>type.name==='t12')?.instances[0]?.data;
  return {ready:true,clock:{...clock.status,simulationSeconds:clock.status.frames / config.fps},state:layout.name,completed:Boolean(layout.layers.find(layer=>layer.name==='End Card')?.visible),unlockedLevels:progression?.Levels,engineTicks:game.tickcount,engineSeconds:game.kahanTime.sum,dt:game.dt,layout:{width:layout.width,height:layout.height,scrollX:layout.scrollX,scrollY:layout.scrollY},players,variables,objects};
}
function refresh() {
  const state=observe();
  if (!state.ready) return;
  document.querySelector('#sim').textContent=state.clock.simulationSeconds.toFixed(3)+' s';
  document.querySelector('#frames').textContent=String(state.clock.frames);
  if(isOvo)document.querySelector('#progression').textContent='Native progression: '+state.unlockedLevels+' / 52 levels unlocked.'+(state.state==='Credits'?' Double-click the central DEDRA logo, then step one frame to inspect the result.':'');
  document.querySelector('#state').textContent=JSON.stringify(state,null,2);
  document.querySelector('#status-text').textContent=preview?'Preview · 4 fps':'Frozen · ready for agent';
  document.querySelector('#status').classList.add('ready');
}
const codes={ArrowLeft:37,ArrowRight:39,ArrowUp:38,ArrowDown:40,KeyW:87,KeyA:65,KeyS:83,KeyD:68,KeyX:88,KeyZ:90,KeyL:76,KeyK:75,Space:32,KeyP:80,KeyR:82,Enter:13,Escape:27,ShiftLeft:16};
function applyKeys(keys) {
  const {win}=runtime();
  const next = new Set(keys);
  for(const code of next) if(!codes[code]) throw Error('Unsupported key: '+code);
  for(const code of [...held]) if(!next.has(code)) {dispatch(code,'keyup');held.delete(code);}
  for(const code of next) if(!held.has(code)) {dispatch(code,'keydown');held.add(code);}
  function dispatch(code,type) {
    const event=new win.KeyboardEvent(type,{key:code.startsWith('Key')?code.slice(3).toLowerCase():code==='Space'?' ':code,code,keyCode:codes[code],which:codes[code],bubbles:true});
    win.document.dispatchEvent(event);
  }
}
async function step({frames=1, keys} = {}) {
  if(!ready) throw Error('Game is still loading.');
  if(stepping) throw Error('A step is already running.');
  if(!Number.isInteger(frames) || frames<1 || frames>400) throw Error('frames must be an integer from 1 to 400.');
  if(keys && !Array.isArray(keys)) throw Error('keys must be an array of key codes.');
  stepping=true;
  try {
    if(keys) applyKeys(keys);
    for(let i=0;i<frames;i++) {runtime().clock.tick(frameMs);await Promise.resolve();}
    refresh();
    return observe();
  } finally {stepping=false;}
}
function stopPreview() {
  if(preview) clearInterval(preview);
  preview=null;
  document.querySelector('#preview').setAttribute('aria-pressed','false');
  document.querySelector('#preview').textContent='Preview at 4 fps';
  refresh();
}
async function quickMatch({fireball=false} = {}) {
  stopPreview();
  const {game,require}=runtime();
  if(game.state.current!=='menu') throw Error('Reload to start a fresh quick match.');
  game.state.getCurrentState().startQuickMath();
  // Advance menu transitions and pre-match setup explicitly, allowing asset tasks
  // to complete without letting the simulation clock run on its own.
  for(let i=0;i<20;i++) {
    const inventory=require(23).Inventory.instance;
    if(fireball && inventory.isQuickMatch)inventory.players[0]=1;
    await step({frames:20,keys:[]});
    if(runtime().game.state.current==='gameplay' && runtime().game.state.getCurrentState().constructor.loadedLevel) break;
    await sleep(30);
  }
  document.querySelector('#quick').disabled=true;
  refresh();
}
function agentStep(options) {stopPreview();return step(options);}
async function act({frames,keys,holdFrames=frames}) {
  if(!Number.isInteger(frames)||frames<1||frames>400)throw Error('frames must be an integer from 1 to 400.');
  if(!Array.isArray(keys))throw Error('keys must be an array of key codes.');
  if(!Number.isInteger(holdFrames)||holdFrames<1||holdFrames>frames)throw Error('holdFrames must be between 1 and frames.');
  const heldState=await agentStep({frames:holdFrames,keys});
  return holdFrames<frames ? agentStep({frames:frames-holdFrames,keys:[]}) : heldState;
}
async function startLevel(level = 1) {
  stopPreview();
  if(!ready) throw Error('Game is still loading.');
  if(!Number.isInteger(level) || level < 1 || level > 52) throw Error('level must be an integer from 1 to 52.');
  const {win} = runtime();
  win.c2_callFunction('Menu > Level',[level-1]);
  for(let i=0;i<12;i++) {
    await step({frames:20,keys:[]});
    if(runtime().game.running_layout.name==='Level '+level && observe().players.some(player=>player.behaviors[0]?.enabled && !player.behaviors[0]?.ignoreInput))break;
  }
  document.querySelector('#quick').textContent = 'Restart level 1';
  return observe();
}
function capture() {
  if(!ready)throw Error('Game is still loading.');
  const {win,game}=runtime();
  if(isOvo) {if(game.glwrap)game.drawGL();else game.draw();}
  else game.renderer.render(game.stage);
  return win.document.querySelector('canvas').toDataURL('image/png');
}
async function openCredits() {
  stopPreview();runtime().win.c2_callFunction('Menu > Credits',[]);
  return step({frames:120,keys:[]});
}
const api = {observe,capture,act,step:agentStep,stop:stopPreview,releaseKeys:()=>applyKeys([]),...(isOvo ? {startLevel,openCredits} : {startQuickMatch:quickMatch})};
window.gameAgent = api;
window[isOvo ? 'ovo' : 'football'] = api;
document.querySelector('#observe-step').onclick=()=>agentStep({frames:config.fps/2}).catch(showError);
document.querySelector('#step').onclick=()=>agentStep().catch(showError);
document.querySelector('#batch').onclick=()=>agentStep({frames:10}).catch(showError);
document.querySelector('#quick').onclick=()=> (isOvo ? startLevel() : quickMatch()).catch(showError);
document.querySelector('#credits').onclick=()=>openCredits().catch(showError);
document.querySelector('#preview').onclick=()=>{
  if(preview) return stopPreview();
  preview=setInterval(()=>step().catch(error=>{stopPreview();showError(error);}),250);
  document.querySelector('#preview').setAttribute('aria-pressed','true');
  document.querySelector('#preview').textContent='Stop preview';refresh();
};
function showError(error) {document.querySelector('#status-text').textContent=error.message;console.error(error);}

// Bootstrap/loading uses the browser's real clock. Arm the barrier after the
// main menu and its first entrance animation, before starting any match.
while(!ready) {
  try {
    const {win,game,require,clock}=runtime();
    const loaded = isOvo ? game?.running_layout?.name === 'Main Menu' && !game.isloading && win.WebSdkWrapper : game?.state?.current==='menu' && require(19).default.isArtReady && require(3).default.fontReady && game.state.getCurrentState().menuSideBar?.visible;
    if(loaded) {
      await sleep(450);
      clock.pause(isOvo ? {performanceMs:game.last_tick_time} : {});
      if(isOvo) {game.isSuspended=false;win.Howler?.mute(true);}
      ready=true;buttons.forEach(b=>b.disabled=false);refresh();
      win.addEventListener('blur',()=>applyKeys([]));
      break;
    }
  } catch(error) {console.debug(error.message);}
  await sleep(50);
}
