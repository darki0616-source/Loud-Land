'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const clients = new Map();
const players = new Map();
// A browser tab keeps one stable session key across refresh/reconnect attempts.
// The key is private: it is never included in public player snapshots/events.
const sessionPlayers = new Map();
const playerSessions = new Map();
const pageOwners = new Map();
function forgetSession(id){
  const key=playerSessions.get(id);
  if(key&&sessionPlayers.get(key)===id)sessionPlayers.delete(key);
  playerSessions.delete(id);pageOwners.delete(id);
}

const chatHistory=[];
let activeSlam=null,slamCooldownUntil=0;
let pendingSlamImpact=null; // Last launch roster; exactly one shared first-arrival dust burst
const SLAM_COUNTDOWN_MS=5000,SLAM_COOLDOWN_MS=15000;
// Circle pit and shoulder-to-shoulder figure-eight train: server-authoritative join roster.
const ROCK_COUNTDOWN_MS=5000,ROCK_COOLDOWN_MS=15000;
const ROCK_DURATIONS={circle:20000,train:36000,mosh:9000,row:20000,toast:6000};
let activeRock=null,rockRunningUntil=0;
const moshDustEvents=new Set();
// Each rock game has its own 15 second cooldown. The active performance remains exclusive.
const rockCooldowns={circle:0,train:0,mosh:0,row:0,toast:0};
function publicRock(){return activeRock?{id:activeRock.id,kind:activeRock.kind,x:activeRock.x,y:activeRock.y,endAt:activeRock.endAt,participants:[...activeRock.participants]}:null}
function rockUpdate(){broadcast({type:'rockplay',event:publicRock(),rockCooldowns:{...rockCooldowns},rockRunningUntil,serverNow:Date.now()})}
function rockMemberLeaves(id){if(activeRock?.participants.delete(id))rockUpdate()}

function publicSlam(){return activeSlam?{id:activeSlam.id,x:activeSlam.x,y:activeSlam.y,endAt:activeSlam.endAt,participants:[...activeSlam.participants]}:null}
function slamUpdate(){broadcast({type:'slam',slam:publicSlam(),cooldownUntil:slamCooldownUntil})}

// Quick replies remain available, and players may also send short free-text messages.
const MAX_CHAT_LENGTH=80;
let music = {id:'', title:'', startedAt:0, paused:true, position:0, changedBy:'', token:0, duration:0};
const queue=[]; const history=[]; let nextTrackToken=1;
function trackRef(t){return t&&{id:t.id,title:t.title,addedBy:t.addedBy}}
// Choosing a specific queued or previously played track requires a strict-majority vote.
// Advancing to the next queued track is an immediate action available to any visitor.
const SKIP_VOTE_MS=20000; // Voting lasts up to 20s; no cooldown between votes.
let skipVote=null, skipVoteCooldownUntil=0,skipVoteTimer=null;
function publicSkipVote(){if(!skipVote)return null;return {id:skipVote.id,proposer:skipVote.proposer,kind:skipVote.kind||'skip',target:skipVote.target||null,endAt:skipVote.endAt,yes:[...skipVote.yes].length,no:[...skipVote.no].length,required:Math.floor(skipVote.eligible.size/2)+1,eligible:[...skipVote.eligible],voted:[...new Set([...skipVote.yes,...skipVote.no])]}}
function broadcastSkipVote(){broadcast({type:'skip-vote',vote:publicSkipVote(),cooldownUntil:skipVoteCooldownUntil,serverNow:Date.now()})}
function finishSkipVote(passed,reason){if(!skipVote)return;const old=skipVote;skipVote=null;clearTimeout(skipVoteTimer);skipVoteTimer=null;
 broadcast({type:'skip-vote-result',passed,reason,proposer:old.proposer,yes:old.yes.size,no:old.no.size,required:Math.floor(old.eligible.size/2)+1});
 if(passed&&music.id&&music.token===old.trackToken){
  if(old.kind==='select'&&old.target){
   const idx=old.target.source==='history'?history.findLastIndex(x=>x.id===old.target.id):queue.findIndex(x=>x.id===old.target.id);
   if(idx!==-1){const chosen=old.target.source==='history'?history[idx]:queue.splice(idx,1)[0];
     if(old.target.source==='history')queue.unshift({...chosen});else queue.unshift(chosen);
     nextTrack();
   }else broadcast({type:'music-vote-error',message:'선택한 곡이 목록에서 사라졌습니다.'});
  }else nextTrack();
 }broadcastSkipVote();}
