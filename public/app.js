import * as THREE from 'https://esm.sh/three@0.160.1';
import { OrbitControls } from 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'https://esm.sh/three@0.160.1/examples/jsm/renderers/CSS3DRenderer.js';
const $=id=>document.getElementById(id), palette=['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee'];
const mats=[{x:118,y:682,c:'#f5a5a3'},{x:290,y:706,c:'#a7def4'},{x:470,y:690,c:'#f5ce80'},{x:650,y:708,c:'#b3d9a0'},{x:835,y:694,c:'#ceb8f1'},{x:1015,y:710,c:'#ffd2a5'},{x:1185,y:688,c:'#b2d8ff'}];
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0,token:0},queue:[],serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:false,walkTarget:null,moving:false};
let chosenColor=palette[0],chosenGender='male',toastTimer;const avatars=new Map();const activeBubbles=new Map();
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000)}
document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>{chosenGender=b.dataset.gender;document.querySelectorAll('[data-gender]').forEach(x=>x.classList.toggle('selected',x===b))});
function colorPicker(){let r=$('colorPicker');r.innerHTML='';palette.forEach(c=>{let b=document.createElement('button');b.style.background=c;b.className=c===chosenColor?'selected':'';b.setAttribute('aria-label','티셔츠 '+c);b.onclick=()=>{chosenColor=c;colorPicker()};r.append(b)})}colorPicker();
async function post(ep,data){let r=await fetch('/api/'+ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});let d=await r.json();if(!r.ok)throw Error(d.error||'서버 오류');return d}
function applyMusic(m,serverNow,queue){state.music=m;updateFestivalBoard();if(Array.isArray(queue))state.queue=queue;renderQueue();if(serverNow)state.serverDelta=serverNow-Date.now();$('songTitle').textContent=m.id?m.title||'유튜브 영상':'등록된 음악 없음';$('songCredit').textContent=m.id?`DJ ${m.changedBy||'알 수 없음'} · ${m.paused?'일시정지':'재생 중'}`:'첫 번째 DJ가 되어보세요';$('screenPlaceholder').style.display=m.id?'none':'flex';syncVideo(true)}

