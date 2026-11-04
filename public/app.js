import * as THREE from 'https://esm.sh/three@0.160.1';
import { OrbitControls } from 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'https://esm.sh/three@0.160.1/examples/jsm/renderers/CSS3DRenderer.js';
const $=id=>document.getElementById(id), palette=['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee'];
const mats=[{x:118,y:682,c:'#f5a5a3'},{x:290,y:706,c:'#a7def4'},{x:470,y:690,c:'#f5ce80'},{x:650,y:708,c:'#b3d9a0'},{x:835,y:694,c:'#ceb8f1'},{x:1015,y:710,c:'#ffd2a5'},{x:1185,y:688,c:'#b2d8ff'}];
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',pose:'stand',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0,token:0},queue:[],history:[],serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:false,skipVote:null,skipVoteCooldownUntil:0,walkTarget:null,benchTarget:null,moving:false};
let slamMode=false,slam=null,slamCooldownUntil=0,slamMotion=null;
let rockPlacementMode=null,rockPlay=null,rockCooldowns={circle:0,train:0,mosh:0},rockRunningUntil=0,rockMotion=null;
let chosenColor=palette[0],chosenGender='male',toastTimer;const avatars=new Map();const activeBubbles=new Map();
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000)}
document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>{chosenGender=b.dataset.gender;document.querySelectorAll('[data-gender]').forEach(x=>x.classList.toggle('selected',x===b))});
function colorPicker(){let r=$('colorPicker');r.innerHTML='';palette.forEach(c=>{let b=document.createElement('button');b.style.background=c;b.className=c===chosenColor?'selected':'';b.setAttribute('aria-label','티셔츠 '+c);b.onclick=()=>{chosenColor=c;colorPicker()};r.append(b)})}colorPicker();
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
   const r=await fetch('/api/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:state.me?.name||$('nick').value||'ROCKER',color:state.me?.color||chosenColor,gender:state.me?.gender||chosenGender})});
   if(!r.ok)throw Error('재접속 실패');const d=await r.json();
   const old=state.me;state.id=d.id;state.me=d.players.find(x=>x.id===d.id);
   if(old){state.me.x=old.x;state.me.y=old.y;state.me.facing=old.facing;state.me.action=old.action;state.me.pose=old.pose;}
   state.players=new Map(d.players.map(x=>[x.id,x]));renderOnlinePlayers();listen();
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
function updateSharedMusicButtons(){const m=state.music||{};const status=$('sharedMusicStatus');if(status)status.textContent=!m.id?'음악 대기 중':'재생 중 · '+(m.title||'유튜브 음악');const btn=$('sharedSkip');if(btn){btn.disabled=!m.id||!!state.skipVote||Date.now()<state.skipVoteCooldownUntil;btn.textContent=state.skipVote?'🗳️ 투표 진행 중':'⏭ 다음 곡 투표'}const side=$('skipMusic');if(side)side.disabled=btn?.disabled??true}

function updateFestivalBoard(){let m=state.music||{};const title=document.getElementById('boardCurrent');const next=document.getElementById('boardNext');const status=document.getElementById('boardStatus');if(title)title.textContent=m.title||'현재 재생 중인 곡 없음';if(next)next.textContent=state.queue?.length?state.queue[0].title:'예약된 곡 없음';if(status)status.textContent=m.id?(m.paused?'일시정지':'공연 중'):'공연 대기 중';}
function renderQueue(){
 updateFestivalBoard();const el=$('queueList');if(!el)return;el.replaceChildren();
 const section=(title,items,source)=>{
  const header=document.createElement('li');header.className='track-section';header.textContent=title;el.append(header);
  items.forEach((track,index)=>{const li=document.createElement('li');li.className='track-item '+(source==='now'?'track-current':'track-muted');
   const b=document.createElement('button');b.type='button';b.textContent=(source==='now'?'▶ ':source==='history'?'↶ ':'♫ ')+track.title+' · '+(track.addedBy||'');
   if(source!=='now'){b.title='이 곡을 재생할지 접속자 투표를 시작합니다';b.onclick=()=>musicCommand('vote-select',{source,index,videoId:track.id})}else b.disabled=true;
   li.append(b);el.append(li);
  });
 };
 section('지난 곡',state.history,'history');
 if(state.music?.id)section('현재 재생 중',[{title:state.music.title,addedBy:state.music.changedBy}],'now');
 section('예약곡',state.queue,'queue');
}
let reportedToken=0;
function reportDuration(){if(!state.id||!state.ytReady||!state.music.id)return;const duration=state.yt.getDuration();if(duration>1&&reportedToken!==state.music.token){reportedToken=state.music.token;post('music',{id:state.id,command:'duration',token:state.music.token,duration}).catch(()=>{})}}
function syncVideo(force=false){let m=state.music;if(!m.id||!state.ytReady)return;let sec=m.paused?m.position:Math.max(0,(Date.now()+state.serverDelta-m.startedAt)/1000);try{if(state.lastTrack!==String(m.token)+':'+m.id){state.lastTrack=String(m.token)+':'+m.id;reportedToken=0;if(state.audioEnabled&&!m.paused){state.yt.loadVideoById({videoId:m.id,startSeconds:sec});state.yt.unMute()}else state.yt.cueVideoById({videoId:m.id,startSeconds:sec});return}if(force||Math.abs(state.yt.getCurrentTime()-sec)>3)state.yt.seekTo(sec,true);if(state.audioEnabled){if(m.paused)state.yt.pauseVideo();else if(state.yt.getPlayerState()!==1)state.yt.playVideo()}else state.yt.pauseVideo()}catch(e){console.warn(e)}}
window.onYouTubeIframeAPIReady=()=>{state.yt=new YT.Player('youtubePlayer',{height:'100%',width:'100%',playerVars:{playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{state.ytReady=true;syncVideo(true)},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING||e.data===YT.PlayerState.CUED)reportDuration();if(e.data===YT.PlayerState.ENDED&&state.id&&state.music.id)post('music',{id:state.id,command:'ended',token:state.music.token}).catch(()=>{})},onError:()=>toast('영상이 임베드 재생을 허용하지 않습니다')}})};
async function musicCommand(command,extra={}){if(!state.id)return toast('먼저 입장해주세요');try{let d=await post('music',{id:state.id,command,...extra});applyMusic(d.music,d.serverNow,d.queue,d.history);toast('공유 음악이 업데이트되었습니다')}catch(e){toast(e.message)}}
$('playLink').onclick=()=>musicCommand('enqueue',{url:$('videoUrl').value});$('skipMusic').onclick=()=>musicCommand('vote-start');$('sharedSkip').onclick=()=>musicCommand('vote-start');$('skipVoteYes').onclick=()=>castSkipVote('yes');$('skipVoteNo').onclick=()=>castSkipVote('no');$('enableAudio').onclick=()=>{state.audioEnabled=true;try{state.yt?.unMute()}catch(e){}syncVideo(true);toast('이 기기의 소리를 켰어요')};$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('playLink').click()});
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

