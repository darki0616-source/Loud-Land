import * as THREE from 'https://esm.sh/three@0.160.1';
import { OrbitControls } from 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'https://esm.sh/three@0.160.1/examples/jsm/renderers/CSS3DRenderer.js';
const $=id=>document.getElementById(id), palette=['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee'];
const mats=[{x:125,y:672,c:'#f5a5a3'},{x:355,y:690,c:'#a7def4'},{x:600,y:684,c:'#f5ce80'},{x:855,y:688,c:'#b3d9a0'},{x:1057,y:669,c:'#ceb8f1'}];
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0,token:0},queue:[],serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:false,walkTarget:null,moving:false};
let chosenColor=palette[0],chosenGender='male',toastTimer;const avatars=new Map();const activeBubbles=new Map();
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000)}
document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>{chosenGender=b.dataset.gender;document.querySelectorAll('[data-gender]').forEach(x=>x.classList.toggle('selected',x===b))});
function colorPicker(){let r=$('colorPicker');r.innerHTML='';palette.forEach(c=>{let b=document.createElement('button');b.style.background=c;b.className=c===chosenColor?'selected':'';b.setAttribute('aria-label','티셔츠 '+c);b.onclick=()=>{chosenColor=c;colorPicker()};r.append(b)})}colorPicker();
async function post(ep,data){let r=await fetch('/api/'+ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});let d=await r.json();if(!r.ok)throw Error(d.error||'서버 오류');return d}
function applyMusic(m,serverNow,queue){state.music=m;if(Array.isArray(queue))state.queue=queue;renderQueue();if(serverNow)state.serverDelta=serverNow-Date.now();$('songTitle').textContent=m.id?m.title||'유튜브 영상':'등록된 음악 없음';$('songCredit').textContent=m.id?`DJ ${m.changedBy||'알 수 없음'} · ${m.paused?'일시정지':'재생 중'}`:'첫 번째 DJ가 되어보세요';$('screenPlaceholder').style.display=m.id?'none':'flex';syncVideo(true)}

