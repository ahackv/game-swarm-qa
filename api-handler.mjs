import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {decide,agentConfig} from './agent.mjs';
import {hybridDecide,hybridConfig} from './hybrid.mjs';
import {exploreDecide,exploreConfig} from './explore.mjs';
import {creditsDecide} from './credits.mjs';

const MAX_BODY_BYTES=3_500_000;
export const API_PATHS=['/api/agent/config','/api/agent/decision','/api/hybrid/decision','/api/explore/decision','/api/credits/decision'];
const decisions={'/api/agent/decision':decide,'/api/hybrid/decision':hybridDecide,'/api/explore/decision':exploreDecide,'/api/credits/decision':creditsDecide};
const configFor=game=>({...agentConfig(game),hybrid:hybridConfig(game),explore:exploreConfig(game)});

const json=(res,status,value)=>{
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
};

export function sameOrigin(req,{hosted=process.env.VERCEL==='1'}={}){
  if(!req.headers.origin)return true;
  const host=req.headers.host;
  const forwarded=req.headers['x-forwarded-proto'];
  // Only trust the proxy protocol on Vercel; the host remains this request's host.
  const protocol=hosted&&forwarded==='https'?'https':req.socket?.encrypted?'https':'http';
  return req.headers.origin===`${protocol}://${host}`;
}

async function readInput(req){
  // Vercel can supply a parsed body; the local Node server supplies a stream.
  if(req.body!==undefined){
    const raw=typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body);
    if(Buffer.byteLength(raw)>MAX_BODY_BYTES)throw Object.assign(Error('Request too large.'),{status:413});
    try{return JSON.parse(Buffer.isBuffer(raw)?raw.toString('utf8'):raw);}
    catch{throw Object.assign(Error('Invalid JSON request.'),{status:400});}
  }
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);};
    const error=value=>{cleanup();reject(value);};
    const data=chunk=>{
      size+=chunk.length;
      if(size>MAX_BODY_BYTES){
        error(Object.assign(Error('Request too large.'),{status:413}));
        req.resume();return;
      }
      chunks.push(chunk);
    };
    const end=()=>{
      cleanup();
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{reject(Object.assign(Error('Invalid JSON request.'),{status:400}));}
    };
    req.on('data',data);req.once('end',end);req.once('error',error);
  });
}

export function createApiHandler({decisionHandlers=decisions,configuration=configFor,hosted=process.env.VERCEL==='1',archiveDirectory=hosted?null:resolve(import.meta.dirname,'private/runs'),timeoutMs=hosted?55000:60000}={}){
  let busy=false;
  return async function handleApi(req,res,pathname=new URL(req.url,'http://localhost').pathname){
    if(pathname==='/api/agent/config'){
      if(req.method!=='GET'){json(res,405,{error:'Use GET.'});return;}
      json(res,200,configuration(new URL(req.url,'http://localhost').searchParams.get('game')));return;
    }
    if(!Object.hasOwn(decisionHandlers,pathname)){json(res,404,{error:'Not found.'});return;}
    if(req.method!=='POST'){json(res,405,{error:'Use POST.'});return;}
    if(!sameOrigin(req,{hosted})){json(res,403,{error:'Origin rejected.'});return;}
    if(busy){json(res,409,{error:'An agent decision is already running.'});return;}
    busy=true;
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    const close=()=>{if(!res.writableEnded)cancel();};
    req.on('aborted',cancel);req.on('error',cancel);res.on('close',close);
    try{
      const input=await readInput(req);
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]);
      signal.throwIfAborted();
      const result=await decisionHandlers[pathname](input,signal);
      signal.throwIfAborted();
      if(archiveDirectory){
        // Full model calls and screenshots belong only to the active browser view.
        const {inspection,...savedResult}=result;
        await mkdir(archiveDirectory,{recursive:true});
        const exploring=pathname==='/api/explore/decision';
        await writeFile(resolve(archiveDirectory,randomUUID()+'.json'),JSON.stringify({engine:exploring?'explore':pathname.includes('/hybrid/')?'hybrid':'visual',game:input.game,state:input.state,...savedResult,guided:!exploring,createdAt:new Date().toISOString()},null,2));
      }
      json(res,200,result);
    }catch(error){
      if(!controller.signal.aborted)json(res,error.status||502,{error:error.message});
      else if(!res.writableEnded)res.end();
    }finally{
      busy=false;
      req.off('aborted',cancel);req.off('error',cancel);res.off('close',close);
    }
  };
}

export const handleApi=createApiHandler();