function listen(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);if(Array.isArray(d.chat)){$('chatMessages').replaceChildren();d.chat.forEach(appendChat)}}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();if(d.player.id!==state.id)notice(d.player.name+' 들어왔습니다')}else if(d.type==='chat'){appendChat(d.entry);showBubble(d.entry)}else if(d.type==='move'){state.players.set(d.player.id,d.player)}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers()}else if(d.type==='music')applyMusic(d.music,d.serverNow,d.queue,d.history);else if(d.type==='slam')applySlam(d.slam,d.cooldownUntil);else if(d.type==='slam-go')onSlamGo(d);else if(d.type==='slam-impact')spawnSlamDust(d.x,d.y);else if(d.type==='cheer'&&d.playerId!==state.id&&state.audioEnabled)playCheer();else if(d.type==='rockplay')applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil);else if(d.type==='rockplay-go')onRockPlayGo(d);else if(d.type==='music-booked')showBookingNotice(d.name,d.title);else if(d.type==='music-control')showMusicControlNotice(d.name,d.command);else if(d.type==='skip-vote')applySkipVote(d.vote,d.cooldownUntil);else if(d.type==='skip-vote-result')showSkipVoteResult(d)};state.es.onerror=()=>{ /* EventSource retries automatically; heartbeat repairs an expired session. */ }}
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
async function join(){manualExit=false;try{let d=await post('join',{name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);state.pose=state.me?.pose||'stand';cameraFollowInitialized=false;state.players=new Map(d.players.map(p=>[p.id,p]));renderOnlinePlayers();$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);listen();$('audioModal').classList.remove('hidden');showMovementGuide();toast('ONEseason에 오신 것을 환영합니다!')}catch(e){$('joinError').textContent='입장 실패: '+(e?.message||'연결을 확인해주세요');console.error('ONEseason join error:',e)}}
$('audioYes').onclick=()=>{state.audioEnabled=true;$('audioModal').classList.add('hidden');if(state.ytReady){try{state.yt.unMute();state.yt.setVolume(75)}catch(e){}}syncVideo(true);toast(state.music.id?'음악 재생을 허용했어요':'음악이 등록되면 바로 재생돼요')};$('audioNo').onclick=()=>{state.audioEnabled=false;$('audioModal').classList.add('hidden');try{state.yt?.pauseVideo()}catch(e){}toast('음악을 끈 상태로 입장했어요')};$('joinBtn').onclick=join;$('nick').onkeydown=e=>{if(e.key==='Enter')join()};$('editAvatar').onclick=()=>{manualExit=true;if(state.id){post('leave',{id:state.id}).catch(()=>{});state.es?.close();state.id=null;state.me=null;cameraFollowInitialized=false;state.players.clear();state.skipVote=null;applySkipVote(null,state.skipVoteCooldownUntil);state.pose='stand';slam=null;slamMode=false;slamMotion=null;rockPlay=null;rockMotion=null;rockPlacementMode=null;refreshSlamUI();refreshRockUI()}$('joinModal').classList.remove('hidden')};$('helpBtn').onclick=()=>toast('WASD 이동 · 클릭/터치 이동 · 드래그 시점 회전 · 춤: B/G/V/K · 환호성: H');
const sustainedReactions=new Set(['jump','run','headbang','buriburi','groove','windmill','skanking','cheer']);
document.querySelectorAll('[data-action-menu]').forEach(button=>button.addEventListener('click',()=>{const dance=button.dataset.actionMenu==='dance';$('danceActions').classList.toggle('hidden',!dance);$('reactionActions').classList.toggle('hidden',dance);document.querySelectorAll('[data-action-menu]').forEach(b=>b.classList.toggle('active',b===button))}));
function updateActionButtons(){
 document.querySelectorAll('[data-action]').forEach(b=>{
  const a=b.dataset.action;
  const chosen=(a==='sit'&&state.pose==='sit')||(a==='lie'&&state.pose==='lie')||(!['sit','lie'].includes(a)&&state.action===a);
  b.classList.toggle('active',chosen);
 });
}
function react(a){
 if(!state.me)return;
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
  if((a==='jump'||a==='run'||a==='buriburi'||a==='groove'||a==='windmill'||a==='skanking'||a==='cheer')&&state.pose!=='stand'){
   state.pose='stand';state.me.pose='stand';
  }
  state.action=a;state.me.action=a;if(a==='cheer')playCheer();
  state.actionUntil=sustainedReactions.has(a)?Infinity:performance.now()+(a==='peace'?2200:a==='snack'?3300:1750);
 }
 updateActionButtons();sendMove();
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target?.isContentEditable)return;let k=e.key.toLowerCase();if(k.startsWith('arrow')||k===' ')e.preventDefault();state.keys.add(k);let acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'clap','6':'sit','7':'lie','8':'drink','9':'snack','0':'headbang','b':'buriburi','g':'groove','v':'windmill','k':'skanking','h':'cheer'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
function playCheer(){
 try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;const context=new Ctx();
  const length=Math.floor(context.sampleRate*.75),buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<length;i++){const t=i/context.sampleRate;const envelope=Math.pow(Math.sin(Math.PI*i/length),.8);data[i]=(Math.random()*2-1)*envelope*.13*(.65+.35*Math.sin(t*26));}
  const source=context.createBufferSource();source.buffer=buffer;const filter=context.createBiquadFilter();filter.type='bandpass';filter.frequency.value=780;filter.Q.value=.6;source.connect(filter);filter.connect(context.destination);source.start();source.onended=()=>context.close();
 }catch(e){console.warn('Cheer audio not available',e)}
}
function sendMove(){if(!state.id||!state.me)return;let p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action,pose:p.pose||'stand'}).catch(()=>{})}
// Shared SLAM countdown (server timestamps, 15 s global launch cooldown).
const slamButton=$('slamButton'),slamInfo=$('slamInfo'),slamMarker=$('slamMarker'),slamCount=$('slamCount'),slamMembers=$('slamMembers'),slamJoin=$('slamJoin');
function slamNow(){return Date.now()+state.serverDelta}
function refreshSlamUI(){
 const remain=Math.max(0,Math.ceil((slamCooldownUntil-slamNow())/1000));
 slamButton.disabled=!state.id||!!slam||!!rockPlay||slamNow()<rockRunningUntil||remain>0;
 slamButton.classList.toggle('placing',slamMode);
 slamButton.textContent=slamMode?'📍 바닥을 터치하세요':slam?'🔥 슬램 진행 중':remain?`🔥 슬램 ${remain}초`:'🔥 슬램 만들기';
 slamInfo.textContent=rockPlacementMode?(rockPlacementMode==='circle'?'써클핏 위치를 터치하세요':rockPlacementMode==='mosh'?'모싱 위치를 터치하세요':'기차놀이 위치를 터치하세요'):rockPlay?(rockPlay.kind==='circle'?'써클핏 참가자를 모집 중이에요':rockPlay.kind==='mosh'?'모싱 참가자를 모집 중이에요':'기차놀이 참가자를 모집 중이에요'):slamMode?'슬램 위치를 터치하세요':slam?'슬램 참가자를 모집 중이에요':remain?`다음 슬램까지 ${remain}초`:'락놀이 메뉴에서 슬램·써클핏·기차놀이 선택';
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
const rockMenuButton=$('rockMenuButton'),rockMenuPanel=$('rockMenuPanel'),circleButton=$('circleButton'),trainButton=$('trainButton'),moshButton=$('moshButton');
rockMenuButton.onclick=()=>{const show=rockMenuPanel.classList.contains('hidden');rockMenuPanel.classList.toggle('hidden',!show);rockMenuButton.setAttribute('aria-expanded',String(show))};
function closeRockMenu(){rockMenuPanel.classList.add('hidden');rockMenuButton.setAttribute('aria-expanded','false')}
function refreshRockUI(){
 const now=slamNow(),occupied=!!rockPlay||!!slam||now<rockRunningUntil;
 for(const [button,kind,name] of [[circleButton,'circle','써클핏'],[trainButton,'train','기차놀이'],[moshButton,'mosh','모싱']]){
   const remaining=Math.max(0,Math.ceil((rockCooldowns[kind]-now)/1000));
   button.disabled=!state.id||occupied||remaining>0;
   button.classList.toggle('placing',rockPlacementMode===kind);
   button.textContent=rockPlacementMode===kind?'📍 '+name+' 위치 선택':remaining?`⏱ ${name} ${remaining}초`:`${kind==='circle'?'🔄':kind==='mosh'?'🥊':'🚂'} ${name} 만들기`;
 }
}
function applyRockPlay(event,cooldowns,runningUntil){
 if(cooldowns&&typeof cooldowns==='object'){
  for(const kind of ['circle','train','mosh'])if(Number.isFinite(Number(cooldowns[kind])))rockCooldowns[kind]=Number(cooldowns[kind]);
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
   state.pose='stand';state.me.pose='stand';state.action=event.kind==='mosh'?'mosh-charge':event.kind==='circle'?'circle-run':'train-run';state.me.action=state.action;
   if(event.kind==='mosh'){const start={x:state.me.x,y:state.me.y};rockMotion.moshStart=start;rockMotion.moshDestination={x:event.x+(index-participants.length/2)*7,y:event.y};rockMotion.dustA=false;rockMotion.dustB=false;}
   state.actionUntil=Infinity;updateActionButtons();sendMove();
 }
 rockPlay=null;refreshRockUI();refreshSlamUI();
}
for(const [button,kind] of [[circleButton,'circle'],[trainButton,'train'],[moshButton,'mosh']]){
 button.onclick=()=>{
   if(!state.id||rockPlay||slam||rockRunningUntil>slamNow()||rockCooldowns[kind]>slamNow())return;
   rockPlacementMode=rockPlacementMode===kind?null:kind;slamMode=false;
   closeRockMenu();refreshRockUI();refreshSlamUI();
   slamInfo.textContent=rockPlacementMode?`${kind==='circle'?'써클핏':kind==='mosh'?'모싱':'기차놀이'} 장소를 터치하세요`:'락놀이 메뉴에서 선택해 주세요';
 };
}
function moshPathAt(m,elapsed){
 const fraction=Math.min(1,Math.max(0,elapsed/m.duration));
 const from=m.moshStart||{x:state.me.x,y:state.me.y};const dest=m.moshDestination||{x:m.x,y:m.y};
 const half={x:from.x+(dest.x-from.x)*.5,y:from.y+(dest.y-from.y)*.5};
 let a,b,t;
 if(fraction<.30){a=from;b=dest;t=fraction/.30}
 else if(fraction<.65){a=dest;b=half;t=(fraction-.30)/.35}
 else {a=half;b=dest;t=Math.min(1,(fraction-.65)/.31)}
 const u=t*t*(3-2*t);const x=a.x+(b.x-a.x)*u,y=a.y+(b.y-a.y)*u;
 return {x,y,dx:b.x-a.x,dy:b.y-a.y};
}
function rockPathAt(m,elapsed){
 const elapsedFraction=Math.min(1,Math.max(0,elapsed/m.duration));
 if(m.kind==='circle'){
   const angle=elapsedFraction*Math.PI*10 + m.index*2*Math.PI/Math.max(1,m.count);
   return {x:m.x+Math.cos(angle)*115,y:m.y+Math.sin(angle)*115,dx:-Math.sin(angle),dy:Math.cos(angle)};
 }
 // Horizontal figure-eight, exactly four complete circuits of the entire path.
 // Small phase offsets make a single-file train rather than spreading participants around it.
 const phase=elapsedFraction*Math.PI*8 - m.index*.115;
 return {x:m.x+Math.sin(phase)*180,y:m.y+Math.sin(phase*2)*90,dx:180*Math.cos(phase),dy:180*Math.cos(phase*2)};
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
 rockFloorPath.geometry=rockPlay.kind==='circle'||rockPlay.kind==='mosh'?rockCircleGeometry:rockTrainGeometry;
 if(pos.z>=1||pos.z<=-1){slamMarker.hidden=true;return}
 slamMarker.hidden=false;
 slamCount.textContent=String(Math.max(1,Math.ceil(remaining/1000)));
 slamMembers.textContent=`${rockPlay.kind==='circle'?'써클핏':rockPlay.kind==='mosh'?'모싱':'기차놀이'} · ${rockPlay.participants.length}명 참가`;
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
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(175,28,20),new THREE.MeshBasicMaterial({color:'#82c4ff',side:THREE.BackSide,fog:false}));scene.add(skyDome);
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

const floor=cube(104,.4,86,grass,0,-.24,10);floor.receiveShadow=true;
const promenade=cube(112,.05,3.2,mat('#6a806d'),0,.02,1,false);
promenade.receiveShadow=true;
const lawn=cube(100,.06,36,mat('#4f765f'),0,.03,24,false);
lawn.receiveShadow=true;
const sandMat=mat('#dec391',.95),wetSandMat=mat('#c9ab74',.94);
const beach=cube(110,.06,28,sandMat,0,.02,56,false);beach.receiveShadow=true;
const wetBand=cube(110,.045,6.5,wetSandMat,0,.03,67,false);
const oceanGeo=new THREE.PlaneGeometry(170,104,56,32);
const oceanMat=new THREE.MeshStandardMaterial({color:'#3f95c9',roughness:.24,metalness:.04,transparent:true,opacity:.96,side:THREE.DoubleSide});
const ocean=new THREE.Mesh(oceanGeo,oceanMat);ocean.rotation.x=-Math.PI/2;ocean.position.set(0,-.15,112);ocean.receiveShadow=true;scene.add(ocean);
const oceanBase=oceanGeo.attributes.position.array.slice();
const foamStrips=[];
for(let i=0;i<5;i++){const foam=new THREE.Mesh(new THREE.PlaneGeometry(100-i*10,1.35),new THREE.MeshBasicMaterial({color:'#f8ffff',transparent:true,opacity:.3-i*.04,side:THREE.DoubleSide,depthWrite:false}));foam.rotation.x=-Math.PI/2;foam.position.set(0,.09,66.5+i*1.8);scene.add(foam);foamStrips.push(foam)}
const horizonGlow=new THREE.Mesh(new THREE.PlaneGeometry(200,38),new THREE.MeshBasicMaterial({color:'#f7b89b',transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false}));horizonGlow.position.set(0,15,144);scene.add(horizonGlow);
for(const x of [-40,-28,-15,16,31,45]){const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1.2+Math.abs(x)%3*.22),mat('#6f6d75'));rock.position.set(x,.85,70+Math.abs(x)%3*2.5);rock.rotation.set(.25,.3,0);rock.castShadow=true;rock.receiveShadow=true;scene.add(rock)}
function dune(x,z,sx,sz,sy=.8){const d=new THREE.Mesh(new THREE.SphereGeometry(1.9,18,14),sandMat);d.scale.set(sx,sy,sz);d.position.set(x,.7,z);d.castShadow=false;d.receiveShadow=true;scene.add(d)}
[[-36,48,4.6,1.5,.95],[-18,52,5.5,1.8,1.05],[8,49,6.6,2.0,.92],[28,53,5.1,1.7,1.0],[44,49,3.8,1.3,.8]].forEach(v=>dune(...v));
// Main stage faces the audience: far north = negative z.
cube(45,1.7,14,dark,0,1,-25);cube(47,1.2,1,metal,0,2.05,-17.3);cube(46,1.5,1,dark,0,13.8,-31);cube(1,13.8,1,metal,-22,7.8,-31);cube(1,13.8,1,metal,22,7.8,-31);cube(46,11.8,.6,dark,0,7.2,-31);
const sign=new THREE.Mesh(new THREE.PlaneGeometry(24,1.6),label('ONEseason',78,'#dcfd8b','#18172e'));sign.position.set(0,13.9,-29.85);scene.add(sign);
for(let x=-22;x<=22;x+=2.2){cube(.13,8.6,.13,metal,x,6.2,-30.1,false);let bulb=sphere(.19,mat(['#ff5b98','#bc9dff','#deff8c','#68e6f3'][Math.round((x+22)/2.2)%4],.2,'#ffffff'),x,13.15,-28.9);bulb.material.emissiveIntensity=1.2}
for(let s of [-1,1]){for(let j=0;j<2;j++){let x=s*18.5,z=-25+j*3.4;cube(3.8,4.3,2.7,dark,x,4.4,z);for(let dy of [3.2,5.5]){let o=cylinder(1,1,.16,metal,x,dy,z+1.44);o.rotation.x=Math.PI/2;let p=cylinder(.72,.72,.17,mat('#0d0e1b'),x,dy,z+1.58);p.rotation.x=Math.PI/2}}}
// drum kit + guitars on stage
cylinder(1.55,1.55,1.2,mat('#d671c0',.5),0,3.25,-25);for(let x of [-2.2,2.2]){cylinder(.82,.82,.72,mat('#94bbfe'),x,3.65,-26);cylinder(.07,.07,3,metal,x*1.3,3.8,-26)}
for(let x of [-8,8]){cylinder(.12,.12,3.2,metal,x,4,-24);sphere(.18,mat('#fcf6d5'),x,5.65,-24)}
// Crowd barrier
for(let x=-34;x<=34;x+=3){cube(.11,1.45,.11,metal,x,.9,-13.2);if(x<34)cube(3,.13,.13,metal,x+1.5,1.48,-13.2)}
// Walkway and picnic area
cube(96,.05,2.2,mat('#5e705e'),0,.04,10,false);cube(102,.06,38,mat('#486c59'),0,.03,27,false);
const matPositions=mats.map(m=>({x:(m.x-600)*.058,z:((m.y-500)*.058)+8,c:m.c}));
const picnicProps=[];
matPositions.forEach((m,i)=>{
 const blanket=cube(8.8,.10,6.1,mat(m.c),m.x,.13,m.z);blanket.rotation.y=[-.12,.10,0,-.08,.12,.05,-.07][i%7];
 for(let edge of [-1,1])cube(8.5,.025,.11,mat('#f8f6e5'),m.x,.22,m.z+edge*2.42,false);
 for(let j=0;j<2;j++){const pillow=cube(1.5,.28,.9,mat(['#ffefe0','#e2f2fa','#fdf2ce','#fce0f5'][j%4]),m.x-2.5+j*5,.34,m.z-2.0);pillow.rotation.y=.15*(j?1:-1);picnicProps.push(pillow)}
 const table=cylinder(.74,.84,.58,mat('#7d624e'),m.x+3.35,.55,m.z+3.85);picnicProps.push(table);
 const lamp=sphere(.19,new THREE.MeshStandardMaterial({color:'#fff1bf',emissive:'#ffd982',emissiveIntensity:1.3}),m.x+3.35,.98,m.z+3.85);picnicProps.push(lamp);
 // Food is placed on the grass just IN FRONT of the picnic mat, without
 // changing any of the existing rest-pose or movement coordinates.
 const picnicTray=cube(3.8,.10,1.65,mat('#b48b69'),m.x-.75,.16,m.z+3.62,false);
 // Two realistic paper cups: taper, open dark inner surface, bright rim.
 const paperCupMaterial=mat(i%2?'#f8e9d5':'#faf8f0',.91),rimMat=mat('#fffdf8',.86);
 for(let j=0;j<2;j++){
  const cx=m.x-2.05+j*.65,cz=m.z+3.55;
  const cup=cylinder(.24,.17,.57,paperCupMaterial,cx,.49,cz);cup.castShadow=false;
  const top=new THREE.Mesh(new THREE.CircleGeometry(.189,16),mat('#a17d5b'));top.rotation.x=-Math.PI/2;top.position.set(cx,.778,cz);scene.add(top);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.235,.028,6,20),rimMat);rim.rotation.x=Math.PI/2;rim.position.set(cx,.79,cz);scene.add(rim);
 }
 // Pizza: low round pizza with tomato and cheese, separate raised crust,
 // plus a few pepperoni pieces. Instanced only a handful per picnic area.
 const pizzaX=m.x-.38,pizzaZ=m.z+3.66;
 const pizzaPlate=cylinder(.83,.83,.07,mat('#f0e6d4'),pizzaX,.29,pizzaZ);pizzaPlate.castShadow=false;
 const pizzaCrust=cylinder(.72,.72,.07,mat('#bb8654'),pizzaX,.37,pizzaZ);pizzaCrust.castShadow=false;
 const sauce=cylinder(.62,.62,.025,mat('#d25a42'),pizzaX,.423,pizzaZ);sauce.castShadow=false;
 const cheese=cylinder(.56,.56,.025,mat('#efcb79'),pizzaX,.448,pizzaZ);cheese.castShadow=false;
 for(let k=0;k<5;k++){
  const a=k*2.4+i*.27;
  const topping=cylinder(.105,.105,.017,mat('#b44d3d'),pizzaX+Math.cos(a)*.32,.475,pizzaZ+Math.sin(a)*.32);topping.castShadow=false;
 }
 // Snack bag and visible puffed-corn/chips spilling onto the tray.
 const snackX=m.x+.52,snackZ=m.z+3.65;
 const bag=cube(.62,.91,.29,mat(i%2?'#dba5ef':'#ffce7b'),snackX,.69,snackZ);bag.rotation.z=.13;bag.castShadow=false;
 const bagStripe=cube(.65,.14,.31,mat('#fff2dd'),snackX,.83,snackZ);bagStripe.rotation.z=.13;bagStripe.castShadow=false;
 for(let k=0;k<7;k++){
  const a=k*2.4+i*.3;
  const crumb=sphere(.085+(k%3)*.022,mat('#f2db88'),snackX+Math.cos(a)*(.52+.10*(k%2)),.3,snackZ+Math.sin(a)*.36);crumb.castShadow=false;
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
const boardObject=new CSS3DObject(boardElement);boardObject.position.set(-24,4.6,13.5);boardObject.rotation.y=.25;boardObject.scale.set(.017,.017,.017);scene.add(boardObject);
cube(8,.5,.8,wood,-24,.4,13.45);for(let x of [-27.4,-20.6])cube(.22,6,.22,metal,x,3,13.5);
// trees, lanterns, food stalls
for(let x of [-34,34])for(let z of [-9,9,23]){cylinder(.45,.65,5,wood,x,2.5,z);sphere(2.7,mat('#477f63'),x,6,z);sphere(1.7,mat('#5a9a70'),x+1.7,5.7,z-1)}
for(let x of [-27,27]){cube(5,2.8,3,mat('#bc7097'),x,1.6,15);cube(5.8,.35,4.1,mat('#f4c783'),x,3.2,15);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4,1.1),label(x<0?'SNACKS':'MERCH',70,'#fbe9dc','#9e446f'));banner.position.set(x,2.2,16.56);scene.add(banner)}

