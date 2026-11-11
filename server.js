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

// v298: Keep separate, bounded histories for the festival and each tent.
// Switching locations must not erase either room's conversation.
const chatHistory=[];
const CHAT_ROOM_LIMIT=35,CHAT_TOTAL_LIMIT=900;
function chatForRoom(roomId){
 const room=roomId||null;
 return chatHistory.filter(entry=>(entry.roomId||null)===room).slice(-CHAT_ROOM_LIMIT);
}
function retainChat(entry){
 chatHistory.push(entry);
 // Bound each room independently, so a busy festival cannot evict tent messages.
 let count=0;
 for(let i=chatHistory.length-1;i>=0;i--){
  if((chatHistory[i].roomId||null)!==(entry.roomId||null))continue;
  if(++count>CHAT_ROOM_LIMIT)chatHistory.splice(i,1);
 }
 while(chatHistory.length>CHAT_TOTAL_LIMIT)chatHistory.shift();
}
let activeSlam=null,slamCooldownUntil=0;
let pendingSlamImpact=null; // Last launch roster; exactly one shared first-arrival dust burst
const SLAM_COUNTDOWN_MS=5000,SLAM_COOLDOWN_MS=15000;
// Circle pit and shoulder-to-shoulder figure-eight train: server-authoritative join roster.
const ROCK_COUNTDOWN_MS=5000,ROCK_COOLDOWN_MS=15000;
const ROCK_DURATIONS={circle:20000,train:60000,mosh:4500,row:20000,toast:6000,surf:14000,shoulder:23000};
const CAMPFIRE_TOAST_DURATION_MS=9000,CAMPFIRE_SERVER_X=34/.058+600,CAMPFIRE_SERVER_Y=(10.5-8)/.058+500;
function nearCampfireToast(p){return !!p&&Math.hypot((p.x-600)*.058-34,(p.y-500)*.058+8-10.5)<=8.8;}
let activeRock=null,rockRunningUntil=0;
let activeSurfRide=null; // Active 10s crowd-surf choreography; included in snapshots for reconnects.
const moshDustEvents=new Set();
// Each rock game has its own 15 second cooldown. The active performance remains exclusive.
const rockCooldowns={circle:0,train:0,mosh:0,row:0,toast:0,surf:0,shoulder:0};
function publicRock(){return activeRock?{id:activeRock.id,kind:activeRock.kind,x:activeRock.x,y:activeRock.y,endAt:activeRock.endAt,participants:[...activeRock.participants],campfireToast:!!activeRock.campfireToast}:null}
function rockUpdate(){broadcast({type:'rockplay',event:publicRock(),rockCooldowns:{...rockCooldowns},rockRunningUntil,serverNow:Date.now()})}
function rockMemberLeaves(id){if(activeRock?.participants.delete(id))rockUpdate()}

function publicSlam(){return activeSlam?{id:activeSlam.id,x:activeSlam.x,y:activeSlam.y,endAt:activeSlam.endAt,participants:[...activeSlam.participants]}:null}
function slamUpdate(){broadcast({type:'slam',slam:publicSlam(),cooldownUntil:slamCooldownUntil})}

// Quick replies remain available, and players may also send short free-text messages.
const MAX_CHAT_LENGTH=80;
let music = {id:'', title:'', startedAt:0, paused:true, position:0, changedBy:'', token:0, duration:0, isLive:false};
const queue=[]; const history=[]; let nextTrackToken=1;
function trackRef(t){return t&&{id:t.id,title:t.title,addedBy:t.addedBy,isLive:t.isLive===true}}
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
const RHYTHM_BOOTH={x:1290,y:1034,radius:135};
function kstDate(ts=Date.now()){const d=new Date(ts+9*60*60*1000);return d.toISOString().slice(0,10)}
function previousKstDate(day=kstDate()){return new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10)}
let rhythmDay=kstDate();
const rhythmScores=new Map();
// v265: Server-owned collectible coins. No expiry; balances and coins survive restarts.
const FIELD_COIN_INTERVAL=5*60*1000, FIELD_COIN_MAX=6;
const fieldCoins=new Map(), fieldCoinBonuses=new Map();
let fieldCoinLastSpawnAt=Date.now()-FIELD_COIN_INTERVAL;
const fieldCoinPublic=()=>[...fieldCoins.values()].map(({id,x,y,value,createdAt})=>({id,x,y,value,createdAt}));
function fieldCoinPrize(){const n=crypto.randomInt(1000);return n<600?10:n<890?50:n<990?100:n<999?500:1000;}
function fieldCoinPosition(){
 // Distributed over the accessible lawn; exclude the stage, booth, campsites and other coins.
 for(let i=0;i<100;i++){
  const x=crypto.randomInt(245,1130),y=crypto.randomInt(370,735);
  const wx=(x-600)*.058,wz=(y-500)*.058+8;
  if(Math.hypot(x-1290,y-1034)<195||Math.hypot(wx-34,wz-10.5)<10)continue;
  if([...fieldCoins.values()].some(c=>Math.hypot(c.x-x,c.y-y)<95))continue;
  if([...tentStats.values()].some(t=>t.placed&&Math.hypot(t.x-wx,t.z-wz)<5.5))continue;
  return {x,y};
 }
 return null;
}
function maintainFieldCoins(now=Date.now()){
 let changed=false;
 if(now-fieldCoinLastSpawnAt>=FIELD_COIN_INTERVAL){
  // One spawn per interval, no catch-up flood after server downtime.
  fieldCoinLastSpawnAt=now;
  if(fieldCoins.size<FIELD_COIN_MAX){const point=fieldCoinPosition();if(point){const coin={id:crypto.randomUUID(),...point,value:fieldCoinPrize(),createdAt:now};fieldCoins.set(coin.id,coin);changed=true;}}
 }
 if(changed){broadcast({type:'field-coins',coins:fieldCoinPublic()});scheduleSave();}
 return changed;
}
setInterval(()=>{if(restored)maintainFieldCoins()},15000).unref();

// v294: Automatically pick up a field coin when the player's SERVER-reported
// position enters its pickup radius. The server removes the coin first, so
// simultaneous arrivals can never receive the same reward twice.
const FIELD_COIN_PICKUP_RADIUS=1.65; // world units (server coords use 0.058 units/pixel)
function collectNearbyFieldCoin(p){
 if(!p||!p.badgeIdentity||p.tentRoomId||!fieldCoins.size)return false;
 for(const coin of fieldCoins.values()){
  if(Math.hypot((p.x-coin.x)*.058,(p.y-coin.y)*.058)>FIELD_COIN_PICKUP_RADIUS)continue;
  fieldCoins.delete(coin.id);
  fieldCoinBonuses.set(p.badgeIdentity,(fieldCoinBonuses.get(p.badgeIdentity)||0)+coin.value);
  broadcast({type:'field-coins',coins:fieldCoinPublic()});
  broadcast({type:'field-coin-collected',playerId:p.id,value:coin.value});
  scheduleSave();
  return true;
 }
 return false;
}


// v252: 5 server-issued plays per KST day; bonuses are lifetime point credits.
const RHYTHM_DAILY_COINS=5;
const rhythmAccounts=new Map();
function rhythmAccount(identity){
 const today=kstDate();
 let row=rhythmAccounts.get(identity);
 if(!row){row={day:today,used:0,bonus:0,session:null};rhythmAccounts.set(identity,row)}
 if(row.day!==today){row.day=today;row.used=0;row.session=null;scheduleSave()}
 return row;
}
function rhythmPrize(score){return score>=120000?50:score>=80000?30:score>=50000?10:1}

// v254: Separate hammer-game coins; score is computed from the server's own clock.
// Shared Beat Booth proximity for both games.
const POWER_BOOTH=RHYTHM_BOOTH;
const POWER_DAILY_COINS=5,POWER_COUNTDOWN_MS=2400,POWER_PERIOD_MS=1500,POWER_ACTIVE_MS=10500;
// Permit a short network transit time while checking the reported tap moment against server time.
const POWER_MAX_STRIKE_LAG_MS=650,POWER_CLOCK_SKEW_MS=180;
const powerAccounts=new Map(),powerScores=new Map();
let powerDay=kstDate();
function powerAccount(identity){
 const today=kstDate();let row=powerAccounts.get(identity);
 if(!row){row={day:today,used:0,bonus:0,session:null};powerAccounts.set(identity,row)}
 if(row.day!==today){row.day=today;row.used=0;row.session=null;scheduleSave()}
 return row;
}
function powerAccountView(p){const a=powerAccount(p.badgeIdentity);return {coins:Math.max(0,POWER_DAILY_COINS-a.used),limit:POWER_DAILY_COINS,used:a.used,day:a.day};}
function powerPrize(score){return score>=900?50:score>=700?30:score>=500?10:1;}
function powerGauge(elapsed){const phase=((elapsed-POWER_COUNTDOWN_MS)%POWER_PERIOD_MS+POWER_PERIOD_MS)%POWER_PERIOD_MS/POWER_PERIOD_MS;return phase<.5?phase*2:(1-phase)*2;}
function powerScore(elapsed){return elapsed<POWER_COUNTDOWN_MS||elapsed>POWER_ACTIVE_MS?0:Math.max(0,Math.min(1000,Math.round(1000-4500*Math.abs(powerGauge(elapsed)-.5))));}
// v255: Yesterday's highest score owns the Power King title and reaction for today only.
// Keep identity private: never include it in public leaderboard/reward payloads.
let powerReward=null;
function powerRows(){return [...powerScores.entries()].map(([identity,r])=>({identity,name:r.name,score:r.score,at:r.at})).sort((a,b)=>b.score-a.score||a.at-b.at||a.name.localeCompare(b.name,'ko-KR')).slice(0,5);}
function playerIsPowerKing(p){return Boolean(p&&p.badgeIdentity&&powerReward&&powerReward.date===kstDate()&&powerReward.identity===p.badgeIdentity)}
function syncPlayerPowerKing(p){if(!p)return false;const on=playerIsPowerKing(p);if(Boolean(p.powerKing)===on)return false;p.powerKing=on;if(!on&&p.action==='powerking')p.action='idle';return true}
function rotatePowerDay(){
 const day=kstDate();if(day===powerDay)return;
 const winner=powerDay===previousKstDate(day)?powerRows()[0]:null;
 powerReward=winner?{date:day,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:powerDay}:null;
 powerDay=day;powerScores.clear();
 for(const person of players.values())if(syncPlayerPowerKing(person))broadcast({type:'profile',player:person});
 scheduleSave();broadcast({type:'power-state',power:publicPowerState()});
}
function publicPowerState(){rotatePowerDay();return {day:powerDay,leaderboard:powerRows().map(({rank,identity,at,...r},i)=>({rank:i+1,...r})),reward:powerReward&&powerReward.date===kstDate()?{title:'파워왕',name:powerReward.name,score:powerReward.score,sourceDate:powerReward.sourceDate,date:powerReward.date}:null,booth:POWER_BOOTH};}

function rhythmAccountView(p){const row=rhythmAccount(p.badgeIdentity);return {coins:Math.max(0,RHYTHM_DAILY_COINS-row.used),used:row.used,limit:RHYTHM_DAILY_COINS,bonus:row.bonus,day:row.day}}

let rhythmReward=null;
function rhythmRows(){return [...rhythmScores.entries()].map(([identity,row])=>({identity,name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(row.score)||0)),updatedAt:Number(row.updatedAt)||0})).sort((a,b)=>b.score-a.score||a.updatedAt-b.updatedAt||a.name.localeCompare(b.name,'ko-KR')).slice(0,100)}
function playerIsRhythmKing(p){return Boolean(p&&p.badgeIdentity&&rhythmReward&&rhythmReward.date===kstDate()&&rhythmReward.identity===p.badgeIdentity)}
function syncPlayerRhythmKing(p){if(!p)return false;const on=playerIsRhythmKing(p);if(Boolean(p.rhythmKing)===on)return false;p.rhythmKing=on;if(!on&&p.action==='beatking')p.action='idle';return true}
function publicRhythmState(){maybeRotateRhythmDay();const rows=rhythmRows();return {date:rhythmDay,leaderboard:rows.slice(0,5).map((row,i)=>({rank:i+1,name:row.name,score:row.score})),reward:rhythmReward&&rhythmReward.date===kstDate()?{title:'박자왕',name:rhythmReward.name,score:rhythmReward.score,sourceDate:rhythmReward.sourceDate,date:rhythmReward.date}:null,booth:RHYTHM_BOOTH};}
function broadcastRhythmState(){broadcast({type:'rhythm-state',rhythm:publicRhythmState()})}
function maybeRotateRhythmDay(){const today=kstDate();if(rhythmDay===today)return false;const rows=rhythmRows();const winner=rhythmDay===previousKstDate(today)?rows[0]:null;rhythmReward=winner?{date:today,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:rhythmDay}:null;rhythmDay=today;rhythmScores.clear();let changed=false;for(const person of players.values())if(syncPlayerRhythmKing(person)){broadcast({type:'profile',player:person});changed=true;}scheduleSave();broadcastRhythmState();return changed;}
function restoreRhythmKingState(){for(const person of players.values())if(syncPlayerRhythmKing(person))broadcast({type:'profile',player:person});}
// Total online time per stable browser identity, persisted alongside the playlist.
// v259: Whack-a-mole, server-generated fresh pattern every round.
// v262: 40 randomized moles over 30 seconds, each appearance progressively faster.
const MOLE_DAILY_COINS=5,MOLE_INTERVAL_MS=750,MOLE_SLOTS=40,MOLE_DELAY_MS=1500;
const MOLE_INTERVALS_MS=Array.from({length:MOLE_SLOTS},(_,i)=>Math.round(1100-700*i/(MOLE_SLOTS-1)));
const MOLE_SLOT_STARTS_MS=[0];for(const ms of MOLE_INTERVALS_MS)MOLE_SLOT_STARTS_MS.push(MOLE_SLOT_STARTS_MS[MOLE_SLOT_STARTS_MS.length-1]+ms);
const MOLE_DURATION_MS=MOLE_SLOT_STARTS_MS[MOLE_SLOTS];
const moleAccounts=new Map(),moleScores=new Map(),moleFinishTimers=new Map();
let moleDay=kstDate(),moleReward=null,moleHammerRevision='';
function moleAccount(identity){const today=kstDate();let a=moleAccounts.get(identity);if(!a){a={day:today,used:0,bonus:0,session:null,lastResult:null};moleAccounts.set(identity,a)}if(a.day!==today){a.day=today;a.used=0;a.session=null;a.lastResult=null;scheduleSave()}return a;}
function moleAccountView(p){const a=moleAccount(p.badgeIdentity);return {coins:Math.max(0,MOLE_DAILY_COINS-a.used),limit:MOLE_DAILY_COINS,day:a.day,used:a.used};}
function molePrize(score){return score>=3000?50:score>=2000?30:score>=1000?10:1;}
function moleRows(){return [...moleScores.entries()].map(([identity,r])=>({identity,name:r.name,score:r.score,at:r.at})).sort((a,b)=>b.score-a.score||a.at-b.at||a.name.localeCompare(b.name,'ko-KR')).slice(0,5);}
function playerIsMoleKing(p){return Boolean(p&&p.badgeIdentity&&moleReward&&moleReward.date===kstDate()&&moleReward.identity===p.badgeIdentity);}
function syncPlayerMoleKing(p){if(!p)return false;const yes=playerIsMoleKing(p);if(Boolean(p.moleKing)===yes)return false;p.moleKing=yes;if(!yes&&p.action==='moleking')p.action='idle';return true;}
function rotateMoleDay(){const day=kstDate();if(day===moleDay)return;const winner=moleDay===previousKstDate(day)?moleRows()[0]:null;moleReward=winner?{date:day,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:moleDay}:null;moleDay=day;moleScores.clear();for(const p of players.values())if(syncPlayerMoleKing(p))broadcast({type:'profile',player:p});scheduleSave();broadcast({type:'mole-state',mole:publicMoleState()});}
function publicMoleState(){rotateMoleDay();return {day:moleDay,leaderboard:moleRows().map(({identity,at,...r},i)=>({rank:i+1,...r})),reward:moleReward&&moleReward.date===kstDate()?{title:'두더지왕',name:moleReward.name,score:moleReward.score,sourceDate:moleReward.sourceDate}:null,hammerRevision:moleHammerRevision,booth:RHYTHM_BOOTH};}
function molePattern(){const seq=[];let prev=-1;for(let i=0;i<MOLE_SLOTS;i++){let pos=crypto.randomInt(0,8);if(pos>=prev&&prev>=0)pos++;seq.push(pos);prev=pos;}return seq;}
// v263: Commit results once on the server, even if the browser's finish request is late or lost.
// The last committed result is kept so retries cannot award points twice.
async function commitMoleResult(identity,playId){
 const a=moleAccounts.get(identity),session=a?.session;
 if(!session||session.id!==playId||a.day!==kstDate())return a?.lastResult?.playId===playId?a.lastResult:null;
 const endAt=session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS;
 if(Date.now()<endAt)return null;
 const score=session.score,prize=molePrize(score),now=Date.now();
 const result={playId,score,prize};
 a.session=null;a.lastResult=result;a.bonus+=prize;
 const best=moleScores.get(identity);
 if(!best||score>best.score)moleScores.set(identity,{name:clean(session.name,18)||best?.name||'ROCKER',score,at:now});
 await saveNow();broadcast({type:'mole-state',mole:publicMoleState()});
 return result;
}
function scheduleMoleFinish(identity,session){
 const previous=moleFinishTimers.get(identity);if(previous)clearTimeout(previous);
 const delay=Math.max(100,session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS+1400-Date.now());
 const timer=setTimeout(()=>{
  if(moleFinishTimers.get(identity)===timer)moleFinishTimers.delete(identity);
  void commitMoleResult(identity,session.id).catch(e=>console.error('Mole result save failed:',e.message));
 },delay);
 timer.unref();moleFinishTimers.set(identity,timer);
}
const badgeStats=new Map();
// No account required: coins belong to the existing persistent badge identity.
// All purchases and equipment are server-validated. Guests without the stable
// badge identity cannot spend points; client-provided balances are ignored.
const shopStats=new Map();
// v242: Paid, persistent personal campsite (MD wardrobe remains free for testing).

