import {games,gameSlug} from './games.js';
const game=games[gameSlug],finding=game.findings.find(f=>f.id===location.pathname.split('/')[3]);
const back=document.querySelector('.back');back.href='/'+gameSlug;back.textContent='← '+game.title+' / Findings';
document.querySelector('header .eyebrow').textContent='SWARM QA / FINDING REPRODUCTION';
const heading=document.createElement('div');heading.className='finding-intro';
const title=document.createElement('h2');title.textContent=finding.title;
const summary=document.createElement('p');summary.className='note';summary.textContent=finding.summary;
heading.append(title,summary);document.querySelector('.workspace').before(heading);
if(finding.id==='credits-unlock'){
  document.querySelector('.agent-panel').hidden=true;
  document.querySelector('.workspace').style.gridTemplateColumns='1fr';
  summary.textContent='Open credits, double-click the central DEDRA logo, then step one frame. The native unlocked-level count below the game records the result.';
  while(!window.gameAgent?.observe().ready)await new Promise(r=>setTimeout(r,50));
  await window.gameAgent.openCredits();
}
