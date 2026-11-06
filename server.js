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
const ROCK_DURATIONS={circle:20000,train:36000,mosh:4500,row:20000,toast:6000,surf:14000};
let activeRock=null,rockRunningUntil=0;
let activeSurfRide=null; // Active 10s crowd-surf choreography; included in snapshots for reconnects.
const moshDustEvents=new Set();
// Each rock game has its own 15 second cooldown. The active performance remains exclusive.
const rockCooldowns={circle:0,train:0,mosh:0,row:0,toast:0,surf:0};
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
// Total online time per stable browser identity, persisted alongside the playlist.
const badgeStats=new Map();
// No account required: coins belong to the existing persistent badge identity.
// All purchases and equipment are server-validated. Guests without the stable
// badge identity cannot spend points; client-provided balances are ignored.
const shopStats=new Map();
const PUNK_ITEMS={
 'tee-skull':{name:'스컬 프린트 티셔츠',slot:'shirt',cost:30},
 'tee-lightning':{name:'번개 펑크 티셔츠',slot:'shirt',cost:45},
 'tee-anarchy':{name:'언더그라운드 티셔츠',slot:'shirt',cost:65},
 'horns':{name:'악마뿔 머리띠',slot:'head',cost:80},
 'spike-band':{name:'스파이크 머리띠',slot:'head',cost:110},
 'chain':{name:'실버 체인 목걸이',slot:'neck',cost:55},
 'choker':{name:'스파이크 초커',slot:'neck',cost:95},
 'bat-glasses':{name:'배트 선글라스',slot:'eyes',cost:90},
 'fallen-wings':{name:'타락천사 날개',slot:'back',cost:300},
 'devil-tail':{name:'악마 꼬리',slot:'tail',cost:150},
 'headset':{name:'락 페스티벌 헤드셋',slot:'ears',cost:170},
 'flame-glasses':{name:'불꽃 선글라스',slot:'eyes',cost:110},
 'bat-wing-band':{name:'박쥐날개 머리띠',slot:'head',cost:140},
 'heart-band':{name:'하트 머리띠',slot:'head',cost:100},
 'round-glasses':{name:'둥근 안경',slot:'eyes',cost:80},
 'back-guitar':{name:'등에 메는 기타',slot:'back',cost:220},
 'angel-wings':{name:'천사 날개',slot:'back',cost:280}
};
const SHOP_SLOTS=['shirt','head','neck','eyes','back','tail','ears'];
const customMd=new Map();
const MD_ADMIN_KEY=process.env.MD_ADMIN_KEY||'';
function adminAuthorized(req){
 const provided=String(req.headers['x-md-admin-key']||'');
 const a=Buffer.from(provided),b=Buffer.from(MD_ADMIN_KEY);
 return Boolean(MD_ADMIN_KEY&&a.length===b.length&&crypto.timingSafeEqual(a,b));
}
function publicMdItems(){
 const items={...PUNK_ITEMS};
 for(const [id,item] of customMd)items[id]={name:item.name,slot:'shirt',cost:0,shirtColor:item.shirtColor,imageUrl:'/api/md-image/'+id,custom:true};
 return items;
}
function validMdItem(key){return PUNK_ITEMS[key]||customMd.has(key)&&publicMdItems()[key]}

function shopRecord(identity){
 if(!shopStats.has(identity))shopStats.set(identity,{spent:0,owned:[],equipped:{}});
 return shopStats.get(identity);
}
function getShopView(p,now=Date.now()){
 const record=shopRecord(p.badgeIdentity);
 const earned=Math.floor(badgeTotal(p,now)/60); // 1 point per connected minute
 return {points:earned,earned,spent:0,refunded:record.refunded||0,testing:true,owned:Object.keys(publicMdItems()),equipped:{...record.equipped},items:publicMdItems()};
}
function setShopAppearance(p){
 p.equipped=p.badgeIdentity?{...shopRecord(p.badgeIdentity).equipped}:{};
}

