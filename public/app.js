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
async function join(){try{let d=await post('join',{name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);state.players=new Map(d.players.map(p=>[p.id,p]));$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;applyMusic(d.music,d.serverNow,d.queue);listen();$('audioModal').classList.remove('hidden');toast('ONEseason에 오신 것을 환영합니다!')}catch(e){$('joinError').textContent=e.message}}
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
const stageWebObject=new CSS3DObject(stageVideo);stageWebObject.position.set(0,5.8,-29.12);stageWebObject.scale.set(.014,.014,.014);scene.add(stageWebObject);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=11;controls.maxDistance=75;controls.maxPolarAngle=Math.PI/2.12;controls.target.set(0,1,4);controls.enablePan=false;
const hemi=new THREE.HemisphereLight('#a4bcff','#2e442e',2.2);scene.add(hemi);const moon=new THREE.DirectionalLight('#e1ecff',2.6);moon.position.set(-20,35,25);moon.castShadow=true;moon.shadow.mapSize.set(1024,1024);moon.shadow.camera.left=-55;moon.shadow.camera.right=55;moon.shadow.camera.top=55;moon.shadow.camera.bottom=-55;scene.add(moon);
const mat=(c,roughness=.83,emissive=null)=>new THREE.MeshStandardMaterial({color:c,roughness,metalness:roughness<.5?.22:0,emissive:emissive||'#000000',emissiveIntensity:emissive?.8:0});
const dark=mat('#17192b'),metal=mat('#525875',.35),grass=mat('#34554b'),wood=mat('#293344'),skin=mat('#edbd9e');
function cube(w,h,d,m,x,y,z,cast=true){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o}
function sphere(r,m,x,y,z){let o=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function cylinder(rt,rb,h,m,x,y,z){let o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,14),m);o.position.set(x,y,z);o.castShadow=true;scene.add(o);return o}
function label(str,size=100,color='#ffffff',bg='#22283b'){let cv=document.createElement('canvas');cv.width=512;cv.height=128;let c=cv.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,512,128);c.fillStyle=color;c.font=`900 ${size}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(str,256,67);let tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide})}
const floor=cube(76,.4,62,grass,0,-.24,6);floor.receiveShadow=true;
// Main stage faces the audience: far north = negative z.
cube(39,1.6,13,dark,0,1,-24);cube(41,1.1,1,metal,0,2,-17.2);cube(40,1.5,1,dark,0,10,-30);cube(1,10,1,metal,-19,6,-30);cube(1,10,1,metal,19,6,-30);cube(40,9,.6,dark,0,6,-30);
const sign=new THREE.Mesh(new THREE.PlaneGeometry(21,1.45),label('ONEseason',74,'#dcfd8b','#18172e'));sign.position.set(0,10.9,-28.9);scene.add(sign);
for(let x=-19;x<=19;x+=2.2){cube(.13,8,.13,metal,x,6,-29.2,false);let bulb=sphere(.19,mat(['#ff5b98','#bc9dff','#deff8c','#68e6f3'][Math.round((x+19)/2.2)%4],.2,'#ffffff'),x,10.2,-28);bulb.material.emissiveIntensity=1.2}
for(let s of [-1,1]){for(let j=0;j<2;j++){let x=s*16,z=-24+j*3;cube(3.5,4,2.4,dark,x,4.25,z);for(let dy of [3.1,5.2]){let o=cylinder(1,1,.16,metal,x,dy,z+1.26);o.rotation.x=Math.PI/2;let p=cylinder(.72,.72,.17,mat('#0d0e1b'),x,dy,z+1.4);p.rotation.x=Math.PI/2}}}
// drum kit + guitars on stage
cylinder(1.45,1.45,1.2,mat('#d671c0',.5),0,3.2,-24);for(let x of [-2,2]){cylinder(.8,.8,.7,mat('#94bbfe'),x,3.6,-25);cylinder(.07,.07,3,metal,x*1.3,3.8,-25)}
for(let x of [-7,7]){cylinder(.12,.12,3.2,metal,x,4,-23.2);sphere(.18,mat('#fcf6d5'),x,5.65,-23.2)}
// Crowd barrier
for(let x=-26;x<=26;x+=3){cube(.11,1.45,.11,metal,x,.9,-13);if(x<26)cube(3,.13,.13,metal,x+1.5,1.48,-13)}
// Walkway and picnic area
cube(69,.05,1.5,mat('#566c58'),0,.04,10,false);cube(70,.06,22,mat('#466858'),0,.03,23,false);
const matPositions=mats.map(m=>({x:(m.x-600)*.058,z:((m.y-500)*.058)+8,c:m.c}));matPositions.forEach((m,i)=>{let blanket=cube(8,.10,5.6,mat(m.c),m.x,.13,m.z);blanket.rotation.y=[-.12,.10,0,-.08,.12][i];for(let s of [-1,1])cube(7.8,.025,.12,mat('#ffffff'),m.x,.2,m.z+s*2.2,false)});
// trees, lanterns, food stalls
for(let x of [-34,34])for(let z of [-9,9,23]){cylinder(.45,.65,5,wood,x,2.5,z);sphere(2.7,mat('#477f63'),x,6,z);sphere(1.7,mat('#5a9a70'),x+1.7,5.7,z-1)}
for(let x of [-27,27]){cube(5,2.8,3,mat('#bc7097'),x,1.6,15);cube(5.8,.35,4.1,mat('#f4c783'),x,3.2,15);let banner=new THREE.Mesh(new THREE.PlaneGeometry(4,1.1),label(x<0?'SNACKS':'MERCH',70,'#fbe9dc','#9e446f'));banner.position.set(x,2.2,16.56);scene.add(banner)}
const stageLights=[];for(let i=0;i<7;i++){let x=-17+i*5.6;let l=new THREE.SpotLight(['#ff64a5','#8c84ff','#c4fb79','#68e8f3'][i%4],110,65,.50,.65);l.position.set(x,9,-19);l.target.position.set(x*.65,0,0);scene.add(l,l.target);stageLights.push(l)}
for(let i=0;i<55;i++){let x=(Math.sin(i*44.7)*.5+.5)*66-33,z=(Math.sin(i*21.8)*.5+.5)*40-10;if(z<12&&z>-8){let c=sphere(.10,mat(['#d9ee98','#d78bae','#8cc5eb'][i%3]),x,.1,z);c.castShadow=false}}
// Rounded 3D people: capsule torsos and rounded limbs
function makeAvatar(p){let root=new THREE.Group();scene.add(root);const shirt=mat(p.color),pants=mat('#232638'),hair=mat('#302637');const parts={};
function part(name,geo,m,x,y,z,parent=root){let o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=true;parent.add(o);parts[name]=o;return o}
part('torso',new THREE.CapsuleGeometry(.52,.60,8,16),shirt,0,1.48,0);part('head',new THREE.SphereGeometry(.43,12,10),skin,0,2.48,0);part('hair',new THREE.SphereGeometry(.44,12,8,0,Math.PI*2,0,Math.PI*.43),hair,0,2.64,0);if(p.gender==='female'){part('hairBack',new THREE.CapsuleGeometry(.43,.53,8,12),hair,0,2.19,-.12)}part('leftArm',new THREE.CapsuleGeometry(.18,.60,6,12),skin,-.74,1.50,0);part('rightArm',new THREE.CapsuleGeometry(.18,.60,6,12),skin,.74,1.5,0);part('leftLeg',new THREE.CapsuleGeometry(.22,.56,6,12),pants,-.28,.49,0);part('rightLeg',new THREE.CapsuleGeometry(.22,.56,6,12),pants,.28,.49,0);part('shoeL',new THREE.SphereGeometry(.29,14,10),dark,-.28,.12,-.13);part('shoeR',new THREE.SphereGeometry(.29,14,10),dark,.28,.12,-.13);
// Rock horns: index + pinky extended, middle/ring curled, thumb across palm.
let hand=new THREE.Group();hand.position.set(0,-.56,0);parts.rightArm.add(hand);parts.horns=hand;
let fingerMat=skin;let palm=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),fingerMat);palm.scale.set(1,.7,.7);hand.add(palm);
for(const x of [-.13,.13]){let finger=new THREE.Mesh(new THREE.CapsuleGeometry(.055,.29,5,8),fingerMat);finger.position.set(x,-.29,0);hand.add(finger)}
let thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.06,.13,5,8),fingerMat);thumb.position.set(.13,.04,.12);thumb.rotation.z=.95;hand.add(thumb);hand.visible=false;
part('eyeL',new THREE.SphereGeometry(.055,10,8),dark,-.16,2.49,.38);part('eyeR',new THREE.SphereGeometry(.055,10,8),dark,.16,2.49,.38);let labelText=p.name||'ROCKER';let tag=new THREE.Sprite(new THREE.SpriteMaterial({map:(()=>{let c=document.createElement('canvas');c.width=512;c.height=128;let g=c.getContext('2d');g.clearRect(0,0,512,128);g.fillStyle='#ffffff';g.font='900 51px Arial, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(labelText.slice(0,18),256,64,490);return new THREE.CanvasTexture(c)})(),transparent:true,depthTest:false}));tag.scale.set(4.6,1.15,1);tag.position.y=3.55;root.add(tag);
// Torso rotates from waist, arms from shoulders, head from neck.
const upper=new THREE.Group();upper.position.y=1.02;root.add(upper);parts.upper=upper;
for(const k of ['torso','head','hair','hairBack','eyeL','eyeR','leftArm','rightArm'].filter(k=>parts[k])){const o=parts[k];root.remove(o);upper.add(o);o.position.y-=1.02}
const neck=new THREE.Group();neck.position.set(0,2.10-1.02,0);upper.add(neck);parts.neck=neck;
for(const k of ['head','hair','hairBack','eyeL','eyeR'].filter(k=>parts[k])){const o=parts[k];upper.remove(o);neck.add(o);o.position.y-=(2.10-1.02)}
for(const side of ['left','right']){let arm=parts[side+'Arm'];const pivot=new THREE.Group();pivot.position.set(side==='left'?-.63:.63,1.96-1.02,0);upper.add(pivot);upper.remove(arm);pivot.add(arm);arm.position.set(side==='left'?-.11:.11,1.5-1.96,0);parts[side+'Shoulder']=pivot}
// Fingers point upward when the arm is lifted. Extended index and pinky.
const horns=parts.horns;horns.rotation.z=Math.PI;horns.position.set(0,-.57,0);
return {root,parts,color:p.color}}
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
 a.root.position.x+=(wp.x-a.root.position.x)*.38;
 a.root.position.z+=(wp.z-a.root.position.z)*.38;
 const act=q.action||'idle',time=t*.001;
 a.root.position.y=act==='jump'?Math.abs(Math.sin(time*8))*1.35:act==='run'?Math.abs(Math.sin(time*12))*.14:0;
 a.root.rotation.x=0;P.upper.rotation.set(0,0,0);P.neck.rotation.set(0,0,0);
 P.leftShoulder.rotation.set(0,0,0);P.rightShoulder.rotation.set(0,0,0);
 P.leftLeg.rotation.set(0,0,0);P.rightLeg.rotation.set(0,0,0);
 P.horns.visible=act==='peace';
 if(act==='peace'){
   // Right arm raised clearly above the head, showing the rock-horns hand.
   P.rightShoulder.rotation.z=2.88;
   P.rightShoulder.rotation.x=-.16;
   P.leftShoulder.rotation.z=-.22;
 }
 if(act==='wave'){
   // Right hand high and moving side-to-side from the shoulder.
   P.rightShoulder.rotation.z=2.35+Math.sin(time*6.5)*.24;
   P.rightShoulder.rotation.x=Math.sin(time*6.5)*.20;
   P.leftShoulder.rotation.z=-.10;
 }
 if(act==='clap'){
   // Both hands come together repeatedly in front of the chest.
   // Aim both arms at the front of the chest. Hands physically converge on each beat.
   // Capsule arm geometry points down the local Y axis from the shoulder pivot.
   const beat=(1+Math.cos(time*11))*.5;
   const handGap=.06+.37*(1-beat);
   const shoulderHeight=1.96;
   const targetHeight=1.48;
   const targetForward=.63;
   const leftTarget=new THREE.Vector3(-handGap+.63,targetHeight-shoulderHeight,targetForward);
   const rightTarget=new THREE.Vector3(handGap-.63,targetHeight-shoulderHeight,targetForward);
   const down=new THREE.Vector3(0,-1,0);
   P.leftShoulder.quaternion.setFromUnitVectors(down,leftTarget.normalize());
   P.rightShoulder.quaternion.setFromUnitVectors(down,rightTarget.normalize());
 }
 if(act==='walk'||act==='run'){
   let pace=act==='run'?12:8;
   P.leftShoulder.rotation.x=Math.sin(time*pace)*.65;
   P.rightShoulder.rotation.x=-Math.sin(time*pace)*.65;
   P.leftLeg.rotation.x=-Math.sin(time*pace)*.58;
   P.rightLeg.rotation.x=Math.sin(time*pace)*.58;
 }
 if(act==='sit'){a.root.position.y=-.38;P.leftLeg.rotation.x=-1.35;P.rightLeg.rotation.x=-1.35}
 if(act==='lie'){a.root.position.y=.63;a.root.rotation.x=-Math.PI/2}
 if(act!=='lie'){const yaw=Number(q.facing)||0;let delta=((yaw-a.root.rotation.y+Math.PI*3)%(Math.PI*2))-Math.PI;a.root.rotation.y+=delta*.24}
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
