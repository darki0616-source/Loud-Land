'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const clients = new Map();
const players = new Map();
let music = {id:'', title:'', startedAt:0, paused:true, position:0, changedBy:'', token:0, duration:0};
const queue=[]; let nextTrackToken=1;
const musicState=()=>({music,queue:queue.map(({id,title,addedBy})=>({id,title,addedBy})),serverNow:Date.now()});
function nextTrack(){const entry=queue.shift();if(entry){music={id:entry.id,title:entry.title,startedAt:Date.now(),paused:false,position:0,changedBy:entry.addedBy,token:nextTrackToken++,duration:0}}else{music={id:'',title:'',startedAt:0,paused:true,position:0,changedBy:'',token:nextTrackToken++,duration:0}}broadcast({type:'music',...musicState()})}
// End-of-track fallback based on reported duration, independent of any one viewer.
setInterval(()=>{if(music.id&&!music.paused&&music.duration>0&&(Date.now()-music.startedAt)/1000>music.duration+1)nextTrack()},1500).unref();
const colors = ['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee'];
const clean = (s,max=30)=>String(s||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,max);
const send=(res,obj)=>{res.write('data: '+JSON.stringify(obj)+'\n\n');};
const broadcast=obj=>{for(const res of clients.values()) {try {send(res,obj);}catch{}}};
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj));};
const snapshot=()=>({type:'snapshot',players:[...players.values()],...musicState(),count:players.size});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
function cleanup(){const now=Date.now();for(const [id,p] of players)if(now-p.seen>35000){players.delete(id);const r=clients.get(id);if(r){r.end();clients.delete(id)}broadcast({type:'leave',id,count:players.size})}}
setInterval(cleanup,7000).unref();
function videoId(input){const v=String(input||'').trim();if(/^[\w-]{11}$/.test(v))return v;try{const u=new URL(v);const host=u.hostname.replace(/^www\./,'');if(host==='youtu.be')return /^[\w-]{11}$/.test(u.pathname.slice(1))?u.pathname.slice(1):null;if(['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(host)){const id=u.searchParams.get('v')||u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null}}catch{}return null}
async function receive(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4000)throw new Error('too large')}return JSON.parse(raw||'{}')}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'&&req.method==='GET'){
    const id=clean(url.searchParams.get('id'),80);
    if(!players.has(id))return json(res,404,{error:'Join first'});
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    clients.get(id)?.end();clients.set(id,res);send(res,snapshot());
    const heartbeat=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},15000);
    req.on('close',()=>{clearInterval(heartbeat);if(clients.get(id)===res)clients.delete(id)});return;
  }
  if(url.pathname.startsWith('/api/')&&req.method==='POST'){
    try{
      const d=await receive(req);
      if(url.pathname==='/api/join'){
        const id=crypto.randomUUID(),p={id,name:clean(d.name,18)||'ROCKER',color:colors.includes(d.color)?d.color:colors[0],x:clamp(200+Math.random()*800,35,1165),y:clamp(400+Math.random()*175,295,738),facing:0,action:'idle',seen:Date.now()};
        players.set(id,p);broadcast({type:'join',player:p,count:players.size});return json(res,200,{id,...snapshot()});
      }
      const id=clean(d.id,80),p=players.get(id);if(!p)return json(res,401,{error:'Session expired. Please rejoin.'});p.seen=Date.now();
      if(url.pathname==='/api/move'){
        p.x=clamp(d.x,28,1172);p.y=clamp(d.y,285,747);p.facing=clamp(d.facing,-Math.PI,Math.PI);
        p.action=['idle','walk','peace','jump','run','wave','bow','sit','lie'].includes(d.action)?d.action:'idle';
        broadcast({type:'move',player:p});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/music'){
        if(d.command==='enqueue'||d.command==='play'){
          const vid=videoId(d.url||d.videoId);if(!vid)return json(res,400,{error:'유효한 유튜브 링크를 입력하세요.'});
          if(queue.length>=50)return json(res,400,{error:'대기열은 최대 50곡입니다.'});
          const entry={id:vid,title:clean(d.title,90)||'YOUTUBE '+vid,addedBy:p.name};
          // Always append to the shared queue; automatically start when nothing is playing.
          queue.push(entry);if(!music.id)nextTrack();else broadcast({type:'music',...musicState()});
        } else if(d.command==='pause'&&!music.paused&&music.id){music.position=Math.max(0,(Date.now()-music.startedAt)/1000);music.paused=true;broadcast({type:'music',...musicState()})}
        else if(d.command==='resume'&&music.paused&&music.id){music.startedAt=Date.now()-music.position*1000;music.paused=false;broadcast({type:'music',...musicState()})}
        else if(d.command==='duration'&&music.id&&Number(d.token)===music.token){
          const duration=Number(d.duration);if(Number.isFinite(duration)&&duration>=2&&duration<=86400){music.duration=duration;if(!music.paused&&(Date.now()-music.startedAt)/1000>duration+1)nextTrack()}
        }
        else if(d.command==='ended'&&music.id&&Number(d.token)===music.token){
          // A viewer may report ending a little early due to clock drift; don't skip prematurely.
          const elapsed=music.paused?music.position:(Date.now()-music.startedAt)/1000;
          if(!music.duration||elapsed>=music.duration-3)nextTrack();
        }
        else if(d.command==='skip'&&music.id){nextTrack()}
        else return json(res,400,{error:'Invalid command'});
        return json(res,200,{ok:true,...musicState()});
      }
      if(url.pathname==='/api/leave'){players.delete(id);clients.get(id)?.end();clients.delete(id);broadcast({type:'leave',id,count:players.size});return json(res,200,{ok:true})}
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,400,{error:e.message})}
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Invalid path'})}
  const f=path.resolve(PUBLIC,'.'+(pathname==='/'?'/index.html':pathname));if(!f.startsWith(PUBLIC+path.sep))return json(res,403,{error:'Forbidden'});
  fs.stat(f,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});fs.createReadStream(f).pipe(res)})
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Rock festival running at http://localhost:${PORT}`));
