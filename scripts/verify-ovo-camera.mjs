import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
import {captureGame} from './verify-helpers.mjs';

const output='evidence/ovo-camera-framing';
// These are the original level 10 solid transforms. Framing must never resize,
// reposition or remove the wall/floor to make the canvas look more filled.
const originalSolids=[
  {id:1067,x:744,y:232,width:1024,height:752,angle:1.570796370506287},
  {id:1069,x:735,y:720,width:441,height:552,angle:0},
];
const simulation=state=>{
  const {scrollX,scrollY,...layout}=state.layout;
  return {...state,layout};
};
const solids=state=>originalSolids.map(({id})=>{
  const object=state.objects.find(candidate=>candidate.id===id);
  assert.ok(object,'Original level 10 solid '+id+' must exist.');
  return Object.fromEntries(['id','x','y','width','height','angle'].map(key=>[key,object[key]]));
});

async function inspect(page) {
  return page.evaluate(()=>{
    const iframe=document.querySelector('#game');
    const win=iframe.contentWindow;
    const runtime=win.cr_getC2Runtime();
    const canvas=win.document.querySelector('#c2canvas');
    const layout=runtime.running_layout;
    const player=runtime.types_by_index.find(type=>type.sid===980093774729797).instances.find(instance=>instance.behavior_insts.some(behavior=>behavior.enabled));
    const bbox=instance=>{
      instance.update_bbox();
      return {left:instance.bbox.left,right:instance.bbox.right,top:instance.bbox.top,bottom:instance.bbox.bottom};
    };
    const rect=element=>{
      const box=element.getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width,height:box.height};
    };
    const layer=player.layer;
    return {
      state:gameAgent.observe(),
      renderer:runtime.glwrap?'WebGL':'Canvas2D',
      camera:{scrollX:layout.scrollX,scrollY:layout.scrollY,viewLeft:layer.viewLeft,viewRight:layer.viewRight,viewTop:layer.viewTop,viewBottom:layer.viewBottom,scale:layer.getScale()},
      player:bbox(player),wall:bbox(runtime.getObjectByUID(1067)),floor:bbox(runtime.getObjectByUID(1069)),
      canvas:{...rect(canvas),bufferWidth:canvas.width,bufferHeight:canvas.height},
      iframe:rect(iframe),window:{width:win.innerWidth,height:win.innerHeight},
      page:{width:innerWidth,documentWidth:document.documentElement.scrollWidth},
    };
  });
}

function verifyFraming(result,label) {
  const {camera,player,wall,floor,canvas,window:viewport,iframe}=result;
  assert.equal(result.state.state,'Level 10');
  assert.ok(camera.viewLeft>=wall.right-17,label+': do not frame the left black solid as empty viewport.');
  assert.ok(camera.viewBottom<=floor.top+17,label+': do not frame the bottom black solid as empty viewport.');
  assert.ok(player.left>=camera.viewLeft&&player.right<=camera.viewRight&&player.top>=camera.viewTop&&player.bottom<=camera.viewBottom,label+': the whole player must remain visible.');
  assert.deepEqual(solids(result.state),originalSolids,label+': original collision geometry must be retained.');
  assert.ok(Math.abs(canvas.x)<1&&Math.abs(canvas.y)<1,label+': canvas must start at the iframe origin.');
  assert.ok(Math.abs(canvas.width-viewport.width)<=1&&Math.abs(canvas.height-viewport.height)<=1,label+': canvas must fill the iframe viewport.');
  assert.ok(Math.abs(iframe.width-canvas.width)<=1&&Math.abs(iframe.height-canvas.height)<=1,label+': iframe must not contain unused margins.');
  assert.ok(Math.abs(canvas.width/canvas.height-canvas.bufferWidth/canvas.bufferHeight)<.01,label+': the canvas must preserve its render aspect ratio.');
  assert.ok(result.page.documentWidth<=result.page.width+1,label+': page must not overflow horizontally.');
}

const b=await browser();
try {
  const page=await b.newPage({viewport:{width:1920,height:1280}});
  const errors=[],external=[],modelRequests=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    const url=new URL(request.url());
    if(!/^(localhost|127\.0\.0\.1)$/.test(url.hostname))external.push(request.url());
    if(/^\/api\/(?:agent|hybrid|tactical)\/decision$/.test(url.pathname))modelRequests.push(request.url());
  });
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  await page.goto('http://localhost:4173/ovo');
  await page.waitForFunction(()=>window.gameAgent?.observe().ready&&window.swarm&&document.querySelector('#agent-rehearse')?.disabled===false,{},{timeout:15000});
  await page.evaluate(()=>swarm.start({mode:'scripted',playbackFps:20,limit:30}));
  assert.equal(await page.evaluate(()=>swarm.running),false);
  assert.equal(await page.evaluate(()=>swarm.history[0].before.state),'Level 9');
  assert.equal(await page.evaluate(()=>swarm.history.length),15,'The actual UI rehearsal must retain its native successful shortcut.');
  await mkdir(output,{recursive:true});
  const results=[];
  const initial=await inspect(page);
  verifyFraming(initial,'After native Level 9 → 10 transition');
  const frozenSimulation=simulation(initial.state);
  for(const [label,size]of [
    ['desktop',{width:1920,height:1280}],
    ['mobile',{width:390,height:844}],
    ['desktop-return',{width:1440,height:1080}],
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    const result=await inspect(page);
    verifyFraming(result,label);
    assert.deepEqual(simulation(result.state),frozenSimulation,label+': paused resize may reframe the camera but cannot advance the clock, player, variables, or objects.');
    const capture=await captureGame(page,{path:output+'/'+label+'-game.png',label});
    assert.deepEqual(await page.evaluate(()=>gameAgent.observe()),result.state,label+': capture must not change the native state or camera.');
    await page.screenshot({path:output+'/'+label+'.png',fullPage:true});
    results.push({...result,label,captureStats:capture.stats});
  }
  const beforeStep=await page.evaluate(()=>gameAgent.observe());
  await page.evaluate(()=>gameAgent.step({frames:1,keys:[]}));
  const stepped=await inspect(page);
  verifyFraming(stepped,'After native camera tick');
  assert.equal(stepped.state.engineTicks,beforeStep.engineTicks+1);
  assert.equal(stepped.state.clock.frames,beforeStep.clock.frames+1);
  assert.ok(Math.abs(stepped.state.engineSeconds-beforeStep.engineSeconds-1/60)<1e-8);
  await captureGame(page,{path:output+'/after-native-step-game.png',label:'After native camera tick'});
  results.push({...stepped,label:'after-native-step'});
  assert.deepEqual(errors,[]);
  assert.deepEqual(external,[]);
  assert.deepEqual(modelRequests,[],'Camera verification must not call any models.');
  assert.deepEqual(failed,[]);
  const checks={nativeTransition:'Level 9 → Level 10',rehearsalActions:15,originalCollisionGeometryUnchanged:true,playerFullyVisible:true,canvasFillsIframe:true,noCssStretch:true,pausedResizePreservesSimulation:true,capturePreservesNativeState:true,nativeCameraTickRetainsFraming:true,renderer:initial.renderer,errors,external,modelRequests,failed};
  await writeFile(output+'/verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks,results},null,2));
  console.log(JSON.stringify(checks,null,2));
}finally{await b.close();}
