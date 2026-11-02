(()=>{'use strict';
const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d');
const palette=['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee'];
const mats=[{x:125,y:672,c:'#f5a5a3'},{x:355,y:690,c:'#a7def4'},{x:600,y:684,c:'#f5ce80'},{x:855,y:688,c:'#b3d9a0'},{x:1057,y:669,c:'#ceb8f1'}];
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0},serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:false,needsAudio:false};
let chosenColor=palette[0],toastTimer;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2900)}
function colorPicker(){const root=$('colorPicker');root.innerHTML='';palette.forEach(color=>{const b=document.createElement('button');b.style.background=color;b.className=color===chosenColor?'selected':'';b.setAttribute('aria-label','티셔츠 색상 '+color);b.onclick=()=>{chosenColor=color;colorPicker()};root.append(b)})}
colorPicker();
async function post(endpoint,data){const res=await fetch('/api/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const j=await res.json();if(!res.ok)throw Error(j.error||'서버 오류');return j}
function applyMusic(m,serverNow){state.music=m;if(serverNow)state.serverDelta=serverNow-Date.now();$('songTitle').textContent=m.id?(m.title||'YOUTUBE LIVE TRACK'):'NO TRACK SELECTED';$('songCredit').textContent=m.id?`DJ ${m.changedBy||'UNKNOWN'} · ${m.paused?'일시정지':'재생 중'}`:'첫 번째 DJ가 되어보세요';$('screenPlaceholder').style.display=m.id?'none':'flex';syncVideo(true)}
function syncVideo(force=false){const m=state.music;if(!m.id||!state.ytReady)return;const desired=m.paused?m.position:Math.max(0,(Date.now()+state.serverDelta-m.startedAt)/1000);
 try{if(state.lastTrack!==m.id){state.lastTrack=m.id;state.yt.cueVideoById({videoId:m.id,startSeconds:desired});if(state.audioEnabled&&!m.paused)state.yt.playVideo();return}
 const actual=state.yt.getCurrentTime();if(force||Math.abs(actual-desired)>2.8)state.yt.seekTo(desired,true);
 if(state.audioEnabled){if(m.paused)state.yt.pauseVideo();else if(state.yt.getPlayerState()!==1)state.yt.playVideo()}else state.yt.pauseVideo();
 }catch(e){console.warn('YouTube sync:',e)}}
window.onYouTubeIframeAPIReady=()=>{state.yt=new YT.Player('youtubePlayer',{height:'100%',width:'100%',videoId:'',playerVars:{playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{state.ytReady=true;syncVideo(true)},onError:e=>toast('유튜브 영상을 재생할 수 없습니다. 공개된 영상인지 확인하세요.')}})};
async function musicCommand(command,extra={}){if(!state.id)return toast('페스티벌에 먼저 입장해주세요');try{const r=await post('music',{id:state.id,command,...extra});applyMusic(r.music,r.serverNow);if(command==='play'||command==='resume'){state.audioEnabled=true;syncVideo(true);toast('모든 방문자의 무대 음악이 업데이트되었습니다')} }catch(e){toast(e.message)}}
$('playLink').onclick=()=>musicCommand('play',{url:$('videoUrl').value});$('pauseMusic').onclick=()=>musicCommand('pause');$('resumeMusic').onclick=()=>musicCommand('resume');
$('enableAudio').onclick=()=>{state.audioEnabled=true;if(!state.music.id)return toast('먼저 유튜브 노래를 선택해주세요');syncVideo(true);toast('이 기기에서 무대 음악을 재생합니다')};
$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('playLink').click()});
function joinEvents(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));state.me=state.players.get(state.id)||state.me;$('online').textContent=d.count;applyMusic(d.music,d.serverNow)}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count}else if(d.type==='move'){const p=state.players.get(d.player.id);state.players.set(d.player.id,{...p,...d.player});if(d.player.id===state.id&&state.me){/* local prediction stays smooth */}}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count}else if(d.type==='music')applyMusic(d.music,d.serverNow)};state.es.onerror=()=>{};}
async function join(){try{const nick=$('nick').value.trim()||'ROCKER';const d=await post('join',{name:nick,color:chosenColor});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;$('joinModal').classList.add('hidden');$('profileName').textContent=state.me.name;$('profileStatus').textContent='IN THE FESTIVAL ✦';$('avatarPreview').querySelector('b').style.background=chosenColor;applyMusic(d.music,d.serverNow);joinEvents();toast('WELCOME TO LOUD LAND! 🤘')}catch(e){$('joinError').textContent=e.message}}
$('joinBtn').onclick=join;$('nick').addEventListener('keydown',e=>{if(e.key==='Enter')join()});$('editAvatar').onclick=()=>{if(state.id){post('leave',{id:state.id}).catch(()=>{});state.es?.close();state.id=null;state.players.clear()}$('joinModal').classList.remove('hidden')};$('helpBtn').onclick=()=>toast('WASD·방향키 이동 / 1~7 리액션 / 돗자리 가까이에서 앉기·눕기');
function react(action){if(!state.me)return;const near=mats.some(m=>Math.hypot(state.me.x-m.x,state.me.y-m.y)<100);if(['sit','lie'].includes(action)&&!near)return toast('뒤쪽 돗자리 가까이 이동해야 쉴 수 있습니다');if(['sit','lie'].includes(action)){const m=mats.reduce((a,b)=>Math.hypot(state.me.x-a.x,state.me.y-a.y)<Math.hypot(state.me.x-b.x,state.me.y-b.y)?a:b);state.me.x=m.x;state.me.y=m.y-4}
state.action=action;state.actionUntil=['sit','lie'].includes(action)?Infinity:performance.now()+1300;state.me.action=action;$documentActive(action);sendMove();}
function $documentActive(action){document.querySelectorAll('[data-action]').forEach(b=>b.classList.toggle('active',b.dataset.action===action))}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();state.keys.add(k);const acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'bow','6':'sit','7':'lie'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
document.querySelectorAll('[data-dir]').forEach(b=>{const k={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright'}[b.dataset.dir];const down=e=>{e.preventDefault();state.keys.add(k);b.setPointerCapture?.(e.pointerId)},up=e=>{e.preventDefault();state.keys.delete(k)};b.addEventListener('pointerdown',down);for(const evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,up)});
function sendMove(){if(!state.id||!state.me)return;const p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action}).catch(()=>{})}
const rand=n=>{let v=Math.sin(n*127.1+42)*43758.5453;return v-Math.floor(v)};
function roundRect(x,y,w,h,r,fill,stroke=null){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}}
function line(x1,y1,x2,y2,color,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
function txt(s,x,y,font,color,align='center'){ctx.fillStyle=color;ctx.font=font;ctx.textAlign=align;ctx.fillText(s,x,y)}
function drawWorld(t){const w=1200,h=800;const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#263050');g.addColorStop(.48,'#314a58');g.addColorStop(1,'#3b615b');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
 // Ambient confetti dots and grass
 for(let i=0;i<150;i++){const x=rand(i+3)*w,y=315+rand(i+900)*480;ctx.fillStyle=i%4===0?'#6b9970':'#54766a';ctx.fillRect(x,y,3,2)}
 // Overhead lights / atmospheric spotlight cones
 for(let i=0;i<5;i++){const sx=230+i*185,angle=Math.sin(t*.0006+i)*38;ctx.beginPath();ctx.moveTo(sx,210);ctx.lineTo(sx-105+angle,500);ctx.lineTo(sx+105+angle,500);ctx.closePath();ctx.fillStyle=['#a18bfe10','#fa83bd0e','#a2fbfd11','#f0f9900d','#b29afa12'][i];ctx.fill()}
 // STAGE outline
 roundRect(125,20,950,269,15,'#11172a','#647185');roundRect(147,37,906,238,7,'#22253d');roundRect(199,68,802,187,8,'#101329');
 for(let i=0;i<16;i++){const x=194+i*55;line(x,45,x+15,66,'#46566d',3)}
 for(let i=0;i<19;i++){const x=174+i*46;ctx.fillStyle=i%3===0?'#d8ff76':'#e76bb5';ctx.globalAlpha=.6+.4*Math.sin(t*.004+i);ctx.fillRect(x,49,13,6)}ctx.globalAlpha=1;
 // Amplifiers
 for(const x of [164,947]){roundRect(x,102,84,133,6,'#282d40','#788193');for(let j=0;j<2;j++){ctx.fillStyle='#121624';ctx.beginPath();ctx.arc(x+42,138+j*48,25,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#515b70';ctx.lineWidth=3;ctx.stroke()}}
 // Stage drums
 ctx.fillStyle='#a65797';ctx.beginPath();ctx.arc(600,186,44,0,7);ctx.fill();ctx.strokeStyle='#d6d5ec';ctx.lineWidth=5;ctx.stroke();txt('✳',600,200,'41px sans-serif','#f4dca4');for(let x of [546,653]){roundRect(x-20,140,41,37,6,'#b46da5','#e6d0d9')}
 line(600,113,600,141,'#d0d2dd',4);ctx.fillStyle='#efe2b4';ctx.fillRect(530,126,27,4);ctx.fillRect(658,126,31,4);
 // Central stage lettering
 txt('LOUD',602,106,'bold 46px Archivo Black, sans-serif','#e8fdb5');txt('LAND',602,138,'bold 29px Archivo Black, sans-serif','#f7aed0');
 // Front stage
 roundRect(95,261,1010,52,5,'#202536','#6e738c');for(let x=107;x<1095;x+=22){ctx.fillStyle=x%3?'#2e3850':'#454c67';ctx.fillRect(x,277,12,18)}
 // Barrier
 line(30,332,1170,332,'#b6ab8c',6);for(let i=0;i<24;i++){const x=36+i*49;line(x,329,x,348,'#aaa3a2',4)}
 // Festival dance field
 roundRect(38,365,1124,228,24,'#39595a60');
 for(let i=0;i<45;i++){const x=65+rand(i+400)*1080,y=385+rand(i+600)*160;ctx.fillStyle=['#ddf49a','#a3d7df','#fa9fa8'][i%3];ctx.globalAlpha=.32;ctx.beginPath();ctx.arc(x,y,rand(i+12)*3+1,0,7);ctx.fill()}ctx.globalAlpha=1;
 // Rest area
 roundRect(22,603,1156,184,22,'#446a59','#628473');txt('CHILL OUT • PICNIC GARDEN',600,627,'bold 13px DM Sans, sans-serif','#ccebc2');
 mats.forEach((m,i)=>{ctx.save();ctx.translate(m.x,m.y);ctx.rotate([-.08,.08,.02,-.04,.09][i]);roundRect(-89,-42,178,91,8,m.c,'#e9e3d1');for(let q=-60;q<90;q+=32){ctx.fillStyle='#ffffff52';ctx.fillRect(q,-38,9,80)}ctx.strokeStyle='#ffffff80';ctx.strokeRect(-77,-32,154,64);ctx.restore()});
 // decorations string lights
 for(let i=0;i<13;i++){const x=22+i*96,y=593+Math.sin(i*.6)*8;line(x,y,x+96,593+Math.sin((i+1)*.6)*8,'#657c62',2);ctx.fillStyle=['#ffb0bb','#dbf88e','#a4dcfa'][i%3];ctx.beginPath();ctx.arc(x,y,5,0,7);ctx.fill()}
 // Firefly particles
 for(let i=0;i<25;i++){const x=rand(i+82)*1200,y=356+rand(i+120)*400;ctx.fillStyle='#efffb8';ctx.globalAlpha=.15+.25*(1+Math.sin(t*.003+i))/2;ctx.fillRect(x+Math.sin(t*.001+i)*7,y,3,3)}ctx.globalAlpha=1;
 // decorative crowd at front
 for(let i=0;i<26;i++){const x=45+i*44,y=353+rand(i+33)*34;ctx.fillStyle='#172a38';ctx.beginPath();ctx.arc(x,y,8,0,7);ctx.fill();roundRect(x-9,y+7,18,16,3,['#7e678a','#4b7a83','#9d786f'][i%3])}
 // users, bottom sorted
 [...state.players.values()].sort((a,b)=>a.y-b.y).forEach(p=>drawPerson(p,t));
 // visible entry points
 for(let i=0;i<2;i++){const x=i?1145:55;roundRect(x-37,491,74,40,6,'#1f343a','#9bb69c');txt(i?'EXIT':'ENTRY',x,516,'bold 12px DM Sans','#d8ffab')}
}
function drawPerson(p,t){const x=p.id===state.id?state.me.x:p.x,y=p.id===state.id?state.me.y:p.y;const action=p.id===state.id?state.me.action:p.action;let jump=action==='jump'?Math.abs(Math.sin(t*.013))*34:0;let bob=action==='run'?Math.sin(t*.032)*5:Math.sin(t*.004+(x%10))*.8;const lie=action==='lie',sit=action==='sit',bow=action==='bow';ctx.save();ctx.translate(x,y-jump+bob);
ctx.fillStyle='#15242a55';ctx.beginPath();ctx.ellipse(0,4,18,6,0,0,7);ctx.fill();if(lie){ctx.rotate(-Math.PI/2);ctx.translate(0,-12)}
if(!lie){line(-7,-20,-9+(action==='run'?-6*Math.sin(t*.03):0),-2,'#202333',6);line(7,-20,9+(action==='run'?6*Math.sin(t*.03):0),-2,'#202333',6)}
ctx.fillStyle=p.color;roundRect(-14,-46,28,sit?20:30,7,p.color,'#34404c');
const wave=action==='wave'||action==='peace',spread=wave?14:0;line(-13,-38,-22,-23,'#f0bf9e',6);line(13,-38,23+spread,-(wave?61:23),'#f0bf9e',6);
if(wave){txt(action==='peace'?'✌':'✋',28+spread,-58,'19px sans-serif','#fff')}
ctx.fillStyle='#f2c39e';ctx.beginPath();ctx.ellipse(0,bow?-56:-56,12,13,bow?.65:0,0,7);ctx.fill();ctx.fillStyle='#332839';ctx.beginPath();ctx.ellipse(0,-62,12,8,0,Math.PI,Math.PI*2);ctx.fill();ctx.fillStyle='#23222a';ctx.fillRect(-5,-57,2,2);ctx.fillRect(5,-57,2,2);
if(sit){line(-9,-23,-19,-11,'#202333',5);line(9,-23,19,-11,'#202333',5)}
ctx.restore();roundRect(x-44,y-jump-(lie?75:91),88,19,5,p.id===state.id?'#d8fc79':'#151c31cc');txt(p.name||'ROCKER',x,y-jump-(lie?62:78),'bold 11px DM Sans, sans-serif',p.id===state.id?'#1d2730':'#f6f7fb');if(p.id===state.id){ctx.strokeStyle='#d8ff77';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y+3,23,0,Math.PI*2);ctx.stroke()}}
function tick(t){if(state.me){let dx=0,dy=0;const k=state.keys;dx+=(k.has('d')||k.has('arrowright'))?1:0;dx-=(k.has('a')||k.has('arrowleft'))?1:0;dy+=(k.has('s')||k.has('arrowdown'))?1:0;dy-=(k.has('w')||k.has('arrowup'))?1:0;if(dx||dy){const n=Math.hypot(dx,dy),speed=state.action==='run'?5.1:3.1;state.me.x=Math.max(30,Math.min(1170,state.me.x+dx/n*speed));state.me.y=Math.max(345,Math.min(745,state.me.y+dy/n*speed));if(dx)state.me.facing=dx>0?1:-1;if(['sit','lie'].includes(state.action)){state.action='idle';state.me.action='idle';$documentActive('')}}if(t>state.actionUntil&&state.action!=='idle'){state.action='idle';state.me.action='idle';$documentActive('')}if(t-state.lastSent>100){state.lastSent=t;sendMove()}}
 drawWorld(t);requestAnimationFrame(tick)}requestAnimationFrame(tick);
setInterval(()=>{syncVideo();const m=state.music;if(!m.id)return;const seconds=m.paused?m.position:(Date.now()+state.serverDelta-m.startedAt)/1000;const length=state.ytReady?state.yt.getDuration():0;$('progressFill').style.width=length?Math.min(100,seconds/length*100)+'%':'0%'},5000);
window.addEventListener('pagehide',()=>{if(state.id&&navigator.sendBeacon){navigator.sendBeacon('/api/leave',new Blob([JSON.stringify({id:state.id})],{type:'application/json'}))}});
})();