// v283: one persistent cosmetic pet per badge identity; fox, turtle, cat, rabbit, elephant, wolf; no rigging required.
// Pet purchases and food use the SAME authoritative points ledger as tents.
// v284: egg identity stays secret until natural hatching; no instant-hatch test endpoint.
// Pets may continue to be summoned from egg stage and immediately after hatching.
const PET_ADOPTION_COST=1000, PET_HATCH_MS=4*60*60*1000, PET_MAX_LEVEL=30;
const PET_FOODS={snack:{cost:30,xp:15,name:'간식'},meal:{cost:100,xp:60,name:'식사'},feast:{cost:250,xp:170,name:'특식'}};
const PET_COLORS=['#f16b69','#67b9f2','#75d8a0','#b68ae8','#f4eee0'];
const PET_SPECIES=['fox','turtle','cat','rabbit','elephant','wolf']; // Equal odds; existing pet species and saved records are preserved.
const petStats=new Map();
let petHatchDurationMigrated=false;
function petLevel(xp){
 let level=1;while(level<PET_MAX_LEVEL&&xp>=40*level+8*level*(level+1))level++;
 return level;
}
function petPublic(pet){
 if(!pet)return null;
 const level=petLevel(pet.xp),hatched=Date.now()>=pet.hatchAt;
 return {species:hatched?(PET_SPECIES.includes(pet.species)?pet.species:'fox'):null,color:pet.color,adoptedAt:pet.adoptedAt,hatchAt:pet.hatchAt,
  hatched,level:hatched?level:0,xp:pet.xp,nextXp:level<PET_MAX_LEVEL?40*level+8*level*(level+1):null,
  stage:hatched?(level>=25?25:level>=10?10:1):0,summoned:!!pet.summoned};
}
function petAccount(identity){if(!petStats.has(identity))petStats.set(identity,{spent:0,pet:null});return petStats.get(identity);}
function petView(p){const record=petAccount(p.badgeIdentity);return {pet:petPublic(record.pet),points:tentPointBalance(p),cost:PET_ADOPTION_COST,hatchMs:PET_HATCH_MS,foods:PET_FOODS,availableSpecies:PET_SPECIES,maxLevel:PET_MAX_LEVEL};}
function syncPetPlayers(identity){
 const record=petStats.get(identity);for(const other of players.values())if(other.badgeIdentity===identity){other.pet=petPublic(record?.pet);broadcast({type:'pet-update',id:other.id,pet:other.pet});}
}
// Notify everyone when a summoned egg finishes hatching, even if its owner is offline.
const petHatchNotified=new Set();
setInterval(()=>{
 const now=Date.now();
 for(const [identity,record] of petStats){
  const pet=record.pet;
  if(!pet||now<pet.hatchAt){petHatchNotified.delete(identity);continue;}
  if(!petHatchNotified.has(identity)){petHatchNotified.add(identity);syncPetPlayers(identity);}
 }
},5000).unref();

// v302: ONEseason Scratch Lottery. Server draws and settles all prizes;
// accounts are keyed by the same persistent private badge identity as tents.
const LOTTERY_PRICE=100,LOTTERY_DAILY_LIMIT=5;
const LOTTERY_BOOTH={x:38,z:-7.2,radius:9.5};
const LOTTERY_PRIZES=[
 {tier:'miss',chance:3000,prize:0,symbols:['star','coin','diamond']},
 {tier:'small',chance:3000,prize:50,symbols:['coin','coin','coin']},
 {tier:'normal',chance:3000,prize:100,symbols:['star','star','star']},
 {tier:'high',chance:995,prize:300,symbols:['diamond','diamond','diamond']},
 {tier:'jackpot',chance:5,prize:5000,symbols:['crown','crown','crown']}
]; // 10,000 tickets: 30/30/30/9.95/.05 percent.
const lotteryStats=new Map();
function lotteryAccount(identity){
 const today=kstDate();let a=lotteryStats.get(identity);
 if(!a){a={day:today,used:0,spent:0,bonus:0,pending:null,lastResult:null};lotteryStats.set(identity,a)}
 if(a.day!==today){a.day=today;a.used=0;a.lastResult=null;scheduleSave()}
 return a;
}
function lotteryPublicTicket(ticket){return ticket?{id:ticket.id,symbols:[...ticket.symbols],createdAt:ticket.createdAt}:null}
function lotteryAccountView(p){
 const a=lotteryAccount(p.badgeIdentity);
 return {day:a.day,used:a.used,remaining:Math.max(0,LOTTERY_DAILY_LIMIT-a.used),limit:LOTTERY_DAILY_LIMIT,price:LOTTERY_PRICE,
  points:tentPointBalance(p),ticket:lotteryPublicTicket(a.pending),lastResult:a.lastResult};
}
function lotteryNearBooth(p){
 return !p.tentRoomId&&Math.hypot((p.x-600)*.058-LOTTERY_BOOTH.x,(p.y-500)*.058+8-LOTTERY_BOOTH.z)<=LOTTERY_BOOTH.radius;
}
function lotteryDraw(){
 const n=crypto.randomInt(10000);let total=0;
 for(const prize of LOTTERY_PRIZES){total+=prize.chance;if(n<total)return prize;}
 return LOTTERY_PRIZES[0];
}
const TENT_COST=3000;
const tentStats=new Map();
const TENT_COLORS=['#ed9a77','#8dc3ad','#8ea8d8','#c49acb','#dfc576','#d6a3a3','#92b9ba','#d5d9e5'];
const TENT_MAX_OCCUPANCY=4;
// v293: Exterior decorations are one-time purchases per tent owner.
const TENT_OUTDOOR_DECOR={string_lights:{name:'전구 가랜드',cost:500},mini_campfire:{name:'개인 작은 모닥불',cost:500}};
function outdoorDecorState(t){return {owned:{string_lights:!!t?.outdoorDecorOwned?.string_lights,mini_campfire:!!t?.outdoorDecorOwned?.mini_campfire},enabled:{string_lights:!!t?.outdoorDecorEnabled?.string_lights,mini_campfire:!!t?.outdoorDecorEnabled?.mini_campfire}};}

