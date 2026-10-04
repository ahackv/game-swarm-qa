import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// Exercise the exact pixels sent to the model, including a fresh WebGL draw.
// Screenshot equality alone can accidentally certify two blank buffers.
export async function captureGame(page,{path,label='Game capture'}={}) {
  const captured=await page.evaluate(async()=>{
    const before=JSON.stringify(gameAgent.observe());
    const dataUrl=gameAgent.capture();
    const stateUnchanged=JSON.stringify(gameAgent.observe())===before;
    const image=new Image();
    image.src=dataUrl;
    await image.decode();
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    const colors=new Set();let opaque=0,nonblack=0,nonwhite=0;
    for(let i=0;i<pixels.length;i+=4) {
      const r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];
      if(a>240)opaque++;
      if(a>240&&Math.max(r,g,b)>16)nonblack++;
      if(a>240&&Math.min(r,g,b)<239)nonwhite++;
      if(colors.size<10000)colors.add((r<<24|g<<16|b<<8|a)>>>0);
    }
    const count=canvas.width*canvas.height;
    return {dataUrl,stateUnchanged,stats:{width:canvas.width,height:canvas.height,distinctColors:colors.size,opaqueFraction:opaque/count,nonblackFraction:nonblack/count,nonwhiteFraction:nonwhite/count}};
  });
  assert.equal(captured.stateUnchanged,true,label+' must not advance or mutate observable simulation state.');
  assert.ok(captured.stats.width>=200&&captured.stats.height>=200,label+' must contain a full game canvas.');
  assert.ok(captured.stats.distinctColors>=8,label+' must contain game detail, not a solid buffer.');
  assert.ok(captured.stats.opaqueFraction>.95,label+' must not be a cleared transparent WebGL buffer.');
  assert.ok(captured.stats.nonblackFraction>.05,label+' must not be a blank black screen.');
  assert.ok(captured.stats.nonwhiteFraction>.005,label+' must not be a blank white screen.');
  const bytes=Buffer.from(captured.dataUrl.split(',')[1],'base64');
  if(path)await writeFile(path,bytes);
  return {...captured,bytes};
}

export const verifyQuarterSecondAction=(page,game)=>verifyObservationAction(page,game,250);
export const verifyHalfSecondAction=(page,game)=>verifyObservationAction(page,game,500);
async function verifyObservationAction(page,game,requestedIntervalMs) {
  const frames=(game==='ovo'?60:40)*requestedIntervalMs/1000;
  await page.evaluate(()=>{
    gameAgent.releaseKeys();
    const win=document.querySelector('#game').contentWindow;
    win.__cadenceInputs=[];
    win.__cadenceListener=event=>{
      if(event.code==='ArrowRight')win.__cadenceInputs.push({type:event.type,frame:win.__gameClock.status.frames});
    };
    win.document.addEventListener('keydown',win.__cadenceListener);
    win.document.addEventListener('keyup',win.__cadenceListener);
  });
  const before=await page.evaluate(()=>gameAgent.observe());
  const after=await page.evaluate(frames=>gameAgent.act({frames,holdFrames:3,keys:['ArrowRight']}),frames);
  const inputs=await page.evaluate(()=>{
    const win=document.querySelector('#game').contentWindow;
    win.document.removeEventListener('keydown',win.__cadenceListener);
    win.document.removeEventListener('keyup',win.__cadenceListener);
    return win.__cadenceInputs;
  });
  assert.equal(after.clock.frames-before.clock.frames,frames,'One observation must advance exactly its requested native frames.');
  const intervalMs=after.clock.performanceMs-before.clock.performanceMs;
  assert.ok(Math.abs(intervalMs-requestedIntervalMs)<1e-6,'The high-resolution observation interval must equal the requested simulated time.');
  const epochTolerance=frames*Number.EPSILON*Math.abs(before.clock.epochMs);
  assert.ok(Math.abs(after.clock.epochMs-before.clock.epochMs-requestedIntervalMs)<=epochTolerance,'The Date epoch must agree within native floating-point precision.');
  assert.deepEqual(inputs,[{type:'keydown',frame:before.clock.frames},{type:'keyup',frame:before.clock.frames+3}],'The ordinary key must release after three native frames, before the observation ends.');
  const player=state=>state.players.find(p=>p.human)||state.players.find(p=>p.behaviors?.[0]?.enabled);
  const movement=player(after).x-player(before).x;
  assert.ok(movement>0,'The short key hold must actually move the native player.');
  const captured=await captureGame(page,{label:requestedIntervalMs+' ms action capture'});
  return {before,after,checks:{observationFrames:frames,observationIntervalMs:intervalMs,dateEpochIntervalMs:after.clock.epochMs-before.clock.epochMs,shortHoldFrames:3,shortHoldReleased:true,shortHoldMovement:movement,captureLeavesStateUnchanged:true,captureStats:captured.stats}};
}