function checkSkipVote(){if(!skipVote)return;const required=Math.floor(skipVote.eligible.size/2)+1;
 if(skipVote.yes.size>=required)return finishSkipVote(true,'majority');
 if(skipVote.no.size>=required||skipVote.yes.size+(skipVote.eligible.size-skipVote.yes.size-skipVote.no.size)<required)return finishSkipVote(false,'rejected');
 if(Date.now()>=skipVote.endAt)return finishSkipVote(false,'timeout');broadcastSkipVote();}
function voterLeaves(id){if(!skipVote||!skipVote.eligible.has(id))return;skipVote.eligible.delete(id);skipVote.yes.delete(id);skipVote.no.delete(id);if(skipVote.eligible.size===0)finishSkipVote(false,'no-voters');else checkSkipVote()}

const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const STATE_PATH=path.join(DATA_DIR,'festival-state.json');
let saveTimeout=null;
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SECRET_KEY||'';
const useSupabase=Boolean(SB_URL&&SB_KEY);
let restored=false;
let saveChain=Promise.resolve();
function stateData(){return {version:3,music,queue:[...queue],history:[...history],nextTrackToken,savedAt:Date.now()}}
function applySaved(d){
 if(!d||typeof d!=='object')return;
 queue.length=0;history.length=0;
 if(Array.isArray(d.history))history.push(...d.history.filter(x=>x&&/^[\w-]{11}$/.test(x.id||'')).slice(-50));
 if(Array.isArray(d.queue))queue.push(...d.queue.filter(x=>x&&/^[\w-]{11}$/.test(x.id||'')).slice(0,50));
 if(d.music&&/^[\w-]{11}$/.test(d.music.id||'')){
  music={...music,...d.music};
  if(!music.paused)music.position=Math.max(0,(Date.now()-Number(music.startedAt||Date.now()))/1000);
  music.paused=true; // Never consume the queue while nobody is present.
 }
 nextTrackToken=Math.max(1,Number(d.nextTrackToken)||1,Number(music.token||0)+1);
}
function localSave(d){try{fs.mkdirSync(DATA_DIR,{recursive:true});const tmp=STATE_PATH+'.tmp';fs.writeFileSync(tmp,JSON.stringify(d));fs.renameSync(tmp,STATE_PATH)}catch(err){console.warn('Local playlist backup failed:',err.message)}}
async function supabaseRequest(method,body){
 const url=SB_URL+'/rest/v1/music_state'+(method==='GET'?'?id=eq.1&select=state':'?id=eq.1');
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8500);
 try{const res=await fetch(url,{method,headers:{apikey:SB_KEY,'Content-Type':'application/json',...(method==='PATCH'?{Prefer:'return=minimal'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:ctl.signal});if(!res.ok)throw Error('Supabase HTTP '+res.status+' '+(await res.text()).slice(0,150));return method==='GET'?await res.json():null}
 finally{clearTimeout(timer)}
}
async function restorePlaylist(){
 if(useSupabase){
  try{const rows=await supabaseRequest('GET');if(rows?.[0]?.state){applySaved(rows[0].state);console.log('Supabase playlist restored')}else console.warn('Supabase music_state row id=1 missing');}
  catch(err){console.error('Supabase restore failed:',err.message);throw err}
 }else{
  try{applySaved(JSON.parse(fs.readFileSync(STATE_PATH,'utf8')));console.log('Local playlist restored (non-durable)')}catch(err){if(err.code!=='ENOENT')console.warn('Local restore failed:',err.message)}
 }
 restored=true;
}
function saveNow(){
 if(!restored)return Promise.resolve();
 const data=stateData();localSave(data);
 if(!useSupabase)return Promise.resolve();
 saveChain=saveChain.catch(()=>{}).then(async()=>{try{await supabaseRequest('PATCH',{state:data,updated_at:new Date().toISOString()})}catch(err){console.error('Supabase save failed:',err.message)}});
 return saveChain;
}
function scheduleSave(){clearTimeout(saveTimeout);saveTimeout=setTimeout(()=>{void saveNow()},120);saveTimeout.unref()}
function pauseForEmpty(){if(players.size===0&&music.id&&!music.paused){music.position=Math.max(0,(Date.now()-music.startedAt)/1000);music.paused=true;scheduleSave()}}
function resumeForFirst(){if(players.size===1&&music.id&&music.paused){music.startedAt=Date.now()-Math.max(0,music.position||0)*1000;music.paused=false;scheduleSave()}}
process.on('SIGTERM',()=>{pauseForEmpty();clearTimeout(saveTimeout);Promise.race([saveNow(),new Promise(r=>setTimeout(r,2500))]).finally(()=>server.close(()=>process.exit(0)))});

const musicState=()=>({music,queue:queue.map(trackRef),history:history.map(trackRef),serverNow:Date.now()});
function nextTrack(){if(skipVote)finishSkipVote(false,'track-changed');if(music.id){history.push({id:music.id,title:music.title,addedBy:music.changedBy});if(history.length>50)history.shift()}const entry=queue.shift();if(entry){music={id:entry.id,title:entry.title,startedAt:Date.now(),paused:false,position:0,changedBy:entry.addedBy,token:nextTrackToken++,duration:0}}else{music={id:'',title:'',startedAt:0,paused:true,position:0,changedBy:'',token:nextTrackToken++,duration:0}}broadcast({type:'music',...musicState()});scheduleSave()}
// End-of-track fallback based on reported duration, independent of any one viewer.
setInterval(()=>{if(music.id&&!music.paused&&music.duration>0&&(Date.now()-music.startedAt)/1000>music.duration+1)nextTrack()},1500).unref();
const colors = ['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee','#262631','#373943','#a5e1f9','#f1d9a7'];
const patterns=['solid','stripe','wide-stripe'];
const sashes=['none','black','purple','red','green','black-check','red-check'];
const hats=['none'];
const hairStyles=['short','bob','long','wavy','ponytail','mohawk','spiky','buzz','curly'];
const hairColors=['#25222a','#4b3932','#85533e','#edc46b','#d34c53','#4d86d5','#9965c9','#e89bc2'];
function apparel(d,fallback={}){return {
 pattern:patterns.includes(d.pattern)?d.pattern:(fallback.pattern||'solid'),
 sash:sashes.includes(d.sash)?d.sash:(fallback.sash||'none'),
 hat:'none',
 hairStyle:hairStyles.includes(d.hairStyle)?d.hairStyle:(fallback.hairStyle|| (d.gender==='female'?'bob':'short')),
 hairColor:hairColors.includes(d.hairColor)?d.hairColor:(fallback.hairColor||'#4b3932')
}}
const clean = (s,max=30)=>String(s||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,max);
const send=(res,obj)=>{res.write('data: '+JSON.stringify(obj)+'\n\n');};
const broadcast=obj=>{for(const res of clients.values()) {try {send(res,obj);}catch{}}};
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj));};
const snapshot=()=>({type:'snapshot',players:[...players.values()],chat:chatHistory,...musicState(),skipVote:publicSkipVote(),skipVoteCooldownUntil,slam:publicSlam(),slamCooldownUntil,rockPlay:publicRock(),rockCooldowns:{...rockCooldowns},rockRunningUntil,count:players.size});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
function cleanup(){const now=Date.now();for(const [id,p] of players)if(now-p.seen>180000){players.delete(id);forgetSession(id);voterLeaves(id);if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();const r=clients.get(id);if(r){r.end();clients.delete(id)}broadcast({type:'leave',id,count:players.size})}}
setInterval(cleanup,7000).unref();
function videoId(input){const v=String(input||'').trim();if(/^[\w-]{11}$/.test(v))return v;try{const u=new URL(v);const host=u.hostname.replace(/^www\./,'');if(host==='youtu.be')return /^[\w-]{11}$/.test(u.pathname.slice(1))?u.pathname.slice(1):null;if(['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(host)){const id=u.searchParams.get('v')||u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null}}catch{}return null}
// Read the actual public YouTube title server-side; never trust a user-submitted title.
const videoTitleCache = new Map();
async function getVideoTitle(id){
  if(videoTitleCache.has(id))return videoTitleCache.get(id);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4500);
  try{
    const response=await fetch('https://www.youtube.com/oembed?url='+encodeURIComponent('https://www.youtube.com/watch?v='+id)+'&format=json', {signal:controller.signal,headers:{'user-agent':'ONEseason/1.0'}});
    if(!response.ok)throw Error('metadata unavailable');
    const data=await response.json();
    const title=clean(data.title,120);
    if(!title)throw Error('empty title');
    videoTitleCache.set(id,title);if(videoTitleCache.size>300)videoTitleCache.delete(videoTitleCache.keys().next().value);
    return title;
  }catch{return '제목을 불러올 수 없는 영상';}
  finally{clearTimeout(timer)}
}
async function receive(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4000)throw new Error('too large')}return JSON.parse(raw||'{}')}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(!restored&&url.pathname.startsWith('/api/'))return json(res,503,{error:'음악 저장소 연결 확인 중입니다. 잠시 뒤 다시 시도해주세요.'});
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
        const sessionKey=typeof d.sessionKey==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.sessionKey)?d.sessionKey:null;
        const pageId=typeof d.pageId==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.pageId)?d.pageId:null;
        // Repeated joins from reconnect/parallel timers must reuse the SAME avatar.
        if(sessionKey){
          const existingId=sessionPlayers.get(sessionKey);
          const existing=players.get(existingId);
          if(existing){
            existing.seen=Date.now();
            if(pageId)pageOwners.set(existingId,pageId);
            return json(res,200,{id:existingId,reused:true,...snapshot()});
          }
          if(existingId)sessionPlayers.delete(sessionKey);
        }
        const id=crypto.randomUUID(),p={id,name:clean(d.name,18)||'ROCKER',color:colors.includes(d.color)?d.color:colors[0],...apparel(d),gender:d.gender==='female'?'female':'male',x:clamp(190+Math.random()*880,20,1380),y:clamp(390+Math.random()*420,220,1100),facing:0,action:'idle',pose:'stand',seen:Date.now()};
        players.set(id,p);
        if(sessionKey){sessionPlayers.set(sessionKey,id);playerSessions.set(id,sessionKey)}
        if(pageId)pageOwners.set(id,pageId);
        resumeForFirst();broadcast({type:'join',player:p,count:players.size});return json(res,200,{id,reused:false,...snapshot()});
      }
      const id=clean(d.id,80),p=players.get(id);if(!p)return json(res,401,{error:'Session expired. Please rejoin.'});p.seen=Date.now();
      if(url.pathname==='/api/heartbeat'){return json(res,200,{ok:true})}
      if(url.pathname==='/api/profile'){p.name=clean(d.name,18)||'ROCKER';p.color=colors.includes(d.color)?d.color:p.color;p.gender=d.gender==='female'?'female':'male';Object.assign(p,apparel(d,p));broadcast({type:'profile',player:p});return json(res,200,{ok:true,player:p})}
      if(url.pathname==='/api/move'){
        const previousAction=p.action;
        p.x=clamp(d.x,20,1380);p.y=clamp(d.y,220,1100);p.facing=clamp(d.facing,-Math.PI,Math.PI);
        p.pose=['stand','sit','lie'].includes(d.pose)?d.pose:'stand';
        p.action=['idle','walk','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','windmill','skanking','cheer','smoke','mosh-charge','slam-charge','slam-retreat','slam-celebrate','circle-run','train-run','row-paddle','toast-clink'].includes(d.action)?d.action:'idle';
        broadcast({type:'move',player:p});
        if(p.action==='cheer'&&previousAction!=='cheer')broadcast({type:'cheer',playerId:id});
        // Fire once, when the FIRST participant changes from charging to retreating.
        // This is server-broadcast, so spectators see the same dust burst.
        if(pendingSlamImpact && !pendingSlamImpact.fired && pendingSlamImpact.participants.has(id)
           && previousAction==='slam-charge' && p.action==='slam-retreat'){
          pendingSlamImpact.fired=true;
          broadcast({type:'slam-impact',slamId:pendingSlamImpact.id,x:p.x,y:p.y});
        }
        return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/chat'){
        const message=clean(d.message,MAX_CHAT_LENGTH).replace(/\s+/g,' ').trim();
        if(!message)return json(res,400,{error:'채팅 내용을 입력해 주세요.'});
        if(p.lastChat&&Date.now()-p.lastChat<900)return json(res,429,{error:'잠시 후 다시 보내주세요.'});
        p.lastChat=Date.now();
        const entry={id:crypto.randomUUID(),playerId:p.id,name:p.name,message,at:Date.now()};
        chatHistory.push(entry);if(chatHistory.length>35)chatHistory.shift();
        broadcast({type:'chat',entry});return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/rockplay'){
        if(d.command==='impact'){
          // Clients report the two impacts. A shared dedupe key gives all spectators one burst.
          const eventId=clean(d.eventId,80),phase=Number(d.phase);
          if(!/^[a-f0-9-]{36}$/.test(eventId)||![1,2].includes(phase)||!Number.isFinite(Number(d.x))||!Number.isFinite(Number(d.y)))return json(res,400,{error:'잘못된 먼지 효과 요청'});
          const key=eventId+':'+phase;
          if(!moshDustEvents.has(key)){
           moshDustEvents.add(key);setTimeout(()=>moshDustEvents.delete(key),90000).unref();
           broadcast({type:'slam-impact',slamId:eventId,x:clamp(d.x,20,1380),y:clamp(d.y,220,1100)});
          }
          return json(res,200,{ok:true});
        }
        if(d.command==='start'){
          const now=Date.now(),kind=String(d.kind||'');
          if(!Object.hasOwn(ROCK_DURATIONS,kind))return json(res,400,{error:'지원하지 않는 락놀이입니다.'});
          if(activeSlam||activeRock||now<rockRunningUntil)return json(res,409,{error:'다른 락놀이가 진행 중이에요.'});
          if(now<rockCooldowns[kind])return json(res,429,{error:(kind==='circle'?'써클핏':kind==='mosh'?'모싱':kind==='row'?'노젓기':kind==='toast'?'짠하기':'기차놀이')+' 쿨타임이 남아 있어요.'});
          const x=Number(d.x),y=Number(d.y);
          // Reserve room for a wide loop inside the walkable zone (not the stage or sea).
          if(!Number.isFinite(x)||!Number.isFinite(y)||(kind==='mosh'||kind==='toast'?(x<20||x>1380||y<250||y>880):(x<235||x>1165||y<370||y>795)))return json(res,400,{error:kind==='mosh'?'페스티벌 바닥을 선택해 주세요.':'넓은 잔디 광장 안쪽의 바닥을 선택해 주세요.'});
          const eventId=crypto.randomUUID(),duration=ROCK_DURATIONS[kind];
          const current={id:eventId,kind,x:Math.round(x),y:Math.round(y),endAt:now+ROCK_COUNTDOWN_MS,participants:new Set([id])};
          activeRock=current;
          rockRunningUntil=current.endAt+duration;
          rockCooldowns[kind]=rockRunningUntil+ROCK_COOLDOWN_MS;
          setTimeout(()=>{
            if(activeRock!==current)return;
            const participants=[...current.participants].filter(pid=>players.has(pid));
            broadcast({type:'rockplay-go',id:current.id,kind:current.kind,x:current.x,y:current.y,startAt:current.endAt,duration,participants,serverNow:Date.now()});
            if(current.kind==='toast'){setTimeout(()=>broadcast({type:'toast-spark',eventId:current.id,x:current.x,y:current.y}),3000).unref()}
            activeRock=null;rockUpdate();
          },ROCK_COUNTDOWN_MS);
          rockUpdate();
        }else if(d.command==='join'){
          if(!activeRock||Date.now()>=activeRock.endAt||d.eventId!==activeRock.id)return json(res,409,{error:'이미 끝난 락놀이예요.'});
          activeRock.participants.add(id);rockUpdate();
        }else return json(res,400,{error:'잘못된 요청입니다.'});
        return json(res,200,{event:publicRock(),rockCooldowns:{...rockCooldowns},rockRunningUntil,serverNow:Date.now()});
      }
      if(url.pathname==='/api/slam'){
        if(d.command==='start'){
          if(activeSlam||activeRock||Date.now()<rockRunningUntil)return json(res,409,{error:'다른 락놀이가 진행 중이에요.'});
          const now=Date.now();if(now<slamCooldownUntil)return json(res,429,{error:'슬램 쿨타임이 아직 남아 있어요.'});
          const x=Number(d.x),y=Number(d.y);
          // Slam can only take place on the accessible festival floor, not in the sea/stage.
          if(!Number.isFinite(x)||!Number.isFinite(y)||x<20||x>1380||y<250||y>880)return json(res,400,{error:'슬램 위치는 페스티벌 바닥을 선택해 주세요.'});
          const eventId=crypto.randomUUID();
          activeSlam={id:eventId,x:Math.round(x),y:Math.round(y),endAt:now+SLAM_COUNTDOWN_MS,participants:new Set([id])};
          slamCooldownUntil=now+SLAM_COOLDOWN_MS;
          const current=activeSlam;
          setTimeout(()=>{
            if(activeSlam!==current)return;
            const participants=[...current.participants].filter(pid=>players.has(pid));
            pendingSlamImpact={id:eventId,participants:new Set(participants),fired:false};
            broadcast({type:'slam-go',id:eventId,x:current.x,y:current.y,participants});
            activeSlam=null;slamUpdate();
          },SLAM_COUNTDOWN_MS);
          slamUpdate();
        }else if(d.command==='join'){
          if(!activeSlam||Date.now()>=activeSlam.endAt||d.slamId!==activeSlam.id)return json(res,409,{error:'이미 끝난 슬램이에요.'});
          activeSlam.participants.add(id);slamUpdate();
        }else return json(res,400,{error:'Invalid slam command'});
        return json(res,200,{slam:publicSlam(),cooldownUntil:slamCooldownUntil,serverNow:Date.now()});
      }
      if(url.pathname==='/api/music'){
        if(d.command==='enqueue'||d.command==='play'){
          const vid=videoId(d.url||d.videoId);if(!vid)return json(res,400,{error:'유효한 유튜브 링크를 입력하세요.'});
          if(queue.length>=50)return json(res,400,{error:'대기열은 최대 50곡입니다.'});
          const entry={id:vid,title:await getVideoTitle(vid),addedBy:p.name};
          // Always append to the shared queue; automatically start when nothing is playing.
          queue.push(entry);scheduleSave();if(!music.id)nextTrack();else broadcast({type:'music',...musicState()});
          broadcast({type:'music-booked',name:p.name,title:entry.title,videoId:entry.id,at:Date.now()});
        } else if(d.command==='duration'&&music.id&&Number(d.token)===music.token){
          const duration=Number(d.duration);if(Number.isFinite(duration)&&duration>=2&&duration<=86400){music.duration=duration;scheduleSave();if(!music.paused&&(Date.now()-music.startedAt)/1000>duration+1)nextTrack()}
        }
        else if(d.command==='ended'&&music.id&&Number(d.token)===music.token){
          // A viewer may report ending a little early due to clock drift; don't skip prematurely.
          const elapsed=music.paused?music.position:(Date.now()-music.startedAt)/1000;
          if(!music.duration||elapsed>=music.duration-3)nextTrack();
        }
        else if(d.command==='skip'){
          if(!music.id)return json(res,409,{error:'재생 중인 곡이 없습니다.'});
          nextTrack();
          broadcast({type:'music-control',name:p.name,command:'skip'});
        }
        else if(d.command==='vote-select'){
          if(!music.id)return json(res,409,{error:'재생 중인 곡이 없습니다.'});
          if(skipVote)return json(res,409,{error:'이미 음악 투표가 진행 중입니다.'});
          let target=null;
          {
            const source=String(d.source||'');const index=Number(d.index);
            const list=source==='history'?history:source==='queue'?queue:null;
            if(!list||!Number.isInteger(index)||index<0||index>=list.length)return json(res,400,{error:'선택한 곡을 찾을 수 없습니다.'});
            const item=list[index];if(item.id!==d.videoId)return json(res,409,{error:'곡 목록이 변경됐습니다. 다시 선택해 주세요.'});
            target={id:item.id,title:item.title,source,index};
          }
          const eligible=new Set(players.keys());
          skipVote={id:crypto.randomUUID(),proposer:p.name,kind:target?'select':'skip',target,eligible,yes:new Set([id]),no:new Set(),endAt:Date.now()+SKIP_VOTE_MS,trackToken:music.token};
          skipVoteCooldownUntil=0;
          broadcastSkipVote();
          skipVoteTimer=setTimeout(()=>{if(skipVote)finishSkipVote(false,'timeout')},SKIP_VOTE_MS);
          if(skipVote.eligible.size===1)checkSkipVote();
        }
        else if(d.command==='vote-cast'){
          if(!skipVote||d.voteId!==skipVote.id||Date.now()>=skipVote.endAt)return json(res,409,{error:'진행 중인 투표가 아닙니다.'});
          if(!skipVote.eligible.has(id))return json(res,403,{error:'투표 시작 후 입장한 분은 다음 투표부터 참여할 수 있습니다.'});
          if(skipVote.yes.has(id)||skipVote.no.has(id))return json(res,409,{error:'이미 투표했습니다.'});
          if(d.choice!=='yes'&&d.choice!=='no')return json(res,400,{error:'찬성 또는 반대를 선택해주세요.'});
          skipVote[d.choice].add(id);checkSkipVote();
        }
        else return json(res,400,{error:'Invalid command'});
        return json(res,200,{ok:true,...musicState()});
      }
      if(url.pathname==='/api/leave'){
        // A late pagehide beacon from a previous page must not kick the newer page.
        const owner=pageOwners.get(id);
        if(owner&&d.pageId!==owner)return json(res,200,{ok:true,ignored:'stale-page'});
        players.delete(id);forgetSession(id);voterLeaves(id);
        if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();
        clients.get(id)?.end();clients.delete(id);broadcast({type:'leave',id,count:players.size});return json(res,200,{ok:true})
      }
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,400,{error:e.message})}
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Invalid path'})}
  const f=path.resolve(PUBLIC,'.'+(pathname==='/'?'/index.html':pathname));if(!f.startsWith(PUBLIC+path.sep))return json(res,403,{error:'Forbidden'});
  fs.stat(f,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});fs.createReadStream(f).pipe(res)})
});
restorePlaylist().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`ONEseason running at http://localhost:${PORT} | storage: ${useSupabase?'Supabase':'local only'}`))).catch(err=>{console.error('Startup stopped to prevent playlist data loss:',err.message);process.exitCode=1});
