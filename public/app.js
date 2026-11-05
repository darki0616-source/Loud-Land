import * as THREE from 'https://esm.sh/three@0.160.1';
import { OrbitControls } from 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.160.1/examples/jsm/loaders/GLTFLoader.js';
import { CSS3DRenderer, CSS3DObject } from 'https://esm.sh/three@0.160.1/examples/jsm/renderers/CSS3DRenderer.js';
const $=id=>document.getElementById(id), palette=['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee','#16171d'];
// Picnic zone layout tuned for mobile: keep the main standing/stage area
// compact, and place the picnic blankets cleanly in the side rest zone.
const picnicSlots=[
 {worldX:-39,worldZ:28},
 {worldX:-26,worldZ:28},
 {worldX:-13,worldZ:28},
 {worldX:0,worldZ:28},
 {worldX:13,worldZ:28},
 {worldX:26,worldZ:28},
 {worldX:39,worldZ:28},
];
const picnicMatColors=['#f5a5a3','#a7def4','#f5ce80','#b3d9a0','#ceb8f1','#ffd2a5','#b2d8ff'];
const mats=picnicSlots.map((slot,i)=>({x:slot.worldX/.058+600,y:500,c:picnicMatColors[i],worldX:slot.worldX,worldZ:slot.worldZ}));
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',pose:'stand',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0,token:0},queue:[],history:[],serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:true,skipVote:null,skipVoteCooldownUntil:0,walkTarget:null,benchTarget:null,moving:false};
let slamMode=false,slam=null,slamCooldownUntil=0,slamMotion=null;
let rockPlacementMode=null,rockPlay=null,rockCooldowns={circle:0,train:0,mosh:0,row:0,toast:0},rockRunningUntil=0,rockMotion=null;
let chosenPattern='solid',chosenSash='none',chosenHairStyle='short',chosenHairColor='#4b3932';
const hairStyles=[['short','가르마 숏컷'],['bob','짧은 보브'],['long','장발'],['buns','번 헤어'],['bob2','레이어드 단발'],['short2','더 짧은 사이드 숏컷'],['basic-short','기본 숏컷'],['basic-bob','기본 단발']];
// Older custom styles are converted to the closest available Quaternius asset.
const legacyHairMap={wavy:'long',ponytail:'buns',mohawk:'short',spiky:'short',curly:'bob',buzz:'basic-short'};
const normalizeHairStyle=style=>hairStyles.some(([id])=>id===style)?style:(legacyHairMap[style]||'short');
const hairColors=[['검정','#25222a'],['진갈색','#4b3932'],['갈색','#85533e'],['금발','#edc46b'],['빨강','#d34c53'],['파랑','#4d86d5'],['보라','#9965c9'],['분홍','#e89bc2']];
let chosenColor=palette[0],chosenGender='male',toastTimer;const avatars=new Map();const activeBubbles=new Map();
// Keep a visitor's own appearance on this browser only (not by shared public IP).
const PROFILE_STORAGE_KEY='oneseason-profile-v1';
// Per-tab identity survives refreshes and reconnects without linking people by IP.
const SESSION_STORAGE_KEY='oneseason-avatar-session-v1';
const pageId=crypto.randomUUID();
function getSessionKey(){
 try{
  let key=sessionStorage.getItem(SESSION_STORAGE_KEY);
  if(!key||!/^[a-zA-Z0-9_-]{20,100}$/.test(key)){
   key=crypto.randomUUID();sessionStorage.setItem(SESSION_STORAGE_KEY,key);
  }
  return key;
 }catch{return pageId}
}
const sessionKey=getSessionKey();
function readSavedProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)||'null');return p&&typeof p==='object'?p:null}catch{return null}}
function saveProfile(p){try{localStorage.setItem(PROFILE_STORAGE_KEY,JSON.stringify({name:String(p.name||'ROCKER').slice(0,18),color:p.color,gender:p.gender,pattern:p.pattern||'solid',sash:p.sash||'none',hairStyle:normalizeHairStyle(p.hairStyle),hairColor:p.hairColor||'#4b3932'}))}catch{}}
function selectGender(g){chosenGender=g==='female'?'female':'male';document.querySelectorAll('[data-gender]').forEach(b=>b.classList.toggle('selected',b.dataset.gender===chosenGender))}
const apparelSashIds=['none','black','purple','red','green','black-check','red-check','yellow','blue','blue-check','yellow-check','purple-check','black-dot','red-dot','blue-dot','yellow-dot','purple-dot'];
const savedProfile=readSavedProfile();
if(savedProfile){if(typeof savedProfile.name==='string')$('nick').value=savedProfile.name.slice(0,18);if(palette.includes(savedProfile.color))chosenColor=savedProfile.color;if(['male','female'].includes(savedProfile.gender))selectGender(savedProfile.gender);if(['solid','stripe','wide-stripe'].includes(savedProfile.pattern))chosenPattern=savedProfile.pattern;if(apparelSashIds.includes(savedProfile.sash))chosenSash=savedProfile.sash;chosenHairStyle=normalizeHairStyle(savedProfile.hairStyle||(savedProfile.gender==='female'?'bob':'short'));if(hairColors.some(([,hex])=>hex===savedProfile.hairColor))chosenHairColor=savedProfile.hairColor}
let editingProfile=false;
function refreshProfilePreview(){if(!state.me)return;$('profileName').textContent=state.me.name;$('avatarPreview').querySelector('b').style.background=state.me.color}

function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000)}
document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>selectGender(b.dataset.gender));
function colorPicker(){let r=$('colorPicker');r.innerHTML='';palette.forEach(c=>{let b=document.createElement('button');b.style.background=c;b.className=c===chosenColor?'selected':'';b.setAttribute('aria-label','티셔츠 '+c);b.onclick=()=>{chosenColor=c;colorPicker()};r.append(b)})}colorPicker();
const apparelChoices={pattern:[['solid','단색'],['stripe','가는 줄무늬'],['wide-stripe','넓은 줄무늬']],sash:[['none','없음'],['black','검정'],['purple','보라'],['red','빨강'],['green','초록'],['black-check','검정 체크'],['red-check','빨강 체크'],['yellow','노랑'],['blue','파랑'],['blue-check','파랑 체크'],['yellow-check','노랑 체크'],['purple-check','보라 체크'],['black-dot','검정 · 흰 땡땡이'],['red-dot','빨강 · 흰 땡땡이'],['blue-dot','파랑 · 흰 땡땡이'],['yellow-dot','노랑 · 흰 땡땡이'],['purple-dot','보라 · 흰 땡땡이']]};
const sashSwatchColors={
 black:'#20212c',purple:'#793ac8',red:'#d42c42',green:'#2a9a59',
 'black-check':'#20212c','red-check':'#c72b35',
 yellow:'#f4cf3e',blue:'#287ed0','blue-check':'#287ed0',
 'yellow-check':'#f4cf3e','purple-check':'#793ac8',
 'black-dot':'#20212c','red-dot':'#c72b35','blue-dot':'#287ed0',
 'yellow-dot':'#f4cf3e','purple-dot':'#793ac8'
};
function sashPreviewBackground(value){
 const base=sashSwatchColors[value]||'#263247';
 if(value.endsWith('-dot'))return `radial-gradient(circle, #fff 0 3px, transparent 3.3px) 0 0 / 22px 22px, ${base}`;
 if(value.endsWith('-check')){
  const accent=value==='yellow-check'?'#674e22':value==='black-check'?'#dcdce0':'#f7e8e4';
  return `linear-gradient(0deg,transparent 41%,${accent} 41% 53%,transparent 53%) 0 0 / 23px 23px,linear-gradient(90deg,transparent 41%,${accent} 41% 53%,transparent 53%) 0 0 / 23px 23px,${base}`;
 }
 return base;
}
function renderApparelPicker(){
 for(const [key,items] of Object.entries(apparelChoices)){
  const parent=$(key+'Picker');if(!parent)continue;parent.replaceChildren();
  const current=key==='pattern'?chosenPattern:chosenSash;
  for(const [value,label] of items){
   const b=document.createElement('button');b.type='button';
   b.className='apparel-choice'+(value===current?' selected':'');
   b.setAttribute('aria-pressed',String(value===current));
   if(key==='sash'){
    b.classList.add('sash-option');
    const sample=document.createElement('span');sample.className='sash-swatch';
    if(value==='none'){
     sample.classList.add('sash-none');sample.textContent='×';
    }else{
     sample.style.background=sashPreviewBackground(value);
    }
    sample.setAttribute('aria-hidden','true');
    const caption=document.createElement('span');caption.className='sash-label';caption.textContent=label;
    b.append(sample,caption);
    b.setAttribute('aria-label','슬로건 '+label);
   }else b.textContent=label;
   b.onclick=()=>{if(key==='pattern')chosenPattern=value;else if(key==='sash')chosenSash=value;renderApparelPicker()};
   parent.append(b);
  }
 }
}
renderApparelPicker();
function renderHairPicker(){
 const styles=$('hairStylePicker'),colors=$('hairColorPicker');if(!styles||!colors)return;
 styles.replaceChildren();colors.replaceChildren();
 for(const [value,label] of hairStyles){const b=document.createElement('button');b.type='button';b.className='apparel-choice'+(chosenHairStyle===value?' selected':'');b.textContent=label;b.setAttribute('aria-pressed',String(chosenHairStyle===value));b.onclick=()=>{chosenHairStyle=value;renderHairPicker()};styles.append(b)}
 for(const [label,value] of hairColors){const b=document.createElement('button');b.type='button';b.className='hair-color-choice'+(chosenHairColor===value?' selected':'');b.style.setProperty('--hair-swatch',value);b.textContent=label;b.setAttribute('aria-label','머리색 '+label);b.setAttribute('aria-pressed',String(chosenHairColor===value));b.onclick=()=>{chosenHairColor=value;renderHairPicker()};colors.append(b)}
}
renderHairPicker();
let rejoining=null,manualExit=false;
async function post(ep,data){
 const r=await fetch('/api/'+ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 const d=await r.json();
 if(r.status===401&&state.id&&!manualExit&&ep!=='join'&&ep!=='leave'){
  await restoreSession();throw Error('서버 연결이 복구되었습니다. 다시 시도해 주세요.');
 }
 if(!r.ok)throw Error(d.error||'서버 오류');return d;
}
async function restoreSession(){
 if(rejoining)return rejoining;
 rejoining=(async()=>{
  try{
   const r=await fetch('/api/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionKey,pageId,name:state.me?.name||$('nick').value||'ROCKER',color:state.me?.color||chosenColor,gender:state.me?.gender||chosenGender,pattern:state.me?.pattern||chosenPattern,sash:state.me?.sash||chosenSash,hairStyle:state.me?.hairStyle||chosenHairStyle,hairColor:state.me?.hairColor||chosenHairColor})});
   if(!r.ok)throw Error('재접속 실패');const d=await r.json();
   const old=state.me;state.id=d.id;state.me=d.players.find(x=>x.id===d.id);
   if(old){state.me.x=old.x;state.me.y=old.y;state.me.facing=old.facing;state.me.action=old.action;state.me.pose=old.pose;}
   state.players=new Map(d.players.map(x=>[x.id,x]));refreshProfilePreview();renderOnlinePlayers();listen();
   applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);
   applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);
   sendMove();toast('서버 연결이 자동 복구됐어요');
  }catch(err){console.warn('Automatic rejoin:',err)}
 })().finally(()=>{rejoining=null});return rejoining;
}
// Session heartbeat independent of 3D animation; survives inactive tabs where timers still run.
setInterval(async()=>{if(!state.id||manualExit)return;try{const r=await fetch('/api/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:state.id})});if(r.status===401)await restoreSession()}catch{}},18000);
window.addEventListener('online',()=>{if(state.id&&!manualExit)restoreConnection()});
function restoreConnection(){if(!state.id)return;listen();fetch('/api/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:state.id})}).then(r=>{if(r.status===401)return restoreSession()}).catch(()=>{})}

function applyMusic(m,serverNow,queue,history){state.music=m;if(Array.isArray(queue))state.queue=queue;if(Array.isArray(history))state.history=history;updateFestivalBoard();renderQueue();if(serverNow)state.serverDelta=serverNow-Date.now();$('songTitle').textContent=m.id?m.title||'유튜브 영상':'등록된 음악 없음';$('songCredit').textContent=m.id?`DJ ${m.changedBy||'알 수 없음'} · ${m.paused?'일시정지':'재생 중'}`:'첫 번째 DJ가 되어보세요';$('screenPlaceholder').style.display=m.id?'none':'flex';updateSharedMusicButtons();syncVideo(true)}
function updateSharedMusicButtons(){const side=$('skipMusic');if(side)side.disabled=!state.music?.id}

function updateFestivalBoard(){let m=state.music||{};const title=document.getElementById('boardCurrent');const next=document.getElementById('boardNext');const status=document.getElementById('boardStatus');if(title)title.textContent=m.title||'현재 재생 중인 곡 없음';if(next)next.textContent=state.queue?.length?state.queue[0].title:'예약된 곡 없음';if(status)status.textContent=m.id?(m.paused?'일시정지':'공연 중'):'공연 대기 중';}
function renderQueue(){
 updateFestivalBoard();
 const upcoming=$('queueList'),history=$('historyList');
 if(!upcoming||!history)return;
 // Separate lists: top is always current + upcoming; replay history stays below.
 // Re-render from state without mutating the original queue or vote indices.
 upcoming.replaceChildren();history.replaceChildren();
 const addTrack=(container,track,index,source)=>{
  const li=document.createElement('li');
  li.className='track-item '+(source==='now'?'track-current':'track-muted');
  const button=document.createElement('button');
  button.type='button';
  button.textContent=(source==='now'?'▶ ':source==='history'?'↶ ':'♫ ')+(track.title||'제목 없는 곡')+(track.addedBy?' · '+track.addedBy:'');
  if(source!=='now'){
   button.title='이 곡을 재생할지 접속자 투표를 시작합니다';
   button.onclick=()=>musicCommand('vote-select',{source,index,videoId:track.id});
  }else{
   button.disabled=true;
   button.title='현재 재생 중';
  }
  li.append(button);container.append(li);
 };
 if(state.music?.id)addTrack(upcoming,{id:state.music.id,title:state.music.title,addedBy:state.music.changedBy},0,'now');
 else{
  const li=document.createElement('li');li.className='track-empty';li.textContent='현재 재생 중인 곡이 없습니다';upcoming.append(li);
 }
 if(state.queue.length){
  const label=document.createElement('li');label.className='track-section';label.textContent='다음 예약곡';upcoming.append(label);
  state.queue.forEach((track,index)=>addTrack(upcoming,track,index,'queue'));
 }else{
  const li=document.createElement('li');li.className='track-empty';li.textContent='예약된 곡이 없습니다';upcoming.append(li);
 }
 if(state.history.length)state.history.forEach((track,index)=>addTrack(history,track,index,'history'));
 else{
  const li=document.createElement('li');li.className='track-empty';li.textContent='이전 재생 기록이 없습니다';history.append(li);
 }
}
let reportedToken=0;
function reportDuration(){if(!state.id||!state.ytReady||!state.music.id)return;const duration=state.yt.getDuration();if(duration>1&&reportedToken!==state.music.token){reportedToken=state.music.token;post('music',{id:state.id,command:'duration',token:state.music.token,duration}).catch(()=>{})}}
function syncVideo(force=false){let m=state.music;if(!m.id||!state.ytReady)return;let sec=m.paused?m.position:Math.max(0,(Date.now()+state.serverDelta-m.startedAt)/1000);try{if(state.lastTrack!==String(m.token)+':'+m.id){state.lastTrack=String(m.token)+':'+m.id;reportedToken=0;if(state.audioEnabled&&!m.paused){state.yt.unMute();state.yt.loadVideoById({videoId:m.id,startSeconds:sec})}else{state.yt.mute();state.yt.loadVideoById({videoId:m.id,startSeconds:sec})}return}if(force||Math.abs(state.yt.getCurrentTime()-sec)>3)state.yt.seekTo(sec,true);if(state.audioEnabled)state.yt.unMute();else state.yt.mute();if(m.paused)state.yt.pauseVideo();else if(state.yt.getPlayerState()!==1)state.yt.playVideo()}catch(e){console.warn(e)}}
window.onYouTubeIframeAPIReady=()=>{state.yt=new YT.Player('youtubePlayer',{height:'100%',width:'100%',playerVars:{playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{state.ytReady=true;syncVideo(true)},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING||e.data===YT.PlayerState.CUED)reportDuration();if(e.data===YT.PlayerState.ENDED&&state.id&&state.music.id)post('music',{id:state.id,command:'ended',token:state.music.token}).catch(()=>{})},onError:()=>toast('영상이 임베드 재생을 허용하지 않습니다')}})};
async function musicCommand(command,extra={}){if(!state.id)return toast('먼저 입장해주세요');try{let d=await post('music',{id:state.id,command,...extra});applyMusic(d.music,d.serverNow,d.queue,d.history);toast('공유 음악이 업데이트되었습니다')}catch(e){toast(e.message)}}
$('playLink').onclick=()=>musicCommand('enqueue',{url:$('videoUrl').value});$('skipMusic').onclick=()=>musicCommand('skip');$('skipVoteYes').onclick=()=>castSkipVote('yes');$('skipVoteNo').onclick=()=>castSkipVote('no');function updatePersonalAudioButton(){
 const btn=$('enableAudio');
 if(btn){
  btn.textContent=state.audioEnabled?'🔇 내 소리 끄기':'🔊 내 소리 켜기';
  btn.setAttribute('aria-pressed',String(state.audioEnabled));
  btn.title=state.audioEnabled?'내 기기에서만 소리를 끕니다':'내 기기에서만 소리를 켭니다';
 }
 const hud=$('hudAudioToggle');
 if(hud){
  hud.textContent=state.audioEnabled?'🔇 소리 끄기':'🔊 소리 켜기';
  hud.setAttribute('aria-pressed',String(state.audioEnabled));
  hud.setAttribute('aria-label',state.audioEnabled?'내 소리 끄기':'내 소리 켜기');
  hud.title=state.audioEnabled?'이 기기에서 음악 소리 끄기':'이 기기에서 음악 소리 켜기';
 }
 const mutedNotice=$('audioMutedNotice');
 if(mutedNotice)mutedNotice.hidden=Boolean(state.audioEnabled);
}
function setPersonalAudio(enabled){state.audioEnabled=Boolean(enabled);try{if(state.ytReady){if(enabled){state.yt.unMute();state.yt.setVolume(75)}else state.yt.mute()}}catch(e){}syncVideo(true);updatePersonalAudioButton()}
function togglePersonalAudio(){
 setPersonalAudio(!state.audioEnabled);
 toast(state.audioEnabled?'이 기기의 소리를 켰어요':'이 기기의 소리를 껐어요 (다른 사람 음악은 계속 재생돼요)');
}
$('enableAudio').onclick=togglePersonalAudio;
$('hudAudioToggle').onclick=togglePersonalAudio;
updatePersonalAudioButton();$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('playLink').click()});
function updateCrowdCount(n){const el=document.getElementById('boardVisitors');if(el)el.textContent=String(n)}
// Local UI renders names from the authoritative SSE player set (not from DOM HTML).
function renderOnlinePlayers(){
 const people=[...state.players.values()].sort((a,b)=>(a.id===state.id?-1:b.id===state.id?1:0));
 const list=$('playersList');if(!list)return;
 list.replaceChildren();
 $('playersPanelCount').textContent=String(people.length);
 $('hudPlayerCount').textContent=String(people.length);
 if(!people.length){const empty=document.createElement('li');empty.className='players-empty';empty.textContent='현재 접속자가 없습니다';list.append(empty);return}
 for(const p of people){
  const li=document.createElement('li');li.className='players-entry';
  const swatch=document.createElement('span');swatch.className='players-swatch';swatch.style.background=palette.includes(p.color)?p.color:'#d7fa81';
  const name=document.createElement('span');name.className='players-name';name.textContent=p.name||'ROCKER';
  li.append(swatch,name);
  if(p.id!==state.id){li.classList.add('duo-select-player');li.title='상호작용 요청하기';li.style.cursor='pointer';li.onclick=()=>chooseDuoTarget(p.id)}
  if(p.id===state.id){const me=document.createElement('small');me.textContent='나';li.append(me)}
  list.append(li);
 }
}
function setPlayersPanel(open){$('playersPanel').classList.toggle('hidden',!open);$('playersToggle').setAttribute('aria-expanded',String(open))}
$('playersToggle').onclick=()=>setPlayersPanel($('playersPanel').classList.contains('hidden'));
$('playersClose').onclick=()=>setPlayersPanel(false);
function showBookingNotice(name,title){
 const host=$('joinNotices');const el=document.createElement('div');el.className='music-booking-notice';
 const nameSpan=document.createElement('strong');nameSpan.textContent=(name||'누군가')+'님이 음악을 예약하였습니다';
 const titleSpan=document.createElement('small');titleSpan.textContent=title||'예약된 곡';
 el.append(nameSpan,titleSpan);host.append(el);
 while(host.children.length>4)host.firstElementChild.remove();
 setTimeout(()=>el.remove(),5200);
}

function listen(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);if(Array.isArray(d.chat)){$('chatMessages').replaceChildren();d.chat.forEach(appendChat)};for(const id of duoVfx.keys())removeDuoVfx(id);activeDuos.clear();for(const duo of d.interactions||[])activeDuos.set(duo.id,duo);syncDuoStatus()}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();if(d.player.id!==state.id)notice(d.player.name+' 들어왔습니다')}else if(d.type==='chat'){appendChat(d.entry);showBubble(d.entry)}else if(d.type==='move'){state.players.set(d.player.id,d.player);if(d.player.id===state.id&&currentDuo())state.me={...d.player}}else if(d.type==='profile'){state.players.set(d.player.id,d.player);if(d.player.id===state.id){state.me=d.player;refreshProfilePreview()}renderOnlinePlayers()}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers()}else if(d.type==='music')applyMusic(d.music,d.serverNow,d.queue,d.history);else if(d.type==='slam')applySlam(d.slam,d.cooldownUntil);else if(d.type==='slam-go')onSlamGo(d);else if(d.type==='slam-impact')spawnSlamDust(d.x,d.y);else if(d.type==='toast-spark')spawnToastSpark(d.x,d.y);else if(d.type==='cheer'&&d.playerId!==state.id&&state.audioEnabled)playCheer();else if(d.type==='rockplay')applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil);else if(d.type==='rockplay-go')onRockPlayGo(d);else if(d.type==='music-booked')showBookingNotice(d.name,d.title);else if(d.type==='music-control')showMusicControlNotice(d.name,d.command);else if(d.type==='skip-vote')applySkipVote(d.vote,d.cooldownUntil);else if(d.type==='skip-vote-result')showSkipVoteResult(d);else if(d.type.startsWith('duo-'))handleDuoEvent(d)};state.es.onerror=()=>{ /* EventSource retries automatically; heartbeat repairs an expired session. */ }}
function applySkipVote(vote,cooldownUntil){
 state.skipVote=vote||null;if(Number.isFinite(Number(cooldownUntil)))state.skipVoteCooldownUntil=Number(cooldownUntil);
 const overlay=$('skipVoteOverlay');overlay.hidden=!vote;updateSkipVoteUI();updateSharedMusicButtons();
}
function updateSkipVoteUI(){
 const vote=state.skipVote;if(!vote)return;
 const eligible=Array.isArray(vote.eligible)?vote.eligible:[];
 const voted=Array.isArray(vote.voted)?vote.voted:[];
 const canVote=eligible.includes(state.id)&&!voted.includes(state.id);
 $('skipVoteHeading').textContent=vote.proposer+'님의 '+(vote.kind==='select'?'선택곡 재생':'다음 곡')+' 투표';
 $('skipVoteDetails').textContent=(vote.kind==='select'?'🎵 '+vote.target?.title+' · ':'')+'찬성 '+vote.required+'명 이상이면 '+(vote.kind==='select'?'선택곡을 재생합니다.':'다음 곡으로 이동합니다.')+' (투표 대상 '+eligible.length+'명)';
 $('skipVoteTally').textContent='찬성 '+vote.yes+'명 · 반대 '+vote.no+'명 · 필요 '+vote.required+'명';
 $('skipVoteProgress').style.width=(eligible.length?(vote.yes/eligible.length)*100:0)+'%';
 $('skipVoteTimer').textContent=Math.max(0,Math.ceil((vote.endAt-(Date.now()+state.serverDelta))/1000))+'초';
 $('skipVoteYes').disabled=!canVote;$('skipVoteNo').disabled=!canVote;
 $('skipVoteHint').textContent=!eligible.includes(state.id)?'투표가 시작된 뒤 입장해 이번 투표는 관전만 할 수 있어요.':canVote?'찬성이나 반대를 선택하세요.':'투표 완료 · 결과를 기다리는 중';
}
async function castSkipVote(choice){const vote=state.skipVote;if(!vote||!state.id)return;try{await post('music',{id:state.id,command:'vote-cast',voteId:vote.id,choice})}catch(e){toast(e.message)}}
function showSkipVoteResult(d){applySkipVote(null,state.skipVoteCooldownUntil);let msg=d.passed?'✅ 과반수 찬성! 요청한 곡으로 이동합니다':d.reason==='timeout'?'투표 시간이 종료되어 현재 곡을 유지합니다':'투표가 부결되어 현재 곡을 유지합니다';notice(msg)}
setInterval(()=>{updateSkipVoteUI();updateSharedMusicButtons()},500);
let joining=false;async function join(options={}){const auto=Boolean(options?.auto);if(editingProfile)return updateProfile();if(joining)return;joining=true;manualExit=false;try{let d=await post('join',{sessionKey,pageId,name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender,pattern:chosenPattern,sash:chosenSash,hairStyle:chosenHairStyle,hairColor:chosenHairColor});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);state.pose=state.me?.pose||'stand';cameraFollowInitialized=false;state.players=new Map(d.players.map(p=>[p.id,p]));renderOnlinePlayers();$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;saveProfile(state.me);applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);listen();$('audioModal').classList.add('hidden');setPersonalAudio(true);showMovementGuide();if(!auto)toast('ONEseason에 오신 것을 환영합니다!')}catch(e){if(auto)$('joinModal').classList.remove('hidden');$('joinError').textContent='입장 실패: '+(e?.message||'연결을 확인해주세요');console.error('ONEseason join error:',e)}finally{joining=false}}
$('audioYes').onclick=()=>{$('audioModal').classList.add('hidden');setPersonalAudio(true);toast(state.music.id?'음악 재생을 허용했어요':'음악이 등록되면 바로 재생돼요')};$('audioNo').onclick=()=>{$('audioModal').classList.add('hidden');setPersonalAudio(false);toast('내 소리를 끈 상태로 입장했어요')};// First tap must save even if the nickname field currently has keyboard focus.
// A pointerdown listener runs BEFORE Safari's keyboard dismissal can consume
// the subsequent click. De-duplicate that click and block duplicate requests.
let profileSavePointerAt=-Infinity;
$('joinBtn').addEventListener('pointerdown',event=>{
 if(!editingProfile||event.button!==0)return;
 event.preventDefault();
 event.stopPropagation();
 profileSavePointerAt=performance.now();
 if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 updateProfile();
});
$('joinBtn').onclick=event=>{
 if(performance.now()-profileSavePointerAt<800){event.preventDefault();return}
 join();
};$('nick').onkeydown=e=>{if(e.key==='Enter')join()};function closeProfileEditor(){editingProfile=false;$('joinModal').classList.add('hidden');$('joinBtn').innerHTML='페스티벌 입장하기 <span>↗</span>';$('profileCancel').hidden=true;$('joinError').textContent=''}
async function updateProfile(){if(!state.id||!state.me)return;const button=$('joinBtn');if(button.disabled)return;button.disabled=true;button.textContent='저장 중…';try{
 const d=await post('profile',{id:state.id,name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender,pattern:chosenPattern,sash:chosenSash,hairStyle:chosenHairStyle,hairColor:chosenHairColor});
 state.me=d.player;state.players.set(state.id,d.player);saveProfile(d.player);refreshProfilePreview();renderOnlinePlayers();closeProfileEditor();toast('캐릭터 설정을 변경했어요');
 }catch(e){$('joinError').textContent='변경 실패: '+e.message}finally{button.disabled=false;if(editingProfile)button.textContent='변경 사항 저장'}}