function renderQueue(){let el=$('queueList');if(!el)return;el.replaceChildren();if(!state.queue.length){let item=document.createElement('li');item.textContent='대기 중인 곡이 없습니다';el.append(item);return}state.queue.forEach((track,index)=>{let li=document.createElement('li');li.textContent=`${index+1}. ${track.title} · ${track.addedBy}`;el.append(li)})}
let reportedToken=0;
function reportDuration(){if(!state.id||!state.ytReady||!state.music.id)return;const duration=state.yt.getDuration();if(duration>1&&reportedToken!==state.music.token){reportedToken=state.music.token;post('music',{id:state.id,command:'duration',token:state.music.token,duration}).catch(()=>{})}}
function syncVideo(force=false){let m=state.music;if(!m.id||!state.ytReady)return;let sec=m.paused?m.position:Math.max(0,(Date.now()+state.serverDelta-m.startedAt)/1000);try{if(state.lastTrack!==String(m.token)+':'+m.id){state.lastTrack=String(m.token)+':'+m.id;reportedToken=0;if(state.audioEnabled&&!m.paused){state.yt.loadVideoById({videoId:m.id,startSeconds:sec});state.yt.unMute()}else state.yt.cueVideoById({videoId:m.id,startSeconds:sec});return}if(force||Math.abs(state.yt.getCurrentTime()-sec)>3)state.yt.seekTo(sec,true);if(state.audioEnabled){if(m.paused)state.yt.pauseVideo();else if(state.yt.getPlayerState()!==1)state.yt.playVideo()}else state.yt.pauseVideo()}catch(e){console.warn(e)}}
window.onYouTubeIframeAPIReady=()=>{state.yt=new YT.Player('youtubePlayer',{height:'100%',width:'100%',playerVars:{playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{state.ytReady=true;syncVideo(true)},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING||e.data===YT.PlayerState.CUED)reportDuration();if(e.data===YT.PlayerState.ENDED&&state.id&&state.music.id)post('music',{id:state.id,command:'ended',token:state.music.token}).catch(()=>{})},onError:()=>toast('영상이 임베드 재생을 허용하지 않습니다')}})};
async function musicCommand(command,extra={}){if(!state.id)return toast('먼저 입장해주세요');try{let d=await post('music',{id:state.id,command,...extra});applyMusic(d.music,d.serverNow,d.queue);toast('공유 음악이 업데이트되었습니다')}catch(e){toast(e.message)}}
$('playLink').onclick=()=>musicCommand('enqueue',{url:$('videoUrl').value});$('pauseMusic').onclick=()=>musicCommand('pause');$('resumeMusic').onclick=()=>musicCommand('resume');$('skipMusic').onclick=()=>musicCommand('skip');$('enableAudio').onclick=()=>{state.audioEnabled=true;try{state.yt?.unMute()}catch(e){}syncVideo(true);toast('이 기기의 소리를 켰어요')};$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')$('playLink').click()});
function listen(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;applyMusic(d.music,d.serverNow,d.queue);if(Array.isArray(d.chat)){$('chatMessages').replaceChildren();d.chat.forEach(appendChat)}}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count;if(d.player.id!==state.id)notice(d.player.name+' 들어왔습니다')}else if(d.type==='chat'){appendChat(d.entry);showBubble(d.entry)}else if(d.type==='move'){state.players.set(d.player.id,d.player)}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count}else if(d.type==='music')applyMusic(d.music,d.serverNow,d.queue)}}
async function join(){try{let d=await post('join',{name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);state.players=new Map(d.players.map(p=>[p.id,p]));$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;applyMusic(d.music,d.serverNow,d.queue);listen();$('audioModal').classList.remove('hidden');showMovementGuide();toast('ONEseason에 오신 것을 환영합니다!')}catch(e){$('joinError').textContent=e.message}}
$('audioYes').onclick=()=>{state.audioEnabled=true;$('audioModal').classList.add('hidden');if(state.ytReady){try{state.yt.unMute();state.yt.setVolume(75)}catch(e){}}syncVideo(true);toast(state.music.id?'음악 재생을 허용했어요':'음악이 등록되면 바로 재생돼요')};$('audioNo').onclick=()=>{state.audioEnabled=false;$('audioModal').classList.add('hidden');try{state.yt?.pauseVideo()}catch(e){}toast('음악을 끈 상태로 입장했어요')};$('joinBtn').onclick=join;$('nick').onkeydown=e=>{if(e.key==='Enter')join()};$('editAvatar').onclick=()=>{if(state.id){post('leave',{id:state.id}).catch(()=>{});state.es?.close();state.id=null;state.me=null;state.players.clear()}$('joinModal').classList.remove('hidden')};$('helpBtn').onclick=()=>toast('WASD 이동 · 클릭/터치 이동 · 드래그 시점 회전 · 1~7 리액션');
function react(a){if(!state.me)return;if(state.action===a&&['jump','run'].includes(a)){state.action='idle';state.actionUntil=0;state.me.action=state.moving?'walk':'idle';document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));sendMove();return;}const near=mats.some(m=>Math.hypot(state.me.x-m.x,state.me.y-m.y)<105);if(['sit','lie'].includes(a)&&!near)return toast('뒤쪽 돗자리 가까이에서 앉거나 누울 수 있어요');if(['sit','lie'].includes(a)){let mat=mats.reduce((u,v)=>Math.hypot(state.me.x-u.x,state.me.y-u.y)<Math.hypot(state.me.x-v.x,state.me.y-v.y)?u:v);state.me.x=mat.x;state.me.y=mat.y}state.action=a;state.actionUntil=['sit','lie','jump','run'].includes(a)?Infinity:performance.now()+1350;state.me.action=a; if(['sit','lie'].includes(a))state.walkTarget=null; document.querySelectorAll('[data-action]').forEach(b=>b.classList.toggle('active',b.dataset.action===a));sendMove()}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;let k=e.key.toLowerCase();if(k.startsWith('arrow')||k===' ')e.preventDefault();state.keys.add(k);let acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'bow','6':'sit','7':'lie'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
document.querySelectorAll('[data-dir]').forEach(b=>{let k={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright'}[b.dataset.dir];b.addEventListener('pointerdown',e=>{e.preventDefault();state.keys.add(k);b.setPointerCapture(e.pointerId)});for(let ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,()=>state.keys.delete(k))});
function sendMove(){if(!state.id||!state.me)return;let p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action}).catch(()=>{})}
// ===== 3D SPACE =====
const host=$('world');const scene=new THREE.Scene();scene.background=new THREE.Color('#10172a');scene.fog=new THREE.FogExp2('#10172a',.010);
const camera=new THREE.PerspectiveCamera(56,1,.1,350);camera.position.set(0,27,39);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
const cssRenderer=new CSS3DRenderer();cssRenderer.domElement.className='css-world';host.appendChild(cssRenderer.domElement);
const stageVideo=document.querySelector('#youtubeScreen');stageVideo.classList.add('onstage');
const stageWebObject=new CSS3DObject(stageVideo);stageWebObject.position.set(0,6.3,-29.12);stageWebObject.scale.set(.015,.015,.015);scene.add(stageWebObject);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=11;controls.maxDistance=75;controls.maxPolarAngle=Math.PI/2.12;controls.target.set(0,1,4);controls.enablePan=false;
const hemi=new THREE.HemisphereLight('#a4bcff','#2e442e',2.2);scene.add(hemi);const moon=new THREE.DirectionalLight('#e1ecff',2.6);moon.position.set(-20,35,25);moon.castShadow=true;moon.shadow.mapSize.set(1024,1024);moon.shadow.camera.left=-55;moon.shadow.camera.right=55;moon.shadow.camera.top=55;moon.shadow.camera.bottom=-55;scene.add(moon);
const mat=(c,roughness=.83,emissive=null)=>new THREE.MeshStandardMaterial({color:c,roughness,metalness:roughness<.5?.22:0,emissive:emissive||'#000000',emissiveIntensity:emissive?.8:0});
const dark=mat('#17192b'),metal=mat('#525875',.35),grass=mat('#34554b'),wood=mat('#293344'),skin=mat('#edbd9e');
function cube(w,h,d,m,x,y,z,cast=true){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o}
function sphere(r,m,x,y,z){let o=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function cylinder(rt,rb,h,m,x,y,z){let o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,14),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function label(str,size=100,color='#ffffff',bg='#22283b'){let cv=document.createElement('canvas');cv.width=512;cv.height=128;let c=cv.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,512,128);c.fillStyle=color;c.font=`900 ${size}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(str,256,67);let tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide})}

const floor=cube(84,.5,72,grass,0,-.26,7);floor.receiveShadow=true;
const audienceZone=cube(58,.08,34,mat('#243a44'),0,.05,-2,false);audienceZone.receiveShadow=true;
const runway=cube(8.5,.28,18,mat('#1b2231'),0,.38,-11.2);runway.receiveShadow=true;
const frontPit=cube(64,.12,3.6,mat('#16202d'),0,.14,-16,false);

// Big sky dome + stars for a less flat look.
const sky=new THREE.Mesh(new THREE.SphereGeometry(175,26,18),new THREE.MeshBasicMaterial({color:'#0d1326',side:THREE.BackSide,fog:false}));
scene.add(sky);
const starGeo=new THREE.BufferGeometry();const starCount=520;const starPos=new Float32Array(starCount*3);
for(let i=0;i<starCount;i++){
  const theta=Math.random()*Math.PI*2,phi=Math.random()*Math.PI*.48,r=120+Math.random()*38;
  starPos[i*3]=Math.cos(theta)*Math.sin(phi)*r;
  starPos[i*3+1]=42+Math.cos(phi)*r*.34;
  starPos[i*3+2]=Math.sin(theta)*Math.sin(phi)*r-8;
}
starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:'#e8f2ff',size:.65,sizeAttenuation:true,fog:false})));

// Mountain silhouette and distant glow
for(const [x,w,h,c] of [[-42,18,10,'#182233'],[-18,22,12,'#1a2537'],[10,24,11,'#182132'],[38,18,9,'#1b2739']]){
  const mountain=new THREE.Mesh(new THREE.ConeGeometry(w,h,4),mat(c,.95));
  mountain.position.set(x,h/2-1,-46);mountain.rotation.y=Math.PI/4;mountain.receiveShadow=true;scene.add(mountain)
}
const backGlow=new THREE.Mesh(new THREE.CircleGeometry(12,24),new THREE.MeshBasicMaterial({color:'#6d6eff',transparent:true,opacity:.14}));
backGlow.position.set(0,14,-41);scene.add(backGlow);

// Festival main stage - bigger and more layered
cube(46,1.9,15,dark,0,1.05,-25.5);                  // stage deck
cube(50,1.2,1.4,metal,0,2.2,-17.6);                  // stage lip
cube(46,13.5,1.2,dark,0,7.4,-31.8);                  // rear wall
cube(50,1.0,16,mat('#131a28'),0,13.8,-24.2);         // roof canopy
cube(2,14.4,2,metal,-23.6,7.2,-24.2);                // left tower
cube(2,14.4,2,metal,23.6,7.2,-24.2);                 // right tower
cube(44,0.55,0.9,mat('#2a3145'),0,14.3,-31.3);       // top truss
cube(44,0.5,0.5,metal,0,11.4,-22.2);                 // front truss
cube(16,8.8,.5,dark,-14,7.1,-31.18);                 // left back panel
cube(16,8.8,.5,dark,14,7.1,-31.18);                  // right back panel
cube(12,8.8,.65,mat('#0e1322'),0,7.1,-31.1);         // center LED backing

// Side LED screens
for(const sx of [-29.2,29.2]){
  cube(9.5,7.4,.9,dark,sx,6.9,-24.8);
  const sideScreen=new THREE.Mesh(new THREE.PlaneGeometry(8,5.2),new THREE.MeshBasicMaterial({color:'#75a7ff',transparent:true,opacity:.28}));
  sideScreen.position.set(sx,7.2,-24.15);scene.add(sideScreen)
}

// ONEseason logo sign
const sign=new THREE.Mesh(new THREE.PlaneGeometry(23,1.8),label('ONEseason',84,'#f1ffc6','#16172c'));
sign.position.set(0,14.9,-24.9);scene.add(sign);

// stage stairs
for(let i=0;i<4;i++)cube(4.8,0.22,1.8,metal,0,.12+i*.22,-17.8+i*1.1,false);

// lighting strips across the front
for(let x=-20;x<=20;x+=2.5){
  const strip=cube(1.6,.16,.38,mat('#d9ff7a',.2,'#d9ff7a'),x,1.95,-17.0,false);
  strip.material.emissiveIntensity=.95;
}
for(let x=-20;x<=20;x+=2.4){cube(.14,9.8,.14,metal,x,9,-31.0,false)}
for(let x=-20;x<=20;x+=4){let bulb=sphere(.22,mat(['#ff5b98','#8dc7ff','#d6ff86','#bca1ff'][Math.round((x+20)/4)%4],.22,'#ffffff'),x,13.1,-23.1);bulb.material.emissiveIntensity=1.45}

// speakers and instrument setup
for(let sx of [-18,18]){
  for(let stack=0;stack<3;stack++)cube(3.8,2.8,2.9,dark,sx,2.4+stack*2.9,-23.6+stack*.1);
  cube(1.1,5.5,1.2,metal,sx*1.02,10.8,-24.2,false)
}
cylinder(1.55,1.55,1.3,mat('#d56fbf',.46),0,3.35,-25.8); // bass drum
for(let x of [-2.3,2.3]){cylinder(.82,.82,.72,mat('#8fb4ff',.4),x,3.75,-26.3);cylinder(.07,.07,2.9,metal,x*1.16,3.9,-26.1)}
for(let sx of [-8,8]){cylinder(.12,.12,3.2,metal,sx,4.0,-23.4);sphere(.18,mat('#fcf6d5'),sx,5.66,-23.4);let guitar=new THREE.Mesh(new THREE.CapsuleGeometry(.44,1.05,8,12),mat(sx<0?'#ff819d':'#88d0ff',.35));guitar.position.set(sx+(sx<0?-.25:.25),2.95,-24.0);guitar.rotation.z=sx<0?-.22:.22;scene.add(guitar)}

// Crowd barrier and audience rails
for(let x=-30;x<=30;x+=3){cube(.11,1.45,.11,metal,x,.9,-13.3);if(x<30)cube(3,.13,.13,metal,x+1.5,1.48,-13.3)}
for(let x=-33;x<=33;x+=4.5){cube(.08,1.1,.08,metal,x,.55,8.5,false);if(x<33)cube(4.5,.08,.08,metal,x+2.25,1.0,8.5,false)}

// Path, picnic zone, mats, cushions, tents.
cube(76,.05,1.8,mat('#516d5b'),0,.04,11,false);
cube(76,.06,25,mat('#426455'),0,.03,25,false);
const matPositions=mats.map(m=>({x:(m.x-600)*.058,z:((m.y-500)*.058)+8,c:m.c}));
matPositions.forEach((m,i)=>{
  let blanket=cube(8.4,.10,5.8,mat(m.c),m.x,.13,m.z);blanket.rotation.y=[-.14,.12,0,-.1,.14][i];
  for(let s of [-1,1]){const trim=cube(8.1,.025,.12,mat('#fff7e4'),m.x,.2,m.z+s*2.3,false);trim.rotation.y=blanket.rotation.y}
  for(const dx of [-2.4,2.1]){let pillow=new THREE.Mesh(new THREE.BoxGeometry(1.15,.42,.9),mat('#f8f3ea'));pillow.position.set(m.x+dx,.34,m.z-1.35);pillow.rotation.y=blanket.rotation.y;scene.add(pillow)}
});
for(const sx of [-19,19]){ // little shade tents
  cube(4.8,.18,4.8,mat('#f7d980'),sx,2.55,25.2,false);
  for(const dx of [-1.95,1.95])for(const dz of [-1.95,1.95])cube(.12,2.5,.12,metal,sx+dx,1.25,25.2+dz,false)
}

// Trees, bushes, stalls and string lights
for(let x of [-35,-31,31,35])for(let z of [-12,6,22,34]){cylinder(.42,.62,5.4,wood,x,2.7,z);sphere(2.8,mat('#48795f'),x,6.3,z);sphere(1.8,mat('#5fa374'),x+1.35,5.9,z-.95);sphere(1.55,mat('#376852'),x-1.5,5.4,z+.6)}
for(let x of [-26,0,26]){cube(5.6,2.9,3.2,mat(x===0?'#5b79c6':'#bc7097'),x,1.65,16.8);cube(6.2,.38,4.4,mat('#f4c783'),x,3.28,16.8);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4.7,1.12),label(x<0?'SNACKS':x>0?'MERCH':'INFO',66,'#fbf1e2',x===0?'#435ca5':'#9e446f'));banner.position.set(x,2.23,18.49);scene.add(banner)}
for(let x=-24;x<=24;x+=8){
  cube(.09,4.8,.09,metal,x,5.7,18.8,false);cube(.09,4.8,.09,metal,x+4,5.7,18.8,false);
  for(let t=0;t<6;t++){let bulb=sphere(.13,mat(['#ff8ab0','#cdb5ff','#dfff8a','#88e8ff'][t%4],.1,'#ffffff'),x+.4+t*.64,7.2+Math.sin(t*.65)*.18,18.8);bulb.material.emissiveIntensity=1.5}
}

// Floating decorative confetti/flowers on the grass
for(let i=0;i<78;i++){
  let x=(Math.sin(i*44.7)*.5+.5)*72-36,z=(Math.sin(i*21.8)*.5+.5)*44-6;if(z<14&&z>-10)continue;
  let petal=sphere(.10,mat(['#d9ee98','#d78bae','#8cc5eb','#ffcf7c'][i%4]),x,.11,z);petal.castShadow=false
}

const stageLights=[];
for(let i=0;i<9;i++){
  let x=-20+i*5;
  let l=new THREE.SpotLight(['#ff64a5','#8c84ff','#c4fb79','#68e8f3','#ffd073'][i%5],120,72,.44,.62);
  l.position.set(x,11.6,-22.8);l.target.position.set(x*.55,.6,-6);
  l.castShadow=false;scene.add(l,l.target);stageLights.push(l)
}

// Higher-quality rounded 3D people with better silhouettes and hair.
function makeAvatar(p){
  let root=new THREE.Group();scene.add(root);
  const shirt=mat(p.color,.65),pants=mat('#252b3a',.75),hair=mat(p.gender==='female'?'#3f2b2e':'#2f2933',.86),shoeMat=mat('#141824',.5),skinMat=mat('#efc1a7',.92);
  const parts={};
  function add(name,obj,parent=root){parent.add(obj);obj.castShadow=true;obj.receiveShadow=true;parts[name]=obj;return obj}

  const pelvis=new THREE.Mesh(new THREE.SphereGeometry(.38,16,12),shirt);pelvis.position.set(0,1.08,0);add('pelvis',pelvis);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.48,.82,10,18),shirt);torso.position.set(0,1.78,0);add('torso',torso);
  const neckBase=new THREE.Group();neckBase.position.set(0,2.22,0);root.add(neckBase);parts.neck=neckBase;
  const head=new THREE.Mesh(new THREE.SphereGeometry(.46,18,14),skinMat);head.position.set(0,.36,.02);add('head',head,neckBase);
  const hairCap=new THREE.Mesh(new THREE.SphereGeometry(.47,18,12,0,Math.PI*2,0,Math.PI*.58),hair);hairCap.position.set(0,.49,-.02);add('hairCap',hairCap,neckBase);
  const fringe=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.42,6,12),hair);fringe.position.set(0,.39,.34);fringe.rotation.x=Math.PI/2;add('fringe',fringe,neckBase);
  if(p.gender==='female'){
    const backHair=new THREE.Mesh(new THREE.CapsuleGeometry(.26,.92,8,14),hair);backHair.position.set(0,-.02,-.22);add('hairBack',backHair,neckBase);
    const sideL=new THREE.Mesh(new THREE.CapsuleGeometry(.10,.52,6,10),hair);sideL.position.set(-.28,.2,.18);sideL.rotation.z=.2;add('sideHairL',sideL,neckBase);
    const sideR=sideL.clone();sideR.position.x=.28;sideR.rotation.z=-.2;add('sideHairR',sideR,neckBase);
  }else{
    const sideburnL=new THREE.Mesh(new THREE.CapsuleGeometry(.08,.18,5,9),hair);sideburnL.position.set(-.32,.25,.12);sideburnL.rotation.z=.18;add('sideHairL',sideburnL,neckBase);
    const sideburnR=sideburnL.clone();sideburnR.position.x=.32;sideburnR.rotation.z=-.18;add('sideHairR',sideburnR,neckBase);
  }
  add('eyeL',new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),mat('#212637')),neckBase).position.set(-.15,.37,.39);
  add('eyeR',new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),mat('#212637')),neckBase).position.set(.15,.37,.39);
  const blushL=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),new THREE.MeshBasicMaterial({color:'#ef9ca4',transparent:true,opacity:.58}));blushL.scale.set(1.3,.7,.5);blushL.position.set(-.22,.18,.41);add('blushL',blushL,neckBase);
  const blushR=blushL.clone();blushR.position.x=.22;add('blushR',blushR,neckBase);

  function limb(name,x,y,r=0.16,len=.62,m=skinMat){
    const pivot=new THREE.Group();pivot.position.set(x,y,0);root.add(pivot);parts[name+'Pivot']=pivot;
    const limb=new THREE.Mesh(new THREE.CapsuleGeometry(r,len,8,16),m);limb.position.set(0,-.42,0);pivot.add(limb);limb.castShadow=true;limb.receiveShadow=true;parts[name]=limb;
    return pivot;
  }
  limb('leftArm',-.66,2.0,.16,.72,skinMat);
  limb('rightArm',.66,2.0,.16,.72,skinMat);
  add('leftHand',new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),skinMat),parts.leftArmPivot).position.set(0,-.83,.01);
  add('rightHand',new THREE.Mesh(new THREE.SphereGeometry(.16,10,8),skinMat),parts.rightArmPivot).position.set(0,-.83,.01);
  parts.leftShoulder=parts.leftArmPivot;parts.rightShoulder=parts.rightArmPivot;

  const sleeveL=new THREE.Mesh(new THREE.CapsuleGeometry(.18,.16,6,10),shirt);sleeveL.position.set(-.66,1.78,0);root.add(sleeveL);parts.sleeveL=sleeveL;
  const sleeveR=sleeveL.clone();sleeveR.position.x=.66;root.add(sleeveR);parts.sleeveR=sleeveR;

  function leg(name,x){
    const pivot=new THREE.Group();pivot.position.set(x,1.0,0);root.add(pivot);parts[name+'Pivot']=pivot;
    const limb=new THREE.Mesh(new THREE.CapsuleGeometry(.2,.78,8,16),pants);limb.position.set(0,-.50,0);pivot.add(limb);limb.castShadow=true;limb.receiveShadow=true;parts[name]=limb;
    const shoe=new THREE.Mesh(new THREE.SphereGeometry(.23,12,10),shoeMat);shoe.scale.set(1.15,.8,1.45);shoe.position.set(0,-1.0,.05);pivot.add(shoe);parts[name==='leftLeg'?'shoeL':'shoeR']=shoe;
    return pivot;
  }
  leg('leftLeg',-.26);leg('rightLeg',.26);

  // Rock-horns hand attached to right hand for the reaction.
  const horns=new THREE.Group();horns.position.set(0,-.02,.12);parts.rightHand.add(horns);parts.horns=horns;
  const palm=new THREE.Mesh(new THREE.SphereGeometry(.15,12,10),skinMat);palm.scale.set(1.05,.78,.66);horns.add(palm);
  const finger1=new THREE.Mesh(new THREE.CapsuleGeometry(.04,.24,4,6),skinMat);finger1.position.set(-.07,-.18,.02);horns.add(finger1);
  const finger2=finger1.clone();finger2.position.x=.07;horns.add(finger2);
  const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.12,4,6),skinMat);thumb.position.set(.08,.03,.11);thumb.rotation.z=.9;horns.add(thumb);horns.visible=false;

  // white bold nickname only
  const labelText=(p.name||'ROCKER').slice(0,18);
  const tagCanvas=document.createElement('canvas');tagCanvas.width=512;tagCanvas.height=128;let g=tagCanvas.getContext('2d');
  g.clearRect(0,0,512,128);g.fillStyle='#ffffff';g.font='900 54px Arial, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(labelText,256,64,490);
  const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(tagCanvas),transparent:true,depthTest:false}));
  tag.scale.set(4.8,1.2,1);tag.position.y=4.1;root.add(tag);

  return {root,parts,color:p.color};
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
  b.sprite.position.set(a.root.position.x,a.root.position.y+5.12,a.root.position.z);
  b.sprite.material.opacity=Math.min(1,(b.expires-now)/350);
 }
}
function toWorld(p){return {x:(p.x-600)*.058,z:(p.y-500)*.058+8}}

function animateAvatar(a,p,t){
 const q=p.id===state.id&&state.me?state.me:p,wp=toWorld(q),P=a.parts;
 a.root.position.x+=(wp.x-a.root.position.x)*.32;
 a.root.position.z+=(wp.z-a.root.position.z)*.32;
 const act=q.action||'idle',time=t*.001;
 const moveCycle=(act==='run'?time*11.5:time*7.6);
 const moving=(act==='walk'||act==='run');
 const idleBob=!moving&&act==='idle'?Math.sin(time*2.6)*.04:0;
 const jumpBob=act==='jump'?Math.abs(Math.sin(time*8.2))*1.38:0;
 const runBob=act==='run'?Math.abs(Math.sin(time*11.5))*.18:0;
 a.root.position.y=idleBob+jumpBob+runBob;
 a.root.rotation.x=0;P.neck.rotation.set(0,0,0);
 P.leftShoulder.rotation.set(0,0,0);P.rightShoulder.rotation.set(0,0,0);
 P.leftLegPivot.rotation.set(0,0,0);P.rightLegPivot.rotation.set(0,0,0);
 P.leftArmPivot.position.z=P.rightArmPivot.position.z=0;
 P.leftArmPivot.position.y=P.rightArmPivot.position.y=2.0;
 P.leftLegPivot.position.y=P.rightLegPivot.position.y=1.0;
 P.horns.visible=false;

 // Default subtle stance
 P.torso.rotation.z=0; P.torso.rotation.x=0;
 P.pelvis.rotation.z=0; P.pelvis.rotation.x=0;

 if(moving){
   const armSwing=Math.sin(moveCycle)*(act==='run'?.95:.58);
   const legSwing=Math.sin(moveCycle)*(act==='run'?.88:.64);
   P.leftShoulder.rotation.x=armSwing;
   P.rightShoulder.rotation.x=-armSwing;
   P.leftLegPivot.rotation.x=-legSwing;
   P.rightLegPivot.rotation.x=legSwing;
   P.torso.rotation.x=act==='run'?.18:.06;
   P.neck.rotation.x=act==='run'?-0.1:0;
 }

 if(act==='peace'){
   P.horns.visible=true;
   P.rightShoulder.rotation.z=2.55;
   P.rightShoulder.rotation.x=-.22;
   P.leftShoulder.rotation.z=-.52;
   P.leftShoulder.rotation.x=.25;
   P.leftLegPivot.rotation.z=.05;P.rightLegPivot.rotation.z=-.05;
   P.neck.rotation.z=.08;
 }
 if(act==='wave'){
   P.rightShoulder.rotation.z=2.28+Math.sin(time*7.4)*.22;
   P.rightShoulder.rotation.x=.06+Math.sin(time*7.4)*.28;
   P.leftShoulder.rotation.z=-.25;
   P.neck.rotation.z=.06;
 }
 if(act==='clap'){
   const beat=(1+Math.cos(time*12.5))*.5;
   P.leftShoulder.rotation.z=-1.05-.38*beat;
   P.rightShoulder.rotation.z=1.05+.38*beat;
   P.leftShoulder.rotation.x=-.28+.12*beat;
   P.rightShoulder.rotation.x=-.28+.12*beat;
   P.torso.rotation.x=.08;
   P.neck.rotation.x=-.04;
   P.leftArmPivot.position.z=.10+.12*beat;
   P.rightArmPivot.position.z=.10+.12*beat;
   P.leftHand.position.x=-.02+.09*beat;
   P.rightHand.position.x=.02-.09*beat;
 }else{
   P.leftHand.position.x=0;P.rightHand.position.x=0;
 }
 if(act==='sit'){
   a.root.position.y=-.38;
   P.leftLegPivot.rotation.x=-1.42;P.rightLegPivot.rotation.x=-1.42;
   P.torso.rotation.x=.12;
 }
 if(act==='lie'){
   a.root.position.y=.66;
   a.root.rotation.x=-Math.PI/2;
   P.leftShoulder.rotation.z=-.15;P.rightShoulder.rotation.z=.15;
 }else{
   const yaw=Number(q.facing)||0;
   let delta=((yaw-a.root.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;
   a.root.rotation.y+=delta*.21;
 }
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
 const x=Math.max(30,Math.min(1170,hit.x/.058+600)),y=Math.max(345,Math.min(745,(hit.z-8)/.058+500));
 state.walkTarget={x,y};toast('선택한 위치로 이동합니다');
});
function tick(t){
 if(state.me){let dx=0,dy=0,k=state.keys;dx+=+(k.has('d')||k.has('arrowright'))-+(k.has('a')||k.has('arrowleft'));dy+=+(k.has('s')||k.has('arrowdown'))-+(k.has('w')||k.has('arrowup'));
 if(dx||dy)state.walkTarget=null;
 if(!dx&&!dy&&state.walkTarget){const tx=state.walkTarget.x-state.me.x,ty=state.walkTarget.y-state.me.y,n=Math.hypot(tx,ty);if(n>4){dx=tx/n;dy=ty/n}else state.walkTarget=null}
 state.moving=!!(dx||dy);
 if(state.moving){let n=Math.hypot(dx,dy),speed=state.action==='run'?5:3.2;state.me.x=Math.max(30,Math.min(1170,state.me.x+dx/n*speed));state.me.y=Math.max(345,Math.min(745,state.me.y+dy/n*speed));state.me.facing=Math.atan2(dx,dy);
 if(['sit','lie'].includes(state.action)){state.action='idle';state.me.action='idle'}
 if(state.action==='idle'||state.action==='walk')state.me.action='walk';
 }else if(state.me.action==='walk')state.me.action='idle';
 if(t>state.actionUntil&&state.action!=='idle'&&state.action!=='run'){state.action='idle';state.me.action=state.moving?'walk':'idle';document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'))}
 if(t-state.lastSent>110){state.lastSent=t;sendMove()}
 }
 for(let [id,p] of state.players){if(!avatars.has(id)){let a=makeAvatar(p),pos=toWorld(p);a.root.position.set(pos.x,0,pos.z);avatars.set(id,a)}animateAvatar(avatars.get(id),p,t)}
 for(let [id,a] of avatars)if(!state.players.has(id)){scene.remove(a.root);a.root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material?.map)o.material.map.dispose();if(o.material)o.material.dispose()});avatars.delete(id)}
 updateBubbles(t);stageLights.forEach((l,i)=>{l.intensity=100+35*Math.sin(t*.0019+i*2);l.target.position.x=(-17+i*5.6)*.65+Math.sin(t*.001+i)*7});controls.update();renderer.render(scene,camera);cssRenderer.render(scene,camera);requestAnimationFrame(tick)
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
