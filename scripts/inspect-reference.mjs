// Inspect a single rendering call in our reference browser. Always resume it.
import { writeFile } from 'node:fs/promises';
const pages = await (await fetch('http://127.0.0.1:9339/json/list')).json();
const page = pages.find(p=>p.type==='page'&&p.url.includes('bonk.io'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let sequence=0;const pending=new Map();let paused;
const pause=new Promise(r=>paused=r);
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Debugger.paused')paused(m.params);});
const call=(method,params={})=>new Promise(r=>{const id=++sequence;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
try {
 await call('Page.bringToFront');await call('Debugger.enable');
 const fn=await call('Runtime.evaluate',{expression:'document.getElementById("maingameframe").contentWindow.PIXI.Renderer.prototype.render'});
 await call('Debugger.setBreakpointOnFunctionCall',{objectId:fn.result.result.objectId});
 const stopped=await Promise.race([pause,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No rendering call')),10000))]);
 const records=[];
 for(const frame of stopped.callFrames.slice(0,12)) {
  const r=await call('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'Array.from(arguments).map(a=>a&&typeof a==="object"?{keys:Object.keys(a).slice(0,45),state:a.physics&&a.discs?a:null}:typeof a)',returnByValue:true});
  records.push({function:frame.functionName,result:r.result?.result?.value});
 }
 await writeFile('comparisons/reference-render-inspection.json',JSON.stringify(records,null,2));
 console.log(records.map(r=>({function:r.function,result:r.result?.map(a=>a?.state?{state:true,discs:a.state.discs.length,bodies:a.state.physics.bodies.length}:a)})));
} finally {await call('Debugger.resume');await call('Debugger.disable');ws.close();}
