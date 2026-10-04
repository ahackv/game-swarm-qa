import {cp,mkdir,rm,stat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'dist');
const run=promisify(execFile);
// A fresh Git deployment fetches the versioned game sources. Local builds reuse
// the acquisition cache; neither originals nor run archives enter the output.
for(const script of ['extract.mjs','extract-ovo.mjs']){
  const {stdout}=await run(process.execPath,[resolve(root,'scripts',script)],{cwd:root,maxBuffer:2_000_000});
  process.stdout.write(stdout);
}
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(resolve(root,'web'),output,{recursive:true});
for(const [directory,slug] of [['game','football-legends'],['ovo','ovo']]){
  await cp(resolve(root,'private',directory),resolve(output,'game',slug),{
    recursive:true,
    filter:path=>!basename(path).endsWith('.original'),
  });
}
await cp(resolve(root,'assets/previews'),resolve(output,'previews'),{recursive:true});
for(const required of ['index.html','game.html','explore.html','player.html','game/football-legends/index.html','game/ovo/index.html','previews/football-legends.png','previews/ovo.png']){
  if(!(await stat(resolve(output,required))).size)throw Error('Empty build output: '+required);
}
console.log('Built static site and both game runtimes in dist/.');