$('editAvatar').onclick=()=>{if(!state.me)return;editingProfile=true;$('nick').value=state.me.name;chosenColor=state.me.color;chosenPattern=state.me.pattern||'solid';chosenSash=state.me.sash||'none';chosenHairStyle=normalizeHairStyle(state.me.hairStyle);chosenHairColor=state.me.hairColor||'#4b3932';selectGender(state.me.gender);colorPicker();renderApparelPicker();renderHairPicker();$('joinError').textContent='';$('joinBtn').textContent='변경 사항 저장';$('profileCancel').hidden=false;$('joinModal').classList.remove('hidden');if(!matchMedia('(pointer:coarse)').matches)$('nick').focus()};
$('profileCancel').onclick=closeProfileEditor;
$('profileToggle').onclick=()=>{if(!state.me)return toast('입장 후 변경할 수 있어요');$('editAvatar').click()};
;$('helpBtn').onclick=()=>toast('WASD 이동 · 클릭/터치 이동 · 드래그 시점 회전 · 춤: B/G/V/K · 환호성: H · 담배: C');
// Real-time paired interactions: invitations are opt-in, synced by server timestamp.
const activeDuos=new Map();let selectedDuoTarget=null,pendingDuoInvite=null;
const duoNames={highfive:'하이파이브',handshake:'악수',hug:'포옹',dance:'함께 춤추기'};
// Shared timeline helpers. Server timestamps keep two browsers aligned.
const duoClamp=v=>Math.max(0,Math.min(1,v));
const duoEase=v=>{v=duoClamp(v);return v*v*(3-2*v)};
const duoVfx=new Map();
const duoSparkMaterial=()=>new THREE.MeshBasicMaterial({color:'#ffe04c',transparent:true,opacity:1,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
function removeDuoVfx(id){
 const fx=duoVfx.get(id);if(!fx)return;
 fx.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose()}});
 scene.remove(fx.group);duoVfx.delete(id);
}
function updateDuoVfx(){
 const now=Date.now()+state.serverDelta;
 for(const [id,fx] of duoVfx)if(!activeDuos.has(id))removeDuoVfx(id);
 for(const d of activeDuos.values()){
  if(d.kind!=='highfive'||!d.anchor)continue;
  const sec=(now-d.startAt)/1000;
  // Yellow spark burst centered between the contacting palms.
  if(sec<.86||sec>1.56)continue;
  let fx=duoVfx.get(d.id);
  if(!fx){
   const group=new THREE.Group();scene.add(group);
   const spokes=[];
   const diskMat=duoSparkMaterial();
   const disc=new THREE.Mesh(new THREE.RingGeometry(.12,.20,20),diskMat);
   group.add(disc);
   for(let i=0;i<10;i++){
    const geometry=new THREE.BoxGeometry(.105,.34,.065);
    const mesh=new THREE.Mesh(geometry,duoSparkMaterial());group.add(mesh);spokes.push(mesh);
   }
   fx={group,disc,spokes};duoVfx.set(d.id,fx);
  }
  const a=toWorld(d.anchor.a),b=toWorld(d.anchor.b);
  fx.group.position.set((a.x+b.x)/2,2.0,(a.z+b.z)/2);
  // Billboard the burst, not the people; visible from both sides of the stage.
  fx.group.quaternion.copy(camera.quaternion);
  const progress=duoClamp((sec-.90)/.62),size=.55+progress*1.6;
  fx.disc.scale.setScalar(size);
  fx.disc.material.opacity=(1-progress)*.95;
  fx.spokes.forEach((mesh,i)=>{
   const ang=i*Math.PI*2/fx.spokes.length;
   mesh.position.set(Math.cos(ang)*(.2+progress*.95),Math.sin(ang)*(.2+progress*.95),0);
   mesh.rotation.z=ang-Math.PI/2;
   mesh.scale.setScalar(.7+progress*.5);
   mesh.material.opacity=(1-progress)*.96;
  });
 }
}

function currentDuo(playerId=state.id){return [...activeDuos.values()].find(d=>d.endAt>Date.now()+state.serverDelta&&(d.a===playerId||d.b===playerId))}
function duoPose(playerId){const d=currentDuo(playerId);return d?{action:'duo-'+d.kind,duo:d}:null}
function closeDuoMenu(){selectedDuoTarget=null;$('duoMenu').classList.add('hidden')}
function chooseDuoTarget(targetId){
 if(!state.id||targetId===state.id)return;
 if(currentDuo())return toast('함께 동작하는 동안에는 다른 유저를 선택할 수 없어요.');
 const target=state.players.get(targetId);if(!target)return toast('접속자가 떠났어요.');
 if(!state.me||Math.hypot(state.me.x-target.x,state.me.y-target.y)>88)return toast('상대 캐릭터에게 가까이 다가간 후 선택해 주세요.');
 selectedDuoTarget=targetId;$('duoTargetName').textContent='🎸 '+target.name;$('duoMenu').classList.remove('hidden');
}
$('duoMenuClose').onclick=closeDuoMenu;
document.querySelectorAll('[data-duo]').forEach(btn=>btn.onclick=async()=>{
 const targetId=selectedDuoTarget,kind=btn.dataset.duo;closeDuoMenu();if(!targetId||!state.id)return;
 try{await post('duo',{id:state.id,command:'invite',targetId,kind});toast('요청을 보냈어요. 상대의 수락을 기다려 주세요.')}catch(e){toast(e.message)}
});
$('duoAccept').onclick=async()=>{const invite=pendingDuoInvite;pendingDuoInvite=null;$('duoRequest').classList.add('hidden');if(!invite)return;try{await post('duo',{id:state.id,command:'accept',inviteId:invite.id})}catch(e){toast(e.message)}};
$('duoDecline').onclick=async()=>{const invite=pendingDuoInvite;pendingDuoInvite=null;$('duoRequest').classList.add('hidden');if(invite)try{await post('duo',{id:state.id,command:'decline',inviteId:invite.id})}catch(e){toast(e.message)}};
$('duoCancel').onclick=()=>{if(state.id)post('duo',{id:state.id,command:'cancel'}).catch(e=>toast(e.message))};
function syncDuoStatus(){
 const duo=currentDuo(),status=$('duoStatus');status.classList.toggle('hidden',!duo);
 if(duo)$('duoStatusText').textContent='🤝 '+duoNames[duo.kind]+' · '+Math.max(0,Math.ceil((duo.endAt-Date.now()-state.serverDelta)/1000))+'초';
}
function startDuo(duo){
 activeDuos.set(duo.id,duo);
 if(duo.a===state.id||duo.b===state.id){
  const authoritative=state.players.get(state.id);if(authoritative){state.me={...authoritative};state.pose='stand'}
  state.action='idle';state.actionUntil=0;state.walkTarget=null;state.benchTarget=null;state.keys.clear();
  if(slamMotion)finishSlamMotion();if(rockMotion)finishRockMotion();
  closeDuoMenu();$('duoRequest').classList.add('hidden');pendingDuoInvite=null;updateActionButtons();
  toast('함께 '+duoNames[duo.kind]+' 시작!');
 }
 syncDuoStatus();
}
function finishDuo(duoId){
 const duo=activeDuos.get(duoId);activeDuos.delete(duoId);removeDuoVfx(duoId);
 if(duo&&(duo.a===state.id||duo.b===state.id)){
  const p=state.players.get(state.id);if(p){state.me={...p};state.action='idle';state.actionUntil=0;state.pose='stand';updateActionButtons()}
 }
 syncDuoStatus();
}
function handleDuoEvent(d){
 if(d.type==='duo-invite'){
  const invite=d.invite;if(invite.to!==state.id)return;
  pendingDuoInvite=invite;
  $('duoRequestText').textContent=invite.name+'님이 '+duoNames[invite.kind]+'를 요청했어요.';
  $('duoRequest').classList.remove('hidden');return;
 }
 if(d.type==='duo-invite-ended'){
  if(pendingDuoInvite?.id===d.id){pendingDuoInvite=null;$('duoRequest').classList.add('hidden')}
  return;
 }
 if(d.type==='duo-declined'&&d.to===state.id){toast(d.by+'님이 요청을 거절했어요.');return}
 if(d.type==='duo-start'){startDuo(d.duo);return}
 if(d.type==='duo-end'){finishDuo(d.id);return}
}
setInterval(syncDuoStatus,250);
const sustainedReactions=new Set(['jump','run','headbang','buriburi','groove','windmill','skanking','airguitar','headspin','cheer','smoke']);
// One shared bottom tab group: reactions / dances / chat.
// Chat stays inside the dock instead of floating over the 3D world.
function selectBottomMenu(menu){
 const chat=menu==='chat';
 $('reactionActions').classList.toggle('hidden',menu!=='reaction');
 $('danceActions').classList.toggle('hidden',menu!=='dance');
 $('chatPanel').classList.toggle('hidden',!chat);
 $('chatToggle').setAttribute('aria-expanded',String(chat));
 document.querySelectorAll('[data-action-menu]').forEach(button=>{
  const active=button.dataset.actionMenu===menu;
  button.classList.toggle('active',active);
  button.setAttribute('aria-selected',String(active));
 });
 document.querySelector('.controlbar')?.classList.toggle('chat-tab-open',chat);
 if(!chat&&document.activeElement===$('chatInput'))$('chatInput').blur();
 if(chat)$('chatMessages').scrollTop=$('chatMessages').scrollHeight;
}
document.querySelectorAll('[data-action-menu]').forEach(button=>{
 button.addEventListener('click',()=>selectBottomMenu(button.dataset.actionMenu));
});
function updateActionButtons(){
 document.querySelectorAll('[data-action]').forEach(b=>{
  const a=b.dataset.action;
  const chosen=(a==='sit'&&state.pose==='sit')||(a==='lie'&&state.pose==='lie')||(!['sit','lie'].includes(a)&&state.action===a);
  b.classList.toggle('active',chosen);
 });
}
function react(a){
 if(!state.me)return;
 if(currentDuo())return toast('상호작용을 종료한 후 다른 동작을 사용해 주세요.');
 if(slamMotion){slamMotion=null;state.walkTarget=null}if(rockMotion){rockMotion=null;state.walkTarget=null}state.benchTarget=null;
 if(a==='sit'||a==='lie'){
  const near=mats.some(m=>Math.hypot(state.me.x-m.x,state.me.y-m.y)<105)||benchSeats.some(b=>Math.hypot(state.me.x-b.x,state.me.y-b.y)<75);
  if(!near&&state.pose==='stand')return toast('돗자리 근처에서 앉거나 누울 수 있어요');
  state.pose=state.pose===a?'stand':a;
  state.me.pose=state.pose;
  state.walkTarget=null;state.benchTarget=null;
  if(state.action==='run'||state.action==='jump')state.action='idle';
  state.me.action=state.action;
  state.actionUntil=state.action==='idle'?0:state.actionUntil;
  updateActionButtons();sendMove();return;
 }
 // One click toggles continuous reactions. Short animations return to the current pose.
 if(state.action===a&&sustainedReactions.has(a)){
  state.action='idle';state.actionUntil=0;state.me.action='idle';
 }else{
  if((a==='jump'||a==='run'||a==='buriburi'||a==='groove'||a==='windmill'||a==='skanking'||a==='airguitar'||a==='headspin'||a==='cheer'||a==='smoke')&&state.pose!=='stand'){
   state.pose='stand';state.me.pose='stand';
  }
  state.action=a;state.me.action=a;if(a==='cheer')playCheer();
  state.actionUntil=sustainedReactions.has(a)?Infinity:performance.now()+(a==='peace'?2200:a==='snack'?3300:1750);
 }
 updateActionButtons();sendMove();
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target?.isContentEditable)return;let k=e.key.toLowerCase();if(k.startsWith('arrow')||k===' ')e.preventDefault();state.keys.add(k);let acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'clap','6':'sit','7':'lie','8':'drink','9':'snack','0':'headbang','b':'buriburi','g':'groove','v':'windmill','k':'skanking','a':'airguitar','n':'headspin','h':'cheer','c':'smoke'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
// CC0 crowd cheering by SFXMint; play only for listeners who enabled audio.
// The URL is hotlink-permitted by the creator (https://sfxmint.com/sounds/crowd-cheer).
const cheerAudioUrl='https://sfxmint.com/dl/crowd-cheer-44.mp3';
let lastCheerSound=0;
function playCheer(){
 if(!state.audioEnabled||Date.now()-lastCheerSound<1900)return;
 lastCheerSound=Date.now();
 try{
  const audio=new Audio(cheerAudioUrl);
  audio.volume=.38;
  audio.play().catch(error=>console.warn('Cheer sound could not play',error));
 }catch(error){console.warn('Cheer sound unavailable',error)}
}
function sendMove(){if(!state.id||!state.me||currentDuo())return;let p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action,pose:p.pose||'stand'}).catch(()=>{})}
// Shared SLAM countdown (server timestamps, 15 s global launch cooldown).
const slamButton=$('slamButton'),slamInfo=$('slamInfo'),slamMarker=$('slamMarker'),slamCount=$('slamCount'),slamMembers=$('slamMembers'),slamJoin=$('slamJoin');
function slamNow(){return Date.now()+state.serverDelta}
function refreshSlamUI(){
 const remain=Math.max(0,Math.ceil((slamCooldownUntil-slamNow())/1000));
 slamButton.disabled=!state.id||!!slam||!!rockPlay||slamNow()<rockRunningUntil||remain>0;
 slamButton.classList.toggle('placing',slamMode);
 slamButton.textContent=slamMode?'📍 바닥을 터치하세요':slam?'🔥 슬램 진행 중':remain?`🔥 슬램 ${remain}초`:'🔥 슬램 만들기';
 slamInfo.textContent=rockPlacementMode?(rockPlacementMode==='circle'?'써클핏 위치를 터치하세요':rockPlacementMode==='mosh'?'모싱 위치를 터치하세요':rockPlacementMode==='row'?'노젓기 위치를 터치하세요':'기차놀이 위치를 터치하세요'):rockPlay?(rockPlay.kind==='circle'?'써클핏 참가자를 모집 중이에요':rockPlay.kind==='mosh'?'모싱 참가자를 모집 중이에요':rockPlay.kind==='row'?'노젓기 참가자를 모집 중이에요':rockPlay.kind==='toast'?'짠하기 참가자를 모집 중이에요':'기차놀이 참가자를 모집 중이에요'):slamMode?'슬램 위치를 터치하세요':slam?'슬램 참가자를 모집 중이에요':remain?`다음 슬램까지 ${remain}초`:'락놀이 메뉴에서 슬램·써클핏·기차놀이·모싱·노젓기 선택';
 slamInfo.classList.toggle('is-active',!!(rockPlacementMode||rockPlay||slamMode||slam));
}
function applySlam(event,cooldown){
 if(Number.isFinite(cooldown))slamCooldownUntil=cooldown;
 slam=event||null;
 if(slam)slamMode=false;
 refreshSlamUI();
}
// Every participant receives the same roster, so the landing lanes are
// deterministic on all clients. The circle around the centre prevents piling up.
function onSlamGo(event){
 if(event.id!==slam?.id && slam)return;
 const group=Array.isArray(event.participants)?event.participants:[];
 const index=group.indexOf(state.id);
 if(index!==-1&&state.me){
  const count=group.length;
  const angle=-Math.PI/2+index*2*Math.PI/count;
  const radius=count===1?18:Math.max(23,Math.min(46,16+count*4));
  const ax=event.x+Math.cos(angle)*radius,ay=event.y+Math.sin(angle)*radius;
  // Retreat follows the outward lane rather than sending everybody back to
  // the same centre. Clamp to the server's accepted festival coordinates.
  const reach=(count===1?48:55);
  const rx=Math.max(20,Math.min(1380,ax+Math.cos(angle)*reach));
  const ry=Math.max(220,Math.min(1100,ay+Math.sin(angle)*reach));
  slamMotion={phase:'charge',approach:{x:Math.max(20,Math.min(1380,ax)),y:Math.max(220,Math.min(1100,ay))},retreat:{x:rx,y:ry},started:performance.now(),phaseStarted:performance.now()};
  state.walkTarget=null;state.benchTarget=null;
  state.pose='stand';state.me.pose='stand';state.action='slam-charge';state.actionUntil=Infinity;state.me.action='slam-charge';
  document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));
  sendMove();
 }
 slam=null;refreshSlamUI();
}
const rockMenuButton=$('rockMenuButton'),rockMenuPanel=$('rockMenuPanel'),circleButton=$('circleButton'),trainButton=$('trainButton'),moshButton=$('moshButton'),rowButton=$('rowButton');
rockMenuButton.onclick=()=>{const show=rockMenuPanel.classList.contains('hidden');rockMenuPanel.classList.toggle('hidden',!show);rockMenuButton.setAttribute('aria-expanded',String(show))};
function closeRockMenu(){rockMenuPanel.classList.add('hidden');rockMenuButton.setAttribute('aria-expanded','false')}
function refreshRockUI(){
 const now=slamNow(),occupied=!!rockPlay||!!slam||now<rockRunningUntil;
 for(const [button,kind,name] of [[circleButton,'circle','써클핏'],[trainButton,'train','기차놀이'],[moshButton,'mosh','모싱'],[rowButton,'row','노젓기']]){
   const remaining=Math.max(0,Math.ceil((rockCooldowns[kind]-now)/1000));
   button.disabled=!state.id||occupied||remaining>0;
   button.classList.toggle('placing',rockPlacementMode===kind);
   button.textContent=rockPlacementMode===kind?'📍 '+name+' 위치 선택':remaining?`⏱ ${name} ${remaining}초`:`${kind==='circle'?'🔄':kind==='mosh'?'🥊':kind==='row'?'🚣':'🚂'} ${name} 만들기`;
 }
}
function applyRockPlay(event,cooldowns,runningUntil){
 if(cooldowns&&typeof cooldowns==='object'){
  for(const kind of ['circle','train','mosh','row','toast'])if(Number.isFinite(Number(cooldowns[kind])))rockCooldowns[kind]=Number(cooldowns[kind]);
 }
 if(Number.isFinite(Number(runningUntil)))rockRunningUntil=Number(runningUntil);
 rockPlay=event||null;
 if(rockPlay)rockPlacementMode=null;
 refreshRockUI();refreshSlamUI();
}
function onRockPlayGo(event){
 const participants=Array.isArray(event.participants)?event.participants:[];
 const index=participants.indexOf(state.id);
 if(index!==-1&&state.me){
   rockMotion={id:event.id,kind:event.kind,x:event.x,y:event.y,startAt:event.startAt,duration:event.duration,index,count:participants.length};
   slamMotion=null;state.walkTarget=null;state.benchTarget=null;
   state.pose='stand';state.me.pose='stand';state.action=event.kind==='mosh'?'mosh-charge':event.kind==='circle'?'circle-run':event.kind==='row'?'row-paddle':event.kind==='toast'?'toast-clink':'train-run';state.me.action=state.action;
   // Every moving group action now gathers smoothly, instead of teleporting
   // to its first animation point on the first frame.
   rockMotion.gatherFrom={x:state.me.x,y:state.me.y};
   if(event.kind==='mosh'){const start={x:state.me.x,y:state.me.y};rockMotion.moshStart=start;rockMotion.moshDestination={x:event.x+(index-participants.length/2)*7,y:event.y};rockMotion.dustA=false;rockMotion.dustB=false;}
   state.actionUntil=Infinity;updateActionButtons();sendMove();
 }
 rockPlay=null;refreshRockUI();refreshSlamUI();
}
$('toastStart').onclick=async()=>{if(!state.id||!state.me)return toast('먼저 입장해 주세요');try{const d=await post('rockplay',{id:state.id,command:'start',kind:'toast',x:Math.max(25,Math.min(1375,state.me.x)),y:Math.max(255,Math.min(875,state.me.y))});applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil);toast('🥂 짠하기! 5초 동안 참가자를 모집합니다')}catch(e){toast(e.message)}};
for(const [button,kind] of [[circleButton,'circle'],[trainButton,'train'],[moshButton,'mosh'],[rowButton,'row']]){
 button.onclick=()=>{
   if(!state.id||rockPlay||slam||rockRunningUntil>slamNow()||rockCooldowns[kind]>slamNow())return;
   rockPlacementMode=rockPlacementMode===kind?null:kind;slamMode=false;
   closeRockMenu();refreshRockUI();refreshSlamUI();
   slamInfo.textContent=rockPlacementMode?`${kind==='circle'?'써클핏':kind==='mosh'?'모싱':kind==='row'?'노젓기':'기차놀이'} 장소를 터치하세요`:'락놀이 메뉴에서 선택해 주세요';
 };
}
// v83: Group action paths are authored in SERVER coordinates but the
// audience extension nonlinearly stretches displayed Z. Convert offsets in
// WORLD space instead of passing them through the stretch again.
// Result: group-play paths keep their shape and speed in the rendered arena.
function groupWorldPosition(base,point){
 const origin=toWorld(base);
 return {x:origin.x+(point.x-base.x)*.058,z:origin.z+(point.y-base.y)*.058};
}
function serverFromWorld(world){
 return {x:world.x/.058+600,y:(contractWorldZ(world.z)-8)/.058+500};
}
function groupWorldPathPoint(m,point){
 const world=groupWorldPosition({x:m.x,y:m.y},point);
 return {...serverFromWorld(world),dx:point.dx,dy:point.dy};
}
function stepWorldToward(from,target,maxWorldStep){
 const a=toWorld(from),b=toWorld(target);
 const dx=b.x-a.x,dz=b.z-a.z,dist=Math.hypot(dx,dz);
 if(dist<=maxWorldStep||dist<.0001)return {...target,done:true};
 const step=Math.max(0,maxWorldStep)/dist;
 return {...serverFromWorld({x:a.x+dx*step,z:a.z+dz*step}),done:false};
}
function blendGroupWorld(from,to,alpha){
 const a=toWorld(from),b=toWorld(to),t=Math.min(1,Math.max(0,alpha));
 return serverFromWorld({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
}
function moshPathAt(m,elapsed){
 const fraction=Math.min(1,Math.max(0,elapsed/m.duration));
 const from=m.moshStart||{x:state.me.x,y:state.me.y};const dest=m.moshDestination||{x:m.x,y:m.y};
 const half={x:from.x+(dest.x-from.x)*.5,y:from.y+(dest.y-from.y)*.5};
 let a,b,t;
 if(fraction<.30){a=from;b=dest;t=fraction/.30}
 else if(fraction<.65){a=dest;b=half;t=(fraction-.30)/.35}
 else {a=half;b=dest;t=Math.min(1,(fraction-.65)/.31)}
 const u=t*t*(3-2*t);
 const wa=toWorld(a),wb=toWorld(b);
 const p=serverFromWorld({x:wa.x+(wb.x-wa.x)*u,z:wa.z+(wb.z-wa.z)*u});
 return {...p,dx:wb.x-wa.x,dy:wb.z-wa.z};
}
function rockPathAt(m,elapsed){
 const elapsedFraction=Math.min(1,Math.max(0,elapsed/m.duration));
 if(m.kind==='row'){return groupWorldPathPoint(m,{x:m.x+(m.index%2===0?-21:21),y:m.y+Math.floor(m.index/2)*28-22,dx:0,dy:1})}
 if(m.kind==='toast'){const angle=2*Math.PI*m.index/Math.max(1,m.count);return groupWorldPathPoint(m,{x:m.x+Math.sin(angle)*22,y:m.y+Math.cos(angle)*22,dx:-Math.sin(angle),dy:-Math.cos(angle)})}
 if(m.kind==='circle'){
   const angle=elapsedFraction*Math.PI*10 + m.index*2*Math.PI/Math.max(1,m.count);
   return groupWorldPathPoint(m,{x:m.x+Math.cos(angle)*115,y:m.y+Math.sin(angle)*115,dx:-Math.sin(angle),dy:Math.cos(angle)});
 }
 // Horizontal figure-eight, exactly four complete circuits of the entire path.
 // Wider participant phase offsets reduce crowd overlap while preserving the same figure-eight route and four circuits.
 const phase=elapsedFraction*Math.PI*8 - m.index*.42;
 return groupWorldPathPoint(m,{x:m.x+Math.sin(phase)*180,y:m.y+Math.sin(phase*2)*90,dx:180*Math.cos(phase),dy:180*Math.cos(phase*2)});
}
// When circle pit or train completes, each participant moves to a distinct
// outward point and keeps jumping with the 🤘 bubble until manual input.
function beginRockCelebration(m){
 const angle=(m.kind==='circle'?0:-Math.PI/2)+2*Math.PI*m.index/Math.max(1,m.count);
 const radius=m.kind==='circle'?150:Math.max(58,Math.min(108,40+m.count*6));
 m.scatterTarget={
  x:Math.max(20,Math.min(1380,m.x+Math.cos(angle)*radius)),
  y:Math.max(220,Math.min(1100,m.y+Math.sin(angle)*radius))
 };
 m.phase='scatter';m.phaseStarted=performance.now();
 state.action='slam-retreat';state.me.action='slam-retreat';
 state.actionUntil=Infinity;sendMove();
}
function finishRockMotion(){
 rockMotion=null;state.action='idle';state.me.action='idle';state.actionUntil=0;
 updateActionButtons();sendMove();
}
function updateRockPlayVisual(t){
 refreshRockUI();
 if(!rockPlay){rockFloorPath.visible=false;return}
 const remaining=rockPlay.endAt-slamNow();
 if(remaining<=0){rockFloorPath.visible=false;return}
 const world=toWorld(rockPlay),pos=new THREE.Vector3(world.x,3.6,world.z).project(camera);
 rockFloorPath.visible=true;rockFloorPath.position.set(world.x,.09,world.z);
 rockFloorPath.rotation.y=0;
 rockFloorPath.geometry=rockPlay.kind==='row'?rockRowGeometry:rockPlay.kind==='circle'||rockPlay.kind==='mosh'||rockPlay.kind==='toast'?rockCircleGeometry:rockTrainGeometry;
 if(pos.z>=1||pos.z<=-1){slamMarker.hidden=true;return}
 slamMarker.hidden=false;
 slamCount.textContent=String(Math.max(1,Math.ceil(remaining/1000)));
 slamMembers.textContent=`${rockPlay.kind==='circle'?'써클핏':rockPlay.kind==='mosh'?'모싱':rockPlay.kind==='row'?'노젓기':rockPlay.kind==='toast'?'짠하기':'기차놀이'} · ${rockPlay.participants.length}명 참가`;
 const joined=rockPlay.participants.includes(state.id);
 slamJoin.disabled=joined;slamJoin.textContent=joined?'✓ 참가 완료':'참가하기';
 slamMarker.style.left=Math.max(72,Math.min(host.clientWidth-72,(pos.x+1)*.5*host.clientWidth))+'px';
 slamMarker.style.top=Math.max(115,Math.min(host.clientHeight-165,(1-pos.y)*.5*host.clientHeight))+'px';
}
slamButton.onclick=()=>{
 if(!state.id)return toast('먼저 입장해 주세요');
 if(slam||rockPlay||rockRunningUntil>slamNow()||slamCooldownUntil>slamNow())return refreshSlamUI();
 rockPlacementMode=null;slamMode=!slamMode;closeRockMenu();refreshRockUI();refreshSlamUI();
};
slamJoin.onclick=async event=>{
 event.preventDefault();event.stopPropagation();
 if(!state.id)return;
 try{
  if(rockPlay){const result=await post('rockplay',{id:state.id,command:'join',eventId:rockPlay.id});applyRockPlay(result.event,result.rockCooldowns,result.rockRunningUntil)}
  else if(slam){const result=await post('slam',{id:state.id,command:'join',slamId:slam.id});applySlam(result.slam,result.cooldownUntil)}
 }catch(error){toast(error.message)}
};
function updateSlamVisual(t){
 if(t-(updateSlamVisual.last||0)>180){refreshSlamUI();updateSlamVisual.last=t}
 if(!slam){slamMarker.hidden=true;slamCircle.visible=false;return}
 const left=slam.endAt-slamNow();
 if(left<=0){slamMarker.hidden=true;slamCircle.visible=false;return}
 const countdown=Math.max(1,Math.ceil(left/1000));
 const participants=slam.participants||[];
 slamMarker.hidden=false;slamCircle.visible=true;
 slamCount.textContent=String(countdown);
 slamMembers.textContent=participants.length+'명 참가';
 const joined=participants.includes(state.id);
 slamJoin.disabled=joined;slamJoin.textContent=joined?'✓ 참가 완료':'참가하기';
 const world=toWorld(slam),pos=new THREE.Vector3(world.x,3.4,world.z).project(camera);
 if(pos.z>=1||pos.z<=-1){slamMarker.hidden=true;return}
 const px=(pos.x+1)*.5*host.clientWidth,py=(1-pos.y)*.5*host.clientHeight;
 // Keep overlay clear of the HUD and action dock without losing the world anchor.
 slamMarker.style.left=Math.max(72,Math.min(host.clientWidth-72,px))+'px';
 slamMarker.style.top=Math.max(115,Math.min(host.clientHeight-165,py))+'px';
 slamCircle.position.set(world.x,.085,world.z);
 slamCircle.scale.setScalar(1+Math.sin(t*.009)*.07);
}
setInterval(refreshSlamUI,800);
refreshSlamUI();

// ===== 3D SPACE =====
const host=$('world');const scene=new THREE.Scene();scene.background=new THREE.Color('#78bfff');scene.fog=new THREE.FogExp2('#78bfff',.0068);
const camera=new THREE.PerspectiveCamera(56,1,.1,350);camera.position.set(0,27,39);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width:700px)').matches?1.2:1.6));renderer.shadowMap.enabled=!matchMedia('(max-width:700px)').matches;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
const cssRenderer=new CSS3DRenderer();cssRenderer.domElement.className='css-world';host.appendChild(cssRenderer.domElement);
const stageVideo=document.querySelector('#youtubeScreen');stageVideo.classList.add('onstage');
const stageWebObject=new CSS3DObject(stageVideo);stageWebObject.position.set(0,6.3,-29.12);stageWebObject.scale.set(.015,.015,.015);scene.add(stageWebObject);
// The YouTube iframe is an independent browser browsing context. On iOS it
// otherwise captures two-finger gestures and pinches the entire page.
// A single transparent native pointer surface ABOVE the CSS3D iframe makes
// ALL taps/drags/pinches inside the 3D world reach OrbitControls consistently.
// YouTube playback and queue controls stay available via our music panel.
const gameTouchSurface=document.createElement('div');
gameTouchSurface.className='game-touch-surface';
gameTouchSurface.setAttribute('aria-label','게임 맵 터치 조작 영역');
// Do not make the overlay focusable: keyboard controls still use document.
host.appendChild(gameTouchSurface);
gameTouchSurface.addEventListener('touchmove',event=>{
 if(event.cancelable)event.preventDefault();
},{passive:false});
// Safari's legacy gesture events can still trigger browser-level zoom if
// the two fingers began on different layered descendants of the game map.
const gameWrap=host.closest('.gamewrap');
for(const type of ['gesturestart','gesturechange','gestureend']){
 gameWrap?.addEventListener(type,event=>{if(event.cancelable)event.preventDefault()},{passive:false});
}


// Stable single-pass avatar composition. The YouTube iframe is CSS3D;
// actors and bubbles live exclusively on a fixed transparent WebGL overlay.
// This avoids double-rendering and frame-to-frame clipping changes (flicker).
let stageForeground=null;
try{
 stageForeground=new THREE.WebGLRenderer({alpha:true,antialias:false,powerPreference:'low-power'});
 stageForeground.setPixelRatio(Math.min(window.devicePixelRatio||1,1.15));
 stageForeground.outputColorSpace=THREE.SRGBColorSpace;
 stageForeground.setClearColor(0x000000,0);
 stageForeground.domElement.className='stage-avatar-foreground';
 stageForeground.domElement.style.pointerEvents='none';
 stageForeground.domElement.setAttribute('aria-hidden','true');
 host.appendChild(stageForeground.domElement);
}catch(error){console.warn('Foreground WebGL disabled:',error);stageForeground=null}
const foregroundCamera=camera.clone();
function addForegroundLayer(object){if(stageForeground)object.traverse(child=>child.layers.set(1));}
function renderStageForeground(){
 if(!stageForeground)return;
 foregroundCamera.copy(camera);
 foregroundCamera.layers.set(1);
 const original=scene.background;
 scene.background=null;
 try{stageForeground.render(scene,foregroundCamera)}finally{scene.background=original}
}

const controls=new OrbitControls(camera,gameTouchSurface);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=3.2;controls.maxDistance=105;controls.maxPolarAngle=Math.PI/2.12;controls.target.set(0,1,4);controls.enablePan=false;
// Full 360° orbit on mouse and touch. Collide the camera with the actual stage
// box, never an infinite Z-plane (the old plane felt like a left/right lock).
// When the stage is between the player and the camera, dolly in along the
// current view direction instead of refusing horizontal orbit.
const stageCameraBox=new THREE.Box3(new THREE.Vector3(-23.6,-.3,-32),new THREE.Vector3(23.6,15.1,-16.7));
const cameraHit=new THREE.Vector3(),cameraRay=new THREE.Ray(),cameraOffset=new THREE.Vector3();
function keepCameraInFrontOfStage(){
 cameraOffset.subVectors(camera.position,controls.target);
 const distance=cameraOffset.length();if(distance<.001)return;
 cameraOffset.divideScalar(distance);
 cameraRay.set(controls.target,cameraOffset);
 const hit=cameraRay.intersectBox(stageCameraBox,cameraHit);
 if(!hit||controls.target.distanceToSquared(hit)>=distance*distance)return;
 const room=controls.target.distanceTo(hit)-.8;
 if(room<.6)return;
 const safe=controls.target.clone().addScaledVector(cameraOffset,Math.max(.9,room));
 camera.position.lerp(safe,.65);
 camera.lookAt(controls.target);
}

// Keep the local avatar in the center while preserving camera orbit and zoom.
const cameraFocus=new THREE.Vector3();let cameraFollowInitialized=false;
function followLocalAvatar(){
 if(!state.me)return;
 const p=toWorld(state.me);cameraFocus.set(p.x,1.55,p.z);
 const strength=cameraFollowInitialized?0.24:1;
 const delta=cameraFocus.clone().sub(controls.target).multiplyScalar(strength);
 camera.position.add(delta);controls.target.add(delta);
 cameraFollowInitialized=true;
}
const hemi=new THREE.HemisphereLight('#d7efff','#557157',2.35);scene.add(hemi);hemi.layers.enable(1);
const sunLight=new THREE.DirectionalLight('#fff0c7',2.8);sunLight.position.set(24,38,92);sunLight.castShadow=!matchMedia('(max-width:700px)').matches;sunLight.shadow.mapSize.set(1024,1024);sunLight.shadow.camera.left=-62;sunLight.shadow.camera.right=62;sunLight.shadow.camera.top=62;sunLight.shadow.camera.bottom=-62;scene.add(sunLight);sunLight.layers.enable(1);
const moonLight=new THREE.DirectionalLight('#d8e8ff',1.55);moonLight.position.set(-18,26,92);scene.add(moonLight);moonLight.layers.enable(1);
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(245,32,22),new THREE.MeshBasicMaterial({color:'#82c4ff',side:THREE.BackSide,fog:false}));scene.add(skyDome);
const sunOrb=new THREE.Mesh(new THREE.SphereGeometry(4.5,24,18),new THREE.MeshBasicMaterial({color:'#ffd580'}));scene.add(sunOrb);
const moonOrb=new THREE.Mesh(new THREE.SphereGeometry(3.4,20,16),new THREE.MeshBasicMaterial({color:'#eff6ff'}));scene.add(moonOrb);
// Shared local-time sky: gentle drifting clouds by day and star field by night.
const clouds=new THREE.Group();scene.add(clouds);
const cloudMaterial=new THREE.MeshBasicMaterial({color:'#fff9f2',transparent:true,opacity:.9,depthWrite:false,fog:false});
const cloudGeo=new THREE.SphereGeometry(1,10,7),cloudGroups=[];
for(let i=0;i<12;i++){
 const g=new THREE.Group();g.position.set((i%6)*30-76,39+(i%4)*7,35+Math.floor(i/6)*38);clouds.add(g);
 const size=2.0+(i%3)*.6;
 for(const [dx,dy,dz,sx,sy,sz] of [[0,0,0,2.6,1,1.25],[-2.0,.2,0,1.45,1.05,1.1],[2.1,.4,-.1,1.6,1.2,1.2],[.3,1.1,-.15,1.6,1.1,1.15]]){
  const piece=new THREE.Mesh(cloudGeo,cloudMaterial);piece.position.set(dx*size/2,dy*size/2,dz);piece.scale.set(sx*size/2,sy*size/2,sz*size/2);g.add(piece);
 }cloudGroups.push(g);
}
const starCount=240,starPos=new Float32Array(starCount*3);
for(let i=0;i<starCount;i++){
 const angle=i*2.39996323,vertical=.35+((i*73)%147)/147*.6,rad=Math.sqrt(Math.max(.0,1-vertical*vertical));
 starPos[i*3]=Math.cos(angle)*rad*149;starPos[i*3+1]=vertical*149;starPos[i*3+2]=Math.sin(angle)*rad*149;
}
const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:'#f5f8ff',size:1.15,sizeAttenuation:false,transparent:true,opacity:.9,depthWrite:false,fog:false}));scene.add(stars);
let skyPeriod='day';
function animateSky(t){const sec=t*.001;for(let i=0;i<cloudGroups.length;i++){const g=cloudGroups[i];g.position.x=(i%6)*30-76+Math.sin(sec*.055+i*.6)*8;g.position.y=39+(i%4)*7+Math.sin(sec*.24+i)*.35}if(stars.visible)stars.material.opacity=.8+Math.sin(sec*.7)*.15}

