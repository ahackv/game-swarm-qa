import {API_PATHS,handleApi} from '../api-handler.mjs';

export default async function handler(req,res){
  const url=new URL(req.url,'http://localhost');
  const routed=url.searchParams.get('endpoint');
  const pathname=routed?'/api/'+routed:url.pathname;
  if(!API_PATHS.includes(pathname)){
    res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Not found.'}));return;
  }
  return handleApi(req,res,pathname);
}