// v248: Add new furniture here and place its GLB at public/assets/tent-items/.
// Footprint sizes are in indoor floor metres; all paid balances are server controlled.
// Future items: upload a .glb into public/assets/tent-items and add one entry
// to catalog.json. Asset paths and numeric specs are validated on startup.
function loadTentFurnitureCatalog(){
 let raw;
 try{raw=JSON.parse(fs.readFileSync(path.join(PUBLIC,'assets/tent-items/catalog.json'),'utf8'));}
 catch(error){console.warn('Tent furniture catalog:',error.message);raw={};}
 const catalog={};
 for(const [id,item] of Object.entries(raw).slice(0,60)){
  if(!/^[a-z0-9_-]{1,32}$/.test(id)||!item||typeof item!=='object')continue;
  const cost=Number(item.cost),width=Number(item.width),depth=Number(item.depth),height=Number(item.height);
  const asset='/assets/tent-items/'+id+'.glb';
  if(!Number.isInteger(cost)||cost<0||cost>50000||![width,depth,height].every(Number.isFinite)||width<.1||width>8||depth<.1||depth>8||height<.1||height>8||!fs.existsSync(path.join(PUBLIC,'assets/tent-items',id+'.glb')))continue;
  catalog[id]={name:String(item.name||id).slice(0,40),cost,asset,width,depth,height,description:String(item.description||'').slice(0,150),bedEnabled:typeof item.bedEnabled==='boolean'?item.bedEnabled:/(침대|매트리스|mattress|(^|[-_ ])bed($|[-_ ])|^bed|(^|[-_ ])cot($|[-_ ]))/i.test(id+' '+String(item.name||'')),bedSurfaceHeight:Number.isFinite(Number(item.bedSurfaceHeight))&&Number(item.bedSurfaceHeight)>0&&Number(item.bedSurfaceHeight)<=height?Number(item.bedSurfaceHeight):null,lightEnabled:typeof item.lightEnabled==='boolean'?item.lightEnabled:/(lantern|랜턴|등불|호롱|lamp|램프)/i.test(id+' '+String(item.name||''))};
 }
 // v285: Bundled fireplace is registered without replacing the owner's
 // existing catalog.json or any administrator-created furniture entries.
 const stoveFile=path.join(PUBLIC,'assets/tent-items/hearth_stove.glb');
 if(fs.existsSync(stoveFile)&&!catalog.hearth_stove){
  catalog.hearth_stove={name:'장작 난로',cost:500,asset:'/assets/tent-items/hearth_stove.glb',
   width:1.35,depth:1.70,height:1.50,
   description:'중앙 화구에서 불꽃이 피어오르고 주변을 따뜻하게 밝히는 난로',
   bedEnabled:false,bedSurfaceHeight:null,lightEnabled:true};
 }
 // v286: Built-in floor lamp, preserving administrator catalog entries.
 const lampFile=path.join(PUBLIC,'assets/tent-items/floor_lamp.glb');
 if(fs.existsSync(lampFile)&&!catalog.floor_lamp){
  catalog.floor_lamp={name:'스탠드 조명',cost:350,asset:'/assets/tent-items/floor_lamp.glb',
   width:0.62,depth:0.62,height:1.85,
   description:'상단 갓 안쪽에서 은은한 따뜻한 빛이 퍼지는 스탠드 조명',
   bedEnabled:false,bedSurfaceHeight:null,lightEnabled:true};
 }
 return catalog;
}
// v249: Live administrator catalog. Metadata lives in the persisted game state,
// while large GLB files live in Supabase Storage (or local data/ for development).
const BUNDLED_TENT_FURNITURE=loadTentFurnitureCatalog();
const furnitureCatalogEdits=new Map();
const TENT_FURNITURE_CATALOG={...BUNDLED_TENT_FURNITURE};
const TENT_ASSET_BUCKET=(process.env.TENT_ASSET_BUCKET||'tent-items').trim();
const TENT_MODEL_MAX_BYTES=12*1024*1024;
const TENT_MODEL_DIR=path.join(process.env.DATA_DIR||path.join(__dirname,'data'),'tent-item-models');
const TENT_ITEM_ID=/^[a-z0-9_-]{1,32}$/;
const TENT_MODEL_REV=/^[a-f0-9]{16}$/;
function cleanFurnitureSpec(id,raw,revision){
 if(!TENT_ITEM_ID.test(id)||!raw||typeof raw!=='object')return null;
 const cost=Number(raw.cost),width=Number(raw.width),depth=Number(raw.depth),height=Number(raw.height);
 const modelRevision=typeof revision==='string'&&TENT_MODEL_REV.test(revision)?revision:'';
 if(!Number.isInteger(cost)||cost<0||cost>50000||![width,depth,height].every(Number.isFinite)||[width,depth,height].some(n=>n<.1||n>8))return null;
 const name=String(raw.name||'').trim().slice(0,40);
 if(!name)return null;
 // Optional mattress top height is measured from the tent floor, not from the headboard.
 const surfaceProvided=raw.bedSurfaceHeight!==null&&raw.bedSurfaceHeight!==undefined&&raw.bedSurfaceHeight!=='';
 const bedSurfaceHeight=surfaceProvided?Number(raw.bedSurfaceHeight):null;
 if(surfaceProvided&&(!Number.isFinite(bedSurfaceHeight)||bedSurfaceHeight<.05||bedSurfaceHeight>height))return null;
 return {name,cost,width,depth,height,description:String(raw.description||'').trim().slice(0,150),enabled:raw.enabled!==false,bedEnabled:typeof raw.bedEnabled==='boolean'?raw.bedEnabled:/(침대|매트리스|mattress|(^|[-_ ])bed($|[-_ ])|^bed|(^|[-_ ])cot($|[-_ ]))/i.test(id+' '+name),bedSurfaceHeight,lightEnabled:typeof raw.lightEnabled==='boolean'?raw.lightEnabled:/(lantern|랜턴|등불|호롱|lamp|램프)/i.test(id+' '+name),
    ...(modelRevision?{modelRevision}:{})};
}
function refreshFurnitureCatalog(){
 for(const key of Object.keys(TENT_FURNITURE_CATALOG))delete TENT_FURNITURE_CATALOG[key];
 Object.assign(TENT_FURNITURE_CATALOG,BUNDLED_TENT_FURNITURE);
 for(const [id,spec] of furnitureCatalogEdits){
  const base=TENT_FURNITURE_CATALOG[id];
  TENT_FURNITURE_CATALOG[id]={...base,...spec,asset:spec.modelRevision
   ?'/api/tent-item-model/'+id+'?v='+spec.modelRevision:(base?.asset||'')};
 }
}
function furnitureAdminCatalog(){return Object.fromEntries(Object.entries(TENT_FURNITURE_CATALOG).map(([id,item])=>[id,{...item,bundled:!!BUNDLED_TENT_FURNITURE[id],custom:!BUNDLED_TENT_FURNITURE[id]}]));}
function furnitureCatalogChanged(){broadcast({type:'tent-furniture-catalog',catalog:TENT_FURNITURE_CATALOG});}
async function rawBody(req,maxBytes){
 const chunks=[];let count=0;
 for await(const chunk of req){count+=chunk.length;if(count>maxBytes)throw Object.assign(new Error('GLB 용량 제한을 초과했어요. (최대 12MB)'),{code:'TOO_BIG'});chunks.push(chunk)}
 return Buffer.concat(chunks,count);
}
function validateGlb(bytes){
 if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('올바른 GLB 2.0 파일을 업로드해 주세요.');
 const jsonSize=bytes.readUInt32LE(12),jsonTag=bytes.toString('ascii',16,20);
 if(jsonTag!=='JSON'||jsonSize>2000000||jsonSize<10||20+jsonSize>bytes.length)throw Error('GLB 내부 구조가 올바르지 않아요.');
 let gltf;try{gltf=JSON.parse(bytes.subarray(20,20+jsonSize).toString('utf8'))}catch{throw Error('GLB의 JSON 청크가 손상됐어요.')}
 if(gltf.asset?.version!=='2.0')throw Error('GLB 2.0 파일만 지원해요.');
 for(const entry of [...(gltf.buffers||[]),...(gltf.images||[])]){
  if(entry.uri&&!/^data:(?:image\/(?:png|jpeg|webp)|application\/octet-stream);base64,/.test(entry.uri))throw Error('GLB 외부 파일 참조는 지원하지 않아요. 텍스처를 GLB 안에 포함해 주세요.');
 }
}
function storageHeaders(){return {apikey:SB_KEY,Authorization:'Bearer '+SB_KEY};}
function storageObjectPath(id,rev){return 'furniture/'+id+'/'+rev+'.glb';}
async function storageUpload(id,rev,bytes){
 if(!useSupabase){fs.mkdirSync(TENT_MODEL_DIR,{recursive:true});fs.writeFileSync(path.join(TENT_MODEL_DIR,id+'-'+rev+'.glb'),bytes);return 'local'}
 if(!TENT_ASSET_BUCKET||!/^[a-z0-9_-]{3,40}$/.test(TENT_ASSET_BUCKET))throw Error('TENT_ASSET_BUCKET 설정이 잘못됐어요.');
 const endpoint=SB_URL+'/storage/v1/object/'+encodeURIComponent(TENT_ASSET_BUCKET)+'/'+storageObjectPath(id,rev);
 const send=()=>fetch(endpoint,{method:'POST',headers:{...storageHeaders(),'Content-Type':'model/gltf-binary','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});
 let response=await send();
 if(response.status===404){
  // The existing Supabase service key can create the private bucket once.
  const create=await fetch(SB_URL+'/storage/v1/bucket',{method:'POST',headers:{...storageHeaders(),'Content-Type':'application/json'},body:JSON.stringify({id:TENT_ASSET_BUCKET,name:TENT_ASSET_BUCKET,public:false}),signal:AbortSignal.timeout(10000)});
  if(create.ok||create.status===409)response=await send();
 }
 if(!response.ok)throw Error('Supabase Storage 업로드 실패 ('+response.status+'). '+(await response.text()).slice(0,120)+' — Storage에서 '+TENT_ASSET_BUCKET+' 버킷과 서비스 키 권한을 확인해 주세요.');
 return 'supabase';
}
async function storageExists(id,rev){
 if(!useSupabase)return fs.existsSync(path.join(TENT_MODEL_DIR,id+'-'+rev+'.glb'));
 const url=SB_URL+'/storage/v1/object/'+encodeURIComponent(TENT_ASSET_BUCKET)+'/'+storageObjectPath(id,rev);
 const r=await fetch(url,{method:'HEAD',headers:storageHeaders(),signal:AbortSignal.timeout(10000)});return r.ok;
}
async function serveFurnitureModel(req,res,id){
 const item=TENT_FURNITURE_CATALOG[id];if(!item||!item.modelRevision)return json(res,404,{error:'모델을 찾지 못했어요.'});
 const rev=item.modelRevision;
 try{
  let bytes;
  if(useSupabase){
   const url=SB_URL+'/storage/v1/object/'+encodeURIComponent(TENT_ASSET_BUCKET)+'/'+storageObjectPath(id,rev);
   const r=await fetch(url,{headers:storageHeaders(),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('스토리지 응답 '+r.status);
   bytes=Buffer.from(await r.arrayBuffer());
  }else bytes=fs.readFileSync(path.join(TENT_MODEL_DIR,id+'-'+rev+'.glb'));
  res.writeHead(200,{'content-type':'model/gltf-binary','content-length':bytes.length,'cache-control':'public,max-age=3600','x-content-type-options':'nosniff'});
  res.end(bytes);
 }catch(e){console.warn('Furniture asset:',e.message);return json(res,404,{error:'GLB 파일을 찾지 못했어요. 관리자에게 문의해 주세요.'})}
}

const TENT_FURNITURE_MAX_PLACED=30;
const furnitureStats=new Map();
function furnitureRecord(identity){if(!furnitureStats.has(identity))furnitureStats.set(identity,{spent:0,owned:{}});return furnitureStats.get(identity);}
function tentPointBalance(p){const earned=Math.floor(badgeTotal(p)/60)+(p.badgeIdentity?rhythmAccount(p.badgeIdentity).bonus+powerAccount(p.badgeIdentity).bonus+moleAccount(p.badgeIdentity).bonus+(fieldCoinBonuses.get(p.badgeIdentity)||0)+(lotteryStats.get(p.badgeIdentity)?.bonus||0):0);return Math.max(0,earned-(lotteryStats.get(p.badgeIdentity)?.spent||0)-(tentOwnedBy(p.badgeIdentity)?TENT_COST:0)-(furnitureStats.get(p.badgeIdentity)?.spent||0)-(petStats.get(p.badgeIdentity)?.spent||0)-(tentOwnedBy(p.badgeIdentity)?.outdoorDecorSpent||0));}
function safeFurniturePose(item,x,z,angle){
 if(!item||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(angle))return false;
 if(angle<0||angle>=360||angle%45!==0)return false;
 const c=Math.cos(angle*Math.PI/180),sn=Math.sin(angle*Math.PI/180);
 const hw=item.width/2+.14,hd=item.depth/2+.14;
 const corners=[[-hw,-hd],[-hw,hd],[hw,-hd],[hw,hd]].map(([px,pz])=>[x+px*c+pz*sn,z-px*sn+pz*c]);
 return corners.every(([px,pz])=>Math.abs(px)<=5.52&&Math.abs(pz)<=4.52)&&Math.hypot(x,z-2.5)>1.28;
}
function furnitureCorners(item,placement){
 const a=placement.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),hw=item.width/2+.20,hd=item.depth/2+.20;
 return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([u,v])=>[placement.x+u*c+v*sn,placement.z-u*sn+v*c]);
}
function polygonsOverlap(a,b){
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const u=poly[i],v=poly[(i+1)%poly.length],nx=-(v[1]-u[1]),ny=v[0]-u[0];
  const pa=a.map(p=>p[0]*nx+p[1]*ny),pb=b.map(p=>p[0]*nx+p[1]*ny);
  if(Math.max(...pa)<=Math.min(...pb)||Math.max(...pb)<=Math.min(...pa))return false;
 }
 return true;
}
function canPlaceFurniture(record,itemId,x,z,rotation,ignoreId=''){
 const item=TENT_FURNITURE_CATALOG[itemId];if(!safeFurniturePose(item,x,z,rotation))return false;
 const p={x,z,rotation},box=furnitureCorners(item,p);
 return (record.furnishings||[]).every(other=>other.instanceId===ignoreId||!polygonsOverlap(box,furnitureCorners(TENT_FURNITURE_CATALOG[other.itemId],other)));
}
function furnitureInventoryView(p){
 const r=furnitureRecord(p.badgeIdentity);
 return {points:tentPointBalance(p),catalog:TENT_FURNITURE_CATALOG,owned:{...r.owned},roomFurnishings:(tentOwnedBy(p.badgeIdentity)?.furnishings||[]).map(x=>({...x}))};
}

// v246: Each tent has one exterior design, printed on both sloping sides.
// No client-provided URL/HTML is ever rendered. Uploads must decode to small JPEG/WebP files.
const TENT_EXTERIOR_MAX_TEXT=60;
const TENT_EXTERIOR_MAX_IMAGE_BYTES=90000;
const TENT_EXTERIOR_PREFIX=/^data:image\/(jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/;
function decodeTentExteriorImage(source){
 if(typeof source!=='string'||source.length>125000)return null;
 const match=TENT_EXTERIOR_PREFIX.exec(source);
 if(!match)return null;
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length<30||bytes.length>TENT_EXTERIOR_MAX_IMAGE_BYTES)return null;
 // Reject base64 noncanonical encodings and misleading MIME signatures.
 if(bytes.toString('base64')!==match[2])return null;
 const mime=match[1];
 const valid=mime==='jpeg'
  ?(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9)
  :(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
 return valid?{bytes,mime,source}:null;
}
function tentExteriorImageId(record){
 const image=record?.exteriorImage;
 if(typeof image!=='string'||!image)return '';
 const match=TENT_EXTERIOR_PREFIX.exec(image);
 if(!match)return '';
 return crypto.createHash('sha256').update(Buffer.from(match[2],'base64')).digest('hex').slice(0,32);
}
function storedTent(record){return {...publicTent(record),outdoorDecorSpent:record.outdoorDecorSpent||0,exteriorImage:record.exteriorImage||''};}

// v245: Entrance interaction requires walking to within five real world units.
const TENT_ENTER_DISTANCE=5.0;
function tentEntranceDistance(player,tent){return Math.hypot((player.x-600)*.058-tent.x,(player.y-500)*.058+8-tent.z);}
const TENT_PAINTS={default:null,red:'#ef615a',orange:'#f59b42',yellow:'#f4dd63',green:'#78bd89',blue:'#709bda',black:'#292d38',white:'#f5f5f1'};
function tentOccupancy(roomId){let count=0;for(const p of players.values())if(p.tentRoomId===roomId)count++;return count;}
function publicTent(record){return {id:record.id,name:record.name,color:record.color,placed:!!record.placed,x:record.placed?record.x:null,z:record.placed?record.z:null,occupancy:tentOccupancy(record.id),capacity:TENT_MAX_OCCUPANCY,wallColor:record.wallColor||'default',floorColor:record.floorColor||'default',roomLightOn:record.roomLightOn!==false,exteriorType:record.exteriorType||'none',exteriorText:record.exteriorType==='text'?(record.exteriorText||''):'',exteriorImageId:record.exteriorType==='image'?tentExteriorImageId(record):'',outdoorDecor:outdoorDecorState(record),furnishings:(record.furnishings||[]).map(x=>({...x}))};}
function allPlacedTents(){return [...tentStats.values()].filter(t=>t.placed).map(publicTent)}
function tentOwnedBy(identity){return identity?tentStats.get(identity)||null:null}
function tentView(player){
 const t=tentOwnedBy(player.badgeIdentity);
 const earned=Math.floor(badgeTotal(player)/60);
 return {cost:TENT_COST,points:tentPointBalance(player),earned,owned:!!t,tent:t?publicTent(t):null,outdoorDecorCatalog:TENT_OUTDOOR_DECOR,tents:allPlacedTents()};
}
function tentIsValidPlace(x,z,ignoreId){
 // Two open strips of the walkable picnic lawn, not the blankets, stage or beach.
 if(!Number.isFinite(x)||!Number.isFinite(z)||x< -41.5||x>41.5||!((z>=19.6&&z<=22.1)||(z>=35&&z<=38.5)))return false;
 for(const other of tentStats.values())if(other.placed&&other.id!==ignoreId&&Math.hypot(other.x-x,other.z-z)<5.5)return false;
 return true;
}
function sendTentUpdate(){broadcast({type:'tent-update',tents:allPlacedTents()});}
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
 'angel-wings':{name:'천사 날개',slot:'back',cost:280},
 'star-glasses':{name:'별모양 선글라스',slot:'eyes',cost:120},
 'angel-halo':{name:'천사 링',slot:'head',cost:130},
 'butterfly-wings':{name:'나비 날개',slot:'back',cost:260},
 'bunny-ears':{name:'토끼 귀',slot:'head',cost:125}
};
const SHOP_SLOTS=['shirt','head','neck','eyes','back','tail','ears'];
const customMd=new Map();
const MD_ADMIN_KEY=process.env.MD_ADMIN_KEY||'';
function adminAuthorized(req){
 const provided=String(req.headers['x-md-admin-key']||'');
 const a=Buffer.from(provided),b=Buffer.from(MD_ADMIN_KEY);
 return Boolean(MD_ADMIN_KEY&&a.length===b.length&&crypto.timingSafeEqual(a,b));
}

// v231: announcement administrator can use a dedicated key or the existing
// MD_ADMIN_KEY. No admin credentials are ever exposed in game snapshots.
const NOTICE_ADMIN_KEY=process.env.NOTICE_ADMIN_KEY||MD_ADMIN_KEY;
function noticeAdminAuthorized(req){
 const provided=String(req.headers['x-notice-admin-key']||'');
 const a=Buffer.from(provided,'utf8'),b=Buffer.from(NOTICE_ADMIN_KEY,'utf8');
 return !!(NOTICE_ADMIN_KEY&&a.length===b.length&&crypto.timingSafeEqual(a,b));
}
const ENTRY_NOTICE_MAX=16, TICKER_NOTICE_MAX=30, NOTICE_TEXT_MAX=260;
const entranceNotices=[],tickerNotices=[],immediateNoticeHistory=[];
let tickerIntervalMinutes=10, tickerCursor=0, tickerTimer=null, nextTickerAt=0;
const noticeText=value=>String(value??'').replace(/[\x00-\x09\x0b-\x1f\x7f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,NOTICE_TEXT_MAX);
const noticeId=()=>crypto.randomUUID();
function publicNoticeState(){return {entry:entranceNotices.map(n=>({id:n.id,text:n.text})),intervalMinutes:tickerIntervalMinutes};}
function adminNoticeState(){return {...publicNoticeState(),ticker:tickerNotices.map(n=>({...n})),immediateHistory:immediateNoticeHistory.map(n=>({...n})),nextTickerAt};}
function resetNoticeTicker(){
 if(tickerTimer)clearTimeout(tickerTimer);
 tickerTimer=null;nextTickerAt=0;
 if(!tickerNotices.length)return;
 nextTickerAt=Date.now()+tickerIntervalMinutes*60_000;
 tickerTimer=setTimeout(()=>{
  tickerTimer=null;
  if(tickerNotices.length){
   const n=tickerNotices[tickerCursor%tickerNotices.length];
   tickerCursor=(tickerCursor+1)%tickerNotices.length;
   broadcast({type:'festival-notice',kind:'ticker',id:noticeId(),text:n.text,at:Date.now()});
  }
  resetNoticeTicker();
 },tickerIntervalMinutes*60_000);
 tickerTimer.unref();
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
 const earned=Math.floor(badgeTotal(p,now)/60)+(p.badgeIdentity?rhythmAccount(p.badgeIdentity).bonus+powerAccount(p.badgeIdentity).bonus+moleAccount(p.badgeIdentity).bonus+(fieldCoinBonuses.get(p.badgeIdentity)||0):0); // time points + game and field coin rewards
 return {points:tentPointBalance(p),earned,spent:(tentOwnedBy(p.badgeIdentity)?TENT_COST:0)+(furnitureStats.get(p.badgeIdentity)?.spent||0)+(petStats.get(p.badgeIdentity)?.spent||0)+(tentOwnedBy(p.badgeIdentity)?.outdoorDecorSpent||0),refunded:record.refunded||0,testing:true,owned:Object.keys(publicMdItems()),equipped:{...record.equipped},items:publicMdItems()};
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
function stateData(){return {version:17,lotteryStats:Object.fromEntries([...lotteryStats].map(([identity,a])=>[identity,{day:a.day,used:a.used,spent:a.spent,bonus:a.bonus,pending:a.pending,lastResult:a.lastResult}])),petStats:Object.fromEntries([...petStats].map(([identity,record])=>[identity,{spent:record.spent,pet:record.pet}])),fieldCoinLastSpawnAt,fieldCoins:fieldCoinPublic(),fieldCoinBonuses:Object.fromEntries(fieldCoinBonuses),moleDay,moleHammerRevision,moleReward,moleScores:Object.fromEntries(moleScores),moleAccounts:Object.fromEntries([...moleAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session,lastResult:v.lastResult}])),powerDay,powerReward,powerScores:Object.fromEntries(powerScores),powerAccounts:Object.fromEntries([...powerAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session}])),rhythmAccounts:Object.fromEntries([...rhythmAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session}])),furnitureCatalogEdits:Object.fromEntries(furnitureCatalogEdits),furnitureStats:Object.fromEntries([...furnitureStats].map(([id,v])=>[id,{spent:v.spent,owned:v.owned}])),tentStats:Object.fromEntries([...tentStats].map(([identity,t])=>[identity,storedTent(t)])),announcements:{entry:entranceNotices,ticker:tickerNotices,intervalMinutes:tickerIntervalMinutes,immediateHistory:immediateNoticeHistory},music,queue:[...queue],history:[...history],nextTrackToken,customMd:Object.fromEntries(customMd),shopStats:Object.fromEntries([...shopStats].map(([k,v])=>[k,{spent:0,refunded:v.refunded||0,owned:v.owned,equipped:v.equipped}])),badgeStats:Object.fromEntries([...badgeStats].map(([k,v])=>[k,Math.floor(v.seconds||0)])),rhythm:{day:rhythmDay,reward:rhythmReward,scores:Object.fromEntries([...rhythmScores].map(([k,v])=>[k,{name:v.name,score:Math.max(0,Math.floor(Number(v.score)||0)),updatedAt:Number(v.updatedAt)||0}]))},savedAt:Date.now()}}
function applySaved(d){
 if(!d||typeof d!=='object')return;
 petStats.clear();petHatchDurationMigrated=false;
 if(d.petStats&&typeof d.petStats==='object')for(const [identity,r] of Object.entries(d.petStats).slice(0,30000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!r||typeof r!=='object')continue;
  const spent=Number.isSafeInteger(r.spent)&&r.spent>=0&&r.spent<1000000000?r.spent:0;
  const x=r.pet;let pet=null;
  if(x&&PET_SPECIES.includes(x.species)&&PET_COLORS.includes(x.color)&&Number.isFinite(x.adoptedAt)&&Number.isFinite(x.hatchAt)&&Number.isSafeInteger(x.xp)&&x.xp>=0&&x.xp<=1000000){
   // v297: shorten existing eggs too; never postpone a previously scheduled hatch.
   const hatchAt=Math.min(x.hatchAt,x.adoptedAt+PET_HATCH_MS);
   if(hatchAt!==x.hatchAt)petHatchDurationMigrated=true;
   pet={species:x.species,color:x.color,adoptedAt:x.adoptedAt,hatchAt,xp:x.xp,summoned:!!x.summoned};
  }
  petStats.set(identity,{spent,pet});
 }
 fieldCoins.clear();fieldCoinBonuses.clear();
 // Preserve lifetime spend/bonuses across KST day changes and Render restarts.
 lotteryStats.clear();
 if(d.lotteryStats&&typeof d.lotteryStats==='object')for(const [identity,a] of Object.entries(d.lotteryStats).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!a||typeof a!=='object')continue;
  const safeMoney=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000?n:0;
  let pending=null;
  if(a.pending&&/^[a-f0-9-]{36}$/.test(a.pending.id||'')&&LOTTERY_PRIZES.some(t=>t.tier===a.pending.tier)){
   const tier=LOTTERY_PRIZES.find(t=>t.tier===a.pending.tier);
   pending={id:a.pending.id,tier:tier.tier,prize:tier.prize,symbols:[...tier.symbols],createdAt:Number(a.pending.createdAt)||Date.now()};
  }
  const last=a.lastResult;
  const lastResult=last&&/^[a-f0-9-]{36}$/.test(last.id||'')&&LOTTERY_PRIZES.some(t=>t.tier===last.tier)?
   {id:last.id,tier:last.tier,prize:LOTTERY_PRIZES.find(t=>t.tier===last.tier).prize,symbols:[...LOTTERY_PRIZES.find(t=>t.tier===last.tier).symbols],at:Number(last.at)||Date.now()}:null;
  lotteryStats.set(identity,{day:/^\d{4}-\d{2}-\d{2}$/.test(a.day)?a.day:kstDate(),used:Math.max(0,Math.min(LOTTERY_DAILY_LIMIT,Math.floor(Number(a.used)||0))),spent:safeMoney(a.spent),bonus:safeMoney(a.bonus),pending,lastResult});
 }
 if(d.fieldCoinBonuses&&typeof d.fieldCoinBonuses==='object')for(const [key,value] of Object.entries(d.fieldCoinBonuses).slice(0,50000))if(/^[a-zA-Z0-9_-]{20,100}$/.test(key)&&Number.isSafeInteger(value)&&value>=0)fieldCoinBonuses.set(key,value);
 if(Number.isFinite(Number(d.fieldCoinLastSpawnAt)))fieldCoinLastSpawnAt=Math.min(Date.now(),Math.max(0,Number(d.fieldCoinLastSpawnAt)));
 if(Array.isArray(d.fieldCoins))for(const c of d.fieldCoins.slice(0,FIELD_COIN_MAX))if(c&&/^[a-f0-9-]{36}$/.test(c.id||'')&&[10,50,100,500,1000].includes(c.value)&&Number.isFinite(c.x)&&Number.isFinite(c.y)&&c.x>=245&&c.x<=1130&&c.y>=370&&c.y<=735 )fieldCoins.set(c.id,{id:c.id,x:c.x,y:c.y,value:c.value,createdAt:Number(c.createdAt)||Date.now()});
 // Restore furniture metadata BEFORE tents/inventories that reference these IDs.
 furnitureCatalogEdits.clear();
 if(d.furnitureCatalogEdits&&typeof d.furnitureCatalogEdits==='object'){
  for(const [id,entry] of Object.entries(d.furnitureCatalogEdits).slice(0,60)){
   const spec=cleanFurnitureSpec(id,entry,entry?.modelRevision);
   if(spec&&(spec.modelRevision||BUNDLED_TENT_FURNITURE[id]))furnitureCatalogEdits.set(id,spec);
  }
 }
 refreshFurnitureCatalog();
 if(d.announcements&&typeof d.announcements==='object'){
  const cfg=d.announcements;
  const restoreNotices=(source,target,max)=>{
   target.length=0;
   if(!Array.isArray(source))return;
   for(const item of source.slice(0,max)){
    const text=noticeText(item?.text);
    if(text)target.push({id:typeof item.id==='string'&&/^[a-z0-9-]{10,48}$/.test(item.id)?item.id:noticeId(),text,at:Number(item.at)||Date.now()});
   }
  };
  restoreNotices(cfg.entry,entranceNotices,ENTRY_NOTICE_MAX);
  restoreNotices(cfg.ticker,tickerNotices,TICKER_NOTICE_MAX);
  restoreNotices(cfg.immediateHistory,immediateNoticeHistory,25);
  tickerIntervalMinutes=[1,10,30].includes(Number(cfg.intervalMinutes))?Number(cfg.intervalMinutes):10;
 }
 if(d.tentStats&&typeof d.tentStats==='object')for(const [identity,t] of Object.entries(d.tentStats).slice(0,30000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!t||typeof t!=='object')continue;
  if(!/^[a-f0-9-]{36}$/.test(t.id||''))continue;
  const x=Number(t.x),z=Number(t.z);
  const artImage=decodeTentExteriorImage(t.exteriorImage);
  const artType=['none','text','image'].includes(t.exteriorType)?t.exteriorType:'none';
  const artText=clean(t.exteriorText,TENT_EXTERIOR_MAX_TEXT);
  const record={outdoorDecorOwned:Object.fromEntries(Object.keys(TENT_OUTDOOR_DECOR).map(k=>[k,t.outdoorDecor?.owned?.[k]===true])),outdoorDecorEnabled:Object.fromEntries(Object.keys(TENT_OUTDOOR_DECOR).map(k=>[k,t.outdoorDecor?.owned?.[k]===true&&t.outdoorDecor?.enabled?.[k]===true])),outdoorDecorSpent:Math.max(0,Math.min(1000,Math.floor(Number(t.outdoorDecorSpent)||0))),id:t.id,name:clean(t.name,22)||'나의 텐트',color:TENT_COLORS.includes(t.color)?t.color:TENT_COLORS[0],wallColor:Object.hasOwn(TENT_PAINTS,t.wallColor)?t.wallColor:'default',floorColor:Object.hasOwn(TENT_PAINTS,t.floorColor)?t.floorColor:'default',roomLightOn:t.roomLightOn!==false,exteriorType:artType==='image'&&!artImage?'none':artType==='text'&&!artText?'none':artType,exteriorText:artText,exteriorImage:artImage?.source||'',furnishings:[],placed:false,x:null,z:null};
  if(Array.isArray(t.furnishings))for(const f of t.furnishings.slice(0,TENT_FURNITURE_MAX_PLACED)){
   const x=Number(f.x),z=Number(f.z),rotation=Number(f.rotation);
   if(!TENT_FURNITURE_CATALOG[f.itemId]||!/^[-a-f0-9]{36}$/.test(f.instanceId||'')||record.furnishings.some(x=>x.instanceId===f.instanceId))continue;
   if(canPlaceFurniture(record,f.itemId,x,z,rotation))record.furnishings.push({instanceId:f.instanceId,itemId:f.itemId,x,z,rotation});
  }
  if(t.placed===true&&tentIsValidPlace(x,z,t.id)){record.placed=true;record.x=x;record.z=z;}
  tentStats.set(identity,record);
 }
 if(d.furnitureStats&&typeof d.furnitureStats==='object')for(const [identity,r] of Object.entries(d.furnitureStats).slice(0,30000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!r||typeof r!=='object')continue;
  const owned={};for(const [key,n] of Object.entries(r.owned||{}))if(TENT_FURNITURE_CATALOG[key])owned[key]=Math.min(10000,Math.max(0,Math.floor(Number(n)||0)));
  const spent=Math.max(0,Math.min(1000000000,Math.floor(Number(r.spent)||0)));
  furnitureStats.set(identity,{spent,owned});
 }
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
 if(typeof d.moleHammerRevision==='string'&&/^[a-f0-9]{16}$/.test(d.moleHammerRevision))moleHammerRevision=d.moleHammerRevision;
 if(typeof d.moleDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.moleDay))moleDay=d.moleDay;
 if(d.moleScores&&typeof d.moleScores==='object'&&(moleDay===kstDate()||moleDay===previousKstDate()))for(const [identity,row] of Object.entries(d.moleScores).slice(0,50000)){if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row)continue;moleScores.set(identity,{name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.min(10000,Math.floor(Number(row.score)||0))),at:Number(row.at)||Date.now()});}
 if(d.moleReward&&typeof d.moleReward==='object'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.moleReward.identity||''))moleReward={date:String(d.moleReward.date||''),identity:d.moleReward.identity,name:clean(d.moleReward.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(d.moleReward.score)||0)),sourceDate:String(d.moleReward.sourceDate||'')};
 if(d.moleAccounts&&typeof d.moleAccounts==='object')for(const [identity,row] of Object.entries(d.moleAccounts).slice(0,50000)){if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row)continue;const day=/^\d{4}-\d{2}-\d{2}$/.test(row.day)?row.day:kstDate(),v=row.session;const session=v&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&Number.isFinite(v.startedAt)&&Array.isArray(v.positions)&&v.positions.length===MOLE_SLOTS?{id:v.id,name:clean(v.name,18)||'ROCKER',startedAt:v.startedAt,positions:v.positions.map(n=>Math.max(0,Math.min(8,Math.floor(Number(n)||0)))),hits:Array.isArray(v.hits)?v.hits.filter(n=>Number.isInteger(n)&&n>=0&&n<MOLE_SLOTS):[],score:Math.max(0,Math.floor(Number(v.score)||0)),lastHit:Number(v.lastHit)||-2}:null;const restoredSession=day===kstDate()?session:null;
 const lastResult=row.lastResult&&/^[a-f0-9-]{36}$/.test(row.lastResult.playId||'')?{playId:row.lastResult.playId,score:Math.max(0,Math.floor(Number(row.lastResult.score)||0)),prize:Math.max(0,Math.floor(Number(row.lastResult.prize)||0))}:null;
 moleAccounts.set(identity,{day,used:Math.max(0,Math.min(5,Math.floor(Number(row.used)||0))),bonus:Math.max(0,Math.floor(Number(row.bonus)||0)),session:restoredSession,lastResult});
 if(restoredSession)scheduleMoleFinish(identity,restoredSession);}
 if(typeof d.powerDay==='string' &&/^\d{4}-\d{2}-\d{2}$/.test(d.powerDay))powerDay=d.powerDay;
 if(d.powerScores&&typeof d.powerScores==='object'&&(powerDay===kstDate()||powerDay===previousKstDate()))for(const [identity,row] of Object.entries(d.powerScores).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row||typeof row!=='object')continue;
  powerScores.set(identity,{name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.min(1000,Math.floor(Number(row.score)||0))),at:Number(row.at)||Date.now()});
 }
 if(d.powerReward&&typeof d.powerReward==='object'&&typeof d.powerReward.identity==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.powerReward.identity)){
  powerReward={date:String(d.powerReward.date||''),identity:d.powerReward.identity,name:clean(d.powerReward.name,18)||'ROCKER',score:Math.max(0,Math.min(1000,Math.floor(Number(d.powerReward.score)||0))),sourceDate:String(d.powerReward.sourceDate||'')};
 }
 if(d.powerAccounts&&typeof d.powerAccounts==='object')for(const [identity,row] of Object.entries(d.powerAccounts).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row||typeof row!=='object')continue;
  const day=typeof row.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)?row.day:kstDate();
  const used=Math.max(0,Math.min(POWER_DAILY_COINS,Math.floor(Number(row.used)||0)));
  const bonus=Math.max(0,Math.min(100000000,Math.floor(Number(row.bonus)||0)));
  const v=row.session;const session=v&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&Number.isFinite(v.startedAt)?{id:v.id,startedAt:v.startedAt}:null;
  powerAccounts.set(identity,{day,used,bonus,session:day===kstDate()?session:null});
 }
 if(d.rhythmAccounts&&typeof d.rhythmAccounts==='object')for(const [identity,row] of Object.entries(d.rhythmAccounts).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row||typeof row!=='object')continue;
  const day=typeof row.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)?row.day:kstDate();
  const used=Math.max(0,Math.min(RHYTHM_DAILY_COINS,Math.floor(Number(row.used)||0)));
  const bonus=Math.max(0,Math.min(100000000,Math.floor(Number(row.bonus)||0)));
  const v=row.session;
  const session=v&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&Number.isFinite(v.startedAt)?{id:v.id,startedAt:v.startedAt}:null;
  rhythmAccounts.set(identity,{day,used,bonus,session:day===kstDate()?session:null});
 }
 if(d.rhythm&&typeof d.rhythm==='object'){
  rhythmDay=typeof d.rhythm.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.rhythm.day)?d.rhythm.day:kstDate();
  rhythmReward=d.rhythm.reward&&typeof d.rhythm.reward==='object'&&typeof d.rhythm.reward.identity==='string'?{
   date:typeof d.rhythm.reward.date==='string'?d.rhythm.reward.date:kstDate(),
   identity:d.rhythm.reward.identity,
   name:clean(d.rhythm.reward.name,18)||'ROCKER',
   score:Math.max(0,Math.floor(Number(d.rhythm.reward.score)||0)),
   sourceDate:typeof d.rhythm.reward.sourceDate==='string'?d.rhythm.reward.sourceDate:rhythmDay
  }:null;
  rhythmScores.clear();
  if(d.rhythm.scores&&typeof d.rhythm.scores==='object')for(const [identity,row] of Object.entries(d.rhythm.scores).slice(0,50000)){
   if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row||typeof row!=='object')continue;
   rhythmScores.set(identity,{name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(row.score)||0)),updatedAt:Number(row.updatedAt)||0});
  }
 }
 queue.length=0;history.length=0;
 if(Array.isArray(d.history))history.push(...d.history.filter(x=>x&&/^[\w-]{11}$/.test(x.id||'')).slice(-50));
 if(Array.isArray(d.queue))queue.push(...d.queue.filter(x=>x&&/^[\w-]{11}$/.test(x.id||'')).slice(0,50));
 if(d.music&&/^[\w-]{11}$/.test(d.music.id||'')){
  music={...music,...d.music,isLive:d.music.isLive===true};
  if(music.isLive){music.duration=0;music.position=0;}
  if(!music.paused)music.position=music.isLive?0:Math.max(0,(Date.now()-Number(music.startedAt||Date.now()))/1000);
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
 resetNoticeTicker();
 maybeRotateRhythmDay();
 rotatePowerDay();
 rotateMoleDay();
 maintainFieldCoins();
 // One-time v114 migration: legacy spent points were converted into refunded credits.
 // Persist the zero-spend records immediately so restarts never re-deduct them.
 if(petHatchDurationMigrated||[...shopStats.values()].some(r=>r.refunded>0))scheduleSave();
}
function saveNow(){
 if(!restored)return Promise.resolve();
 const data=stateData();localSave(data);
 if(!useSupabase)return Promise.resolve();
 saveChain=saveChain.catch(()=>{}).then(async()=>{try{await supabaseRequest('PATCH',{state:data,updated_at:new Date().toISOString()})}catch(err){console.error('Supabase save failed:',err.message)}});
 return saveChain;
}
function strictSaveAdmin(){
 const data=stateData();localSave(data);
 if(!useSupabase)return Promise.resolve();
 saveChain=saveChain.catch(()=>{}).then(()=>supabaseRequest('PATCH',{state:data,updated_at:new Date().toISOString()}));
 return saveChain;
}
function scheduleSave(){clearTimeout(saveTimeout);saveTimeout=setTimeout(()=>{void saveNow()},120);saveTimeout.unref()}
function pauseForEmpty(){if(players.size===0&&music.id&&!music.paused){music.position=music.isLive?0:Math.max(0,(Date.now()-music.startedAt)/1000);music.paused=true;scheduleSave()}}
function resumeForFirst(){if(players.size===1&&music.id&&music.paused){music.startedAt=music.isLive?Date.now():Date.now()-Math.max(0,music.position||0)*1000;music.paused=false;scheduleSave()}}
process.on('SIGTERM',()=>{pauseForEmpty();clearTimeout(saveTimeout);Promise.race([saveNow(),new Promise(r=>setTimeout(r,2500))]).finally(()=>server.close(()=>process.exit(0)))});

