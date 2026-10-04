import {games, gameSlug} from './games.js';
const game = games[gameSlug];
document.title = game.title + ' · Swarm QA';
for (const [id, text] of Object.entries({'game-title':game.title,'game-genre':game.genre,'game-description':game.description,'game-author':game.author,'explore-description':game.explore,'finding-count':String(game.findings.length).padStart(2,'0')})) document.getElementById(id).textContent=text;
const preview=document.querySelector('#game-image');preview.src='/previews/'+gameSlug+'.png';preview.alt=game.title+' gameplay';
document.querySelector('#explore-link').href='/'+gameSlug+'/explore';
for (const [index,finding] of game.findings.entries()) {
  const link=document.createElement('a');link.className='finding-row';link.href='/'+gameSlug+'/findings/'+finding.id;
  for(const [tag,cls,content] of [['span','finding-number',String(index+1).padStart(2,'0')],['div','finding-copy',''],['span','finding-status',finding.status],['span','finding-arrow','↗']]){
    const node=document.createElement(tag);node.className=cls;node.textContent=content;
    if(cls==='finding-copy')for(const [childTag,childClass,text] of [['span','eyebrow',finding.category],['h3','',finding.title],['p','',finding.summary],['small','',finding.evidence]]){const child=document.createElement(childTag);child.className=childClass;child.textContent=text;node.append(child);}
    link.append(node);
  }
  document.querySelector('#findings-list').append(link);
}