const weatherBadge=document.getElementById('weatherBadge');
let stageAccentFactor=.55;
const mat=(c,roughness=.83,emissive=null)=>new THREE.MeshStandardMaterial({color:c,roughness,metalness:roughness<.5?.22:0,emissive:emissive||'#000000',emissiveIntensity:emissive?.8:0});
const dark=mat('#17192b'),metal=mat('#525875',.35),grass=mat('#34554b'),wood=mat('#293344'),skin=mat('#edbd9e');
function cube(w,h,d,m,x,y,z,cast=true){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o}
function sphere(r,m,x,y,z){let o=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function cylinder(rt,rb,h,m,x,y,z){let o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,14),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function label(str,size=100,color='#ffffff',bg='#22283b'){let cv=document.createElement('canvas');cv.width=512;cv.height=128;let c=cv.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,512,128);c.fillStyle=color;c.font=`900 ${size}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(str,256,67);let tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide})}
const backdropGroup=new THREE.Group();scene.add(backdropGroup);
const buildingBodyMats=[],buildingRoofMats=[],buildingWindowMats=[],mountainMats=[];
function addBackdropMesh(parent,geo,material,x,y,z,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){
 const mesh=new THREE.Mesh(geo,material);mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);mesh.scale.set(sx,sy,sz);mesh.castShadow=false;mesh.receiveShadow=false;parent.add(mesh);return mesh;
}
function makeWindowTexture(cols=3,rows=6){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512;
 const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
 const marginX=26,gapX=18,gapY=18,winW=(canvas.width-marginX*2-gapX*(cols-1))/cols,winH=(canvas.height-52-gapY*(rows-1))/rows;
 c.fillStyle='rgba(255,244,209,.92)';
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)c.fillRect(marginX+col*(winW+gapX),26+row*(winH+gapY),winW,winH);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
// Architectural groups stay outside the ±50 playfield and never become collisions.
const skylinePalette=['#a7c1d2','#b7c9d5','#91b6ce','#c2c4d7','#a3cabc'];
const facadeTrimMaterials=[];
function createBackdropBuilding(x,z,w,h,d,windowCols=3,windowRows=6,rotY=0,variant=0){
 const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=rotY;backdropGroup.add(group);
 const bodyMat=new THREE.MeshStandardMaterial({color:skylinePalette[variant%skylinePalette.length],roughness:.88,metalness:.035});
 const roofMat=new THREE.MeshStandardMaterial({color:'#738eab',roughness:.9,metalness:.02});
 const trimMat=new THREE.MeshStandardMaterial({color:'#d7e3e8',roughness:.72,metalness:.12});
 const windowMat=new THREE.MeshBasicMaterial({
  map:makeWindowTexture(windowCols,windowRows),transparent:true,
  opacity:.16,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,color:'#dfe7f0'
 });
 buildingBodyMats.push(bodyMat);buildingRoofMats.push(roofMat);buildingWindowMats.push(windowMat);
 facadeTrimMaterials.push(trimMat);
 addBackdropMesh(group,new THREE.BoxGeometry(w,h,d),bodyMat,0,h/2,0);
 // Low-poly cornices, storefront, rooftop fixtures and illuminated glass.
 addBackdropMesh(group,new THREE.BoxGeometry(w+.25,.27,d+.26),roofMat,0,h+.14,0);
 addBackdropMesh(group,new THREE.BoxGeometry(w*.69,.65,d*.65),roofMat,0,h+.45,0);
 addBackdropMesh(group,new THREE.BoxGeometry(w*.45,.25,.48),trimMat,0,h+.87,0);
 addBackdropMesh(group,new THREE.PlaneGeometry(w*.77,h*.69),windowMat,0,h*.59,d/2+.045);
 addBackdropMesh(group,new THREE.PlaneGeometry(d*.77,h*.62),windowMat,w/2+.045,h*.58,0,0,Math.PI/2,0);
 addBackdropMesh(group,new THREE.BoxGeometry(w*.78,.2,.38),trimMat,0,h*.18,d/2+.28);
 if(variant%3===0){
  addBackdropMesh(group,new THREE.BoxGeometry(w*.42,.16,.38),roofMat,0,h*.86,d/2+.24);
  addBackdropMesh(group,new THREE.BoxGeometry(w*.42,.16,.38),roofMat,0,h*.46,d/2+.24);
 }
 const doorMat=new THREE.MeshStandardMaterial({color:'#7894aa',roughness:.52,metalness:.12});
 addBackdropMesh(group,new THREE.BoxGeometry(Math.min(w*.3,2.15),2.6,.12),doorMat,0,1.3,d/2+.07);
 const canopyMat=new THREE.MeshStandardMaterial({color:variant%2?'#c2e2d7':'#f2c0b9',roughness:.72});
 addBackdropMesh(group,new THREE.BoxGeometry(w*.54,.16,1.2),canopyMat,0,3.04,d/2+.43);
 return group;
}
function createMountain(x,z,width,height,depth,rotY=0){
 // Restore v89's tall mountain proportions, while keeping the mass entirely
 // beyond the last row of buildings. The shapes are purely decorative.
 const material=new THREE.MeshStandardMaterial({color:'#a7bfd2',roughness:.98,metalness:0,flatShading:true,side:THREE.FrontSide});
 mountainMats.push(material);
 const peak=new THREE.Mesh(new THREE.ConeGeometry(1.8,3.1,5,1),material);
 peak.position.set(x,height*1.45,z);
 peak.scale.set(width,height,depth);
 peak.rotation.y=rotY;
 peak.castShadow=false;peak.receiveShadow=false;backdropGroup.add(peak);
 const shoulder=new THREE.Mesh(new THREE.ConeGeometry(2.5,2.2,5,1),material);
 shoulder.position.set(x+width*.3,height*.85,z-4);
 shoulder.scale.set(width*1.05,height*.62,depth*1.05);
 shoulder.rotation.y=rotY+.20;
 shoulder.castShadow=false;shoulder.receiveShadow=false;backdropGroup.add(shoulder);
}

// v87: The red line is the end of the STAGE/AUDIENCE area, not a cue
// to make the entire map longer. Stop applying the old 18-26 unit rear warp.
// Use a 1:1 world/server coordinate mapping: prevents speed distortion too.
const STAGE_REAR_EDGE_Z=18;
function expandWorldZ(z){return z;}
function contractWorldZ(z){return z;}
// Input and render coordinates remain compatible with the extended-world map.
for(const m of mats)m.y=(contractWorldZ(m.worldZ)-8)/.058+500;
// Extend the ground without changing the stage or audience barrier.
// A single low grass substrate continues under ALL city lots outside the playable edges.
// Its top is y=-.04, safely below the distinct playable lawns at y=.07: no z-fighting.
// It ends exactly at z=42 where the existing beach begins.
const floor=cube(242,.4,134,grass,0,-.24,-25);floor.receiveShadow=true;
// Stage/audience grass ends EXACTLY at the red boundary z=18.
// Below it, the rest/picnic grass starts in the yellow zone.
// Both surfaces meet edge-to-edge (not overlapping), preventing Z-fighting.
const lawn=cube(100,.08,27,mat('#4f765f'),0,.03,4.5,false); // z -9 .. 18
lawn.receiveShadow=true;
const picnicLawn=cube(100,.08,32,mat('#536f5c'),0,.03,34,false); // z 18 .. 50
picnicLawn.receiveShadow=true;
const sandMat=mat('#dec391',.95),wetSandMat=mat('#c9ab74',.94);
// Retain the beach's original front/back coordinates (z=42..70), extending ONLY sideways.
const beach=cube(242,.06,28,sandMat,0,.02,56,false);beach.receiveShadow=true;
const wetBand=cube(242,.045,6.5,wetSandMat,0,.03,67,false);
const oceanGeo=new THREE.PlaneGeometry(300,104,68,32);
const oceanMat=new THREE.MeshStandardMaterial({color:'#3f95c9',roughness:.24,metalness:.04,transparent:true,opacity:.96,side:THREE.DoubleSide});
const ocean=new THREE.Mesh(oceanGeo,oceanMat);ocean.rotation.x=-Math.PI/2;ocean.position.set(0,-.15,112);ocean.receiveShadow=true;scene.add(ocean);
const oceanBase=oceanGeo.attributes.position.array.slice();
const foamStrips=[];
for(let i=0;i<5;i++){const foam=new THREE.Mesh(new THREE.PlaneGeometry(230-i*10,1.35),new THREE.MeshBasicMaterial({color:'#f8ffff',transparent:true,opacity:.3-i*.04,side:THREE.DoubleSide,depthWrite:false}));foam.rotation.x=-Math.PI/2;foam.position.set(0,.09,66.5+i*1.8);scene.add(foam);foamStrips.push(foam)}
const horizonGlow=new THREE.Mesh(new THREE.PlaneGeometry(300,38),new THREE.MeshBasicMaterial({color:'#f7b89b',transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false}));horizonGlow.position.set(0,15,144);scene.add(horizonGlow);
for(const x of [-40,-28,-15,16,31,45]){const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1.2+Math.abs(x)%3*.22),mat('#6f6d75'));rock.position.set(x,.85,70+Math.abs(x)%3*2.5);rock.rotation.set(.25,.3,0);rock.castShadow=true;rock.receiveShadow=true;scene.add(rock)}
function dune(x,z,sx,sz,sy=.8){const d=new THREE.Mesh(new THREE.SphereGeometry(1.9,18,14),sandMat);d.scale.set(sx,sy,sz);d.position.set(x,.7,z);d.castShadow=false;d.receiveShadow=true;scene.add(d)}
[[-105,51,5.5,1.8,1.0],[-82,54,5.2,1.7,.9],[-60,49,4.0,1.4,.9],[-36,48,4.6,1.5,.95],[-18,52,5.5,1.8,1.05],[8,49,6.6,2.0,.92],[28,53,5.1,1.7,1.0],[44,49,3.8,1.3,.8],[64,52,4.6,1.6,.9],[85,49,5.6,1.8,1.0],[108,54,4.7,1.5,.8]].forEach(v=>dune(...v));
// v90: buildings directly OUTSIDE both sides of the playable map.
// They form a dense streetscape around the festival instead of floating in
// distant mountain silhouettes. Center rear skyline stays behind the stage.
const nearbyCity=[
 // left: a staggered front row visible from the sea and audience cameras
 [-60,-47,9,13,9,3,5,.09,0],[-61,-34,10,16,10,3,6,.02,1],
 [-62,-20,8,12,8,2,4,.04,2],[-60,-7,10,18,9,3,6,-.06,3],
 [-61,8,9,15,9,3,5,.07,4],[-62,22,10,17,9,3,6,.02,1],
 [-60,31,10,14,9,3,5,.04,2],[-62,40,9,13,9,2,4,.06,0],
 // right edge, same density but varied heights and façade rhythm
 [60,-47,10,16,9,3,6,-.04,3],[61,-34,8,13,9,2,5,.04,4],
 [62,-20,10,19,9,3,7,-.02,0],[61,-7,9,15,9,3,5,.04,2],
 [60,8,10,18,10,3,6,-.04,1],[62,22,9,13,9,3,4,.05,3],
 [61,31,10,16,9,3,5,-.04,4],[60,40,9,14,8,2,4,-.08,1],
 // second side row adds depth, but still outside the visitor map
 [-73,-40,10,20,11,3,7,.09,1],[-74,-15,9,17,9,3,6,.12,3],
 [-73,13,10,21,10,3,7,.07,0],[-74,34,11,18,10,3,6,.06,4],
 [73,-40,9,19,11,3,7,-.06,2],[74,-15,11,17,9,3,6,-.1,1],
 [73,13,10,22,10,3,7,-.05,4],[74,34,10,18,10,3,6,-.08,0],
 // rear buildings are behind the stage, with enough separation from mountains
 [-53,-72,10,13,10,3,4,.03,2],[-39,-72,11,17,9,3,5,.03,4],
 [-25,-74,9,14,9,3,5,-.04,1],[25,-74,9,14,9,3,5,.04,3],
 [39,-72,11,17,9,3,5,-.03,2],[53,-72,10,13,10,3,4,-.03,0]
];
nearbyCity.forEach(v=>createBackdropBuilding(...v));
// Recreate the dramatic v89 mountain silhouette, in a separate distant row.
// Center mountains are shifted farther back so not a single building sits inside
// their mesh footprint. Mountain height and broad shoulders match the v89 style.
[
 [-124,-170,14,18,12,.3],[-102,-181,22,28,18,.14],
 [-72,-186,28,38,21,-.08],[-22,-190,24,31,20,.11],
 [29,-190,26,35,22,-.18],[79,-183,20,27,17,.09],
 [121,-170,15,20,12,-.22],[-150,-159,18,25,16,.24],
 [149,-159,18,25,16,-.24]
].forEach(v=>createMountain(...v));
// Main stage faces the audience: far north = negative z.
cube(45,1.7,14,dark,0,1,-25);cube(47,1.2,1,metal,0,2.05,-17.3);cube(46,1.5,1,dark,0,13.8,-31);cube(1,13.8,1,metal,-22,7.8,-31);cube(1,13.8,1,metal,22,7.8,-31);cube(46,11.8,.6,dark,0,7.2,-31);
const sign=new THREE.Mesh(new THREE.PlaneGeometry(24,1.6),label('ONEseason',78,'#dcfd8b','#18172e'));sign.position.set(0,13.9,-29.85);scene.add(sign);

// Two full-height portrait poster bays just outside the left/right stage pillars.
// Replace public/assets/posters/left.jpg and right.jpg to publish posters to everyone.
// A missing image retains its local illustrated placeholder, never a broken plane.
function makePosterFallback(side){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=1024;
 const ctx=canvas.getContext('2d');
 const g=ctx.createLinearGradient(0,0,512,1024);
 if(side==='left'){g.addColorStop(0,'#342760');g.addColorStop(1,'#151e35')}
 else{g.addColorStop(0,'#173d4b');g.addColorStop(1,'#1a1a39')}
 ctx.fillStyle=g;ctx.fillRect(0,0,512,1024);
 ctx.strokeStyle='rgba(235,255,171,.38)';ctx.lineWidth=6;ctx.strokeRect(27,27,458,970);
 ctx.textAlign='center';ctx.fillStyle='#e6fbad';
 ctx.font='bold 52px Arial';ctx.fillText('ONEseason',256,355);
 ctx.fillStyle='#ffffff';ctx.font='bold 70px Arial';ctx.fillText('POSTER',256,480);
 ctx.font='bold 31px Arial';ctx.fillText(side==='left'?'LEFT STAGE':'RIGHT STAGE',256,550);
 ctx.fillStyle='#c7d0df';ctx.font='26px Arial';ctx.fillText('Replace poster image',256,715);
 const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;
}
function createStagePoster(side){
 const x=side==='left'?-27.4:27.4;
 const width=6.15,height=13.1,z=-26.7;
 const group=new THREE.Group();group.position.set(x,7.25,z);scene.add(group);
 const body=new THREE.Mesh(new THREE.BoxGeometry(7.05,14.25,.45),mat('#141a27',.8));group.add(body);
 for(const dx of [-3.4,3.4]){
  const rail=new THREE.Mesh(new THREE.BoxGeometry(.14,14.15,.18),mat('#9aabbd',.48));
  rail.position.set(dx,0,.34);group.add(rail);
 }
 for(const dy of [-6.95,6.95]){
  const rail=new THREE.Mesh(new THREE.BoxGeometry(7.0,.14,.18),mat('#9aabbd',.48));
  rail.position.set(0,dy,.34);group.add(rail);
 }
 const fallback=makePosterFallback(side);
 const material=new THREE.MeshBasicMaterial({map:fallback,side:THREE.DoubleSide,toneMapped:false});
 const plane=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
 plane.position.z=.256;group.add(plane);
 const texturePath='/assets/posters/'+side+'.jpg';
 new THREE.TextureLoader().load(texturePath,texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
  // Cover the entire portrait panel with a centered crop, no distortion.
  const targetAspect=width/height;
  const image=texture.image;
  const imageAspect=(image?.naturalWidth||image?.width||1)/(image?.naturalHeight||image?.height||1);
  if(imageAspect>targetAspect){
   texture.repeat.set(targetAspect/imageAspect,1);
   texture.offset.set((1-texture.repeat.x)/2,0);
  }else{
   texture.repeat.set(1,imageAspect/targetAspect);
   texture.offset.set(0,(1-texture.repeat.y)/2);
  }
  texture.needsUpdate=true;
  material.map=texture;material.needsUpdate=true;fallback.dispose();
 },undefined,()=>{/* No uploaded poster yet: keep the clear fallback board. */});
}
createStagePoster('left');
createStagePoster('right');

for(let x=-22;x<=22;x+=2.2){cube(.13,8.6,.13,metal,x,6.2,-30.1,false);let bulb=sphere(.19,mat(['#ff5b98','#bc9dff','#deff8c','#68e6f3'][Math.round((x+22)/2.2)%4],.2,'#ffffff'),x,13.15,-28.9);bulb.material.emissiveIntensity=1.2}
for(let s of [-1,1]){for(let j=0;j<2;j++){let x=s*18.5,z=-25+j*3.4;cube(3.8,4.3,2.7,dark,x,4.4,z);for(let dy of [3.2,5.5]){let o=cylinder(1,1,.16,metal,x,dy,z+1.44);o.rotation.x=Math.PI/2;let p=cylinder(.72,.72,.17,mat('#0d0e1b'),x,dy,z+1.58);p.rotation.x=Math.PI/2}}}
// drum kit + guitars on stage
cylinder(1.55,1.55,1.2,mat('#d671c0',.5),0,3.25,-25);for(let x of [-2.2,2.2]){cylinder(.82,.82,.72,mat('#94bbfe'),x,3.65,-26);cylinder(.07,.07,3,metal,x*1.3,3.8,-26)}
for(let x of [-8,8]){cylinder(.12,.12,3.2,metal,x,4,-24);sphere(.18,mat('#fcf6d5'),x,5.65,-24)}
// Crowd barrier
for(let x=-34;x<=34;x+=3){cube(.11,1.45,.11,metal,x,.9,-13.2);if(x<34)cube(3,.13,.13,metal,x+1.5,1.48,-13.2)}
// Walkway and picnic area: use the existing continuous lawn directly.
// Do not add a second slab at the exact same height; its depth artifacts
// were responsible for the flashing horizontal stripes in the audience zone.
// v82: each blanket + food + pillows is one local-coordinate 3D group.
// Never expandWorldZ() independently for its accessories: it previously
// pulled the tray, food and pillow away from the blanket by different amounts.
const picnicGroups=[];
const picnicProps=[];
function addPicnicCube(group,w,h,d,material,x,y,z,cast=true){
 const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
 o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;group.add(o);return o;
}
function addPicnicCylinder(group,rt,rb,h,material,x,y,z){
 const o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,14),material);
 o.position.set(x,y,z);o.castShadow=true;group.add(o);return o;
}
function addPicnicSphere(group,r,material,x,y,z){
 const o=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),material);
 o.position.set(x,y,z);o.castShadow=true;group.add(o);return o;
}
mats.forEach((matData,i)=>{
 const picnicGroup=new THREE.Group();
 picnicGroup.position.set(matData.worldX,0,matData.worldZ);
 scene.add(picnicGroup);picnicGroups.push(picnicGroup);
 // All accessory coordinates below are intentionally LOCAL to this group.
 const m={x:0,z:0,c:matData.c};
 const pcube=(...args)=>addPicnicCube(picnicGroup,...args);
 const pcylinder=(...args)=>addPicnicCylinder(picnicGroup,...args);
 const psphere=(...args)=>addPicnicSphere(picnicGroup,...args);
 const blanket=pcube(8.8,.10,6.1,mat(m.c),m.x,.13,m.z);blanket.rotation.y=0;
 for(let edge of [-1,1])pcube(8.5,.025,.11,mat('#f8f6e5'),m.x,.22,m.z+edge*2.42,false);
 for(let j=0;j<2;j++){const pillow=pcube(1.5,.28,.9,mat(['#ffefe0','#e2f2fa','#fdf2ce','#fce0f5'][j%4]),m.x-2.6+j*5.2,.34,m.z-2.0);pillow.rotation.y=.15*(j?1:-1);picnicProps.push(pillow)}
 const table=pcylinder(.74,.84,.58,mat('#7d624e'),m.x+3.35,.55,m.z+2.04);picnicProps.push(table);
 const lamp=psphere(.19,new THREE.MeshStandardMaterial({color:'#fff1bf',emissive:'#ffd982',emissiveIntensity:1.3}),m.x+3.35,.98,m.z+2.04);picnicProps.push(lamp);
 // Food is placed on the grass just IN FRONT of the picnic mat, without
 // changing any of the existing rest-pose or movement coordinates.
 const picnicTray=pcube(3.8,.10,1.65,mat('#b48b69'),m.x-.75,.16,m.z+1.65,false);
 // Two realistic paper cups: taper, open dark inner surface, bright rim.
 const paperCupMaterial=mat(i%2?'#f8e9d5':'#faf8f0',.91),rimMat=mat('#fffdf8',.86);
 for(let j=0;j<2;j++){
  const cx=m.x-2.05+j*.65,cz=m.z+1.60;
  const cup=pcylinder(.24,.17,.57,paperCupMaterial,cx,.49,cz);cup.castShadow=false;
  const top=new THREE.Mesh(new THREE.CircleGeometry(.189,16),mat('#a17d5b'));top.rotation.x=-Math.PI/2;top.position.set(cx,.778,cz);picnicGroup.add(top);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.235,.028,6,20),rimMat);rim.rotation.x=Math.PI/2;rim.position.set(cx,.79,cz);picnicGroup.add(rim);
 }
 // Pizza: low round pizza with tomato and cheese, separate raised crust,
 // plus a few pepperoni pieces. Instanced only a handful per picnic area.
 const pizzaX=m.x-.38,pizzaZ=m.z+1.70;
 const pizzaPlate=pcylinder(.83,.83,.07,mat('#f0e6d4'),pizzaX,.29,pizzaZ);pizzaPlate.castShadow=false;
 const pizzaCrust=pcylinder(.72,.72,.07,mat('#bb8654'),pizzaX,.37,pizzaZ);pizzaCrust.castShadow=false;
 const sauce=pcylinder(.62,.62,.025,mat('#d25a42'),pizzaX,.423,pizzaZ);sauce.castShadow=false;
 const cheese=pcylinder(.56,.56,.025,mat('#efcb79'),pizzaX,.448,pizzaZ);cheese.castShadow=false;
 for(let k=0;k<5;k++){
  const a=k*2.4+i*.27;
  const topping=pcylinder(.105,.105,.017,mat('#b44d3d'),pizzaX+Math.cos(a)*.32,.475,pizzaZ+Math.sin(a)*.32);topping.castShadow=false;
 }
 // Snack bag and visible puffed-corn/chips spilling onto the tray.
 const snackX=m.x+.52,snackZ=m.z+1.70;
 const bag=pcube(.62,.91,.29,mat(i%2?'#dba5ef':'#ffce7b'),snackX,.69,snackZ);bag.rotation.z=.13;bag.castShadow=false;
 const bagStripe=pcube(.65,.14,.31,mat('#fff2dd'),snackX,.83,snackZ);bagStripe.rotation.z=.13;bagStripe.castShadow=false;
 for(let k=0;k<7;k++){
  const a=k*2.4+i*.3;
  const crumb=psphere(.085+(k%3)*.022,mat('#f2db88'),snackX+Math.cos(a)*(.52+.10*(k%2)),.3,snackZ+Math.sin(a)*.36);crumb.castShadow=false;
 }

});
// Clickable shoreline benches: select a seat with a single tap, walk over,
// then sit in sync for all visitors using the existing pose/move API.
const benchPickMeshes=[],benchSeats=[];
const benchWood=mat('#a87d58'),benchSupports=mat('#373f46',.45);
for(const x of [-33,-11,11,33]){
 const z=42;
 const seat=cube(5.2,.24,1.5,benchWood,x,.99,z);benchPickMeshes.push(seat);seat.userData.benchCenter={x,z};
 // Backless beach bench: no backrest mesh, so seated avatars stay visible from behind.
 for(const dx of [-2.08,2.08]){
  const leg=cube(.19,.88,.19,benchSupports,x+dx,.46,z);leg.userData.benchCenter={x,z};benchPickMeshes.push(leg);
  const arm=cube(.23,.14,1.58,benchSupports,x+dx,1.23,z);arm.userData.benchCenter={x,z};benchPickMeshes.push(arm);
 }
 for(const slot of [-1,1]){
  const wx=x+slot*1.14,wz=z+.12;
  benchSeats.push({x:wx/.058+600,y:(wz-8)/.058+500,wx,wz,center:x});
 }
}
function palmTree(x,z,h=6.3){cylinder(.42,.62,h,wood,x,h*.5,z);const top=sphere(1.2,mat('#679873'),x,h+.65,z);top.scale.set(1.2,.8,1.2);for(let i=0;i<5;i++){const leaf=new THREE.Mesh(new THREE.CapsuleGeometry(.14,3.1,4,8),mat('#5a8e62'));leaf.position.set(x,h+.4,z);leaf.rotation.z=-1.1+i*.55;leaf.rotation.y=i*1.22;leaf.castShadow=true;scene.add(leaf)}}
[[-46,52,6.4],[-34,63,6.7],[-18,58,6.0],[18,60,6.3],[34,64,6.8],[48,54,6.2]].forEach(v=>palmTree(...v));
function umbrella(x,z,c){const pole=cylinder(.08,.08,2.2,metal,x,1.1,z);const top=new THREE.Mesh(new THREE.ConeGeometry(2.3,1.15,18,1,true),mat(c,.7));top.position.set(x,2.5,z);top.rotation.y=.4;top.castShadow=true;scene.add(top);cube(1.5,.12,1.1,mat('#c79b74'),x,.36,z+1.7,false)}
[[-25,61,'#f4a9a9'],[-6,65,'#ffd48f'],[14,60,'#a6d8f2'],[33,66,'#c8b4ef']].forEach(v=>umbrella(...v));
// 3D performance information board with real shared playlist rendered as HTML in the world.
const boardElement=document.createElement('div');
boardElement.className='festival-board';boardElement.innerHTML='<div class="board-brand">ONEseason · 공연 안내</div><div class="board-row"><small>● <span id="boardStatus">공연 대기 중</span></small><strong id="boardCurrent">현재 재생 중인 곡 없음</strong></div><div class="board-row"><small>다음 공연</small><strong id="boardNext">예약된 곡 없음</strong></div><div class="board-foot">현재 관객 <b id="boardVisitors">0</b>명</div>';
const boardObject=new CSS3DObject(boardElement);boardObject.position.set(-45.6,4.6,12);boardObject.rotation.y=.25;boardObject.scale.set(.017,.017,.017);scene.add(boardObject);
cube(8,.5,.8,wood,-45.6,.4,11.95);for(let x of [-49,-42.2])cube(.22,6,.22,metal,x,3,12);
// trees, lanterns, food stalls
for(let x of [-46,48])for(let z of [-9,9,23]){cylinder(.45,.65,5,wood,x,2.5,z);sphere(2.7,mat('#477f63'),x,6,z);sphere(1.7,mat('#5a9a70'),x+1.7,5.7,z-1)}
for(let x of [-46,47]){cube(5,2.8,3,mat('#bc7097'),x,1.6,15);cube(5.8,.35,4.1,mat('#f4c783'),x,3.2,15);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4,1.1),label(x<0?'SNACKS':'MERCH',70,'#fbe9dc','#9e446f'));banner.position.set(x,2.2,16.56);scene.add(banner)}

for(let x of [-46,47]){cube(5.5,2.9,3.4,mat('#6b8ac7'),x,1.65,22);cube(6.4,.35,4.5,mat('#f4c783'),x,3.28,22);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4.5,1.1),label(x<0?'FOOD':'REST',68,'#fef7e6','#4c6588'));banner.position.set(x,2.2,23.86);scene.add(banner)}
// Subtle festival bulbs across the red line: the end of the rock-play zone.
// Positioned at z=18, NOT along or through the picnic row at z=28.
const audienceLightBulbColors=['#ffdb8a','#fca5b5','#a8ecff','#c7f591'];
for(let x=-44;x<=44;x+=8){
 const pole=cylinder(.07,.07,2.6,metal,x,1.3,STAGE_REAR_EDGE_Z);
 pole.castShadow=false;
 for(let j=0;j<4;j++){
  const bx=x+j*2;
  const color=audienceLightBulbColors[(Math.round((x+44)/8)+j)%4];
  const bulb=sphere(.105,new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.8,roughness:.4}),bx,2.6+Math.sin(j/3*Math.PI)*.1,STAGE_REAR_EDGE_Z);
  bulb.castShadow=false;
 }
}

const pier=cube(7.2,.14,20,mat('#8b6b53'),40,.18,77,false);pier.receiveShadow=true;for(let dz=69;dz<=85;dz+=4){for(let dx of [37.2,42.8])cube(.24,1.7,.24,wood,dx,.72,dz)}

// Move picnic, signage, stalls, trees, benches, shoreline and sea back as
// one environmental set. Keep the rebuilt static lawn and floor unchanged.
// All objects are positioned via the same world-space mapping as avatars.
const fixedGroundSet=new Set([floor,lawn,picnicLawn,...picnicGroups]);
for(const item of scene.children){
 if(fixedGroundSet.has(item))continue;
 if(item.position.z>8 && item.position.y<25){
  item.position.z=expandWorldZ(item.position.z);
 }
}
// Bench targets are server coordinates, not world coordinates: update only
// their visible world positions after the corresponding meshes are shifted.
for(const seat of benchSeats){
 seat.wz=expandWorldZ(seat.wz);
}

const stageLights=[];for(let i=0;i<7;i++){let x=-17+i*5.6;let l=new THREE.SpotLight(['#ff64a5','#8c84ff','#c4fb79','#68e8f3'][i%4],110,65,.50,.65);l.position.set(x,9,-19);l.target.position.set(x*.65,0,0);scene.add(l,l.target);stageLights.push(l)}
// Controlled, pooled lighting + flame and spark bursts. No per-frame geometry allocation.
const flameGroups=[],emberMat=new THREE.MeshBasicMaterial({color:'#ffc979',transparent:true,opacity:.95,depthWrite:false});
for(let side of [-1,1])for(let j=0;j<3;j++){
 const flame=new THREE.Group();flame.position.set(side*(8+j*4),2.35,-18.5);scene.add(flame);
 const colors=['#ffe98a','#ff9f35','#ff4d4d'];for(let k=0;k<3;k++){const mesh=new THREE.Mesh(new THREE.ConeGeometry(.38-k*.1,1.3+k*.32,7),new THREE.MeshBasicMaterial({color:colors[k],transparent:true,opacity:.8}));mesh.position.y=.6+k*.25;mesh.rotation.z=k*.12;flame.add(mesh)}flameGroups.push(flame)
}
const sparks=[];const sparkGeo=new THREE.SphereGeometry(.095,5,4);
for(let i=0;i<65;i++){const mesh=new THREE.Mesh(sparkGeo,emberMat);mesh.visible=false;scene.add(mesh);sparks.push({mesh,seed:i*0.91})}
function animateShow(t){let sec=t*.001;stageLights.forEach((l,i)=>{const beat=70+65*Math.sin(sec*(state.music.id&&!state.music.paused?4:1.1)+i*2)**2;l.intensity=beat*stageAccentFactor;l.target.position.x=(-17+i*5.6)*.65+Math.sin(sec*.85+i)*7});
 flameGroups.forEach((f,i)=>{const engaged=!!state.music.id&&!state.music.paused;const pulse=Math.max(0,Math.sin(sec*3.5+i*1.7));f.visible=engaged&&pulse>.68;f.scale.y=.3+pulse*1.65});
 sparks.forEach((q,i)=>{const active=!!state.music.id&&!state.music.paused;const phase=(sec*.65+q.seed)%3.6;q.mesh.visible=active&&phase<1.7;if(q.mesh.visible){const side=i%2?-1:1;q.mesh.position.set(side*(8+(i%3)*4)+Math.sin(i*2.1)*phase,3+phase*2.2,-18+Math.cos(i)*phase*.3);q.mesh.material.opacity=.9}})
}
for(let i=0;i<55;i++){let x=(Math.sin(i*44.7)*.5+.5)*66-33,z=(Math.sin(i*21.8)*.5+.5)*40-10;if(z<12&&z>-8){let c=sphere(.10,mat(['#d9ee98','#d78bae','#8cc5eb'][i%3]),x,.1,z);c.castShadow=false}}

// ONEseason hourly firework show. The event clock uses the same server-adjusted
// time as shared music/slam. UTC hour boundaries also coincide with every
// local :00, including Korea; no per-user timer or database is required.
// Deterministic seeds/locations keep the show consistent across visitors.
const fireworkCount=180;
const fireworks=[];
const fireworkColors=['#ffe48a','#ff779e','#8ce9ff','#cda8ff','#8cffab','#ffb36b'];
const fireworkLocations=[[-19,28,-8],[6,34,-5],[26,30,5],[-5,39,15],[14,35,-18],[0,31,7]];
const sparkleCanvas=document.createElement('canvas');sparkleCanvas.width=sparkleCanvas.height=64;
const sparkleCtx=sparkleCanvas.getContext('2d');
const glow=sparkleCtx.createRadialGradient(32,32,1,32,32,32);
glow.addColorStop(0,'rgba(255,255,255,1)');glow.addColorStop(.22,'rgba(255,255,255,.93)');glow.addColorStop(.55,'rgba(255,255,255,.35)');glow.addColorStop(1,'rgba(255,255,255,0)');
sparkleCtx.fillStyle=glow;sparkleCtx.fillRect(0,0,64,64);
const fireworkDot=new THREE.CanvasTexture(sparkleCanvas);
for(let j=0;j<fireworkLocations.length;j++){
 const positions=new Float32Array(fireworkCount*3),velocity=new Float32Array(fireworkCount*3),colors=new Float32Array(fireworkCount*3);
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
 const material=new THREE.PointsMaterial({size:1.65,map:fireworkDot,vertexColors:true,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,alphaTest:.015,sizeAttenuation:true,fog:false});
 const cloud=new THREE.Points(geometry,material);cloud.frustumCulled=false;cloud.visible=false;cloud.renderOrder=35;scene.add(cloud);
 const rocket=new THREE.Sprite(new THREE.SpriteMaterial({map:fireworkDot,color:fireworkColors[j],transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));rocket.scale.set(2.4,2.4,1);rocket.visible=false;scene.add(rocket);
 fireworks.push({cloud,rocket,velocity,positions,colors,location:fireworkLocations[j],start:j*.72,explosionDelay:.7+(j%2)*.12});
}
let lastFireworkHour=-1,fireworkStart=0,fireworkActive=false;
function startHourlyFireworks(nowMilliseconds,frameTime){
 const hourKey=Math.floor(nowMilliseconds/3600000);
 const fraction=nowMilliseconds-hourKey*3600000;
 if(fraction>=5000||hourKey===lastFireworkHour)return;
 lastFireworkHour=hourKey;
 // Backdate to the clock boundary so all viewers see the same phase.
 fireworkStart=frameTime-fraction;
 fireworkActive=true;
 for(let j=0;j<fireworks.length;j++){
  const f=fireworks[j],color=new THREE.Color(fireworkColors[j]);
  for(let i=0;i<fireworkCount;i++){
   // Golden-angle sphere distribution, with slight deterministic speed changes.
   const v=1-2*(i+.5)/fireworkCount;
   const ang=i*2.399963229728653 + j*.43;
   const radius=Math.sqrt(1-v*v);
   const speed=5.8+((i*73+j*19)%57)/57*5.5;
   const k=i*3;
   f.velocity[k]=Math.cos(ang)*radius*speed;
   f.velocity[k+1]=v*speed;
   f.velocity[k+2]=Math.sin(ang)*radius*speed;
   const warm=1-((i*17+j*11)%9)*.045;
   f.colors[k]=color.r*warm;f.colors[k+1]=color.g*warm;f.colors[k+2]=color.b*warm;
  }
  f.cloud.geometry.attributes.color.needsUpdate=true;
  f.cloud.visible=false;f.rocket.visible=false;
 }
}
function updateHourlyFireworks(t){
 // serverDelta comes from the same timestamp used for music synchronization.
 const now=Date.now()+(Number.isFinite(state.serverDelta)?state.serverDelta:0);
 startHourlyFireworks(now,t);
 if(!fireworkActive)return;
 const seconds=(t-fireworkStart)*.001;
 let any=false;
 for(const f of fireworks){
  const elapsed=seconds-f.start,explodeAt=f.explosionDelay;
  const [x,y,z]=f.location;
  f.rocket.visible=elapsed>=0&&elapsed<explodeAt;
  if(f.rocket.visible){any=true;const progress=elapsed/explodeAt;f.rocket.position.set(x,y-25+25*progress*progress,z);f.rocket.material.opacity=.95-progress*.2;}
  const burst=elapsed-explodeAt;
  f.cloud.visible=burst>=0&&burst<3.65;
  if(!f.cloud.visible)continue;
  any=true;
  const fade=burst<.24?burst/.24:Math.pow(Math.max(0,1-(burst-.24)/3.41),1.3);
  f.cloud.material.opacity=.97*fade;
  const pos=f.positions,vel=f.velocity;
  const drag=(1-Math.exp(-burst*.55))/.55;
  for(let i=0;i<pos.length;i+=3){
   pos[i]=x+vel[i]*drag;
   pos[i+1]=y+vel[i+1]*drag-2.4*burst*burst;
   pos[i+2]=z+vel[i+2]*drag;
  }
  f.cloud.geometry.attributes.position.needsUpdate=true;
 }
 if(!any&&seconds>9){fireworkActive=false;for(const f of fireworks){f.cloud.visible=false;f.rocket.visible=false}}
}


function updateOcean(t){
 const sec=t*.001;
 const a=ocean.geometry.attributes.position.array;
 for(let i=0;i<a.length;i+=3){
  const x=oceanBase[i],y=oceanBase[i+1];
  a[i+2]=Math.sin(x*.12+sec*1.18)*.34+Math.cos(y*.17+sec*.84)*.17;
 }
 ocean.geometry.attributes.position.needsUpdate=true;
 ocean.geometry.computeVertexNormals();
 const active=!!state.music.id&&!state.music.paused;
 foamStrips.forEach((foam,i)=>{foam.position.z=expandWorldZ(56.2+i*1.45)+Math.sin(sec*1.25+i*.8)*.28;foam.material.opacity=.16+Math.sin(sec*1.8+i)*.08+(active?.06:0)});
}
function updateEnvironment(force=false){
 const now=new Date();
 const minutes=now.getHours()*60+now.getMinutes();
 if(!force&&updateEnvironment.lastMinute===minutes)return;
 updateEnvironment.lastMinute=minutes;
 const hour=minutes/60;
 let phase='day';
 if(hour>=17&&hour<19)phase='sunset';
 else if(hour>=19||hour<4)phase='night';
 else if(hour>=4&&hour<6)phase='dawn';
 const themes={
  day:{bg:'#86c8ff',fog:'#86c8ff',sky:'#8ecfff',hemiSky:'#e4f6ff',ground:'#58745c',hemi:2.45,grass:'#4a7b60',sand:'#e0c896',wet:'#d5b57c',ocean:'#4098d0',sunColor:'#fff0c0',sunLight:'#fff4cd',sun:2.95,moon:0.15,badge:'☀️ &nbsp; 낮 공연 <span>✦</span>',glow:'#f6d0a8',stage:.42,building:'#b8d1df',roof:'#829fbb',window:'#f6f9fa',windowOpacity:.25,mountain:'#a5bace'},
  sunset:{bg:'#f39b7e',fog:'#f0a184',sky:'#ffad93',hemiSky:'#ffd8c6',ground:'#6a5755',hemi:1.95,grass:'#56715c',sand:'#ebc28d',wet:'#d3a46d',ocean:'#4c87c2',sunColor:'#ff9855',sunLight:'#ffcb95',sun:2.45,moon:0.25,badge:'🌇 &nbsp; 석양 공연 <span>✦</span>',glow:'#ff8b66',stage:.85,building:'#c4a9c3',roof:'#8d789a',window:'#ffe8c9',windowOpacity:.27,mountain:'#bf9eb4'},
  night:{bg:'#091326',fog:'#091326',sky:'#0f1b39',hemiSky:'#45608f',ground:'#243330',hemi:1.15,grass:'#2d5244',sand:'#a98d67',wet:'#907558',ocean:'#1f4e86',sunColor:'#ffcf88',sunLight:'#b5c8ff',sun:0.0,moon:1.75,badge:'🌙 &nbsp; 달빛 공연 <span>✦</span>',glow:'#6d84a8',stage:1.12,building:'#586a87',roof:'#425477',window:'#ffe7b8',windowOpacity:.5,mountain:'#657eaa'},
  dawn:{bg:'#efab8d',fog:'#efab8d',sky:'#ffb79e',hemiSky:'#ffd9cb',ground:'#655a58',hemi:1.75,grass:'#4d6858',sand:'#e6c08f',wet:'#cda06e',ocean:'#4a82be',sunColor:'#ff9b68',sunLight:'#ffd0a1',sun:1.65,moon:0.55,badge:'🌄 &nbsp; 새벽 석양 <span>✦</span>',glow:'#ff9d76',stage:.72,building:'#b6aabd',roof:'#897d9d',window:'#ffe7d1',windowOpacity:.3,mountain:'#b8a0b7'}
 };
 const p=themes[phase];
 skyPeriod=phase;clouds.visible=phase==='day'||phase==='sunset'||phase==='dawn';stars.visible=phase==='night';
 cloudMaterial.opacity=phase==='day'?.88:.48;
 scene.background.set(p.bg);scene.fog.color.set(p.fog);skyDome.material.color.set(p.sky);horizonGlow.material.color.set(p.glow);
 hemi.color.set(p.hemiSky);hemi.groundColor.set(p.ground);hemi.intensity=p.hemi;
 grass.color.set(p.grass);sandMat.color.set(p.sand);wetSandMat.color.set(p.wet);oceanMat.color.set(p.ocean);oceanMat.emissive.set(p.ocean);oceanMat.emissive.multiplyScalar(phase==='night'?0.18:.05);
 buildingBodyMats.forEach((m,i)=>m.color.set(p.building).multiplyScalar([1,1.07,.96,1.12,1.02][i%5]));buildingRoofMats.forEach(m=>m.color.set(p.roof));buildingWindowMats.forEach(m=>{m.color.set(p.window);m.opacity=p.windowOpacity});mountainMats.forEach(m=>m.color.set(p.mountain));
 sunOrb.material.color.set(p.sunColor);sunLight.color.set(p.sunLight);sunLight.intensity=p.sun;moonLight.intensity=p.moon;stageAccentFactor=p.stage;
 if(weatherBadge)weatherBadge.innerHTML=p.badge;
 let sunProgress=null;
 if(hour>=4&&hour<6)sunProgress=(hour-4)/15;
 else if(hour>=6&&hour<17)sunProgress=(hour-4)/15;
 else if(hour>=17&&hour<19)sunProgress=(hour-4)/15;
 if(sunProgress!==null){
  const sx=THREE.MathUtils.lerp(-60,60,Math.min(1,Math.max(0,sunProgress)));
  const sy=8+Math.sin(Math.min(1,Math.max(0,sunProgress))*Math.PI)*42;
  sunOrb.visible=true;sunLight.visible=p.sun>0.05;sunOrb.position.set(sx,sy,116);sunLight.position.set(sx*.8,sy+8,90);
 }else{sunOrb.visible=false;sunLight.visible=false}
 let moonProgress=null;
 if(hour>=19)moonProgress=(hour-19)/9;
 else if(hour<4)moonProgress=(hour+5)/9;
 else if(hour>=4&&hour<6)moonProgress=.98-(hour-4)*.22;
 if(moonProgress!==null){
  const clamped=Math.min(1,Math.max(0,moonProgress));
  const mx=THREE.MathUtils.lerp(58,-58,clamped);
  const my=9+Math.sin(clamped*Math.PI)*30;
  moonOrb.visible=true;moonLight.visible=p.moon>0.08;moonOrb.position.set(mx,my,112);moonLight.position.set(mx*.72,my+6,88);
 }else{moonOrb.visible=false;moonLight.visible=false}
}
for(const light of [hemi,sunLight,moonLight])light.layers.enable(1);
updateEnvironment(true);


// Golden impact spark: visible to every attendee when the synchronized clink lands.
const toastSparks=[];
function spawnToastSpark(x,y){
 const wp=toWorld({x,y});
 for(let i=0;i<24;i++){
  const angle=i*Math.PI*2/24;
  const obj=new THREE.Mesh(new THREE.SphereGeometry(.065,6,6),new THREE.MeshBasicMaterial({color:i%3?'#ffcb3b':'#fff5b1',transparent:true,opacity:.95,depthWrite:false}));
  obj.position.set(wp.x,1.35,wp.z);scene.add(obj);
  toastSparks.push({obj,start:performance.now(),vx:Math.cos(angle)*(1.0+Math.random()*.8),vz:Math.sin(angle)*(1.0+Math.random()*.8),vy:Math.random()*1.2});
 }
}
function animateToastSparks(t){for(let i=toastSparks.length-1;i>=0;i--){const p=toastSparks[i],dt=(t-p.start)/1000;if(dt>1.1){scene.remove(p.obj);p.obj.geometry.dispose();p.obj.material.dispose();toastSparks.splice(i,1);continue}p.obj.position.x+=p.vx*.017;p.obj.position.z+=p.vz*.017;p.obj.position.y+=p.vy*.012-.012;p.obj.material.opacity=Math.max(0,1-dt/1.1)}}
// Real Quaternius Universal Base Characters glTF hair assets (CC0) supplied by the user.
// Each geometry is loaded once. Avatar instances clone it and tint the surface locally.
const hairLoader=new GLTFLoader(),hairAssetCache=new Map();
// Fits are measured against the visible avatar head (radius .81; top Y ~= .90).
// top is the local height of the hair bounding box, not an extra offset.
// Keep X/Z fairly close to the skull, with a slight forward shift for the fringe.
const hairFit={
 // Fit each external asset to the existing chibi skull (head centre y=.12).
 // The original bob's open, arch-like edge floats above the forehead. Lower
 // and shorten that specific asset; use the scalp liner to close its opening.
 short:{width:1.95,height:1.31,depth:1.85,top:.970,forward:.020},
 bob:{width:1.82,height:1.13,depth:1.76,top:.785,forward:.000},
 long:{width:2.16,height:2.30,depth:2.04,top:.915,forward:.030},
 buns:{width:2.36,height:1.62,depth:2.17,top:1.005,forward:.020},
 // Two distinct shape variations made from the licensed Quaternius assets.
 // bob2 uses compressed long-hair layers; short2 mirrors the parted cut.
 bob2:{width:2.11,height:1.53,depth:2.06,top:.925,forward:.015},
 short2:{width:1.90,height:1.12,depth:1.70,top:.895,forward:.008}
};
const hairAssetSources={bob2:'long',short2:'short'};
function getHairAsset(style){
 style=normalizeHairStyle(style);
 const source=hairAssetSources[style]||style;
 if(!hairAssetCache.has(source)){
  hairAssetCache.set(source,new Promise((resolve,reject)=>{
   hairLoader.load('/assets/hair/'+source+'.gltf',g=>{
    g.scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(g.scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    resolve({scene:g.scene,size,center});
   },undefined,reject);
  }));
 }
 return hairAssetCache.get(source);
}
// A fitted scalp liner closes the large open crown of the imported Quaternius hair.
// Its front boundary follows the natural hairline and stays ABOVE the eyebrows.
// The back wraps lower so rear hair cannot reveal a bald top at oblique camera angles.
function makeScalpLiner(color){
 const geometry=new THREE.BufferGeometry(), vertices=[],normals=[],indices=[];
 const radial=48,vertical=18,rx=.835,ry=.792,rz=.778;
 for(let j=0;j<=vertical;j++){
  const t=j/vertical;
  for(let i=0;i<=radial;i++){
   const a=i/radial*Math.PI*2;
   // +Z is the front; .35 PI in front, .58 PI in back, .48 PI at sides.
   const frontWeight=(Math.sin(a)+1)*.5;
   const maxTheta=Math.PI*(.58-.23*frontWeight);
   const theta=t*maxTheta,st=Math.sin(theta),ct=Math.cos(theta);
   const x=rx*st*Math.cos(a),y=.12+ry*ct,z=-.012+rz*st*Math.sin(a);
   vertices.push(x,y,z);
   const n=new THREE.Vector3(x/rx**2,(y-.12)/ry**2,(z+.012)/rz**2).normalize();
   normals.push(n.x,n.y,n.z);
   if(j<vertical&&i<radial){let q=j*(radial+1)+i;indices.push(q,q+radial+1,q+1,q+1,q+radial+1,q+radial+2)}
  }
 }
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 geometry.setIndex(indices);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.92,side:THREE.DoubleSide}));
 mesh.castShadow=true;mesh.receiveShadow=true;
 return mesh;
}
// Vertex-level fit to the actual chibi skull, not an arbitrary Y/Z offset.
// The avatar head is an ellipsoid: center (0,.12,0), radii (.81,.7776,.7533).
// Fitting only the crown and temple vertices preserves the original artist-made
// hairstyle silhouette, fringe, buns and long tails below the hairline.
function fitImportedHairToHead(hair,holder,style){
 // Fit imported hair against the actual chibi head shell in holder space.
 // v65 only pushed embedded vertices outward; bob hair still floated at the
 // temples because side vertices were already OUTSIDE the head shell. This
 // version can also pull selected bob vertices inward so the hairstyle sits
 // flush on the spherical head without a separate scalp cap.
 holder.updateWorldMatrix(true,true);
 hair.updateWorldMatrix(true,true);
 const holderInverse=holder.matrixWorld.clone().invert();
 const source=new THREE.Vector3(),local=new THREE.Vector3(),relative=new THREE.Vector3();
 const headCenter=new THREE.Vector3(0,.12,0);
 const headRadii=new THREE.Vector3(.81,.7776,.7533);
 let correctedVertices=0;
 hair.traverse(mesh=>{
  if(!mesh.isMesh || !mesh.geometry?.attributes?.position)return;
  mesh.geometry=mesh.geometry.clone();
  const pos=mesh.geometry.attributes.position;
  const toHolder=holderInverse.clone().multiply(mesh.matrixWorld);
  const fromHolder=toHolder.clone().invert();
  for(let i=0;i<pos.count;i++){
   source.fromBufferAttribute(pos,i);
   local.copy(source).applyMatrix4(toHolder);
   relative.copy(local).sub(headCenter);
   const ellipsoidRadius=Math.sqrt(
    (relative.x/headRadii.x)**2+
    (relative.y/headRadii.y)**2+
    (relative.z/headRadii.z)**2
   );
   let targetRadius=null;
   // Common crown/temple fit: push any penetrations outside the head.
   if(local.y>-.26 && local.y<1.02 && Math.abs(local.x)<.96 && Math.abs(local.z)<.92 && ellipsoidRadius>.06 && ellipsoidRadius<1.03){
    targetRadius=1.035;
   }
   // Bob-specific cling fit: bring side/crown verts ONTO the head shell so
   // the hairstyle no longer hovers away from the cheeks and temples.
   if(style==='bob'){
    const inBobBand = local.y>-.02 && local.y<.92 && Math.abs(local.x)<.95 && Math.abs(local.z)<.82;
    const isTempleOrCrown = Math.abs(local.x)>.24 || local.y>.36;
    if(inBobBand && isTempleOrCrown && ellipsoidRadius>.78 && ellipsoidRadius<1.25){
      targetRadius=1.025;
    }
   }
   // Short side cut: aggressively push any embedded scalp-side vertices out
   // to the head shell so the skull never pokes through holes in the mesh.
   if(style==='short2'){
    const inShortShell = local.y>-.08 && local.y<1.03 && Math.abs(local.x)<.97 && Math.abs(local.z)<.90;
    if(inShortShell && ellipsoidRadius>.18 && ellipsoidRadius<1.10){
      targetRadius=1.055;
    }
   }
   if(targetRadius!==null && ellipsoidRadius>0.0001){
    local.copy(headCenter).addScaledVector(relative,targetRadius/ellipsoidRadius);
    correctedVertices++;
   }
   source.copy(local).applyMatrix4(fromHolder);
   pos.setXYZ(i,source.x,source.y,source.z);
  }
  pos.needsUpdate=true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
 });
 return correctedVertices;
}
function attachImportedHair(neck,style,color){
 const holder=new THREE.Group();neck.add(holder);
 if(stageForeground)holder.layers.set(1);
 getHairAsset(style).then(({scene,size,center})=>{
  if(!neck.parent)return;
  const hair=scene.clone(true),fit=hairFit[style];
  const sx=fit.width/Math.max(size.x,.001);
  const sy=fit.height/Math.max(size.y,.001);
  const sz=fit.depth/Math.max(size.z,.001);
  // Alternate men's style uses a mirrored side part; this remains an actual
  // Quaternius mesh rather than procedurally generated hair primitives.
  const mirrored=style==='short2';
  hair.scale.set(mirrored?-sx:sx,sy,sz);
  hair.position.set(-center.x*(mirrored?-sx:sx),
   fit.top-(center.y+size.y/2)*sy,
   -center.z*sz+fit.forward);
  if(mirrored)hair.rotation.y=-.12;
  hair.traverse(mesh=>{
   if(!mesh.isMesh)return;
   mesh.material=new THREE.MeshStandardMaterial({color,roughness:.86,metalness:0,side:THREE.DoubleSide});
   mesh.castShadow=true;mesh.receiveShadow=true;
   if(stageForeground)mesh.layers.set(1);
  });
  holder.add(hair);
  // Transform hierarchy must be current before fitting model-space vertices.
  holder.updateWorldMatrix(true,true);
  const corrected=fitImportedHairToHead(hair,holder,style);
  if(stageForeground)addForegroundLayer(hair); // async children need explicit layer setup
  if(corrected===0)console.warn('Hair fit adjusted no vertices:',style);
 }).catch(err=>{console.warn('Hair asset load failed:',style,err)});
 return holder;
}
// The original four external assets are preloaded; new options reuse and
// remap two of these source files, so there are no new asset dependencies.
for(const style of ['short','bob','long','buns'])getHairAsset(style).catch(()=>{});
// Rounded chibi avatar: larger soft head, painted-on face, short unified hairstyle,
// surface-colored clothing, and inexpensive shoulder/elbow/hip/knee rig.
function makeAvatar(p){
 const root=new THREE.Group();scene.add(root);
 const parts={}, female=p.gender==='female';
 const hairHex=hairColors.some(([,hex])=>hex===p.hairColor)?p.hairColor:'#4b3932';
 const skinMat=mat('#f3d6c2',.96),hair=mat(hairHex,.97);
 const shirtMat=mat(p.color,.88),bottomColor=female?'#ad816c':'#6c7891';
 const pantsMat=mat(bottomColor,.9),shoeMat=mat('#f6f3e9',.9);
 function child(g,geo,m,pos,sc){let o=new THREE.Mesh(geo,m);o.position.set(...pos);if(sc)o.scale.set(...sc);o.castShadow=true;g.add(o);return o}
 // The torso is one continuous capsule: color on the lower vertices suggests clothes,
 // without bolted-on pants or skirt geometry.
 const upper=new THREE.Group();upper.position.y=1.03;root.add(upper);parts.upper=upper;
 const bodyGeo=new THREE.CapsuleGeometry(.45,.46,8,16);
 const pa=bodyGeo.attributes.position,colors=[];
 const topColor=new THREE.Color(p.color),bottom=new THREE.Color(bottomColor);
 for(let i=0;i<pa.count;i++){const y=pa.getY(i),blend=THREE.MathUtils.smoothstep(y,-.29,-.21);let c=bottom.clone().lerp(topColor,blend);colors.push(c.r,c.g,c.b)}
 bodyGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const bodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
 if(p.pattern==='stripe'||p.pattern==='wide-stripe'){
  // Locally calculated ink-like bands on the existing torso surface: no extra 3D parts.
  const spacing=p.pattern==='stripe'?.155:.31;
  const width=p.pattern==='stripe'?.046:.105;
  bodyMat.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>',
     '#include <common>\nvarying vec3 vShirtPosition;');
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
     '#include <begin_vertex>\nvShirtPosition = position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
     '#include <common>\nvarying vec3 vShirtPosition;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
     '#include <color_fragment>\n'+
     'float stripeCoord = mod(vShirtPosition.y + 0.51, '+spacing.toFixed(4)+');\n'+
     'float stripeEdge = fwidth(stripeCoord) * 0.65;\n'+
     'float stripeInk = 1.0 - smoothstep('+width.toFixed(4)+' - stripeEdge, '+width.toFixed(4)+' + stripeEdge, stripeCoord);\n'+
     'float shirtCoverage = smoothstep(-0.18, -0.08, vShirtPosition.y);\n'+
     'vec3 stripeColor = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) > 0.72 ? vec3(0.18,0.20,0.23) : vec3(0.96,0.97,0.95);\n'+
     'diffuseColor.rgb = mix(diffuseColor.rgb, stripeColor, stripeInk * shirtCoverage * 0.93);');
  };
 }
 parts.torso=child(upper,bodyGeo,bodyMat,[0,.33,0],[.94,1.12,.88]);
 // Head is about as wide as the torso is tall; neck can nod separately.
 const neck=new THREE.Group();neck.position.set(0,1.12,0);upper.add(neck);parts.neck=neck;
 const head=child(neck,new THREE.SphereGeometry(.81,26,20),skinMat,[0,.12,0],[1,.96,.93]);parts.head=head;
 // Flat black eyes and painted-on blush/curved mouth, laid on spherical face surface.
 const eyeMat=new THREE.MeshBasicMaterial({color:'#101010',side:THREE.DoubleSide});
 const cheekMat=new THREE.MeshBasicMaterial({color:'#efaaa2',transparent:true,opacity:.44,depthWrite:false,side:THREE.DoubleSide});
 for(const x of [-.235,.235]){
   child(neck,new THREE.CircleGeometry(.050,22),eyeMat,[x,.13,.738]);
   child(neck,new THREE.CircleGeometry(.115,24),cheekMat,[x<0?-.43:.43,-.11,.630],[1,.49,1]);
 }
 const smile=new THREE.EllipseCurve(0,0,.084,.046,Math.PI*.08,Math.PI*.92,false,0);
 const points=smile.getPoints(15);const smileGeo=new THREE.BufferGeometry().setFromPoints(points.map(v=>new THREE.Vector3(v.x,-v.y,0)));
 const smileLine=new THREE.Line(smileGeo,new THREE.LineBasicMaterial({color:'#533f39'}));smileLine.position.set(0,-.17,.746);neck.add(smileLine);
 // Imported, artist-made glTF model follows the head during all animations.
 const hairStyle=normalizeHairStyle(p.hairStyle||'short');
 if(hairStyle==='basic-short'||hairStyle==='basic-bob'){
 // Smooth hair cap with a few surface-shaped bangs (not a hat).
 child(neck,new THREE.SphereGeometry(.833,24,18,0,Math.PI*2,0,Math.PI*.46),hair,[0,.16,-.01],[1,1.0,1]);
 for(const x of [-.39,-.12,.16,.39]){
   const bang=child(neck,new THREE.SphereGeometry(.20,12,9),hair,[x,.615,.33],[1,.40,.70]);
 }
 if(hairStyle==='basic-bob'){
   // A visible bob silhouette: the original rear hair was buried inside the larger head.
   // Keep a rear layer BEHIND the skull, then place the two tips outside the cheek contour.
   child(neck,new THREE.SphereGeometry(.855,24,18),hair,[0,.02,-.28],[1.04,1.05,.92]);
   for(const side of [-1,1]){
     // Lift side locks beside the cheeks rather than below the jaw.
     // Keep them outside the skull for an obvious bob outline from the front.
     const lock=child(neck,new THREE.CapsuleGeometry(.18,.41,7,12),hair,[side*.78,-.015,.205],[.92,1.02,.91]);
     lock.rotation.z=side*.12;
     child(neck,new THREE.SphereGeometry(.19,12,9),hair,[side*.79,-.275,.205],[.91,.86,.92]);
   }
 }else{
   // Close-fitting side hair visible near ears.
   for(const side of [-1,1])child(neck,new THREE.SphereGeometry(.22,12,10),hair,[side*.66,.22,-.10],[.72,1.03,.78]);
 }
 }else{
  attachImportedHair(neck,hairStyle,hairHex);
 }
 // No head accessory is rendered.
 // The clothing stripes are painted on the torso shader, not separate raised meshes.

 if(p.sash&&p.sash!=='none'){
  const sashColors={
   black:'#20212c',purple:'#793ac8',red:'#d42c42',green:'#2a9a59',
   yellow:'#f4cf3e',blue:'#287ed0',
   'black-check':'#20212c','red-check':'#c72b35',
   'blue-check':'#287ed0','yellow-check':'#f4cf3e','purple-check':'#793ac8',
   'black-dot':'#20212c','red-dot':'#c72b35','blue-dot':'#287ed0',
   'yellow-dot':'#f4cf3e','purple-dot':'#793ac8'
  };
  // Preserve exactly the original size, left-hip position and requested Y-axis
  // 90-degree orientation; only the flat fabric colors/pattern change.
  const fabric=new THREE.Group();fabric.position.set(-.49,1.24,.16);
  fabric.rotation.y=Math.PI/2;root.add(fabric);parts.sash=fabric;
  const baseColor=sashColors[p.sash]||'#252535';
  let clothMaterial=mat(baseColor,.97);
  if(p.sash.endsWith('-check')||p.sash.endsWith('-dot')){
   const cvs=document.createElement('canvas');cvs.width=128;cvs.height=512;
   const ctx=cvs.getContext('2d');
   ctx.fillStyle=baseColor;ctx.fillRect(0,0,cvs.width,cvs.height);
   if(p.sash.endsWith('-check')){
    const accent=p.sash==='yellow-check'?'#674e22':p.sash==='black-check'?'#dcdce0':'#f7e8e4';
    ctx.fillStyle=accent;
    // Flat tartan-style check lines, painted into the sash texture.
    for(let x=8;x<128;x+=32)ctx.fillRect(x,0,6,512);
    for(let y=8;y<512;y+=44)ctx.fillRect(0,y,128,6);
    ctx.fillStyle='rgba(0,0,0,.23)';
    for(let x=22;x<128;x+=32)ctx.fillRect(x,0,3,512);
    for(let y=28;y<512;y+=44)ctx.fillRect(0,y,128,3);
   }else{
    ctx.fillStyle='#ffffff';
    for(let y=18,row=0;y<512;y+=42,row++){
     for(let x=16+(row%2)*16;x<128;x+=32){
      ctx.beginPath();ctx.arc(x,y,6.5,0,Math.PI*2);ctx.fill();
     }
    }
   }
   const texture=new THREE.CanvasTexture(cvs);
   texture.colorSpace=THREE.SRGBColorSpace;
   texture.anisotropy=4;
   const patterned=mat('#ffffff',.97);patterned.map=texture;
   // Front and back both carry the print; other faces use the base color.
   clothMaterial=[patterned,patterned,clothMaterial,clothMaterial,patterned,patterned];
  }
  child(fabric,new THREE.BoxGeometry(.23,1.14,.065),clothMaterial,[-.025,-.57,0],[1,1,1]);
 }
 // Minimal articulated limbs: smooth joints tucked inside sleeve/leg, not exposed balls.
 function arm(side){
   const direction=side==='left'?-1:1;
   const shoulder=new THREE.Group();shoulder.position.set(direction*.57,.72,0);upper.add(shoulder);parts[side+'Shoulder']=shoulder;
   child(shoulder,new THREE.CapsuleGeometry(.137,.22,5,10),shirtMat,[0,-.19,0]);
   const elbow=new THREE.Group();elbow.position.y=-.40;shoulder.add(elbow);parts[side+'Elbow']=elbow;
   child(elbow,new THREE.CapsuleGeometry(.106,.18,5,10),skinMat,[0,-.18,0]);
   const hand=child(elbow,new THREE.SphereGeometry(.133,12,10),skinMat,[0,-.39,.018],[.97,.96,.88]);parts[side+'Hand']=hand;
 }
 function leg(side){
   const direction=side==='left'?-1:1;
   const hip=new THREE.Group();hip.position.set(direction*.21,1.07,0);root.add(hip);parts[side+'Hip']=hip;
   child(hip,new THREE.CapsuleGeometry(.16,.27,6,11),pantsMat,[0,-.23,0]);
   const knee=new THREE.Group();knee.position.y=-.47;hip.add(knee);parts[side+'Knee']=knee;
   child(knee,new THREE.CapsuleGeometry(.13,.26,5,10),skinMat,[0,-.21,0]);
   child(knee,new THREE.SphereGeometry(.20,13,10),shoeMat,[0,-.43,.13],[1.02,.62,1.5]);
 }
 arm('left');arm('right');leg('left');leg('right');
 // Festival wristband attached to the left wrist, follows joint animations.
 const band=child(parts.leftElbow,new THREE.TorusGeometry(.119,.026,5,12),mat('#d5ff79',.65),[0,-.29,.006]);band.rotation.x=Math.PI/2;
 // Crossbody bag: both ends of the strap meet the bag at its top corners;
 // front diagonal sits *on* the torso, with the return running over the shoulder.
 // All of these belong to the upper torso, so the bag remains coherent in poses.
 const strapMat=mat('#504a5f',.9),bagMat=mat('#c6a780',.91),flapMat=mat('#ddbd94',.9);
 function strapPath(coords){
  const curve=new THREE.CatmullRomCurve3(coords.map(v=>new THREE.Vector3(...v)));
  const o=new THREE.Mesh(new THREE.TubeGeometry(curve,24,.033,6,false),strapMat);
  o.castShadow=false;upper.add(o);return o;
 }
 // Upper coordinates: pouch is centered at left hip, shoulder at right.
 strapPath([[.45,.77,.18],[.32,.68,.31],[.19,.55,.42],[.01,.36,.46],[-.19,.18,.50],[-.34,.035,.51]]);
 strapPath([[-.34,.035,.51],[-.44,-.05,.18],[-.49,.10,-.17],[-.40,.40,-.34],[-.07,.74,-.28],[.27,.83,-.17],[.45,.77,.18]]);
 const pouch=child(upper,new THREE.SphereGeometry(.26,16,12),bagMat,[-.34,-.105,.52],[1.05,.72,.52]);
 const flap=child(upper,new THREE.SphereGeometry(.22,16,12),flapMat,[-.34,.010,.575],[1.11,.43,.56]);
 child(upper,new THREE.SphereGeometry(.044,10,8),mat('#f3e4bb',.65),[-.34,-.033,.696],[1,.9,.38]);
 // A white emoji speech-bubble replaces the unreliable tiny finger geometry.
 // The emoji is camera-facing and follows the player; no arm blocking the face.
 const emojiCanvas=document.createElement('canvas');emojiCanvas.width=320;emojiCanvas.height=210;
 const eg=emojiCanvas.getContext('2d');
 eg.fillStyle='rgba(255,255,255,.97)';eg.beginPath();eg.roundRect(14,12,292,164,58);eg.fill();
 eg.beginPath();eg.moveTo(136,175);eg.lineTo(160,198);eg.lineTo(184,175);eg.fill();
 eg.textAlign='center';eg.textBaseline='middle';eg.font='100px "Apple Color Emoji","Segoe UI Emoji",sans-serif';eg.fillText('🤘',160,94);
 const emojiTexture=new THREE.CanvasTexture(emojiCanvas);emojiTexture.colorSpace=THREE.SRGBColorSpace;
 const rockBubble=new THREE.Sprite(new THREE.SpriteMaterial({map:emojiTexture,transparent:true,depthTest:false,depthWrite:false}));
 rockBubble.scale.set(2.05,1.35,1);rockBubble.position.set(0,4.30,0);rockBubble.visible=false;rockBubble.renderOrder=140;root.add(rockBubble);parts.rockBubble=rockBubble;
 // Bottle is anchored to the torso rather than the animated wrist so its tip can be
 // placed directly on the mouth even when the arm is changing pose.
 const bottle=new THREE.Group();upper.add(bottle);bottle.position.set(.46,.68,.61);bottle.visible=false;parts.bottle=bottle;
 const glass=mat('#498c75',.3);child(bottle,new THREE.CylinderGeometry(.10,.12,.39,12),glass,[0,-.16,0]);
 child(bottle,new THREE.CylinderGeometry(.045,.065,.19,10),glass,[0,.13,0]);
 child(bottle,new THREE.CylinderGeometry(.06,.06,.055,10),mat('#f3ca82'),[0,.25,0]);
 child(bottle,new THREE.CylinderGeometry(.127,.127,.12,12),mat('#f2e1bd'),[0,-.14,0]);
 // Attach to root instead of the rotating elbow: its open top must point UP.
 // The cup follows the hand's position each frame without inheriting wrist tilt.
 const toastCup=new THREE.Group();root.add(toastCup);toastCup.position.set(.7,1.15,.5);parts.toastCup=toastCup;
 child(toastCup,new THREE.CylinderGeometry(.12,.09,.23,12),mat('#ffc977',.5),[0,0,0]);
 child(toastCup,new THREE.TorusGeometry(.11,.015,6,12),mat('#fff2b4',.45),[0,.12,0]).rotation.x=Math.PI/2;
 toastCup.visible=false;
 // The cigarette faces outward (+Z is the front of the avatar).
 // Anchor it to the upper torso instead of the rotating hand bone: arm IK can
 // rotate the hand so far that a hand-attached cigarette points into the mouth.
 const cigarette=new THREE.Group();upper.add(cigarette);parts.cigarette=cigarette;
 cigarette.rotation.y=-.22; // from right side of the mouth toward the centre
 cigarette.position.set(.35,.30,.53);
 const paper=new THREE.MeshBasicMaterial({color:'#f3f0e4'});
 const filter=new THREE.MeshBasicMaterial({color:'#c69d65'});
 const ember=new THREE.MeshBasicMaterial({color:'#ef6945'});
 // Filter by the fingers, white barrel extending visibly OUT in front of the face.
 const filterMesh=child(cigarette,new THREE.CylinderGeometry(.025,.025,.10,8),filter,[0,0,.05]);filterMesh.rotation.x=Math.PI/2;
 const stick=child(cigarette,new THREE.CylinderGeometry(.024,.024,.44,8),paper,[0,0,.32]);stick.rotation.x=Math.PI/2;
 child(cigarette,new THREE.SphereGeometry(.028,8,6),ember,[0,0,.55]);
 cigarette.visible=false;
 parts.smokePuffs=[];
 for(let i=0;i<6;i++){
  const puff=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:'#dbe1e5',transparent:true,opacity:0,depthWrite:false}));
  puff.visible=false;puff.renderOrder=21;upper.add(puff);parts.smokePuffs.push(puff);
 }
 // Always-white bold nickname with no background.
 const cv=document.createElement('canvas');cv.width=512;cv.height=128;const ctx=cv.getContext('2d');
 ctx.fillStyle='#fff';ctx.font='900 52px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.name||'ROCKER').slice(0,18),256,64,490);
 const texture=new THREE.CanvasTexture(cv);
 const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));tag.scale.set(4.65,1.16,1);tag.position.y=3.66;root.add(tag);parts.tag=tag;
 addForegroundLayer(root);
 // Lightweight snack crumbs attached to the head; visually visible to all spectators.
 const snackCrumbs=new THREE.Group();neck.add(snackCrumbs);parts.snackCrumbs=[];
 const crumbGeo=new THREE.TetrahedronGeometry(.048,0);
 const crumbColors=['#f5c95c','#efaf54','#f9e2a3','#df9b48'];
 const crumbMaterials=crumbColors.map(c=>new THREE.MeshBasicMaterial({color:c}));
 for(let i=0;i<12;i++){
  const crumb=new THREE.Mesh(crumbGeo,crumbMaterials[i%crumbMaterials.length]);crumb.visible=false;
  snackCrumbs.add(crumb);parts.snackCrumbs.push(crumb);
 }
 return {root,parts,color:p.color,lastAction:'idle'};
}

// Chat bubbles are true 3D sprites anchored in world coordinates, independent of avatar pose.
function bubbleTexture(message){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=320;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,768,320);
 ctx.fillStyle='rgba(255,255,255,.98)';ctx.strokeStyle='#283044';ctx.lineWidth=7;
 ctx.beginPath();ctx.roundRect(15,14,738,248,30);ctx.fill();ctx.stroke();
 ctx.beginPath();ctx.moveTo(368,263);ctx.lineTo(384,302);ctx.lineTo(408,263);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle='#171d31';ctx.textAlign='center';ctx.textBaseline='middle';
 const chars=Array.from(String(message||''));let lines=[],line='';
 // Wrap by rendered width, not raw character count (Korean/emoji/Latin all supported).
 ctx.font='bold 44px system-ui, sans-serif';
 for(const ch of chars){if(ctx.measureText(line+ch).width>670&&line){lines.push(line);line=ch}else line+=ch}
 if(line)lines.push(line);
 if(lines.length>3){lines=lines.slice(0,3);let last=lines[2];while(ctx.measureText(last+'…').width>670&&last.length)last=last.slice(0,-1);lines[2]=last+'…'}
 const fontSize=lines.length===1?55:lines.length===2?48:43;
 ctx.font=`bold ${fontSize}px system-ui, sans-serif`;
 const lineHeight=fontSize*1.25,top=130-(lines.length-1)*lineHeight/2;
 lines.forEach((l,i)=>ctx.fillText(l,384,top+i*lineHeight,670));
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function showBubble(entry){
 if(!entry||!entry.playerId||!state.players.has(entry.playerId))return;
 const old=activeBubbles.get(entry.playerId);
 if(old){scene.remove(old.sprite);old.sprite.material.map.dispose();old.sprite.material.dispose()}
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:bubbleTexture(entry.message),transparent:true,depthTest:false,depthWrite:false}));
 sprite.scale.set(4.2,1.75,1);sprite.renderOrder=150;scene.add(sprite);if(stageForeground)sprite.layers.set(1);
 activeBubbles.set(entry.playerId,{sprite,expires:performance.now()+3800});
}

function updateBubbles(now){
 for(const [id,b] of activeBubbles){
  const a=avatars.get(id);
  if(!a||now>=b.expires){scene.remove(b.sprite);b.sprite.material.map.dispose();b.sprite.material.dispose();activeBubbles.delete(id);continue}
  b.sprite.position.set(a.root.position.x,a.root.position.y+5.0,a.root.position.z);
  b.sprite.material.opacity=Math.min(1,(b.expires-now)/350);
 }
}
function toWorld(p){return {x:(p.x-600)*.058,z:expandWorldZ((p.y-500)*.058+8)}}
// Two-bone IK keeps the hands on exact, reachable targets for clap and drinking.
// All targets are in the upper-torso coordinate system. The hand meshes are
// at elbow-local (0,-.39,.018); elbow and forearm are .40 and .39 long.
const armDown=new THREE.Vector3(0,-1,0);
const armDesired=new THREE.Quaternion(),elbowDesired=new THREE.Quaternion();
const ikShoulder=new THREE.Vector3(),ikToHand=new THREE.Vector3(),ikDirection=new THREE.Vector3();
const ikPole=new THREE.Vector3(),ikElbow=new THREE.Vector3(),ikUpperDir=new THREE.Vector3(),ikLowerDir=new THREE.Vector3();
function placeHandIK(P,side,handTarget,smooth=.48){
 const shoulder=P[side+'Shoulder'],elbow=P[side+'Elbow'];
 ikShoulder.copy(shoulder.position);
 ikToHand.subVectors(handTarget,ikShoulder);
 let distance=ikToHand.length();if(distance<.02)return;
 const l1=.40,l2=.39; // shoulder -> elbow, elbow -> hand centre
 distance=Math.min(l1+l2-.004,distance);
 ikDirection.copy(ikToHand).normalize();
 // Keep elbow outside the torso instead of crossing the character's face.
 ikPole.set(side==='left'?-1:1,-.25,-.28);
 ikPole.addScaledVector(ikDirection,-ikPole.dot(ikDirection)).normalize();
 const along=(l1*l1-l2*l2+distance*distance)/(2*distance);
 const bend=Math.sqrt(Math.max(0,l1*l1-along*along));
 ikElbow.copy(ikShoulder).addScaledVector(ikDirection,along).addScaledVector(ikPole,bend);
 ikUpperDir.subVectors(ikElbow,ikShoulder).normalize();
 armDesired.setFromUnitVectors(armDown,ikUpperDir);
 shoulder.quaternion.slerp(armDesired,smooth);
 // Solve elbow in the parent shoulder's CURRENT coordinate frame so that
 // damping never flips the wrist to the other side during a pose transition.
 ikLowerDir.subVectors(handTarget,ikElbow).normalize();
 ikLowerDir.applyQuaternion(shoulder.quaternion.clone().invert());
 elbowDesired.setFromUnitVectors(armDown,ikLowerDir);
 elbow.quaternion.slerp(elbowDesired,smooth);
}
// Smooth motion blending for the upgraded chibi rig. All poses share the same joints.
function animateAvatar(a,p,t){
 const q=(p.id===state.id&&state.me)?state.me:p,wp=toWorld(q),P=a.parts;
 const duoContext=duoPose(q.id),act=duoContext?.action||(q.action||'idle'),basePose=duoContext?'stand':(q.pose||((act==='sit'||act==='lie')?act:'stand'));
 const sec=duoContext?(Date.now()+state.serverDelta-duoContext.duo.startAt)/1000:t*.001,pose={};
 let targetX=wp.x,targetZ=wp.z,duoYaw=null;
 if(duoContext?.duo.anchor){
  const duo=duoContext.duo,first=q.id===duo.a;
  const own=toWorld(first?duo.anchor.a:duo.anchor.b);
  const partner=toWorld(first?duo.anchor.b:duo.anchor.a);
  const mx=(own.x+partner.x)*.5,mz=(own.z+partner.z)*.5;
  const dx=own.x-mx,dz=own.z-mz,dist=Math.hypot(dx,dz)||1;
  const nx=dx/dist,nz=dz/dist;
  if(duo.kind==='hug'){
   // Walk closer, wrap arms, then STEP BACK to the original pair position.
   const approach=duoEase((sec-.12)/.88);
   const retreat=duoEase((sec-3.42)/1.05);
   const close=Math.max(0,approach-retreat);
   targetX=own.x-nx*.63*close;targetZ=own.z-nz*.63*close;
   duoYaw=Math.atan2(-nx,-nz);
  }else if(duo.kind==='dance'){
   // Exactly three synchronized revolutions around one midpoint.
   const f=duoEase((sec-.14)/.45)*(1-duoEase((sec-5.10)/.32));
   const cycles=duoClamp((sec-.15)/5.0)*Math.PI*6;
   const sign=first?1:-1,phase=Math.atan2(dz,dx)+cycles;
   const radius=Math.max(.65,Math.min(1.25,dist));
   const circleX=mx+Math.cos(phase)*radius,circleZ=mz+Math.sin(phase)*radius;
   targetX=THREE.MathUtils.lerp(own.x,circleX,f);
   targetZ=THREE.MathUtils.lerp(own.z,circleZ,f);
   duoYaw=Math.atan2(mx-targetX,mz-targetZ);
  }else if(duo.kind==='highfive'){
   // Turn the whole body toward the other visitor, make contact, and return
   // to the original side-on stance. The server's start time synchronizes both.
   const turn=duoEase((sec-.12)/.60)*(1-duoEase((sec-1.32)/.66));
   const reach=duoEase((sec-.37)/.47)*(1-duoEase((sec-1.12)/.37));
   targetX=own.x-nx*.22*reach;targetZ=own.z-nz*.22*reach;
   const originalYaw=Number(q.facing)||0;
   const lookYaw=Math.atan2(-nx,-nz)+(first?.12:-.12);
   const delta=Math.atan2(Math.sin(lookYaw-originalYaw),Math.cos(lookYaw-originalYaw));
   duoYaw=originalYaw+delta*turn;
  }
 }
 // Paired choreography is deterministic and authoritative per server time.
 // Movement returns to ordinary world positions after the duo ends.
 const follow=duoContext?.duo.anchor?.kind==='dance'?.85:duoContext?.duo.anchor?.kind==='hug'?.36:.28;
 a.root.position.x+=(targetX-a.root.position.x)*follow;
 a.root.position.z+=(targetZ-a.root.position.z)*follow;
 if(P.sash)P.sash.rotation.y=Math.PI/2+Math.sin(t*.0028)*.055;
 P.toastCup.visible=q.action==='toast-clink';
 // Leaving headspin must clear its WORLD-ROOT spin, inversion and height.
 // Otherwise a huge sec*8.2 yaw leaks into walk/other dance interpolation.
 if(a.lastAction==='headspin'&&act!=='headspin'){
  a.root.rotation.set(0,Number(q.facing)||0,0);
  a.root.position.y=0;
 }
 const keys=['upper','neck','leftShoulder','rightShoulder','leftElbow','rightElbow','leftHip','rightHip','leftKnee','rightKnee'];
 for(const key of keys)pose[key]=[0,0,0];
 let height=0,lean=0,ikMode=null,leftHandTarget=null,rightHandTarget=null;
 const set=(key,x=0,y=0,z=0)=>{pose[key]=[x,y,z]};
 if(act==='walk'||act==='run'||act==='slam-charge'||act==='slam-retreat'||act==='circle-run'||act==='train-run'||act==='mosh-charge'){
  const fast=act!=='walk',pace=fast?11.6:7.4,amp=fast?.66:.39;
  const wave=Math.sin(sec*pace),opp=Math.sin(sec*pace+Math.PI);
  set('leftHip',wave*amp);set('rightHip',opp*amp);
  set('leftKnee',Math.max(0,wave)*(.68*(fast?1:.7)));
  set('rightKnee',Math.max(0,opp)*(.68*(fast?1:.7)));
  set('leftShoulder',-wave*amp*.58);set('rightShoulder',-opp*amp*.58);
  set('leftElbow',-.12);set('rightElbow',-.12);
  set('upper',fast?-.14:-.035,0,Math.sin(sec*pace)*.035);
  height=Math.abs(Math.sin(sec*pace))*(fast?.12:.048);
  if(act==='mosh-charge'){
    // Alternating wide arm swings, as if punching through the air (no actual collision).
    // Larger alternating swings: arms sweep across the chest and far back,
    // with torso rotation for a much clearer moshing silhouette.
    const smash=Math.sin(sec*12.5);
    set('leftShoulder',-1.00+smash*1.23,Math.sin(sec*12.5+.5)*.30,-.64);
    set('rightShoulder',-1.00-smash*1.23,-Math.sin(sec*12.5+.5)*.30,.64);
    set('leftElbow',-.38-.28*Math.max(0,smash));
    set('rightElbow',-.38-.28*Math.max(0,-smash));
    set('upper',-.24,Math.sin(sec*12.5)*.23,Math.sin(sec*12.5)*.045);
    height=Math.abs(Math.sin(sec*12.5))*.18;
   }
  if(act==='train-run'){
    // Hands reach forward toward the next person's shoulders, making a line of linked runners.
    set('leftShoulder',-1.05,-.16,-.24);
    set('rightShoulder',-1.05,.16,.24);
    set('leftElbow',-.20);set('rightElbow',-.20);
    set('upper',-.10,0,Math.sin(sec*9)*.022);
    height=Math.abs(Math.sin(sec*9))*.055;
   }
   if(act==='circle-run'){
    set('upper',-.16,0,Math.sin(sec*12)*.032);
    height=Math.abs(Math.sin(sec*12))*.11;
   }
   if(act==='slam-charge'||act==='slam-retreat'){
   // Running jumps: clear take-off + bend + landing every stride.
   const hop=Math.pow(Math.max(0,Math.sin(sec*15.8)),1.1);
   height=.09+hop*.77;
   set('leftKnee',.22+hop*.6+Math.max(0,wave)*.18);
   set('rightKnee',.22+hop*.6+Math.max(0,opp)*.18);
   set('upper',act==='slam-retreat'?.06:-.16,0,Math.sin(sec*pace)*.03);
   if(act==='slam-retreat'){set('leftShoulder',-.14,0,-.22);set('rightShoulder',-.14,0,.22)}
  }
 }
 if(act==='buriburi'){
  // Stage reference: both arms hold a fixed, straight horizontal T-pose.
  // All rhythmic motion comes from the waist/hips, not alternating arm gestures.
  const shake=Math.sin(sec*9.5);
  const rebound=Math.sin(sec*19)*.009;
  set('leftShoulder',0,0,-Math.PI/2);
  set('rightShoulder',0,0,Math.PI/2);
  set('leftElbow',0,0,0);
  set('rightElbow',0,0,0);
  // Shift the pelvis/body rhythmically left-right under a nearly fixed shoulder line.
  set('upper',0,0,.018*shake);
  set('neck',0,0,-.018*shake);
  set('leftHip',-.17,0,-.10*shake);
  set('rightHip',-.17,0,-.10*shake);
  set('leftKnee',.22+.055*Math.max(0,shake));
  set('rightKnee',.22+.055*Math.max(0,-shake));
  height=-.035+rebound;
 }
 if(act==='row-paddle'){
  // Two seated files, paddling together on each beat.
  set('upper',.17+.20*Math.sin(sec*5.5),0,0);
  set('leftShoulder',-.95-.46*Math.sin(sec*5.5),0,-.33);
  set('rightShoulder',-.95-.46*Math.sin(sec*5.5),0,.33);
  set('leftElbow',-.53);set('rightElbow',-.53);
  set('leftHip',-1.25);set('rightHip',-1.25);set('leftKnee',1.55);set('rightKnee',1.55);
  height=-.38;
 }
 if(act==='toast-clink'){
  const reach=Math.min(1,Math.max(0,(Math.sin(sec*3.5)+1)*.5));
  set('rightShoulder',-1.2-.55*reach,0,.10);set('rightElbow',-.45);
  set('leftShoulder',-.22);set('upper',-.04,0,0);
 }
 if(act==='groove'){
  // Relaxed festival groove: low-impact alternating knee dips, loose elbows,
  // slow weight transfers and shoulder sway. Deliberately distinct from Buriburi.
  const beat=sec*4.0;
  const side=Math.sin(beat),counter=Math.sin(beat+Math.PI);
  const bounce=(1-Math.cos(beat*2))*.5;
  height=-.025+bounce*.048;
  // Keep feet relatively close to the ground while weight moves side-to-side.
  set('leftHip',-.08+Math.max(0,side)*.11,0,-.035*side);
  set('rightHip',-.08+Math.max(0,counter)*.11,0,-.035*side);
  set('leftKnee',.18+.12*Math.max(0,side));
  set('rightKnee',.18+.12*Math.max(0,counter));
  set('upper',.03+.045*Math.sin(beat*2),.07*side,.09*side);
  set('neck',-.025,.025*counter,-.038*side);
  // Arms loosely bent in front of the body, swinging opposite to the torso.
  set('leftShoulder',-.22+.18*side,0,-.32+.09*side);
  set('rightShoulder',-.22-.18*side,0,.32+.09*side);
  set('leftElbow',-.42-.10*side);
  set('rightElbow',-.42+.10*side);
 }
 if(act==='windmill'){
  // One-handed B-boy freeze: tilted inversion, planted left arm, right arm
  // stretched out to the side, scissored legs (one straight, one bent).
  // Shift the whole avatar upward while inverting so the head approaches ground.
  height=2.10+.055*Math.sin(sec*3.1);
  lean=.07*Math.sin(sec*2.2);
  set('upper',-.12,.035*Math.sin(sec*2.2),.05);
  set('neck',.08);
  // In the inverted body frame this arm reaches toward the floor.
  set('leftShoulder',-2.95,0,-.18);
  set('leftElbow',.07);
  // Opposite arm held perpendicular for balance.
  set('rightShoulder',-.15,0,1.43);
  set('rightElbow',0);
  // Straight leg extended up/side; other leg remains visibly bent.
  set('leftHip',-.32,0,-.63);
  set('leftKnee',.04);
  set('rightHip',.47,0,.72);
  set('rightKnee',1.28+.06*Math.sin(sec*2.4));
 }
 if(act==='airguitar'){
  // Continuous air guitar: left hand grips an imaginary neck while the
  // right hand strums rapidly across the strings; the head nods throughout.
  const strum=Math.sin(sec*26.5),pulse=Math.sin(sec*6.2);
  height=-.035+Math.abs(pulse)*.065;
  set('upper',-.07+.035*pulse,.075*Math.sin(sec*4.6),-.035*pulse);
  set('neck',.24*Math.sin(sec*10.8)-.10,.09*Math.sin(sec*5.5),.11*Math.sin(sec*7.1));
  set('leftHip',-.12+.11*Math.max(0,pulse),0,-.12);
  set('rightHip',-.13+.11*Math.max(0,-pulse),0,.12);
  set('leftKnee',.20+.08*Math.max(0,pulse));
  set('rightKnee',.20+.08*Math.max(0,-pulse));
  // Wrist targets are given in upper-torso local coordinates.
  leftHandTarget=new THREE.Vector3(-.57,.47,.61);
  rightHandTarget=new THREE.Vector3(.27,.12+strum*.22,.54);
  ikMode='airguitar';
 }
 if(act==='headspin'){
  // True inverted, continuously turning headspin: the character's head is
  // the contact point with the ground (head center ~2.27 above root).
  // rootY ~3.04 and 180° roll keeps its scalp at the ground plane.
  height=3.04+.035*Math.sin(sec*13);
  lean=0;
  set('upper',0,0,0);
  set('neck',0,0,0);
  set('leftShoulder',-.38,0,-1.05);
  set('rightShoulder',-.38,0,1.05);
  set('leftElbow',-.20);set('rightElbow',-.20);
  set('leftHip',-.14,0,-.40);
  set('rightHip',.22,0,.45);
  set('leftKnee',.27);set('rightKnee',.62);
 }
 if(act==='skanking'){
  // Four-count ska step, with a real recoil/preparation on counts 2 and 4:
  // 1 right leg forward + left arm forward
  // 2 left leg folds backward + right arm sweeps back
  // 3 left leg forward + right arm forward
  // 4 right leg folds backward + left arm sweeps back
  const beat=sec*2.7;
  const step=Math.floor(beat)%4;
  const pulse=Math.pow(Math.sin(Math.PI*(beat%1)),2);
  const frontR=step===0?pulse:0;
  const backL=step===1?pulse:0;
  const frontL=step===2?pulse:0;
  const backR=step===3?pulse:0;
  // Slightly higher, compact hop on every beat. Returns to floor between counts.
  height=-.028+.43*pulse+((step===0||step===2)?.028:0)*pulse;
  // Keep torso leaning FORWARD (avatar front is +Z).
  set('upper',.27+.027*pulse,0,.024*Math.sin(beat*Math.PI*.5));
  set('neck',-.055);
  // A forward kick, or a backward tucked heel as the opposing foot recoils.
  set('rightHip',-.08-1.02*frontR+.46*backR,0,.045);
  set('leftHip',-.08-1.02*frontL+.46*backL,0,-.045);
  set('rightKnee',.17-.13*frontR+1.13*backR);
  set('leftKnee',.17-.13*frontL+1.13*backL);
  // Hands follow the user-defined rhythmic pattern, including backswing.
  // Left hand forward on 1, right hand back on 2,
  // right hand forward on 3, left hand back on 4.
  set('leftShoulder',-.08-1.12*frontR+.80*backR,0,-.22);
  set('rightShoulder',-.08+ .80*backL-1.12*frontL,0,.22);
  set('leftElbow',-.30-.16*frontR+.12*backR);
  set('rightElbow',-.30-.16*frontL+.12*backL);
 }
 if(act==='smoke'){
  // Small, repeated smoking gesture: right hand approaches the mouth, then lowers.
  const cycle=(sec*0.58)%1;
  const inhale=THREE.MathUtils.smoothstep(cycle,.10,.31)*(1-THREE.MathUtils.smoothstep(cycle,.59,.78));
  rightHandTarget=new THREE.Vector3(.35-.07*inhale,.30+.55*inhale,.43+.23*inhale);
  ikMode='smoke';
  set('rightShoulder',-.42,0,.16);
  set('rightElbow',-.85);
  set('upper',.025,0,.017*Math.sin(sec*2.2));
  set('neck',-.03-.03*inhale);
 }
 if(act==='cheer'){
  const lift=Math.max(0,Math.sin(sec*10));height=lift*.75;
  set('leftShoulder',-2.65,0,-.26);set('rightShoulder',-2.65,0,.26);
  set('leftElbow',-.12);set('rightElbow',-.12);
  set('leftHip',-.22*(1-lift));set('rightHip',-.22*(1-lift));
  set('leftKnee',.45*(1-lift));set('rightKnee',.45*(1-lift));
 }
 if(act==='jump'){
  const phase=Math.sin(sec*10.6);const lift=Math.max(0,phase);
  height=lift*1.03;set('leftHip',-.35*(1-lift));set('rightHip',-.35*(1-lift));
  set('leftKnee',.62*(1-lift));set('rightKnee',.62*(1-lift));
  // hands stay beside shoulders, never across the oversized head.
  set('leftShoulder',-.24,0,-.65);set('rightShoulder',-.24,0,.65);
 }
 if(act==='peace'){
  // Keep both hands down. The visible 🤘 reaction is a speech bubble above the head.
  set('leftShoulder',-.04,0,-.10);set('rightShoulder',-.04,0,.10);
 }
 if(act==='wave'){
  // A waving hand stays OUTSIDE the head's x silhouette, never crossing the face.
  const wobble=Math.sin(sec*9.0);
  rightHandTarget=new THREE.Vector3(1.13+.085*wobble,1.12+.04*wobble,.17);
  ikMode='wave';
  set('neck',0,0,-.035);
 }
 if(act==='clap'){
  // Palm centres stop ~0.26 units apart: each hand radius is 0.13.
  // Both targets sit at lower chest height, below the large round face.
  const beat=(1+Math.cos(sec*19.5))*.5;
  const halfGap=.133+.19*(1-beat);
  const front=.34;
  leftHandTarget=new THREE.Vector3(-halfGap,.20,front);
  rightHandTarget=new THREE.Vector3(halfGap,.20,front);
  ikMode='clap';
  set('upper',.018);
 }
 if(act==='drink'){
  // The wrist comes up from the front-right, UNDER the face. Only the bottle
  // crosses toward the lips; the big chibi hand stays below chin level.
  const sip=(1+Math.sin(sec*4.8))*.5;
  rightHandTarget=new THREE.Vector3(.48,.67+.012*sip,.58);
  ikMode='drink';
  set('neck',.012+.02*sip);
  // Place the cap exactly at mouth height, independent of wrist rotation.
  const mouth=new THREE.Vector3(0,.94,.755);
  const approach=mouth.clone().sub(rightHandTarget).normalize();
  const start=rightHandTarget.clone().addScaledVector(approach,.28);
  P.bottle.position.lerp(start,.28);
  const targetRotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),approach);
  P.bottle.quaternion.slerp(targetRotation,.32);
  P.bottle.scale.setScalar(1.3);
 }
 if(act==='snack'){
  // Keep the oversized chibi head unobstructed: hand reaches the lower-right mouth.
  const chew=(1+Math.sin(sec*11.5))*.5;
  rightHandTarget=new THREE.Vector3(.33,.82+.06*chew,.60);
  ikMode='snack';
  set('neck',Math.sin(sec*15)*.085,Math.sin(sec*7)*.04,Math.sin(sec*10)*.03);
  set('upper',.025);
 }
 if(act==='headbang'){
  // Strong rhythmic head nods, restrained when lying down.
  const amp=basePose==='lie'?.24:.58;
  set('neck',-.10+Math.sin(sec*9.4)*amp,0,Math.sin(sec*4.7)*.025);
  set('upper',Math.sin(sec*9.4)*.07);
 }
 if(act==='sit'){
  height=-.24;set('upper',.06);set('leftHip',-1.43);set('rightHip',-1.43);
  set('leftKnee',1.45);set('rightKnee',1.45);
  set('leftShoulder',.16);set('rightShoulder',.16);
 }
 if(act==='slam-celebrate'){
  // Repeating joyful jumps until the player takes control again.
  const hop=Math.pow(Math.max(0,Math.sin(sec*10.8)),.85);
  height=hop*.68;
  set('leftHip',-.15*(1-hop));set('rightHip',-.15*(1-hop));
  set('leftKnee',.34*(1-hop));set('rightKnee',.34*(1-hop));
  set('leftShoulder',-.16,0,-.35);set('rightShoulder',-.16,0,.35);
 }
 if(act==='lie'){
  height=.52;lean=-Math.PI/2;
  set('leftShoulder',.13);set('rightShoulder',.13);set('leftHip',.11);set('rightHip',.11);
 }
 // Paired poses are synchronised to the server start time and blended by the same IK rig.
 if(duoContext){
  const beat=Math.sin(sec*8),side=duoContext.duo.a===q.id?-1:1;
  if(act==='duo-highfive'){
   // Shoulder and head follow the turning chest: not a rigid frontal slap.
   const turn=duoEase((sec-.12)/.60)*(1-duoEase((sec-1.32)/.66));
   const reach=duoEase((sec-.37)/.47)*(1-duoEase((sec-1.12)/.37));
   rightHandTarget=new THREE.Vector3(.30-.14*reach,.34+.62*reach,.28+.82*reach);
   ikMode='duo-right';
   set('upper',-.10*reach,side*.22*turn,-side*.10*turn);
   set('neck',-.07*reach,-side*.09*turn,side*.055*turn);
   set('leftShoulder',-.18*turn,0,-side*.09*turn);
   height=.055*Math.sin(Math.min(1,sec)*Math.PI);
  }else if(act==='duo-handshake'){
   rightHandTarget=new THREE.Vector3(.15,.24+.07*beat,.65);
   ikMode='duo-right';set('upper',-.10);set('neck',.03);
  }else if(act==='duo-hug'){
   const approach=duoEase((sec-.12)/.88),retreat=duoEase((sec-3.42)/1.05);
   const hold=duoClamp(approach-retreat);
   // Arms extend OPEN during approach, fold around partner on contact,
   // open again while stepping back to the original standing locations.
   const wrap=duoEase((sec-1.1)/.48)*(1-duoEase((sec-3.22)/.45));
   const spread=hold*(1-wrap);
   leftHandTarget=new THREE.Vector3(-.82*spread-.30*wrap,.13+.17*wrap,.48+.43*hold);
   rightHandTarget=new THREE.Vector3(.82*spread+.30*wrap,.13+.17*wrap,.48+.43*hold);
   ikMode='duo-both';set('upper',-.20*hold);set('neck',.07*hold,0,side*.035);
   // A small step cadence while moving in and backing out.
   const stride= (sec<1.0||sec>3.4&&sec<4.6)?Math.sin(sec*15)*.20:0;
   set('leftHip',stride);set('rightHip',-stride);
  }else if(act==='duo-dance'){
   height=Math.abs(Math.sin(sec*11.3+side*.5))*.20;
   set('upper',0,Math.sin(sec*5.4)*.24,Math.sin(sec*9.2)*.10);
   set('neck',Math.sin(sec*10.5)*.14);
   set('leftShoulder',-1.3+beat*.5,0,-.55);
   set('rightShoulder',-1.3-beat*.5,0,.55);
   set('leftHip',beat*.26);set('rightHip',-beat*.26);
  }
 }
 // Persistent seated / lying base pose. Upper-body reactions run on top.
 if(basePose==='sit'&&act!=='sit'){
  height=-.24;
  set('leftHip',-1.43);set('rightHip',-1.43);
  set('leftKnee',1.45);set('rightKnee',1.45);
  if(!['headbang','snack','drink','clap','wave','peace'].includes(act))set('upper',.06);
 }
 if(basePose==='lie'&&act!=='lie'){
  height=.52;lean=-Math.PI/2;
  set('leftHip',.11);set('rightHip',.11);
  // Allow gestures with shoulder and head while resting on the back.
  if(act==='headbang')set('neck',Math.sin(sec*9.4)*.24,0,0);
 }
 // Only the Buriburi dance slides the torso laterally; return smoothly on exit.
 const hipSlide=act==='buriburi'?Math.sin(sec*9.5)*.14:0;
 P.upper.position.x+=(hipSlide-P.upper.position.x)*.38;
 const alpha=act===a.lastAction?.25:.17;
 for(const k of keys){
  if((ikMode==='duo-both'&&['leftShoulder','leftElbow','rightShoulder','rightElbow'].includes(k))||(ikMode==='duo-right'&&['rightShoulder','rightElbow'].includes(k)))continue;
  if(ikMode==='clap'&&['leftShoulder','leftElbow','rightShoulder','rightElbow'].includes(k))continue;
  if((ikMode==='drink'||ikMode==='wave'||ikMode==='snack'||ikMode==='smoke')&&['rightShoulder','rightElbow'].includes(k))continue;
  const target=pose[k],o=P[k];
  o.rotation.x+=(target[0]-o.rotation.x)*alpha;
  o.rotation.y+=(target[1]-o.rotation.y)*alpha;
  o.rotation.z+=(target[2]-o.rotation.z)*alpha;
 }
 if(ikMode==='duo-both'){
  placeHandIK(P,'left',leftHandTarget,.58);placeHandIK(P,'right',rightHandTarget,.58);
 }else if(ikMode==='duo-right')placeHandIK(P,'right',rightHandTarget,.68);
 else if(ikMode==='airguitar'){
  placeHandIK(P,'left',leftHandTarget,.68);
  placeHandIK(P,'right',rightHandTarget,.78);
 }else if(ikMode==='clap'){
  placeHandIK(P,'left',leftHandTarget,.58);
  placeHandIK(P,'right',rightHandTarget,.58);
 }else if(ikMode==='drink')placeHandIK(P,'right',rightHandTarget,.58);
 else if(ikMode==='wave')placeHandIK(P,'right',rightHandTarget,.64);
 else if(ikMode==='snack')placeHandIK(P,'right',rightHandTarget,.56);
 else if(ikMode==='smoke')placeHandIK(P,'right',rightHandTarget,.66);
 // Seat is higher than the grass; raise the seated avatar to the bench cushion.
 if(basePose==='sit'&&benchSeats.some(seat=>Math.hypot(q.x-seat.x,q.y-seat.y)<24))height+=.46;
 a.root.position.y+=(height-a.root.position.y)*.28;
 a.root.rotation.x+=(lean-a.root.rotation.x)*.22;
 // While breakdancing, rotate the whole prone body around its center, not just its chest.
 // B-boy freeze tilts into a stable one-handed inversion rather than continuous windmill spinning.
 const zTarget=act==='headspin'?Math.PI:(act==='windmill'?2.80+.055*Math.sin(sec*2.5):0);
 a.root.rotation.z+=(zTarget-a.root.rotation.z)*.17;
 if(act==='toast-clink'){
  // Track the hand even when both shoulder and elbow move during the clink.
  // A root-attached cup doesn't inherit the arm's rotation (which tipped it over).
  a.root.updateMatrixWorld(true);
  const handWorld=P.rightElbow.localToWorld(new THREE.Vector3(0,-.58,.08));
  P.toastCup.position.copy(a.root.worldToLocal(handWorld));
  P.toastCup.quaternion.copy(a.root.getWorldQuaternion(new THREE.Quaternion()).invert());
 }
 P.snackCrumbs.forEach((crumb,i)=>{
  if(act!=='snack'){crumb.visible=false;return}
  const phase=(sec*3.8+i*.19)%1,ring=.08+phase*.47,theta=i*2.39996;
  crumb.visible=true;
  crumb.position.set(Math.cos(theta)*ring,-.15-Math.pow(phase,1.6)*.48,.77+Math.sin(theta)*ring*.65);
  crumb.rotation.set(sec*5+i,sec*7+i,phase*8);
  crumb.scale.setScalar(Math.max(.12,1-phase)*(.75+i%3*.15));
 });
 // Low-poly cigarette and drifting smoke belong to each player's rig, so
 // remote players see the same reaction without transmitting particle events.
 P.cigarette.visible=act==='smoke';
 if(act==='smoke'){
  // Keep the cigarette pointing forward even while the right arm bends.
  const phase=(sec*.58)%1;
  const inhale=THREE.MathUtils.smoothstep(phase,.10,.31)*(1-THREE.MathUtils.smoothstep(phase,.59,.78));
  P.cigarette.position.set(.35-.07*inhale,.30+.55*inhale,.53+.18*inhale);
 }
 P.smokePuffs.forEach((puff,i)=>{
  if(act!=='smoke'){puff.visible=false;return}
  const phase=(sec*.39+i/6)%1;
  puff.visible=true;
  // Smoke starts near the burning tip, not inside the avatar's face.
  const c=P.cigarette.position;
  puff.position.set(c.x-.12+.10*Math.sin(phase*5+i*.7),c.y+.08+phase*.90,c.z+.54+phase*.09);
  puff.scale.setScalar(.08+phase*.22);
  puff.material.opacity=Math.sin(Math.PI*phase)*.26;
 });
 P.rockBubble.visible=act==='peace'||act==='slam-retreat'||act==='slam-celebrate';P.bottle.visible=act==='drink';
 if(P.rockBubble.visible)P.rockBubble.position.y=4.34+Math.sin(sec*7)*.075;
 if(act==='headspin'){
  // Keep yaw bounded; absolute elapsed page seconds would grow without limit.
  a.root.rotation.y=(sec*8.2)%(Math.PI*2);
 }else if(basePose!=='lie'&&act!=='lie'){
  const yaw=duoYaw??(Number(q.facing)||0);
  a.root.rotation.y=((a.root.rotation.y%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  const delta=Math.atan2(Math.sin(yaw-a.root.rotation.y),Math.cos(yaw-a.root.rotation.y));
  a.root.rotation.y+=delta*.2;
 }
 a.lastAction=act;
}
// Click or tap the ground to walk; dragging continues to orbit the camera.

const groundRay=new THREE.Raycaster(), pointer=new THREE.Vector2(), groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0), hit=new THREE.Vector3();
// Reusable, small translucent destination ring. No notifications over controls.
const moveMarker=new THREE.Mesh(new THREE.RingGeometry(.28,.43,24),new THREE.MeshBasicMaterial({color:'#d8ff8c',side:THREE.DoubleSide,transparent:true,opacity:.75,depthWrite:false}));
const slamCircle=new THREE.Mesh(new THREE.RingGeometry(1.35,1.68,48),new THREE.MeshBasicMaterial({color:'#dcfd85',side:THREE.DoubleSide,transparent:true,opacity:.9,depthWrite:false}));
slamCircle.rotation.x=-Math.PI/2;slamCircle.visible=false;scene.add(slamCircle);
const rockCircleGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:113},(_,i)=>{
 const th=i/112*Math.PI*2;return new THREE.Vector3(Math.cos(th)*115*.058,0,Math.sin(th)*115*.058);
}));
const rockTrainGeometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:225},(_,i)=>{
 const th=i/224*Math.PI*2;return new THREE.Vector3(Math.sin(th)*180*.058,0,Math.sin(th*2)*90*.058);
}));
const rockRowGeometry=new THREE.BufferGeometry().setFromPoints([
 new THREE.Vector3(-2.4,0,-3.8),new THREE.Vector3(2.4,0,-3.8),new THREE.Vector3(2.4,0,3.8),new THREE.Vector3(-2.4,0,3.8)
]);
const rockFloorPath=new THREE.LineLoop(rockCircleGeometry,new THREE.LineBasicMaterial({color:'#fce084',transparent:true,opacity:.91,depthWrite:false}));
rockFloorPath.visible=false;rockFloorPath.renderOrder=38;scene.add(rockFloorPath);

// A lightweight, pooled 3D puff of sand: shown to EVERY player after the
// first arrival. No per-frame material allocations and no extra audio.
const slamDustParticles=[];
const slamDustGeometry=new THREE.SphereGeometry(1,7,5);
for(let i=0;i<28;i++){
 const material=new THREE.MeshBasicMaterial({color:['#eddfc7','#cfc2aa','#e7d1a7','#faf0d9'][i%4],transparent:true,opacity:0,depthWrite:false});
 const mesh=new THREE.Mesh(slamDustGeometry,material);
 mesh.visible=false;mesh.renderOrder=25;scene.add(mesh);
 slamDustParticles.push({mesh,active:false,vx:0,vy:0,vz:0,start:0,duration:0,size:0,x:0,y:0,z:0});
}
function spawnSlamDust(x,y){
 const center=toWorld({x,y}),now=performance.now();
 slamDustParticles.forEach((p,i)=>{
  // Deterministic distribution makes the cloud look consistent to spectators.
  const angle=(i*.61803398875%1)*Math.PI*2;
  const energy=.65+(i%7)*.085;
  p.x=center.x;p.y=.16;p.z=center.z;
  p.vx=Math.cos(angle)*energy*.014;
  p.vz=Math.sin(angle)*energy*.014;
  p.vy=.009+(i%5)*.003;
  p.size=.19+(i%4)*.07;p.duration=830+(i%6)*115;
  p.start=now;p.active=true;
  p.mesh.visible=true;p.mesh.position.set(p.x,p.y,p.z);
 });
}
function updateSlamDust(t){
 for(const p of slamDustParticles){if(!p.active)continue;
  const elapsed=t-p.start,progress=elapsed/p.duration;
  if(progress>=1){p.active=false;p.mesh.visible=false;continue}
  p.mesh.position.set(p.x+p.vx*elapsed,p.y+p.vy*elapsed-.000005*elapsed*elapsed,p.z+p.vz*elapsed);
  p.mesh.scale.setScalar(p.size*(1+progress*.95));
  p.mesh.material.opacity=.67*(1-progress)**1.5;
 }
}

moveMarker.rotation.x=-Math.PI/2;moveMarker.visible=false;scene.add(moveMarker);
let moveMarkerUntil=0;
let pointerStart=null;
const activeMapPointers=new Set();
gameTouchSurface.addEventListener('pointerdown',e=>{
 // A pinch must not accidentally place a slam or start walking.
 if(e.pointerType==='touch'&&activeMapPointers.size)pointerStart=null;
 else pointerStart={x:e.clientX,y:e.clientY,time:performance.now()};
 activeMapPointers.add(e.pointerId);
});
gameTouchSurface.addEventListener('pointercancel',e=>{activeMapPointers.delete(e.pointerId);pointerStart=null});
gameTouchSurface.addEventListener('pointerup',e=>{
 const wasMultiTouch=activeMapPointers.size>1;activeMapPointers.delete(e.pointerId);
 if(wasMultiTouch){pointerStart=null;return}
 if(!pointerStart||!state.me)return;
 const dist=Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y);pointerStart=null;
 if(dist>9)return;
 // Prefer an actual avatar hit over ground movement; keep drag/pinch controls unchanged.
 if(!rockPlacementMode&&!slamMode&&!currentDuo()){
  const bounds=renderer.domElement.getBoundingClientRect();let bestId=null,bestDistance=58;
  for(const [id,avatar] of avatars){
   if(id===state.id)continue;
   const characterTop=avatar.root.position.clone().add(new THREE.Vector3(0,2.0,0));
   const screen=characterTop.project(camera);if(screen.z<0||screen.z>1)continue;
   const px=bounds.left+(screen.x+1)*bounds.width*.5,py=bounds.top+(1-screen.y)*bounds.height*.5;
   const distance=Math.hypot(px-e.clientX,py-e.clientY);
   if(distance<bestDistance){bestId=id;bestDistance=distance}
  }
  if(bestId){if(!$('chatPanel').classList.contains('hidden'))selectBottomMenu('reaction');chooseDuoTarget(bestId);return}
 }
 closeDuoMenu();
 // A genuine tap on the 3D map closes the chat tab and returns to reactions.
 // Leave the dance tab untouched; dragging/orbiting and pinch gestures do not
 // change tabs. Do not intercept the ground click: walking still works.
 if(!$('chatPanel').classList.contains('hidden'))selectBottomMenu('reaction');
 const bounds=renderer.domElement.getBoundingClientRect();pointer.set(((e.clientX-bounds.left)/bounds.width)*2-1,-((e.clientY-bounds.top)/bounds.height)*2+1);
 groundRay.setFromCamera(pointer,camera);if(!groundRay.ray.intersectPlane(groundPlane,hit))return;
 const x=Math.max(20,Math.min(1380,hit.x/.058+600)),y=Math.max(220,Math.min(1100,(contractWorldZ(hit.z)-8)/.058+500));
 if(rockPlacementMode){
  const kind=rockPlacementMode;rockPlacementMode=null;refreshRockUI();
  post('rockplay',{id:state.id,command:'start',kind,x,y}).then(d=>applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil)).catch(e=>toast(e.message));
  return;
 }
 if(slamMode){
  slamMode=false;refreshSlamUI();
  post('slam',{id:state.id,command:'start',x,y}).then(d=>applySlam(d.slam,d.cooldownUntil)).catch(e=>toast(e.message));
  return;
 }
 // Raycast the actual 3D bench geometry, not the ground below it.
 // This works for both touch and mouse through the shared game touch surface.
 const benchHits=groundRay.intersectObjects(benchPickMeshes,false);
 if(benchHits.length){
  const selected=benchHits[0],center=selected.object.userData.benchCenter;
  const options=benchSeats.filter(seat=>seat.center===center.x);
  const seat=options.reduce((a,b)=>Math.abs(a.wx-selected.point.x)<=Math.abs(b.wx-selected.point.x)?a:b);
  if(slamMotion){slamMotion=null;state.action='idle';state.actionUntil=0;state.me.action='idle'}
 if(rockMotion)finishRockMotion();
  state.pose='stand';state.me.pose='stand';state.action='idle';state.me.action='idle';state.actionUntil=0;
  state.benchTarget=seat;state.walkTarget={x:seat.x,y:seat.y};
  updateActionButtons();sendMove();
  moveMarker.position.set(seat.wx,.085,seat.wz);moveMarker.visible=true;moveMarkerUntil=performance.now()+1150;
  return;
 }
 state.benchTarget=null;
 if(slamMotion){slamMotion=null;state.action='idle';state.actionUntil=0;state.me.action='idle'}
 if(rockMotion)finishRockMotion();
 if(state.pose!=='stand'){state.pose='stand';state.me.pose='stand';updateActionButtons()}
 state.walkTarget={x,y};
 // Visual ground marker replaces the full-screen toast (which covered mobile HUD).
 moveMarker.position.set(hit.x,.065,hit.z);moveMarker.visible=true;moveMarkerUntil=performance.now()+1150;

});
// The YouTube stage is a CSS3D layer above the WebGL canvas.
// Never hide player roots or chat bubbles when they overlap its projected area:
// doing so made entire characters vanish near the screen.
// Leave WebGL avatar and sprite visibility controlled solely by the actual
// multiplayer/reaction/chat lifetime states.

function finishSlamMotion(){
 slamMotion=null;
 state.action='idle';state.actionUntil=0;state.me.action='idle';
 document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));
 sendMove();
}
// Meshes may use either one material or an array of materials (check/dot sash).
// Disposing an array as if it were a Material used to throw during profile edits,
// aborting requestAnimationFrame and freezing the entire festival scene.
function disposeAvatar(root){
 scene.remove(root);
 const geometries=new Set(),materials=new Set(),textures=new Set();
 root.traverse(object=>{
  if(object.geometry)geometries.add(object.geometry);
  for(const material of (Array.isArray(object.material)?object.material:[object.material])){
   if(!material)continue;
   materials.add(material);
   if(material.map)textures.add(material.map);
  }
 });
 // Collect first; a shared material may be referenced by more than one mesh.
 // Per-avatar resources are created anew, while imported hair geometry is cloned.
 for(const geometry of geometries)geometry.dispose();
 for(const material of materials)material.dispose();
 for(const texture of textures)texture.dispose();
}
function tick(t){
 const frameDelta=Math.min(50,Math.max(0,t-(tick.lastFrame??t)));tick.lastFrame=t;
 if(state.me&&!currentDuo()){
  let dx=0,dy=0,speed=3.2,k=state.keys;
  dx+=+(k.has('d')||k.has('arrowright'))-+(k.has('a')||k.has('arrowleft'));
  dy+=+(k.has('s')||k.has('arrowdown'))-+(k.has('w')||k.has('arrowup'));
  if(dx||dy){
   state.walkTarget=null;state.benchTarget=null;
   if(slamMotion)finishSlamMotion();
   if(rockMotion)finishRockMotion();
  }
  if(!dx&&!dy&&slamMotion){
   const m=slamMotion;
   if(m.phase==='celebrate'){
    // Keep the hop + rock-horns bubble until the user moves, taps, or reacts.
    state.action='slam-celebrate';state.me.action='slam-celebrate';
   }else if(t-m.started>35000){
    // Safety timeout for an unreachable approach/retreat; still keep celebrating.
    m.phase='celebrate';m.phaseStarted=t;
    state.action='slam-celebrate';state.me.action='slam-celebrate';sendMove();
   }else{
    const dest=m.phase==='charge'?m.approach:m.retreat;
    const tx=dest.x-state.me.x,ty=dest.y-state.me.y,n=Math.hypot(tx,ty);
    if(n<=4){
     state.me.x=dest.x;state.me.y=dest.y;
     if(m.phase==='charge'){
      m.phase='retreat';m.phaseStarted=t;
      state.action='slam-retreat';state.me.action='slam-retreat';
      // The next frame naturally rotates to the outward retreat direction.
      sendMove();
     }else{
      m.phase='celebrate';m.phaseStarted=t;
      state.action='slam-celebrate';state.me.action='slam-celebrate';sendMove();
     }
    }else{
     // Travel through the rendered world at a stable pace even when the
     // map stretches a short section of server Y into a long 3D corridor.
     const next=stepWorldToward(state.me,dest,(m.phase==='charge'?13:5.5)*frameDelta/1000);
     state.me.x=Math.max(20,Math.min(1380,next.x));
     state.me.y=Math.max(220,Math.min(1100,next.y));
     state.me.facing=Math.atan2(tx,ty);
     state.action=m.phase==='charge'?'slam-charge':'slam-retreat';
     state.me.action=state.action;
     state.moving=true;
    }
   }
  }
  if(!dx&&!dy&&rockMotion){
   const m=rockMotion,elapsed=Math.max(0,slamNow()-m.startAt);
   if(!m.phase&&elapsed>=m.duration){if(m.kind==='toast'){m.phase='done';rockMotion=null;state.action='idle';state.me.action='idle';state.actionUntil=0;sendMove()}else beginRockCelebration(m)}
   if(m.phase==='done'){
    // Group cheers has finished; do not restart this turn.
   }else if(m.phase==='scatter'){
    const target=m.scatterTarget;
    const tx=target.x-state.me.x,ty=target.y-state.me.y;
    const distance=Math.hypot(tx,ty);
    if(distance<=3.5||t-m.phaseStarted>11000){
     m.phase='celebrate';
     state.action='slam-celebrate';state.me.action='slam-celebrate';
     state.actionUntil=Infinity;sendMove();
    }else{
     // Jumping retreat at a gentle, frame-rate-independent pace.
     const next=stepWorldToward(state.me,target,5.5*frameDelta/1000);
     state.me.x=Math.max(20,Math.min(1380,next.x));
     state.me.y=Math.max(220,Math.min(1100,next.y));
     state.me.facing=Math.atan2(tx,ty);
     state.action='slam-retreat';state.me.action='slam-retreat';
     state.actionUntil=Infinity;
     if(t-state.lastSent>90){state.lastSent=t;sendMove()}
    }
   }else if(m.phase==='celebrate'){
    state.action='slam-celebrate';state.me.action='slam-celebrate';
    state.actionUntil=Infinity;
   }else{
    const p=m.kind==='mosh'?moshPathAt(m,elapsed):rockPathAt(m,elapsed);
    // Gather into rows/circle with a short smooth approach, then perform in place.
    const gather=Math.min(1,elapsed/1400);
    const from=m.gatherFrom||p;
    const smooth=blendGroupWorld(from,p,gather);
    state.me.x=Math.max(20,Math.min(1380,smooth.x));
    state.me.y=Math.max(220,Math.min(1100,smooth.y));
    state.me.facing=m.kind==='toast'?Math.atan2(m.x-p.x,m.y-p.y):m.kind==='row'?0:Math.atan2(p.dx,p.dy);
    state.me.action=m.kind==='mosh'?'mosh-charge':m.kind==='circle'?'circle-run':m.kind==='row'?'row-paddle':m.kind==='toast'?'toast-clink':'train-run';state.action=state.me.action;
    if(m.kind==='mosh'){if(elapsed>=m.duration*.30&&!m.dustA){m.dustA=true;post('rockplay',{id:state.id,command:'impact',eventId:m.id,phase:1,x:state.me.x,y:state.me.y}).catch(()=>{})}if(elapsed>=m.duration*.96&&!m.dustB){m.dustB=true;post('rockplay',{id:state.id,command:'impact',eventId:m.id,phase:2,x:state.me.x,y:state.me.y}).catch(()=>{})}}
    state.moving=true;
    if(t-state.lastSent>70){state.lastSent=t;sendMove()}
   }
  }
  if(!dx&&!dy&&!slamMotion&&!rockMotion&&state.walkTarget){
   const tx=state.walkTarget.x-state.me.x,ty=state.walkTarget.y-state.me.y,n=Math.hypot(tx,ty);
   if(n>4){dx=tx/n;dy=ty/n}else{
    state.walkTarget=null;
    if(state.benchTarget){
     const bench=state.benchTarget;state.benchTarget=null;
     state.me.x=bench.x;state.me.y=bench.y;state.me.facing=0; // seated looking toward the sea
     state.pose='sit';state.me.pose='sit';state.action='idle';state.me.action='idle';state.actionUntil=0;
     updateActionButtons();sendMove();
    }
   }
  }
  state.moving=!!(dx||dy);
  if(state.moving && (state.action==='buriburi'||state.action==='groove'||state.action==='windmill'||state.action==='airguitar'||state.action==='headspin'||state.action==='cheer'||state.action==='smoke') && !slamMotion && !rockMotion){
   state.action='idle';state.me.action='walk';state.actionUntil=0;updateActionButtons();
  }
  if(state.moving){
   const n=Math.hypot(dx,dy);
   if(!slamMotion && !rockMotion){
    // v81: FIX movement through the stretched audience area.
    // v78 expanded 6 metres of map depth to 32 world metres. Moving by
    // fixed SERVER coordinates made the avatar visibly accelerate inside
    // that area. Walk in rendered 3D WORLD space, then invert the mapping.
    const at=toWorld(state.me);
    let worldDx=dx,worldDz=dy;
    if(state.walkTarget){
      const goal=toWorld(state.walkTarget);
      worldDx=goal.x-at.x;
      worldDz=goal.z-at.z;
    }
    const worldDist=Math.hypot(worldDx,worldDz);
    // Same measured speed on every part of the map: 6.09 world units/s
    // for walking, 9.86 for running. A click never overshoots its target.
    const worldSpeed=(state.action==='run'?9.86:6.09)*frameDelta/1000;
    const worldStep=Math.min(worldSpeed,worldDist);
    if(worldDist>0.00001){
      const nextX=at.x+worldDx/worldDist*worldStep;
      const nextZ=at.z+worldDz/worldDist*worldStep;
      state.me.x=Math.max(20,Math.min(1380,nextX/.058+600));
      state.me.y=Math.max(220,Math.min(1100,(contractWorldZ(nextZ)-8)/.058+500));
    }
   }else{
    // Group rock-play and slam motion use their own intentional pace.
    state.me.x=Math.max(20,Math.min(1380,state.me.x+dx/n*speed));
    state.me.y=Math.max(220,Math.min(1100,state.me.y+dy/n*speed));
   }
   if(state.action!=='skanking'||slamMotion||rockMotion)state.me.facing=Math.atan2(dx,dy);
   if(state.pose!=='stand'){state.pose='stand';state.me.pose='stand';updateActionButtons()}
   if(['sit','lie'].includes(state.action)){state.action='idle';state.me.action='idle'}
   if(!slamMotion&&!rockMotion&&(state.action==='idle'||state.action==='walk'))state.me.action='walk';
   // Skanking remains the authoritative animation while travelling on foot.
   if(!slamMotion&&!rockMotion&&state.action==='skanking')state.me.action='skanking';
  }else if(!slamMotion&&!rockMotion&&state.me.action==='walk')state.me.action='idle';
  if(!slamMotion&&!rockMotion&&t>state.actionUntil&&state.action!=='idle'&&state.action!=='run'){
   state.action='idle';state.me.action=state.moving?'walk':'idle';
   updateActionButtons();
  }
  if(t-state.lastSent>150){state.lastSent=t;sendMove()}
 }

 for(let [id,p] of state.players){
  const current=avatars.get(id);
  if(current&&(current.color!==p.color||current.name!==p.name||current.gender!==p.gender||current.pattern!==(p.pattern||'solid')||current.sash!==(p.sash||'none')||current.hairStyle!==(p.hairStyle||'short')||current.hairColor!==(p.hairColor||'#4b3932'))){
   disposeAvatar(current.root);avatars.delete(id);
  }
  if(!avatars.has(id)){let a=makeAvatar(p),pos=toWorld(p);a.root.position.set(pos.x,0,pos.z);a.name=p.name;a.gender=p.gender;a.pattern=p.pattern||'solid';a.sash=p.sash||'none';a.hairStyle=p.hairStyle||'short';a.hairColor=p.hairColor||'#4b3932';avatars.set(id,a)}
  animateAvatar(avatars.get(id),p,t)
 }
 for(let [id,a] of avatars)if(!state.players.has(id)){disposeAvatar(a.root);avatars.delete(id)}
 if(moveMarker.visible){moveMarker.material.opacity=Math.min(.75,Math.max(0,(moveMarkerUntil-t)/1050)*.75);if(t>moveMarkerUntil)moveMarker.visible=false}
 updateDuoVfx();updateEnvironment();animateSky(t);updateOcean(t);updateSlamDust(t);updateBubbles(t);animateShow(t);updateHourlyFireworks(t);animateToastSparks(t);followLocalAvatar();controls.update();keepCameraInFrontOfStage();updateSlamVisual(t);updateRockPlayVisual(t);renderer.render(scene,camera);cssRenderer.render(scene,camera);renderStageForeground();requestAnimationFrame(tick)
}
function resize(){let w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);cssRenderer.setSize(w,h);if(stageForeground)stageForeground.setSize(w,h,false)}new ResizeObserver(resize).observe(host);resize();requestAnimationFrame(tick);
setInterval(()=>{syncVideo();reportDuration();let m=state.music;if(!m.id)return;let sec=m.paused?m.position:(Date.now()+state.serverDelta-m.startedAt)/1000;let dur=state.ytReady?state.yt.getDuration():0;$('progressFill').style.width=dur?Math.min(100,sec/dur*100)+'%':'0%'},5000);
window.addEventListener('pagehide',()=>{if(state.id)navigator.sendBeacon('/api/leave',new Blob([JSON.stringify({id:state.id,pageId})],{type:'application/json'}))});

const ytScript=document.createElement('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.appendChild(ytScript);

function closeMusicPanel(){
 // Blurring the URL input also closes the on-screen keyboard on mobile.
 const input=$('videoUrl');
 if(document.activeElement===input)input.blur();
 document.body.classList.remove('music-open');
}
$('musicToggle').onclick=()=>{
 if(document.body.classList.contains('music-open'))closeMusicPanel();
 else{document.body.classList.add('music-open');selectBottomMenu('reaction')}
};
// Close on the first pointer contact; the normal click remains a fallback for
// keyboard accessibility and desktop browsers.
$('musicClose').addEventListener('pointerdown',event=>{
 event.preventDefault();event.stopPropagation();closeMusicPanel();
});
$('musicClose').onclick=event=>{event.preventDefault();event.stopPropagation();closeMusicPanel()};

function showMusicControlNotice(name,command){const messages={pause:'일시정지했습니다',resume:'다시 재생했습니다',skip:'다음 곡으로 넘겼습니다'};if(messages[command])notice((name||'참가자')+'님이 음악을 '+messages[command])}
function notice(message){const host=$('joinNotices');const el=document.createElement('div');el.textContent=message;host.append(el);setTimeout(()=>el.remove(),4400)}
function appendChat(entry){const el=document.createElement('div');el.className='chat-line';const who=document.createElement('b');who.textContent=entry.name+' : ';const value=document.createElement('span');value.textContent=entry.message;el.append(who,value);$('chatMessages').append(el);while($('chatMessages').children.length>35)$('chatMessages').firstChild.remove();$('chatMessages').scrollTop=$('chatMessages').scrollHeight}
function closeChatPanel(){selectBottomMenu('reaction')}
$('chatClose').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();closeChatPanel()});
$('chatClose').onclick=e=>{e.stopPropagation();closeChatPanel()};
async function sendChatMessage(message){
 if(!state.id)return toast('먼저 입장해 주세요');
 const text=String(message||'').trim();if(!text)return;
 if(text.length>80)return toast('메시지는 80자까지 입력할 수 있어요');
 try{await post('chat',{id:state.id,message:text});return true}catch(e){toast(e.message);return false}
}
document.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>sendChatMessage(b.dataset.chat));
$('chatForm').addEventListener('submit',async e=>{
 e.preventDefault();const input=$('chatInput');const button=$('chatSend');
 if(button.disabled)return;
 const message=input.value.trim();if(!message)return;
 button.disabled=true;
 const sent=await sendChatMessage(message);
 button.disabled=false;
 if(sent){input.value='';input.focus()}
});

// Keep the festival canvas at a stable layout viewport height. The mobile
// visualViewport can shrink when the keyboard, URL bar or YouTube player UI
// changes; using it as the whole app height caused visible letterboxing.
let viewportLayoutWidth=window.innerWidth;
function updateVisibleViewport(force=false){
 const width=window.innerWidth;
 if(force||Math.abs(width-viewportLayoutWidth)>25){
  viewportLayoutWidth=width;
  document.documentElement.style.setProperty('--app-height',Math.round(window.innerHeight)+'px');
 }
}
updateVisibleViewport(true);
window.addEventListener('resize',()=>updateVisibleViewport(),{passive:true});
window.addEventListener('orientationchange',()=>{viewportLayoutWidth=-1;updateVisibleViewport(true)},{passive:true});
// Deliberately do not resize the game when visualViewport height alone changes.

// Teach touch-to-move without covering the map permanently.
function showMovementGuide(){
 const guide=document.getElementById('movementGuide');if(!guide)return;
 guide.classList.add('visible');clearTimeout(showMovementGuide.timer);
 showMovementGuide.timer=setTimeout(()=>guide.classList.remove('visible'),9000);
}
document.getElementById('movementGuideDismiss')?.addEventListener('click',()=>document.getElementById('movementGuide').classList.remove('visible'));

// Auto-enter with saved character settings; a failed request leaves the editor open.
if(savedProfile && typeof savedProfile.name==='string' && savedProfile.name.trim()){
  document.getElementById('joinModal')?.classList.add('hidden');
  join({auto:true}).then(()=>{if(!state.id)document.getElementById('joinModal')?.classList.remove('hidden')}).catch(()=>{document.getElementById('joinModal')?.classList.remove('hidden')});
}
