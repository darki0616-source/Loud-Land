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
const state={id:null,me:null,players:new Map(),keys:new Set(),action:'idle',pose:'stand',actionUntil:0,lastSent:0,es:null,music:{id:'',paused:true,position:0,startedAt:0,token:0},queue:[],history:[],serverDelta:0,yt:null,ytReady:false,lastTrack:'',audioEnabled:true,skipVote:null,skipVoteCooldownUntil:0,walkTarget:null,benchTarget:null,moving:false,rhythm:{date:'',leaderboard:[],reward:null,booth:{x:1290,y:1034,radius:135}},rhythmBest:0};
let slamMode=false,slam=null,slamCooldownUntil=0,slamMotion=null;
let rockPlacementMode=null,rockPlay=null,rockCooldowns={circle:0,train:0,mosh:0,row:0,toast:0,surf:0,shoulder:0},rockRunningUntil=0,rockMotion=null,crowdSurfScene=null,toastSequence=null,freeTrainTrail=null,shoulderSequence=null;
let chosenPattern='solid',chosenSash='none',chosenHairStyle='short',chosenHairColor='#4b3932';
const hairStyles=[['short','가르마 숏컷'],['bob','짧은 보브'],['long','장발'],['buns','번 헤어'],['bob2','레이어드 단발'],['short2','더 짧은 사이드 숏컷'],['basic-short','기본 숏컷'],['basic-bob','기본 단발']];
// Older custom styles are converted to the closest available Quaternius asset.
const legacyHairMap={wavy:'long',ponytail:'buns',mohawk:'short',spiky:'short',curly:'bob',buzz:'basic-short'};
const normalizeHairStyle=style=>hairStyles.some(([id])=>id===style)?style:(legacyHairMap[style]||'short');
const hairColors=[['검정','#25222a'],['진갈색','#4b3932'],['갈색','#85533e'],['금발','#edc46b'],['빨강','#d34c53'],['파랑','#4d86d5'],['보라','#9965c9'],['분홍','#e89bc2']];
let chosenColor=palette[0],chosenGender='male',toastTimer;const avatars=new Map();const activeBubbles=new Map();
// Keep a visitor's own appearance on this browser only (not by shared public IP).
const PROFILE_STORAGE_KEY='oneseason-profile-v1';
const FLAG_STORAGE_KEY='oneseason-flag-v1';
function savedFestivalFlag(){try{return (localStorage.getItem(FLAG_STORAGE_KEY)||'').slice(0,32)}catch{return ''}}
let currentFlagText=savedFestivalFlag();
const FLAG_IMAGE_STORAGE_KEY='oneseason-flag-image-v1';
function savedFestivalFlagImage(){try{const value=localStorage.getItem(FLAG_IMAGE_STORAGE_KEY)||'';return value.startsWith('data:image/jpeg;base64,')&&value.length<=210000?value:''}catch{return ''}}
let currentFlagImageData=savedFestivalFlagImage();
let currentFlagImageId='';

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
// Cross-restart browser identifier for stay-time awards. Never show in UI or send to peers.
const BADGE_ID_STORAGE='oneseason-stay-badge-v1';
function getBadgeIdentity(){
 try{
  let id=localStorage.getItem(BADGE_ID_STORAGE);
  if(!id||!/^[a-zA-Z0-9_-]{20,100}$/.test(id)){id=crypto.randomUUID();localStorage.setItem(BADGE_ID_STORAGE,id);}
  return id;
 }catch{return sessionKey;}
}
const badgeIdentity=getBadgeIdentity();
function badgeIconUrl(tier){return '/assets/badges/'+(BADGE_INFO[tier]?tier:'bronze')+'.svg';}
function makeBadgeImg(tier){
 const img=document.createElement('img');img.className='stay-badge-icon';img.src=badgeIconUrl(tier);img.alt=(BADGE_INFO[tier]||BADGE_INFO.bronze)[0]+' 배지';img.width=20;img.height=20;
 return img;
}

function readSavedProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY)||'null');return p&&typeof p==='object'?p:null}catch{return null}}
function saveProfile(p){try{localStorage.setItem(PROFILE_STORAGE_KEY,JSON.stringify({name:String(p.name||'ROCKER').slice(0,18),color:p.color,gender:p.gender,pattern:p.pattern||'solid',sash:p.sash||'none',hairStyle:normalizeHairStyle(p.hairStyle),hairColor:p.hairColor||'#4b3932'}))}catch{}}
function selectGender(g){chosenGender=g==='female'?'female':'male';document.querySelectorAll('[data-gender]').forEach(b=>b.classList.toggle('selected',b.dataset.gender===chosenGender))}
const apparelSashIds=['none','black','purple','red','green','black-check','red-check','yellow','blue','blue-check','yellow-check','purple-check','black-dot','red-dot','blue-dot','yellow-dot','purple-dot'];
const savedProfile=readSavedProfile();
if(savedProfile){if(typeof savedProfile.name==='string')$('nick').value=savedProfile.name.slice(0,18);if(palette.includes(savedProfile.color))chosenColor=savedProfile.color;if(['male','female'].includes(savedProfile.gender))selectGender(savedProfile.gender);if(['solid','stripe','wide-stripe'].includes(savedProfile.pattern))chosenPattern=savedProfile.pattern;if(apparelSashIds.includes(savedProfile.sash))chosenSash=savedProfile.sash;chosenHairStyle=normalizeHairStyle(savedProfile.hairStyle||(savedProfile.gender==='female'?'bob':'short'));if(hairColors.some(([,hex])=>hex===savedProfile.hairColor))chosenHairColor=savedProfile.hairColor}
let editingProfile=false;
function refreshProfilePreview(){if(!state.me)return;$('profileName').textContent=state.me.name;$('avatarPreview').querySelector('b').style.background=state.me.color}

function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000)}
const RHYTHM_DEFAULT_BOOTH={x:1290,y:1034,radius:135};
let rhythmUi=null;
const RHYTHM_APPROACH_MS=2100;
const rhythmGame={open:false,running:false,startAt:0,duration:45000,beatWindow:220,score:0,combo:0,maxCombo:0,perfect:0,great:0,good:0,miss:0,lastJudge:'READY',lastJudgeColor:'#ffffff',lastJudgeUntil:0,beats:[],beatIndex:0,endSubmitted:false};
const rhythmFx={bursts:[],lastScore:0,lastJudge:'',audio:null,clickIndex:0};
function rhythmClickSound(accent=false){if(!state.audioEnabled)return;try{const AudioContextCtor=window.AudioContext||window.webkitAudioContext;if(!AudioContextCtor)return;const ac=rhythmFx.audio||(rhythmFx.audio=new AudioContextCtor());if(ac.state==='suspended')ac.resume().catch(()=>{});const osc=ac.createOscillator(),gain=ac.createGain();const at=ac.currentTime;osc.type=accent?'triangle':'sine';osc.frequency.setValueAtTime(accent?880:620,at);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(accent?.11:.07,at+.005);gain.gain.exponentialRampToValueAtTime(.0001,at+.085);osc.connect(gain).connect(ac.destination);osc.start(at);osc.stop(at+.1)}catch{}}
function rhythmBurst(color,rank){const count=rank==='PERFECT'?24:rank==='GREAT'?15:8;for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2+Math.random()*.24,v=1.0+Math.random()*2.8;rhythmFx.bursts.push({x:.5,y:.52,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1.4,born:performance.now(),life:500+Math.random()*650,size:3+Math.random()*6,color})}if(rhythmFx.bursts.length>180)rhythmFx.bursts.splice(0,rhythmFx.bursts.length-180)}
function flashRhythmCombo(){if(!rhythmUi||rhythmGame.combo===0||rhythmGame.combo%10!==0)return;const el=rhythmUi.comboFlash;el.textContent=`🔥 ${rhythmGame.combo} COMBO!`;el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop')}

function nearRhythmBooth(){
 const booth=state.rhythm?.booth||RHYTHM_DEFAULT_BOOTH;
 if(!state.me)return false;
 return Math.hypot((state.me.x||0)-booth.x,(state.me.y||0)-booth.y)<=((booth.radius||175)+22);
}
function ensureRhythmUI(){
 if(rhythmUi)return rhythmUi;
 const style=document.createElement('style');
 style.textContent=`

#rhythmBoothButton{position:fixed;left:14px;bottom:160px;z-index:46;padding:14px 18px;border:none;border-radius:18px;background:linear-gradient(135deg,#8f5bff,#ff5eb9);color:#fff;font-weight:900;box-shadow:0 10px 35px rgba(0,0,0,.28);display:none;font-size:16px}
#rhythmBoothButton.show{display:block}
#rhythmBoothButton:disabled{opacity:.45}
#rhythmBoothHint{display:none}
#rhythmOverlay{position:fixed;inset:0;z-index:90;display:none;color:#fff;background:linear-gradient(180deg,rgba(7,9,25,.33),rgba(7,9,25,.54)),url('/assets/rhythm/background.png') center/cover no-repeat,radial-gradient(circle at 50% 20%,rgba(95,121,255,.36),transparent 34%),linear-gradient(180deg,#090c18,#10162b 65%,#0a0d19)}
#rhythmOverlay.show{display:block}
#rhythmOverlay,#rhythmCanvas,#rhythmMain,#rhythmHud{touch-action:none;overscroll-behavior:contain;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#rhythmOverlay button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
#rhythmRank{touch-action:pan-y;overscroll-behavior:contain}
#rhythmOverlay *{box-sizing:border-box}
#rhythmShell{position:absolute;inset:0;display:flex;flex-direction:column;padding:8px;gap:8px}
#rhythmTop{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:2px 2px 0}
#rhythmTitle{position:relative;isolation:isolate;font-size:clamp(18px,5.3vw,42px);font-weight:900;letter-spacing:.04em;text-shadow:0 0 18px rgba(255,255,255,.22);line-height:1.1;padding:6px 4px}
#rhythmTitle::before{content:'';position:absolute;inset:-8px -14px;background:url('/assets/rhythm/title.png') center/contain no-repeat;z-index:-1;pointer-events:none}
#rhythmSub{font-size:10px;opacity:.84;line-height:1.35;padding:0 4px;max-width:78vw}
#rhythmClose{border:none;border-radius:14px;padding:10px 12px;font-weight:900;background:#ffffff18;color:#fff;min-width:64px}
#rhythmBody{flex:1;display:grid;grid-template-rows:auto 1fr;gap:8px;min-height:0}
#rhythmRank{background-image:linear-gradient(rgba(12,14,35,.79),rgba(12,14,35,.85)),url('/assets/rhythm/ranking.png');background-position:center;background-size:cover;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:10px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
#rhythmRankHeader{display:flex;align-items:center;justify-content:space-between;gap:8px}
#rhythmRankHeader h3{margin:0;font-size:14px}
#rhythmRankMini{font-size:10px;opacity:.78}
#rhythmRankList{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
#rhythmRankList li{display:flex;flex-direction:column;gap:2px;align-items:flex-start;padding:6px;border-radius:12px;background:rgba(255,255,255,.06);min-width:0}
#rhythmRankList li em{font-size:10px}
#rhythmRankList li strong{font-size:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#rhythmRankList li span{font-size:10px;font-variant-numeric:tabular-nums}
#rhythmRewardBox{display:block;background:rgba(0,0,0,.18);border-radius:12px;padding:8px 10px;font-size:11px;line-height:1.35}
#rhythmGuide{display:none}
#rhythmMain{position:relative;min-height:0;border:1px solid rgba(255,255,255,.12);border-radius:24px;overflow:hidden;background-image:linear-gradient(rgba(5,9,25,.18),rgba(5,9,25,.3)),url('/assets/rhythm/play-area.png');background-position:center;background-size:cover}
#rhythmCanvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
#rhythmHud{position:absolute;inset:0;pointer-events:none}
#rhythmStats{position:absolute;left:8px;right:8px;top:8px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
#rhythmStats b{display:block;font-size:10px;opacity:.72}
#rhythmStats span{display:block;font-weight:900;font-size:clamp(18px,5vw,28px)}
#rhythmStats div{pointer-events:auto;background:rgba(8,10,18,.52);backdrop-filter:blur(10px);padding:8px 10px;border-radius:14px;min-width:0;text-align:center}
#rhythmJudge{position:absolute;left:50%;top:15%;transform:translateX(-50%);font-weight:900;font-size:clamp(24px,7vw,54px);text-shadow:0 0 20px rgba(255,255,255,.35);min-width:min(60vw,360px);min-height:clamp(54px,12vw,130px);display:flex;align-items:center;justify-content:center;background:url('/assets/rhythm/judge.png') center/contain no-repeat;pointer-events:none}
#rhythmCenter{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);text-align:center;width:min(92vw,520px)}
#rhythmHelp{margin-top:12px;font-size:12px;opacity:.94;line-height:1.35;padding:0 10px}
#rhythmStart{pointer-events:auto;margin-top:12px;border:none;border-radius:18px;padding:14px 24px;font-size:18px;font-weight:900;background-image:url('/assets/rhythm/start-button.png'),linear-gradient(135deg,#ffe36d,#ff76c8);background-position:center;background-size:100% 100%;color:#241133;box-shadow:0 14px 30px rgba(0,0,0,.28);min-width:min(66vw,320px)}
#rhythmCenterButton{pointer-events:auto;margin-top:8px;border:none;background:transparent;color:#fff;padding:8px 12px;font-size:14px;font-weight:800}
#rhythmComboFlash{position:absolute;left:50%;top:25%;transform:translate(-50%,-50%) scale(.7);font-size:clamp(18px,6vw,58px);font-weight:1000;letter-spacing:.03em;white-space:nowrap;opacity:0;text-shadow:0 0 14px #ff79c6,0 0 34px #984bff;will-change:transform,opacity}
#rhythmComboFlash.pop{animation:rhythmComboPop .9s cubic-bezier(.2,.6,.2,1) both}
@keyframes rhythmComboPop{0%{opacity:0;transform:translate(-50%,-50%) scale(.38) rotate(-5deg)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.28) rotate(3deg)}60%{opacity:1;transform:translate(-50%,-58%) scale(1)}100%{opacity:0;transform:translate(-50%,-90%) scale(.8)}}
#rhythmJudge.judge-pop{animation:rhythmJudgePop .44s ease-out both}
@keyframes rhythmJudgePop{0%{opacity:.4;transform:translateX(-50%) scale(.7)}45%{opacity:1;transform:translateX(-50%) scale(1.19)}100%{opacity:1;transform:translateX(-50%) scale(1)}}
#rhythmStats .score-bump span{animation:rhythmScoreBump .36s ease-out}
@keyframes rhythmScoreBump{0%{transform:scale(1)}45%{transform:scale(1.23);color:#ffe976}100%{transform:scale(1)}}
#rhythmDesignNote{display:none}
/* v155: use supplied visual assets as composed mobile UI, not generic cards. */
@media (max-width:900px){
 #rhythmOverlay{background-image:url('/assets/rhythm/background.png');background-position:center center;background-size:cover}
 #rhythmShell{padding:max(5px,env(safe-area-inset-top)) 5px max(7px,env(safe-area-inset-bottom));gap:5px}
 #rhythmTop{position:relative;display:block;height:clamp(62px,18vw,100px);flex:none;padding:0}
 #rhythmTitle{position:absolute;inset:0 46px 0 0;width:auto;height:100%;padding:0;font-size:0;line-height:0;overflow:visible;text-indent:-10000px}
 #rhythmTitle::before{inset:0;background-image:url('/assets/rhythm/title.png');background-size:contain;background-position:center}
 #rhythmSub{display:none}
 #rhythmClose{position:absolute;right:3px;top:6px;min-width:44px;padding:9px 8px;font-size:12px;background:rgba(31,17,67,.78);border:1px solid rgba(255,255,255,.22)}
 #rhythmBody{display:flex;flex-direction:column;gap:5px;min-height:0}
 #rhythmRank{flex:none;position:relative;padding:0;border:0;overflow:hidden;width:100%;height:auto;aspect-ratio:1080/300;min-height:0;border-radius:0;background:url('/assets/rhythm/ranking.png') center/100% 100% no-repeat;display:block}
 #rhythmRankHeader,#rhythmRankMini,#rhythmRewardBox,#rhythmGuide{display:none}
 #rhythmRankList{position:absolute;left:8.5%;right:8.5%;top:36%;height:33%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1.2%;margin:0;padding:0;list-style:none}
 #rhythmRankList li{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:0;background:transparent;border:0;text-align:center;line-height:1.15;min-width:0;overflow:hidden;text-shadow:0 1px 5px #311251}
 #rhythmRankList li em{font-size:clamp(8px,2.1vw,12px);font-weight:900;opacity:1;color:#fff6ba}
 #rhythmRankList li strong{font-size:clamp(8px,2vw,12px);font-weight:800;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
 #rhythmRankList li span{font-size:clamp(8px,2.1vw,12px);font-weight:900;color:#fff3ac}
 #rhythmMain{flex:1;min-height:0;border:0;border-radius:0;background-image:url('/assets/rhythm/play-area.png');background-repeat:no-repeat;background-position:center 54%;background-size:100% auto;background-color:transparent;overflow:hidden}
 #rhythmStats{left:8px;right:8px;top:5px;z-index:2}
 #rhythmStats div{padding:5px 4px;background:rgba(28,11,79,.7);border:1px solid rgba(243,166,255,.25);border-radius:12px}
 #rhythmStats b{font-size:9px}
 #rhythmStats span{font-size:clamp(17px,4.8vw,24px)}
 #rhythmJudge{z-index:3;top:11%;min-height:0;width:55%;height:clamp(58px,15vw,110px);background-size:contain;font-size:clamp(20px,6vw,36px);color:#fff;text-shadow:0 1px 4px #271042,0 0 8px #fa7bff}
 #rhythmComboFlash{top:25%;z-index:3}
 #rhythmCenter{z-index:4;bottom:4%;width:100%}
 #rhythmStart{width:min(78%,360px);height:clamp(52px,14vw,83px);padding:0;min-width:0;border:0;background-image:url('/assets/rhythm/start-button.png');background-position:center;background-size:100% 100%;background-repeat:no-repeat;background-color:transparent;font-size:0;color:transparent;box-shadow:none;text-shadow:none}
 #rhythmStart:active{transform:scale(.97)}
 #rhythmCenterButton{display:none}
 #rhythmHelp{margin-top:0;font-size:11px;line-height:1.3;font-weight:700;text-shadow:0 1px 5px #261147}
}
@media (min-width:901px){
 /* Desktop only: use background, round board and JUDGE artwork. */
 #rhythmTitle::before{display:none;background-image:none}
 #rhythmTitle{font-size:clamp(24px,2.3vw,40px);line-height:1.2;padding:2px 0;text-indent:0}
 #rhythmRank{background-image:none;background-color:rgba(12,14,35,.78);background-size:auto}
 #rhythmMain{background-image:none;background-color:rgba(11,9,35,.28);isolation:isolate}
 #rhythmMain::before{content:'';position:absolute;z-index:0;left:50%;top:52%;width:var(--rhythm-pc-board-size,640px);height:var(--rhythm-pc-board-size,640px);transform:translate(-50%,-50%);background:url('/assets/rhythm/play-area.png') center/contain no-repeat;pointer-events:none}
 #rhythmCanvas{z-index:1}
 #rhythmHud{z-index:2}
 #rhythmStart{background-image:linear-gradient(135deg,#ffe36d,#ff76c8);background-color:#ffe36d;background-size:100% 100%;font-size:18px;color:#241133;box-shadow:0 14px 30px rgba(0,0,0,.28)}
 #rhythmShell{padding:18px;gap:14px}
 #rhythmTop{padding:2px 2px 0}
 #rhythmSub{font-size:12px;max-width:none}
 #rhythmBody{grid-template-columns:minmax(280px,340px) 1fr;grid-template-rows:1fr;gap:16px}
 #rhythmRank{padding:16px;gap:12px;overflow:auto}
 #rhythmRankHeader h3{font-size:18px}
 #rhythmRankMini{font-size:12px}
 #rhythmRankList{display:flex;flex-direction:column;gap:8px}
 #rhythmRankList li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:10px 12px}
 #rhythmRankList li strong{font-size:14px}
 #rhythmRankList li span{font-size:14px}
 #rhythmRewardBox,#rhythmGuide{display:block;background:rgba(0,0,0,.22);border-radius:16px;padding:12px 13px;font-size:13px;line-height:1.45}
 #rhythmStats{left:18px;right:auto;top:18px;display:flex;gap:10px;flex-wrap:wrap}
 #rhythmStats div{padding:10px 14px;min-width:100px}
 #rhythmJudge{top:10%;min-width:min(38vw,360px)}
 #rhythmCenter{top:50%;bottom:auto;transform:translate(-50%,-50%);width:min(80vw,700px)}
 #rhythmHelp{margin-top:300px;font-size:14px}
 #rhythmStart{min-width:auto;padding:15px 28px}
 #rhythmCenterButton{font-size:16px}
}
`;
 document.head.append(style);
 const overlay=document.createElement('div');
 overlay.id='rhythmOverlay';
 overlay.innerHTML=`<div id="rhythmShell"><div id="rhythmTop"><div><div id="rhythmTitle">🥁 BEAT CIRCLE · 박자게임</div><div id="rhythmSub">모바일 세로 화면 기준 · 해변 오른쪽 벤치 옆 게임부스에서만 플레이 가능 · 스코어는 1판 기준 · 매일 초기화</div></div><button type="button" id="rhythmClose">닫기</button></div><div id="rhythmBody"><aside id="rhythmRank"><div id="rhythmRankHeader"><h3>오늘의 TOP 5</h3><div id="rhythmRankMini">오늘 최고 점수</div></div><ol id="rhythmRankList"></ol><div id="rhythmRewardBox"></div><div id="rhythmGuide"></div></aside><main id="rhythmMain"><canvas id="rhythmCanvas" width="1280" height="720"></canvas><div id="rhythmHud"><div id="rhythmStats"><div><b>SCORE</b><span id="rhythmScore">0</span></div><div><b>COMBO</b><span id="rhythmCombo">0</span></div><div><b>TIME</b><span id="rhythmTime">45.0</span></div></div><div id="rhythmJudge">READY</div><div id="rhythmComboFlash" aria-live="off"></div><div id="rhythmCenter"><button type="button" id="rhythmStart">게임 시작</button><button type="button" id="rhythmCenterButton">화면 아무 데나 터치해서 박자 맞추기</button><div id="rhythmHelp">움직이는 파란 원이 노란 판정 원에 딱 겹치는 순간 터치하세요.</div></div></div></main></div></div>`;
 document.body.append(overlay);
 const boothButton=document.createElement('button');
 boothButton.id='rhythmBoothButton';boothButton.type='button';boothButton.textContent='🥁 박자게임';document.body.append(boothButton);
 const hint=document.createElement('div');hint.id='rhythmBoothHint';document.body.append(hint);
 rhythmUi={
  overlay,boothButton,hint,
  canvas:overlay.querySelector('#rhythmCanvas'),ctx:overlay.querySelector('#rhythmCanvas').getContext('2d'),
  start:overlay.querySelector('#rhythmStart'),judge:overlay.querySelector('#rhythmJudge'),comboFlash:overlay.querySelector('#rhythmComboFlash'),
  score:overlay.querySelector('#rhythmScore'),combo:overlay.querySelector('#rhythmCombo'),time:overlay.querySelector('#rhythmTime'),
  centerBtn:overlay.querySelector('#rhythmCenterButton'),rankList:overlay.querySelector('#rhythmRankList'),reward:overlay.querySelector('#rhythmRewardBox'),guide:overlay.querySelector('#rhythmGuide')
 };
 overlay.querySelector('#rhythmClose').onclick=()=>closeRhythmGame();
 boothButton.onclick=()=>{if(!nearRhythmBooth())return toast('게임부스 근처에서만 열 수 있어요');openRhythmGame()};
 rhythmUi.start.onclick=()=>startRhythmGame();
 rhythmUi.centerBtn.onclick=()=>rhythmHit();
 overlay.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch'&&e.isPrimary===false){e.preventDefault();return;}
  if(e.target.closest('button')||e.target.closest('#rhythmRank'))return;
  if(rhythmGame.running){e.preventDefault();rhythmHit();}
 });
 // iOS Safari may ignore the viewport's user-scalable=no during rapid taps.
 // Block double-tap zoom / multi-touch pinch only while this game screen is open.
 overlay.addEventListener('touchstart',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});
 overlay.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});
 overlay.addEventListener('touchend',e=>{if(e.cancelable&&e.target===rhythmUi.canvas)e.preventDefault()},{passive:false});
 overlay.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
 overlay.addEventListener('dblclick',e=>e.preventDefault());
 window.addEventListener('resize',resizeRhythmCanvas);
 resizeRhythmCanvas();
 return rhythmUi;
}
function resizeRhythmCanvas(){
 if(!rhythmUi)return;
 const box=rhythmUi.canvas.getBoundingClientRect();
 const dpr=Math.min(2,window.devicePixelRatio||1);
 if(window.matchMedia('(min-width:901px)').matches){
  const boardSize=Math.max(200,Math.min(box.width,box.height)*.96);
  rhythmUi.overlay.querySelector('#rhythmMain').style.setProperty('--rhythm-pc-board-size',boardSize+'px');
 }
 const w=Math.max(640,Math.round(box.width*dpr));
 const h=Math.max(360,Math.round(box.height*dpr));
 if(rhythmUi.canvas.width!==w||rhythmUi.canvas.height!==h){
  rhythmUi.canvas.width=w;rhythmUi.canvas.height=h;
 }
}
function refreshRhythmReactionButton(){
 const btn=$('beatkingAction');
 if(!btn)return;
 const on=Boolean(state.me?.rhythmKing);
 btn.hidden=!on;
 if(on)btn.title='Y';
}
function updateRhythmLeaderboard(){
 ensureRhythmUI();
 const rows=Array.isArray(state.rhythm?.leaderboard)?state.rhythm.leaderboard:[];
 rhythmUi.rankList.replaceChildren();
 for(let i=0;i<5;i++){
  const row=rows[i];
  const li=document.createElement('li');
  const rank=document.createElement('em');rank.style.cssText='font-style:normal;font-weight:900;opacity:.76';rank.textContent=`${i+1}위`;const name=document.createElement('strong');name.textContent=row?row.name:'---';const score=document.createElement('span');score.textContent=row?Number(row.score).toLocaleString():'0';li.append(rank,name,score);
  rhythmUi.rankList.append(li);
 }
 const reward=state.rhythm?.reward;
 rhythmUi.reward.replaceChildren();const rewardHead=document.createElement('strong');rewardHead.textContent='오늘의 박자왕';rewardHead.style.cssText='display:block;margin-bottom:4px';const rewardBody=document.createElement('div');rewardBody.textContent=reward?`${reward.name} · 어제 최고기록 ${Number(reward.score).toLocaleString()}점`:'어제 1등 기록이 아직 없습니다.';rhythmUi.reward.append(rewardHead,rewardBody);if(reward){const extras=document.createElement('div');extras.style.cssText='margin-top:6px;font-size:12px;opacity:.8';extras.textContent='보상: 무지개 칭호 + 공주포즈 리액션';rhythmUi.reward.append(extras)}
 rhythmUi.guide.innerHTML=`<strong style="display:block;margin-bottom:4px">플레이 규칙</strong>점수는 누적이 아니라 <b>1판 최고 점수</b>만 반영됩니다.<br>매일 0시에 랭킹 초기화, <b>전날 1등 1명</b>에게만 다음날 칭호와 전용 리액션이 지급됩니다.`;
 refreshRhythmReactionButton();
}
function applyRhythmState(rhythm){
 if(!rhythm)return;
 state.rhythm={...state.rhythm,...rhythm};
 updateRhythmLeaderboard();
 updateRhythmBoothButton();
}
function updateRhythmBoothButton(){
 ensureRhythmUI();
 const near=nearRhythmBooth();
 rhythmUi.boothButton.classList.toggle('show',Boolean(state.id&&near&&!rhythmGame.open));
 rhythmUi.boothButton.disabled=!near;
 rhythmUi.boothButton.textContent='🎮 게임플레이';
 rhythmUi.hint.classList.remove('show');
}
function makeBeatPattern(){
 const sections=[[124,18],[132,16],[116,14],[142,18],[128,16]];
 let beats=[],time=1400;
 for(const [bpm,count] of sections){
  const interval=60000/bpm;
  for(let i=0;i<count;i++){beats.push({time,hit:false});time+=interval;}
 }
 return beats;
}
function updateRhythmScoreUi(){
 ensureRhythmUI();
 rhythmUi.score.textContent=Math.round(rhythmGame.score).toLocaleString();
 rhythmUi.combo.textContent=String(rhythmGame.combo);
 const remain=rhythmGame.running?Math.max(0,(rhythmGame.duration-(performance.now()-rhythmGame.startAt))/1000):rhythmGame.duration/1000;
 rhythmUi.time.textContent=remain.toFixed(1);
 rhythmUi.judge.textContent=rhythmGame.lastJudge;
 rhythmUi.judge.style.color=rhythmGame.lastJudgeColor||'#fff';
}
function openRhythmGame(){
 ensureRhythmUI();
 if(!nearRhythmBooth())return toast('게임부스 근처에서만 열 수 있어요');
 rhythmGame.open=true;
 rhythmUi.overlay.classList.add('show');
 selectBottomMenu('reaction');
 updateRhythmLeaderboard();
 resizeRhythmCanvas();
 drawRhythmGame();
}
function closeRhythmGame(){
 rhythmGame.open=false;
 rhythmGame.running=false;
 rhythmUi?.overlay.classList.remove('show');
}
function startRhythmGame(){
 ensureRhythmUI();
 rhythmGame.running=true;
 rhythmGame.startAt=performance.now();
 rhythmGame.score=0;rhythmGame.combo=0;rhythmGame.maxCombo=0;
 rhythmGame.perfect=0;rhythmGame.great=0;rhythmGame.good=0;rhythmGame.miss=0;
 rhythmGame.lastJudge='START!';rhythmGame.lastJudgeColor='#ffffff';
 rhythmGame.lastJudgeUntil=performance.now()+900;
 rhythmGame.beats=makeBeatPattern();
 rhythmGame.beatIndex=0;
 rhythmGame.endSubmitted=false;rhythmFx.bursts.length=0;rhythmFx.clickIndex=0;
 rhythmUi.start.hidden=true;rhythmUi.centerBtn.hidden=true;rhythmUi.overlay.querySelector('#rhythmHelp').hidden=true;
 updateRhythmScoreUi();
}
function judgeScore(diff){
 diff=Math.abs(diff);
 if(diff<=45)return ['PERFECT',1000,'#ffe676'];
 if(diff<=90)return ['GREAT',700,'#7df7ff'];
 if(diff<=160)return ['GOOD',300,'#ff97d8'];
 return ['MISS',0,'#ffffff'];
}
function rhythmHit(){
 if(!rhythmGame.open||!nearRhythmBooth())return;
 if(!rhythmGame.running){startRhythmGame();return;}
 const now=performance.now()-rhythmGame.startAt;
 let bestIndex=-1,bestDiff=Infinity;
 for(let i=Math.max(0,rhythmGame.beatIndex-2);i<rhythmGame.beats.length;i++){
  const beat=rhythmGame.beats[i];
  if(beat.hit)continue;
  const diff=now-beat.time;
  const ad=Math.abs(diff);
  if(ad<bestDiff){bestDiff=ad;bestIndex=i;}
  if(diff<-rhythmGame.beatWindow)break;
 }
 if(bestIndex===-1||bestDiff>rhythmGame.beatWindow){
  rhythmGame.combo=0;rhythmGame.miss++;
  rhythmGame.lastJudge='MISS';rhythmGame.lastJudgeColor='#ffffff';rhythmGame.lastJudgeUntil=performance.now()+550;
  updateRhythmScoreUi();
  return;
 }
 const beat=rhythmGame.beats[bestIndex];
 beat.hit=true;
 while(rhythmGame.beatIndex<rhythmGame.beats.length&&rhythmGame.beats[rhythmGame.beatIndex].hit)rhythmGame.beatIndex++;
 const [label,base,color]=judgeScore(now-beat.time);
 rhythmGame.lastJudge=label;rhythmGame.lastJudgeColor=color;rhythmGame.lastJudgeUntil=performance.now()+600;
 rhythmBurst(color,label);if(rhythmUi){rhythmUi.judge.classList.remove('judge-pop');void rhythmUi.judge.offsetWidth;rhythmUi.judge.classList.add('judge-pop')}rhythmClickSound(label==='PERFECT');
 if(base>0){
  rhythmGame.combo++;
  rhythmGame.maxCombo=Math.max(rhythmGame.maxCombo,rhythmGame.combo);
  const bonus=rhythmGame.combo*12;
  rhythmGame.score+=base+bonus;
  flashRhythmCombo();if(rhythmUi){const scoreWrap=rhythmUi.score.parentElement;scoreWrap.classList.remove('score-bump');void scoreWrap.offsetWidth;scoreWrap.classList.add('score-bump')}
  if(label==='PERFECT')rhythmGame.perfect++;
  else if(label==='GREAT')rhythmGame.great++;
  else rhythmGame.good++;
 }else{
  rhythmGame.combo=0;rhythmGame.miss++;
 }
 updateRhythmScoreUi();
}
function handleRhythmMisses(){
 if(!rhythmGame.running)return;
 const now=performance.now()-rhythmGame.startAt;
 while(rhythmGame.beatIndex<rhythmGame.beats.length){
  const beat=rhythmGame.beats[rhythmGame.beatIndex];
  if(beat.hit){rhythmGame.beatIndex++;continue;}
  if(now>beat.time+rhythmGame.beatWindow){
   beat.hit=true;rhythmGame.beatIndex++;rhythmGame.combo=0;rhythmGame.miss++;
   rhythmGame.lastJudge='MISS';rhythmGame.lastJudgeColor='#ffffff';rhythmGame.lastJudgeUntil=performance.now()+450;
  }else break;
 }
 if(now>=rhythmGame.duration+900)finishRhythmGame();
 updateRhythmScoreUi();
}
async function submitRhythmScore(){
 if(rhythmGame.endSubmitted||!state.id)return;
 rhythmGame.endSubmitted=true;
 try{
  const result=await post('rhythm',{id:state.id,command:'submit',score:Math.round(rhythmGame.score)});
  state.rhythmBest=Number(result.best)||Math.round(rhythmGame.score);
  applyRhythmState(result.rhythm);
  toast(`게임 종료! ${Math.round(rhythmGame.score).toLocaleString()}점 · 오늘 최고 ${state.rhythmBest.toLocaleString()}점`);
 }catch(error){toast(error.message||'랭킹 저장 실패');}
}
function finishRhythmGame(){
 if(!rhythmGame.running)return;
 rhythmGame.running=false;
 rhythmUi.start.hidden=false;rhythmUi.start.textContent='다시 도전하기';rhythmUi.centerBtn.hidden=false;rhythmUi.overlay.querySelector('#rhythmHelp').hidden=false;
 rhythmGame.lastJudge=`FINAL ${Math.round(rhythmGame.score).toLocaleString()}`;
 rhythmGame.lastJudgeColor='#ffe676';
 updateRhythmScoreUi();
 void submitRhythmScore();
}
function drawRhythmGame(){
 if(!rhythmUi||!rhythmGame.open)return;
 const ctx=rhythmUi.ctx,canvas=rhythmUi.canvas,w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);
 const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'rgba(17,24,42,.22)');bg.addColorStop(1,'rgba(2,4,9,.08)');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
 const cx=w*.5,cy=h*.52;
 const desktopRhythm=window.matchMedia('(min-width:901px)').matches;
 // On PC, the drawn timing rings line up with the supplied square board art.
 // The desktop-only board is 96% of the smaller dimension; its center target
 // is approximately 19% and its outer rim 45% of the board width.
 const boardPixels=Math.min(w,h)*.96;
 const targetR=desktopRhythm?boardPixels*.19:Math.min(w,h)*.125;
 // Preview rings start ~3.8x farther out, giving the player 2.1s to prepare.
 const outerR=desktopRhythm?boardPixels*.45:Math.min(w,h)*.47;
 const elapsed=rhythmGame.running?performance.now()-rhythmGame.startAt:0;
 if(rhythmGame.running){
  handleRhythmMisses();
  while(rhythmFx.clickIndex<rhythmGame.beats.length&&elapsed>=rhythmGame.beats[rhythmFx.clickIndex].time){rhythmClickSound(rhythmFx.clickIndex%4===0);rhythmFx.clickIndex++}
 }
 const nextBeat=rhythmGame.running?rhythmGame.beats.find(b=>!b.hit&&b.time-elapsed>=-rhythmGame.beatWindow):null;
 const dt=nextBeat?nextBeat.time-elapsed:Infinity;
 const hitNow=dt<=85&&dt>=-85;
 const soon=dt<=260&&dt>85;
 ctx.save();
 // Fixed, bold GOLD ring is the hit line. Only the BLUE incoming rings move.
 ctx.beginPath();ctx.arc(cx,cy,targetR+8,0,Math.PI*2);
 ctx.strokeStyle=hitNow?'#fff6ac':'#ffdb59';ctx.lineWidth=hitNow?19:12;
 ctx.shadowColor=hitNow?'#fff4ac':'#ffce48';ctx.shadowBlur=hitNow?36:16;ctx.stroke();ctx.shadowBlur=0;
 ctx.beginPath();ctx.arc(cx,cy,targetR+2,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=3;ctx.stroke();
 // Crosshair provides a fixed positional cue.
 ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=2;
 for(let i=0;i<4;i++){let a=i*Math.PI/2;ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*(targetR-13),cy+Math.sin(a)*(targetR-13));ctx.lineTo(cx+Math.cos(a)*(targetR+21),cy+Math.sin(a)*(targetR+21));ctx.stroke()}
 ctx.fillStyle=hitNow?'rgba(255,229,95,.32)':'rgba(255,215,95,.1)';ctx.beginPath();ctx.arc(cx,cy,targetR-7,0,Math.PI*2);ctx.fill();
 // Draw up to 5 incoming rings, from the edge of the visible board.
 if(rhythmGame.running){
  for(const beat of rhythmGame.beats){
   if(beat.hit)continue;
   const remain=beat.time-elapsed;
   if(remain<-rhythmGame.beatWindow||remain>RHYTHM_APPROACH_MS)continue;
   const progress=Math.max(0,Math.min(1,1-remain/RHYTHM_APPROACH_MS));
   const radius=outerR-(outerR-targetR)*progress;
   const alpha=.42+progress*.55;
   ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);
   ctx.strokeStyle=remain<0?'rgba(255,255,255,.35)':`rgba(99,220,255,${alpha})`;
   ctx.lineWidth=13+progress*5;
   ctx.shadowColor='#52d8ff';ctx.shadowBlur=14+progress*9;ctx.stroke();ctx.shadowBlur=0;
  }
 }
 const pulse=hitNow?1:Math.max(0,1-Math.abs(dt)/270);
 ctx.fillStyle=hitNow?'#ffffff':soon?'#fff1a4':'rgba(255,255,255,.93)';
 ctx.font=`900 ${Math.round(Math.min(w,h)*.055)}px sans-serif`;
 ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.shadowColor=hitNow?'#fff172':'#000';ctx.shadowBlur=hitNow?20:8;
 ctx.fillText(hitNow?'지금!':soon?'준비!':'HIT',cx,cy);
 ctx.shadowBlur=0;
 // Horizontal timing countdown: meter reaches 100% at the exact hit moment.
 if(nextBeat){
  const barW=Math.min(w*.58,660),barH=11,barX=cx-barW/2,barY=cy+targetR+48;
  const prog=Math.max(0,Math.min(1,1-dt/RHYTHM_APPROACH_MS));
  ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(barX,barY,barW,barH);
  ctx.fillStyle=hitNow?'#fff3a2':'#63dfff';ctx.fillRect(barX,barY,barW*prog,barH);
  ctx.font=`700 ${Math.round(Math.min(w,h)*.025)}px sans-serif`;
  ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillText('파란 원과 노란 원이 겹치면 터치!',cx,barY+38);
 }
 ctx.restore();
 const fxNow=performance.now();rhythmFx.bursts=rhythmFx.bursts.filter(p=>fxNow-p.born<p.life);for(const p of rhythmFx.bursts){const t=(fxNow-p.born)/1000,alpha=Math.max(0,1-(fxNow-p.born)/p.life);ctx.globalAlpha=alpha;ctx.fillStyle=p.color;const x=w*(p.x+p.vx*t*.16),y=h*(p.y+p.vy*t*.18+1.2*t*t*.08);ctx.save();ctx.translate(x,y);ctx.rotate(t*4);ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size);ctx.restore()}ctx.globalAlpha=1;
 ctx.fillStyle='rgba(255,255,255,.9)';ctx.textAlign='center';ctx.font=`900 ${Math.round(Math.min(w,h)*.03)}px sans-serif`;
 ctx.fillText('BEAT CIRCLE',cx,cy-outerR-20);
 ctx.font=`700 ${Math.round(Math.min(w,h)*.02)}px sans-serif`;
 if(!rhythmGame.running)ctx.fillText('시작 버튼을 눌러 도전하세요',cx,cy+targetR*1.85);
 if(!rhythmGame.running&&state.rhythmBest){ctx.fillText(`오늘 내 최고점 ${Number(state.rhythmBest).toLocaleString()}점`,cx,cy+targetR*2.25)}
}

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
   const r=await fetch('/api/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionKey,pageId,badgeIdentity,flagText:currentFlagText,flagImage:currentFlagImageData,name:state.me?.name||$('nick').value||'ROCKER',color:state.me?.color||chosenColor,gender:state.me?.gender||chosenGender,pattern:state.me?.pattern||chosenPattern,sash:state.me?.sash||chosenSash,hairStyle:state.me?.hairStyle||chosenHairStyle,hairColor:state.me?.hairColor||chosenHairColor})});
   if(!r.ok)throw Error('재접속 실패');const d=await r.json();
   const old=state.me;state.id=d.id;state.me=d.players.find(x=>x.id===d.id);currentFlagImageId=state.me?.flagImage||'';
   if(old){state.me.x=old.x;state.me.y=old.y;state.me.facing=old.facing;state.me.action=old.action;state.me.pose=old.pose;}
   state.players=new Map(d.players.map(x=>[x.id,x]));refreshProfilePreview();renderOnlinePlayers();listen();
   applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);
   applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);applyRhythmState(d.rhythm);if(d.crowdSurf)syncCrowdSurf(d.crowdSurf);
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
// YouTube search: display cards with safe textContent and enqueue through
// the same queue endpoint as pasted links (no new playback code).
let ytSearching=false;
function setYtSearchStatus(message){$('ytSearchStatus').textContent=message;}
async function searchYouTube(){
 if(ytSearching)return;
 if(!state.id){setYtSearchStatus('입장한 뒤 검색할 수 있어요.');return}
 const query=$('ytSearchInput').value.trim();
 if(query.length<2){setYtSearchStatus('두 글자 이상 입력해 주세요.');return}
 ytSearching=true;$('ytSearchButton').disabled=true;
 setYtSearchStatus('검색 중…');$('ytSearchResults').replaceChildren();
 try{
  const response=await fetch('/api/youtube-search?'+new URLSearchParams({id:state.id,q:query}),{cache:'no-store'});
  const payload=await response.json();
  if(!response.ok)throw Error(payload.error||'검색할 수 없어요.');
  const items=Array.isArray(payload.items)?payload.items:[];
  if(!items.length){setYtSearchStatus('검색 결과가 없어요. 다른 검색어를 입력해 보세요.');return}
  setYtSearchStatus(`${items.length}개의 영상 · 예약 버튼을 누르면 대기열에 등록돼요.`);
  const list=$('ytSearchResults');
  for(const item of items){
   const row=document.createElement('div');row.className='yt-search-item';
   const img=document.createElement('img');img.src=item.thumb;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
   const detail=document.createElement('div');detail.className='yt-search-item-text';
   const title=document.createElement('strong');title.textContent=item.title;
   const channel=document.createElement('small');channel.textContent=item.channel;
   detail.append(title,channel);
   const add=document.createElement('button');add.type='button';add.textContent='예약';
   add.onclick=async()=>{
    if(!state.id)return toast('입장 후 예약할 수 있어요.');
    add.disabled=true;add.textContent='등록 중';
    try{const d=await post('music',{id:state.id,command:'enqueue',url:'https://www.youtube.com/watch?v='+item.id});applyMusic(d.music,d.serverNow,d.queue,d.history);add.textContent='예약 완료';toast('음악을 예약했어요.');}
    catch(e){add.disabled=false;add.textContent='예약';toast(e.message)}
   };
   row.append(img,detail,add);list.append(row);
  }
 }catch(error){setYtSearchStatus(error.message||'검색 오류가 발생했습니다.');}
 finally{ytSearching=false;$('ytSearchButton').disabled=false}
}
$('ytSearchButton').addEventListener('click',searchYouTube);
$('ytSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchYouTube()}});
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
  const icon=makeBadgeImg(p.badgeTier);li.append(swatch,icon,name);
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

function listen(){state.es?.close();state.es=new EventSource('/api/events?id='+encodeURIComponent(state.id));state.es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='snapshot'){state.players=new Map(d.players.map(p=>[p.id,p]));$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);applyRhythmState(d.rhythm);syncCrowdSurf(d.crowdSurf);if(Array.isArray(d.chat)){$('chatMessages').replaceChildren();d.chat.forEach(appendChat)};for(const id of duoVfx.keys())removeDuoVfx(id);activeDuos.clear();for(const duo of d.interactions||[])activeDuos.set(duo.id,duo);syncDuoStatus()}else if(d.type==='join'){state.players.set(d.player.id,d.player);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers();if(d.player.id!==state.id)notice(d.player.name+' 들어왔습니다')}else if(d.type==='chat'){appendChat(d.entry);showBubble(d.entry)}else if(d.type==='move'){recordTrainLeader(d.player);state.players.set(d.player.id,d.player);if(d.player.id===state.id&&currentDuo())state.me={...d.player}}else if(d.type==='flag'){const player=state.players.get(d.id);if(player){player.flagText=d.flagText;player.flagImage=d.flagImage||'';}if(d.id===state.id&&state.me){state.me.flagText=d.flagText;state.me.flagImage=d.flagImage||'';currentFlagText=d.flagText;currentFlagImageId=d.flagImage||'';refreshFlagButton();}}else if(d.type==='badge'){const person=state.players.get(d.id);if(person){person.badgeTier=d.badgeTier;person.badgeSeconds=d.badgeSeconds;if(d.id===state.id&&state.me){state.me.badgeTier=d.badgeTier;state.me.badgeSeconds=d.badgeSeconds;}renderOnlinePlayers();}}else if(d.type==='profile'){state.players.set(d.player.id,d.player);if(d.player.id===state.id){state.me=d.player;refreshProfilePreview();refreshRhythmReactionButton();if(!$('punkShop').classList.contains('hidden')||!$('mdWardrobe').hidden)refreshPunkShop()}renderOnlinePlayers()}else if(d.type==='leave'){state.players.delete(d.id);$('online').textContent=d.count;updateCrowdCount(d.count);renderOnlinePlayers()}else if(d.type==='music')applyMusic(d.music,d.serverNow,d.queue,d.history);else if(d.type==='slam')applySlam(d.slam,d.cooldownUntil);else if(d.type==='slam-go')onSlamGo(d);else if(d.type==='slam-impact')spawnSlamDust(d.x,d.y);else if(d.type==='toast-spark')spawnToastSpark(d.x,d.y);else if(d.type==='cheer'&&d.playerId!==state.id&&state.audioEnabled)playCheer();else if(d.type==='rockplay')applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil);else if(d.type==='rockplay-go')onRockPlayGo(d);else if(d.type==='rockplay-cancel'){applyRockPlay(null,d.rockCooldowns,0);toast(d.reason||'인원이 부족해 취소됐어요.')} else if(d.type==='rhythm-state')applyRhythmState(d.rhythm);else if(d.type==='md-catalog')syncMdCatalog(d.items);else if(d.type==='music-booked')showBookingNotice(d.name,d.title);else if(d.type==='music-control')showMusicControlNotice(d.name,d.command);else if(d.type==='skip-vote')applySkipVote(d.vote,d.cooldownUntil);else if(d.type==='skip-vote-result')showSkipVoteResult(d);else if(d.type.startsWith('duo-'))handleDuoEvent(d)};state.es.onerror=()=>{ /* EventSource retries automatically; heartbeat repairs an expired session. */ }}
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
let joining=false;async function join(options={}){const auto=Boolean(options?.auto);if(editingProfile)return updateProfile();if(joining)return;joining=true;manualExit=false;try{let d=await post('join',{sessionKey,pageId,badgeIdentity,flagText:currentFlagText,flagImage:currentFlagImageData,name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender,pattern:chosenPattern,sash:chosenSash,hairStyle:chosenHairStyle,hairColor:chosenHairColor});state.id=d.id;state.me=d.players.find(p=>p.id===d.id);currentFlagImageId=state.me?.flagImage||'';state.pose=state.me?.pose||'stand';cameraFollowInitialized=false;state.players=new Map(d.players.map(p=>[p.id,p]));renderOnlinePlayers();refreshPunkShop();$('joinModal').classList.add('hidden');$('online').textContent=d.count;$('profileName').textContent=state.me.name;$('profileStatus').textContent='페스티벌 참가 중';$('avatarPreview').querySelector('b').style.background=chosenColor;saveProfile(state.me);applyMusic(d.music,d.serverNow,d.queue,d.history);applySkipVote(d.skipVote,d.skipVoteCooldownUntil);applySlam(d.slam,d.slamCooldownUntil);applyRockPlay(d.rockPlay,d.rockCooldowns,d.rockRunningUntil);applyRhythmState(d.rhythm);if(d.crowdSurf)syncCrowdSurf(d.crowdSurf);listen();$('audioModal').classList.add('hidden');setPersonalAudio(true);showMovementGuide();if(!auto)toast('ONEseason에 오신 것을 환영합니다!')}catch(e){if(auto)$('joinModal').classList.remove('hidden');$('joinError').textContent='입장 실패: '+(e?.message||'연결을 확인해주세요');console.error('ONEseason join error:',e)}finally{joining=false}}
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
};$('nick').onkeydown=e=>{if(e.key==='Enter')join()};function closeProfileEditor(){$('mdWardrobe').hidden=true;editingProfile=false;$('joinModal').classList.add('hidden');$('joinBtn').innerHTML='페스티벌 입장하기 <span>↗</span>';$('profileCancel').hidden=true;$('joinError').textContent=''}
async function updateProfile(){if(!state.id||!state.me)return;const button=$('joinBtn');if(button.disabled)return;button.disabled=true;button.textContent='저장 중…';try{
 const d=await post('profile',{id:state.id,name:$('nick').value.trim()||'ROCKER',color:chosenColor,gender:chosenGender,pattern:chosenPattern,sash:chosenSash,hairStyle:chosenHairStyle,hairColor:chosenHairColor});
 state.me=d.player;state.players.set(state.id,d.player);saveProfile(d.player);refreshProfilePreview();renderOnlinePlayers();closeProfileEditor();toast('캐릭터 설정을 변경했어요');
 }catch(e){$('joinError').textContent='변경 실패: '+e.message}finally{button.disabled=false;if(editingProfile)button.textContent='변경 사항 저장'}}