const musicState=()=>({music,queue:queue.map(trackRef),history:history.map(trackRef),serverNow:Date.now()});
function nextTrack(){if(skipVote)finishSkipVote(false,'track-changed');if(music.id){history.push({id:music.id,title:music.title,addedBy:music.changedBy,isLive:music.isLive===true});if(history.length>50)history.shift()}const entry=queue.shift();if(entry){music={id:entry.id,title:entry.title,startedAt:Date.now(),paused:false,position:0,changedBy:entry.addedBy,token:nextTrackToken++,duration:0,isLive:entry.isLive===true}}else{music={id:'',title:'',startedAt:0,paused:true,position:0,changedBy:'',token:nextTrackToken++,duration:0,isLive:false}}broadcast({type:'music',...musicState()});scheduleSave()}
// End-of-track fallback based on reported duration, independent of any one viewer.
setInterval(()=>{if(music.id&&!music.isLive&&!music.paused&&music.duration>0&&(Date.now()-music.startedAt)/1000>music.duration+1)nextTrack()},1500).unref();
const colors = ['#ff747d','#67d8d1','#f9c463','#a8a0ff','#90dd81','#ff9ce1','#72b5ff','#eeeeee','#262631','#373943','#a5e1f9','#f1d9a7','#16171d'];
const patterns=['solid','stripe','wide-stripe'];
const sashes=['none','black','purple','red','green','black-check','red-check','yellow','blue','blue-check','yellow-check','purple-check','black-dot','red-dot','blue-dot','yellow-dot','purple-dot'];
const hats=['none'];
const hairStyles=['short','bob','bob209','long','buns','bob2','short2','verylong','hippie','ponytail','longpart','longshaggy','windswept','shaggy'];
const oldHairMap={wavy:'long',mohawk:'short',spiky:'short',curly:'bob209',buzz:'short','basic-short':'short','basic-bob':'bob209'};
const safeHairStyle=v=>hairStyles.includes(v)?v:(oldHairMap[v]||'short');
const hairColors=['#25222a','#4b3932','#85533e','#edc46b','#d34c53','#4d86d5','#9965c9','#e89bc2','#f8f8f5','#41bb58','#ff973e','#79e4cc'];
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
// v292: End Pepero Day on 2026-11-12 00:00 KST regardless of Render's timezone.
const PEPE_END_AT=Date.UTC(2026,10,11,15,0,0);
function peperoEventActive(){return Date.now()<PEPE_END_AT;}
function normalizePeperoEquipment(p){
 if(p.glowColor!=='pepero'||peperoEventActive())return false;
 p.glowEnabled=false;p.glowColor='lime';return true;
}
// Push the change to every connected client, even if nobody moves or refreshes.
setInterval(()=>{
 if(peperoEventActive())return;
 for(const p of players.values())if(normalizePeperoEquipment(p))broadcast({type:'profile',player:p});
},1000).unref();
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
const snapshot=(viewerId=null)=>({type:'snapshot',tents:allPlacedTents(),announcements:publicNoticeState(),interactions:[...activeDuos.values()].filter(x=>x.endAt>Date.now()),players:[...players.values()],chatRoomId:players.get(viewerId)?.tentRoomId||null,chat:chatForRoom(players.get(viewerId)?.tentRoomId||null),...musicState(),skipVote:publicSkipVote(),skipVoteCooldownUntil,slam:publicSlam(),slamCooldownUntil,rockPlay:publicRock(),crowdSurf:activeSurfRide&&activeSurfRide.startAt+activeSurfRide.duration>Date.now()?activeSurfRide:null,rockCooldowns:{...rockCooldowns},rockRunningUntil,rhythm:publicRhythmState(),power:publicPowerState(),mole:publicMoleState(),fieldCoins:fieldCoinPublic(),count:players.size});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
const SERVER_X_MIN=20,SERVER_X_MAX=1380,SERVER_Y_MIN=60,SERVER_Y_MAX=1100;
function cleanup(){const now=Date.now();for(const [id,p] of players)if(now-p.seen>180000){settleBadge(p,Math.min(now,p.seen+45000));settleBadge(p);clearDuosFor(id);players.delete(id);forgetSession(id);voterLeaves(id);if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();const r=clients.get(id);if(r){r.end();clients.delete(id)}broadcast({type:'leave',id,count:players.size});sendTentUpdate()}}
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
setInterval(()=>{if(restored){maybeRotateRhythmDay();rotatePowerDay();rotateMoleDay()}},30000).unref();

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
   thumb:'https://i.ytimg.com/vi/'+x.id.videoId+'/mqdefault.jpg',
   isLive:x.snippet?.liveBroadcastContent==='live'
  }));
  ytSearchCache.set(key,{time:Date.now(),items});
  if(ytSearchCache.size>100)ytSearchCache.delete(ytSearchCache.keys().next().value);
  return items;
 }finally{clearTimeout(timer)}
}
// v233: Detect active YouTube livestreams through the official videos.list API.
// Without YOUTUBE_API_KEY, /live/ links or the visitor's explicit LIVE switch
// still reliably identify a stream; never infer LIVE from title keywords.
const ytLiveCache=new Map();
function livePathHint(value){
 try {const u=new URL(String(value||''));return /^(www\.)?(youtube\.com|m\.youtube\.com)$/.test(u.hostname)&&/^\/live\/[\w-]{11}\/?$/.test(u.pathname)}catch{return false}
}
async function youtubeIsLive(id){
 if(!YOUTUBE_API_KEY)return null;
 const cached=ytLiveCache.get(id);
 if(cached&&Date.now()-cached.at<(cached.isLive?60000:300000))return cached.isLive;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4200);
 try{
  const params=new URLSearchParams({part:'snippet,liveStreamingDetails',id,key:YOUTUBE_API_KEY});
  const response=await fetch('https://www.googleapis.com/youtube/v3/videos?'+params.toString(),{signal:controller.signal});
  if(!response.ok)return null;
  const info=(await response.json()).items?.[0];
  if(!info)return null;
  const isLive=info.snippet?.liveBroadcastContent==='live'||!!(info.liveStreamingDetails?.actualStartTime&&!info.liveStreamingDetails?.actualEndTime);
  ytLiveCache.set(id,{isLive,at:Date.now()});
  if(ytLiveCache.size>256)ytLiveCache.delete(ytLiveCache.keys().next().value);
  return isLive;
 }catch{return null}finally{clearTimeout(timer)}
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
  if(url.pathname==='/api/mole-hammer-model'&&req.method==='GET'){
    if(!moleHammerRevision)return json(res,404,{error:'망치 GLB가 아직 등록되지 않았어요.'});
    try{let bytes;if(useSupabase){const r=await fetch(SB_URL+'/storage/v1/object/'+encodeURIComponent(TENT_ASSET_BUCKET)+'/'+storageObjectPath('mole-hammer',moleHammerRevision),{headers:storageHeaders(),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Storage '+r.status);bytes=Buffer.from(await r.arrayBuffer());}else bytes=fs.readFileSync(path.join(TENT_MODEL_DIR,'mole-hammer-'+moleHammerRevision+'.glb'));
      res.writeHead(200,{'content-type':'model/gltf-binary','content-length':bytes.length,'cache-control':'public,max-age=3600'});return res.end(bytes);
    }catch(e){return json(res,404,{error:'망치 GLB 파일을 불러오지 못했어요.'});}
  }
  if(url.pathname.startsWith('/api/tent-item-model/')&&req.method==='GET'){
   const id=url.pathname.slice('/api/tent-item-model/'.length);
   if(!TENT_ITEM_ID.test(id))return json(res,404,{error:'모델 없음'});
   return serveFurnitureModel(req,res,id);
  }
  if(url.pathname.startsWith('/api/tent-item-admin/model/')&&req.method==='PUT'){
   if(!restored)return json(res,503,{error:'서버 복원 중이에요.'});
   if(!MD_ADMIN_KEY||!adminAuthorized(req))return json(res,403,{error:'관리자 키가 올바르지 않아요.'});
   const id=url.pathname.slice('/api/tent-item-admin/model/'.length);
   if(!TENT_ITEM_ID.test(id))return json(res,400,{error:'아이템 ID는 영문 소문자·숫자·-·_만 사용할 수 있어요.'});
   try{
    const bytes=await rawBody(req,TENT_MODEL_MAX_BYTES);
    validateGlb(bytes);
    const revision=crypto.randomBytes(8).toString('hex');
    const storage=await storageUpload(id,revision,bytes);
    return json(res,200,{ok:true,revision,storage,size:bytes.length});
   }catch(e){console.warn('Furniture model upload:',e.message);return json(res,e.code==='TOO_BIG'?413:400,{error:e.message})}
  }
  if(url.pathname.startsWith('/api/tent-exterior-image/')&&req.method==='GET'){
    const imageId=url.pathname.slice('/api/tent-exterior-image/'.length);
    if(!/^[a-f0-9]{32}$/.test(imageId)){res.writeHead(404);return res.end('Not found')}
    const matched=[...tentStats.values()].find(t=>t.exteriorType==='image'&&tentExteriorImageId(t)===imageId);
    const image=matched?decodeTentExteriorImage(matched.exteriorImage):null;
    if(!image){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'content-type':'image/'+image.mime,'cache-control':'public,max-age=31536000,immutable','x-content-type-options':'nosniff'});
    return res.end(image.bytes);
  }
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
    clients.get(id)?.end();clients.set(id,res);send(res,snapshot(id));
    const heartbeat=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},15000);
    req.on('close',()=>{clearInterval(heartbeat);if(clients.get(id)===res)clients.delete(id)});return;
  }
  if(url.pathname.startsWith('/api/')&&req.method==='POST'){
    try{
      const d=await receive(req);
      if(url.pathname==='/api/notice-admin'){
       if(!NOTICE_ADMIN_KEY)return json(res,503,{error:'Render 환경변수 NOTICE_ADMIN_KEY 또는 MD_ADMIN_KEY를 설정해 주세요.'});
       if(!noticeAdminAuthorized(req))return json(res,403,{error:'관리자 키가 올바르지 않습니다.'});
       const command=String(d.command||'');
       if(command==='list')return json(res,200,{ok:true,...adminNoticeState()});
       if(command==='immediate'){
        const text=noticeText(d.text);
        if(!text)return json(res,400,{error:'공지 내용을 입력해 주세요.'});
        const notice={id:noticeId(),text,at:Date.now()};
        immediateNoticeHistory.unshift(notice);immediateNoticeHistory.splice(25);
        // Live viewers get a prominent, dismissible banner immediately.
        broadcast({type:'festival-notice',kind:'immediate',...notice});
        scheduleSave();
        return json(res,200,{ok:true,recipients:clients.size,...adminNoticeState()});
       }
       if(command==='add-entry'||command==='add-ticker'){
        const list=command==='add-entry'?entranceNotices:tickerNotices;
        const maximum=command==='add-entry'?ENTRY_NOTICE_MAX:TICKER_NOTICE_MAX;
        if(list.length>=maximum)return json(res,400,{error:'해당 공지 목록의 등록 한도를 초과했습니다.'});
        const text=noticeText(d.text);
        if(!text)return json(res,400,{error:'공지 내용을 입력해 주세요.'});
        list.push({id:noticeId(),text,at:Date.now()});
        if(command==='add-ticker')resetNoticeTicker();
        scheduleSave();
        return json(res,200,{ok:true,...adminNoticeState()});
       }
       if(command==='delete'){
        const category=String(d.category||'');
        const list=category==='entry'?entranceNotices:category==='ticker'?tickerNotices:category==='immediate'?immediateNoticeHistory:null;
        if(!list)return json(res,400,{error:'삭제할 공지 유형이 잘못됐어요.'});
        const i=list.findIndex(n=>n.id===d.noticeId);
        if(i<0)return json(res,404,{error:'삭제할 공지를 찾을 수 없어요.'});
        list.splice(i,1);
        if(category==='ticker'){tickerCursor=0;resetNoticeTicker();}
        scheduleSave();
        return json(res,200,{ok:true,...adminNoticeState()});
       }
       if(command==='set-interval'){
        const minutes=Number(d.minutes);
        if(![1,10,30].includes(minutes))return json(res,400,{error:'간격은 1분, 10분, 30분만 가능합니다.'});
        tickerIntervalMinutes=minutes;tickerCursor=0;resetNoticeTicker();scheduleSave();
        return json(res,200,{ok:true,...adminNoticeState()});
       }
       return json(res,400,{error:'알 수 없는 공지 관리자 명령입니다.'});
      }
      if(url.pathname==='/api/tent-item-admin'){
       if(!MD_ADMIN_KEY)return json(res,503,{error:'Render 환경변수 MD_ADMIN_KEY를 설정해 주세요.'});
       if(!adminAuthorized(req))return json(res,403,{error:'관리자 키가 올바르지 않아요.'});
       const command=String(d.command||'');
       if(command==='list')return json(res,200,{ok:true,items:furnitureAdminCatalog(),storage:useSupabase?'supabase':'local'});
       if(command==='save'){
        const id=String(d.id||'');
        if(!TENT_ITEM_ID.test(id))return json(res,400,{error:'상품 ID는 영문 소문자·숫자·-·_ 32자 이내로 입력해 주세요.'});
        const previous=TENT_FURNITURE_CATALOG[id];
        const revision=d.modelRevision===undefined?(previous?.modelRevision||''):String(d.modelRevision||'');
        const spec=cleanFurnitureSpec(id,d,revision);
        if(!spec)return json(res,400,{error:'상품명·가격(0~50,000P)·가로/깊이/높이(0.1~8)를 확인해 주세요.'});
        if(!revision&&!BUNDLED_TENT_FURNITURE[id])return json(res,400,{error:'새 상품은 GLB 파일을 먼저 업로드해야 해요.'});
        if(!previous&&Object.keys(TENT_FURNITURE_CATALOG).length>=60)return json(res,409,{error:'등록 한도는 60개예요.'});
        if(revision&&revision!==previous?.modelRevision&&!await storageExists(id,revision))return json(res,400,{error:'업로드한 GLB 파일을 찾지 못했어요. 다시 업로드해 주세요.'});
        const placed=[...tentStats.values()].some(t=>(t.furnishings||[]).some(f=>f.itemId===id));
        if(placed&&previous&&(spec.width!==previous.width||spec.depth!==previous.depth))return json(res,409,{error:'배치 중인 아이템의 가로·깊이는 변경할 수 없어요. 먼저 회수한 뒤 수정해 주세요.'});
        furnitureCatalogEdits.set(id,spec);refreshFurnitureCatalog();await strictSaveAdmin();furnitureCatalogChanged();sendTentUpdate();
        return json(res,200,{ok:true,items:furnitureAdminCatalog()});
       }
       if(command==='delete'){
        const id=String(d.id||'');if(!TENT_ITEM_ID.test(id)||!TENT_FURNITURE_CATALOG[id])return json(res,404,{error:'상품이 없어요.'});
        if(BUNDLED_TENT_FURNITURE[id])return json(res,409,{error:'기본 제공 상품은 삭제할 수 없어요. 판매 중지로 설정해 주세요.'});
        if([...furnitureStats.values()].some(v=>Number(v.owned?.[id])>0)||[...tentStats.values()].some(v=>(v.furnishings||[]).some(f=>f.itemId===id)))return json(res,409,{error:'구매하거나 배치한 사람이 있어 삭제할 수 없어요. 판매 중지로 바꿔 주세요.'});
        furnitureCatalogEdits.delete(id);refreshFurnitureCatalog();await strictSaveAdmin();furnitureCatalogChanged();sendTentUpdate();
        return json(res,200,{ok:true,items:furnitureAdminCatalog()});
       }
       return json(res,400,{error:'알 수 없는 인테리어 관리자 명령이에요.'});
      }
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
      if(url.pathname==='/api/mole-admin'){
        if(!MD_ADMIN_KEY||!adminAuthorized(req))return json(res,403,{error:'관리자 키를 확인해 주세요.'});
        if(d.command==='state')return json(res,200,{ok:true,revision:moleHammerRevision,url:moleHammerRevision?'/api/mole-hammer-model?v='+moleHammerRevision:''});
        if(d.command==='save-hammer'){
          const revision=String(d.revision||'');if(!/^[a-f0-9]{16}$/.test(revision)||!await storageExists('mole-hammer',revision))return json(res,400,{error:'GLB 파일을 먼저 업로드해 주세요.'});
          moleHammerRevision=revision;await strictSaveAdmin();broadcast({type:'mole-state',mole:publicMoleState()});return json(res,200,{ok:true,revision});
        }
        return json(res,400,{error:'잘못된 관리자 명령입니다.'});
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
            maybeRotateRhythmDay();
            existing.seen=Date.now();
            syncPlayerRhythmKing(existing);syncPlayerPowerKing(existing);syncPlayerMoleKing(existing);existing.pet=petPublic(petStats.get(existing.badgeIdentity)?.pet);
            if(pageId)pageOwners.set(existingId,pageId);
            return json(res,200,{id:existingId,reused:true,...snapshot(existingId)});
          }
          if(existingId)sessionPlayers.delete(sessionKey);
        }
        maybeRotateRhythmDay();
        const id=crypto.randomUUID(),p={id,badgeSince:Date.now(),badgeTier:'bronze',badgeSeconds:0,name:clean(d.name,18)||'ROCKER',flagText:cleanFlag(d.flagText),flagImage:d.flagImage?storeFlagImage(d.flagImage)||'':'',color:colors.includes(d.color)?d.color:colors[0],...apparel(d),gender:d.gender==='female'?'female':'male',x:clamp(190+Math.random()*880,SERVER_X_MIN,SERVER_X_MAX),y:clamp(390+Math.random()*420,SERVER_Y_MIN,SERVER_Y_MAX),facing:0,action:'idle',pose:'stand',glowColor:'lime',glowEnabled:false,headbangBpm:120,headbangBeatAt:Date.now(),seen:Date.now(),rhythmKing:false,powerKing:false,moleKing:false};
        Object.defineProperty(p,'badgeIdentity',{value:badgeIdentity,writable:true,enumerable:false});updateBadge(p);syncPlayerRhythmKing(p);syncPlayerPowerKing(p);syncPlayerMoleKing(p);setShopAppearance(p);p.pet=petPublic(petStats.get(p.badgeIdentity)?.pet);players.set(id,p);
        if(sessionKey){sessionPlayers.set(sessionKey,id);playerSessions.set(id,sessionKey)}
        if(pageId)pageOwners.set(id,pageId);
        resumeForFirst();broadcast({type:'join',player:p,count:players.size});return json(res,200,{id,reused:false,...snapshot(id)});
      }
      const id=clean(d.id,80),p=players.get(id);if(!p)return json(res,401,{error:'Session expired. Please rejoin.'});p.seen=Date.now();
      if(url.pathname==='/api/field-coin'){
        if(String(d.command||'')==='state')return json(res,200,{ok:true,coins:fieldCoinPublic()});
        // Session secret prevents third-party use of the publicly visible avatar id.
        if(playerSessions.get(id)!==String(d.sessionKey||'')||!p.badgeIdentity)return json(res,403,{error:'본인 세션으로 접속해 주세요.'});
        if(p.tentRoomId)return json(res,400,{error:'텐트 밖에서만 동전을 주울 수 있어요.'});
        const coin=fieldCoins.get(String(d.coinId||''));
        if(!coin)return json(res,404,{error:'이미 다른 유저가 주운 동전이에요.'});
        if(Math.hypot((p.x-coin.x)*.058,(p.y-coin.y)*.058)>2.8)return json(res,400,{error:'동전에 더 가까이 가서 클릭해 주세요.'});
        fieldCoins.delete(coin.id); // consume atomically before asynchronous persistence
        fieldCoinBonuses.set(p.badgeIdentity,(fieldCoinBonuses.get(p.badgeIdentity)||0)+coin.value);
        broadcast({type:'field-coins',coins:fieldCoinPublic()});
        await saveNow();
        return json(res,200,{ok:true,value:coin.value,points:tentPointBalance(p),coins:fieldCoinPublic()});
      }

      if(url.pathname==='/api/lottery'){
        if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서만 복권을 이용할 수 있어요.'});
        const command=String(d.command||'');
        if(command==='state')return json(res,200,{ok:true,lottery:lotteryAccountView(p)});
        const a=lotteryAccount(p.badgeIdentity);
        if(command==='buy'){
          if(!lotteryNearBooth(p))return json(res,403,{error:'복권샵 부스 근처에서 구매할 수 있어요.'});
          if(a.pending)return json(res,409,{error:'먼저 구매한 복권을 긁어주세요.',lottery:lotteryAccountView(p)});
          if(a.used>=LOTTERY_DAILY_LIMIT)return json(res,409,{error:'오늘은 5장을 모두 구매했어요. 한국 시간 자정에 초기화돼요.'});
          if(tentPointBalance(p)<LOTTERY_PRICE)return json(res,409,{error:'복권 구매에 필요한 100P가 부족해요.'});
          const tier=lotteryDraw();
          a.pending={id:crypto.randomUUID(),tier:tier.tier,prize:tier.prize,symbols:[...tier.symbols],createdAt:Date.now()};
          a.used++;a.spent+=LOTTERY_PRICE;
          await saveNow();
          return json(res,200,{ok:true,lottery:lotteryAccountView(p)});
        }
        if(command==='reveal'){
          const ticketId=String(d.ticketId||'');
          if(a.lastResult?.id===ticketId)return json(res,200,{ok:true,result:a.lastResult,lottery:lotteryAccountView(p)});
          if(!a.pending||a.pending.id!==ticketId)return json(res,409,{error:'유효한 복권이 없어요.'});
          const ticket=a.pending;
          a.bonus+=ticket.prize;
          a.lastResult={id:ticket.id,tier:ticket.tier,prize:ticket.prize,symbols:[...ticket.symbols],at:Date.now()};
          a.pending=null; // One-way settlement, safe against double requests.
          await saveNow();
          return json(res,200,{ok:true,result:a.lastResult,lottery:lotteryAccountView(p)});
        }
        return json(res,400,{error:'지원하지 않는 복권 명령입니다.'});
      }
      if(url.pathname==='/api/pet'){
        if(playerSessions.get(id)!==String(d.sessionKey||'')||!p.badgeIdentity)return json(res,403,{error:'본인 세션에서만 펫을 관리할 수 있어요.'});
        const command=String(d.command||'status');
        if(command==='status')return json(res,200,{ok:true,...petView(p)});
        const record=petAccount(p.badgeIdentity);
        const pet=record.pet;
        if(command==='adopt'){
          if(pet)return json(res,409,{error:'이미 펫이 있어요. 기존 펫을 삭제한 후 새 알을 입양할 수 있어요.'});
          if(tentPointBalance(p)<PET_ADOPTION_COST)return json(res,400,{error:`입양 포인트가 부족해요. (${tentPointBalance(p)}/${PET_ADOPTION_COST}P)`});
          const now=Date.now();record.spent+=PET_ADOPTION_COST;
          record.pet={species:PET_SPECIES[crypto.randomInt(PET_SPECIES.length)],color:PET_COLORS[crypto.randomInt(PET_COLORS.length)],adoptedAt:now,hatchAt:now+PET_HATCH_MS,xp:0,summoned:true};
        }else if(command==='feed'){
          if(!pet)return json(res,400,{error:'먼저 펫 알을 입양해 주세요.'});
          if(Date.now()<pet.hatchAt)return json(res,400,{error:'알이 부화한 다음 먹이를 줄 수 있어요.'});
          if(petLevel(pet.xp)>=PET_MAX_LEVEL)return json(res,400,{error:'이미 최고 레벨이에요.'});
          const food=PET_FOODS[String(d.food||'')];if(!food)return json(res,400,{error:'존재하지 않는 먹이예요.'});
          if(tentPointBalance(p)<food.cost)return json(res,400,{error:'먹이를 살 포인트가 부족해요.'});
          record.spent+=food.cost;pet.xp=Math.min(1000000,pet.xp+food.xp);
        }else if(command==='summon'){
          if(!pet)return json(res,400,{error:'먼저 펫 알을 입양해 주세요.'});
          pet.summoned=true;
        }else if(command==='unsummon'){
          if(!pet)return json(res,400,{error:'펫이 없어요.'});pet.summoned=false;
        }else if(command==='release'){
          if(!pet)return json(res,400,{error:'삭제할 펫이 없어요.'});
          if(d.confirm!=='DELETE')return json(res,400,{error:'펫 삭제 확인이 필요해요.'});
          record.pet=null; // spent points never refunded
        }else return json(res,400,{error:'지원하지 않는 펫 기능입니다.'});
        syncPetPlayers(p.badgeIdentity);
        await saveNow();
        return json(res,200,{ok:true,...petView(p)});
      }
      if(url.pathname==='/api/heartbeat'){return json(res,200,{ok:true})}
      if(url.pathname==='/api/tent'){
        // Public player IDs are visible in snapshots. A private per-tab key is
        // mandatory for tent purchase, ownership and room access.
        const sessionKey=String(d.sessionKey||'');
        if(!sessionKey||playerSessions.get(id)!==sessionKey)return json(res,403,{error:'이 브라우저의 입장 세션을 확인할 수 없어요.'});
        if(!p.badgeIdentity)return json(res,400,{error:'포인트 적립을 위해 브라우저 저장소를 허용해 주세요.'});
        const command=String(d.command||'status');
        if(command==='status')return json(res,200,{ok:true,...tentView(p)});
        let record=tentOwnedBy(p.badgeIdentity);
        if(command==='buy'){
          if(record)return json(res,409,{error:'이미 텐트를 보유하고 있어요.',...tentView(p)});
          const earned=tentPointBalance(p);
          if(earned<TENT_COST)return json(res,400,{error:`포인트가 부족해요. (${earned.toLocaleString()}/${TENT_COST.toLocaleString()}P)`});
          record={id:crypto.randomUUID(),name:clean(p.name+'의 텐트',22),color:TENT_COLORS[0],wallColor:'default',floorColor:'default',roomLightOn:true,exteriorType:'none',exteriorText:'',exteriorImage:'',furnishings:[],placed:false,x:null,z:null};
          tentStats.set(p.badgeIdentity,record);
          await saveNow();
          return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='enter'){
          const selected=[...tentStats.values()].find(t=>t.id===String(d.tentId||'')&&t.placed);
          if(!selected)return json(res,404,{error:'설치된 텐트를 찾을 수 없어요.'});
          if(p.tentRoomId&&p.tentRoomId!==selected.id)return json(res,409,{error:'다른 텐트에 들어가려면 먼저 밖으로 나가주세요.'});
          if(tentEntranceDistance(p,selected)>TENT_ENTER_DISTANCE)return json(res,403,{error:'텐트 주변(5m 이내)으로 이동해야 들어갈 수 있어요.'});
          if(p.tentRoomId!==selected.id&&tentOccupancy(selected.id)>=TENT_MAX_OCCUPANCY)return json(res,409,{error:'이 텐트는 정원 4명이 모두 입장 중이에요.'});
          // An indoor player cannot participate in outdoor two-player interactions.
          // Cancel old invitations and paired animations before entering.
          clearDuosFor(p.id);
          p.tentRoomId=selected.id;p.tentRoomX=0;p.tentRoomZ=2;p.tentRoomFacing=0;
          p.action='idle';p.pose='stand';broadcast({type:'tent-room',playerId:p.id,roomId:p.tentRoomId,x:0,z:2,action:'idle',pose:'stand'});
          sendTentUpdate();
          return json(res,200,{ok:true,room:publicTent(selected),furnitureCatalog:TENT_FURNITURE_CATALOG,canDecorate:record?.id===selected.id,tents:allPlacedTents(),chatRoomId:selected.id,chat:chatForRoom(selected.id)});
        }
        if(command==='exit'){
          const hadRoom=Boolean(p.tentRoomId);
          p.tentRoomId=null;p.tentRoomX=0;p.tentRoomZ=0;p.action='idle';p.pose='stand';
          broadcast({type:'tent-room',playerId:p.id,roomId:null,x:0,z:0,action:'idle',pose:'stand'});
          if(hadRoom)sendTentUpdate();
          return json(res,200,{ok:true,chatRoomId:null,chat:chatForRoom(null)});
        }
        if(command==='room-move'){
          if(!p.tentRoomId)return json(res,400,{error:'먼저 텐트에 입장해 주세요.'});
          p.tentRoomX=clamp(d.x,-4.6,4.6);p.tentRoomZ=clamp(d.z,-3.6,3.6);p.tentRoomFacing=clamp(d.facing,-Math.PI,Math.PI);
          broadcast({type:'tent-room',playerId:p.id,roomId:p.tentRoomId,x:p.tentRoomX,z:p.tentRoomZ,facing:p.tentRoomFacing});
          return json(res,200,{ok:true});
        }
        if(command==='room-action'){
          if(!p.tentRoomId)return json(res,400,{error:'먼저 텐트에 입장해 주세요.'});
          const allowed=['idle','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','dougie','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','beatking','powerking','moleking','putyourhandsup','heartbow','drum','electricguitar','bassguitar','vocal'];
          const action=String(d.action||'idle');
          p.action=allowed.includes(action)&&!(action==='beatking'&&!playerIsRhythmKing(p))&&!(action==='powerking'&&!playerIsPowerKing(p))&&!(action==='moleking'&&!playerIsMoleKing(p))?action:'idle';
          p.pose=['stand','sit','lie'].includes(d.pose)?d.pose:'stand';
          p.headbangBpm=clamp(d.headbangBpm||120,40,240);
          const beatAt=Number(d.headbangBeatAt);p.headbangBeatAt=Number.isFinite(beatAt)&&Math.abs(beatAt-Date.now())<86400000?beatAt:Date.now();
          p.glowEnabled=d.glowEnabled===true;
          p.glowColor=['red','pink','blue','lime','yellow','white','rainbow',...(peperoEventActive()?['pepero']:[])].includes(d.glowColor)?d.glowColor:'lime';
          if(d.glowColor==='pepero'&&!peperoEventActive())p.glowEnabled=false;
          broadcast({type:'tent-room',playerId:p.id,roomId:p.tentRoomId,x:p.tentRoomX,z:p.tentRoomZ,facing:p.tentRoomFacing,action:p.action,pose:p.pose,headbangBpm:p.headbangBpm,headbangBeatAt:p.headbangBeatAt,glowEnabled:p.glowEnabled,glowColor:p.glowColor});
          return json(res,200,{ok:true});
        }
        if(command==='furniture-status'){
          if(!record)return json(res,403,{error:'개인 텐트를 먼저 구매해 주세요.'});
          return json(res,200,{ok:true,...furnitureInventoryView(p)});
        }
        if(command==='furniture-buy'){
          if(!record||p.tentRoomId!==record.id)return json(res,403,{error:'자신의 텐트 안에서만 아이템을 구매할 수 있어요.'});
          const itemId=String(d.itemId||''),item=TENT_FURNITURE_CATALOG[itemId];
          if(!item||item.enabled===false)return json(res,400,{error:'현재 판매하지 않는 인테리어 아이템이에요.'});
          if(tentPointBalance(p)<item.cost)return json(res,409,{error:'구매할 포인트가 부족해요.'});
          const inv=furnitureRecord(p.badgeIdentity);
          if((inv.owned[itemId]||0)>=100)return json(res,409,{error:'같은 아이템은 최대 100개까지 구매할 수 있어요.'});
          inv.spent+=item.cost;inv.owned[itemId]=(inv.owned[itemId]||0)+1;
          await saveNow();return json(res,200,{ok:true,...furnitureInventoryView(p)});
        }
        if(command==='furniture-place'){
          if(!record||p.tentRoomId!==record.id)return json(res,403,{error:'텐트 주인만 소품을 배치할 수 있어요.'});
          const itemId=String(d.itemId||''),item=TENT_FURNITURE_CATALOG[itemId],inv=furnitureRecord(p.badgeIdentity);
          if(!item)return json(res,400,{error:'존재하지 않는 아이템이에요.'});
          if((record.furnishings||[]).length>=TENT_FURNITURE_MAX_PLACED)return json(res,409,{error:'한 텐트에 최대 30개까지만 배치할 수 있어요.'});
          const placedCount=(record.furnishings||[]).filter(f=>f.itemId===itemId).length;
          if((inv.owned[itemId]||0)<=placedCount)return json(res,409,{error:'배치 가능한 보유 아이템이 없어요.'});
          const x=Number(d.x),z=Number(d.z),rotation=Number(d.rotation);
          if(!canPlaceFurniture(record,itemId,x,z,rotation))return json(res,409,{error:'해당 위치는 소품을 배치할 수 없어요.'});
          record.furnishings??=[];record.furnishings.push({instanceId:crypto.randomUUID(),itemId,x:Math.round(x*100)/100,z:Math.round(z*100)/100,rotation});
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...furnitureInventoryView(p),room:publicTent(record)});
        }
        if(command==='furniture-remove'){
          if(!record||p.tentRoomId!==record.id)return json(res,403,{error:'텐트 주인만 소품을 회수할 수 있어요.'});
          const found=(record.furnishings||[]).findIndex(x=>x.instanceId===String(d.instanceId||''));
          if(found<0)return json(res,404,{error:'배치된 아이템을 찾지 못했어요.'});
          record.furnishings.splice(found,1);
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...furnitureInventoryView(p),room:publicTent(record)});
        }
        if(command==='room-light'){
          if(!record||!p.tentRoomId||p.tentRoomId!==record.id)return json(res,403,{error:'텐트 주인만 전체 조명을 조작할 수 있어요.'});
          if(typeof d.enabled!=='boolean')return json(res,400,{error:'조명 상태가 올바르지 않아요.'});
          record.roomLightOn=d.enabled;
          await saveNow();sendTentUpdate();
          return json(res,200,{ok:true,room:publicTent(record)});
        }
        if(command==='decorate'){
          if(!record||!p.tentRoomId||p.tentRoomId!==record.id)return json(res,403,{error:'텐트 주인만 실내를 꾸밀 수 있어요.'});
          if(!Object.hasOwn(TENT_PAINTS,d.wallColor)||!Object.hasOwn(TENT_PAINTS,d.floorColor))return json(res,400,{error:'허용된 벽·바닥 색상을 선택해 주세요.'});
          record.wallColor=d.wallColor;record.floorColor=d.floorColor;
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,room:publicTent(record)});
        }
        if(!record)return json(res,403,{error:'먼저 텐트를 구매해 주세요.'});
        if(command==='outdoor-decor'){
          const itemId=String(d.itemId||'');
          const spec=TENT_OUTDOOR_DECOR[itemId];
          if(!spec)return json(res,400,{error:'존재하지 않는 외부 꾸미기 아이템이에요.'});
          record.outdoorDecorOwned??={};record.outdoorDecorEnabled??={};
          if(d.action==='buy'){
            if(record.outdoorDecorOwned[itemId])return json(res,409,{error:'이미 구매한 아이템이에요.'});
            if(tentPointBalance(p)<spec.cost)return json(res,409,{error:'포인트가 부족해요. 500P가 필요해요.'});
            record.outdoorDecorOwned[itemId]=true;record.outdoorDecorEnabled[itemId]=true;
            record.outdoorDecorSpent=(record.outdoorDecorSpent||0)+spec.cost;
          }else if(d.action==='toggle'){
            if(!record.outdoorDecorOwned[itemId])return json(res,403,{error:'아이템을 먼저 구매해 주세요.'});
            if(typeof d.enabled!=='boolean')return json(res,400,{error:'설정 값이 올바르지 않아요.'});
            record.outdoorDecorEnabled[itemId]=d.enabled;
          }else return json(res,400,{error:'지원하지 않는 아이템 명령이에요.'});
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='exterior'){
          const mode=String(d.exteriorType||'');
          if(!['none','text','image'].includes(mode))return json(res,400,{error:'장식 종류를 선택해 주세요.'});
          if(mode==='text'){
            const exteriorText=clean(d.exteriorText,TENT_EXTERIOR_MAX_TEXT);
            if(!exteriorText)return json(res,400,{error:'텐트에 표시할 문구를 입력해 주세요.'});
            record.exteriorType='text';record.exteriorText=exteriorText;record.exteriorImage='';
          }else if(mode==='image'){
            if(d.exteriorImage){
              const image=decodeTentExteriorImage(d.exteriorImage);
              if(!image)return json(res,400,{error:'이미지는 90KB 이하의 JPG 또는 WebP 형식이어야 해요.'});
              record.exteriorImage=image.source;
            }
            if(!decodeTentExteriorImage(record.exteriorImage))return json(res,400,{error:'이미지를 먼저 선택해 주세요.'});
            record.exteriorType='image';record.exteriorText='';
          }else{record.exteriorType='none';record.exteriorText='';record.exteriorImage='';}
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='save'){
          const name=clean(d.name,22);
          if(name.length<1)return json(res,400,{error:'텐트 이름을 입력해 주세요.'});
          if(!TENT_COLORS.includes(d.color))return json(res,400,{error:'목록에 있는 텐트 색상을 선택해 주세요.'});
          record.name=name;record.color=d.color;
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='place'){
          const x=Number(d.x),z=Number(d.z);
          if(!tentIsValidPlace(x,z,record.id))return json(res,400,{error:'여기는 설치할 수 없어요. 돗자리 앞뒤의 잔디 공간에서 다른 텐트와 떨어진 곳을 선택해 주세요.'});
          if(allPlacedTents().length>=40&&!record.placed)return json(res,409,{error:'현재 캠핑 공간이 가득 찼어요.'});
          record.placed=true;record.x=x;record.z=z;
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='pack'){
          record.placed=false;record.x=null;record.z=null;
          for(const other of players.values())if(other.tentRoomId===record.id){other.tentRoomId=null;other.tentRoomX=0;other.tentRoomZ=0;broadcast({type:'tent-room',playerId:other.id,roomId:null,x:0,z:0});}
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
        }
        return json(res,400,{error:'지원하지 않는 텐트 기능입니다.'});
      }
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
      if(url.pathname==='/api/profile'){p.name=clean(d.name,18)||'ROCKER';p.color=colors.includes(d.color)?d.color:p.color;p.gender=d.gender==='female'?'female':'male';Object.assign(p,apparel(d,p));if(p.badgeIdentity&&rhythmScores.has(p.badgeIdentity)){const row=rhythmScores.get(p.badgeIdentity);row.name=p.name;rhythmScores.set(p.badgeIdentity,row);broadcastRhythmState();scheduleSave();}if(p.badgeIdentity&&powerScores.has(p.badgeIdentity)){powerScores.get(p.badgeIdentity).name=p.name;broadcast({type:'power-state',power:publicPowerState()});scheduleSave();}syncPlayerRhythmKing(p);syncPlayerPowerKing(p);syncPlayerMoleKing(p);broadcast({type:'profile',player:p});return json(res,200,{ok:true,player:p})}
      if(url.pathname==='/api/duo'){
        const command=clean(d.command,20),now=Date.now();
        if(command==='invite'){
          const targetId=clean(d.targetId,80),kind=clean(d.kind,20),target=players.get(targetId);
          if(!DUO_LABELS[kind])return json(res,400,{error:'지원하지 않는 상호작용입니다.'});
          if(!target||targetId===id)return json(res,400,{error:'상대를 다시 선택해 주세요.'});
          if(p.tentRoomId||target.tentRoomId)return json(res,409,{error:'텐트 안에 있는 유저와는 바깥에서 상호작용할 수 없어요.'});
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
          if(source&&(p.tentRoomId||source.tentRoomId))return json(res,409,{error:'텐트 안에 들어간 유저와는 상호작용할 수 없어요.'});
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
      if(url.pathname==='/api/move'&&p.tentRoomId)return json(res,200,{ok:true,indoor:true});
      if(url.pathname==='/api/move'){
        // Ignore stale movement packets while server-authoritative paired poses play.
        if(duoFor(id))return json(res,200,{ok:true,paired:true});
        const previousAction=p.action;
        p.x=clamp(d.x,SERVER_X_MIN,SERVER_X_MAX);p.y=clamp(d.y,SERVER_Y_MIN,SERVER_Y_MAX);p.facing=clamp(d.facing,-Math.PI,Math.PI);
        p.pose=['stand','sit','lie'].includes(d.pose)?d.pose:'stand';
        p.glowEnabled=d.glowEnabled===true;
        p.glowColor=['red','pink','blue','lime','yellow','white','rainbow',...(peperoEventActive()?['pepero']:[])].includes(d.glowColor)?d.glowColor:'lime';
        if(d.glowColor==='pepero'&&!peperoEventActive())p.glowEnabled=false;
        p.headbangBpm=Number.isFinite(Number(d.headbangBpm))&&Number(d.headbangBpm)>0?clamp(d.headbangBpm,40,240):120;
        const beatAt=Number(d.headbangBeatAt);
        p.headbangBeatAt=Number.isFinite(beatAt)&&Math.abs(beatAt-Date.now())<86400000?beatAt:Date.now();
        if(d.action==='beatking'&&!playerIsRhythmKing(p))d.action='idle';
        if(d.action==='powerking'&&!playerIsPowerKing(p))d.action='idle';if(d.action==='moleking'&&!playerIsMoleKing(p))d.action='idle';
        // Validate campfire-only reaction server-side so remote spectators cannot see it outside the zone.
        if(d.action==='marshmallow'){
          const kstHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
          const wx=(p.x-600)*.058,wz=(p.y-500)*.058+8;
          if(!((kstHour>=20||kstHour<3)&&Math.hypot(wx-34,wz-10.5)<=8.8))d.action='idle';
        }

        // The fireworks reaction is available only from 01:00 to 04:00 in Korea.
        if(d.action==='nightfirework'){
          const kstHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
          if(kstHour<1||kstHour>=4)d.action='idle';
        }
        p.action=['idle','walk','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','dougie','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','beatking','powerking','moleking','marshmallow','putyourhandsup','nightfirework','heartbow','drum','electricguitar','bassguitar','vocal','mosh-charge','slam-charge','slam-retreat','slam-celebrate','circle-run','train-run','row-paddle','toast-clink','surf-rider','surf-support','shoulder-headbang','rock-skank'].includes(d.action)?d.action:'idle';
        broadcast({type:'move',player:p});
        // Only a movement packet from this player's private session may
        // award coins; publicly visible avatar IDs are not authentication.
        if(playerSessions.get(id)&&playerSessions.get(id)===String(d.sessionKey||''))collectNearbyFieldCoin(p);
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
        const roomId=p.tentRoomId||null;
        const entry={id:crypto.randomUUID(),playerId:p.id,name:p.name,message,at:Date.now(),roomId};
        retainChat(entry);
        for(const [viewerId,stream] of clients){if((players.get(viewerId)?.tentRoomId||null)!==roomId)continue;try{send(stream,{type:'chat',entry})}catch{}}
        return json(res,200,{ok:true});
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
          if(now<rockCooldowns[kind])return json(res,429,{error:(kind==='circle'?'써클핏':kind==='mosh'?'모싱':kind==='row'?'노젓기':kind==='shoulder'?'단체 어깨동무':kind==='toast'?'짠하기':kind==='surf'?'크라우드 서핑':'기차놀이')+' 쿨타임이 남아 있어요.'});
          const x=Number(d.x),y=Number(d.y);
          // Reserve room for a wide loop inside the walkable zone (not the stage or sea).
          if(!Number.isFinite(x)||!Number.isFinite(y)||(kind==='mosh'||kind==='toast'||kind==='surf'||kind==='train'||kind==='shoulder'?(x<90||x>1310||y<280||y>800):(x<235||x>1165||y<370||y>795)))return json(res,400,{error:kind==='mosh'?'페스티벌 바닥을 선택해 주세요.':'넓은 잔디 광장 안쪽의 바닥을 선택해 주세요.'});
          const campfireToast=kind==='toast'&&nearCampfireToast(p);
          const duration=campfireToast?CAMPFIRE_TOAST_DURATION_MS:ROCK_DURATIONS[kind];
          const eventId=crypto.randomUUID();
          const current={id:eventId,kind,x:campfireToast?Math.round(CAMPFIRE_SERVER_X):Math.round(x),y:campfireToast?Math.round(CAMPFIRE_SERVER_Y):Math.round(y),campfireToast,endAt:now+ROCK_COUNTDOWN_MS,initiator:id,participants:new Set([id])};
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
            const launch={type:'rockplay-go',id:current.id,kind:current.kind,x:current.x,y:current.y,startAt:current.endAt,duration,participants,campfireToast:!!current.campfireToast,riderId:current.kind==='surf'?current.initiator:null,leaderId:current.kind==='train'?current.initiator:null,serverNow:Date.now(),
              origins:(current.kind==='surf'||current.kind==='train')?Object.fromEntries(participants.map(pid=>{const actor=players.get(pid);return [pid,{x:actor.x,y:actor.y}]})):undefined};
            if(current.kind==='surf'){
              activeSurfRide={id:launch.id,kind:launch.kind,x:launch.x,y:launch.y,startAt:launch.startAt,duration:launch.duration,participants:[...participants],riderId:launch.riderId,origins:launch.origins};
              setTimeout(()=>{if(activeSurfRide?.id===current.id)activeSurfRide=null},duration+1500).unref();
            }
            broadcast(launch);
            if(current.kind==='toast'){setTimeout(()=>broadcast({type:'toast-spark',eventId:current.id,x:current.x,y:current.y}),current.campfireToast?6000:3000).unref()}
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
          const rawLink=d.url||d.videoId;
          const [title,detectedLive]=await Promise.all([getVideoTitle(vid),youtubeIsLive(vid)]);
          // Manual LIVE option and youtube.com/live/ links work without an API key.
          const entry={id:vid,title,addedBy:p.name,isLive:d.isLive===true||livePathHint(rawLink)||detectedLive===true};
          // Always append to the shared queue; automatically start when nothing is playing.
          queue.push(entry);scheduleSave();if(!music.id)nextTrack();else broadcast({type:'music',...musicState()});
          broadcast({type:'music-booked',name:p.name,title:entry.title,videoId:entry.id,at:Date.now()});
        } else if(d.command==='duration'&&music.id&&Number(d.token)===music.token){
          const duration=Number(d.duration);if(!music.isLive&&Number.isFinite(duration)&&duration>=2&&duration<=86400){music.duration=duration;scheduleSave();if(!music.paused&&(Date.now()-music.startedAt)/1000>duration+1)nextTrack()}
        }
        else if(d.command==='ended'&&music.id&&Number(d.token)===music.token){
          // A viewer may report ending a little early due to clock drift; don't skip prematurely.
          const elapsed=music.paused?music.position:(Date.now()-music.startedAt)/1000;
          if(music.isLive||!music.duration||elapsed>=music.duration-3)nextTrack();
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
      if(url.pathname==='/api/mole'){
        rotateMoleDay();const command=clean(d.command,20);
        if(!p.badgeIdentity||!d.sessionKey||playerSessions.get(id)!==String(d.sessionKey))return json(res,403,{error:'게임 세션 인증이 필요해요.'});
        const a=moleAccount(p.badgeIdentity);
        if(command==='state')return json(res,200,{mole:publicMoleState(),account:moleAccountView(p),best:moleScores.get(p.badgeIdentity)?.score||0});
        if(command==='start'){
          if(p.tentRoomId||Math.hypot(p.x-RHYTHM_BOOTH.x,p.y-RHYTHM_BOOTH.y)>RHYTHM_BOOTH.radius)return json(res,403,{error:'게임부스 가까이에서만 플레이할 수 있어요.'});
          if(a.session){
            if(Date.now()>=a.session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS)await commitMoleResult(p.badgeIdentity,a.session.id);
            else return json(res,409,{error:'이미 진행 중인 두더지왕 게임이 있어요.'});
          }
          if(a.used>=MOLE_DAILY_COINS)return json(res,409,{error:'오늘 두더지왕 코인 5개를 모두 사용했어요.'});
          a.used++;a.session={id:crypto.randomUUID(),name:p.name,startedAt:Date.now(),positions:molePattern(),hits:[],score:0,lastHit:-2};a.lastResult=null;
          await saveNow();scheduleMoleFinish(p.badgeIdentity,a.session);
          return json(res,200,{ok:true,playId:a.session.id,startedAt:a.session.startedAt,serverNow:Date.now(),delay:MOLE_DELAY_MS,interval:MOLE_INTERVAL_MS,intervals:MOLE_INTERVALS_MS,positions:a.session.positions,account:moleAccountView(p)});
        }
        const session=a.session;
        if(command==='finish'&&a.lastResult?.playId===d.playId){
          const result=a.lastResult;return json(res,200,{ok:true,score:result.score,prize:result.prize,points:tentPointBalance(p),best:moleScores.get(p.badgeIdentity)?.score||result.score,account:moleAccountView(p),mole:publicMoleState()});
        }
        if(!session||session.id!==d.playId)return json(res,409,{error:'게임 기록이 만료됐어요.'});
        if(command==='abandon'){
          a.session=null;const timer=moleFinishTimers.get(p.badgeIdentity);if(timer)clearTimeout(timer);moleFinishTimers.delete(p.badgeIdentity);
          await saveNow();return json(res,200,{ok:true});
        }
        if(command==='hit'){
          const index=Number(d.index),hole=Number(d.hole),elapsed=Date.now()-session.startedAt-MOLE_DELAY_MS;
          if(!Number.isInteger(index)||index<0||index>=MOLE_SLOTS||!Number.isInteger(hole)||hole!==session.positions[index])return json(res,400,{error:'잘못된 두더지 위치입니다.'});
          if(elapsed<MOLE_SLOT_STARTS_MS[index]-180||elapsed>MOLE_SLOT_STARTS_MS[index+1]+240)return json(res,409,{error:'두더지가 이미 사라졌어요.'});
          if(session.hits.includes(index))return json(res,409,{error:'이미 맞힌 두더지입니다.'});
          session.hits.push(index);const combo=index===session.lastHit+1?Math.min(10,session.hits.length):1;session.score+=100+combo*10;session.lastHit=index;scheduleSave();
          return json(res,200,{ok:true,score:session.score,combo});
        }
        if(command==='finish'){
          const remaining=session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS-Date.now();
          if(remaining>0)return json(res,409,{error:'아직 게임이 진행 중이에요.',retryAfterMs:Math.min(2000,remaining+80)});
          const result=await commitMoleResult(p.badgeIdentity,d.playId);
          if(!result)return json(res,409,{error:'게임 결과를 아직 저장할 수 없어요.'});
          return json(res,200,{ok:true,score:result.score,prize:result.prize,points:tentPointBalance(p),best:moleScores.get(p.badgeIdentity)?.score||result.score,account:moleAccountView(p),mole:publicMoleState()});
        }
        return json(res,400,{error:'알 수 없는 두더지왕 명령입니다.'});
      }
      if(url.pathname==='/api/power'){
        rotatePowerDay();const command=clean(d.command,20);
        if(!p.badgeIdentity)return json(res,400,{error:'브라우저 저장소를 허용해야 게임 코인을 사용할 수 있어요.'});
        if(!d.sessionKey||playerSessions.get(id)!==String(d.sessionKey))return json(res,403,{error:'세션 인증이 필요합니다.'});
        const account=powerAccount(p.badgeIdentity);
        if(command==='state')return json(res,200,{power:publicPowerState(),account:powerAccountView(p),best:powerScores.get(p.badgeIdentity)?.score||0});
        if(command==='start'){
          if(p.tentRoomId||Math.hypot((p.x||0)-POWER_BOOTH.x,(p.y||0)-POWER_BOOTH.y)>POWER_BOOTH.radius)return json(res,403,{error:'게임부스 가까이에서만 플레이할 수 있어요.'});
          if(account.used>=POWER_DAILY_COINS)return json(res,409,{error:'오늘 파워왕 코인을 모두 사용했어요. 한국시간 자정에 5개 충전됩니다.',account:powerAccountView(p)});
          account.used++;
          account.session={id:crypto.randomUUID(),startedAt:Date.now()};
          await saveNow();
          return json(res,200,{ok:true,playId:account.session.id,startedAt:account.session.startedAt,serverNow:Date.now(),countdown:POWER_COUNTDOWN_MS,activeUntil:POWER_ACTIVE_MS,account:powerAccountView(p)});
        }
        if(command==='strike'){
          const session=account.session;
          if(!session||session.id!==d.playId)return json(res,409,{error:'유효한 플레이가 아닙니다.'});
          const elapsed=Date.now()-session.startedAt;
          // The client sends the gauge position's timestamp at the actual tap, not after HTTP latency.
          // Never accept a score from the client; verify the reported tap time is close to server time.
          const reportedElapsed=Number(d.strikeElapsed);
          const validTap=Number.isFinite(reportedElapsed)&&reportedElapsed>=0&&
            reportedElapsed<=POWER_ACTIVE_MS+400&&
            reportedElapsed>=elapsed-POWER_MAX_STRIKE_LAG_MS&&
            reportedElapsed<=elapsed+POWER_CLOCK_SKEW_MS;
          const scoreElapsed=validTap?reportedElapsed:elapsed;
          const score=powerScore(scoreElapsed),prize=powerPrize(score);
          account.session=null;account.bonus+=prize;
          const best=powerScores.get(p.badgeIdentity);
          if(!best||score>best.score)powerScores.set(p.badgeIdentity,{name:p.name,score,at:Date.now()});
          await saveNow();broadcast({type:'power-state',power:publicPowerState()});
          return json(res,200,{ok:true,score,prize,position:powerGauge(scoreElapsed),points:tentPointBalance(p),best:powerScores.get(p.badgeIdentity)?.score||score,account:powerAccountView(p),power:publicPowerState()});
        }
        return json(res,400,{error:'지원하지 않는 파워왕 명령입니다.'});
      }
      if(url.pathname==='/api/rhythm'){
        maybeRotateRhythmDay();
        const command=clean(d.command,20);
        if(!p.badgeIdentity)return json(res,400,{error:'브라우저 저장소를 허용해야 게임 코인을 사용할 수 있어요.'});
        // Rhythm scores award spendable points; require the same private session key as tent purchases.
        const sessionKey=String(d.sessionKey||'');
        if(!sessionKey||playerSessions.get(id)!==sessionKey)return json(res,403,{error:'세션 인증이 필요합니다. 새로고침 후 다시 시도해 주세요.'});
        const account=rhythmAccount(p.badgeIdentity);
        if(command==='state')return json(res,200,{rhythm:publicRhythmState(),account:rhythmAccountView(p),best:rhythmScores.get(p.badgeIdentity)?.score||0});
        if(command==='start'){
          if(Math.hypot((p.x||0)-RHYTHM_BOOTH.x,(p.y||0)-RHYTHM_BOOTH.y)>RHYTHM_BOOTH.radius)return json(res,403,{error:'게임부스 근처에서만 플레이할 수 있어요.'});
          if(account.used>=RHYTHM_DAILY_COINS)return json(res,409,{error:'오늘 게임 코인 5개를 모두 사용했어요. 내일 0시(KST)에 충전됩니다.',account:rhythmAccountView(p)});
          account.used++;
          account.session={id:crypto.randomUUID(),startedAt:Date.now()};
          await saveNow();
          return json(res,200,{ok:true,playId:account.session.id,account:rhythmAccountView(p)});
        }
        if(command==='submit'){
          const session=account.session;
          if(!session||session.id!==d.playId)return json(res,409,{error:'유효한 게임 기록이 아닙니다. 게임 시작부터 다시 진행해 주세요.'});
          const elapsed=Date.now()-session.startedAt;
          if(elapsed<35000||elapsed>600000)return json(res,409,{error:'게임 플레이 시간이 올바르지 않아 점수와 포인트를 지급하지 않았어요.'});
          const raw=Number(d.score);
          if(!Number.isFinite(raw)||raw<0||raw>200000)return json(res,400,{error:'점수 범위가 올바르지 않습니다.'});
          const score=Math.floor(raw),prize=rhythmPrize(score);
          account.session=null; // consume before awaiting storage to prevent replay awards
          account.bonus+=prize;
          const previous=rhythmScores.get(p.badgeIdentity);
          if(!previous||score>previous.score)rhythmScores.set(p.badgeIdentity,{name:p.name,score,updatedAt:Date.now()});
          await saveNow();broadcastRhythmState();
          return json(res,200,{ok:true,prize,points:tentPointBalance(p),best:rhythmScores.get(p.badgeIdentity)?.score||score,account:rhythmAccountView(p),rhythm:publicRhythmState()});
        }
        return json(res,400,{error:'지원하지 않는 박자게임 명령입니다.'});
      }
      if(url.pathname==='/api/leave'){
        // A late pagehide beacon from a previous page must not kick the newer page.
        const owner=pageOwners.get(id);
        if(owner&&d.pageId!==owner)return json(res,200,{ok:true,ignored:'stale-page'});
        settleBadge(p);clearDuosFor(id);players.delete(id);forgetSession(id);voterLeaves(id);
        if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();
        clients.get(id)?.end();clients.delete(id);broadcast({type:'leave',id,count:players.size});sendTentUpdate();return json(res,200,{ok:true})
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