for(let x of [-44,44]){cube(5.5,2.9,3.4,mat('#6b8ac7'),x,1.65,22);cube(6.4,.35,4.5,mat('#f4c783'),x,3.28,22);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4.5,1.1),label(x<0?'FOOD':'REST',68,'#fef7e6','#4c6588'));banner.position.set(x,2.2,23.86);scene.add(banner)}
for(let x=-42;x<=42;x+=14){const poleL=cylinder(.09,.09,5.6,metal,x,4.7,7);const poleR=cylinder(.09,.09,5.6,metal,x+7,4.7,7);for(let i=0;i<7;i++){const bulb=sphere(.14,new THREE.MeshStandardMaterial({color:['#ffdb8a','#fca5b5','#a8ecff','#c7f591'][i%4],emissive:['#ffdb8a','#fca5b5','#a8ecff','#c7f591'][i%4],emissiveIntensity:1.0,roughness:.3}),x+i*1.16,5.45,7+Math.sin(i/6*Math.PI)*.35);bulb.castShadow=false}}
const pier=cube(7.2,.14,20,mat('#8b6b53'),40,.18,77,false);pier.receiveShadow=true;for(let dz=69;dz<=85;dz+=4){for(let dx of [37.2,42.8])cube(.24,1.7,.24,wood,dx,.72,dz)}

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
 foamStrips.forEach((foam,i)=>{foam.position.z=56.2+i*1.45+Math.sin(sec*1.25+i*.8)*.28;foam.material.opacity=.16+Math.sin(sec*1.8+i)*.08+(active?.06:0)});
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
  day:{bg:'#86c8ff',fog:'#86c8ff',sky:'#8ecfff',hemiSky:'#e4f6ff',ground:'#58745c',hemi:2.45,grass:'#4a7b60',sand:'#e0c896',wet:'#d5b57c',ocean:'#4098d0',sunColor:'#fff0c0',sunLight:'#fff4cd',sun:2.95,moon:0.15,badge:'☀️ &nbsp; 낮 공연 <span>✦</span>',glow:'#f6d0a8',stage:.42},
  sunset:{bg:'#f39b7e',fog:'#f0a184',sky:'#ffad93',hemiSky:'#ffd8c6',ground:'#6a5755',hemi:1.95,grass:'#56715c',sand:'#ebc28d',wet:'#d3a46d',ocean:'#4c87c2',sunColor:'#ff9855',sunLight:'#ffcb95',sun:2.45,moon:0.25,badge:'🌇 &nbsp; 석양 공연 <span>✦</span>',glow:'#ff8b66',stage:.85},
  night:{bg:'#091326',fog:'#091326',sky:'#0f1b39',hemiSky:'#45608f',ground:'#243330',hemi:1.15,grass:'#2d5244',sand:'#a98d67',wet:'#907558',ocean:'#1f4e86',sunColor:'#ffcf88',sunLight:'#b5c8ff',sun:0.0,moon:1.75,badge:'🌙 &nbsp; 달빛 공연 <span>✦</span>',glow:'#6d84a8',stage:1.12},
  dawn:{bg:'#efab8d',fog:'#efab8d',sky:'#ffb79e',hemiSky:'#ffd9cb',ground:'#655a58',hemi:1.75,grass:'#4d6858',sand:'#e6c08f',wet:'#cda06e',ocean:'#4a82be',sunColor:'#ff9b68',sunLight:'#ffd0a1',sun:1.65,moon:0.55,badge:'🌄 &nbsp; 새벽 석양 <span>✦</span>',glow:'#ff9d76',stage:.72}
 };
 const p=themes[phase];
 skyPeriod=phase;clouds.visible=phase==='day'||phase==='sunset'||phase==='dawn';stars.visible=phase==='night';
 cloudMaterial.opacity=phase==='day'?.88:.48;
 scene.background.set(p.bg);scene.fog.color.set(p.fog);skyDome.material.color.set(p.sky);horizonGlow.material.color.set(p.glow);
 hemi.color.set(p.hemiSky);hemi.groundColor.set(p.ground);hemi.intensity=p.hemi;
 grass.color.set(p.grass);sandMat.color.set(p.sand);wetSandMat.color.set(p.wet);oceanMat.color.set(p.ocean);oceanMat.emissive.set(p.ocean);oceanMat.emissive.multiplyScalar(phase==='night'?0.18:.05);
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