function updateFestivalBoard(){let m=state.music||{};const title=document.getElementById('boardCurrent');const next=document.getElementById('boardNext');const status=document.getElementById('boardStatus');if(title)title.textContent=m.title||'현재 재생 중인 곡 없음';if(next)next.textContent=state.queue?.length?state.queue[0].title:'예약된 곡 없음';if(status)status.textContent=m.id?(m.paused?'일시정지':'공연 중'):'공연 대기 중';}
function renderQueue(){updateFestivalBoard();let el=$('queueList');if(!el)return;el.replaceChildren();if(!state.queue.length){let item=document.createElement('li');item.textContent='대기 중인 곡이 없습니다';el.append(item);return}state.queue.forEach((track,index)=>{let li=document.createElement('li');li.textContent=`${index+1}. ${track.title} · ${track.addedBy}`;el.append(li)})}
let reportedToken=0;
function reportDuration(){if(!state.id||!state.ytReady||!state.music.id)return;const duration=state.yt.getDuration();if(duration>1&&reportedToken!==state.music.token){reportedToken=state.music.token;post('music',{id:state.id,command:'duration',token:state.music.token,duration}).catch(()=>{})}}
function syncVideo(force=false){let m=state.music;if(!m.id||!state.ytReady)return;let sec=m.paused?m.position:Math.max(0,(Date.now()+state.serverDelta-m.startedAt)/1000);try{if(state.lastTrack!==String(m.token)+':'+m.id){state.lastTrack=String(m.token)+':'+m.id;reportedToken=0;if(state.audioEnabled&&!m.paused){state.yt.loadVideoById({videoId:m.id,startSeconds:sec});state.yt.unMute()}else state.yt.cueVideoById({videoId:m.id,startSeconds:sec});return}if(force||Math.abs(state.yt.getCurrentTime()-sec)>3)state.yt.seekTo(sec,true);if(state.audioEnabled){if(m.paused)state.yt.pauseVideo();else if(state.yt.getPlayerState()!==1)state.yt.playVideo()}else state.yt.pauseVideo()}catch(e){console.warn(e)}}
window.onYouTubeIframeAPIReady=()=>{state.yt=new YT.Player('youtubePlayer',{height:'100%',width:'100%',playerVars:{playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{state.ytReady=true;syncVideo(true)},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING||e.data===YT.PlayerState.CUED)reportDuration();if(e.data===YT.PlayerState.ENDED&&state.id&&state.music.id)post('music',{id:state.id,command:'ended',token:state.music.token}).catch(()=>{})},onError:()=>toast('영상이 임베드 재생을 허용하지 않습니다')}})};
async function musicCommand(command,extra={}){if(!state.id)return toast('먼저 입장해주세요');try{let d=await post('music',{id:state.id,command,...extra});applyMusic(d.music,d.serverNow,d.queue);toast('공유 음악이 업데이트되었습니다')}catch(e){toast(e.message)}}
$('playLink').onclick=()=>musicCommand('enqueue',{url:$('videoUrl').value});$('pauseMusic').onclick=()=>musicCommand('pause');$('resumeMusic').onclick=()=>musicCommand('resume');$('skipMusic').onclick=()=>musicCommand('skip');$('enableAudio').onclick=()=>{state.audioEnabled=true;try{state.yt?.unMute()}catch(e){}syncVideo(true);toast('이 기기의 소리를 켰어요')};$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('playLink').click()});
function updateCrowdCount(n){const el=document.getElementById('boardVisitors');if(el)el.textContent=String(n)}
function listen(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;updateCrowdCount(d.count);applyMusic(d.music,d.serverNow,d.queue);if(Array.isArray(d.chat)){$('chatMessages').replaceChildren();d.chat.forEach(appendChat)}}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count;updateCrowdCount(d.count);if(d.player.id!==state.id)notice(d.player.name+' 들어왔습니다')}else if(d.type==='chat'){appendChat(d.entry);showBubble(d.entry)}else if(d.type==='move'){state.players.set(d.player.id,d.player)}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count;updateCrowdCount(d.count)}else if(d.type==='music')applyMusic(d.music,d.serverNow,d.queue)}}
async function join(){try{let d=await post('join',{name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);cameraFollowInitialized=false;state.players=new Map(d.players.map(p=>[p.id,p]));$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;applyMusic(d.music,d.serverNow,d.queue);listen();$('audioModal').classList.remove('hidden');showMovementGuide();toast('ONEseason에 오신 것을 환영합니다!')}catch(e){$('joinError').textContent='입장 실패: '+(e?.message||'연결을 확인해주세요');console.error('ONEseason join error:',e)}}
$('audioYes').onclick=()=>{state.audioEnabled=true;$('audioModal').classList.add('hidden');if(state.ytReady){try{state.yt.unMute();state.yt.setVolume(75)}catch(e){}}syncVideo(true);toast(state.music.id?'음악 재생을 허용했어요':'음악이 등록되면 바로 재생돼요')};$('audioNo').onclick=()=>{state.audioEnabled=false;$('audioModal').classList.add('hidden');try{state.yt?.pauseVideo()}catch(e){}toast('음악을 끈 상태로 입장했어요')};$('joinBtn').onclick=join;$('nick').onkeydown=e=>{if(e.key==='Enter')join()};$('editAvatar').onclick=()=>{if(state.id){post('leave',{id:state.id}).catch(()=>{});state.es?.close();state.id=null;state.me=null;cameraFollowInitialized=false;state.players.clear()}$('joinModal').classList.remove('hidden')};$('helpBtn').onclick=()=>toast('WASD 이동 · 클릭/터치 이동 · 드래그 시점 회전 · 1~8 리액션');
function react(a){
 if(!state.me)return;
 if(state.action===a&&['jump','run'].includes(a)){
   state.action='idle';state.actionUntil=0;state.me.action=state.moving?'walk':'idle';
   document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));
   sendMove();return;
 }
 const near=mats.some(m=>Math.hypot(state.me.x-m.x,state.me.y-m.y)<105);
 if(['sit','lie'].includes(a)&&!near)return toast('돗자리 가까이에서 앉거나 누울 수 있어요');
 // Keep original position instead of teleporting to the mat center.
 state.action=a;
 state.actionUntil=['sit','lie','jump','run'].includes(a)?Infinity:performance.now()+1350;
 state.me.action=a;
 if(['sit','lie'].includes(a))state.walkTarget=null;
 document.querySelectorAll('[data-action]').forEach(b=>b.classList.toggle('active',b.dataset.action===a));
 sendMove();
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;let k=e.key.toLowerCase();if(k.startsWith('arrow')||k===' ')e.preventDefault();state.keys.add(k);let acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'clap','6':'sit','7':'lie','8':'drink'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
document.querySelectorAll('[data-dir]').forEach(b=>{let k={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright'}[b.dataset.dir];b.addEventListener('pointerdown',e=>{e.preventDefault();state.keys.add(k);b.setPointerCapture(e.pointerId)});for(let ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>state.keys.delete(k))});
function sendMove(){if(!state.id||!state.me)return;let p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action}).catch(()=>{})}
// ===== 3D SPACE =====
const host=$('world');const scene=new THREE.Scene();scene.background=new THREE.Color('#78bfff');scene.fog=new THREE.FogExp2('#78bfff',.0068);
const camera=new THREE.PerspectiveCamera(56,1,.1,350);camera.position.set(0,27,39);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width:700px)').matches?1.2:1.6));renderer.shadowMap.enabled=!matchMedia('(max-width:700px)').matches;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
const cssRenderer=new CSS3DRenderer();cssRenderer.domElement.className='css-world';host.appendChild(cssRenderer.domElement);
const stageVideo=document.querySelector('#youtubeScreen');stageVideo.classList.add('onstage');
const stageWebObject=new CSS3DObject(stageVideo);stageWebObject.position.set(0,6.3,-29.12);stageWebObject.scale.set(.015,.015,.015);scene.add(stageWebObject);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=11;controls.maxDistance=105;controls.maxPolarAngle=Math.PI/2.12;controls.target.set(0,1,4);controls.enablePan=false;
const STAGE_CAMERA_Z_LIMIT=-10.4;
function keepCameraInFrontOfStage(){if(camera.position.z<STAGE_CAMERA_Z_LIMIT){camera.position.z += (STAGE_CAMERA_Z_LIMIT-camera.position.z)*.28;controls.object.position.copy(camera.position);camera.lookAt(controls.target);}}
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
const hemi=new THREE.HemisphereLight('#d7efff','#557157',2.35);scene.add(hemi);
const sunLight=new THREE.DirectionalLight('#fff0c7',2.8);sunLight.position.set(24,38,92);sunLight.castShadow=!matchMedia('(max-width:700px)').matches;sunLight.shadow.mapSize.set(1024,1024);sunLight.shadow.camera.left=-62;sunLight.shadow.camera.right=62;sunLight.shadow.camera.top=62;sunLight.shadow.camera.bottom=-62;scene.add(sunLight);
const moonLight=new THREE.DirectionalLight('#d8e8ff',1.55);moonLight.position.set(-18,26,92);scene.add(moonLight);
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(175,28,20),new THREE.MeshBasicMaterial({color:'#82c4ff',side:THREE.BackSide,fog:false}));scene.add(skyDome);
const sunOrb=new THREE.Mesh(new THREE.SphereGeometry(4.5,24,18),new THREE.MeshBasicMaterial({color:'#ffd580'}));scene.add(sunOrb);
const moonOrb=new THREE.Mesh(new THREE.SphereGeometry(3.4,20,16),new THREE.MeshBasicMaterial({color:'#eff6ff'}));scene.add(moonOrb);
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
});
for(const x of [-30,-10,10,30]){cube(3.6,.24,1.4,mat('#c49b75'),x,.95,38);for(const dx of [-1,1])cube(.2,.9,.2,wood,x+dx,.48,38);}
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
   // Simple rounded bob, only two full locks and a short back layer.
   child(neck,new THREE.SphereGeometry(.74,20,14),hair,[0,.005,-.22],[.97,.91,.72]);
   for(const side of [-1,1])child(neck,new THREE.CapsuleGeometry(.18,.40,5,11),hair,[side*.645,-.27,-.04],[1.02,1.03,.82]);
 }else{
   // Close-fitting side hair visible near ears.
   for(const side of [-1,1])child(neck,new THREE.SphereGeometry(.22,12,10),hair,[side*.66,.22,-.10],[.72,1.03,.78]);
 }
 // Minimal articulated limbs: smooth joints tucked inside sleeve/leg, not exposed balls.
 function arm(side){
   const direction=side==='left'?-1:1;
   const shoulder=new THREE.Group();shoulder.position.set(direction*.53,.79,0);upper.add(shoulder);parts[side+'Shoulder']=shoulder;
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
 // Mini crossbody bag and its flexible strap: attached to upper body, not screen space.
 const strapMat=mat('#504a5f',.82);
 const strap=child(upper,new THREE.TorusGeometry(.60,.034,6,28,Math.PI*.82),strapMat,[-.035,.36,.365]);strap.rotation.z=.75;strap.scale.set(1.05,1.22,.9);
 child(upper,new THREE.SphereGeometry(.24,14,10),mat('#d0b286',.92),[-.29,-.05,.47],[1.16,.68,.53]);
 child(upper,new THREE.SphereGeometry(.07,10,8),mat('#f5e5b2'),[-.21,-.05,.61],[1,.45,.35]);
 // Existing rock horns and bottle stay parented to right hand as the arm animates.
 const horns=new THREE.Group();parts.rightHand.add(horns);horns.position.set(0,.025,.09);horns.visible=false;parts.horns=horns;
 child(horns,new THREE.SphereGeometry(.067,10,8),skinMat,[0,0,0],[1,.7,.8]);
 for(const x of [-.064,.064])child(horns,new THREE.CapsuleGeometry(.024,.145,3,6),skinMat,[x,.10,.01]);
 const bottle=new THREE.Group();parts.rightHand.add(bottle);bottle.position.set(0,-.005,.14);bottle.visible=false;parts.bottle=bottle;
 const glass=mat('#498c75',.3);child(bottle,new THREE.CylinderGeometry(.10,.12,.39,12),glass,[0,-.16,0]);
 child(bottle,new THREE.CylinderGeometry(.045,.065,.19,10),glass,[0,.13,0]);
 child(bottle,new THREE.CylinderGeometry(.06,.06,.055,10),mat('#f3ca82'),[0,.25,0]);
 child(bottle,new THREE.CylinderGeometry(.127,.127,.12,12),mat('#f2e1bd'),[0,-.14,0]);
 // Always-white bold nickname with no background.
 const cv=document.createElement('canvas');cv.width=512;cv.height=128;const ctx=cv.getContext('2d');
 ctx.fillStyle='#fff';ctx.font='900 52px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.name||'ROCKER').slice(0,18),256,64,490);
 const texture=new THREE.CanvasTexture(cv);
 const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));tag.scale.set(4.65,1.16,1);tag.position.y=3.66;root.add(tag);parts.tag=tag;
 return {root,parts,color:p.color,lastAction:'idle'};
}