$('editAvatar').onclick=()=>{if(!state.me)return;editingProfile=true;$('nick').value=state.me.name;chosenColor=state.me.color;chosenPattern=state.me.pattern||'solid';chosenSash=state.me.sash||'none';chosenHairStyle=normalizeHairStyle(state.me.hairStyle);chosenHairColor=state.me.hairColor||'#4b3932';selectGender(state.me.gender);colorPicker();renderApparelPicker();renderHairPicker();$('joinError').textContent='';$('joinBtn').textContent='변경 사항 저장';$('profileCancel').hidden=false;$('joinModal').classList.remove('hidden');$('mdWardrobe').hidden=false;$('mdWardrobePanel').hidden=true;$('mdWardrobeToggle').setAttribute('aria-expanded','false');drawMdWardrobe();if(!matchMedia('(pointer:coarse)').matches)$('nick').focus()};
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
const sustainedReactions=new Set(['peace','jump','run','headbang','buriburi','groove','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','beatking','marshmallow','putyourhandsup','nightfirework','heartbow']);
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
  const chosen=(a==='glowstick'&&Boolean(state.me?.glowEnabled))||(a==='sit'&&state.pose==='sit')||(a==='lie'&&state.pose==='lie')||(!['sit','lie','glowstick'].includes(a)&&state.action===a);
  b.classList.toggle('active',chosen);
 });
}
function react(a,glowColor=null){
 if(!state.me)return;
 if(a==='glowstick'&&glowColor===null){openGlowstickPicker();return;}
 if(a==='glowstick'){state.me.glowColor=glowstickColors[glowColor]?glowColor:'rainbow';state.me.glowEnabled=true;updateActionButtons();sendMove();return;}
 if(a==='beatking'&&!state.me.rhythmKing)return toast('박자왕에게만 허용된 리액션입니다.');
 if(a==='nightfirework'&&!nightFireworkAvailable())return toast('폭죽놀이는 새벽 1시부터 4시까지만 사용할 수 있어요.');
 if(a==='marshmallow'&&!campfireReactionAvailable())return toast('모닥불이 켜진 시간(20:00~03:00)에 화덕 가까이에서 사용할 수 있어요.');
 if(currentDuo())return toast('상호작용을 종료한 후 다른 동작을 사용해 주세요.');
 if(slamMotion){slamMotion=null;state.walkTarget=null}if(rockMotion){rockMotion=null;state.walkTarget=null}state.benchTarget=null;
 if(a==='sit'||a==='lie'){
  const near=mats.some(m=>Math.hypot(state.me.x-m.x,state.me.y-m.y)<105)||benchSeats.some(b=>Math.hypot(state.me.x-b.x,state.me.y-b.y)<75)||Math.hypot(toWorld(state.me).x-CAMPFIRE_X,toWorld(state.me).z-CAMPFIRE_Z)<CAMPFIRE_REST_RADIUS;
  if(!near&&state.pose==='stand')return toast('돗자리·벤치·모닥불 근처에서 앉거나 누울 수 있어요');
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
  if((a==='jump'||a==='run'||a==='buriburi'||a==='groove'||a==='windmill'||a==='skanking'||a==='airguitar'||a==='headspin'||a==='cheer'||a==='smoke'||a==='bubblegun'||a==='freestyle'||a==='beatking'||a==='marshmallow'||a==='putyourhandsup'||a==='nightfirework'||a==='heartbow')&&state.pose!=='stand'){
   state.pose='stand';state.me.pose='stand';
  }
  state.action=a;state.me.action=a;if(a==='cheer')playCheer();
  state.actionUntil=sustainedReactions.has(a)?Infinity:performance.now()+(a==='peace'?2200:a==='snack'?3300:1750);
 }
 updateActionButtons();sendMove();
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>react(b.dataset.action));
// The glowsticks are independent equipped accessories; putyourhandsup is a separate looping animation.
const glowstickColors={red:'#ff294b',pink:'#ff4bda',blue:'#36a5ff',lime:'#9dff32',yellow:'#fff94b',white:'#f4fbff',rainbow:'#ffffff'};
const glowstickLabels={red:'빨강',pink:'핑크',blue:'파랑',lime:'연두',yellow:'노랑',white:'흰색',rainbow:'무지개'};
const glowstickButton=document.createElement('button');
glowstickButton.type='button';glowstickButton.dataset.action='glowstick';
glowstickButton.innerHTML='🌈 <span>야광봉 들기</span>';
glowstickButton.onclick=()=>react('glowstick');
$('reactionActions').append(glowstickButton);
const handsupButton=document.createElement('button');
handsupButton.type='button';handsupButton.dataset.action='putyourhandsup';
handsupButton.innerHTML='🙌 <span>풋쳐핸섭</span>';handsupButton.onclick=()=>react('putyourhandsup');
$('reactionActions').append(handsupButton);
const glowstickPicker=document.createElement('div');
glowstickPicker.id='glowstickPicker';glowstickPicker.className='glowstick-picker hidden';
glowstickPicker.setAttribute('role','dialog');glowstickPicker.setAttribute('aria-modal','true');glowstickPicker.setAttribute('aria-label','야광봉 색상 선택');
glowstickPicker.innerHTML='<div class="glowstick-panel"><h3>🌈 야광봉 색상 선택</h3><p>양손에 장착합니다. 춤과 다른 리액션 중에도 계속 들고 있어요.</p><div id="glowstickColors" class="glowstick-colors"></div><button type="button" id="glowstickCancel">취소</button></div>';
document.body.append(glowstickPicker);
for(const [key,hex] of Object.entries(glowstickColors)){
 const b=document.createElement('button');b.type='button';b.className='glowstick-choice';
 b.innerHTML='<i></i><span>'+glowstickLabels[key]+'</span>';
 const dot=b.querySelector('i');dot.style.background=key==='rainbow'?'conic-gradient(#fa3751,#f8e33c,#52e6a2,#46a3ff,#bf58f5,#fa3751)':hex;
 dot.style.boxShadow=key==='rainbow'?'0 0 14px #f7f8ff':'0 0 14px '+hex;
 b.onclick=()=>{glowstickPicker.classList.add('hidden');react('glowstick',key);};
 $('glowstickColors').append(b);
}
$('glowstickCancel').onclick=()=>glowstickPicker.classList.add('hidden');
glowstickPicker.addEventListener('pointerdown',e=>{if(e.target===glowstickPicker)glowstickPicker.classList.add('hidden');});
function openGlowstickPicker(){
 if(!state.me)return;
 if(currentDuo())return toast('상호작용을 종료한 후 사용해 주세요.');
 if(state.me.glowEnabled){state.me.glowEnabled=false;updateActionButtons();sendMove();return;}
 glowstickPicker.classList.remove('hidden');
}
const glowstickStyle=document.createElement('style');
glowstickStyle.textContent=`
.glowstick-picker{position:fixed;inset:0;z-index:310;display:grid;place-items:center;background:rgba(5,7,19,.79);padding:18px;overscroll-behavior:contain}
.glowstick-picker.hidden{display:none}
.glowstick-panel{width:min(440px,100%);max-height:90dvh;overflow:auto;padding:24px;border-radius:23px;background:#191a2d;color:white;border:1px solid #74718e;box-shadow:0 22px 68px #000b;text-align:center}
.glowstick-panel h3{margin:0;font-size:22px}.glowstick-panel p{margin:9px 0 22px;font-size:13px;color:#d6d7e6}
.glowstick-colors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.glowstick-choice{border:1px solid #575a77;border-radius:14px;background:#2b2e49;color:white;padding:13px 4px;min-height:84px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px}
.glowstick-choice i{width:29px;height:29px;border-radius:50%;display:block}.glowstick-choice span{font-size:12px;font-weight:800}
#glowstickCancel{margin-top:19px;background:#353a55;color:white;border:1px solid #656983;border-radius:12px;padding:12px 26px;font-weight:800}
@media(max-width:420px){.glowstick-colors{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
document.head.append(glowstickStyle);
const beatKingButton=document.createElement('button');beatKingButton.id='beatkingAction';beatKingButton.dataset.action='beatking';beatKingButton.hidden=true;beatKingButton.innerHTML='👑 <span>박자왕</span><em>Y</em>';beatKingButton.onclick=()=>react('beatking');$('reactionActions').append(beatKingButton);refreshRhythmReactionButton();
// The marshmallow action is local to the lit campfire, and is hidden elsewhere.
const marshmallowButton=document.createElement('button');
marshmallowButton.id='marshmallowAction';marshmallowButton.dataset.action='marshmallow';
marshmallowButton.innerHTML='🍡 <span>마시멜로 굽기</span>';
marshmallowButton.style.display='none';
marshmallowButton.onclick=()=>react('marshmallow');
$('reactionActions').append(marshmallowButton);
// v177: Night-only synchronized handheld fireworks reaction (01:00–04:00 KST).
const nightFireworkButton=document.createElement('button');
nightFireworkButton.type='button';
nightFireworkButton.dataset.action='nightfirework';
nightFireworkButton.innerHTML='🎆 <span>폭죽놀이</span>';
nightFireworkButton.style.display='none';
nightFireworkButton.onclick=()=>react('nightfirework');
$('reactionActions').append(nightFireworkButton);
const heartBowButton=document.createElement('button');
heartBowButton.type='button';
heartBowButton.dataset.action='heartbow';
heartBowButton.innerHTML='🏹 <span>하트활쏘기</span>';
heartBowButton.onclick=()=>react('heartbow');
$('reactionActions').append(heartBowButton);
const nightFireworkKST=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'});
function nightFireworkAvailable(){
 const hour=Number(nightFireworkKST.format(new Date()));
 return hour>=1&&hour<4;
}
function syncNightFirework(){
 const available=nightFireworkAvailable();
 nightFireworkButton.style.display=available?'':'none';
 if(state.me&&state.action==='nightfirework'&&!available){
  state.action='idle';state.me.action='idle';state.actionUntil=0;
  updateActionButtons();sendMove();
 }
}
setInterval(syncNightFirework,5000);
syncNightFirework();
// v174: Arrange reaction controls in the requested display order only.
// Keep data-action values, keyboard shortcuts and all existing onclick handlers intact.
const reactionMenuOrder=[
 'peace','wave','clap','putyourhandsup','cheer','jump','run','sit','lie',
 'drink','smoke','snack','toastStart','headbang','bubblegun','heartbow','glowstick',
 'flagAction','beatking','nightfirework','marshmallow'
];
const reactionMenu=$('reactionActions');
for(const key of reactionMenuOrder){
 const button=key==='toastStart'||key==='flagAction'||key==='beatking'
  ?(key==='beatking'?beatKingButton:$(key))
  :reactionMenu.querySelector(`[data-action="${key}"]`);
 if(button)reactionMenu.append(button);
}
function campfireReactionAvailable(){
 if(!state.me)return false;
 const wp=toWorld(state.me);
 const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
 return (h>=20||h<3)&&Math.hypot(wp.x-CAMPFIRE_X,wp.z-CAMPFIRE_Z)<=CAMPFIRE_REST_RADIUS;
}
let lastCampfireReactionAvailable=false;
function syncMarshmallowReaction(){
 const available=campfireReactionAvailable();
 marshmallowButton.style.display=available?'':'none';
 if(state.me&&state.action==='marshmallow'&&!available){
  state.action='idle';state.me.action='idle';state.actionUntil=0;
  updateActionButtons();sendMove();
 }
 lastCampfireReactionAvailable=available;
}
setInterval(syncMarshmallowReaction,300);

// Festival flag editor: text or cropped image, both synchronized across visitors.
let flagDialogMode='new',flagDialogBusy=false,flagEditorMode='text';
let flagSelectedImage=null,flagSelectedUrl='',flagCropX=0,flagCropY=0,flagCropZoom=1,flagCropPointer=null;
const flagCropCanvas=$('flagCropCanvas'),flagCropCtx=flagCropCanvas.getContext('2d');
function refreshFlagButton(){const b=$('flagAction');if(!b)return;const enabled=Boolean(currentFlagText||currentFlagImageId||currentFlagImageData);b.classList.toggle('active',enabled);b.setAttribute('aria-pressed',String(enabled));}
function closeFlagDialog(){if(flagDialogBusy)return;$('flagDialog').classList.add('hidden');$('flagTextInput').blur();$('flagImageInput').blur();}
function flagMode(mode){flagEditorMode=mode;$('flagModeText').classList.toggle('active',mode==='text');$('flagModeImage').classList.toggle('active',mode==='image');$('flagTextEditor').classList.toggle('hidden',mode!=='text');$('flagImageEditor').classList.toggle('hidden',mode!=='image');if(mode==='image')drawFlagCrop();}
function drawFlagCrop(){
 const ctx=flagCropCtx,w=flagCropCanvas.width,h=flagCropCanvas.height;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 if(!flagSelectedImage){ctx.fillStyle='#9aa0a6';ctx.font='bold 27px sans-serif';ctx.textAlign='center';ctx.fillText('사진을 선택해 주세요',w/2,h/2);return}
 const image=flagSelectedImage,cover=Math.max(w/image.naturalWidth,h/image.naturalHeight),scale=cover*flagCropZoom;
 const dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;
 const limX=Math.max(0,(dw-w)/2),limY=Math.max(0,(dh-h)/2);
 flagCropX=Math.max(-limX,Math.min(limX,flagCropX));flagCropY=Math.max(-limY,Math.min(limY,flagCropY));
 ctx.drawImage(image,(w-dw)/2+flagCropX,(h-dh)/2+flagCropY,dw,dh);
}
$('flagModeText').addEventListener('click',()=>flagMode('text'));
$('flagModeImage').addEventListener('click',()=>flagMode('image'));
$('flagImageInput').addEventListener('change',()=>{
 const f=$('flagImageInput').files?.[0];if(!f)return;
 if(f.size>8*1024*1024){toast('이미지는 8MB 이하로 선택해 주세요.');return}
 if(flagSelectedUrl)URL.revokeObjectURL(flagSelectedUrl);
 flagSelectedUrl=URL.createObjectURL(f);const img=new Image();
 img.onload=()=>{flagSelectedImage=img;flagCropX=0;flagCropY=0;flagCropZoom=1;$('flagZoom').value='1';drawFlagCrop();};
 img.onerror=()=>toast('이 이미지 형식은 브라우저에서 열 수 없습니다. JPG 또는 PNG로 바꿔 주세요.');
 img.src=flagSelectedUrl;
});
$('flagZoom').addEventListener('input',()=>{flagCropZoom=Number($('flagZoom').value);drawFlagCrop()});
flagCropCanvas.addEventListener('pointerdown',e=>{if(!flagSelectedImage)return;flagCropPointer={id:e.pointerId,x:e.clientX,y:e.clientY};flagCropCanvas.setPointerCapture(e.pointerId)});
flagCropCanvas.addEventListener('pointermove',e=>{if(!flagCropPointer||flagCropPointer.id!==e.pointerId)return;const rect=flagCropCanvas.getBoundingClientRect();flagCropX+=(e.clientX-flagCropPointer.x)*(flagCropCanvas.width/rect.width);flagCropY+=(e.clientY-flagCropPointer.y)*(flagCropCanvas.height/rect.height);flagCropPointer.x=e.clientX;flagCropPointer.y=e.clientY;drawFlagCrop()});
for(const name of ['pointerup','pointercancel','lostpointercapture'])flagCropCanvas.addEventListener(name,()=>{flagCropPointer=null});
function openFlagDialog(){
 if(!state.id)return toast('먼저 입장해 주세요.');
 flagDialogMode=(currentFlagText||currentFlagImageId||currentFlagImageData)?'remove':'new';
 const removing=flagDialogMode==='remove';
 $('flagDialogTitle').textContent=removing?'🏳️ 장대깃발 제거':'🏳️ 페스티벌 장대깃발';
 $('flagDialogDescription').textContent=removing?'지금 들고 있는 깃발을 없앨까요?':'검은 글씨 또는 내 이미지를 올릴 수 있어요. 이미지의 경우 위치와 확대를 조절하세요.';
 $('flagEditorControls').classList.toggle('hidden',removing);
 $('flagTextInput').value=removing?currentFlagText:'';
 $('flagConfirm').textContent=removing?'깃발 없애기':'깃발 들기';
 flagMode('text');$('flagDialog').classList.remove('hidden');
 if(!removing)requestAnimationFrame(()=>$('flagTextInput').focus());
}
$('flagAction').addEventListener('click',openFlagDialog);
$('flagCancel').addEventListener('click',closeFlagDialog);
$('flagDialog').addEventListener('click',e=>{if(e.target===$('flagDialog'))closeFlagDialog()});
$('flagTextInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('flagConfirm').click()}if(e.key==='Escape')closeFlagDialog()});
$('flagConfirm').addEventListener('click',async()=>{
 if(flagDialogBusy)return;
 const usingImage=flagDialogMode!=='remove'&&flagEditorMode==='image';
 const text=flagDialogMode==='remove'||usingImage?'':$('flagTextInput').value.trim().replace(/\s+/g,' ').slice(0,32);
 if(!usingImage&&flagDialogMode!=='remove'&&!text)return toast('깃발에 넣을 글씨를 입력해 주세요.');
 if(usingImage&&!flagSelectedImage)return toast('깃발에 넣을 이미지를 먼저 선택해 주세요.');
 let imageData='';
 if(usingImage){
  drawFlagCrop();
  imageData=flagCropCanvas.toDataURL('image/jpeg',.78);
  if(imageData.length>205000){imageData=flagCropCanvas.toDataURL('image/jpeg',.52)}
  if(imageData.length>205000)return toast('이미지 용량이 너무 큽니다. 다른 사진을 사용해 주세요.');
 }
 flagDialogBusy=true;$('flagConfirm').disabled=true;
 try{
  const response=await post('flag',{id:state.id,flagText:text,flagImage:imageData});
  currentFlagText=text;currentFlagImageId=response.flagImage||'';currentFlagImageData=imageData;
  try{
   if(text)localStorage.setItem(FLAG_STORAGE_KEY,text);else localStorage.removeItem(FLAG_STORAGE_KEY);
   if(imageData)localStorage.setItem(FLAG_IMAGE_STORAGE_KEY,imageData);else localStorage.removeItem(FLAG_IMAGE_STORAGE_KEY);
  }catch{toast('브라우저 저장 공간이 부족해 재접속 시 이미지가 유지되지 않을 수 있어요.')}
  if(state.me){state.me.flagText=text;state.me.flagImage=currentFlagImageId}
  if(state.players.has(state.id)){state.players.get(state.id).flagText=text;state.players.get(state.id).flagImage=currentFlagImageId}
  $('flagDialog').classList.add('hidden');$('flagTextInput').blur();$('flagImageInput').blur();refreshFlagButton();
  toast(text||imageData?'장대깃발을 들었어요!':'장대깃발을 제거했어요.');
 }catch(e){toast(e.message||'깃발 적용 실패')}
 finally{flagDialogBusy=false;$('flagConfirm').disabled=false}
});
refreshFlagButton();

// PC chat shortcut: Enter opens and focuses chat; Enter in the chat form sends.
document.addEventListener('keydown',e=>{
 if(rhythmGame.open)return;
 if(e.key!=='Enter'||e.repeat||e.isComposing||e.keyCode===229||!state.id||('ontouchstart' in window&&navigator.maxTouchPoints>1))return;
 if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target?.isContentEditable)return;
 if(e.ctrlKey||e.altKey||e.metaKey||e.shiftKey)return;
 const focused=e.target;
 if(focused?.closest?.('button, a, [role="button"], [role="dialog"], select'))return;
 if(!$('joinModal').classList.contains('hidden'))return;
 e.preventDefault();state.keys.delete('enter');selectBottomMenu('chat');$('chatInput').focus();
},true);
document.addEventListener('keydown',e=>{if(rhythmGame.open&&(e.key===' '||e.key==='Enter')){e.preventDefault();if(!e.repeat)rhythmHit();return}if(rhythmGame.open&&e.key==='Escape'){e.preventDefault();closeRhythmGame();return}if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target?.isContentEditable)return;let k=e.key.toLowerCase();if(k.startsWith('arrow')||k===' ')e.preventDefault();state.keys.add(k);let acts={'1':'peace','2':'jump','3':'run','4':'wave','5':'clap','6':'sit','7':'lie','8':'drink','9':'snack','0':'headbang','b':'buriburi','g':'groove','v':'windmill','k':'skanking','a':'airguitar','n':'headspin','h':'cheer','c':'smoke','u':'bubblegun','f':'freestyle','y':'beatking'};if(acts[k]&&!e.repeat)react(acts[k])});document.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>state.keys.clear());
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
function sendMove(){if(!state.id||!state.me||currentDuo())return;let p=state.me;post('move',{id:state.id,x:Math.round(p.x),y:Math.round(p.y),facing:p.facing,action:p.action,pose:p.pose||'stand',glowColor:p.glowColor||'lime',glowEnabled:Boolean(p.glowEnabled)}).catch(()=>{})}
// Shared SLAM countdown (server timestamps, 15 s global launch cooldown).
const slamButton=$('slamButton'),slamInfo=$('slamInfo'),slamMarker=$('slamMarker'),slamCount=$('slamCount'),slamMembers=$('slamMembers'),slamJoin=$('slamJoin');
function slamNow(){return Date.now()+state.serverDelta}
function refreshSlamUI(){
 const remain=Math.max(0,Math.ceil((slamCooldownUntil-slamNow())/1000));
 slamButton.disabled=!state.id||!!slam||!!rockPlay||slamNow()<rockRunningUntil||remain>0;
 slamButton.classList.toggle('placing',slamMode);
 slamButton.textContent=slamMode?'📍 바닥을 터치하세요':slam?'🔥 슬램 진행 중':remain?`🔥 슬램 ${remain}초`:'🔥 슬램 만들기';
 slamInfo.textContent=rockPlacementMode?(rockPlacementMode==='circle'?'써클핏 위치를 터치하세요':rockPlacementMode==='mosh'?'모싱 위치를 터치하세요':rockPlacementMode==='row'?'노젓기 위치를 터치하세요':rockPlacementMode==='shoulder'?'단체 어깨동무 위치를 터치하세요':rockPlacementMode==='surf'?'크라우드 서핑 위치를 터치하세요':'기차놀이 위치를 터치하세요'):rockPlay?(rockPlay.kind==='circle'?'써클핏 참가자를 모집 중이에요':rockPlay.kind==='mosh'?'모싱 참가자를 모집 중이에요':rockPlay.kind==='row'?'노젓기 참가자를 모집 중이에요':rockPlay.kind==='shoulder'?'단체 어깨동무 참가자를 모집 중이에요':rockPlay.kind==='toast'?'짠하기 참가자를 모집 중이에요':rockPlay.kind==='surf'?'크라우드 서핑 참가자를 모집 중이에요':'기차놀이 참가자를 모집 중이에요'):slamMode?'슬램 위치를 터치하세요':slam?'슬램 참가자를 모집 중이에요':remain?`다음 슬램까지 ${remain}초`:'락놀이 메뉴에서 크라우드 서핑·슬램·써클핏·기차놀이 등을 선택';
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
  const ry=clampServerY(ay+Math.sin(angle)*reach);
  slamMotion={phase:'charge',approach:{x:clampServerX(ax),y:clampServerY(ay)},retreat:{x:rx,y:ry},started:performance.now(),phaseStarted:performance.now()};
  state.walkTarget=null;state.benchTarget=null;
  state.pose='stand';state.me.pose='stand';state.action='slam-charge';state.actionUntil=Infinity;state.me.action='slam-charge';
  document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));
  sendMove();
 }
 slam=null;refreshSlamUI();
}
const rockMenuButton=$('rockMenuButton'),rockMenuPanel=$('rockMenuPanel'),circleButton=$('circleButton'),trainButton=$('trainButton'),moshButton=$('moshButton'),rowButton=$('rowButton'),shoulderButton=$('shoulderButton'),surfButton=$('surfButton');
rockMenuButton.onclick=()=>{const show=rockMenuPanel.classList.contains('hidden');rockMenuPanel.classList.toggle('hidden',!show);rockMenuButton.setAttribute('aria-expanded',String(show))};
function closeRockMenu(){rockMenuPanel.classList.add('hidden');rockMenuButton.setAttribute('aria-expanded','false')}
function refreshRockUI(){
 const now=slamNow(),occupied=!!rockPlay||!!slam||now<rockRunningUntil;
 for(const [button,kind,name] of [[circleButton,'circle','써클핏'],[trainButton,'train','기차놀이'],[moshButton,'mosh','모싱'],[rowButton,'row','노젓기'],[shoulderButton,'shoulder','단체 어깨동무'],[surfButton,'surf','크라우드 서핑']]){
   const remaining=Math.max(0,Math.ceil((rockCooldowns[kind]-now)/1000));
   button.disabled=!state.id||occupied||remaining>0;
   button.classList.toggle('placing',rockPlacementMode===kind);
   button.textContent=rockPlacementMode===kind?'📍 '+name+' 위치 선택':remaining?`⏱ ${name} ${remaining}초`:`${kind==='circle'?'🔄':kind==='mosh'?'🥊':kind==='row'?'🚣':kind==='shoulder'?'🫂':kind==='surf'?'🏄':'🚂'} ${name} 만들기`;
 }
}
function applyRockPlay(event,cooldowns,runningUntil){
 if(cooldowns&&typeof cooldowns==='object'){
  for(const kind of ['circle','train','mosh','row','toast','surf','shoulder'])if(Number.isFinite(Number(cooldowns[kind])))rockCooldowns[kind]=Number(cooldowns[kind]);
 }
 if(Number.isFinite(Number(runningUntil)))rockRunningUntil=Number(runningUntil);
 rockPlay=event||null;
 if(rockPlay)rockPlacementMode=null;
 refreshRockUI();refreshSlamUI();
}
function syncCrowdSurf(event){
 if(!event||event.kind!=='surf'||slamNow()>event.startAt+event.duration){crowdSurfScene=null;return}
 crowdSurfScene=event;
}
// Crowd surfing is a standalone choreography, NEVER a train/circle path.
// All clients derive the same position from a server-stamped start and participant origins.
const SURF_APPROACH_MS=3500, SURF_MOUNT_MS=500, SURF_RIDE_MS=10000;
function surfPoseAt(event,playerId,now=slamNow()){
 if(!event||event.kind!=='surf'||!event.participants?.includes(playerId))return null;
 const elapsed=Math.max(0,Math.min(event.duration,now-event.startAt));
 const supporters=event.participants.filter(pid=>pid!==event.riderId);
 const isRider=playerId===event.riderId;
 const index=supporters.indexOf(playerId);
 // Supporters occupy at most THREE places per row, filled CENTRE, LEFT, RIGHT.
 // After three, fill the centre of the back row, then its sides; the next
 // row (if needed) starts from the centre of the front row.
 const SURF_COLUMN_SPACING=31, SURF_ROW_SPACING=34;
 const slot=(n)=>{
  const row=Math.floor(n/3),column=n%3;
  const centreOut=[0,-1,1];
  const rowOrder=row===0?0:(row%2===1?Math.ceil(row/2):-row/2);
  return {x:centreOut[column]*SURF_COLUMN_SPACING,y:rowOrder*SURF_ROW_SPACING};
 };
 const groupOffsets=supporters.map((_,n)=>slot(n));
 const centre=groupOffsets.reduce((sum,v)=>({x:sum.x+v.x,y:sum.y+v.y}),{x:0,y:0});
 centre.x/=Math.max(1,groupOffsets.length);
 centre.y/=Math.max(1,groupOffsets.length);
 // Centre of support GROUP, rather than world origin or the first supporter.
 const midX=event.x+centre.x,midY=event.y+centre.y;
 const relative=groupOffsets[Math.max(0,index)]||{x:0,y:0};
 const goal=isRider?{x:midX,y:midY+25}:{x:event.x+relative.x,y:event.y+relative.y};
 const origin=event.origins?.[playerId]||{x:goal.x,y:goal.y};
 const travel=Math.min(1,elapsed/SURF_APPROACH_MS);
 // Slow ease-out still approaches on foot, with no altitude in this phase.
 const approach=travel*travel*(3-2*travel);
 let x=origin.x+(goal.x-origin.x)*approach;
 let y=origin.y+(goal.y-origin.y)*approach;
 const mounted=isRider&&elapsed>=SURF_APPROACH_MS;
 let mount=0,roll=0,rideProgress=0;
 if(mounted){
  mount=Math.min(1,(elapsed-SURF_APPROACH_MS)/SURF_MOUNT_MS);
  mount=mount*mount*(3-2*mount);
  rideProgress=Math.max(0,Math.min(1,(elapsed-SURF_APPROACH_MS-SURF_MOUNT_MS)/SURF_RIDE_MS));
  // ONE leisurely left-to-right-to-left cycle in 10 seconds, no orbit.
  // Barrel-roll angle follows the distance travelled, reversing as the
  // surfer changes direction (like a person rolling sideways on the ground).
  const wave=Math.sin(rideProgress*Math.PI*2);
  x=midX+wave*24;
  y=midY;
  // This is NOT a headspin/yaw. It is a long-axis sideways body roll.
  roll=-wave*Math.PI*3;

 }
 return {x,y,isRider,mounted,mount,rideProgress,roll,
  running:elapsed<SURF_APPROACH_MS,
  action:elapsed<SURF_APPROACH_MS?'run':isRider?'surf-rider':'surf-support',
  facing:isRider?0:Math.atan2(event.x-x,event.y-y)};
}
// v167: free-roaming train. The organiser steers; each carriage follows the
// travelled route, rather than an automatic figure-eight. Shared player move
// events update the path on every client, including mobile spectators.
function beginFreeTrain(event){
 const leaderId=event.leaderId||event.participants?.[0];
 const origin=event.origins?.[leaderId]||state.players.get(leaderId)||{x:event.x,y:event.y};
 const start=toWorld(origin),facing=Number(state.players.get(leaderId)?.facing??origin.facing)||0;
 const points=[];
 for(let n=24;n>=0;n--){
  points.push(serverFromWorld({x:start.x-Math.sin(facing)*n,z:start.z-Math.cos(facing)*n}));
 }
 freeTrainTrail={id:event.id,leaderId,points,lastAt:performance.now()};
}
function recordTrainLeader(player){
 const trail=freeTrainTrail;
 if(!trail||!player||player.id!==trail.leaderId)return;
 if(!rockMotion||rockMotion.kind!=='train'||rockMotion.id!==trail.id)return;
 const points=trail.points,last=points[points.length-1];
 const a=toWorld(last),b=toWorld(player);
 if(Math.hypot(a.x-b.x,a.z-b.z)>.18){
  points.push({x:player.x,y:player.y});
  if(points.length>1000)points.shift();
 }
 trail.lastAt=performance.now();
}
function trainCarriageTarget(index){
 const trail=freeTrainTrail;
 if(!trail)return null;
 const leader=state.players.get(trail.leaderId);
 if(leader)recordTrainLeader(leader);
 const pts=trail.points;
 if(!pts.length)return null;
 // Distances are measured in rendered-world units to avoid map Z distortion.
 let remaining=index*2.5;
 for(let i=pts.length-1;i>0;i--){
  const a=toWorld(pts[i]),b=toWorld(pts[i-1]);
  const dist=Math.hypot(a.x-b.x,a.z-b.z);
  if(dist>=remaining){
   const ratio=dist?remaining/dist:0;
   return serverFromWorld({x:a.x+(b.x-a.x)*ratio,z:a.z+(b.z-a.z)*ratio});
  }
  remaining-=dist;
 }
 return pts[0];
}
function onRockPlayGo(event){
 // Every client uses the same server timestamp for clink -> raise -> sip -> lower.
 if(event.kind==='toast')toastSequence={startAt:event.startAt,duration:event.duration,campfireToast:!!event.campfireToast,participants:[...(event.participants||[])]};
 if(event.kind==='shoulder')shoulderSequence={startAt:event.startAt,until:event.startAt+event.duration,participants:[...(event.participants||[])]};
 if(event.kind==='surf')syncCrowdSurf(event);
 if(event.kind==='train')beginFreeTrain(event);
 const participants=Array.isArray(event.participants)?event.participants:[];
 const index=participants.indexOf(state.id);
 if(index!==-1&&state.me){
   rockMotion={id:event.id,kind:event.kind,x:event.x,y:event.y,startAt:event.startAt,duration:event.duration,index,count:participants.length,campfireToast:!!event.campfireToast,riderId:event.riderId||participants[0],leaderId:event.leaderId||participants[0]};
   slamMotion=null;state.walkTarget=null;state.benchTarget=null;
   state.pose='stand';state.me.pose='stand';state.action=event.kind==='surf'?(state.id===event.riderId?'surf-rider':'surf-support'):event.kind==='mosh'?'mosh-charge':event.kind==='circle'?'circle-run':event.kind==='row'?'row-paddle':event.kind==='shoulder'?'walk':event.kind==='toast'?'toast-clink':'train-run';state.me.action=state.action;
   // Every moving group action now gathers smoothly, instead of teleporting
   // to its first animation point on the first frame.
   rockMotion.gatherFrom={x:state.me.x,y:state.me.y};
   if(event.kind==='train')toast(state.id===rockMotion.leaderId?'🚂 기차 선두! 키보드 또는 바닥 터치로 자유롭게 이동하세요':'🚂 선두를 따라가는 기차놀이가 시작됐어요');
   if(event.kind==='mosh'){const start={x:state.me.x,y:state.me.y};rockMotion.moshStart=start;rockMotion.moshDestination={x:event.x+(index-participants.length/2)*7,y:event.y};rockMotion.dustA=false;rockMotion.dustB=false;}
   state.actionUntil=Infinity;updateActionButtons();sendMove();
 }
 rockPlay=null;refreshRockUI();refreshSlamUI();
}
$('toastStart').onclick=async()=>{if(!state.id||!state.me)return toast('먼저 입장해 주세요');try{const d=await post('rockplay',{id:state.id,command:'start',kind:'toast',x:Math.max(25,Math.min(1375,state.me.x)),y:Math.max(255,Math.min(875,state.me.y))});applyRockPlay(d.event,d.rockCooldowns,d.rockRunningUntil);toast(d.event?.campfireToast?'🔥 모닥불 짠하기! 5초 동안 모집한 후 둘러서서 건배해요':'🥂 짠하기! 5초 동안 참가자를 모집합니다')}catch(e){toast(e.message)}};
for(const [button,kind] of [[circleButton,'circle'],[trainButton,'train'],[moshButton,'mosh'],[rowButton,'row'],[shoulderButton,'shoulder'],[surfButton,'surf']]){
 button.onclick=()=>{
   if(!state.id||rockPlay||slam||rockRunningUntil>slamNow()||rockCooldowns[kind]>slamNow())return;
   rockPlacementMode=rockPlacementMode===kind?null:kind;slamMode=false;
   closeRockMenu();refreshRockUI();refreshSlamUI();
   slamInfo.textContent=rockPlacementMode?`${kind==='circle'?'써클핏':kind==='mosh'?'모싱':kind==='row'?'노젓기':kind==='shoulder'?'단체 어깨동무':kind==='surf'?'크라우드 서핑':'기차놀이'} 장소를 터치하세요`:'락놀이 메뉴에서 선택해 주세요';
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
 // Run STRAIGHT THROUGH the selected marker, then turn around and come
 // back to that marker. No legacy retreat to the halfway point.
 // Same overall route length in half the time => approximately 2x speed.
 const fraction=Math.min(1,Math.max(0,elapsed/m.duration));
 const from=toWorld(m.moshStart||{x:state.me.x,y:state.me.y});
 const dest=toWorld(m.moshDestination||{x:m.x,y:m.y});
 const dx=dest.x-from.x,dz=dest.z-from.z;
 // Extend 50% of the start-to-target distance beyond the chosen position.
 const ahead={x:dest.x+dx*.5,z:dest.z+dz*.5};
 let point,dir;
 if(fraction<=.75){
  const t=fraction/.75;
  point={x:from.x+(ahead.x-from.x)*t,z:from.z+(ahead.z-from.z)*t};
  dir=1;
 }else{
  const t=(fraction-.75)/.25;
  point={x:ahead.x+(dest.x-ahead.x)*t,z:ahead.z+(dest.z-ahead.z)*t};
  dir=-1;
 }
 return {...serverFromWorld(point),dx:dx*dir,dy:dz*dir};
}
// Campfire cheers: approach a safe outer ring, walk around the fire,
// then step inward to the assigned standing spot. All routing uses WORLD
// coordinates because the audience extension stretches server Y unevenly.
function campfireToastGatherAt(m,elapsed,target){
 const center=toWorld({x:m.x,y:m.y});
 const from=toWorld(m.gatherFrom||{x:state.me.x,y:state.me.y});
 const dest=toWorld(target);
 const startDx=from.x-center.x,startDz=from.z-center.z;
 const destDx=dest.x-center.x,destDz=dest.z-center.z;
 const startAngle=Math.atan2(startDz,startDx);
 const endAngle=Math.atan2(destDz,destDx);
 const safeRadius=Math.max(6.2,Math.hypot(destDx,destDz)+1.3);
 const startRadius=Math.hypot(startDx,startDz);
 const stage=Math.max(0,Math.min(1,elapsed/3000));
 const ease=t=>{t=Math.min(1,Math.max(0,t));return t*t*(3-2*t)};
 let x,z;
 if(stage<.27){
  // Outward/inward radial travel stays on the user's original side of the fire.
  const r=startRadius+(safeRadius-startRadius)*ease(stage/.27);
  x=center.x+Math.cos(startAngle)*r;
  z=center.z+Math.sin(startAngle)*r;
 }else if(stage<.83){
  // Follow the outside of the stone ring, not a chord through its centre.
  const turn=Math.atan2(Math.sin(endAngle-startAngle),Math.cos(endAngle-startAngle));
  const angle=startAngle+turn*ease((stage-.27)/.56);
  x=center.x+Math.cos(angle)*safeRadius;
  z=center.z+Math.sin(angle)*safeRadius;
 }else{
  // Final short step toward the assigned position around the campfire.
  const alpha=ease((stage-.83)/.17);
  x=center.x+destDx*(alpha)+(1-alpha)*Math.cos(endAngle)*safeRadius;
  z=center.z+destDz*(alpha)+(1-alpha)*Math.sin(endAngle)*safeRadius;
 }
 return serverFromWorld({x,z});
}
function shoulderLineTarget(m){
 // Horizontal line across the audience, evenly spaced around the marker.
 // Convert offsets in WORLD units; 1.75 world units permits arms to meet.
 const centre=toWorld({x:m.x,y:m.y});
 const offset=(m.index-(m.count-1)*.5)*1.75;
 return serverFromWorld({x:centre.x+offset,z:centre.z});
}
function rockPathAt(m,elapsed){
 if(m.kind==='shoulder')return shoulderLineTarget(m);
 const elapsedFraction=Math.min(1,Math.max(0,elapsed/m.duration));
 if(m.kind==='row'){return groupWorldPathPoint(m,{x:m.x+(m.index%2===0?-21:21),y:m.y+Math.floor(m.index/2)*28-22,dx:0,dy:1})}
 if(m.kind==='toast'){
  const count=Math.max(1,m.count);
  const angle=2*Math.PI*m.index/count;
  // Special campfire cheers: everyone surrounds the actual fire, never its organiser.
  // Radius >= 4.9 world units leaves the stone ring and nearby cushions clear.
  const radius=m.campfireToast?Math.max(85,25/Math.sin(Math.PI/Math.max(2,count))):Math.max(42,21/Math.sin(Math.PI/Math.max(2,count)));
  const point={x:m.x+Math.sin(angle)*radius,y:m.y+Math.cos(angle)*radius,
   dx:-Math.sin(angle),dy:-Math.cos(angle)};
  return m.campfireToast?point:groupWorldPathPoint(m,point);
 }
 if(m.kind==='circle'){
   const angle=elapsedFraction*Math.PI*10 + m.index*2*Math.PI/Math.max(1,m.count);
   return groupWorldPathPoint(m,{x:m.x+Math.cos(angle)*115,y:m.y+Math.sin(angle)*115,dx:-Math.sin(angle),dy:Math.cos(angle)});
 }
 // Horizontal figure-eight, exactly four complete circuits of the entire path.
 // Wider participant phase offsets reduce crowd overlap while preserving the same figure-eight route and four circuits.
 const phase=elapsedFraction*Math.PI*8 - m.index*.42;
 return groupWorldPathPoint(m,{x:m.x+Math.sin(phase)*180,y:m.y+Math.sin(phase*2)*90,dx:180*Math.cos(phase),dy:180*Math.cos(phase*2)});
}
// Every completed rock-play (except the campfire's sit-down sequence) scatters
// from each participant's ACTUAL ending position while visibly skanking with 🤘.
// The shoulder-linked game keeps its own existing end behaviour.
function beginRockCelebration(m){
 const origin={x:state.me.x,y:state.me.y};
 const awayX=origin.x-m.x,awayY=origin.y-m.y;
 const count=Math.max(1,m.count);
 const laneAngle=-Math.PI/2+2*Math.PI*m.index/count;
 // Use a consistent outward route instead of pulling moving participants
 // back toward the original event centre before they can disperse.
 const radialAngle=Math.hypot(awayX,awayY)>12?Math.atan2(awayY,awayX):laneAngle;
 const angle=radialAngle+.18*Math.sin(m.index*2.4);
 const distance=m.kind==='circle'?100:Math.max(75,Math.min(112,66+count*5));
 m.scatterTarget={
  x:Math.max(20,Math.min(1380,origin.x+Math.cos(angle)*distance)),
  y:clampServerY(origin.y+Math.sin(angle)*distance)
 };
 m.phase='scatter';m.phaseStarted=performance.now();
 state.action='rock-skank';state.me.action='rock-skank';state.actionUntil=Infinity;
 state.moving=true;sendMove();
}
function finishRockMotion(){
 if(rockMotion?.kind==='train')freeTrainTrail=null;
 rockMotion=null;state.action='idle';state.me.action='idle';state.actionUntil=0;
 updateActionButtons();sendMove();
}
function updateRockPlayVisual(t){
 if(crowdSurfScene&&slamNow()>crowdSurfScene.startAt+crowdSurfScene.duration)crowdSurfScene=null;
 refreshRockUI();
 if(!rockPlay){rockFloorPath.visible=false;return}
 const remaining=rockPlay.endAt-slamNow();
 if(remaining<=0){rockFloorPath.visible=false;return}
 const world=toWorld(rockPlay),pos=new THREE.Vector3(world.x,3.6,world.z).project(camera);
 rockFloorPath.visible=rockPlay.kind!=='train';rockFloorPath.position.set(world.x,.09,world.z);
 rockFloorPath.rotation.y=0;
 rockFloorPath.geometry=rockPlay.kind==='row'||rockPlay.kind==='surf'||rockPlay.kind==='shoulder'?rockRowGeometry:rockPlay.kind==='circle'||rockPlay.kind==='mosh'||rockPlay.kind==='toast'?rockCircleGeometry:rockTrainGeometry;
 if(pos.z>=1||pos.z<=-1){slamMarker.hidden=true;return}
 slamMarker.hidden=false;
 slamCount.textContent=String(Math.max(1,Math.ceil(remaining/1000)));
 slamMembers.textContent=`${rockPlay.kind==='circle'?'써클핏':rockPlay.kind==='mosh'?'모싱':rockPlay.kind==='row'?'노젓기':rockPlay.kind==='shoulder'?'단체 어깨동무':rockPlay.kind==='toast'?'짠하기':rockPlay.kind==='surf'?'크라우드 서핑':'기차놀이'} · ${rockPlay.participants.length}명 참가`;
 const joined=rockPlay.participants.includes(state.id);
 slamJoin.disabled=joined;slamJoin.textContent=joined?'✓ 참가 완료':'참가하기';
 if(rockPlay.kind==='surf')slamMembers.textContent+=' · 2명 이상 필요';
 if(rockPlay.kind==='train')slamMembers.textContent+=' · 선두 자유 이동';
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
// v104: quality settings affect only graphics, never music, input, chat or server state.
const PERF_KEY='oneseason-render-quality-v104';
const perfMobile=matchMedia('(max-width:700px)').matches;
const perfWeakDevice=perfMobile||((navigator.deviceMemory||8)<=4)||((navigator.hardwareConcurrency||8)<=4);
// High-quality is the first-visit default. Persisted manual choices take precedence.
let perfMode='high';try{const saved=localStorage.getItem(PERF_KEY);if(['auto','eco','high'].includes(saved))perfMode=saved}catch{}
let perfAutoScale=1;
// v107: aggressive low-power mode for older tablets. A 0.40 pixel ratio
// uses roughly 31% as many pixels as the previous eco 0.72 setting.
const perfPresets={eco:{fps:20,pixel:.40,foreground:.36,shadows:false},balanced:{fps:45,pixel:1,foreground:.85,shadows:false},high:{fps:60,pixel:1.45,foreground:1.08,shadows:true}};
function effectivePerfPreset(){return perfMode==='eco'?perfPresets.eco:perfMode==='high'?perfPresets.high:(perfWeakDevice?perfPresets.eco:perfPresets.balanced)}
function performanceRatio(){return Math.max(.32,Math.min(1.45,effectivePerfPreset().pixel*perfAutoScale))}
const host=$('world');const scene=new THREE.Scene();scene.background=new THREE.Color('#78bfff');scene.fog=new THREE.FogExp2('#78bfff',.0068);
const camera=new THREE.PerspectiveCamera(56,1,.1,350);camera.position.set(0,27,39);
const renderer=new THREE.WebGLRenderer({antialias:!perfWeakDevice,powerPreference:perfWeakDevice?'low-power':'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,performanceRatio()));renderer.shadowMap.enabled=effectivePerfPreset().shadows&&!perfMobile;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
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
 stageForeground.setPixelRatio(Math.min(window.devicePixelRatio||1,effectivePerfPreset().foreground*perfAutoScale));
 stageForeground.outputColorSpace=THREE.SRGBColorSpace;
 stageForeground.setClearColor(0x000000,0);
 stageForeground.domElement.className='stage-avatar-foreground';
 stageForeground.domElement.style.pointerEvents='none';
 stageForeground.domElement.setAttribute('aria-hidden','true');
 host.appendChild(stageForeground.domElement);
}catch(error){console.warn('Foreground WebGL disabled:',error);stageForeground=null}
let perfTargetFrame=1000/effectivePerfPreset().fps;
let perfLastCheck=0,perfFrameSamples=0,perfFrameTotal=0,perfLastFrameTime=0;
function updatePerformanceButton(){
 const b=$('performanceToggle');if(!b)return;
 const label=perfMode==='eco'?'초절전':perfMode==='high'?'고화질':'자동';
 b.textContent='⚙ 화질 '+label;
 b.title='화질 변경: 자동 → 절전 → 고화질';
 b.setAttribute('aria-label','화질 '+label+' (누르면 변경)');
}
function applyPerformancePreset(){
 const preset=effectivePerfPreset();perfTargetFrame=1000/preset.fps;
 renderer.setPixelRatio(Math.min(devicePixelRatio,performanceRatio()));
 renderer.shadowMap.enabled=preset.shadows&&!perfMobile;
 if(stageForeground)stageForeground.setPixelRatio(Math.min(devicePixelRatio,Math.max(.30,preset.foreground*perfAutoScale)));
 // Keep lightweight sky/lighting selections in sync when the user changes modes.
 if(typeof updateEnvironment==='function')updateEnvironment(true);
 if(typeof resize==='function')resize();
 updatePerformanceButton();
}
$('performanceToggle')?.addEventListener('click',()=>{
 perfMode=perfMode==='auto'?'eco':perfMode==='eco'?'high':'auto';
 perfAutoScale=1;perfFrameSamples=0;perfFrameTotal=0;
 try{localStorage.setItem(PERF_KEY,perfMode)}catch{}
 applyPerformancePreset();
 toast('그래픽 화질: '+(perfMode==='auto'?'자동':perfMode==='eco'?'초절전 (20FPS)':'고화질'));
});
updatePerformanceButton();
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

// Simple same-browser punk wardrobe: server owns points, inventory and equipment.
let PUNK_SHOP_ITEMS=[
 ['tee-skull','💀','스컬 프린트 티셔츠',30,'shirt'],
 ['tee-lightning','⚡','번개 펑크 티셔츠',45,'shirt'],
 ['tee-anarchy','Ⓐ','언더그라운드 티셔츠',65,'shirt'],
 ['horns','😈','악마뿔 머리띠',80,'head'],
 ['spike-band','🤘','스파이크 머리띠',110,'head'],
 ['chain','⛓️','실버 체인 목걸이',55,'neck'],
 ['choker','🖤','스파이크 초커',95,'neck'],
 ['bat-glasses','🦇','배트 선글라스',90,'eyes'],
 ['fallen-wings','🪽','타락천사 날개',300,'back'],
 ['devil-tail','😈','악마 꼬리',150,'tail'],
 ['headset','🎧','락 페스티벌 헤드셋',170,'ears'],
 ['flame-glasses','🔥','불꽃 선글라스',110,'eyes'],
 ['bat-wing-band','🦇','박쥐날개 머리띠',140,'head'],
 ['heart-band','💗','하트 머리띠',100,'head'],
 ['round-glasses','👓','둥근 안경',80,'eyes'],
 ['back-guitar','🎸','등에 메는 기타',220,'back'],
 ['angel-wings','🤍','천사 날개',280,'back']
];
let mdCatalog={}, mdCatalogSignature='';
function syncMdCatalog(items){
 if(!items)return;
 const signature=JSON.stringify(items);
 if(mdCatalogSignature===signature)return;
 mdCatalogSignature=signature;mdCatalog=items;
 // Rebuild existing avatar shirt meshes only when the catalog really changes.
 for(const avatar of avatars.values())disposeAvatar(avatar.root);
 avatars.clear();
 PUNK_SHOP_ITEMS=Object.entries(items).map(([id,item])=>[id,({'shirt':'👕','head':'😈','neck':'⛓️','eyes':'🦇','back':'🪽','tail':'😈','ears':'🎧'}[item.slot]||'✨'),item.name,item.cost,item.slot]);
 drawPunkShop();drawMdWardrobe();
}
let punkWallet=null,punkShopBusy=false,povEnabled=false,povYaw=0,povPitch=0;
async function refreshPunkShop(){
 if(!state.id)return;
 try{const r=await post('shop',{id:state.id,command:'status'});punkWallet=r.shop;syncMdCatalog(r.shop.items);drawPunkShop();drawMdWardrobe()}
 catch(e){toast('상점 정보를 불러오지 못했습니다: '+e.message)}
}
// v148: front-facing snapshots rendered from the very same THREE avatar model
// as the playable character. A single reusable WebGL context avoids one GPU
// context per merchandise card. Only uploaded shirt artwork stays 2D.
const mdPreviewCache=new Map();
let mdPreviewRenderer=null,mdPreviewScene=null,mdPreviewCamera=null;
let mdPreviewQueue=Promise.resolve();
function mdPreviewSignature(id,slot){
 const p=state.me||{};
 return JSON.stringify([id,slot,p.gender||chosenGender,p.color||chosenColor,p.hairStyle||chosenHairStyle,p.hairColor||chosenHairColor,mdCatalogSignature]);
}
function mdPreviewTarget(id,slot,emoji,name){
 const visual=document.createElement('div');visual.className='md-model-preview';
 if(slot==='shirt'){
  visual.classList.add('md-flat-preview');
  if(mdCatalog[id]?.imageUrl){
   const img=document.createElement('img');img.src=mdCatalog[id].imageUrl;img.alt=name+' 업로드 이미지';img.loading='lazy';visual.append(img);
  }else{
   // Built-in shirts have no uploaded image. Preserve their original icon.
   visual.textContent=emoji;
  }
  return visual;
 }
 const canvas=document.createElement('canvas');canvas.width=200;canvas.height=174;
 canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' 정면 3D 착용 모습');
 const ctx=canvas.getContext('2d');
 visual.append(canvas);
 // Avoid creating dozens of offscreen avatars while both MD panels are closed.
 if($('punkShop').classList.contains('hidden')&&$('mdWardrobePanel').hidden)return visual;
 const key=mdPreviewSignature(id,slot);
 const cached=mdPreviewCache.get(key);
 if(cached){ctx.drawImage(cached,0,0,200,174);return visual;}
 // Defer work and serialize it to keep rendering smooth on mobile.
 mdPreviewQueue=mdPreviewQueue.catch(()=>{}).then(async()=>{
  if(!canvas.isConnected)return;
  const cachedNow=mdPreviewCache.get(key);
  if(cachedNow){ctx.drawImage(cachedNow,0,0,200,174);return;}
  try{
   const p=state.me||{};
   const hairStyle=normalizeHairStyle(p.hairStyle||chosenHairStyle||'basic-short');
   if(!['basic-short','basic-bob'].includes(hairStyle))await getHairAsset(hairStyle).catch(()=>{});
   if(!canvas.isConnected)return;
   if(!mdPreviewRenderer){
    mdPreviewRenderer=new THREE.WebGLRenderer({alpha:true,antialias:!perfWeakDevice,powerPreference:'low-power'});
    mdPreviewRenderer.setSize(200,174,false);mdPreviewRenderer.setPixelRatio(1);
    mdPreviewRenderer.outputColorSpace=THREE.SRGBColorSpace;
    mdPreviewScene=new THREE.Scene();mdPreviewScene.background=new THREE.Color('#1b2538');
    mdPreviewScene.add(new THREE.HemisphereLight('#eef5ff','#62718d',2.3));
    const keyLight=new THREE.DirectionalLight('#ffffff',2.4);keyLight.position.set(-3,7,6);mdPreviewScene.add(keyLight);
    mdPreviewCamera=new THREE.PerspectiveCamera(35,200/174,.1,60);
    mdPreviewCamera.position.set(0,2.3,8.3);mdPreviewCamera.lookAt(0,1.77,0);
    mdPreviewCamera.layers.enable(1);
   }
   // Preview only the selected item, without equipping or purchasing it.
   const person={...p,id:'md-preview',name:'',gender:p.gender||chosenGender,
     color:p.color||chosenColor,hairStyle:hairStyle,hairColor:p.hairColor||chosenHairColor,
     equipped:{[slot]:id},flagText:'',flagImage:'',badgeTier:'none',sash:'none',pattern:'solid'};
   const avatar=makeAvatar(person),root=avatar.root;
   mdPreviewScene.add(root);
   // Give cached imported-hair assets a microtask to attach before capture.
   await Promise.resolve(); // moves the root out of the live game scene
   const tag=avatar.parts?.tag;if(tag)tag.visible=false;
   if(avatar.parts?.flagGroup)avatar.parts.flagGroup.visible=false;
   root.rotation.set(0,0,0);
   root.updateMatrixWorld(true);
   try{
    mdPreviewRenderer.render(mdPreviewScene,mdPreviewCamera);
    const image=document.createElement('canvas');image.width=200;image.height=174;
    image.getContext('2d').drawImage(mdPreviewRenderer.domElement,0,0);
    mdPreviewCache.set(key,image);
    if(canvas.isConnected)ctx.drawImage(image,0,0);
   }finally{
    mdPreviewScene.remove(root);disposeAvatar(root);
   }
  }catch(err){console.warn('3D MD 미리보기 오류:',id,err);if(canvas.isConnected)visual.textContent=emoji;}
 });
 return visual;
}
function drawPunkShop(){
 const root=$('punkShopGrid');if(!root)return;root.replaceChildren();
 const wallet=punkWallet||{points:0,earned:0,owned:[],equipped:{}};
 $('punkPoints').textContent=wallet.points.toLocaleString()+' P';$('punkEarned').textContent='누적 '+wallet.earned.toLocaleString()+' P · 구매 포인트 환불 적용';
 for(const [id,emoji,title,cost] of PUNK_SHOP_ITEMS){
  const owned=wallet.owned.includes(id);
  const card=document.createElement('article');card.className='punk-item';
  const visual=mdPreviewTarget(id,mdCatalog[id]?.slot||PUNK_SHOP_ITEMS.find(row=>row[0]===id)?.[4],emoji,title);
  const name=document.createElement('strong');name.textContent=title;
  const price=document.createElement('small');price.textContent='테스트 무료 · '+(owned?'착용 가능':cost+' P 상품');
  const button=document.createElement('button');button.type='button';button.disabled=punkShopBusy;
  button.textContent='무료 체험 · 착용은 꾸미기에서';
  button.onclick=async()=>{
   if(punkShopBusy||!state.id)return;
   punkShopBusy=true;drawPunkShop();
   try{const d=await post('shop',{id:state.id,command:'buy',item:id});punkWallet=d.shop;
    toast(title+' 테스트 이용 가능! 내 설정 → MD 사용하기에서 장착하세요.');
   }catch(e){toast(e.message)}finally{punkShopBusy=false;drawPunkShop()}
  };
  card.append(visual,name,price,button);root.append(card);
 }
}
function drawMdWardrobe(){
 const container=$('mdWardrobeGrid');if(!container)return;container.replaceChildren();
 const wallet=punkWallet||{owned:[],equipped:{}};
 const ownedItems=PUNK_SHOP_ITEMS; // v114: all items usable during testing
 if(!ownedItems.length){const empty=document.createElement('p');empty.textContent='등록된 MD 아이템이 없습니다.';container.append(empty);return}
 for(const [id,emoji,name,cost,slot] of ownedItems){
  const wearing=wallet.equipped?.[slot]===id;
  const card=document.createElement('div');card.className='md-wardrobe-entry';
  const visual=mdPreviewTarget(id,slot,emoji,name);
  const title=document.createElement('strong');title.textContent=emoji+' '+name;
  const line=document.createElement('small');line.textContent=({'shirt':'티셔츠 위에 표시','head':'머리 장식','neck':'목 장식','eyes':'안경','back':'등 장식','tail':'꼬리 장식','ears':'헤드셋'}[slot]||'장식');
  const btn=document.createElement('button');btn.type='button';btn.textContent=wearing?'벗기':'입기';btn.disabled=punkShopBusy;
  btn.onclick=async()=>{if(punkShopBusy||!state.id)return;punkShopBusy=true;drawMdWardrobe();
   try{const d=await post('shop',{id:state.id,command:wearing?'unequip':'equip',item:id});punkWallet=d.shop;
    toast(name+(wearing?' 해제':' 장착')+' 완료');
   }catch(e){toast(e.message)}finally{punkShopBusy=false;drawMdWardrobe()}
  };
  card.append(visual,title,line,btn);container.append(card);
 }
}
async function bootstrapMdCatalog(){
 try{const r=await fetch('/api/md-catalog');if(r.ok){const d=await r.json();syncMdCatalog(d.items)}}catch{}
}
bootstrapMdCatalog();
function openPunkShop(){if(!state.id)return toast('입장 후 MD샵을 이용할 수 있어요');$('punkShop').classList.remove('hidden');refreshPunkShop()}
$('punkShopClose').onclick=()=>$('punkShop').classList.add('hidden');
$('punkShop').addEventListener('click',e=>{if(e.target===$('punkShop'))$('punkShop').classList.add('hidden')});
$('mdWardrobeToggle').onclick=()=>{const panel=$('mdWardrobePanel');panel.hidden=!panel.hidden;$('mdWardrobeToggle').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)refreshPunkShop()};
$('povToggle').onclick=()=>{
 povEnabled=!povEnabled;povYaw=0;povPitch=0;
 controls.enabled=!povEnabled;
 $('povToggle').setAttribute('aria-pressed',String(povEnabled));
 $('povToggle').textContent=povEnabled?'👁 3인칭':'👁 POV';
 cameraFollowInitialized=false;
 if(!povEnabled&&state.me){
  // Restore the third-person camera around the avatar's head, including
  // the elevation of the expanded stage and its entrance steps.
  getLocalHeadFocus(cameraFocus);
  controls.target.copy(cameraFocus);
  camera.position.set(cameraFocus.x,cameraFocus.y+6.45,cameraFocus.z+13);
  camera.lookAt(controls.target);
 }
 toast(povEnabled?'POV: 1인칭 시점 · 드래그로 시선 조절':'3인칭 시점');
};
let povPointer=null;
gameTouchSurface.addEventListener('pointerdown',e=>{if(!povEnabled)return;povPointer={id:e.pointerId,x:e.clientX,y:e.clientY};});
gameTouchSurface.addEventListener('pointermove',e=>{
 if(!povEnabled||!povPointer||e.pointerId!==povPointer.id)return;
 if(e.buttons===0&&e.pointerType==='mouse')return;
 const dx=e.clientX-povPointer.x,dy=e.clientY-povPointer.y;
 if(Math.abs(dx)+Math.abs(dy)>0){povYaw=Math.max(-Math.PI,Math.min(Math.PI,povYaw-dx*.005));povPitch=Math.max(-.95,Math.min(.9,povPitch-dy*.003));}
 povPointer.x=e.clientX;povPointer.y=e.clientY;
});
for(const ev of ['pointerup','pointercancel'])gameTouchSurface.addEventListener(ev,()=>povPointer=null);
// Exact world-space head position (after stage elevation / stairs animation).
// Using the rendered avatar avoids a mismatch between visual stage height and
// camera height. Fall back to the same stage-height function during join.
const headFocusScratch=new THREE.Vector3();
function getLocalHeadFocus(out){
 const a=avatars.get(state.id);
 if(a?.parts?.head){
  a.root.updateWorldMatrix(true,true);
  a.parts.head.getWorldPosition(out);
  return out;
 }
 const w=toWorld(state.me);
 return out.set(w.x,2.6+stageWalkHeightAt(w.x,w.z),w.z);
}
function updatePovCamera(){
 if(!povEnabled||!state.me)return;
 const head=getLocalHeadFocus(headFocusScratch);
 const yaw=(state.me.facing||0)+povYaw;
 // Eye level is relative to the animated head, not to the ground at y=0.
 // This keeps POV at eye height on the stage and while using the stairs.
 const eyeY=head.y-.04;
 camera.position.set(head.x,eyeY,head.z);
 const dx=Math.sin(yaw)*Math.cos(povPitch),dy=Math.sin(povPitch),dz=Math.cos(yaw)*Math.cos(povPitch);
 camera.lookAt(head.x+dx*15,eyeY+dy*15,head.z+dz*15);
}

const BADGE_INFO={
 bronze:['브론즈',0],silver:['실버',3600],gold:['골드',18000],
 platinum:['플래티넘',54000],diamond:['다이아',144000],crown:['왕관',360000]
};

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
 // The expanded apron must not act as an invisible camera wall: keep the
 // original audience-side zoom range and collision boundary from v127.
 if(hit&&controls.target.distanceToSquared(hit)<distance*distance){
  const room=controls.target.distanceTo(hit)-.8;
  if(room>=.6){
   const safe=controls.target.clone().addScaledVector(cameraOffset,Math.max(.9,room));
   camera.position.lerp(safe,.65);
  }
 }
 // Behind the stage, the camera must not zoom past the stage video/screen.
 // Clamp only views from behind (negative Z), leaving audience-side zoom free.
 // The screen sits at z=-29.12 and its stage wall at roughly z=-31.
 const screenRearLimit=-30.15;
 if(cameraOffset.z<-.06&&controls.target.z>screenRearLimit&&camera.position.z<screenRearLimit){
  const dz=camera.position.z-controls.target.z;
  if(Math.abs(dz)>.001){
   const fraction=(screenRearLimit-controls.target.z)/dz;
   if(fraction>0&&fraction<1){
    camera.position.copy(controls.target).addScaledVector(cameraOffset,distance*fraction);
   }
  }
 }
 camera.lookAt(controls.target);
}

// Keep the local avatar in the center while preserving camera orbit and zoom.
const cameraFocus=new THREE.Vector3();let cameraFollowInitialized=false;
function followLocalAvatar(){
 if(!state.me)return;
 // Third-person tracking is anchored to the avatar's actual head, rather
 // than a fixed world Y. Ascending the stage raises both orbit center and
 // camera together; a damped delta prevents an abrupt jump on stair edges.
 getLocalHeadFocus(cameraFocus);
 const strength=cameraFollowInitialized?0.18:1;
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
// v128: keep the original backdrop, but add a front apron and two approach
// stairs so visitors can actually walk onto the highlighted stage zone.
cube(45,1.7,14,dark,0,1,-25);
cube(19.2,1.72,7.9,dark,0,.96,-14.15); // walkable front apron (red marked zone)
cube(21.2,.28,8.3,metal,0,1.86,-14.15);
for(const sx of [-3.7,3.7]){
 for(let i=0;i<4;i++){
  const depth=1.02;
  const stepZ=-9.0-i*0.78;
  const stepY=.18+i*.23;
  cube(3.1,.34,depth,metal,sx,stepY,stepZ);
 }
}
cube(47,1.2,1,metal,0,2.05,-17.3);cube(46,1.5,1,dark,0,13.8,-31);cube(1,13.8,1,metal,-22,7.8,-31);cube(1,13.8,1,metal,22,7.8,-31);cube(46,11.8,.6,dark,0,7.2,-31);
const sign=new THREE.Mesh(new THREE.PlaneGeometry(24,1.6),label('ONEseason',78,'#dcfd8b','#18172e'));sign.position.set(0,13.9,-29.85);scene.add(sign);

// v143: 13:00, 14:00 and 15:00 KST festival firetruck water shows.
// Entirely client-rendered and time-gated, so visitors see the same event
// without extra server polling, database writes or additional asset files.
const firetruckShow=new THREE.Group();scene.add(firetruckShow);
firetruckShow.position.set(35,0,-12.5);
firetruckShow.scale.set(1.38,1.38,1.38);
firetruckShow.visible=false;
const truckRed=new THREE.MeshStandardMaterial({color:'#b8212e',metalness:.24,roughness:.44});
const truckDeepRed=new THREE.MeshStandardMaterial({color:'#861c27',metalness:.2,roughness:.5});
const truckWhite=new THREE.MeshStandardMaterial({color:'#f2f1ec',roughness:.56});
const truckSilver=new THREE.MeshStandardMaterial({color:'#a8b8c3',metalness:.65,roughness:.29});
const truckGlass=new THREE.MeshStandardMaterial({color:'#537b92',metalness:.28,roughness:.24});
const truckRubber=new THREE.MeshStandardMaterial({color:'#20242b',roughness:.98});
const truckLamp=new THREE.MeshBasicMaterial({color:'#ef384a'});
function firetruckBox(w,h,d,x,y,z,material){
 const obj=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
 obj.position.set(x,y,z);obj.castShadow=false;obj.receiveShadow=true;firetruckShow.add(obj);return obj;
}
// Length is along X: the front of the cab points toward the stage (negative X).
firetruckBox(8.7,.52,3.45,0,.90,0,truckDeepRed);
firetruckBox(5.05,2.65,3.3,1.72,2.42,0,truckRed); // water tank
firetruckBox(3.2,2.7,3.2,-2.73,2.30,0,truckRed); // cab
firetruckBox(.16,1.25,2.65,-4.38,2.70,0,truckGlass); // windshield
for(const side of [-1,1]){
 firetruckBox(1.05,1.0,.08,-2.8,2.85,side*1.64,truckGlass);
 firetruckBox(4.3,.32,.07,1.9,2.13,side*1.67,truckWhite);
 firetruckBox(.12,1.02,.17,-1.32,2.2,side*1.72,truckSilver);
 for(const wx of [-2.95,2.5]){
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,.3,14),truckRubber);
  tire.rotation.x=Math.PI/2;tire.position.set(wx,.82,side*1.78);firetruckShow.add(tire);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.32,12),truckSilver);
  hub.rotation.x=Math.PI/2;hub.position.set(wx,.82,side*1.79);firetruckShow.add(hub);
 }
}
firetruckBox(.32,.55,2.65,-4.54,1.3,0,truckSilver); // bumper
firetruckBox(4.15,.23,2.55,1.65,3.86,0,truckSilver); // top equipment
for(const x of [-2.2,1.9]){
 firetruckBox(.62,.22,.6,x,4.01,-.76,truckLamp);
 firetruckBox(.62,.22,.6,x,4.01,.76,truckLamp);
}
const firetruckLadder=new THREE.Group();firetruckLadder.position.set(.7,4.15,0);firetruckShow.add(firetruckLadder);
for(const zz of [-.55,.55]){
 const rail=new THREE.Mesh(new THREE.BoxGeometry(4.4,.13,.13),truckSilver);
 rail.position.set(0,0,zz);firetruckLadder.add(rail);
}
for(let i=0;i<8;i++){
 const rung=new THREE.Mesh(new THREE.BoxGeometry(.13,.12,1.2),truckSilver);
 rung.position.x=-1.9+i*.54;firetruckLadder.add(rung);
}
const firetruckNozzle=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,1.65,10),truckSilver);
firetruckNozzle.position.set(-3.8,4.28,0);firetruckNozzle.rotation.z=-Math.PI/2.9;firetruckShow.add(firetruckNozzle);
const firetruckStart=new THREE.Vector3(29.8,5.9,-12.5);
// The landing point sweeps across the entire audience and progressively moves
// from the stage-facing (upper) rows to the far (lower) audience rows.
const firetruckEnd=new THREE.Vector3(0,1.35,6);
const firetruckArc=new THREE.Vector3();
function firetruckWaterPoint(progress,out){
 out.lerpVectors(firetruckStart,firetruckEnd,progress);
 out.y+=10.6*4*progress*(1-progress);
 return out;
}
const waterCurvePoints=[];
for(let i=0;i<=60;i++)waterCurvePoints.push(firetruckWaterPoint(i/60,new THREE.Vector3()));
const firetruckWater=new THREE.Group();scene.add(firetruckWater);firetruckWater.visible=false;
const waterStreamGeometry=new THREE.BufferGeometry().setFromPoints(waterCurvePoints);
const waterStream=new THREE.Line(waterStreamGeometry,
 new THREE.LineBasicMaterial({color:'#c9f2ff',transparent:true,opacity:.87,depthWrite:false,depthTest:false}));
waterStream.renderOrder=160;waterStream.frustumCulled=false;firetruckWater.add(waterStream);
const waterSprayMaterial=new THREE.PointsMaterial({color:'#d9f5ff',size:.60,transparent:true,opacity:.92,depthWrite:false,depthTest:false,sizeAttenuation:true});
const waterSprayCount=perfWeakDevice?300:760;
const waterSprayPos=new Float32Array(waterSprayCount*3);
const waterSprayGeometry=new THREE.BufferGeometry();
waterSprayGeometry.setAttribute('position',new THREE.BufferAttribute(waterSprayPos,3));
const waterSpray=new THREE.Points(waterSprayGeometry,waterSprayMaterial);
waterSpray.frustumCulled=false;waterSpray.renderOrder=160;firetruckWater.add(waterSpray);
const waterSplashCount=perfWeakDevice?120:300;
const waterSplashPositions=new Float32Array(waterSplashCount*3);
const waterSplashGeo=new THREE.BufferGeometry();waterSplashGeo.setAttribute('position',new THREE.BufferAttribute(waterSplashPositions,3));
const waterSplash=new THREE.Points(waterSplashGeo,new THREE.PointsMaterial({color:'#f4fbff',size:.95,transparent:true,opacity:.75,depthWrite:false,depthTest:false}));
waterSplash.frustumCulled=false;waterSplash.renderOrder=160;firetruckWater.add(waterSplash);
// v142: The video is a CSS3D iframe above the base WebGL canvas.
// Draw the water on the dedicated transparent foreground WebGL canvas so
// CSS3D can no longer cover the spray. Fall back to layer 0 if unavailable.
if(stageForeground){
 for(const waterEffect of [waterStream,waterSpray,waterSplash])waterEffect.layers.set(1);
}

const koreaClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
let lastFiretruckAdvanceKey='',lastFiretruckWaterKey='',lastSirenBeat=-1;
const firetruckAnnouncement=document.createElement('div');
firetruckAnnouncement.setAttribute('role','status');firetruckAnnouncement.setAttribute('aria-live','polite');
firetruckAnnouncement.style.cssText='position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:400;max-width:min(92vw,460px);text-align:center;background:rgba(17,27,48,.88);border:1px solid #98ecff;border-radius:16px;padding:13px 20px;color:white;font-weight:800;font-size:clamp(14px,2.3vw,20px);box-shadow:0 7px 25px #0007;pointer-events:none;display:none';
firetruckAnnouncement.textContent='🚨 곧 워터쇼가 시작됩니다!';document.body.append(firetruckAnnouncement);
// Short synthesized siren, only on browsers that allow audio following interaction.
let firetruckSirenContext;
function playFestivalSiren(){
 if(!state.id||!state.audioEnabled||document.hidden)return;
 try{
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
  firetruckSirenContext??=new Ctx();
  if(firetruckSirenContext.state!=='running')return;
  const ctx=firetruckSirenContext,at=ctx.currentTime;
  const oscillator=ctx.createOscillator(),gain=ctx.createGain();
  oscillator.type='sine';oscillator.frequency.setValueAtTime(620,at);
  oscillator.frequency.linearRampToValueAtTime(940,at+.45);
  oscillator.frequency.linearRampToValueAtTime(620,at+.9);
  oscillator.frequency.linearRampToValueAtTime(940,at+1.35);
  oscillator.frequency.linearRampToValueAtTime(620,at+1.8);
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.075,at+.12);
  gain.gain.setValueAtTime(.075,at+1.65);gain.gain.linearRampToValueAtTime(0,at+1.85);
  oscillator.connect(gain);gain.connect(ctx.destination);oscillator.start(at);oscillator.stop(at+1.86);
  oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
 }catch(e){console.warn('워터쇼 사이렌을 재생할 수 없습니다',e)}
}
// Prepare WebAudio on the first real interaction, not via an autoplay bypass.
window.addEventListener('pointerdown',()=>{if(!state.audioEnabled)return;try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;firetruckSirenContext??=new Ctx();if(firetruckSirenContext.state==='suspended')firetruckSirenContext.resume().catch(()=>{});}catch{}},{passive:true});
window.addEventListener('keydown',()=>{if(!state.audioEnabled)return;try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;firetruckSirenContext??=new Ctx();if(firetruckSirenContext.state==='suspended')firetruckSirenContext.resume().catch(()=>{});}catch{}},{passive:true});
function updateFiretruckShow(t){
 const now=new Date(Date.now()+(Number.isFinite(state.serverDelta)?state.serverDelta:0));
 const parts=koreaClock.formatToParts(now), get=(kind)=>Number(parts.find(p=>p.type===kind)?.value);
 const hours=get('hour'),minutes=get('minute'),seconds=get('second');
 const today=[get('year'),String(get('month')).padStart(2,'0'),String(get('day')).padStart(2,'0')].join('-');
 // Three daily five-minute shows, with the firetruck and siren one minute prior.
 const showHours=[13,14,15];
 const active=showHours.includes(hours)&&minutes<5;
 const nextShowHour=showHours.includes(hours+1)&&minutes===59?hours+1:null;
 const warning=nextShowHour!==null;
 const showKey=today+':'+(warning?nextShowHour:hours);
 firetruckShow.visible=warning||active;firetruckWater.visible=active;
 firetruckAnnouncement.style.display=warning?'block':'none';
 if(warning){
  firetruckAnnouncement.textContent=`🚨 1분 후 소방차 워터쇼! 오후 ${nextShowHour}시 정각`;
  if(lastFiretruckAdvanceKey!==showKey){lastFiretruckAdvanceKey=showKey;notice('🚨 1분 후 소방차 워터쇼가 시작됩니다!');}
  const beat=Math.floor(seconds/12);
  if(lastSirenBeat!==showKey+':'+beat){lastSirenBeat=showKey+':'+beat;playFestivalSiren();}
 }
 if(active&&lastFiretruckWaterKey!==showKey){lastFiretruckWaterKey=showKey;notice('💦 소방차 워터쇼 시작! 5분간 관객석에 물을 뿌립니다.');}
 if(!warning&&!active)return;
 const sec=t*.001;
 truckLamp.color.set(Math.floor(sec*4)%2?'#ff2840':'#ff8c95');
 if(!active)return;
 // 60-second slow vertical sweep: upper audience -> center -> lower audience,
 // with a generous side-to-side sweep so every audience section is covered.
 const elapsed=minutes*60+seconds;
 const phase=(elapsed%60)/60;
 const vertical=phase*phase*(3-2*phase);
 firetruckEnd.set(Math.sin(elapsed*.27)*17,1.35,1+vertical*18);
 const streamPos=waterStreamGeometry.attributes.position;
 for(let i=0;i<streamPos.count;i++){
  firetruckWaterPoint(i/(streamPos.count-1),firetruckArc);
  streamPos.setXYZ(i,firetruckArc.x,firetruckArc.y,firetruckArc.z);
 }
 streamPos.needsUpdate=true;
 for(let i=0;i<waterSprayCount;i++){
  const u=(i*.61803398875+sec*.72)%1;
  firetruckWaterPoint(u,firetruckArc);
  const diffuse=.55+u*2.1;
  waterSprayPos[i*3]=firetruckArc.x+Math.sin(i*12.989+sec*2.8)*diffuse;
  waterSprayPos[i*3+1]=firetruckArc.y+Math.cos(i*7.83+sec*4.1)*diffuse;
  waterSprayPos[i*3+2]=firetruckArc.z+Math.sin(i*5.33+sec*3.6)*diffuse;
 }
 waterSprayGeometry.attributes.position.needsUpdate=true;
 for(let i=0;i<waterSplashCount;i++){
  const v=(i*.75487766+sec*.82)%1,angle=i*2.39996;
  const radius=v*(3.7+(i%7)*.7);
  waterSplashPositions[i*3]=firetruckEnd.x+Math.cos(angle)*radius;
  waterSplashPositions[i*3+1]=Math.max(.15,firetruckEnd.y+1.9*v-2*v*v);
  waterSplashPositions[i*3+2]=firetruckEnd.z+Math.sin(angle)*radius;
 }
 waterSplashGeo.attributes.position.needsUpdate=true;
}

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
// v111: walk-up merchandise booth on the audience's stage-left edge.
// Its front faces +Z (the audience/camera). All click targets are local meshes.
const mdBoothTargets=[];
const mdBoothGroup=new THREE.Group();mdBoothGroup.position.set(-38,0,-7.2);scene.add(mdBoothGroup);
function mdPart(geometry,material,x,y,z,clickable=true){
 const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.receiveShadow=true;
 mesh.castShadow=false;mdBoothGroup.add(mesh);if(clickable)mdBoothTargets.push(mesh);return mesh;
}
const mdCharcoal=mat('#222235'),mdPink=mat('#e884b6'),mdWhite=mat('#f5eddf'),mdSilver=mat('#abb8c5',.45);
mdPart(new THREE.BoxGeometry(9,.35,5.5),mdCharcoal,0,.18,0);
for(const x of [-4.0,4.0])for(const z of [-2.3,2.3])mdPart(new THREE.BoxGeometry(.24,4.8,.24),mdSilver,x,2.5,z);
mdPart(new THREE.BoxGeometry(9.5,.35,6),mdPink,0,5.0,0);
mdPart(new THREE.BoxGeometry(8.6,1.25,.42),mdCharcoal,0,4.38,2.65);
const mdSign=new THREE.Mesh(new THREE.PlaneGeometry(7.9,1.02),label('ONEseason MD',63,'#ffffff','#252135'));
mdSign.position.set(0,4.38,2.9);mdBoothGroup.add(mdSign);mdBoothTargets.push(mdSign);
mdPart(new THREE.BoxGeometry(8.15,1.15,1.25),mdCharcoal,0,.98,2.18);
mdPart(new THREE.BoxGeometry(8.15,.15,1.6),mdWhite,0,1.64,2.18);
// Display three collectible T-shirts, a pink horn headband and a metal chain.
for(const [i,color] of [[-2.9,'#22242d'],[0,'#e6d34d'],[2.9,'#f3f0ea']]){
 mdPart(new THREE.BoxGeometry(1.85,1.45,.16),mat(color),i,2.92,-2.31);
 const emblem=new THREE.Mesh(new THREE.PlaneGeometry(1.25,.80),label(i<0?'SKULL':i===0?'PUNK':'ROCK',54,'#ffffff',i===0?'#514a22':'#343043'));
 emblem.position.set(i,2.96,-2.20);mdBoothGroup.add(emblem);mdBoothTargets.push(emblem);
}
for(const side of [-1,1]){const horn=mdPart(new THREE.ConeGeometry(.29,.76,7),mat('#de4a76'),side*.47,2.16,2.44);horn.rotation.z=side*.26}
mdPart(new THREE.TorusGeometry(.72,.07,7,20,Math.PI),mdSilver,0,1.90,2.95);
const mdInteractSign=new THREE.Mesh(new THREE.PlaneGeometry(5.4,.78),label('TOUCH TO SHOP',58,'#fcfae8','#e36b9b'));
mdInteractSign.position.set(0,2.0,3.01);mdBoothGroup.add(mdInteractSign);mdBoothTargets.push(mdInteractSign);
// Crowd barrier
// Keep the front fence, but open the centre so the new stage stairs are usable.
for(let x=-34;x<=34;x+=3){
 if(x>-9&&x<9)continue;
 cube(.11,1.45,.11,metal,x,.9,-13.2);
 if(x<34&&!(x+1.5>-9&&x+1.5<9))cube(3,.13,.13,metal,x+1.5,1.48,-13.2)
}
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
const rhythmBooth=new THREE.Group();rhythmBooth.position.set(40,0,39);scene.add(rhythmBooth);const rb=(w,h,d,m,x,y,z)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);rhythmBooth.add(mesh);return mesh};rb(6.4,3.0,4.2,mat('#7a4ed9'),0,1.65,0);rb(7.2,.34,4.8,mat('#ffd36b'),0,3.28,0);rb(2.8,.95,.12,mat('#241736'),0,2.25,2.18);const rhythmBanner=new THREE.Mesh(new THREE.PlaneGeometry(4.9,1.16),label('BEAT BOOTH',64,'#fffaf1','#ff59bc'));rhythmBanner.position.set(0,2.25,2.45);rhythmBooth.add(rhythmBanner);const rhythmSign=new THREE.Mesh(new THREE.PlaneGeometry(5.2,.96),label('RHYTHM GAME',58,'#fff5ea','#4a2575'));rhythmSign.position.set(0,3.95,.12);rhythmBooth.add(rhythmSign);const rbFloor=new THREE.Mesh(new THREE.CircleGeometry(2.5,40),new THREE.MeshBasicMaterial({color:'#ff76c8',transparent:true,opacity:.22}));rbFloor.rotation.x=-Math.PI/2;rbFloor.position.set(0,.05,2.1);rhythmBooth.add(rbFloor);
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

// v162: relocate the entire campfire talk zone to audience-right (facing the stage).
// Keep the original depth and group all stones, fire, cushions, and lighting together.
// The right-side position is clear of the MD booth and the rhythm booth.
const CAMPFIRE_X=34,CAMPFIRE_Z=10.5,CAMPFIRE_REST_RADIUS=8.8;
const campfire=new THREE.Group();campfire.position.set(CAMPFIRE_X,0,CAMPFIRE_Z);scene.add(campfire);
const campStone=new THREE.MeshStandardMaterial({color:'#7f7875',roughness:1,flatShading:true});
const campWood=new THREE.MeshStandardMaterial({color:'#77533b',roughness:1,flatShading:true});
const campAsh=new THREE.MeshStandardMaterial({color:'#332a2a',roughness:1});
const campGlowMat=new THREE.MeshBasicMaterial({color:'#ffad43',transparent:true,opacity:.24,depthWrite:false});
function campPart(geometry,material,x,y,z){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=false;mesh.receiveShadow=true;campfire.add(mesh);return mesh}
const campAshDisk=campPart(new THREE.CylinderGeometry(1.35,1.45,.12,16),campAsh,0,.12,0);
for(let i=0;i<13;i++){
 const angle=i*Math.PI*2/13,stone=campPart(new THREE.DodecahedronGeometry(.38,0),campStone,Math.cos(angle)*1.44,.21,Math.sin(angle)*1.44);
 stone.scale.set(1.13,.68,.86);stone.rotation.y=angle;
}
for(let i=0;i<5;i++){
 const angle=i*Math.PI/5,log=campPart(new THREE.CylinderGeometry(.19,.25,2.3,8),campWood,Math.cos(angle)*.15,.34,Math.sin(angle)*.15);
 log.rotation.z=Math.PI/2;log.rotation.y=angle;
}
// Separate small cushions around the fire. They remain available even when the fire is off.
const campCushions=[];
for(let i=0;i<7;i++){
 const a=(i/7)*Math.PI*2+.25,r=4.1+(i%2)*.43,x=Math.cos(a)*r,z=Math.sin(a)*r;
 const cushion=campPart(new THREE.CylinderGeometry(.88,.91,.14,14),new THREE.MeshStandardMaterial({color:['#b98087','#9b9ace','#a9be9e','#d1a477'][i%4],roughness:1}),x,.14,z);
 cushion.scale.z=.78;campCushions.push({x:CAMPFIRE_X+x,z:CAMPFIRE_Z+z});
}
const campFireVisual=new THREE.Group();campFireVisual.visible=false;campfire.add(campFireVisual);
const campFlames=[];
const campFlameSpecs=[
 {r:.00,a:0,h:3.45,w:.72,c:'#fff3b1',o:.86,s:0},
 {r:.12,a:1.1,h:3.10,w:.66,c:'#ffd767',o:.82,s:.9},
 {r:.18,a:2.4,h:2.95,w:.61,c:'#ffb84d',o:.79,s:1.6},
 {r:.26,a:3.2,h:2.72,w:.55,c:'#ff9440',o:.76,s:2.3},
 {r:.30,a:4.4,h:2.55,w:.53,c:'#ff7a35',o:.72,s:2.9},
 {r:.37,a:5.3,h:2.35,w:.49,c:'#ff642f',o:.68,s:3.5},
 {r:.24,a:0.6,h:2.10,w:.46,c:'#ffe58b',o:.75,s:4.1},
 {r:.34,a:1.8,h:1.95,w:.42,c:'#ffb347',o:.71,s:4.8},
 {r:.40,a:2.8,h:1.82,w:.39,c:'#ff8b36',o:.66,s:5.5},
 {r:.29,a:3.9,h:1.74,w:.36,c:'#ff6a2f',o:.62,s:6.2},
 {r:.16,a:4.9,h:1.64,w:.34,c:'#fff0a4',o:.70,s:6.8},
 {r:.22,a:5.8,h:1.56,w:.31,c:'#ffc857',o:.67,s:7.4}
];
for(let i=0;i<campFlameSpecs.length;i++){
 const spec=campFlameSpecs[i];
 const flame=new THREE.Mesh(new THREE.ConeGeometry(spec.w,spec.h,8,1,true),new THREE.MeshBasicMaterial({color:spec.c,transparent:true,opacity:spec.o,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
 const x=Math.cos(spec.a)*spec.r,z=Math.sin(spec.a)*spec.r;
 flame.position.set(x,.34+spec.h*.46,z);
 flame.rotation.x=(i%2?-.08:.07);flame.rotation.z=(i%3-1)*.08;
 flame.userData={baseX:x,baseZ:z,baseY:.34+spec.h*.46,baseH:spec.h,baseW:spec.w,seed:spec.s,swirl:spec.a};
 campFireVisual.add(flame);campFlames.push(flame);
}
const campEmbers=[];
for(let i=0;i<28;i++){
 const ember=new THREE.Mesh(new THREE.SphereGeometry(.04+(i%5)*.011,5,4),new THREE.MeshBasicMaterial({color:i%4<2?'#ffc064':'#fff1b8',transparent:true,opacity:.78,depthWrite:false,blending:THREE.AdditiveBlending}));
 ember.userData={seed:i*.73,drift:.16+(i%7)*.03};campFireVisual.add(ember);campEmbers.push(ember);
}
const campSmoke=[];
for(let i=0;i<10;i++){
 const smoke=new THREE.Mesh(new THREE.SphereGeometry(.22+(i%3)*.06,6,5),new THREE.MeshBasicMaterial({color:'#8b8080',transparent:true,opacity:.12,depthWrite:false}));
 smoke.userData={seed:i*.91,drift:.18+(i%4)*.05};campFireVisual.add(smoke);campSmoke.push(smoke);
}
// Radial alpha texture prevents the default solid square Sprite from appearing inside the flames.
const campGlowCanvas=document.createElement('canvas');
campGlowCanvas.width=128;campGlowCanvas.height=128;
const campGlowCtx=campGlowCanvas.getContext('2d');
const campGlowGradient=campGlowCtx.createRadialGradient(64,64,2,64,64,63);
campGlowGradient.addColorStop(0,'rgba(255,247,175,0.92)');
campGlowGradient.addColorStop(.20,'rgba(255,197,78,0.67)');
campGlowGradient.addColorStop(.52,'rgba(255,112,34,0.24)');
campGlowGradient.addColorStop(1,'rgba(255,90,25,0)');
campGlowCtx.fillStyle=campGlowGradient;campGlowCtx.fillRect(0,0,128,128);
const campGlowTexture=new THREE.CanvasTexture(campGlowCanvas);
const campCoreGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:campGlowTexture,color:'#ffffff',transparent:true,opacity:.78,depthWrite:false,blending:THREE.AdditiveBlending}));
campCoreGlow.scale.set(2.8,2.8,1);campCoreGlow.position.set(0,1.45,0);campFireVisual.add(campCoreGlow);
const campLight=new THREE.PointLight('#ff8b3b',0,22,2);campLight.position.set(0,2.25,0);campfire.add(campLight);
const campLightHalo=new THREE.Mesh(new THREE.CircleGeometry(3.2,32),campGlowMat);campLightHalo.rotation.x=-Math.PI/2;campLightHalo.position.y=.095;campLightHalo.visible=false;campfire.add(campLightHalo);
let campfireBurning=null; // Force the first schedule evaluation to set flame visibility.
const campfireKSTClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function updateCampfireSchedule(){
 const hour=Number(campfireKSTClock.format(new Date()).split(':')[0]);
 const active=hour>=20||hour<3;
 if(campfireBurning!==active){campfireBurning=active;campFireVisual.visible=active;campLightHalo.visible=active;}
 return active;
}
function animateCampfire(t){
 const active=updateCampfireSchedule();
 const seconds=t*.001;
 campLight.intensity=active?(2.9+Math.sin(t*.012)*.38+Math.sin(t*.025)*.22):0;
 if(!active)return;
 const gust=Math.sin(seconds*1.6)*.08+Math.sin(seconds*3.9)*.04;
 for(let i=0;i<campFlames.length;i++){
  const f=campFlames[i],d=f.userData;
  const flicker=Math.sin(seconds*(5.8+(i%4)*.7)+d.seed)+.45*Math.sin(seconds*(10.7+(i%3)*1.1)+d.seed*1.7);
  const swell=.94+flicker*.11;
  f.position.x=d.baseX+Math.sin(seconds*2.4+d.seed)*.07+gust*(.35+d.baseH*.07);
  f.position.z=d.baseZ+Math.cos(seconds*2.1+d.seed*1.2)*.055;
  f.position.y=d.baseY+Math.max(0,Math.sin(seconds*4.6+d.seed))*.08;
  f.scale.set(.9+Math.sin(seconds*3.6+d.seed)*.06,swell+Math.max(0,Math.sin(seconds*7.2+d.seed))*0.26,.9+Math.cos(seconds*4.1+d.seed)*.06);
  f.rotation.z=Math.sin(seconds*2.8+d.seed)*.18+gust*.75;
  f.rotation.x=Math.cos(seconds*2.15+d.seed)*.09;
  f.material.opacity=Math.min(.94,Math.max(.46,.62+flicker*.10+(d.baseH>2.7?.08:0)));
 }
 for(let i=0;i<campEmbers.length;i++){
  const e=campEmbers[i],d=e.userData,phase=(seconds*(.24+(i%5)*.05)+d.seed)%1;
  const wobble=Math.sin(seconds*3.2+d.seed)*d.drift;
  e.position.set(Math.cos(d.seed*3.8+phase*2.8)*(.18+phase*.45)+wobble*.35,.56+phase*4.9,Math.sin(d.seed*2.7+phase*2.4)*(.18+phase*.34));
  const scale=.7+.8*(1-phase);
  e.scale.setScalar(scale);
  e.material.opacity=.82*(1-phase)*(phase<.16?phase/.16:1);
 }
 for(let i=0;i<campSmoke.length;i++){
  const s=campSmoke[i],d=s.userData,phase=(seconds*(.10+(i%3)*.016)+d.seed*.2)%1;
  s.position.set(Math.sin(d.seed+phase*2.2)*(.12+phase*.48)+gust*2.2,.96+phase*4.2,Math.cos(d.seed*1.7+phase*1.9)*(.10+phase*.34));
  const scale=.85+phase*2.6;
  s.scale.setScalar(scale);
  s.material.opacity=(1-phase)*.16*(phase<.2?phase/.2:1);
 }
 campCoreGlow.scale.set(2.7+Math.sin(seconds*6.2)*.18,2.95+Math.sin(seconds*7.4)*.22,1);
 campCoreGlow.material.opacity=.64+Math.sin(seconds*9.4)*.08;
 campGlowMat.opacity=.24+Math.sin(seconds*7.3)*.045;
}
updateCampfireSchedule();
const stageLights=[];for(let i=0;i<7;i++){let x=-17+i*5.6;let l=new THREE.SpotLight(['#ff64a5','#8c84ff','#c4fb79','#68e8f3'][i%4],110,65,.50,.65);l.position.set(x,9,-19);l.target.position.set(x*.65,0,0);scene.add(l,l.target);stageLights.push(l)}
// Controlled, pooled lighting + flame and spark bursts. No per-frame geometry allocation.
const flameGroups=[],emberMat=new THREE.MeshBasicMaterial({color:'#ffc979',transparent:true,opacity:.95,depthWrite:false});
for(let side of [-1,1])for(let j=0;j<3;j++){
 const flame=new THREE.Group();flame.position.set(side*(8+j*4),2.35,-18.5);scene.add(flame);
 const colors=['#ffe98a','#ff9f35','#ff4d4d'];for(let k=0;k<3;k++){const mesh=new THREE.Mesh(new THREE.ConeGeometry(.38-k*.1,1.3+k*.32,7),new THREE.MeshBasicMaterial({color:colors[k],transparent:true,opacity:.8}));mesh.position.y=.6+k*.25;mesh.rotation.z=k*.12;flame.add(mesh)}flameGroups.push(flame)
}
const sparks=[];const sparkGeo=new THREE.SphereGeometry(.095,5,4);
for(let i=0;i<65;i++){const mesh=new THREE.Mesh(sparkGeo,emberMat);mesh.visible=false;scene.add(mesh);sparks.push({mesh,seed:i*0.91})}
function animateShow(t){
 // On low-end tablets avoid 7 dynamic spotlights and dozens of animated
 // stage meshes; stage, music and avatars continue to work unchanged.
 if(perfMode==='eco'||(perfMode==='auto'&&perfWeakDevice)){
  stageLights.forEach(l=>l.visible=false);
  flameGroups.forEach(f=>f.visible=false);
  sparks.forEach(q=>q.mesh.visible=false);
  return;
 }
 stageLights.forEach(l=>l.visible=true);
 let sec=t*.001;stageLights.forEach((l,i)=>{const beat=70+65*Math.sin(sec*(state.music.id&&!state.music.paused?4:1.1)+i*2)**2;l.intensity=beat*stageAccentFactor;l.target.position.x=(-17+i*5.6)*.65+Math.sin(sec*.85+i)*7});
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
 skyPeriod=phase;
 const minimalScenery=perfMode==='eco'||(perfMode==='auto'&&perfWeakDevice);
 clouds.visible=!minimalScenery&&(phase==='day'||phase==='sunset'||phase==='dawn');
 stars.visible=!minimalScenery&&phase==='night';
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
 const look=p.equipped||{};
 const mdShirtColors={'tee-skull':'#17191f','tee-lightning':'#292139','tee-anarchy':'#191d25'};
 const activeMdShirt=Object.prototype.hasOwnProperty.call(mdShirtColors,look.shirt)||mdCatalog[look.shirt]?.custom?look.shirt:null;
 const activeShirtColor=activeMdShirt?(mdCatalog[activeMdShirt]?.shirtColor||mdShirtColors[activeMdShirt]||'#17191f'):p.color;
 const shirtMat=mat(activeShirtColor,.88),bottomColor=female?'#ad816c':'#6c7891';
 const pantsMat=mat(bottomColor,.9),shoeMat=mat('#f6f3e9',.9);
 function child(g,geo,m,pos,sc){let o=new THREE.Mesh(geo,m);o.position.set(...pos);if(sc)o.scale.set(...sc);o.castShadow=true;g.add(o);return o}
 // The torso is one continuous capsule: color on the lower vertices suggests clothes,
 // without bolted-on pants or skirt geometry.
 const upper=new THREE.Group();upper.position.y=1.03;root.add(upper);parts.upper=upper;
 const bodyGeo=new THREE.CapsuleGeometry(.45,.46,8,16);
 const pa=bodyGeo.attributes.position,colors=[];
 const topColor=new THREE.Color(activeShirtColor),bottom=new THREE.Color(bottomColor);
 for(let i=0;i<pa.count;i++){const y=pa.getY(i),blend=THREE.MathUtils.smoothstep(y,-.29,-.21);let c=bottom.clone().lerp(topColor,blend);colors.push(c.r,c.g,c.b)}
 bodyGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const bodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
 // Graphics are inked directly into the torso fragment material. Never attach a
 // rectangular plane in front of the character: it looks like a signboard.
 let mdPrintTexture=null;
 if(activeMdShirt){
  const cvs=document.createElement('canvas');cvs.width=512;cvs.height=512;
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,512,512);
  ctx.fillStyle=activeMdShirt==='tee-lightning'?'#ffeb5c':'#f9f6ed';
  ctx.strokeStyle='#17191f';ctx.lineWidth=12;ctx.lineJoin='round';
  if(mdCatalog[activeMdShirt]?.custom){
   // Custom art loads asynchronously onto the existing torso shader texture.
   const path=mdCatalog[activeMdShirt].imageUrl;
   const image=new Image();image.onload=()=>{ctx.clearRect(0,0,512,512);ctx.drawImage(image,0,0,512,512);if(mdPrintTexture)mdPrintTexture.needsUpdate=true};
   image.src=path;
  }else if(activeMdShirt==='tee-skull'){
   ctx.beginPath();ctx.moveTo(130,210);ctx.bezierCurveTo(108,126,179,78,255,78);
   ctx.bezierCurveTo(330,78,405,128,379,210);ctx.bezierCurveTo(366,253,332,266,327,299);
   ctx.lineTo(322,350);ctx.lineTo(190,350);ctx.lineTo(185,300);
   ctx.bezierCurveTo(179,266,143,252,130,210);ctx.fill();
   ctx.fillStyle='#151820';ctx.beginPath();ctx.ellipse(207,218,33,38,-.12,0,Math.PI*2);ctx.ellipse(305,218,33,38,.12,0,Math.PI*2);ctx.fill();
   ctx.beginPath();ctx.moveTo(256,259);ctx.lineTo(239,286);ctx.lineTo(273,286);ctx.closePath();ctx.fill();
   ctx.fillStyle='#151820';for(let i=0;i<5;i++)ctx.fillRect(207+i*20,310,12,41);
  }else if(activeMdShirt==='tee-lightning'){
   ctx.beginPath();ctx.moveTo(289,60);ctx.lineTo(160,270);ctx.lineTo(263,260);
   ctx.lineTo(218,462);ctx.lineTo(368,214);ctx.lineTo(279,226);ctx.closePath();ctx.fill();ctx.stroke();
  }else{
   ctx.font='bold 380px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
   ctx.fillText('Ⓐ',256,250);
  }
  mdPrintTexture=new THREE.CanvasTexture(cvs);
  mdPrintTexture.colorSpace=THREE.SRGBColorSpace;
  mdPrintTexture.wrapS=THREE.ClampToEdgeWrapping;
  mdPrintTexture.wrapT=THREE.ClampToEdgeWrapping;
  mdPrintTexture.anisotropy=2;
  // Store the shader-only texture for explicit disposal when the avatar is rebuilt.
  bodyMat.userData.mdPrintTexture=mdPrintTexture;
 }
 const showStripes=!activeMdShirt&&(p.pattern==='stripe'||p.pattern==='wide-stripe');
 if(showStripes||mdPrintTexture){
  const spacing=p.pattern==='stripe'?.155:.31;
  const width=p.pattern==='stripe'?.046:.105;
  bodyMat.customProgramCacheKey=()=>mdPrintTexture?'one-md-shirt-ink-v112':`one-shirt-stripes-v112-${p.pattern}`;
  bodyMat.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>',
     '#include <common>\nvarying vec3 vShirtPosition;');
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
     '#include <begin_vertex>\nvShirtPosition = position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
     '#include <common>\nvarying vec3 vShirtPosition;'+(mdPrintTexture?'\nuniform sampler2D mdPrintTexture;':''));
   if(mdPrintTexture){
    shader.uniforms.mdPrintTexture={value:mdPrintTexture};
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'+
      // Place artwork at the torso center rather than high near the neckline.
      // The capsule shader uses the torso's LOCAL vertex coordinates.
      'vec2 printUV = vec2(vShirtPosition.x / 0.79 + 0.5, (vShirtPosition.y + 0.30) / 0.82);\n'+
      'float printBounds = step(0.0, printUV.x) * step(printUV.x, 1.0) * step(0.0, printUV.y) * step(printUV.y, 1.0);\n'+
      'float chestFront = smoothstep(0.12, 0.31, vShirtPosition.z);\n'+
      'float shirtArea = smoothstep(-0.24, -0.12, vShirtPosition.y);\n'+
      'vec4 ink = texture2D(mdPrintTexture, clamp(printUV,0.0,1.0));\n'+
      'diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, ink.a * printBounds * chestFront * shirtArea);');
   }else{
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n'+
      'float stripeCoord = mod(vShirtPosition.y + 0.51, '+spacing.toFixed(4)+');\n'+
      'float stripeEdge = fwidth(stripeCoord) * 0.65;\n'+
      'float stripeInk = 1.0 - smoothstep('+width.toFixed(4)+' - stripeEdge, '+width.toFixed(4)+' + stripeEdge, stripeCoord);\n'+
      'float shirtCoverage = smoothstep(-0.18, -0.08, vShirtPosition.y);\n'+
      'vec3 stripeColor = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) > 0.72 ? vec3(0.18,0.20,0.23) : vec3(0.96,0.97,0.95);\n'+
      'diffuseColor.rgb = mix(diffuseColor.rgb, stripeColor, stripeInk * shirtCoverage * 0.93);');
   }
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
 // MD shirt ink is painted on the capsule itself above (no front-plane patch).
 if(['horns','spike-band'].includes(look.head)){
  // Upright headband: TorusGeometry's half-ring lies in XY, following the
  // hair/head arch. Do NOT rotate it onto the horizontal XZ plane.
  const band=child(neck,new THREE.TorusGeometry(.73,.069,8,32,Math.PI),mat('#20212b'),[0,.30,.27]);
  for(const side of [-1,1]){
   const isHorn=look.head==='horns';
   // Larger visible metal spikes: clear the hair volume instead of disappearing into it.
   const spike=child(neck,new THREE.ConeGeometry(isHorn?.19:.17,isHorn?.63:.57,10),
     mat(isHorn?'#d43747':'#d5dce6',.39),
     [side*.50,isHorn?1.12:1.13,.34]);
   spike.rotation.z=isHorn?side*.19:side*.09;
  }
 }
 // Additional raised headbands stay above the oversized face/hair silhouette.
 if(['bat-wing-band','heart-band'].includes(look.head)){
  const bandMaterial=mat(look.head==='heart-band'?'#e75a80':'#25202d',.45);
  const arc=child(neck,new THREE.TorusGeometry(.76,.067,9,40,Math.PI),bandMaterial,[0,.35,.28]);
  if(look.head==='heart-band'){
   // True, flat heart silhouettes: no spheres or cones that distort the outline.
   // The heart lies in the XY plane facing forward (+Z), and remains visible
   // from both sides when the avatar turns around.
   const heartMaterial=new THREE.MeshBasicMaterial({
    color:'#ff5b8c',side:THREE.DoubleSide,depthWrite:true
   });
   const heartShape=new THREE.Shape();
   heartShape.moveTo(0,-.29); // pointed bottom
   heartShape.bezierCurveTo(-.10,-.19,-.37,.00,-.37,.19);
   heartShape.bezierCurveTo(-.37,.43,-.09,.46,0,.26);
   heartShape.bezierCurveTo(.09,.46,.37,.43,.37,.19);
   heartShape.bezierCurveTo(.37,.00,.10,-.19,0,-.29);
   const geometry=new THREE.ShapeGeometry(heartShape,16);
   for(const side of [-1,1]){
    const heart=new THREE.Mesh(geometry,heartMaterial);
    heart.position.set(side*.47,1.18,.49);
    heart.scale.set(.82,.82,1);
    heart.renderOrder=2;
    neck.add(heart);
   }
  }else{
   const bat=mat('#262131',.56),edge=mat('#4b395a',.60);
   for(const side of [-1,1]){
    // Bat-wing crest points outward, taller than the hair and with scalloped lower edge.
    const shape=new THREE.Shape();
    const pts=[[0,0],[.19,.29],[.42,.24],[.64,.51],[.69,.12],[.57,.04],[.40,.10],[.29,-.05],[.13,.04]];
    pts.forEach(([x,y],i)=>i?shape.lineTo(side*x,y):shape.moveTo(side*x,y));shape.closePath();
    const wing=child(neck,new THREE.ShapeGeometry(shape),bat,[side*.25,1.13,.36]);wing.material.side=THREE.DoubleSide;
    const tip=child(neck,new THREE.ConeGeometry(.068,.27,5),edge,[side*.90,1.58,.34]);tip.rotation.z=-side*.34;
   }
  }
 }
 if(['chain','choker'].includes(look.neck)){
  // Head radius is about .8 and extends over the neck, so neckwear must sit
  // on the FRONT of the torso (positive Z), not behind the oversized head.
  const chainSilver=mat('#e3eaf2',.26),darkCollar=mat('#20232d',.79);
  const tubular=(points,radius,material)=>{
   const curve=new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v)));
   const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,32,radius,7,false),material);
   mesh.castShadow=false;upper.add(mesh);return mesh;
  };
  if(look.neck==='chain'){
   // Large V-shaped necklace drapes below the head and above the shirt print.
   const path=[[-.49,.73,.49],[-.43,.61,.60],[-.31,.48,.70],[-.16,.35,.75],
               [0,.31,.77],[.16,.35,.75],[.31,.48,.70],[.43,.61,.60],[.49,.73,.49]];
   tubular(path,.045,chainSilver);
   // Bright alternating chunky chain links follow the front-facing V.
   for(let i=1;i<path.length-1;i++){
    const [x,y,z]=path[i];
    const link=child(upper,new THREE.TorusGeometry(.102,.027,8,12),chainSilver,[x,y,z+.045]);
    link.rotation.z=(i<4?-.5:i>4?.5:0);
   }
   const pendant=child(upper,new THREE.OctahedronGeometry(.17,0),chainSilver,[0,.15,.80]);
   pendant.rotation.z=Math.PI/4;
  }else{
   // A thick curved collar across the front throat/upper chest, with large
   // outward-facing spikes. Original tiny band was hidden under the head.
   tubular([[-.49,.71,.48],[-.37,.58,.63],[-.18,.52,.73],[0,.50,.77],
            [.18,.52,.73],[.37,.58,.63],[.49,.71,.48]],.093,darkCollar);
   const spikeMetal=mat('#e0e5ee',.31);
   for(const x of [-.34,-.17,0,.17,.34]){
    const y=.53+.17*Math.pow(Math.abs(x)/.49,2);
    const z=.78-Math.abs(x)*.24;
    const spike=child(upper,new THREE.ConeGeometry(.085,.30,8),spikeMetal,[x,y,z+.13]);
    spike.rotation.x=Math.PI*.56;
   }
  }
 }

 // v123: Four independent wearable MD slots. Geometry is constructed locally,
 // so remote players receive the same models via their synchronized equipped map.
 if(look.eyes==='bat-glasses'){
  const black=mat('#11111a',.20),lens=mat('#231c33',.14);
  const batWing=(side)=>{
   // Pointed bat-wing silhouette: temples flare beyond the face outline.
   const outline=[[.04,.13],[.18,.24],[.34,.20],[.49,.32],[.57,.18],
                  [.72,.26],[.66,.03],[.55,-.04],[.38,-.01],[.20,-.06]];
   const shape=new THREE.Shape();
   outline.forEach(([x,y],i)=>i?shape.lineTo(x*side,y):shape.moveTo(x*side,y));
   shape.closePath();
   const lensMesh=child(neck,new THREE.ShapeGeometry(shape),lens,[0,.16,.81]);
   lensMesh.material.side=THREE.DoubleSide;
   child(neck,new THREE.BoxGeometry(.05,.065,.055),black,[side*.025,.31,.82]);
   child(neck,new THREE.BoxGeometry(.19,.06,.055),black,[side*.72,.17,.40]);
  };
  batWing(-1);batWing(1);
  child(neck,new THREE.BoxGeometry(.18,.06,.06),black,[0,.23,.835]);
 }
 if(['flame-glasses','round-glasses'].includes(look.eyes)){
  const frame=mat(look.eyes==='round-glasses'?'#bdad91':'#231d29',.29),
        lens=mat(look.eyes==='round-glasses'?'#8cacc0':'#d24325',.23);
  if(look.eyes==='round-glasses'){
   for(const side of [-1,1]){
    // Both rings are positioned in front of the large head, not inside the face.
    const ring=child(neck,new THREE.TorusGeometry(.255,.041,8,24),frame,[side*.34,.16,.80]);
    const glass=child(neck,new THREE.CircleGeometry(.222,28),lens,[side*.34,.16,.805]);
    glass.material.side=THREE.DoubleSide;glass.material.transparent=true;glass.material.opacity=.29;
    child(neck,new THREE.BoxGeometry(.22,.043,.052),frame,[side*.69,.17,.59]);
   }
   child(neck,new THREE.BoxGeometry(.21,.046,.055),frame,[0,.21,.81]);
  }else{
   // Flame outlines are broad enough to be visible at gameplay camera distance.
   for(const side of [-1,1]){
    const shape=new THREE.Shape();
    const points=[[0,-.10],[.23,-.16],[.46,-.10],[.59,.06],[.52,.14],
      [.64,.29],[.39,.22],[.34,.39],[.22,.25],[.09,.36],[.08,.16],[0,.12]];
    points.forEach(([x,y],i)=>i?shape.lineTo(side*x,y):shape.moveTo(side*x,y));shape.closePath();
    const outer=child(neck,new THREE.ShapeGeometry(shape),mat('#fa592b',.50),[side*.04,.15,.82]);
    outer.material.side=THREE.DoubleSide;
    const inner=child(neck,new THREE.CircleGeometry(.17,20),lens,[side*.35,.12,.844],[1,.85,1]);
    inner.material.side=THREE.DoubleSide;
    child(neck,new THREE.BoxGeometry(.19,.05,.06),frame,[side*.73,.15,.46]);
   }
   child(neck,new THREE.BoxGeometry(.20,.06,.06),frame,[0,.18,.85]);
  }
 }
 if(look.ears==='headset'){
  const shell=mat('#171922',.4),accent=mat('#ec3654',.34),padding=mat('#333743',.95);
  // A raised arch follows the head's upper hemisphere without hair clipping.
  const arc=new THREE.Mesh(new THREE.TorusGeometry(.88,.095,9,36,Math.PI),shell);
  arc.position.set(0,.20,0);neck.add(arc);
  const bandTrim=new THREE.Mesh(new THREE.TorusGeometry(.88,.025,6,36,Math.PI),accent);
  bandTrim.position.set(0,.20,.065);neck.add(bandTrim);
  for(const side of [-1,1]){
   const cup=child(neck,new THREE.BoxGeometry(.23,.49,.35),shell,[side*.88,.17,.06]);
   cup.rotation.z=side*.12;
   child(neck,new THREE.BoxGeometry(.025,.33,.26),accent,[side*1.012,.17,.07]);
   child(neck,new THREE.BoxGeometry(.07,.34,.29),padding,[side*.745,.17,.055]);
  }
 }
 if(look.back==='fallen-wings'){
  const wingMat=mat('#1d1b28',.72),featherMat=mat('#35313e',.72),tipMat=mat('#0a0a10',.68);
  const wingGroup=new THREE.Group();wingGroup.position.set(0,.62,-.52);upper.add(wingGroup);parts.mdWings=wingGroup;
  for(const side of [-1,1]){
   const arm=child(wingGroup,new THREE.CapsuleGeometry(.115,.61,5,9),wingMat,[side*.46,.12,-.03]);
   arm.rotation.z=-side*.69;
   // Layered outer feathers form a broad, tapered black angel-wing silhouette.
   for(let i=0;i<7;i++){
    const progress=i/6;
    const feather=child(wingGroup,new THREE.CapsuleGeometry(.095,.57-progress*.12,4,8),
      i%2?featherMat:tipMat,
      [side*(.39+progress*.99),.08-progress*.25,-.08-progress*.045],
      [.95,1.04-progress*.25,.60]);
    feather.rotation.z=side*(-.90+progress*.76);
   }
  }
 }
 if(look.back==='angel-wings'){
  const white=mat('#f2f1ec',.94),feather=mat('#d6e5f3',.93),outline=mat('#c2cede',.82);
  const wings=new THREE.Group();wings.position.set(0,.66,-.55);upper.add(wings);parts.mdWings=wings;
  for(const side of [-1,1]){
   const bone=child(wings,new THREE.CapsuleGeometry(.14,.67,6,10),white,[side*.43,.15,-.03]);bone.rotation.z=-side*.72;
   for(let i=0;i<8;i++){
    const t=i/7;
    const f=child(wings,new THREE.CapsuleGeometry(.105,.52-t*.08,5,8),i%3===0?outline:i%2?feather:white,
      [side*(.35+t*1.06),.11-t*.28,-.04-t*.05],[1.03,1.04-t*.23,.62]);
    f.rotation.z=side*(-.91+t*.80);
   }
  }
 }
 if(look.back==='back-guitar'){
  // Guitar hangs diagonally on the rear torso with a visible strap. Entire rig
  // is parented to upper, so dances/turns keep guitar attached to the back.
  const guitar=new THREE.Group();guitar.position.set(.20,.46,-.62);guitar.rotation.z=-.47;upper.add(guitar);
  const body=mat('#b52c40',.46),rim=mat('#22202b',.45),metal=mat('#dde1e8',.30),wood=mat('#302028',.68);
  child(guitar,new THREE.SphereGeometry(.33,16,12),rim,[0,-.27,-.05],[1.07,1.13,.27]);
  child(guitar,new THREE.SphereGeometry(.30,16,12),body,[0,-.24,-.105],[1.01,1.12,.24]);
  // Two pointed electric-guitar horns.
  for(const side of [-1,1]){
   const horn=child(guitar,new THREE.ConeGeometry(.125,.42,7),body,[side*.23,.03,-.09]);horn.rotation.z=-side*.29;
  }
  child(guitar,new THREE.BoxGeometry(.18,.99,.11),wood,[0,.51,-.04]);
  child(guitar,new THREE.BoxGeometry(.30,.19,.12),wood,[0,1.05,-.04]);
  for(let i=0;i<5;i++){
   child(guitar,new THREE.BoxGeometry(.18,.025,.015),metal,[0,.20+i*.16,.028]);
  }
  for(let i=0;i<4;i++)child(guitar,new THREE.BoxGeometry(.014,1.53,.012),metal,[(i-1.5)*.040,.36,.041]);
  child(guitar,new THREE.BoxGeometry(.28,.08,.045),metal,[0,-.36,-.23]);
  // Dark diagonal shoulder strap remains visible against colorful shirts.
  const strapCurve=new THREE.CatmullRomCurve3([
   new THREE.Vector3(-.36,.86,.10),new THREE.Vector3(-.30,.55,.16),
   new THREE.Vector3(.14,.08,.07),new THREE.Vector3(.24,-.39,-.03)
  ]);
  child(guitar,new THREE.TubeGeometry(strapCurve,18,.055,7,false),rim,[0,0,0]);
 }
 if(look.tail==='devil-tail'){
  const tailMat=mat('#27212e',.55),red=mat('#b92742',.38);
  const tailGroup=new THREE.Group();tailGroup.position.set(0,-.14,-.47);upper.add(tailGroup);parts.mdTail=tailGroup;
  const curve=new THREE.CatmullRomCurve3([
   new THREE.Vector3(0,0,0),new THREE.Vector3(.13,-.34,-.34),
   new THREE.Vector3(.28,-.66,-.57),new THREE.Vector3(.41,-.48,-.75),
   new THREE.Vector3(.52,-.19,-.88)
  ]);
  child(tailGroup,new THREE.TubeGeometry(curve,24,.065,8,false),tailMat,[0,0,0]);
  const tip=child(tailGroup,new THREE.ConeGeometry(.18,.42,3),red,[.55,-.08,-.88]);
  tip.rotation.z=-.55;
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
 // Neon baton follows each hand joint. Two rods + emissive edges; no lights added per player.
 const glowsticks=[];
 const glowRodGeo=new THREE.CylinderGeometry(.076,.076,.78,9);
 const glowHaloGeo=new THREE.CylinderGeometry(.14,.14,.83,10,1,true);
 const glowCapMat=new THREE.MeshStandardMaterial({color:'#e8e8ef',roughness:.38,metalness:.32});
 for(const side of ['left','right']){
  const stick=new THREE.Group();stick.position.set(0,-.39,.065);parts[side+'Elbow'].add(stick);
  const rodMat=new THREE.MeshBasicMaterial({color:'#9dff32',toneMapped:false});
  const rod=new THREE.Mesh(glowRodGeo,rodMat);rod.position.y=-.20;stick.add(rod);
  const haloMat=new THREE.MeshBasicMaterial({color:'#9dff32',transparent:true,opacity:.18,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  const halo=new THREE.Mesh(glowHaloGeo,haloMat);halo.position.y=-.20;stick.add(halo);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.086,.086,.11,9),glowCapMat);cap.position.y=.25;stick.add(cap);
  // Keep the stick at the actual palm (elbow-local y=-.39).
  // Point the lighted rod toward avatar-front (+Z), with the grip/cap behind (-Z).
  // The lit section extends farther in front of the palm than the grip does behind it.
  stick.rotation.set(-Math.PI/2,0,0);stick.visible=false;
  glowsticks.push({group:stick,rodMat,haloMat});
 }
 parts.glowsticks=glowsticks;
 // Lightweight shared night fireworks effect: a wrist-held launcher and small
 // repeating overhead bursts. Animations are deterministic from the shared action.
 const nightLauncher=new THREE.Group();parts.nightLauncher=nightLauncher;
 parts.rightElbow.add(nightLauncher);
 nightLauncher.position.set(0,-.39,.065);
 nightLauncher.rotation.set(-Math.PI/2,0,0);
 const nightHandle=new THREE.Mesh(new THREE.CylinderGeometry(.085,.095,.57,8),
  new THREE.MeshStandardMaterial({color:'#343b61',roughness:.55}));
 nightHandle.rotation.x=Math.PI/2;nightHandle.position.z=.28;nightLauncher.add(nightHandle);
 const nightTip=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,.14,8),
  new THREE.MeshBasicMaterial({color:'#fff1bb'}));
 nightTip.rotation.x=Math.PI/2;nightTip.position.z=.59;nightLauncher.add(nightTip);
 nightLauncher.visible=false;
 // Reuse the same radial glow particle texture and large bursting style as
 // the hourly fireworks. Each avatar has two reusable, GPU-batched bursts.
 // These are avatar-local so the effect travels with the person performing it.
 const nightFireworkColors=['#ff547a','#ffe57b','#81edff','#b28aff','#8bffb0','#ffc16a'];
 const nightBurstCount=150;
 const nightBursts=[];
 for(let j=0;j<2;j++){
  const positions=new Float32Array(nightBurstCount*3);
  const colors=new Float32Array(nightBurstCount*3);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const color=new THREE.Color(nightFireworkColors[j%nightFireworkColors.length]);
  for(let i=0;i<nightBurstCount;i++){
   const k=i*3,warm=.75+(i%7)*.035;
   colors[k]=color.r*warm;colors[k+1]=color.g*warm;colors[k+2]=color.b*warm;
  }
  const material=new THREE.PointsMaterial({size:1.7,map:fireworkDot,vertexColors:true,
   transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,
   alphaTest:.015,sizeAttenuation:true,fog:false});
  const cloud=new THREE.Points(geometry,material);cloud.frustumCulled=false;
  cloud.renderOrder=38;cloud.visible=false;root.add(cloud);
  const rocket=new THREE.Sprite(new THREE.SpriteMaterial({map:fireworkDot,
   color:nightFireworkColors[j%nightFireworkColors.length],transparent:true,
   opacity:.96,depthWrite:false,blending:THREE.AdditiveBlending}));
  rocket.scale.set(1.6,1.6,1);rocket.visible=false;root.add(rocket);
  nightBursts.push({cloud,rocket,positions,originX:j===0?-4.8:5.2,
   height:j===0?27:32,seed:j*.53});
 }
 parts.nightBursts=nightBursts;


 // White festival pennant with black personalized lettering, mounted on a tall hand-held pole.
 // Model is attached to the avatar root so it follows movement but stays upright.
 const poleGroup=new THREE.Group();root.add(poleGroup);parts.flagGroup=poleGroup;
 poleGroup.visible=Boolean(p.flagText||p.flagImage);
 const poleMaterial=new THREE.MeshStandardMaterial({color:'#b8bbc0',roughness:.39,metalness:.48});
 // Twice the v101 pole length (4.65 -> 9.30 world units). Keep the grip base fixed.
 const poleHeight=9.30,poleBaseY=.705,poleX=.93,poleZ=.2;
 const pole=new THREE.Mesh(new THREE.CylinderGeometry(.039,.044,poleHeight,10),poleMaterial);
 pole.position.set(poleX,poleBaseY+poleHeight/2,poleZ);pole.castShadow=false;poleGroup.add(pole);
 const poleTopY=poleBaseY+poleHeight;
 const finial=new THREE.Mesh(new THREE.SphereGeometry(.095,10,8),mat('#e0e3e6',.35));finial.position.set(poleX,poleTopY+.06,poleZ);poleGroup.add(finial);
 const clothCanvas=document.createElement('canvas');clothCanvas.width=1024;clothCanvas.height=576;
 const clothCtx=clothCanvas.getContext('2d');
 clothCtx.fillStyle='#ffffff';clothCtx.fillRect(0,0,clothCanvas.width,clothCanvas.height);
 const lettering=(p.flagText||'').trim().slice(0,32);
 const glyphs=[...lettering];const lines=[];
 if(glyphs.length<=12)lines.push(lettering);
 else{const cut=Math.ceil(glyphs.length/2);lines.push(glyphs.slice(0,cut).join(''),glyphs.slice(cut).join(''));}
 // Draw after measuring to keep long Korean/Latin strings inside the pennant.
 const maxTextWidth=900;
 clothCtx.fillStyle='#080808';clothCtx.textAlign='center';clothCtx.textBaseline='middle';
 clothCtx.font=`900 ${lines.length===1?150:122}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
 lines.forEach((line,i)=>clothCtx.fillText(line,512,lines.length===1?286:198+i*170,maxTextWidth));
 const clothTexture=new THREE.CanvasTexture(clothCanvas);clothTexture.colorSpace=THREE.SRGBColorSpace;clothTexture.anisotropy=8;
 if(p.flagImage){
  const url='/api/flag-image/'+encodeURIComponent(p.flagImage);
  new THREE.TextureLoader().load(url,texture=>{
   texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
   if(parts.flagFabricMaterial){parts.flagFabricMaterial.map=texture;parts.flagFabricMaterial.needsUpdate=true;}
   clothTexture.dispose();
  },undefined,()=>{/* If unavailable, keep the white cloth as fallback. */});
 }
 // The cloth pivots around the pole so its black lettering can face the camera.
 const flagPivot=new THREE.Group();flagPivot.position.set(poleX,poleTopY,poleZ);poleGroup.add(flagPivot);parts.flagPivot=flagPivot;
 const fabricMaterial=new THREE.MeshBasicMaterial({map:clothTexture,side:THREE.DoubleSide,toneMapped:false,depthWrite:true});parts.flagFabricMaterial=fabricMaterial;
 const fabric=new THREE.Mesh(new THREE.PlaneGeometry(3.02,1.7),fabricMaterial);
 fabric.position.set(1.51,-.85,0);fabric.castShadow=false;flagPivot.add(fabric);
 const hem=new THREE.Mesh(new THREE.BoxGeometry(3.02,.055,.025),mat('#e0e0e0'));
 hem.position.set(1.51,-.025,0);flagPivot.add(hem);
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
 // Wooden skewer + roasting marshmallow; one lightweight mesh group per avatar.
 const marshmallowStick=new THREE.Group();root.add(marshmallowStick);parts.marshmallowStick=marshmallowStick;
 const stickMat=mat('#b99a65',.95);
 const stickMesh=child(marshmallowStick,new THREE.CylinderGeometry(.025,.028,1.65,7),stickMat,[0,0,.73]);
 stickMesh.rotation.x=Math.PI/2;
 const marshMat=new THREE.MeshStandardMaterial({color:'#fff5e3',roughness:.89,emissive:'#b47c39',emissiveIntensity:.07});
 const marsh=child(marshmallowStick,new THREE.CylinderGeometry(.18,.18,.38,14),marshMat,[0,0,1.62]);
 marsh.rotation.x=Math.PI/2;
 const toastedStripe=new THREE.Mesh(new THREE.CylinderGeometry(.183,.183,.075,14),new THREE.MeshStandardMaterial({color:'#d49a5e',roughness:1}));
 toastedStripe.rotation.x=Math.PI/2;toastedStripe.position.z=1.52;marshmallowStick.add(toastedStripe);
 marshmallowStick.visible=false;

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
 // Bubble blaster: fixed to the avatar's right-hand zone, barrel faces +Z.
 const bubbleGun=new THREE.Group();root.add(bubbleGun);parts.bubbleGun=bubbleGun;
 bubbleGun.position.set(.72,1.85,.62);bubbleGun.visible=false;
 const gunBody=new THREE.MeshStandardMaterial({color:'#75d5ee',roughness:.3,metalness:.12});
 const gunAccent=new THREE.MeshStandardMaterial({color:'#f4a8da',roughness:.4});
 const gunNozzle=new THREE.MeshStandardMaterial({color:'#f6e8a4',roughness:.34});
 child(bubbleGun,new THREE.BoxGeometry(.27,.27,.48),gunBody,[0,0,.12]);
 child(bubbleGun,new THREE.CylinderGeometry(.105,.105,.31,12),gunNozzle,[0,.02,.46]).rotation.x=Math.PI/2;
 child(bubbleGun,new THREE.BoxGeometry(.11,.31,.12),gunAccent,[0,-.26,-.06]);
 child(bubbleGun,new THREE.SphereGeometry(.09,10,8),gunAccent,[0,.15,.03]);
 // Bubbles are attached to the player root, so all spectators see the same effect.
 // Individual geometry/material ownership ensures safe avatar disposal.
 parts.soapBubbles=[];
 const bubbleCount=perfWeakDevice?14:30;
 const bubbleGeometry=new THREE.SphereGeometry(1,10,8);
 const soapTints=['#bdf9ff','#d5bbff','#f9d9f1','#c8ffdf'];
 const soapMaterials=soapTints.map(color=>new THREE.MeshPhongMaterial({color,transparent:true,opacity:.56,shininess:110,specular:'#ffffff',depthWrite:false,side:THREE.FrontSide}));
 for(let i=0;i<bubbleCount;i++){
  const b=new THREE.Mesh(bubbleGeometry,soapMaterials[i%soapMaterials.length].clone());
  b.visible=false;b.renderOrder=36;root.add(b);parts.soapBubbles.push(b);
 }
 parts.bubbleBurstOrigin=performance.now();
 // Heart bow reaction: a pastel bow held at chest height, with a heart-tipped
 // arrow that launches forward on a visible arc. Root attachment keeps the
 // projectile and the held prop synchronised for all spectators.
 const heartBow=new THREE.Group();root.add(heartBow);parts.heartBow=heartBow;
 heartBow.visible=false;heartBow.position.set(-.08,1.52,.56);
 const heartBowMat=new THREE.MeshStandardMaterial({color:'#ff7cab',roughness:.38,metalness:.08});
 const heartGripMat=new THREE.MeshStandardMaterial({color:'#fff0f6',roughness:.55,metalness:.06});
 const heartStringMat=new THREE.MeshBasicMaterial({color:'#fff7fd'});
 const bowArc=new THREE.Mesh(new THREE.TorusGeometry(.48,.038,7,28,Math.PI*1.04),heartBowMat);
 bowArc.rotation.z=Math.PI/2;heartBow.add(bowArc);
 const bowGrip=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.32,8),heartGripMat);
 heartBow.add(bowGrip);
 const bowString=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.88,6),heartStringMat);
 heartBow.add(bowString);parts.heartBowString=bowString;
 function makeHeartArrow(){
  const g=new THREE.Group();
  const shaft=child(g,new THREE.CylinderGeometry(.022,.022,1.34,8),new THREE.MeshStandardMaterial({color:'#f4d9c8',roughness:.84}),[0,0,.18]);
  shaft.rotation.x=Math.PI/2;
  const fletchMat=new THREE.MeshStandardMaterial({color:'#f7a0c0',roughness:.68});
  const leftFletch=child(g,new THREE.ConeGeometry(.075,.18,8),fletchMat,[-.06,0,-.44]);leftFletch.rotation.z=Math.PI/2;
  const rightFletch=child(g,new THREE.ConeGeometry(.075,.18,8),fletchMat,[.06,0,-.44]);rightFletch.rotation.z=-Math.PI/2;
  const heartMat=new THREE.MeshStandardMaterial({color:'#ff5b98',roughness:.36,emissive:'#ff7fb2',emissiveIntensity:.12});
  child(g,new THREE.SphereGeometry(.085,10,8),heartMat,[-.06,.055,.92]);
  child(g,new THREE.SphereGeometry(.085,10,8),heartMat,[.06,.055,.92]);
  const heartPoint=child(g,new THREE.ConeGeometry(.13,.20,12),heartMat,[0,-.055,.92]);heartPoint.rotation.z=Math.PI;
  return g;
 }
 const heartHeldArrow=makeHeartArrow();heartBow.add(heartHeldArrow);parts.heartHeldArrow=heartHeldArrow;
 const heartFlightArrow=makeHeartArrow();root.add(heartFlightArrow);heartFlightArrow.visible=false;parts.heartFlightArrow=heartFlightArrow;
 parts.smokePuffs=[];
 for(let i=0;i<6;i++){
  const puff=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:'#dbe1e5',transparent:true,opacity:0,depthWrite:false}));
  puff.visible=false;puff.renderOrder=21;upper.add(puff);parts.smokePuffs.push(puff);
 }
 // One crisp sprite for [badge][nickname] above every avatar.
 const cv=document.createElement('canvas');cv.width=768;cv.height=128;const ctx=cv.getContext('2d');
 const nickname=(p.name||'ROCKER').slice(0,18);
 ctx.font='900 53px Arial, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
 const textWidth=Math.min(560,ctx.measureText(nickname).width);
 const beginning=(768-(84+textWidth))/2;
 ctx.fillStyle='#fff';ctx.fillText(nickname,beginning+84,65,560);
 const texture=new THREE.CanvasTexture(cv);
 const tag=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));tag.scale.set(6,1.04,1);tag.position.y=3.66;root.add(tag);parts.tag=tag;
 const kingCanvas=document.createElement('canvas');kingCanvas.width=960;kingCanvas.height=160;const kctx=kingCanvas.getContext('2d');const kingGrad=kctx.createLinearGradient(80,0,880,0);kingGrad.addColorStop(0,'#ff6eb7');kingGrad.addColorStop(.25,'#ffcf6a');kingGrad.addColorStop(.5,'#7bf0ff');kingGrad.addColorStop(.75,'#9c83ff');kingGrad.addColorStop(1,'#7dff99');kctx.font='900 86px Arial, sans-serif';kctx.textAlign='center';kctx.textBaseline='middle';kctx.strokeStyle='rgba(25,13,45,.92)';kctx.lineWidth=18;kctx.strokeText('내가 박자왕',480,82);kctx.fillStyle=kingGrad;kctx.fillText('내가 박자왕',480,82);const kingTexture=new THREE.CanvasTexture(kingCanvas);kingTexture.colorSpace=THREE.SRGBColorSpace;const kingTitle=new THREE.Sprite(new THREE.SpriteMaterial({map:kingTexture,transparent:true,depthTest:false}));kingTitle.scale.set(7.4,1.24,1);kingTitle.position.y=4.96;kingTitle.visible=Boolean(p.rhythmKing);root.add(kingTitle);parts.rhythmTitle=kingTitle;parts.rhythmSparkles=[];const sparkleGeo=new THREE.OctahedronGeometry(.12,0);const sparkleColors=['#ff79c5','#ffe46f','#81d9ff','#a688ff','#89ffb0'];for(let i=0;i<16;i++){const star=new THREE.Mesh(sparkleGeo,new THREE.MeshBasicMaterial({color:sparkleColors[i%sparkleColors.length],transparent:true,opacity:.94}));star.visible=false;star.renderOrder=40;root.add(star);parts.rhythmSparkles.push(star);}
 const badgeImage=new Image();badgeImage.src=badgeIconUrl(p.badgeTier);
 badgeImage.onload=()=>{ctx.drawImage(badgeImage,beginning,29,66,66);texture.needsUpdate=true;};
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
 return {root,parts,color:p.color,lastAction:'idle',beatkingYaw:0};
}