// Rounded chibi avatar: larger soft head, painted-on face, short unified hairstyle,
// surface-colored clothing, and inexpensive shoulder/elbow/hip/knee rig.
function makeAvatar(p){
 const root=new THREE.Group();scene.add(root);
 const parts={}, female=p.gender==='female';
 const skinMat=mat('#f3d6c2',.96),hair=mat(female?'#685046':'#4b3932',.97);
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
 // Smooth hair cap with a few surface-shaped bangs (not a hat).
 child(neck,new THREE.SphereGeometry(.833,24,18,0,Math.PI*2,0,Math.PI*.46),hair,[0,.16,-.01],[1,1.0,1]);
 for(const x of [-.39,-.12,.16,.39]){
   const bang=child(neck,new THREE.SphereGeometry(.20,12,9),hair,[x,.615,.33],[1,.40,.70]);
 }
 if(female){
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
function toWorld(p){return {x:(p.x-600)*.058,z:(p.y-500)*.058+8}}
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
 a.root.position.x+=(wp.x-a.root.position.x)*.28;
 a.root.position.z+=(wp.z-a.root.position.z)*.28;
 const act=q.action||'idle',basePose=q.pose||((act==='sit'||act==='lie')?act:'stand'),sec=t*.001,pose={};
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
    set('leftShoulder',-.9+Math.sin(sec*10)*.95,0,-.42);set('rightShoulder',-.9-Math.sin(sec*10)*.95,0,.42);
    set('leftElbow',-.65);set('rightElbow',-.65);set('upper',-.20,Math.sin(sec*9)*.13);height=Math.abs(Math.sin(sec*11))*.13;
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
  // Windmill: upper-back/shoulder rolling with V-shaped legs circling in the air.
  // Root is tilted to horizontal, torso spins via yaw; articulated legs extend apart.
  lean=-Math.PI/2; height=-.10+Math.sin(sec*10)*.08;
  set('upper',Math.sin(sec*10)*.18,sec*7.4,0);
  set('leftHip',-1.0+.20*Math.sin(sec*7.4),.13*Math.cos(sec*7.4),-.82);set('rightHip',-1.0-.20*Math.sin(sec*7.4),-.13*Math.cos(sec*7.4),.82);
  set('leftKnee',-.12);set('rightKnee',-.12);
  set('leftShoulder',-.64,0,-.3);set('rightShoulder',-.64,0,.3);
 }
 if(act==='skanking'){
  const beat=sec*8.6,foot=Math.sin(beat),other=Math.sin(beat+Math.PI);
  height=Math.abs(foot)*.11;set('upper',-.18,0,Math.sin(beat*.5)*.14);
  set('leftHip',Math.max(0,foot)*.86);set('rightHip',Math.max(0,other)*.86);
  set('leftKnee',.22+.5*Math.max(0,foot));set('rightKnee',.22+.5*Math.max(0,other));
  set('leftShoulder',-.55-Math.max(0,other)*.50,0,-.24);set('rightShoulder',-.55-Math.max(0,foot)*.50,0,.24);
  set('leftElbow',-.68);set('rightElbow',-.68);
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
  if(ikMode==='clap'&&['leftShoulder','leftElbow','rightShoulder','rightElbow'].includes(k))continue;
  if((ikMode==='drink'||ikMode==='wave'||ikMode==='snack')&&['rightShoulder','rightElbow'].includes(k))continue;
  const target=pose[k],o=P[k];
  o.rotation.x+=(target[0]-o.rotation.x)*alpha;
  o.rotation.y+=(target[1]-o.rotation.y)*alpha;
  o.rotation.z+=(target[2]-o.rotation.z)*alpha;
 }
 if(ikMode==='clap'){
  placeHandIK(P,'left',leftHandTarget,.58);
  placeHandIK(P,'right',rightHandTarget,.58);
 }else if(ikMode==='drink')placeHandIK(P,'right',rightHandTarget,.58);
 else if(ikMode==='wave')placeHandIK(P,'right',rightHandTarget,.64);
 else if(ikMode==='snack')placeHandIK(P,'right',rightHandTarget,.56);
 // Seat is higher than the grass; raise the seated avatar to the bench cushion.
 if(basePose==='sit'&&benchSeats.some(seat=>Math.hypot(q.x-seat.x,q.y-seat.y)<24))height+=.46;
 a.root.position.y+=(height-a.root.position.y)*.28;
 a.root.rotation.x+=(lean-a.root.rotation.x)*.22;
 // While breakdancing, rotate the whole prone body around its center, not just its chest.
 if(act==='windmill'){const roll=sec*7.4;a.root.rotation.z+=(((roll-a.root.rotation.z+Math.PI*3)%(Math.PI*2))-Math.PI)*.25}else a.root.rotation.z+=(0-a.root.rotation.z)*.24;
 P.snackCrumbs.forEach((crumb,i)=>{
  if(act!=='snack'){crumb.visible=false;return}
  const phase=(sec*3.8+i*.19)%1,ring=.08+phase*.47,theta=i*2.39996;
  crumb.visible=true;
  crumb.position.set(Math.cos(theta)*ring,-.15-Math.pow(phase,1.6)*.48,.77+Math.sin(theta)*ring*.65);
  crumb.rotation.set(sec*5+i,sec*7+i,phase*8);
  crumb.scale.setScalar(Math.max(.12,1-phase)*(.75+i%3*.15));
 });
 P.rockBubble.visible=act==='peace'||act==='slam-retreat'||act==='slam-celebrate';P.bottle.visible=act==='drink';
 if(P.rockBubble.visible)P.rockBubble.position.y=4.34+Math.sin(sec*7)*.075;
 if(basePose!=='lie'&&act!=='lie'){
  const yaw=Number(q.facing)||0;
  const delta=((yaw-a.root.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;
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
 const bounds=renderer.domElement.getBoundingClientRect();pointer.set(((e.clientX-bounds.left)/bounds.width)*2-1,-((e.clientY-bounds.top)/bounds.height)*2+1);
 groundRay.setFromCamera(pointer,camera);if(!groundRay.ray.intersectPlane(groundPlane,hit))return;
 const x=Math.max(20,Math.min(1380,hit.x/.058+600)),y=Math.max(220,Math.min(1100,(hit.z-8)/.058+500));
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
function tick(t){
 const frameDelta=Math.min(50,Math.max(0,t-(tick.lastFrame??t)));tick.lastFrame=t;
 if(state.me){
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
     dx=tx/n;dy=ty/n;
     // Balanced slam approach: ~5 units/frame at 60 fps, between v11 (8) and v12 (~1.1).
     // Normalize by frame time across refresh rates; retreat remains deliberately slow.
     speed=m.phase==='charge'?Math.min(6.5,frameDelta*0.30):Math.min(1.1,Math.max(.1,frameDelta*0.024));
     state.action=m.phase==='charge'?'slam-charge':'slam-retreat';
     state.me.action=state.action;
    }
   }
  }
  if(!dx&&!dy&&rockMotion){
   const m=rockMotion,elapsed=Math.max(0,slamNow()-m.startAt);
   if(!m.phase&&elapsed>=m.duration)beginRockCelebration(m);
   if(m.phase==='scatter'){
    const target=m.scatterTarget;
    const tx=target.x-state.me.x,ty=target.y-state.me.y;
    const distance=Math.hypot(tx,ty);
    if(distance<=3.5||t-m.phaseStarted>11000){
     m.phase='celebrate';
     state.action='slam-celebrate';state.me.action='slam-celebrate';
     state.actionUntil=Infinity;sendMove();
    }else{
     // Jumping retreat at a gentle, frame-rate-independent pace.
     const step=Math.min(distance,Math.max(.15,frameDelta*.075));
     state.me.x=Math.max(20,Math.min(1380,state.me.x+tx/distance*step));
     state.me.y=Math.max(220,Math.min(1100,state.me.y+ty/distance*step));
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
    state.me.x=Math.max(20,Math.min(1380,p.x));
    state.me.y=Math.max(220,Math.min(1100,p.y));
    state.me.facing=Math.atan2(p.dx,p.dy);
    state.me.action=m.kind==='mosh'?'mosh-charge':m.kind==='circle'?'circle-run':'train-run';state.action=state.me.action;
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
  if(state.moving && (state.action==='buriburi'||state.action==='groove'||state.action==='windmill'||state.action==='skanking'||state.action==='cheer') && !slamMotion && !rockMotion){
   state.action='idle';state.me.action='walk';state.actionUntil=0;updateActionButtons();
  }
  if(state.moving){
   const n=Math.hypot(dx,dy);
   if(!slamMotion)speed=state.action==='run'?5:3.2;
   state.me.x=Math.max(20,Math.min(1380,state.me.x+dx/n*speed));
   state.me.y=Math.max(220,Math.min(1100,state.me.y+dy/n*speed));
   state.me.facing=Math.atan2(dx,dy);
   if(state.pose!=='stand'){state.pose='stand';state.me.pose='stand';updateActionButtons()}
   if(['sit','lie'].includes(state.action)){state.action='idle';state.me.action='idle'}
   if(!slamMotion&&!rockMotion&&(state.action==='idle'||state.action==='walk'))state.me.action='walk';
  }else if(!slamMotion&&!rockMotion&&state.me.action==='walk')state.me.action='idle';
  if(!slamMotion&&!rockMotion&&t>state.actionUntil&&state.action!=='idle'&&state.action!=='run'){
   state.action='idle';state.me.action=state.moving?'walk':'idle';
   updateActionButtons();
  }
  if(t-state.lastSent>150){state.lastSent=t;sendMove()}
 }

 for(let [id,p] of state.players){if(!avatars.has(id)){let a=makeAvatar(p),pos=toWorld(p);a.root.position.set(pos.x,0,pos.z);avatars.set(id,a)}animateAvatar(avatars.get(id),p,t)}
 for(let [id,a] of avatars)if(!state.players.has(id)){scene.remove(a.root);a.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material?.map)o.material.map.dispose();if(o.material)o.material.dispose()});avatars.delete(id)}
 if(moveMarker.visible){moveMarker.material.opacity=Math.min(.75,Math.max(0,(moveMarkerUntil-t)/1050)*.75);if(t>moveMarkerUntil)moveMarker.visible=false}
 updateEnvironment();animateSky(t);updateOcean(t);updateSlamDust(t);updateBubbles(t);animateShow(t);updateHourlyFireworks(t);followLocalAvatar();controls.update();keepCameraInFrontOfStage();updateSlamVisual(t);updateRockPlayVisual(t);renderer.render(scene,camera);cssRenderer.render(scene,camera);renderStageForeground();requestAnimationFrame(tick)
}
function resize(){let w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);cssRenderer.setSize(w,h);if(stageForeground)stageForeground.setSize(w,h,false)}new ResizeObserver(resize).observe(host);resize();requestAnimationFrame(tick);
setInterval(()=>{syncVideo();reportDuration();let m=state.music;if(!m.id)return;let sec=m.paused?m.position:(Date.now()+state.serverDelta-m.startedAt)/1000;let dur=state.ytReady?state.yt.getDuration():0;$('progressFill').style.width=dur?Math.min(100,sec/dur*100)+'%':'0%'},5000);
window.addEventListener('pagehide',()=>{if(state.id)navigator.sendBeacon('/api/leave',new Blob([JSON.stringify({id:state.id})],{type:'application/json'}))});

