// Prompt/response details are deliberately separate from saved run history.
// The only images retained are screenshots already submitted for visual review.
export function formatLatency(ms){
  if(!Number.isFinite(ms)||ms<0)return 'Latency unavailable';
  return ms<1000?Math.round(ms)+' ms':(ms/1000).toFixed(2)+' s';
}

export function createDecisionInspector({dialog,content,title,closeButton,maxEntries=20,maxBytes=8*1024*1024}){
  const records=new Map();
  let bytes=0,selected=null;

  function close(){
    dialog.close();content.replaceChildren();selected=null;
  }
  function remove(id){
    const record=records.get(id);if(!record)return;
    if(selected===id)close();
    if(record.imageUrl)URL.revokeObjectURL(record.imageUrl);
    bytes-=record.bytes;records.delete(id);
  }
  function clear(){close();for(const id of records.keys())remove(id);}
  function add(id,{calls,action,image,decisionMode='hybrid',engineWait=false}){
    remove(id);
    const record={calls,action,decisionMode,engineWait,bytes:new TextEncoder().encode(JSON.stringify({calls,action})).length};
    if(image&&calls.some(call=>call.kind==='visual')){
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if(match){
        const binary=atob(match[2]),buffer=Uint8Array.from(binary,char=>char.charCodeAt(0));
        const blob=new Blob([buffer],{type:match[1]});
        record.imageUrl=URL.createObjectURL(blob);record.bytes+=blob.size;
      }
    }
    records.set(id,record);bytes+=record.bytes;
    while(records.size>maxEntries||bytes>maxBytes)remove(records.keys().next().value);
  }
  function element(tag,className,text){
    const node=document.createElement(tag);if(className)node.className=className;
    if(text!==undefined)node.textContent=text;return node;
  }
  function jsonBlock(label,value){
    const block=element('div');block.append(element('h4','',label),element('pre','',JSON.stringify(value,null,2)));return block;
  }
  function open(id){
    const record=records.get(id);if(!record)return;
    content.replaceChildren();selected=id;title.textContent='Move '+String(id).padStart(2,'0');
    content.append(element('p','',record.action.reason));
    if(!record.calls.length){
      const section=element('section','inspection-call');
      section.append(element('h3','',record.engineWait?'Native game transition':'Details unavailable'),element('p','inspection-meta',record.engineWait?'No model call or screenshot. The local clock advances the game animation.':'This move did not return model inspection details.'),jsonBlock('GAME INPUT',record.action));content.append(section);
    }
    for(const call of record.calls){
      const section=element('details','inspection-call'),summary=element('summary');
      section.open=call.kind==='visual'||record.calls.length===1;
      summary.append(element('h3','',call.kind==='visual'?(record.decisionMode==='luna'?'Luna · decision':'Luna · review'):'Jev · movement'));section.append(summary);
      section.append(element('p','inspection-meta',(call.kind==='visual'?'Screenshot sent with this request · captured before the move':'No screenshot sent · game observations only')+' · '+formatLatency(call.latencyMs)));
      if(call.kind==='visual'&&record.imageUrl){
        const figure=element('figure','inspection-image'),img=element('img');
        img.src=record.imageUrl;img.alt='Exact game screenshot submitted for move '+id;
        figure.append(element('figcaption','','SCREENSHOT SENT TO THE MODEL'),img);section.append(figure);
      }
      const grid=element('div','inspection-grid');grid.append(jsonBlock('PROMPT / REQUEST',call.request),jsonBlock('STRUCTURED RESPONSE',call.response));section.append(grid);content.append(section);
    }
    if(!dialog.open)dialog.showModal();
  }
  closeButton.addEventListener('click',close);
  dialog.addEventListener('close',()=>{content.replaceChildren();selected=null;});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  return {add,open,clear,has:id=>records.has(id)};
}