// Chat bubbles are true 3D sprites anchored in world coordinates, independent of avatar pose.
function bubbleTexture(message){
 // v158: much larger glyphs, proportionally larger bubble and a fourth
 // line when needed. Fit text by measured pixel width, not character count.
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=460;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1024,460);
 ctx.fillStyle='rgba(255,255,255,.98)';ctx.strokeStyle='#283044';ctx.lineWidth=9;
 ctx.beginPath();ctx.roundRect(18,18,988,375,46);ctx.fill();ctx.stroke();
 ctx.beginPath();ctx.moveTo(468,394);ctx.lineTo(512,440);ctx.lineTo(556,394);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle='#171d31';ctx.textAlign='center';ctx.textBaseline='middle';
 const chars=Array.from(String(message||''));
 const wrap=(size)=>{
  ctx.font=`900 ${size}px system-ui, sans-serif`;
  const rows=[];let line='';
  for(const ch of chars){
   if(ctx.measureText(line+ch).width>900&&line){rows.push(line);line=ch;}
   else line+=ch;
  }
  if(line)rows.push(line);
  return rows;
 };
 let fontSize=84,lines=wrap(fontSize);
 while(lines.length>4&&fontSize>46){fontSize-=2;lines=wrap(fontSize)}
 if(lines.length>4){
  lines=lines.slice(0,4);let last=lines[3];
  while(ctx.measureText(last+'…').width>900&&last.length)last=last.slice(0,-1);
  lines[3]=last+'…';
 }
 // Vertically center one to four lines inside the main white balloon.
 const lineHeight=fontSize*1.10,top=200-(lines.length-1)*lineHeight/2;
 ctx.font=`900 ${fontSize}px system-ui, sans-serif`;
 lines.forEach((l,i)=>ctx.fillText(l,512,top+i*lineHeight,900));
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function showBubble(entry){
 if(!entry||!entry.playerId||!state.players.has(entry.playerId))return;
 const old=activeBubbles.get(entry.playerId);
 if(old){scene.remove(old.sprite);old.sprite.material.map.dispose();old.sprite.material.dispose()}
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:bubbleTexture(entry.message),transparent:true,depthTest:false,depthWrite:false}));
 // v158: keep the physical speech bubble proportional to the larger glyphs.
 sprite.scale.set(6.8,3.05,1);sprite.renderOrder=150;scene.add(sprite);if(stageForeground)sprite.layers.set(1);
 activeBubbles.set(entry.playerId,{sprite,expires:performance.now()+3800});
}