// Chat bubbles are true 3D sprites anchored in world coordinates, independent of avatar pose.
function bubbleTexture(message){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=224;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,224);
 ctx.fillStyle='rgba(255,255,255,.98)';ctx.strokeStyle='#283044';ctx.lineWidth=7;
 ctx.beginPath();ctx.roundRect(15,15,482,165,32);ctx.fill();ctx.stroke();
 ctx.beginPath();ctx.moveTo(238,180);ctx.lineTo(256,211);ctx.lineTo(278,180);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle='#171d31';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 70px system-ui, sans-serif';ctx.fillText(message,256,99,445);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function showBubble(entry){
 if(!entry||!entry.playerId||!state.players.has(entry.playerId))return;
 const old=activeBubbles.get(entry.playerId);
 if(old){scene.remove(old.sprite);old.sprite.material.map.dispose();old.sprite.material.dispose()}
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:bubbleTexture(entry.message),transparent:true,depthTest:false,depthWrite:false}));
 sprite.scale.set(3.4,1.49,1);sprite.renderOrder=150;scene.add(sprite);
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
// Smooth motion blending for the upgraded chibi rig. All poses share the same joints.
function animateAvatar(a,p,t){
 const q=(p.id===state.id&&state.me)?state.me:p,wp=toWorld(q),P=a.parts;
 a.root.position.x+=(wp.x-a.root.position.x)*.28;
 a.root.position.z+=(wp.z-a.root.position.z)*.28;
 const act=q.action||'idle',sec=t*.001,pose={};
 const keys=['upper','neck','leftShoulder','rightShoulder','leftElbow','rightElbow','leftHip','rightHip','leftKnee','rightKnee'];
 for(const key of keys)pose[key]=[0,0,0];
 let height=0,lean=0;
 const set=(key,x=0,y=0,z=0)=>{pose[key]=[x,y,z]};
 if(act==='walk'||act==='run'){
  const fast=act==='run',pace=fast?11.6:7.4,amp=fast?.66:.39;
  const wave=Math.sin(sec*pace),opp=Math.sin(sec*pace+Math.PI);
  set('leftHip',wave*amp);set('rightHip',opp*amp);
  set('leftKnee',Math.max(0,wave)*(.68*(fast?1:.7)));
  set('rightKnee',Math.max(0,opp)*(.68*(fast?1:.7)));
  set('leftShoulder',-wave*amp*.58);set('rightShoulder',-opp*amp*.58);
  set('leftElbow',-.12);set('rightElbow',-.12);
  set('upper',fast?-.14:-.035,0,Math.sin(sec*pace)*.035);
  height=Math.abs(Math.sin(sec*pace))*(fast?.12:.048);
 }
 if(act==='jump'){
  const phase=Math.sin(sec*8.3);const lift=Math.max(0,phase);
  height=lift*1.03;set('leftHip',-.35*(1-lift));set('rightHip',-.35*(1-lift));
  set('leftKnee',.62*(1-lift));set('rightKnee',.62*(1-lift));
  set('leftShoulder',-.18,0,.64);set('rightShoulder',-.18,0,-.64);
 }
 if(act==='peace'){
  set('rightShoulder',-.44,0,-2.42);set('rightElbow',0,0,-.24);
  set('leftShoulder',0,0,-.09);set('neck',0,0,.08);
 }
 if(act==='wave'){
  const wobble=Math.sin(sec*8.2);
  set('rightShoulder',-.58,.12,-2.03);set('rightElbow',-.18,0,-.56+wobble*.37);
  set('neck',0,0,-.07);
 }
 if(act==='clap'){
  const beat=(1+Math.cos(sec*16.2))*.5;const gap=.08+.38*(1-beat);
  // Both elbows bend towards a common point in front of the chest.
  set('leftShoulder',-1.03,0,.62+gap*.25);set('rightShoulder',-1.03,0,-.62-gap*.25);
  set('leftElbow',-.30,0,.78-gap*.38);set('rightElbow',-.30,0,-.78+gap*.38);
  set('upper',.035);
 }
 if(act==='drink'){
  const sip=(1+Math.sin(sec*4.8))*.5;
  // Forward forearm, elbow folded so bottle tip rises to the mouth.
  set('rightShoulder',-1.14,-.14,-.72);set('rightElbow',-.78-.16*sip,.03,-.48);
  P.bottle.rotation.set(-.28-.35*sip,0,-.12);set('neck',.04+.05*sip);
 }
 if(act==='sit'){
  height=-.24;set('upper',.06);set('leftHip',-1.43);set('rightHip',-1.43);
  set('leftKnee',1.45);set('rightKnee',1.45);
  set('leftShoulder',.16);set('rightShoulder',.16);
 }
 if(act==='lie'){
  height=.52;lean=-Math.PI/2;
  set('leftShoulder',.13);set('rightShoulder',.13);set('leftHip',.11);set('rightHip',.11);
 }
 // Damped transitions preserve smoothness when starting and stopping actions.
 const alpha=act===a.lastAction?.24:.14;
 for(const k of keys){const target=pose[k],o=P[k];
   o.rotation.x+= (target[0]-o.rotation.x)*alpha;
   o.rotation.y+= (target[1]-o.rotation.y)*alpha;
   o.rotation.z+= (target[2]-o.rotation.z)*alpha;
 }
 a.root.position.y+=(height-a.root.position.y)*.28;
 a.root.rotation.x+=(lean-a.root.rotation.x)*.22;
 P.horns.visible=act==='peace';P.bottle.visible=act==='drink';
 if(act!=='drink')P.bottle.rotation.set(0,0,0);
 if(act!=='lie'){
  const yaw=Number(q.facing)||0;
  const delta=((yaw-a.root.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;
  a.root.rotation.y+=delta*.2;
 }
 a.lastAction=act;
}
// Click or tap the ground to walk; dragging continues to orbit the camera.

const groundRay=new THREE.Raycaster(), pointer=new THREE.Vector2(), groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0), hit=new THREE.Vector3();
let pointerStart=null;
renderer.domElement.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY,time:performance.now()}});
renderer.domElement.addEventListener('pointerup',e=>{
 if(!pointerStart||!state.me)return;
 const dist=Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y);pointerStart=null;
 if(dist>9)return;
 const bounds=renderer.domElement.getBoundingClientRect();pointer.set(((e.clientX-bounds.left)/bounds.width)*2-1,-((e.clientY-bounds.top)/bounds.height)*2+1);
 groundRay.setFromCamera(pointer,camera);if(!groundRay.ray.intersectPlane(groundPlane,hit))return;
 const x=Math.max(20,Math.min(1380,hit.x/.058+600)),y=Math.max(220,Math.min(1100,(hit.z-8)/.058+500));
 state.walkTarget={x,y};toast('선택한 위치로 이동합니다');
});
function tick(t){
 if(state.me){let dx=0,dy=0,k=state.keys;dx+=+(k.has('d')||k.has('arrowright'))-+(k.has('a')||k.has('arrowleft'));dy+=+(k.has('s')||k.has('arrowdown'))-+(k.has('w')||k.has('arrowup'));
 if(dx||dy)state.walkTarget=null;
 if(!dx&&!dy&&state.walkTarget){const tx=state.walkTarget.x-state.me.x,ty=state.walkTarget.y-state.me.y,n=Math.hypot(tx,ty);if(n>4){dx=tx/n;dy=ty/n}else state.walkTarget=null}
 state.moving=!!(dx||dy);
 if(state.moving){let n=Math.hypot(dx,dy),speed=state.action==='run'?5:3.2;state.me.x=Math.max(20,Math.min(1380,state.me.x+dx/n*speed));state.me.y=Math.max(220,Math.min(1100,state.me.y+dy/n*speed));state.me.facing=Math.atan2(dx,dy);
 if(['sit','lie'].includes(state.action)){state.action='idle';state.me.action='idle'}
 if(state.action==='idle'||state.action==='walk')state.me.action='walk';
 }else if(state.me.action==='walk')state.me.action='idle';
 if(t>state.actionUntil&&state.action!=='idle'&&state.action!=='run'){state.action='idle';state.me.action=state.moving?'walk':'idle';document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'))}
 if(t-state.lastSent>150){state.lastSent=t;sendMove()}
 }
 for(let [id,p] of state.players){if(!avatars.has(id)){let a=makeAvatar(p),pos=toWorld(p);a.root.position.set(pos.x,0,pos.z);avatars.set(id,a)}animateAvatar(avatars.get(id),p,t)}
 for(let [id,a] of avatars)if(!state.players.has(id)){scene.remove(a.root);a.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material?.map)o.material.map.dispose();if(o.material)o.material.dispose()});avatars.delete(id)}
 updateEnvironment();updateOcean(t);updateBubbles(t);animateShow(t);followLocalAvatar();controls.update();keepCameraInFrontOfStage();renderer.render(scene,camera);cssRenderer.render(scene,camera);requestAnimationFrame(tick)
}
function resize(){let w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);cssRenderer.setSize(w,h)}new ResizeObserver(resize).observe(host);resize();requestAnimationFrame(tick);
setInterval(()=>{syncVideo();reportDuration();let m=state.music;if(!m.id)return;let sec=m.paused?m.position:(Date.now()+state.serverDelta-m.startedAt)/1000;let dur=state.ytReady?state.yt.getDuration():0;$('progressFill').style.width=dur?Math.min(100,sec/dur*100)+'%':'0%'},5000);
window.addEventListener('pagehide',()=>{if(state.id)navigator.sendBeacon('/api/leave',new Blob([JSON.stringify({id:state.id})],{type:'application/json'}))});

const ytScript=document.createElement('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.appendChild(ytScript);

$('musicToggle').onclick=()=>document.body.classList.toggle('music-open');$('musicClose').onclick=()=>document.body.classList.remove('music-open');

function notice(message){const host=$('joinNotices');const el=document.createElement('div');el.textContent=message;host.append(el);setTimeout(()=>el.remove(),4400)}
function appendChat(entry){const el=document.createElement('div');el.className='chat-line';const who=document.createElement('b');who.textContent=entry.name+' : ';const value=document.createElement('span');value.textContent=entry.message;el.append(who,value);$('chatMessages').append(el);while($('chatMessages').children.length>35)$('chatMessages').firstChild.remove();$('chatMessages').scrollTop=$('chatMessages').scrollHeight}
$('chatToggle').onclick=()=>$('chatPanel').classList.toggle('hidden');
$('chatClose').onclick=()=>$('chatPanel').classList.add('hidden');
document.querySelectorAll('[data-chat]').forEach(b=>b.onclick=async()=>{if(!state.id)return toast('먼저 입장해 주세요');try{await post('chat',{id:state.id,message:b.dataset.chat})}catch(e){toast(e.message)}});

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
