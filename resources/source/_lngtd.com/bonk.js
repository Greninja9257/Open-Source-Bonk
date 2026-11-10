(function(){"use strict";const CDN="//lngtd.com/";const BUCKET_KEY="__lngtd_version_bonk";const thisScript=document.currentScript;const MAX_SESSION_MS=75*60*1000;let topDocument;topDocument=window.document;const forcedVersion=(function(){try{const search=(window.location!==window.parent.location)?window.parent.location.search:document.location.search;return new URLSearchParams(search).get("lngtd_version");}catch(e){return null;}})();const sc=[];sc.push({"script_path":"bonk/default.1791991808.js","build":"42","pct":100})
let memoryBucket=null;let resolvedPath=null;let bucketBuild=null;let bucketIssued=0;let bucketLoaded=false;function readBucket(){try{const v=window.sessionStorage.getItem(BUCKET_KEY);if(v)return v;}catch(e){}
try{const parts=document.cookie.split("; ");for(let i=0;i<parts.length;i++){const idx=parts[i].indexOf("=");if(idx>-1&&parts[i].slice(0,idx)===BUCKET_KEY){return decodeURIComponent(parts[i].slice(idx+1));}}}catch(e){}
return memoryBucket;}
function writeBucket(value){memoryBucket=value;try{window.sessionStorage.setItem(BUCKET_KEY,value);return;}catch(e){}
try{document.cookie=BUCKET_KEY+"="+encodeURIComponent(value)+
"; path=/; SameSite=Lax";}catch(e){}}
function loadBucket(){if(bucketLoaded)return;bucketLoaded=true;const raw=readBucket();if(!raw)return;const sep=raw.lastIndexOf("|");if(sep<0)return;const ts=parseInt(raw.slice(sep+1),10);if(!ts)return;bucketBuild=raw.slice(0,sep);bucketIssued=ts;}
function weightedPick(pool){let total=0;for(let i=0;i<pool.length;i++)total+=pool[i].pct;if(total<=0)return null;let r=Math.random()*total;for(let i=0;i<pool.length;i++){r-=pool[i].pct;if(r<0)return pool[i];}
return pool[pool.length-1];}
function pickScriptPath(){const now=Date.now();const withinWindow=bucketIssued>0&&(now-bucketIssued)<MAX_SESSION_MS;if(resolvedPath&&withinWindow)return resolvedPath;resolvedPath=null;const live=sc.filter(co=>co.pct>0);if(!live.length)return null;loadBucket();let chosen=null;if(bucketBuild&&bucketIssued>0&&(now-bucketIssued)<MAX_SESSION_MS){chosen=live.find(co=>co.build===bucketBuild)||null;}
if(!chosen){chosen=weightedPick(live);if(!chosen)return null;bucketBuild=chosen.build;bucketIssued=now;writeBucket(bucketBuild+"|"+bucketIssued);}
resolvedPath=chosen.script_path;return resolvedPath;}
function inject(path){const s=topDocument.createElement("script");s.type="text/javascript";s.src=CDN+path;s.async=true;topDocument.head.appendChild(s);return true;}
function startLoad(path){if(window.__lngtdLoaded)return;window.__lngtdLoaded=true;if(!inject(path)){window.__lngtdLoaded=false;}}
function requestLoad(path){startLoad(path);}
window.__lngtdReload=function(){const path=forcedVersion?`bonk/${forcedVersion}.js`:pickScriptPath();if(path)requestLoad(path);};function tryInject(){if(window.__lngtdLoaded)return;window.__lngtdReload();}
function start(){tryInject();}
start();}());