const ytScript=document.createElement('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.appendChild(ytScript);

$('musicToggle').onclick=()=>document.body.classList.toggle('music-open');$('musicClose').onclick=()=>document.body.classList.remove('music-open');

function showMusicControlNotice(name,command){const messages={pause:'일시정지했습니다',resume:'다시 재생했습니다',skip:'다음 곡으로 넘겼습니다'};if(messages[command])notice((name||'참가자')+'님이 음악을 '+messages[command])}
function notice(message){const host=$('joinNotices');const el=document.createElement('div');el.textContent=message;host.append(el);setTimeout(()=>el.remove(),4400)}
function appendChat(entry){const el=document.createElement('div');el.className='chat-line';const who=document.createElement('b');who.textContent=entry.name+' : ';const value=document.createElement('span');value.textContent=entry.message;el.append(who,value);$('chatMessages').append(el);while($('chatMessages').children.length>35)$('chatMessages').firstChild.remove();$('chatMessages').scrollTop=$('chatMessages').scrollHeight}
$('chatToggle').onclick=()=>$('chatPanel').classList.toggle('hidden');
$('chatClose').onclick=()=>$('chatPanel').classList.add('hidden');
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

// Keep the in-game HUD inside the actual visible iOS/Android viewport.
function updateVisibleViewport(){
 const viewport=window.visualViewport;
 const height=viewport ? viewport.height : window.innerHeight;
 document.documentElement.style.setProperty('--app-height',Math.round(height)+'px');
}
updateVisibleViewport();
window.addEventListener('resize',updateVisibleViewport,{passive:true});
window.addEventListener('orientationchange',updateVisibleViewport,{passive:true});
if(window.visualViewport){window.visualViewport.addEventListener('resize',updateVisibleViewport,{passive:true});}

// Teach touch-to-move without covering the map permanently.
function showMovementGuide(){
 const guide=document.getElementById('movementGuide');if(!guide)return;
 guide.classList.add('visible');clearTimeout(showMovementGuide.timer);
 showMovementGuide.timer=setTimeout(()=>guide.classList.remove('visible'),9000);
}
document.getElementById('movementGuideDismiss')?.addEventListener('click',()=>document.getElementById('movementGuide').classList.remove('visible'));
