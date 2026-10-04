import {games,gameSlug} from './games.js';
const game=games[gameSlug],finding=game.findings.find(f=>f.id===location.pathname.split('/')[3]);
const back=document.querySelector('.back');back.href='/'+gameSlug;back.textContent='← '+game.title+' / Findings';
document.querySelector('header .eyebrow').textContent='SWARM QA / FINDING REPRODUCTION';
const heading=document.createElement('div');heading.className='finding-intro';
const title=document.createElement('h2');title.textContent=finding.title;
const summary=document.createElement('p');summary.className='note';summary.textContent=finding.summary;
heading.append(title,summary);document.querySelector('.workspace').before(heading);
if(finding.id==='credits-unlock'){
  document.body.classList.add('credits-finding');
  summary.textContent='Watch Luna locate the DEDRA logo, double-click it, and test whether the game unlocks all 52 levels.';
}