const BADGE_LEVELS=[['bronze',0],['silver',3600],['gold',18000],['platinum',54000],['diamond',144000],['crown',360000]];
function badgeTier(seconds){let tier='bronze';for(const [id,threshold] of BADGE_LEVELS){if(seconds>=threshold)tier=id;}return tier;}
function badgeTotal(p,now=Date.now()){
 const stat=p.badgeIdentity?badgeStats.get(p.badgeIdentity):null;
 return Math.floor((stat?.seconds||0)+Math.max(0,now-(p.badgeSince||now))/1000);
}
function updateBadge(p,now=Date.now()){
 if(!p||!p.badgeIdentity)return false;
 const total=badgeTotal(p,now),tier=badgeTier(total),changed=tier!==p.badgeTier;
 p.badgeTier=tier;p.badgeSeconds=total;
 return changed;
}
function settleBadge(p,now=Date.now()){
 if(!p||!p.badgeIdentity)return;
 const stat=badgeStats.get(p.badgeIdentity)||{seconds:0};
 stat.seconds+=Math.max(0,now-(p.badgeSince||now))/1000;
 badgeStats.set(p.badgeIdentity,stat);p.badgeSince=now;updateBadge(p,now);scheduleSave();
}

let saveTimeout=null;
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SECRET_KEY||'';
const useSupabase=Boolean(SB_URL&&SB_KEY);
let restored=false;
let saveChain=Promise.resolve();
function stateData(){return {version:5,music,queue:[...queue],history:[...history],nextTrackToken,customMd:Object.fromEntries(customMd),shopStats:Object.fromEntries([...shopStats].map(([k,v])=>[k,{spent:0,refunded:v.refunded||0,owned:v.owned,equipped:v.equipped}])),badgeStats:Object.fromEntries([...badgeStats].map(([k,v])=>[k,Math.floor(v.seconds||0)])),savedAt:Date.now()}}
function applySaved(d){
 if(!d||typeof d!=='object')return;
 if(d.customMd&&typeof d.customMd==='object')for(const [id,r] of Object.entries(d.customMd).slice(0,40)){
  if(!/^md-[a-f0-9]{16}$/.test(id)||!r||typeof r!=='object')continue;
  if(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(r.image||'')||r.image.length>145000)continue;
  customMd.set(id,{name:clean(r.name,45),shirtColor:/^#[a-fA-F0-9]{6}$/.test(r.shirtColor)?r.shirtColor:'#181818',image:r.image});
 }
 if(d.shopStats&&typeof d.shopStats==='object')for(const [identity,r] of Object.entries(d.shopStats).slice(0,30000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!r||typeof r!=='object')continue;
  const owned=Array.isArray(r.owned)?[...new Set(r.owned.filter(k=>validMdItem(k)))]:[];
  const equipped={};for(const slot of SHOP_SLOTS){const key=r.equipped?.[slot];if(validMdItem(key)&&publicMdItems()[key].slot===slot)equipped[slot]=key;}
  shopStats.set(identity,{spent:0,refunded:Math.max(0,Math.floor(Number(r.refunded)||0))+Math.max(0,Math.floor(Number(r.spent)||0)),owned,equipped});
 }
 if(d.badgeStats&&typeof d.badgeStats==='object')for(const [k,v] of Object.entries(d.badgeStats).slice(0,30000)){
  if(/^[a-zA-Z0-9_-]{20,100}$/.test(k)&&Number.isFinite(v)&&v>=0)badgeStats.set(k,{seconds:Math.min(v,315360000)});
 }
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
 // One-time v114 migration: legacy spent points were converted into refunded credits.
 // Persist the zero-spend records immediately so restarts never re-deduct them.
 if([...shopStats.values()].some(r=>r.refunded>0))scheduleSave();
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
const colors = ['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee','#262631','#373943','#a5e1f9','#f1d9a7','#16171d'];
const patterns=['solid','stripe','wide-stripe'];
const sashes=['none','black','purple','red','green','black-check','red-check','yellow','blue','blue-check','yellow-check','purple-check','black-dot','red-dot','blue-dot','yellow-dot','purple-dot'];
const hats=['none'];
const hairStyles=['short','bob','long','buns','bob2','short2','basic-short','basic-bob'];
const oldHairMap={wavy:'long',ponytail:'buns',mohawk:'short',spiky:'short',curly:'bob',buzz:'basic-short'};
const safeHairStyle=v=>hairStyles.includes(v)?v:(oldHairMap[v]||'short');
const hairColors=['#25222a','#4b3932','#85533e','#edc46b','#d34c53','#4d86d5','#9965c9','#e89bc2'];
function apparel(d,fallback={}){return {
 pattern:patterns.includes(d.pattern)?d.pattern:(fallback.pattern||'solid'),
 sash:sashes.includes(d.sash)?d.sash:(fallback.sash||'none'),
 hat:'none',
 hairStyle:safeHairStyle(d.hairStyle||fallback.hairStyle||(d.gender==='female'?'bob':'short')),
 hairColor:hairColors.includes(d.hairColor)?d.hairColor:(fallback.hairColor||'#4b3932')
}}
// Flag image uploads are served once per content hash; snapshots broadcast only small IDs.
const flagImages=new Map();
function storeFlagImage(source){
 if(typeof source!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(source)||source.length>210000)return null;
 const raw=Buffer.from(source.slice('data:image/jpeg;base64,'.length),'base64');
 if(raw.length<100||raw.length>155000||raw[0]!==0xff||raw[1]!==0xd8||raw[raw.length-2]!==0xff||raw[raw.length-1]!==0xd9)return null;
 const id=crypto.createHash('sha256').update(raw).digest('hex').slice(0,32);
 flagImages.set(id,raw);
 // Keep at most 100 uploaded flags in memory; older uploads can be restored on rejoin.
 while(flagImages.size>100)flagImages.delete(flagImages.keys().next().value);
 return id;
}
const cleanFlag=s=>String(s||'').replace(/[\x00-\x1f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,32);
const clean = (s,max=30)=>String(s||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,max);
const send=(res,obj)=>{res.write('data: '+JSON.stringify(obj)+'\n\n');};
const broadcast=obj=>{for(const res of clients.values()) {try {send(res,obj);}catch{}}};
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(obj));};
// Consent-based two-player interactions. The server owns distance, invitations and timing.
const duoInvites=new Map(),activeDuos=new Map();
const DUO_LABELS={highfive:'하이파이브',handshake:'악수',hug:'포옹',dance:'함께 춤추기'};
const DUO_DURATION=5800,DUO_INVITE_TTL=15000,DUO_DISTANCE=88; // server coordinate (~5.1 world units)
function duoFor(playerId){return [...activeDuos.values()].find(d=>d.endAt>Date.now()&&(d.a===playerId||d.b===playerId))}
function endDuo(duo){if(!duo||!activeDuos.has(duo.id))return;activeDuos.delete(duo.id);for(const id of [duo.a,duo.b]){const p=players.get(id);if(p){p.action='idle';p.pose='stand';broadcast({type:'move',player:p})}}broadcast({type:'duo-end',id:duo.id,a:duo.a,b:duo.b})}
function clearDuosFor(id){for(const duo of [...activeDuos.values()])if(duo.a===id||duo.b===id)endDuo(duo);for(const [inviteId,invite] of duoInvites)if(invite.from===id||invite.to===id){duoInvites.delete(inviteId);broadcast({type:'duo-invite-ended',id:inviteId,to:invite.to})}}
function duoDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
setInterval(()=>{const now=Date.now();for(const duo of [...activeDuos.values()])if(duo.endAt<=now)endDuo(duo);for(const [key,invite] of duoInvites)if(invite.expiresAt<=now){duoInvites.delete(key);broadcast({type:'duo-invite-ended',id:key,to:invite.to})}},700).unref();
const snapshot=()=>({type:'snapshot',interactions:[...activeDuos.values()].filter(x=>x.endAt>Date.now()),players:[...players.values()],chat:chatHistory,...musicState(),skipVote:publicSkipVote(),skipVoteCooldownUntil,slam:publicSlam(),slamCooldownUntil,rockPlay:publicRock(),crowdSurf:activeSurfRide&&activeSurfRide.startAt+activeSurfRide.duration>Date.now()?activeSurfRide:null,rockCooldowns:{...rockCooldowns},rockRunningUntil,count:players.size});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
const SERVER_X_MIN=20,SERVER_X_MAX=1380,SERVER_Y_MIN=60,SERVER_Y_MAX=1100;
function cleanup(){const now=Date.now();for(const [id,p] of players)if(now-p.seen>180000){settleBadge(p,Math.min(now,p.seen+45000));settleBadge(p);clearDuosFor(id);players.delete(id);forgetSession(id);voterLeaves(id);if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();const r=clients.get(id);if(r){r.end();clients.delete(id)}broadcast({type:'leave',id,count:players.size})}}
setInterval(cleanup,7000).unref();
setInterval(()=>{
 const now=Date.now();let changed=false;
 for(const p of players.values()){
  if(now-p.seen>45000)continue; // Do not reward stale tabs without heartbeat.
  if(updateBadge(p,now)){broadcast({type:'badge',id:p.id,badgeTier:p.badgeTier,badgeSeconds:p.badgeSeconds});changed=true;}
 }
 for(const p of players.values())if(p.badgeIdentity&&now-p.seen<=45000)settleBadge(p,now);
 if(changed)console.log('Visitor badge rank updated');
},60000).unref();

function videoId(input){const v=String(input||'').trim();if(/^[\w-]{11}$/.test(v))return v;try{const u=new URL(v);const host=u.hostname.replace(/^www\./,'');if(host==='youtu.be')return /^[\w-]{11}$/.test(u.pathname.slice(1))?u.pathname.slice(1):null;if(['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(host)){const id=u.searchParams.get('v')||u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null}}catch{}return null}
// Read the actual public YouTube title server-side; never trust a user-submitted title.
// YouTube search runs only on the server, keeping its API key out of public JS.
// Search requests are rate-limited per live player and cached to protect quota.
const YOUTUBE_API_KEY=process.env.YOUTUBE_API_KEY||'';
const ytSearchCache=new Map(),ytSearchTimes=new Map();
const SEARCH_CACHE_MS=10*60*1000, SEARCH_COOLDOWN_MS=4000;
function youtubeErrorMessage(status,payload){
 const reason=payload?.error?.errors?.[0]?.reason||'';
 if(reason==='quotaExceeded'||reason==='dailyLimitExceeded'||status===429)return '오늘 유튜브 검색 한도를 모두 사용했습니다. 링크로 예약할 수 있어요.';
 if(status===400||status===403)return '유튜브 API 키 또는 프로젝트 설정을 확인해 주세요.';
 return '유튜브 검색에 실패했습니다. 링크 예약은 계속 사용할 수 있어요.';
}
async function youtubeSearch(query){
 const key=query.toLocaleLowerCase('ko-KR');const hit=ytSearchCache.get(key);
 if(hit&&Date.now()-hit.time<SEARCH_CACHE_MS)return hit.items;
 const params=new URLSearchParams({part:'snippet',q:query,type:'video',maxResults:'8',safeSearch:'moderate',videoEmbeddable:'true',videoSyndicated:'true',key:YOUTUBE_API_KEY});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
 try{
  const response=await fetch('https://www.googleapis.com/youtube/v3/search?'+params.toString(),{signal:controller.signal});
  const payload=await response.json();
  if(!response.ok)throw Object.assign(new Error(youtubeErrorMessage(response.status,payload)),{status:502});
  const items=(payload.items||[]).filter(x=>/^[\w-]{11}$/.test(x?.id?.videoId||'')).map(x=>({
   id:x.id.videoId,title:String(x.snippet?.title||'제목 없음').slice(0,180),
   channel:String(x.snippet?.channelTitle||'').slice(0,100),
   thumb:'https://i.ytimg.com/vi/'+x.id.videoId+'/mqdefault.jpg'
  }));
  ytSearchCache.set(key,{time:Date.now(),items});
  if(ytSearchCache.size>100)ytSearchCache.delete(ytSearchCache.keys().next().value);
  return items;
 }finally{clearTimeout(timer)}
}
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
async function receive(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>240000)throw new Error('too large')}return JSON.parse(raw||'{}')}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.gltf':'model/gltf+json','.bin':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/flag-image/')&&req.method==='GET'){
    const imageId=url.pathname.slice('/api/flag-image/'.length);
    const bytes=/^[a-f0-9]{32}$/.test(imageId)?flagImages.get(imageId):null;
    if(!bytes){res.writeHead(404);return res.end('Image not found')}
    res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});
    return res.end(bytes);
  }
  if(url.pathname.startsWith('/api/md-image/')&&req.method==='GET'){
   const id=url.pathname.slice('/api/md-image/'.length);const item=customMd.get(id);
   if(!item){res.writeHead(404);return res.end('Not found')}
   const data=Buffer.from(item.image.slice('data:image/webp;base64,'.length),'base64');
   res.writeHead(200,{'content-type':'image/webp','cache-control':'public,max-age=3600','x-content-type-options':'nosniff'});
   return res.end(data);
  }
  if(!restored&&url.pathname.startsWith('/api/'))return json(res,503,{error:'음악 저장소 연결 확인 중입니다. 잠시 뒤 다시 시도해주세요.'});
  if(url.pathname==='/api/md-catalog'&&req.method==='GET')return json(res,200,{items:publicMdItems(),testing:true});
  if(url.pathname==='/api/youtube-search'&&req.method==='GET'){
    res.setHeader('cache-control','no-store');
    if(!YOUTUBE_API_KEY)return json(res,503,{error:'유튜브 검색이 아직 설정되지 않았습니다. 관리자에게 YOUTUBE_API_KEY 등록을 요청해 주세요.'});
    const id=String(url.searchParams.get('id')||'');
    if(!players.has(id))return json(res,401,{error:'입장 후 검색할 수 있어요.'});
    const q=String(url.searchParams.get('q')||'').trim().replace(/\s+/g,' ');
    if(q.length<2||q.length>80)return json(res,400,{error:'검색어를 2~80자로 입력해 주세요.'});
    const now=Date.now(),last=ytSearchTimes.get(id)||0;
    if(now-last<SEARCH_COOLDOWN_MS)return json(res,429,{error:'검색은 4초 간격으로 할 수 있어요.'});
    ytSearchTimes.set(id,now);
    try{const items=await youtubeSearch(q);return json(res,200,{items})}
    catch(error){console.warn('YouTube search:',error.message);return json(res,error.status||502,{error:error.status?error.message:'유튜브에 연결하지 못했습니다. 링크 예약을 이용해 주세요.'})}
  }
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
      if(url.pathname==='/api/md-admin'){
       if(!MD_ADMIN_KEY)return json(res,503,{error:'Render 환경변수 MD_ADMIN_KEY를 설정해 주세요.'});
       if(!adminAuthorized(req))return json(res,403,{error:'관리자 키가 올바르지 않습니다.'});
       const cmd=clean(d.command,20);
       if(cmd==='list')return json(res,200,{items:publicMdItems()});
       if(cmd==='create'){
        if(customMd.size>=16)return json(res,400,{error:'등록 가능한 MD는 최대 16개입니다.'});
        const name=clean(d.name,45);
        const shirtColor=String(d.shirtColor||'');
        const image=String(d.image||'');
        if(name.length<2||!/^#[a-fA-F0-9]{6}$/.test(shirtColor))return json(res,400,{error:'상품 이름과 티셔츠 색상을 확인해 주세요.'});
        if(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>145000)return json(res,400,{error:'WEBP 이미지가 너무 크거나 잘못됐어요. 더 작게 압축해 주세요.'});
        const bytes=Buffer.from(image.slice('data:image/webp;base64,'.length),'base64');
        if(bytes.length>105000||bytes.length<32||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')return json(res,400,{error:'WEBP 파일만 등록 가능합니다 (105KB 이하).'});
        const id='md-'+crypto.randomBytes(8).toString('hex');
        customMd.set(id,{name,shirtColor,image});
        await saveNow();broadcast({type:'md-catalog',items:publicMdItems()});
        return json(res,200,{ok:true,id,items:publicMdItems()});
       }
       if(cmd==='delete'){
        const id=String(d.item||'');if(!customMd.has(id))return json(res,404,{error:'등록된 MD를 찾을 수 없어요.'});
        customMd.delete(id);
        for(const r of shopStats.values())if(r.equipped.shirt===id)delete r.equipped.shirt;
        for(const player of players.values()){if(player.equipped?.shirt===id){setShopAppearance(player);broadcast({type:'profile',player})}}
        await saveNow();broadcast({type:'md-catalog',items:publicMdItems()});
        return json(res,200,{ok:true,items:publicMdItems()});
       }
       return json(res,400,{error:'알 수 없는 관리자 명령입니다.'});
      }
      if(url.pathname==='/api/join'){
        const sessionKey=typeof d.sessionKey==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.sessionKey)?d.sessionKey:null;
        const badgeIdentity=typeof d.badgeIdentity==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.badgeIdentity)?d.badgeIdentity:null;
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
        const id=crypto.randomUUID(),p={id,badgeSince:Date.now(),badgeTier:'bronze',badgeSeconds:0,name:clean(d.name,18)||'ROCKER',flagText:cleanFlag(d.flagText),flagImage:d.flagImage?storeFlagImage(d.flagImage)||'':'',color:colors.includes(d.color)?d.color:colors[0],...apparel(d),gender:d.gender==='female'?'female':'male',x:clamp(190+Math.random()*880,SERVER_X_MIN,SERVER_X_MAX),y:clamp(390+Math.random()*420,SERVER_Y_MIN,SERVER_Y_MAX),facing:0,action:'idle',pose:'stand',seen:Date.now()};
        Object.defineProperty(p,'badgeIdentity',{value:badgeIdentity,writable:true,enumerable:false});updateBadge(p);setShopAppearance(p);players.set(id,p);
        if(sessionKey){sessionPlayers.set(sessionKey,id);playerSessions.set(id,sessionKey)}
        if(pageId)pageOwners.set(id,pageId);
        resumeForFirst();broadcast({type:'join',player:p,count:players.size});return json(res,200,{id,reused:false,...snapshot()});
      }
      const id=clean(d.id,80),p=players.get(id);if(!p)return json(res,401,{error:'Session expired. Please rejoin.'});p.seen=Date.now();
      if(url.pathname==='/api/heartbeat'){return json(res,200,{ok:true})}
      if(url.pathname==='/api/shop'){
        if(!p.badgeIdentity)return json(res,400,{error:'브라우저 저장소를 사용해야 포인트를 모을 수 있습니다.'});
        const command=clean(d.command,20);
        if(command==='status')return json(res,200,{shop:getShopView(p)});
        const key=clean(d.item,40),item=publicMdItems()[key];
        if(!item)return json(res,400,{error:'존재하지 않는 상품입니다.'});
        const record=shopRecord(p.badgeIdentity);
        if(command==='buy'){
          // v114: temporary free testing. Old spent points already refunded.
          if(!record.owned.includes(key))record.owned.push(key);
        }else if(command==='equip'){
          record.equipped[item.slot]=key;
        }else if(command==='unequip'){
          if(record.equipped[item.slot]===key)delete record.equipped[item.slot];
        }else return json(res,400,{error:'지원하지 않는 명령입니다.'});
        for(const other of players.values())if(other.badgeIdentity===p.badgeIdentity){setShopAppearance(other);broadcast({type:'profile',player:other})}
        scheduleSave();return json(res,200,{ok:true,shop:getShopView(p)});
      }

      if(url.pathname==='/api/flag'){
        const upload=Boolean(d.flagImage);
        const flagImage=upload?storeFlagImage(d.flagImage):'';
        if(upload&&!flagImage)return json(res,400,{error:'이미지가 너무 크거나 형식이 올바르지 않습니다.'});
        p.flagText=upload?'':cleanFlag(d.flagText);p.flagImage=flagImage;
        broadcast({type:'flag',id:p.id,flagText:p.flagText,flagImage:p.flagImage});
        return json(res,200,{ok:true,flagText:p.flagText,flagImage:p.flagImage});
      }
      if(url.pathname==='/api/profile'){p.name=clean(d.name,18)||'ROCKER';p.color=colors.includes(d.color)?d.color:p.color;p.gender=d.gender==='female'?'female':'male';Object.assign(p,apparel(d,p));broadcast({type:'profile',player:p});return json(res,200,{ok:true,player:p})}
      if(url.pathname==='/api/duo'){
        const command=clean(d.command,20),now=Date.now();
        if(command==='invite'){
          const targetId=clean(d.targetId,80),kind=clean(d.kind,20),target=players.get(targetId);
          if(!DUO_LABELS[kind])return json(res,400,{error:'지원하지 않는 상호작용입니다.'});
          if(!target||targetId===id)return json(res,400,{error:'상대를 다시 선택해 주세요.'});
          if(duoFor(id)||duoFor(targetId))return json(res,409,{error:'이미 상호작용 중인 유저가 있어요.'});
          if(duoDistance(p,target)>DUO_DISTANCE)return json(res,400,{error:'상대에게 조금 더 가까이 이동해 주세요.'});
          if([...duoInvites.values()].some(i=>i.expiresAt>now&&(i.from===id||i.to===id||i.from===targetId||i.to===targetId)))return json(res,429,{error:'진행 중인 상호작용 요청이 있어요.'});
          const invite={id:crypto.randomUUID(),from:id,to:targetId,kind,name:p.name,expiresAt:now+DUO_INVITE_TTL};duoInvites.set(invite.id,invite);
          broadcast({type:'duo-invite',invite});return json(res,200,{ok:true,inviteId:invite.id});
        }
        if(command==='accept'||command==='decline'){
          const inviteId=clean(d.inviteId,80),invite=duoInvites.get(inviteId);
          if(!invite||invite.to!==id||invite.expiresAt<=now)return json(res,404,{error:'요청이 만료되었습니다.'});
          duoInvites.delete(inviteId);broadcast({type:'duo-invite-ended',id:inviteId,to:id});
          if(command==='decline'){broadcast({type:'duo-declined',to:invite.from,by:p.name});return json(res,200,{ok:true})}
          const source=players.get(invite.from);
          if(!source||duoFor(id)||duoFor(source.id)||duoDistance(p,source)>DUO_DISTANCE)return json(res,400,{error:'상대가 멀어졌거나 이미 다른 동작 중이에요.'});
          // Face each other at a safe 2.2 world-unit gap, within the existing playfield.
          const centerX=(source.x+p.x)*.5,centerY=(source.y+p.y)*.5;
          const dx=p.x-source.x,dy=p.y-source.y,distance=Math.hypot(dx,dy),nx=distance>1?dx/distance:1,ny=distance>1?dy/distance:0;
          const gap=14;source.x=clamp(centerX-nx*gap,SERVER_X_MIN,SERVER_X_MAX);source.y=clamp(centerY-ny*gap,SERVER_Y_MIN,SERVER_Y_MAX);
          p.x=clamp(centerX+nx*gap,SERVER_X_MIN,SERVER_X_MAX);p.y=clamp(centerY+ny*gap,SERVER_Y_MIN,SERVER_Y_MAX);
          // For high-five, start in a slightly side-on stance so both avatars
          // visibly turn toward one another before their hands connect.
          const faceA=Math.atan2(nx,ny),faceB=Math.atan2(-nx,-ny);
          if(invite.kind==='highfive'){
            source.facing=faceA-.65;
            p.facing=faceB+.65;
          }else{
            source.facing=faceA;
            p.facing=faceB;
          }
          source.action='idle';p.action='idle';source.pose='stand';p.pose='stand';
          const duo={id:crypto.randomUUID(),a:source.id,b:id,kind:invite.kind,startAt:now+300,endAt:now+300+DUO_DURATION,
           anchor:{a:{x:source.x,y:source.y},b:{x:p.x,y:p.y}}};
          activeDuos.set(duo.id,duo);
          broadcast({type:'move',player:source});broadcast({type:'move',player:p});broadcast({type:'duo-start',duo});
          return json(res,200,{ok:true});
        }
        if(command==='cancel'){
          const duo=duoFor(id);if(duo)endDuo(duo);return json(res,200,{ok:true});
        }
        return json(res,400,{error:'지원하지 않는 상호작용 명령입니다.'});
      }
      if(url.pathname==='/api/move'){
        // Ignore stale movement packets while server-authoritative paired poses play.
        if(duoFor(id))return json(res,200,{ok:true,paired:true});
        const previousAction=p.action;
        p.x=clamp(d.x,SERVER_X_MIN,SERVER_X_MAX);p.y=clamp(d.y,SERVER_Y_MIN,SERVER_Y_MAX);p.facing=clamp(d.facing,-Math.PI,Math.PI);
        p.pose=['stand','sit','lie'].includes(d.pose)?d.pose:'stand';
        p.action=['idle','walk','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','mosh-charge','slam-charge','slam-retreat','slam-celebrate','circle-run','train-run','row-paddle','toast-clink','surf-rider','surf-support'].includes(d.action)?d.action:'idle';
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
           broadcast({type:'slam-impact',slamId:eventId,x:clamp(d.x,SERVER_X_MIN,SERVER_X_MAX),y:clamp(d.y,SERVER_Y_MIN,SERVER_Y_MAX)});
          }
          return json(res,200,{ok:true});
        }
        if(d.command==='start'){
          const now=Date.now(),kind=String(d.kind||'');
          if(!Object.hasOwn(ROCK_DURATIONS,kind))return json(res,400,{error:'지원하지 않는 락놀이입니다.'});
          if(activeSlam||activeRock||now<rockRunningUntil)return json(res,409,{error:'다른 락놀이가 진행 중이에요.'});
          if(now<rockCooldowns[kind])return json(res,429,{error:(kind==='circle'?'써클핏':kind==='mosh'?'모싱':kind==='row'?'노젓기':kind==='toast'?'짠하기':kind==='surf'?'크라우드 서핑':'기차놀이')+' 쿨타임이 남아 있어요.'});
          const x=Number(d.x),y=Number(d.y);
          // Reserve room for a wide loop inside the walkable zone (not the stage or sea).
          if(!Number.isFinite(x)||!Number.isFinite(y)||(kind==='mosh'||kind==='toast'||kind==='surf'?(x<90||x>1310||y<280||y>800):(x<235||x>1165||y<370||y>795)))return json(res,400,{error:kind==='mosh'?'페스티벌 바닥을 선택해 주세요.':'넓은 잔디 광장 안쪽의 바닥을 선택해 주세요.'});
          const eventId=crypto.randomUUID(),duration=ROCK_DURATIONS[kind];
          const current={id:eventId,kind,x:Math.round(x),y:Math.round(y),endAt:now+ROCK_COUNTDOWN_MS,initiator:id,participants:new Set([id])};
          activeRock=current;
          rockRunningUntil=current.endAt+duration;
          rockCooldowns[kind]=rockRunningUntil+ROCK_COOLDOWN_MS;
          setTimeout(()=>{
            if(activeRock!==current)return;
            const participants=[...current.participants].filter(pid=>players.has(pid));
            // The initiator is the surfer and is counted in the minimum of 2.
            // Never launch a solo surf. Release the arena and allow another try.
            if(current.kind==='surf'&&(participants.length<2||!participants.includes(current.initiator))){
              activeRock=null;rockRunningUntil=0;rockCooldowns.surf=0;
              broadcast({type:'rockplay-cancel',id:current.id,kind:'surf',reason:'크라우드 서핑은 시작자 포함 2명 이상이 필요해요.'});
              rockUpdate();return;
            }
            const launch={type:'rockplay-go',id:current.id,kind:current.kind,x:current.x,y:current.y,startAt:current.endAt,duration,participants,riderId:current.kind==='surf'?current.initiator:null,serverNow:Date.now(),
              origins:current.kind==='surf'?Object.fromEntries(participants.map(pid=>{const actor=players.get(pid);return [pid,{x:actor.x,y:actor.y}]})):undefined};
            if(current.kind==='surf'){
              activeSurfRide={id:launch.id,kind:launch.kind,x:launch.x,y:launch.y,startAt:launch.startAt,duration:launch.duration,participants:[...participants],riderId:launch.riderId,origins:launch.origins};
              setTimeout(()=>{if(activeSurfRide?.id===current.id)activeSurfRide=null},duration+1500).unref();
            }
            broadcast(launch);
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
        settleBadge(p);clearDuosFor(id);players.delete(id);forgetSession(id);voterLeaves(id);
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