function updateBubbles(now){
 for(const [id,b] of activeBubbles){
  const a=avatars.get(id);
  if(!a||now>=b.expires){scene.remove(b.sprite);b.sprite.material.map.dispose();b.sprite.material.dispose();activeBubbles.delete(id);continue}
  b.sprite.position.set(a.root.position.x,a.root.position.y+5.74,a.root.position.z);
  b.sprite.material.opacity=Math.min(1,(b.expires-now)/350);
 }
}
const SERVER_X_MIN=20,SERVER_X_MAX=1380,SERVER_Y_MIN=60,SERVER_Y_MAX=1100;
function toWorld(p){return {x:(p.x-600)*.058,z:expandWorldZ((p.y-500)*.058+8)}}
function clampServerX(v){return Math.max(SERVER_X_MIN,Math.min(SERVER_X_MAX,v))}
function clampServerY(v){return Math.max(SERVER_Y_MIN,Math.min(SERVER_Y_MAX,v))}
// v128: front-access stage apron, two shallow stair approaches, and walkable
// elevated space. Only the red-marked forward stage zone is walkable; the rear
// backdrop and screen remain decorative. Avatars rise onto the stage when they
// enter this world-space footprint.
const STAGE_WALK_X_HALF=14.6;
const STAGE_PLATFORM_Z_MIN=-18.0,STAGE_PLATFORM_Z_MAX=-10.25;
const STAGE_PLATFORM_HEIGHT=1.82;
const STAGE_RAMP_Z_MIN=-10.25,STAGE_RAMP_Z_MAX=-7.65;
const STAGE_RAMP_X_SPANS=[[-5.8,-1.5],[1.5,5.8]];
function xInSpan(x,span){return x>=span[0]&&x<=span[1]}
function isInStageRamp(x,z){return z>=STAGE_RAMP_Z_MIN&&z<=STAGE_RAMP_Z_MAX&&STAGE_RAMP_X_SPANS.some(span=>xInSpan(x,span))}
function stageWalkHeightAt(x,z){
 if(Math.abs(x)<=STAGE_WALK_X_HALF&&z>=STAGE_PLATFORM_Z_MIN&&z<=STAGE_PLATFORM_Z_MAX)return STAGE_PLATFORM_HEIGHT;
 if(isInStageRamp(x,z)){
  const t=(STAGE_RAMP_Z_MAX-z)/(STAGE_RAMP_Z_MAX-STAGE_RAMP_Z_MIN);
  return Math.max(0,Math.min(1,t))*STAGE_PLATFORM_HEIGHT;
 }
 return 0;
}
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
 const duoContext=duoPose(q.id),surfPose=crowdSurfScene&&slamNow()<crowdSurfScene.startAt+crowdSurfScene.duration?surfPoseAt(crowdSurfScene,q.id):null;
 const act=surfPose?.action||duoContext?.action||(q.action||'idle'),basePose=surfPose||duoContext?'stand':(q.pose||((act==='sit'||act==='lie')?act:'stand'));
 const surfEvent=crowdSurfScene&&slamNow()<crowdSurfScene.startAt+crowdSurfScene.duration?crowdSurfScene:null;
 const surfView=surfPose;
 const shoulderSynced=act==='shoulder-headbang'&&shoulderSequence?.participants.includes(q.id)&&slamNow()<=shoulderSequence.until;
 const sec=shoulderSynced?(slamNow()-shoulderSequence.startAt-3000)*.001:duoContext?(Date.now()+state.serverDelta-duoContext.duo.startAt)/1000:t*.001,pose={};
 // Choreography is determined by the server start time, not by the local
 // animation clock. Observers and participants see the same drinking phase.
 const toastElapsed=act==='toast-clink'&&toastSequence?.participants.includes(q.id)
  ?Math.max(0,Math.min(6,(slamNow()-toastSequence.startAt)/1000-(toastSequence.campfireToast?3:0)))
  :0;
 const toastSmooth=(a,b)=>{const u=Math.max(0,Math.min(1,(toastElapsed-a)/(b-a)));return u*u*(3-2*u)};
 const toastDrink=toastSmooth(3.25,4.0)*(1-toastSmooth(4.75,5.5));
 let targetX=wp.x,targetZ=wp.z,duoYaw=null;
 if(surfView){const visual=toWorld(surfView);targetX=visual.x;targetZ=visual.z;}
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
 const follow=surfView?1:duoContext?.duo.anchor?.kind==='dance'?.85:duoContext?.duo.anchor?.kind==='hug'?.36:.28;
 a.root.position.x+=(targetX-a.root.position.x)*follow;
 a.root.position.z+=(targetZ-a.root.position.z)*follow;
 if(P.sash)P.sash.rotation.y=Math.PI/2+Math.sin(t*.0028)*.055;
 if(P.mdWings)P.mdWings.rotation.y=Math.sin(t*.0022)*.045;
 if(P.mdTail)P.mdTail.rotation.y=Math.sin(t*.0034)*.24;
 P.toastCup.visible=q.action==='toast-clink';
 // Both headspin and crowd-surf rotations temporarily transform the avatar ROOT.
 // Reset the root when those actions end, rather than inheriting a tilted,
 // off-centre pose into the celebration or the next walk animation.
 if((a.lastAction==='headspin'&&act!=='headspin')||
    (a.lastAction==='surf-rider'&&!surfView)){
  a.root.rotation.set(0,Number(q.facing)||0,0);
  a.root.position.y=0;
 }
 const keys=['upper','neck','leftShoulder','rightShoulder','leftElbow','rightElbow','leftHip','rightHip','leftKnee','rightKnee'];
 for(const key of keys)pose[key]=[0,0,0];
 let height=0,lean=0,ikMode=null,leftHandTarget=null,rightHandTarget=null;
 const set=(key,x=0,y=0,z=0)=>{pose[key]=[x,y,z]};
 if(act==='surf-support'){
  const wave=Math.sin(sec*7);
  set('leftShoulder',-2.25,0,-.12);set('rightShoulder',-2.25,0,.12);
  set('leftElbow',-.3);set('rightElbow',-.3);
  set('leftHip',wave*.15);set('rightHip',-wave*.15);
  height=.08+Math.abs(wave)*.06;
 }
 if(act==='surf-rider'){
  set('leftShoulder',-1.65,0,-.65);set('rightShoulder',-1.65,0,.65);
  set('leftHip',Math.sin(sec*5)*.2);set('rightHip',-Math.sin(sec*5)*.2);
 }
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
  // 0-3.25s: extend toward the centre, clink at 3s (server spark).
  // 3.25-4s: bring the cup to lips; 4-4.75s: drink;
  // 4.75-5.5s: lower cup, 5.5-6s: finish.
  const clinkReach=toastSmooth(.25,1.6)*(1-toastSmooth(3.1,3.85));
  const restReach=toastSmooth(5.15,5.75);
  const armOut=new THREE.Vector3(.42,.32,.78);
  const armMouth=new THREE.Vector3(.31,.77,.59);
  const armRest=new THREE.Vector3(.53,-.16,.29);
  rightHandTarget=armRest.clone().lerp(armOut,clinkReach).lerp(armMouth,toastDrink);
  if(restReach>0)rightHandTarget.lerp(armRest,restReach);
  ikMode='drink';
  set('leftShoulder',-.22);
  set('upper',-.04-toastDrink*.075);
  set('neck',toastDrink*.13);
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
 if(act==='freestyle'){
  // v147: larger, more expressive video-inspired freestyle and a complete
  // 360-degree on-the-spot turn halfway through every seamless 12.28s loop.
  // All motion is calculated from sec so local/remote avatars animate alike.
  const frames=[
   [ .22,-.12, .10,-.72,-1.10,-.40, .72,-.12, .05,.14,.17],
   [-.18, .20,-.04,-.32,-.55,-.86, .38, .10,-.08,.22,.14],
   [ .31,-.15, .18,-.82,-.12,-.12,1.28,-.05,-.64,.10,.30],
   [-.27, .26, .05,-.22,-1.02,-1.24, .30,-.70,.06,.18,.15],
   [ .14,-.20, .13,-1.05,-.25,-.55, .94, .12,-.08,.26,.23],
   [-.12, .11,-.08,-.28,-.68,-.80, .46,-.05, .08,.30,.19],
   [ .27,-.15, .12,-1.13,-.18,-.32, .89,-.10,-.22,.22,.25],
   [-.24, .20, .21,-.30,-1.25,-.58, .85,-.05,-.08,.34,.31],
   [ .24,-.20, .12,-1.18,-.75,-.32, .64,-.04,-.14,.26,.35],
   [-.30, .14, .26,-.65,-.30,-1.05,1.20, .08,-.08,.42,.33],
   [ .16,-.10,-.07,-2.02,-.18,-.50,1.07,-.07,-.18,.20,.26],
   [-.15, .12, .12,-.28,-1.13,-.67, .77,-.12, .03,.34,.20],
   [ .22,-.16,.05,-.82,-.60,-.35,.80,-.04,-.20,.20,.25],
   [-.11, .10,.11,-.50,-.78,-.65,.65,-.18,.03,.21,.20]
  ];
  const progress=((sec*1.14)%frames.length+frames.length)%frames.length;
  const index=Math.floor(progress),phase=progress-index;
  const smooth=phase*phase*(3-2*phase);
  const A=frames[index],B=frames[(index+1)%frames.length];
  const v=i=>A[i]+(B[i]-A[i])*smooth;
  const pulse=Math.sin(sec*8.25),beat=Math.sin(sec*4.12);
  const sway=Math.sin(sec*4.12);
  // Stronger full-body lean and long arm reaches, while keeping joints
  // within usable limits for the existing chibi avatar skeleton.
  set('upper',v(2)*1.55+.075*Math.max(0,beat),v(1)*1.55,v(0)*1.85);
  set('neck',-.065-.15*v(2),-.48*v(1),-.48*v(0));
  set('leftShoulder',Math.max(-2.75,v(3)*1.34-.12*Math.max(0,sway)),.22*Math.sin(sec*2.6),Math.max(-1.70,Math.min(1.70,v(5)*1.24)));
  set('rightShoulder',Math.max(-2.75,v(4)*1.34+.12*Math.min(0,sway)),-.20*Math.sin(sec*2.6),Math.max(-1.70,Math.min(1.70,v(6)*1.24)));
  set('leftElbow',-.54-.26*Math.max(0,beat));
  set('rightElbow',-.54-.26*Math.max(0,-beat));
  set('leftHip',v(7)*1.55-.26*Math.max(0,beat),0,-.22*v(0));
  set('rightHip',v(8)*1.55-.26*Math.max(0,-beat),0,-.22*v(0));
  set('leftKnee',v(9)*1.55+.25*Math.max(0,beat));
  set('rightKnee',v(10)*1.55+.25*Math.max(0,-beat));
  height=-.035+Math.abs(pulse)*.17;
  // One full turn through the middle of each 14-keyframe sequence.
  // This is applied to root yaw below (NOT the torso), and resets
  // naturally at loop boundaries because 2pi and 0 have the same pose.
  const turnPhase=Math.max(0,Math.min(1,(progress-6.0)/3.0));
  const turnEase=turnPhase*turnPhase*(3-2*turnPhase);
  a.freestyleYaw=Math.PI*2*turnEase;
 }else{a.freestyleYaw=0;}
 if(act==='beatking'){
  const cycle=sec%4.6;
  const spinPhase=Math.min(1,cycle/2.2);
  const spinEase=spinPhase*spinPhase*(3-2*spinPhase);
  a.beatkingYaw=Math.PI*6*spinEase;
  const twirl=Math.sin(sec*8.5);
  height=.08+Math.max(0,Math.sin(sec*7.4))*.08;
  set('upper',-.04,.06*Math.sin(sec*4.2),-.10);
  set('neck',.09,-.05*Math.sin(sec*4.2),.05);
  set('leftShoulder',-.96+.12*Math.sin(sec*4.2),0,-.72);
  set('rightShoulder',-1.34,0,.92);
  set('leftElbow',-.52);set('rightElbow',-.18);
  set('leftHip',-.10+.08*Math.max(0,Math.sin(sec*4.2)),0,-.10);
  set('rightHip',-.10+.08*Math.max(0,-Math.sin(sec*4.2)),0,.10);
  set('leftKnee',.26+.08*Math.max(0,twirl));set('rightKnee',.26+.08*Math.max(0,-twirl));
 }else a.beatkingYaw=0;
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
 if(act==='skanking'||act==='slam-celebrate'||act==='rock-skank'){
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
 if(act==='bubblegun'){
  // The right hand points the blaster away from the player, not into the face.
  rightHandTarget=new THREE.Vector3(.72,.48,.64);
  ikMode='bubblegun';
  set('rightShoulder',-.47,0,.18);
  set('rightElbow',-.50);
  set('upper',.018,0,.025*Math.sin(sec*2.5));
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
 if(act==='putyourhandsup'){
  // Both arms remain HIGH ABOVE the head while pumping forward and backward.
  // Swing the raised arms around the shoulder joints rather than lowering them to chest height.
  const leftBeat=Math.sin(sec*5.6);
  const rightBeat=Math.sin(sec*5.6+.35);
  set('leftShoulder',-2.78+.28*leftBeat,0,-.20);
  set('rightShoulder',-2.78+.28*rightBeat,0,.20);
  set('leftElbow',-.10-.12*Math.sin(sec*5.6+.4));
  set('rightElbow',-.10-.12*Math.sin(sec*5.6+.75));
  set('upper',.035*Math.sin(sec*5.6));
 }
 if(act==='nightfirework'){
  // Hold the launcher above the face, pointing away from the avatar.
  set('rightShoulder',-2.18,0,.12);
  set('rightElbow',-.22);
  set('leftShoulder',-.54,0,-.12);
  set('upper',-.025+.025*Math.sin(sec*3.5));
 }
 if(act==='heartbow'){
  const cycle=2.65;
  const phase=sec%cycle;
  const draw=THREE.MathUtils.clamp(phase/.95,0,1);
  const release=THREE.MathUtils.clamp((phase-1.02)/.16,0,1);
  const pull=draw*(1-release);
  leftHandTarget=new THREE.Vector3(-.29,.49,.57);
  rightHandTarget=new THREE.Vector3(.26,.48,.56-.34*pull);
  ikMode='heartbow';
  set('upper',-.03+.03*Math.sin(sec*3.2));
  set('neck',-.02,.05,0);
 }
 if(act==='marshmallow'){
  const roast=Math.sin(sec*2.1);
  rightHandTarget=new THREE.Vector3(.52,.23+.07*roast,.53);
  ikMode='marshmallow';
  set('upper',.04);
  set('neck',-.018);
 }
 if(act==='snack'){
  // Keep the oversized chibi head unobstructed: hand reaches the lower-right mouth.
  const chew=(1+Math.sin(sec*11.5))*.5;
  rightHandTarget=new THREE.Vector3(.33,.82+.06*chew,.60);
  ikMode='snack';
  set('neck',Math.sin(sec*15)*.085,Math.sin(sec*7)*.04,Math.sin(sec*10)*.03);
  set('upper',.025);
 }
 if(act==='headbang'||act==='shoulder-headbang'){
  // Head and waist are driven by the SAME phase: bow down together,
  // rise together. Never run a separate double-tempo neck oscillation.
  // Keep the slower waist tempo introduced in v131.
  const fold=(1-Math.cos(sec*5.2))*.5;
  if(basePose==='stand'){
   set('upper',.06+fold*1.04);
   set('neck',-.03+fold*.38);
   set('leftHip',-fold*.17);set('rightHip',-fold*.17);
   set('leftKnee',fold*.24);set('rightKnee',fold*.24);
   if(act==='shoulder-headbang'){
    // Both arms stay spread across neighbours' shoulders during the bow.
    set('leftShoulder',-.12-fold*.10,0,-1.28);
    set('rightShoulder',-.12-fold*.10,0,1.28);
    set('leftElbow',-.12);set('rightElbow',-.12);
   }else{
    set('leftShoulder',.10+fold*.24,0,-.12);
    set('rightShoulder',.10+fold*.24,0,.12);
   }
  }else if(basePose==='sit'){
   set('upper',.05+fold*.76);
   set('neck',-.025+fold*.30);
  }else{
   set('neck',-.02+fold*.17);
  }
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
  if(act==='headbang')set('neck',-.02+((1-Math.cos(sec*5.2))*.5)*.17,0,0);
 }
 // Only the Buriburi dance slides the torso laterally; return smoothly on exit.
 const hipSlide=act==='buriburi'?Math.sin(sec*9.5)*.14:0;
 P.upper.position.x+=(hipSlide-P.upper.position.x)*.38;
 const alpha=act===a.lastAction?.25:.17;
 for(const k of keys){
  if((ikMode==='duo-both'&&['leftShoulder','leftElbow','rightShoulder','rightElbow'].includes(k))||(ikMode==='duo-right'&&['rightShoulder','rightElbow'].includes(k)))continue;
  if((ikMode==='clap'||ikMode==='heartbow')&&['leftShoulder','leftElbow','rightShoulder','rightElbow'].includes(k))continue;
  if((ikMode==='drink'||ikMode==='wave'||ikMode==='snack'||ikMode==='smoke'||ikMode==='bubblegun'||ikMode==='marshmallow')&&['rightShoulder','rightElbow'].includes(k))continue;
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
 }else if(ikMode==='heartbow'){
  placeHandIK(P,'left',leftHandTarget,.62);
  placeHandIK(P,'right',rightHandTarget,.7);
 }else if(ikMode==='drink')placeHandIK(P,'right',rightHandTarget,.58);
 else if(ikMode==='wave')placeHandIK(P,'right',rightHandTarget,.64);
 else if(ikMode==='snack')placeHandIK(P,'right',rightHandTarget,.56);
 else if(ikMode==='smoke')placeHandIK(P,'right',rightHandTarget,.66);
 else if(ikMode==='bubblegun')placeHandIK(P,'right',rightHandTarget,.7);
 else if(ikMode==='marshmallow')placeHandIK(P,'right',rightHandTarget,.68);
 // Keep the right hand gripping the tall flag pole during walking or idle.
 // Complex dances temporarily take precedence without deleting the flag.
 const canGripFlag=Boolean(q.flagText||q.flagImage)&&basePose==='stand'&&!duoContext&&
  ['idle','walk','run','peace','jump'].includes(act);
 if(canGripFlag)placeHandIK(P,'right',new THREE.Vector3(.88,.32,.21),.64);
 P.flagGroup.visible=Boolean(q.flagText||q.flagImage);
 const avatarWorld=toWorld(q);
 height+=stageWalkHeightAt(avatarWorld.x,avatarWorld.z);
 // Seat is higher than the grass; raise the seated avatar to the bench cushion.
 if(basePose==='sit'&&benchSeats.some(seat=>Math.hypot(q.x-seat.x,q.y-seat.y)<24))height+=.46;
 // Surfer height and orientation are resolved together below using a
 // body-centre pivot. Never lift the old feet-origin pivot separately: that
 // made the spinning chibi orbit like a satellite around the other players.
 const surfing=Boolean(surfView?.mounted);
 a.root.position.y+=(height-a.root.position.y)*(surfView?1:.28);
 a.root.rotation.x+=(lean-a.root.rotation.x)*.22;
 // While breakdancing, rotate the whole prone body around its center, not just its chest.
 // B-boy freeze tilts into a stable one-handed inversion rather than continuous windmill spinning.
 const zTarget=surfing?(-Math.PI/2)*surfView.mount:act==='headspin'?Math.PI:(act==='windmill'?2.80+.055*Math.sin(sec*2.5):0);
 a.root.rotation.z+=(zTarget-a.root.rotation.z)*.17;
 if(act==='toast-clink'){
  // Track the hand even when both shoulder and elbow move during the clink.
  // A root-attached cup doesn't inherit the arm's rotation (which tipped it over).
  a.root.updateMatrixWorld(true);
  const handWorld=P.rightElbow.localToWorld(new THREE.Vector3(0,-.58,.08));
  P.toastCup.position.copy(a.root.worldToLocal(handWorld));
  P.toastCup.quaternion.copy(a.root.getWorldQuaternion(new THREE.Quaternion()).invert());
  // Tip the cup toward the mouth only during the drinking phase.
  P.toastCup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.60*toastDrink));
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
 P.bubbleGun.visible=act==='bubblegun';
 // Staggered cycles make a continuous stream of soap bubbles, each starting
 // at the gun's nozzle, spreading radially as it travels forward and rises.
 P.soapBubbles.forEach((bubble,i)=>{
  if(act!=='bubblegun'){bubble.visible=false;return}
  const phase=(sec*.31+i/P.soapBubbles.length)%1;
  const seed=i*2.3999632297;
  const spread=phase*phase*4.7;
  const dx=Math.sin(seed)*(.28+((i*7)%9)*.08);
  const dy=Math.cos(seed*1.37)*(.24+((i*3)%7)*.08);
  bubble.position.set(.72+dx*spread+Math.sin(sec*1.4+i)*phase*.15,
   1.85+dy*spread+phase*2.0,1.21+phase*8.0);
  const radius=(.075+(i%5)*.024)*(1+.65*phase);
  bubble.scale.setScalar(radius);
  bubble.material.opacity=.56*(1-THREE.MathUtils.smoothstep(phase,.72,1));
  bubble.visible=true;
 });
 if(P.rhythmTitle){P.rhythmTitle.visible=Boolean(q.rhythmKing);P.rhythmTitle.position.y=4.96+Math.sin(sec*3.5)*.05;}
 if(P.rhythmSparkles){P.rhythmSparkles.forEach((spark,i)=>{if(act!=='beatking'){spark.visible=false;return}const phase=(sec*1.8+i/5)%1;const angle=phase*Math.PI*2+i*.7;const band=(i%2?1:-1);spark.visible=true;spark.position.set(Math.cos(angle)*(1.1+phase*.5),1.1+Math.sin(phase*Math.PI*2+band)*1.1+phase*.9,.45+Math.sin(angle*1.4)*.7);const sc=.55+.35*Math.sin(phase*Math.PI);spark.scale.setScalar(sc);spark.rotation.x=sec*2.2+i;spark.rotation.y=sec*3.1+i;});}
 if(P.glowsticks){
  const enabled=Boolean(q.glowEnabled);
  const key=glowstickColors[q.glowColor]?q.glowColor:'lime';
  const hue=(sec*.16)%1;
  for(let i=0;i<P.glowsticks.length;i++){
   const stick=P.glowsticks[i];stick.group.visible=enabled;
   if(!enabled)continue;
   const c=key==='rainbow'?new THREE.Color().setHSL((hue+i*.20)%1,1,.62):new THREE.Color(glowstickColors[key]);
   stick.rodMat.color.copy(c);stick.haloMat.color.copy(c);
   stick.haloMat.opacity=.20+.055*Math.sin(sec*8+i);
  }
 }
 if(P.heartBow){
  const active=act==='heartbow';
  P.heartBow.visible=active;
  if(active){
   const cycle=2.65;
   const phase=sec%cycle;
   const draw=THREE.MathUtils.clamp(phase/.95,0,1);
   const release=THREE.MathUtils.clamp((phase-1.02)/.16,0,1);
   const pull=draw*(1-release);
   P.heartBow.position.set(-.08,1.52+.015*Math.sin(sec*3.2),.56);
   P.heartBow.rotation.set(.02*Math.sin(sec*2.5),-.08,.10);
   if(P.heartBowString)P.heartBowString.scale.y=1-.08*pull;
   if(P.heartHeldArrow){
    P.heartHeldArrow.visible=phase<1.14;
    if(P.heartHeldArrow.visible){
     P.heartHeldArrow.position.set(.10,0,.08-.34*pull);
     P.heartHeldArrow.rotation.set(0,0,0);
    }
   }
   if(P.heartFlightArrow){
    const fly=phase-1.08;
    const visible=fly>=0&&fly<1.25;
    P.heartFlightArrow.visible=visible;
    if(visible){
     const u=fly/1.25;
     P.heartFlightArrow.position.set(.02+.55*u,1.53+2.45*u-2.75*u*u,1.02+8.9*u);
     P.heartFlightArrow.rotation.set(.58*(u-.45),-.06,.02);
    }
   }
  }else{
   if(P.heartHeldArrow)P.heartHeldArrow.visible=false;
   if(P.heartFlightArrow)P.heartFlightArrow.visible=false;
  }
 }
 if(P.nightLauncher){
  const firing=act==='nightfirework';
  P.nightLauncher.visible=firing;
  P.nightLauncher.rotation.x=-Math.PI/2+.07*Math.sin(sec*4);
  if(P.nightBursts){
   // One volley repeats every 5 seconds. Each rocket rises for 0.95 seconds;
   // the subsequent 3.3-second burst spans ~20-25 world units across the sky.
   const cycle=5.0;
   for(let j=0;j<P.nightBursts.length;j++){
    const f=P.nightBursts[j],phase=(sec+j*2.5)%cycle;
    if(!firing){f.cloud.visible=false;f.rocket.visible=false;continue;}
    const rise=.95,burst=phase-rise;
    f.rocket.visible=phase<rise;
    if(f.rocket.visible){
     const u=phase/rise;
     f.rocket.position.set(f.originX*u,2.5+(f.height-2.5)*u*u,.5);
     f.rocket.material.opacity=.95-.12*u;
    }
    f.cloud.visible=burst>=0&&burst<3.35;
    if(!f.cloud.visible)continue;
    const fade=burst<.18?burst/.18:Math.pow(Math.max(0,1-(burst-.18)/3.17),1.15);
    f.cloud.material.opacity=fade*.97;
    const drag=(1-Math.exp(-burst*.52))/.52;
    const pos=f.positions;
    const count=pos.length/3;
    for(let i=0;i<count;i++){
     const v=1-2*(i+.5)/count;
     const theta=i*2.399963229728653+f.seed;
     const ring=Math.sqrt(Math.max(0,1-v*v));
     const speed=7.8+((i*73+j*19)%61)/61*5.6;
     const k=i*3;
     pos[k]=f.originX+Math.cos(theta)*ring*speed*drag;
     pos[k+1]=f.height+v*speed*drag-2.6*burst*burst;
     pos[k+2]=.5+Math.sin(theta)*ring*speed*drag;
    }
    f.cloud.geometry.attributes.position.needsUpdate=true;
   }
  }
 }
 if(P.marshmallowStick){
  P.marshmallowStick.visible=act==='marshmallow';
  if(P.marshmallowStick.visible){
   P.marshmallowStick.position.set(.52,1.44+.05*Math.sin(sec*2.1),.57);
   P.marshmallowStick.rotation.set(-.07+.055*Math.sin(sec*1.7),.10*Math.sin(sec*1.25),.07*Math.sin(sec*1.5));
  }
 }
 P.rockBubble.visible=act==='peace'||act==='slam-retreat'||act==='slam-celebrate'||act==='rock-skank';P.bottle.visible=act==='drink';
 if(P.rockBubble.visible)P.rockBubble.position.y=4.34+Math.sin(sec*7)*.075;
 if(act==='headspin'){
  // Keep yaw bounded; absolute elapsed page seconds would grow without limit.
  a.root.rotation.y=(sec*8.2)%(Math.PI*2);
 }else if(basePose!=='lie'&&act!=='lie'){
  const yaw=duoYaw??(Number(q.facing)||0);
  if(act==='freestyle'){
   // Explicit full revolution: wrapping via shortest-angle interpolation
   // would otherwise erase the spin entirely. All avatars use the same pose clock.
   a.root.rotation.y=yaw+(a.freestyleYaw||0);
  }else if(act==='beatking'){
   a.root.rotation.y=yaw+(a.beatkingYaw||0);
  }else{
   a.root.rotation.y=((a.root.rotation.y%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
   const delta=Math.atan2(Math.sin(yaw-a.root.rotation.y),Math.cos(yaw-a.root.rotation.y));
   a.root.rotation.y+=delta*.2;
  }
 }
 if(surfView?.mounted){
  // BARREL ROLL: lay the avatar horizontally with head toward world Z,
  // then spin around its own LONG axis (world Z). Yaw would spin like a top,
  // which is NOT what sideways rolling means.
  const mount=surfView.mount;
  const lieDown=new THREE.Quaternion().setFromAxisAngle(
   new THREE.Vector3(1,0,0),Math.PI/2*mount);
  const barrel=new THREE.Quaternion().setFromAxisAngle(
   new THREE.Vector3(0,0,1),surfView.roll);
  a.root.quaternion.copy(barrel).multiply(lieDown);
  // Avatar origin sits at its feet. Offset it so the centre of the body
  // stays above supporters, unaffected by the body's own-axis rotation.
  const pivotOffset=new THREE.Vector3(0,1.65,0).applyQuaternion(a.root.quaternion);
  const chestY=THREE.MathUtils.lerp(1.65,4.45,mount);
  a.root.position.set(targetX-pivotOffset.x,chestY-pivotOffset.y,targetZ-pivotOffset.z);
 }else if(surfView){
  a.root.rotation.x=0;a.root.rotation.z=0;
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
// Continuous lightweight mosh dust, visible locally for EVERY synchronized
// mosh participant. Emission starts on the very first moving frame.
const moshTrailLastEmission=new Map();
function spawnMoshTrail(x,y,t){
 const center=toWorld({x,y});
 let emitted=0;
 for(const particle of slamDustParticles){
  if(particle.active)continue;
  const angle=(t*.011+emitted*2.39996)%(Math.PI*2);
  particle.x=center.x+Math.cos(angle)*.28;
  particle.z=center.z+Math.sin(angle)*.28;
  particle.y=.13;
  particle.vx=Math.cos(angle)*.004;
  particle.vz=Math.sin(angle)*.004;
  particle.vy=.004+emitted*.001;
  particle.size=.13+emitted*.025;
  particle.duration=450+emitted*65;
  particle.start=t;particle.active=true;
  particle.mesh.visible=true;
  particle.mesh.position.set(particle.x,particle.y,particle.z);
  if(++emitted>=3)break;
 }
}
function updateMoshTrails(t){
 const activeIds=new Set();
 if(state.me&&rockMotion?.kind==='mosh'&&!rockMotion.phase){
  activeIds.add(state.id);
  if(t-(moshTrailLastEmission.get(state.id)||-Infinity)>145){
   spawnMoshTrail(state.me.x,state.me.y,t);
   moshTrailLastEmission.set(state.id,t);
  }
 }
 for(const [id,p] of state.players){
  if(id===state.id||p.action!=='mosh-charge')continue;
  activeIds.add(id);
  if(t-(moshTrailLastEmission.get(id)||-Infinity)>170){
   spawnMoshTrail(p.x,p.y,t);
   moshTrailLastEmission.set(id,t);
  }
 }
 for(const id of moshTrailLastEmission.keys())if(!activeIds.has(id))moshTrailLastEmission.delete(id);
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
 groundRay.setFromCamera(pointer,camera);
 if(!rockPlacementMode&&!slamMode&&groundRay.intersectObjects(mdBoothTargets,false).length){openPunkShop();return;}
 if(!groundRay.ray.intersectPlane(groundPlane,hit))return;
 const x=clampServerX(hit.x/.058+600),y=clampServerY((contractWorldZ(hit.z)-8)/.058+500);
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
 if(rockMotion&&!(rockMotion.kind==='train'&&rockMotion.leaderId===state.id))finishRockMotion();
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
   if(material.userData?.mdPrintTexture)textures.add(material.userData.mdPrintTexture);
  }
 });
 // Collect first; a shared material may be referenced by more than one mesh.
 // Per-avatar resources are created anew, while imported hair geometry is cloned.
 for(const geometry of geometries)geometry.dispose();
 for(const material of materials)material.dispose();
 for(const texture of textures)texture.dispose();
}
function tick(t){
 // Skip complete draw passes on slower hardware, without changing time-based
 // animations, networking or the YouTube player clock.
 requestAnimationFrame(tick);
 if(!perfLastFrameTime)perfLastFrameTime=t-perfTargetFrame;
 const elapsed=t-perfLastFrameTime;
 if(document.hidden){perfLastFrameTime=t;tick.lastFrame=t;return}
 if(elapsed+1.4<perfTargetFrame)return;
 perfLastFrameTime=t;
 const frameDelta=Math.min(50,Math.max(0,t-(tick.lastFrame??t)));tick.lastFrame=t;
 const frameStart=performance.now();
 if(state.me&&!currentDuo()){
  let dx=0,dy=0,speed=3.2,k=state.keys;
  dx+=+(k.has('d')||k.has('arrowright'))-+(k.has('a')||k.has('arrowleft'));
  dy+=+(k.has('s')||k.has('arrowdown'))-+(k.has('w')||k.has('arrowup'));
  if(dx||dy){
   state.walkTarget=null;state.benchTarget=null;
   if(slamMotion)finishSlamMotion();
   if(rockMotion&&!(rockMotion.kind==='train'&&rockMotion.leaderId===state.id))finishRockMotion();
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
      state.action='rock-skank';state.me.action='rock-skank';
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
     state.me.x=clampServerX(next.x);
     state.me.y=clampServerY(next.y);
     state.me.facing=Math.atan2(tx,ty);
     state.action=m.phase==='charge'?'slam-charge':'rock-skank';
     state.me.action=state.action;
     state.moving=true;
    }
   }
  }
  if(!dx&&!dy&&rockMotion){
   const m=rockMotion,elapsed=Math.max(0,slamNow()-m.startAt);
   // In addition to v131's continuous dust trail, restore the original
   // synchronized burst AT THE CHOSEN MOSH ZONE. The runner first crosses
   // the marker at 2/3 of the outward leg (50% of total duration) and
   // returns to that marker at the end. The server deduplicates each phase
   // for all participants and broadcasts the same burst to every viewer.
   if(m.kind==='mosh'&&!m.phase){
    if(elapsed>=m.duration*.50&&!m.dustA){
     m.dustA=true;
     post('rockplay',{id:state.id,command:'impact',eventId:m.id,phase:1,x:m.x,y:m.y}).catch(()=>{});
    }
    if(elapsed>=m.duration*.965&&!m.dustB){
     m.dustB=true;
     post('rockplay',{id:state.id,command:'impact',eventId:m.id,phase:2,x:m.x,y:m.y}).catch(()=>{});
    }
   }
   if(!m.phase&&elapsed>=m.duration){if(m.kind==='train'){freeTrainTrail=null;beginRockCelebration(m)}else if(m.kind==='toast'&&m.campfireToast){m.phase='campfire-skank';m.phaseStarted=t;state.action='slam-celebrate';state.me.action='slam-celebrate';state.actionUntil=Infinity;sendMove()}else beginRockCelebration(m)}
   if(m.phase==='campfire-skank'){
    // End the special campfire cheers with the same skank + horns, then
    // honour the pre-existing requirement to sit around the fire.
    if(t-m.phaseStarted>=2200){rockMotion=null;state.action='idle';state.me.action='idle';state.actionUntil=0;state.pose='sit';state.me.pose='sit';state.me.facing=Math.atan2(m.x-state.me.x,m.y-state.me.y);updateActionButtons();sendMove()}
   }else if(m.phase==='done'){
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
     // Run outward while performing full skanking steps and showing the horns bubble.
     const next=stepWorldToward(state.me,target,5.5*frameDelta/1000);
     state.me.x=clampServerX(next.x);
     state.me.y=clampServerY(next.y);
     state.me.facing=Math.atan2(tx,ty);
     state.action='rock-skank';state.me.action='rock-skank';
     state.moving=true;state.actionUntil=Infinity;
     if(t-state.lastSent>90){state.lastSent=t;sendMove()}
    }
   }else if(m.phase==='celebrate'){
    state.action='slam-celebrate';state.me.action='slam-celebrate';
    state.actionUntil=Infinity;
   }else if(m.kind==='train'){
    if(state.id===m.leaderId){
     // Leader stays where they are when idle; movement uses normal input code below.
     state.action=(dx||dy||state.walkTarget)?'train-run':'idle';state.me.action=state.action;
     state.moving=Boolean(dx||dy||state.walkTarget);
    }else{
     const dest=trainCarriageTarget(m.index);
     if(dest){
      const a=toWorld(state.me),b=toWorld(dest),distance=Math.hypot(b.x-a.x,b.z-a.z);
      if(distance>.15){
       const next=stepWorldToward(state.me,dest,Math.min(12,7+distance*.35)*frameDelta/1000);
       const n=toWorld(next);
       state.me.x=clampServerX(next.x);state.me.y=clampServerY(next.y);
       state.me.facing=Math.atan2(n.x-a.x,n.z-a.z);
       state.action='train-run';state.me.action='train-run';state.moving=true;
      }else{state.action='idle';state.me.action='idle';state.moving=false;}
      if(t-state.lastSent>110){state.lastSent=t;sendMove()}
     }
    }
   }else if(m.kind==='surf'){
    // Fully separate from generic rock paths, including their 8-shaped train loop.
    const surf=surfPoseAt(crowdSurfScene||m,state.id);
    if(surf){
     state.me.x=Math.max(20,Math.min(1380,surf.x));
     state.me.y=clampServerY(surf.y);
     state.me.facing=surf.facing;
     state.me.action=surf.action;state.action=surf.action;
     state.moving=surf.running;
     if(t-state.lastSent>110){state.lastSent=t;sendMove()}
    }
   }else{
    const p=m.kind==='mosh'?moshPathAt(m,elapsed):rockPathAt(m,elapsed);
    // Moshing launches immediately at full speed; other games retain their
    // 1.4-second group gathering animation.
    const gather=Math.min(1,elapsed/(m.kind==='shoulder'||m.campfireToast?3000:1400));
    const from=m.gatherFrom||p;
    const smooth=m.kind==='mosh'?p:m.kind==='toast'&&m.campfireToast&&elapsed<3000
     ?campfireToastGatherAt(m,elapsed,p):blendGroupWorld(from,p,gather);
    state.me.x=clampServerX(smooth.x);
    state.me.y=clampServerY(smooth.y);
    // Crowd-surf supporters face the middle and never rotate onto the train path.
    state.me.facing=m.kind==='shoulder'?Math.PI:m.kind==='surf'?(m.isSurfRider?0:Math.atan2(m.x-p.x,m.y-p.y)):
     m.kind==='toast'?Math.atan2(m.x-p.x,m.y-p.y):m.kind==='row'?0:Math.atan2(p.dx,p.dy);
    state.me.action=m.kind==='surf'?(state.id===m.riderId?'surf-rider':'surf-support'):m.kind==='mosh'?'mosh-charge':m.kind==='circle'?'circle-run':m.kind==='row'?'row-paddle':m.kind==='shoulder'?(elapsed<3000?'walk':'shoulder-headbang'):m.kind==='toast'?(m.campfireToast&&elapsed<3000?'walk':'toast-clink'):'train-run';state.action=state.me.action;
    state.moving=m.kind!=='shoulder'||elapsed<3000;
    if(t-state.lastSent>70){state.lastSent=t;sendMove()}
   }
  }
  if(!dx&&!dy&&!slamMotion&&(!rockMotion||(rockMotion.kind==='train'&&rockMotion.leaderId===state.id))&&state.walkTarget){
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
  state.moving=!!(dx||dy)||(rockMotion?.kind==='train'&&rockMotion.leaderId!==state.id&&state.me.action==='train-run');
  if(state.moving && (dx||dy) && (state.action==='buriburi'||state.action==='groove'||state.action==='windmill'||state.action==='airguitar'||state.action==='headspin'||state.action==='cheer'||state.action==='smoke'||state.action==='freestyle'||state.action==='beatking'||state.action==='marshmallow'||state.action==='heartbow') && !slamMotion && !rockMotion){
   state.action='idle';state.me.action='walk';state.actionUntil=0;updateActionButtons();
  }
  if(state.moving&&(dx||dy)){
   const n=Math.hypot(dx,dy);
   if(!slamMotion && (!rockMotion||(rockMotion.kind==='train'&&rockMotion.leaderId===state.id))){
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
    const worldSpeed=(rockMotion?.kind==='train'&&rockMotion.leaderId===state.id?7.5:state.action==='run'?9.86:6.09)*frameDelta/1000;
    const worldStep=Math.min(worldSpeed,worldDist);
    if(worldDist>0.00001){
      const nextX=at.x+worldDx/worldDist*worldStep;
      const nextZ=at.z+worldDz/worldDist*worldStep;
      state.me.x=clampServerX(nextX/.058+600);
      state.me.y=clampServerY((contractWorldZ(nextZ)-8)/.058+500);
    }
   }else{
    // Group rock-play and slam motion use their own intentional pace.
    state.me.x=clampServerX(state.me.x+dx/n*speed);
    state.me.y=clampServerY(state.me.y+dy/n*speed);
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
  if(rockMotion?.kind==='train'&&rockMotion.leaderId===state.id)recordTrainLeader(state.me);
  if(t-state.lastSent>150){state.lastSent=t;sendMove()}
 }

 for(let [id,p] of state.players){
  const current=avatars.get(id);
  if(current&&(current.color!==p.color||current.name!==p.name||current.badgeTier!==(p.badgeTier||'bronze')||current.gender!==p.gender||current.pattern!==(p.pattern||'solid')||current.sash!==(p.sash||'none')||current.hairStyle!==(p.hairStyle||'short')||current.hairColor!==(p.hairColor||'#4b3932')||current.flagText!==(p.flagText||'')||current.flagImage!==(p.flagImage||'')||Boolean(current.rhythmKing)!==Boolean(p.rhythmKing)||JSON.stringify(current.equipped||{})!==JSON.stringify(p.equipped||{}))){
   disposeAvatar(current.root);avatars.delete(id);
  }
  if(!avatars.has(id)){let a=makeAvatar(p),pos=toWorld(p);a.root.position.set(pos.x,0,pos.z);a.name=p.name;a.badgeTier=p.badgeTier||'bronze';a.gender=p.gender;a.pattern=p.pattern||'solid';a.sash=p.sash||'none';a.hairStyle=p.hairStyle||'short';a.hairColor=p.hairColor||'#4b3932';a.flagText=p.flagText||'';a.flagImage=p.flagImage||'';a.rhythmKing=Boolean(p.rhythmKing);a.equipped={...(p.equipped||{})};avatars.set(id,a)}
  const avatar=avatars.get(id);
  animateAvatar(avatar,p,t);
  if(avatar.parts.flagPivot?.parent?.visible){
   // Keep the tall pole upright in world space even when the avatar root
   // tilts 180 degrees (headspin) or sideways (B-boy/windmill).
   // The flag is still a child of root so disposal and shared appearance work.
   avatar.root.updateWorldMatrix(true,false);
   const flagGroup=avatar.parts.flagGroup;
   const inverseRootRotation=avatar.root.getWorldQuaternion(new THREE.Quaternion()).invert();
   flagGroup.quaternion.copy(inverseRootRotation);
   // Counteract the avatar's headspin/freeze vertical offset as well:
   // the pole's foot stays above the same ground position while dancing.
   const localGroundOffset=new THREE.Vector3(0,-avatar.root.position.y,0).applyQuaternion(inverseRootRotation);
   flagGroup.position.copy(localGroundOffset);
   avatar.root.updateWorldMatrix(true,false);
   const poleWorld=new THREE.Vector3();
   avatar.parts.flagPivot.getWorldPosition(poleWorld);
   const toCamera=new THREE.Vector3().subVectors(camera.position,poleWorld);
   avatar.parts.flagPivot.rotation.y=Math.atan2(toCamera.x,toCamera.z);
  }
 }
 for(let [id,a] of avatars)if(!state.players.has(id)){disposeAvatar(a.root);avatars.delete(id)}
 if(moveMarker.visible){moveMarker.material.opacity=Math.min(.75,Math.max(0,(moveMarkerUntil-t)/1050)*.75);if(t>moveMarkerUntil)moveMarker.visible=false}
 updateDuoVfx();updateEnvironment();
 const minimalScenery=perfMode==='eco'||(perfMode==='auto'&&perfWeakDevice);
 if(!minimalScenery||t-(updateOcean.lastEco||0)>1000){updateOcean(t);updateOcean.lastEco=t;}
 if(!minimalScenery)animateSky(t);
 updateMoshTrails(t);updateSlamDust(t);updateBubbles(t);animateShow(t);animateCampfire(t);updateFiretruckShow(t);
 if(!minimalScenery)updateHourlyFireworks(t);
 animateToastSparks(t);
 if(state.id)updateRhythmBoothButton();if(rhythmGame.open)drawRhythmGame();
 if(povEnabled){updatePovCamera();}else{followLocalAvatar();controls.update();keepCameraInFrontOfStage();}
 // Hide only our own avatar in POV, but leave all other avatars visible.
 const selfAvatar=avatars.get(state.id),previousVisible=selfAvatar?.root.visible;
 if(povEnabled&&selfAvatar)selfAvatar.root.visible=false;
 updateSlamVisual(t);updateRockPlayVisual(t);renderer.render(scene,camera);cssRenderer.render(scene,camera);renderStageForeground();
 if(selfAvatar)selfAvatar.root.visible=previousVisible;

 // Re-evaluate rendering cost roughly every 6 seconds, auto mode only.
 if(perfMode==='auto'){
  perfFrameTotal+=performance.now()-frameStart;perfFrameSamples++;
  if(!perfLastCheck)perfLastCheck=t;
  if(t-perfLastCheck>6000&&perfFrameSamples>12){
   const avg=perfFrameTotal/perfFrameSamples;
   // Lower resolution if the *rendering work itself* exhausts the frame budget.
   if(avg>perfTargetFrame*.90&&perfAutoScale>.73){perfAutoScale=Math.max(.7,perfAutoScale-.12);applyPerformancePreset()}
   else if(avg<perfTargetFrame*.52&&perfAutoScale<1){perfAutoScale=Math.min(1,perfAutoScale+.06);applyPerformancePreset()}
   perfLastCheck=t;perfFrameSamples=0;perfFrameTotal=0;
  }
 }
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
// Return to the reaction dock only after a successful PC Enter-to-send.
// Clicking the Send button, or submitting from a mobile keyboard, keeps chat open.
let chatEnterSubmit=false;
$('chatInput').addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&
   !('ontouchstart' in window&&navigator.maxTouchPoints>1))chatEnterSubmit=true;
});
$('chatForm').addEventListener('submit',async e=>{
 e.preventDefault();const input=$('chatInput');const button=$('chatSend');
 const closeAfterSend=chatEnterSubmit;
 chatEnterSubmit=false;
 if(button.disabled)return;
 const message=input.value.trim();if(!message)return;
 button.disabled=true;
 const sent=await sendChatMessage(message);
 button.disabled=false;
 if(sent){
  input.value='';
  if(closeAfterSend)selectBottomMenu('reaction');
  else input.focus();
 }
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
