import {mkdir,writeFile} from 'node:fs/promises';
import {browser} from './browser.mjs';
const game=process.argv[2]||'football-legends';
const profiles=process.env.AGENT_PROFILE?[process.env.AGENT_PROFILE]:['beginner','experienced'];
const limit=Number(process.env.AGENT_DECISIONS||120),trials=Number(process.env.AGENT_TRIALS||1);
const directory=process.env.AGENT_EVIDENCE_DIR||'evidence/explore-'+game;
await mkdir(directory,{recursive:true});
const b=await browser();
try{
  for(let trial=0;trial<trials;trial++)for(const profile of profiles){
    const page=await b.newPage({viewport:{width:1440,height:1080}});
    try{
      await page.goto('http://localhost:4173/'+game+'/explore');
      await page.waitForFunction(()=>window.swarm&&window.gameAgent?.observe().ready&&!document.querySelector('#explore-run').disabled);
      let errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.evaluate(({profile,limit})=>{window.benchmarkDone=false;swarm.start({profile,limit,playbackFps:60}).finally(()=>{window.benchmarkDone=true;});},{profile,limit});
      let last=0;
      while(!await page.evaluate(()=>window.benchmarkDone)){
        await page.waitForTimeout(1000);
        const state=await page.evaluate(()=>({count:swarm.history.length,last:swarm.history.at(-1),status:document.querySelector('#agent-status').textContent}));
        if(state.count-last>=10){last=state.count;const player=state.last?.after.players?.find(p=>p.human||p.behaviors?.[0]?.enabled);console.log(JSON.stringify({game,profile,trial,decision:state.count,action:state.last?.action.reason,score:state.last?.after.match&&[state.last.after.match.score1,state.last.after.match.score2],level:state.last?.after.state,player:player&&{x:player.x,y:player.y}}));}
      }
      const session=await page.evaluate(()=>swarm.sessions[0]);
      if(!session)throw Error('No session recorded: '+await page.locator('#agent-status').textContent());
      await writeFile(`${directory}/${profile}-${trial}.json`,JSON.stringify({...session,errors},null,2));
      await page.screenshot({path:`${directory}/${profile}-${trial}.png`,fullPage:true});
      console.log(JSON.stringify({finished:true,game,profile,trial,outcome:session.outcome,status:session.status,decisions:session.decisions.length,gameSeconds:session.gameSeconds,visualReviews:session.decisions.filter(d=>d.visualReview).length,errors}));
    }finally{await page.close();}
  }
}finally{await b.close();}
