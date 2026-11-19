'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {PetRaceEngine}=require('./pet-race-engine');
const petRace=new PetRaceEngine(),petRacePoints=new Map();let petRaceBusy=false,petRaceDirty=false;
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
// v310: One editable JSON calendar for all birthday reactions; server validates
// the date independently of the browser so expired actions cannot be replayed.
let birthdayCalendar={events:[]};
try{birthdayCalendar=JSON.parse(fs.readFileSync(path.join(PUBLIC,'assets/events/birthday.json'),'utf8'));}catch(error){console.warn('Birthday calendar unavailable:',error.message);}
function birthdayActive(now=Date.now()){
 return (Array.isArray(birthdayCalendar.events)?birthdayCalendar.events:[]).some(e=>{
  const start=Date.parse(e.start),end=Date.parse(e.end);
  return Number.isFinite(start)&&Number.isFinite(end)&&now>=start&&now<end;
 });
}

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
// Rare catches are server-authored notices shared with every occupied chat room.
function announceRareFind(player,item){
 if(!player||!item||!['epic','legendary'].includes(item.rarity))return;
 const text=String(item.name||'').trim();if(!text)return;
 const last=text.charCodeAt(text.length-1),particle=last>=0xac00&&last<=0xd7a3&&(last-0xac00)%28?'을':'를';
 const base={id:crypto.randomUUID(),name:player.name,message:player.name+'님이 '+text+particle+' 획득하셨습니다',at:Date.now(),noticeRarity:item.rarity};
 const rooms=new Map([[null,[]]]);
 for(const [viewerId,stream] of clients){const viewer=players.get(viewerId);if(!viewer)continue;const room=viewer.tentRoomId||null;if(!rooms.has(room))rooms.set(room,[]);rooms.get(room).push(stream);}
 for(const [roomId,streams] of rooms){const entry={...base,roomId};retainChat(entry);for(const stream of streams)try{send(stream,{type:'chat',entry})}catch{}}
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
const FIELD_COIN_PICKUP_RADIUS=1.65, PET_COIN_PICKUP_RADIUS=5;
function activePetCoinLevel(p){
 const pet=p?.badgeIdentity?petStats.get(p.badgeIdentity)?.pet:null;
 return pet?.summoned&&Date.now()>=pet.hatchAt?petLevel(pet.xp):0;
}
// Coins are removed before awarding, so concurrent pickups cannot pay twice.
function awardFieldCoin(p,coin,automaticPet=false){
 if(!coin||!fieldCoins.has(coin.id))return null;
 fieldCoins.delete(coin.id);
 const base=coin.value,bonus=activePetCoinLevel(p)>=10?Math.floor(base*.2):0,value=base+bonus;
 fieldCoinBonuses.set(p.badgeIdentity,(fieldCoinBonuses.get(p.badgeIdentity)||0)+value);
 broadcast({type:'field-coins',coins:fieldCoinPublic()});
 broadcast({type:'field-coin-collected',playerId:p.id,value,base,bonus,petPickup:automaticPet});
 scheduleSave();return {value,base,bonus};
}
function collectNearbyFieldCoin(p){
 if(!p||!p.badgeIdentity||p.tentRoomId||!fieldCoins.size)return false;
 const petLevel=activePetCoinLevel(p),radius=petLevel>=25?PET_COIN_PICKUP_RADIUS:FIELD_COIN_PICKUP_RADIUS;
 for(const coin of fieldCoins.values()){
  const distance=Math.hypot((p.x-coin.x)*.058,(p.y-coin.y)*.058);
  if(distance>radius)continue;
  return !!awardFieldCoin(p,coin,petLevel>=25&&distance>FIELD_COIN_PICKUP_RADIUS);
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
let powerDay=kstDate(),pizzaGameMigration=false;
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
 if(winner)awardDailyWinner(winner.identity);powerReward=winner?{date:day,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:powerDay}:null;
 powerDay=day;powerScores.clear();
 for(const person of players.values())if(syncPlayerPowerKing(person))broadcast({type:'profile',player:person});
 scheduleSave();broadcast({type:'power-state',power:publicPowerState()});
}
function publicPowerState(){rotatePowerDay();return {day:powerDay,leaderboard:powerRows().map(({rank,identity,at,...r},i)=>({rank:i+1,...r})),reward:powerReward&&powerReward.date===kstDate()?{title:'피자왕',name:powerReward.name,score:powerReward.score,sourceDate:powerReward.sourceDate,date:powerReward.date}:null,booth:POWER_BOOTH};}

function rhythmAccountView(p){const row=rhythmAccount(p.badgeIdentity);return {coins:Math.max(0,RHYTHM_DAILY_COINS-row.used),used:row.used,limit:RHYTHM_DAILY_COINS,bonus:row.bonus,day:row.day}}

let rhythmReward=null;
function rhythmRows(){return [...rhythmScores.entries()].map(([identity,row])=>({identity,name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(row.score)||0)),updatedAt:Number(row.updatedAt)||0})).sort((a,b)=>b.score-a.score||a.updatedAt-b.updatedAt||a.name.localeCompare(b.name,'ko-KR')).slice(0,100)}
function playerIsRhythmKing(p){return Boolean(p&&p.badgeIdentity&&rhythmReward&&rhythmReward.date===kstDate()&&rhythmReward.identity===p.badgeIdentity)}
function syncPlayerRhythmKing(p){if(!p)return false;const on=playerIsRhythmKing(p);if(Boolean(p.rhythmKing)===on)return false;p.rhythmKing=on;if(!on&&p.action==='beatking')p.action='idle';return true}
function publicRhythmState(){maybeRotateRhythmDay();const rows=rhythmRows();return {date:rhythmDay,leaderboard:rows.slice(0,5).map((row,i)=>({rank:i+1,name:row.name,score:row.score})),reward:rhythmReward&&rhythmReward.date===kstDate()?{title:'박자왕',name:rhythmReward.name,score:rhythmReward.score,sourceDate:rhythmReward.sourceDate,date:rhythmReward.date}:null,booth:RHYTHM_BOOTH};}
function broadcastRhythmState(){broadcast({type:'rhythm-state',rhythm:publicRhythmState()})}
function maybeRotateRhythmDay(){const today=kstDate();if(rhythmDay===today)return false;const rows=rhythmRows();const winner=rhythmDay===previousKstDate(today)?rows[0]:null;if(winner)awardDailyWinner(winner.identity);rhythmReward=winner?{date:today,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:rhythmDay}:null;rhythmDay=today;rhythmScores.clear();let changed=false;for(const person of players.values())if(syncPlayerRhythmKing(person)){broadcast({type:'profile',player:person});changed=true;}scheduleSave();broadcastRhythmState();return changed;}
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
function rotateMoleDay(){const day=kstDate();if(day===moleDay)return;const winner=moleDay===previousKstDate(day)?moleRows()[0]:null;if(winner)awardDailyWinner(winner.identity);moleReward=winner?{date:day,identity:winner.identity,name:winner.name,score:winner.score,sourceDate:moleDay}:null;moleDay=day;moleScores.clear();for(const p of players.values())if(syncPlayerMoleKing(p))broadcast({type:'profile',player:p});scheduleSave();broadcast({type:'mole-state',mole:publicMoleState()});}
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
 for(const player of players.values())if(player.badgeIdentity===identity){const client=clients.get(player.id);if(client)try{send(client,{type:'mole-result',playId,score,prize,points:tentPointBalance(player)})}catch{}}
 return result;
}
function scheduleMoleFinish(identity,session){
 const previous=moleFinishTimers.get(identity);if(previous)clearTimeout(previous);
 const delay=Math.max(100,session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS+18000-Date.now());
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
const PET_ADOPTION_COST=1000, PET_HATCH_MS=4*60*60*1000, PET_MAX_LEVEL=200;
const PET_FOODS={snack:{cost:30,xp:15,name:'간식'},meal:{cost:100,xp:60,name:'식사'},feast:{cost:250,xp:170,name:'특식'}};
const PET_COLORS=['#f16b69','#67b9f2','#75d8a0','#b68ae8','#f4eee0'];
const PET_COLOR_CHANGE_COST=1000;
const PET_COLOR_NAMES={'#f16b69':'red','#67b9f2':'blue','#75d8a0':'green','#b68ae8':'purple','#f4eee0':'white'};
function petColorAvailable(species,color){const name=PET_COLOR_NAMES[color];return PET_SPECIES.includes(species)&&!!name&&[1,10,25].every(stage=>fs.existsSync(path.join(PUBLIC,'assets','pets',species,`${species}_lv${stage}_${name}.png`)));}
const PET_SPECIES=['fox','turtle','cat','rabbit','elephant','wolf']; // Equal odds; existing pet species and saved records are preserved.
// Only a SHA-256 digest of the high-entropy recovery code is persisted.
const recoveryRecords=new Map(),recoveryIndex=new Map(),recoveryAttempts=new Map();
const adminPointCredits=new Map(),adminPointLedger=new Map();let oneTimeCreditApplied=false;
function awardDailyWinner(identity){if(identity)adminPointCredits.set(identity,(adminPointCredits.get(identity)||0)+3000);}
const ONE_TIME_CREDIT_HASH='07cad1e4323da66ca647d215a5b63b5ea02519ad6bb88c3e35b7f9130bd50fd1',ONE_TIME_CREDIT_ID='one-time-20261113-8700';
const recoveryHash=code=>crypto.createHash('sha256').update(code).digest('hex');
function recoveryProfile(p){return {name:p.name,color:p.color,gender:p.gender,pattern:p.pattern,sash:p.sash,hairStyle:p.hairStyle,hairColor:p.hairColor};}
function setRecoveryProfile(p){const r=p?.badgeIdentity&&recoveryRecords.get(p.badgeIdentity);if(r){r.profile=recoveryProfile(p);scheduleSave();}}
const TRAIL_TEST_FREE=false;
const DECORATIONS={bubble:{heart:{name:'하트 말풍선',cost:3000},star:{name:'별 말풍선',cost:3000},neon:{name:'네온 말풍선',cost:2000},music:{name:'음표 말풍선',cost:3000}},trail:{rainbow:{name:'무지개 잔상',cost:3000},star:{name:'별 잔상',cost:3000},snow:{name:'눈꽃 잔상',cost:3000},petal:{name:'꽃잎 잔상',cost:3000},flame:{name:'불꽃 잔상',cost:3000},dark:{name:'어둠 잔상',cost:3000},heart:{name:'하트 잔상',cost:3000}}};
const decorationStats=new Map();
function decorationRecord(identity){if(!decorationStats.has(identity))decorationStats.set(identity,{spent:0,owned:{bubble:{},trail:{}},equipped:{bubble:null,trail:null}});return decorationStats.get(identity)}
function decorationAppearance(identity){const r=identity&&decorationStats.get(identity);return {bubble:r?.equipped?.bubble||null,trail:r?.equipped?.trail||null};}
function syncDecoration(p){p.cosmetics=decorationAppearance(p.badgeIdentity)}
function decorationView(p){const r=decorationRecord(p.badgeIdentity);return {catalog:DECORATIONS,owned:r.owned,equipped:r.equipped,testing:{trail:TRAIL_TEST_FREE},points:tentPointBalance(p)};}

const PET_EFFECTS={sparkle:{name:'반짝이',cost:500},notes:{name:'춤출 때 음표',cost:1000},heart:{name:'하트',cost:1000},rainbow:{name:'무지개',cost:2000},light:{name:'라이트',cost:3000},petals:{name:'꽃잎',cost:1500},snow:{name:'눈꽃',cost:1500},electric:{name:'전기',cost:2500},moonstars:{name:'달과 별',cost:2500},disco:{name:'디스코볼',cost:3000}};
function petEffectView(record){const owned={},enabled={};for(const id of Object.keys(PET_EFFECTS)){owned[id]=record?.effectsOwned?.[id]===true;enabled[id]=owned[id]&&record?.effectsEnabled?.[id]===true;}return {owned,enabled};}
const petStats=new Map();
let petHatchDurationMigrated=false;
function petLevel(xp){
 let level=1;while(level<PET_MAX_LEVEL&&xp>=40*level+8*level*(level+1))level++;
 return level;
}
function petCombatPower(level){return Math.max(0,Math.floor(level))*12;}
function petEquippedCombatPower(id,level){const r=craftAccounts.get(id),tier=r?.equippedSkill,index=CRAFT_TIERS.indexOf(tier);const bonus=index<0?0:(index+1)*60+(r.skills[tier]||0)*12;return petCombatPower(level)+Math.round(bonus*(r?.awakened?.skill===tier?1.2:1));}
function characterCombatPower(id){const level=questLevel(questAccounts.get(id)?.xp||0),r=craftAccounts.get(id),tier=r?.equippedWeapon,index=CRAFT_TIERS.indexOf(tier);const bonus=index<0?0:(index+1)*60+(r.weapons[tier]||0)*12;return level*15+Math.round(bonus*(r?.awakened?.weapon===tier?1.2:1));}
function petPublic(pet,record,identity){
 if(!pet)return null;
 const level=petLevel(pet.xp),hatched=Date.now()>=pet.hatchAt;
 return {species:hatched?(PET_SPECIES.includes(pet.species)?pet.species:'fox'):null,color:pet.color,adoptedAt:pet.adoptedAt,hatchAt:pet.hatchAt,
  hatched,level:hatched?level:0,combatPower:hatched?petEquippedCombatPower(identity,level):0,xp:pet.xp,nextXp:level<PET_MAX_LEVEL?40*level+8*level*(level+1):null,
  stage:hatched?(level>=25?25:level>=10?10:1):0,summoned:!!pet.summoned,effects:petEffectView(record).enabled};
}
function petAccount(identity){if(!petStats.has(identity))petStats.set(identity,{spent:0,pet:null,effectsOwned:{},effectsEnabled:{}});return petStats.get(identity);}
function petView(p){const record=petAccount(p.badgeIdentity);return {pet:petPublic(record.pet,record,p.badgeIdentity),effects:petEffectView(record),effectCatalog:PET_EFFECTS,colorChangeCost:PET_COLOR_CHANGE_COST,colorOptions:record.pet&&Date.now()>=record.pet.hatchAt?PET_COLORS.map(color=>({color,available:petColorAvailable(record.pet.species,color)})):[],points:tentPointBalance(p),cost:PET_ADOPTION_COST,hatchMs:PET_HATCH_MS,foods:PET_FOODS,availableSpecies:PET_SPECIES,maxLevel:PET_MAX_LEVEL};}
function syncPetPlayers(identity){
 const record=petStats.get(identity);for(const other of players.values())if(other.badgeIdentity===identity){other.pet=petPublic(record?.pet,record,identity);broadcast({type:'pet-update',id:other.id,pet:other.pet});}
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
const LOTTERY_PRICE=100,LOTTERY_DAILY_LIMIT=10;
const LOTTERY_BOOTH={x:38,z:-7.2,radius:9.5};
const LOTTERY_PRIZES=[
 {tier:'miss',chance:3000,prize:0,symbols:['star','coin','diamond']},
 {tier:'small',chance:2500,prize:50,symbols:['coin','coin','coin']},
 {tier:'normal',chance:2500,prize:100,symbols:['star','star','star']},
 {tier:'high',chance:1500,prize:300,symbols:['diamond','diamond','diamond']},
 {tier:'ultra',chance:400,prize:1000,symbols:['gem','gem','gem']},
 {tier:'jackpot',chance:100,prize:5000,symbols:['crown','crown','crown']}
]; // 10,000 tickets: 30/25/25/15/4/1 percent. Total = 10,000.
const FORTUNE_CARDS=[
 ['별의 속삭임','작은 가능성이 반짝이는 날','은빛'],['태양의 무대','자신 있게 빛나는 날','황금빛'],['달의 정원','마음의 소리를 듣는 날','보랏빛'],['행운의 열쇠','새로운 문을 여는 날','민트빛'],
 ['바람의 편지','기다리던 소식이 다가오는 날','하늘빛'],['꽃의 축제','소소한 기쁨이 피어나는 날','분홍빛'],['파도의 리듬','흐름에 몸을 맡기기 좋은 날','푸른빛'],['불꽃의 용기','망설임을 넘어설 힘이 생기는 날','붉은빛'],
 ['구름 위 여행','시야를 넓혀볼 수 있는 날','하얀빛'],['무지개 다리','다른 마음이 이어지는 날','무지갯빛'],['시간의 모래','천천히 쌓은 것이 빛나는 날','모래빛'],['반짝이는 동전','가치를 발견하기 좋은 날','초록빛'],
 ['음악의 요정','일상에 리듬이 생기는 날','남색'],['숲의 수호자','잠시 쉬어가도 괜찮은 날','연두빛'],['운명의 나침반','나만의 방향을 찾는 날','청록빛'],['별빛 친구','인연의 온기가 찾아오는 날','라벤더빛']
];
const FORTUNE_MESSAGES=[
 ['작은 아이디어를 흘려보내지 마세요. 오늘 적어 둔 메모가 다음 기회의 실마리가 될 수 있어요.','오래 고민하던 일에서 예상하지 못한 단서를 발견할 수 있어요.','주변의 반짝이는 장점을 찾아 칭찬해 보세요. 좋은 기운이 서로에게 전해집니다.','결과를 서두르기보다 지금 할 수 있는 한 걸음에 집중해 보세요.'],
 ['사람들 앞에서 당신의 생각을 자신 있게 이야기해 보세요.','밝은 인사 하나가 어색했던 분위기를 바꿀 수 있어요.','하고 싶었던 일을 미루지 말고 가볍게 시작해 보세요.','기분 좋은 에너지가 넘치는 날이에요. 좋아하는 음악과 함께 하루를 열어보세요.'],
 ['잠들기 전 마음속 생각을 정리해 보세요. 복잡했던 마음이 한결 편해질 거예요.','감정이 앞설 때에는 잠시 쉬었다가 대답해도 괜찮아요.','조용한 시간 속에서 자신이 정말 원하는 것을 발견할 수 있어요.','누군가의 말보다 내 마음의 속도에 귀를 기울여 보세요.'],
 ['새로운 일을 시작하기에 좋은 날이에요. 작은 시도부터 문을 열어보세요.','막혀 있다고 느꼈던 문제에 다른 접근법을 시도해 보세요.','한 번쯤 가보고 싶었던 장소나 새로운 취미를 찾아보세요.','망설이던 연락을 보내면 반가운 대화가 시작될 수 있어요.'],
 ['기다리던 대답이 늦어져도 너무 조급해하지 마세요.','오랜만에 생각난 사람에게 안부를 물어보는 건 어떨까요?','우연히 듣게 된 이야기에서 새로운 아이디어를 얻을 수 있어요.','지나가는 말 속에서도 따뜻한 진심을 발견할 수 있는 날이에요.'],
 ['평범한 순간에서 기쁨을 찾아보세요. 좋아하는 간식도 좋은 시작이에요.','주변을 조금 꾸미면 기분까지 화사해질 수 있어요.','당신을 웃게 하는 사람과 짧게라도 시간을 나눠보세요.','오늘 자신에게 작은 칭찬을 선물해 주세요. 충분히 잘하고 있어요.'],
 ['계획이 조금 달라져도 괜찮아요. 새로운 흐름 속에서 즐거움을 찾아보세요.','바쁜 일정 사이에 잠깐 숨을 고르면 다시 나아갈 힘이 생겨요.','모든 일을 혼자 해결하려 하지 말고 편하게 도움을 청해 보세요.','반복되는 일에 작은 변화를 주면 새로운 리듬이 생길 거예요.'],
 ['두려움 때문에 미뤘던 일에 조금씩 다가가 보세요.','완벽하지 않아도 괜찮아요. 첫 시도가 다음 용기를 만들어 줍니다.','당신의 의견이 필요할 때 솔직하고 부드럽게 표현해 보세요.','작은 도전 하나가 오늘을 기억에 남게 만들 수 있어요.'],
 ['익숙한 길 대신 새로운 길을 걸으며 주변을 살펴보세요.','다른 사람의 관점을 들어보면 답이 더 넓어질 수 있어요.','가보고 싶은 곳을 기록하며 다음 여행을 상상해 보세요.','멀리 바라보되 오늘 해야 할 일은 하나씩 차분히 해보세요.'],
 ['서로 다른 의견 사이에 공통점을 찾아보세요. 대화가 한결 부드러워질 거예요.','누군가와 함께하면 혼자서는 떠올리지 못한 즐거움을 찾을 수 있어요.','고마웠던 마음을 전하면 관계에 따뜻한 색이 더해집니다.','새로운 만남에서 상대의 이야기를 천천히 들어보세요.'],
 ['당장 결과가 보이지 않아도 쌓아온 노력은 사라지지 않아요.','미뤄 둔 일을 짧은 시간만 정해 시작해 보세요.','지난 시간의 경험을 돌아보면 지금 필요한 답이 보일 수 있어요.','급하게 결정하기보다 충분히 살펴볼 시간을 가져보세요.'],
 ['사고 싶은 것이 있다면 필요한 이유를 한 번 더 생각해 보세요.','이미 가지고 있던 물건에서 새로운 쓸모를 발견할 수 있어요.','작은 절약이나 정리가 기분 좋은 여유로 이어질 수 있어요.','가치 있는 것은 숫자뿐 아니라 함께 보낸 시간일 수도 있어요.'],
 ['좋아하는 노래 한 곡이 오늘의 분위기를 바꿔줄 거예요.','일할 때와 쉴 때의 리듬을 나누면 집중하기 한결 편해집니다.','새로운 음악을 들어보며 낯선 취향을 발견해 보세요.','친구에게 오늘 어울리는 노래를 추천해 보는 건 어떨까요?'],
 ['잠깐의 휴식은 게으름이 아니라 다시 움직이기 위한 준비예요.','주변을 정리하고 편안한 자리에서 깊게 숨을 쉬어보세요.','자연을 바라보거나 가볍게 걸으며 머리를 식혀보세요.','힘든 일을 혼자 품기보다 믿을 만한 사람과 나눠보세요.'],
 ['다른 사람의 속도와 비교하지 말고 내 방향을 살펴보세요.','여러 선택지 중 지금 가장 마음이 가는 것을 적어보세요.','작은 목표를 정하고 끝냈을 때의 기쁨을 느껴보세요.','방향을 바꾸는 것도 앞으로 나아가는 한 가지 방법이에요.'],
 ['반가운 사람과 함께 웃을 일이 생길 수 있어요.','먼저 손을 내밀면 뜻밖의 공통점을 발견할 수 있어요.','오래 알고 지낸 사람에게 고마운 마음을 전해 보세요.','누군가의 작은 배려를 알아봐 주면 서로의 하루가 따뜻해집니다.']
];
// v335: Additional distinct readings appended to preserve saved card/message indices.
const FORTUNE_EXTRA_MESSAGES=[
 ['작게 시작한 취미가 예상 밖의 즐거움을 선물할 수 있어요.','사소해 보이는 질문을 던져보세요. 새로운 발견이 기다릴지도 몰라요.','오늘 마주친 좋은 장면을 사진이나 글로 남겨보세요.','마음에 떠오른 계획을 믿을 만한 사람에게 이야기해 보세요.','멀리 있는 목표보다 바로 앞의 기회에 눈을 돌려보세요.','지금까지 배운 것 중 하나를 활용할 순간이 찾아올 수 있어요.'],
 ['어깨를 펴고 당신이 해낸 일을 떠올려 보세요.','밝은 색의 소품 하나가 하루에 생기를 더해줄 수 있어요.','즐거운 제안이 들어오면 부담 없는 범위에서 함께해 보세요.','자신의 장점을 숨기지 않아도 괜찮아요.','오늘 마무리할 수 있는 일을 하나 골라 기분 좋게 끝내보세요.','다른 사람의 성공을 축하하는 마음이 좋은 분위기를 만듭니다.'],
 ['오늘의 감정을 판단하지 말고 있는 그대로 적어보세요.','혼자만의 시간이 필요하다면 편안하게 양해를 구해도 좋아요.','마음에 걸리는 일은 내일의 나에게 잠시 맡겨보세요.','충분한 휴식을 취하면 생각이 조금 더 선명해질 수 있어요.','상대의 표정뿐 아니라 자신의 기분도 함께 살펴보세요.','좋아하는 향이나 따뜻한 음료로 조용한 시간을 만들어보세요.'],
 ['새롭게 배워보고 싶은 것을 하나 찾아보세요.','늘 쓰던 방법이 막힌다면 순서를 바꾸어 시도해 보세요.','두려움보다 호기심이 조금 더 큰 선택을 해보세요.','작은 준비가 새로운 기회를 만났을 때 도움이 될 거예요.','질문을 주저하지 마세요. 답은 생각보다 가까이 있을 수 있어요.','기다리던 제안이 없다면 직접 가벼운 제안을 건네보세요.'],
 ['오래된 대화 속에서 미처 발견하지 못한 마음을 떠올려 보세요.','답장이 늦더라도 상대에게도 각자의 시간이 있음을 기억해 주세요.','마음에 남은 고마움을 짧은 메시지로 전해보세요.','평소에 잘 듣지 못했던 이야기에 귀를 기울여 보세요.','기쁜 소식이 있다면 아끼는 사람과 나눠보세요.','말하기 전에 한 번 숨을 고르면 마음이 더 잘 전해질 거예요.'],
 ['좋아하는 꽃이나 풍경을 보며 잠시 쉬어가세요.','작은 선물보다 진심 어린 말이 더 크게 다가갈 수 있어요.','오늘의 즐거웠던 순간 세 가지를 떠올려 보세요.','주변 사람의 좋은 소식을 함께 기뻐해 주세요.','익숙한 일상에 좋아하는 색을 살짝 더해보세요.','스스로에게 기대를 조금 낮추면 편안함이 찾아올 수 있어요.'],
 ['계획을 바꿔야 한다면 가장 중요한 것부터 다시 골라보세요.','일이 예상대로 흘러가지 않아도 다른 방법이 남아 있어요.','지금 내 힘으로 바꿀 수 있는 일에 집중해 보세요.','마음이 복잡할 때에는 산책하며 생각을 흘려보내세요.','작은 실수 하나가 하루 전체를 결정하지는 않아요.','할 일을 잠시 내려놓고 몸과 마음의 흐름을 살펴보세요.'],
 ['용기가 필요한 순간에는 아주 작은 행동부터 시작해 보세요.','모르는 것을 인정하는 것도 멋진 용기예요.','실패가 두려워도 결과보다 경험을 얻는 데 의미를 두어보세요.','필요한 부탁을 분명하면서도 다정하게 표현해 보세요.','새로운 시도 앞에서 지난번에 해낸 일을 떠올려 보세요.','오늘 한 가지 망설임을 내려놓으면 마음이 한결 가벼워질 거예요.'],
 ['낯선 분야의 이야기를 접하면 새로운 관심사가 생길 수 있어요.','한 번도 가보지 않은 동네를 지도에서 찾아보세요.','지금 있는 자리에서도 새로운 시선으로 주변을 볼 수 있어요.','계획하지 않은 여유 시간에 흥미로운 발견이 있을 수 있어요.','평소와 다른 장르의 영화나 책을 골라보세요.','새로운 곳에 가기 전 작은 준비를 하면 마음이 든든해져요.'],
 ['의견이 다를 때는 무엇이 중요한지 먼저 물어보세요.','사소한 오해가 있다면 차분한 대화로 풀어볼 수 있어요.','함께 웃었던 추억을 나누면 사이가 한층 가까워질 거예요.','다른 사람을 이해하려는 노력만으로도 충분히 의미가 있어요.','상대에게 바라는 것을 짐작하게 하기보다 직접 알려주세요.','오늘 받은 친절을 또 다른 누군가에게 전해보세요.'],
 ['오늘 조금 해둔 일이 내일의 부담을 줄여줄 거예요.','기다리는 동안 나를 돌보는 시간도 소중히 여겨주세요.','오래 붙잡고 있던 일은 잠시 멈춘 뒤 다시 살펴보세요.','작은 반복이 어느새 익숙함과 자신감으로 이어집니다.','완료한 일을 기록하면 쌓인 노력의 크기를 알 수 있어요.','기회가 늦게 찾아오더라도 준비한 시간은 헛되지 않아요.'],
 ['지출하기 전에 하루만 생각해 보는 여유를 가져보세요.','돈을 쓰지 않고 즐길 수 있는 취미를 발견해 보세요.','작은 금액이라도 나의 목표를 위해 따로 모아보세요.','누군가에게 받은 도움의 가치를 따뜻하게 기억해 주세요.','가지고 있는 것을 살펴보면 잊고 있던 보물을 만날 수 있어요.','오늘의 선택이 내게 정말 필요한 것인지 차분하게 생각해 보세요.'],
 ['기분에 어울리는 플레이리스트를 새로 만들어보세요.','지금의 감정을 한 곡의 제목으로 표현해 보는 것도 재미있어요.','조용한 시간과 신나는 시간을 적절히 섞어보세요.','친구가 추천한 곡을 열린 마음으로 들어보세요.','잠깐 몸을 움직이며 쌓인 긴장을 풀어보세요.','처음 좋아했던 노래를 다시 들으면 반가운 기억이 떠오를 수 있어요.'],
 ['오늘은 충분히 쉬었다고 느낄 때까지 마음을 다독여 주세요.','물을 한 잔 마시고 천천히 호흡을 가다듬어 보세요.','모든 요청을 받아들이지 않아도 괜찮아요. 내 여유를 살펴보세요.','작은 공간이라도 편안하게 정돈하면 마음이 쉬어갈 자리가 생겨요.','나에게 친절한 말을 건네는 것으로 하루를 시작해 보세요.','무리해서 답을 찾기보다 잠시 기다리는 편이 좋을 수 있어요.'],
 ['목표가 너무 크게 느껴진다면 오늘 할 수 있는 만큼 나누어 보세요.','남들이 정한 기준보다 내게 중요한 가치를 먼저 생각해 보세요.','지금의 선택이 마음에 들지 않으면 다시 조정해도 괜찮아요.','계획을 세울 때 쉬는 시간도 함께 넣어보세요.','관심이 가는 방향을 기록하면 나만의 지도가 만들어져요.','모든 길을 한꺼번에 갈 필요는 없어요. 하나씩 살펴보세요.'],
 ['오랜 친구에게 가벼운 안부를 건네면 반가운 대화가 이어질 수 있어요.','누군가에게 좋은 친구가 되어준 순간을 떠올려 보세요.','함께하고 싶은 일이 있다면 부담 없이 제안해 보세요.','말없이 곁에 있어 주는 것만으로도 마음이 전해질 수 있어요.','서로 다른 취향을 존중하면 만남이 더 즐거워집니다.','오늘은 상대의 이야기를 끝까지 듣는 데 집중해 보세요.']
];
FORTUNE_EXTRA_MESSAGES.forEach((messages,index)=>FORTUNE_MESSAGES[index].push(...messages));

const fortuneStats=new Map();
function fortuneView(identity){
 const entry=fortuneStats.get(identity),today=kstDate();
 if(!entry||entry.day!==today)return {day:today,result:null};
 const card=FORTUNE_CARDS[entry.card],message=FORTUNE_MESSAGES[entry.card]?.[entry.message];
 if(!card||!message)return {day:today,result:null};
 return {day:today,result:{title:card[0],summary:card[1],color:card[2],message,cardIndex:entry.card,selected:entry.selected}};
}

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
// v312: Shore fishing. Every draw, timing result, purchase and payout is server-owned.
const FISH_CATALOG=JSON.parse(fs.readFileSync(path.join(PUBLIC,'assets/fishing/catalog.json'),'utf8'));
if(FISH_CATALOG.length!==60||FISH_CATALOG.reduce((n,f)=>n+f.weight,0)!==10000)throw Error('Invalid fishing probabilities');
const FISH_BY_ID=new Map(FISH_CATALOG.map(f=>[f.id,f]));
const FISH_ROD_PRICES=[0,500,650,1400,2800,5000]; // level 1 purchase, then lv2..lv5
const FISH_LEVEL_NAMES=['','나무 낚싯대','실버 낚싯대','골드 낚싯대','플래티넘 낚싯대','레인보우 낚싯대'];
const FISH_MAX_LEVEL=5,FISH_CAST_COOLDOWN_MS=8000,FISH_BITE_WINDOW_MS=9500;
// Daily points earned from successful catches; reward is valid only the next KST day.
let fishKingDay=kstDate(),fishKingReward=null;
const fishKingScores=new Map();
function fishKingRows(){return [...fishKingScores.entries()].map(([identity,v])=>({identity,...v})).sort((a,b)=>b.score-a.score||a.at-b.at||a.identity.localeCompare(b.identity));}
function playerIsFishKing(p){return !!(p?.badgeIdentity&&fishKingReward?.date===kstDate()&&fishKingReward.identity===p.badgeIdentity);}
function syncPlayerFishKing(p){const yes=playerIsFishKing(p),revoke=!yes&&p.action==='fishking';if(Boolean(p.fishKing)===yes&&!revoke)return false;p.fishKing=yes;if(revoke)p.action='idle';return true;}
function rotateFishKingDay(){const today=kstDate();if(today===fishKingDay)return;const winner=fishKingDay===previousKstDate(today)?fishKingRows()[0]:null;if(winner)awardDailyWinner(winner.identity);fishKingReward=winner?{date:today,sourceDate:fishKingDay,identity:winner.identity,name:winner.name,score:winner.score}:null;fishKingDay=today;fishKingScores.clear();for(const p of players.values())if(syncPlayerFishKing(p))broadcast({type:'profile',player:p});scheduleSave();}
function recordFishingPoints(p,points){rotateFishKingDay();if(!p.badgeIdentity||!Number.isSafeInteger(points)||points<=0)return;const old=fishKingScores.get(p.badgeIdentity);fishKingScores.set(p.badgeIdentity,{name:clean(p.name,18)||'ROCKER',score:(old?.score||0)+points,at:Date.now()});}
function fishKingPublic(){rotateFishKingDay();return {day:fishKingDay,leaderboard:fishKingRows().slice(0,5).map((r,i)=>({rank:i+1,name:r.name,score:r.score})),reward:fishKingReward&&fishKingReward.date===kstDate()?{name:fishKingReward.name,score:fishKingReward.score}:null};}

// Fishing tournaments run independently of fishing sessions and survive reconnects.
const fishingTournaments=new Map(),FISH_TOURNEY_FEE=1000,FISH_TOURNEY_WAIT=300000;
function fishingTourneyPlayer(identity){return [...players.values()].find(p=>p.badgeIdentity===identity)||{badgeIdentity:identity,badgeSince:Date.now()};}
function fishingTourneyNotify(t,message){for(const entry of t.entries){for(const player of players.values())if(player.badgeIdentity===entry.id){const stream=clients.get(player.id);if(stream)try{send(stream,{type:'fishing-tournament-notice',message})}catch{}}}}
function fishingTourneyChanged(){broadcast({type:'fishing-tournament-update'});}
function fishingTourneyTargets(){const tiers=['common','rare','epic'];const rarity=tiers[crypto.randomInt(tiers.length)];const pool=FISH_CATALOG.filter(f=>f.rarity===rarity);if(!pool.length)throw Error('물고기 목록이 부족합니다.');return [pool[crypto.randomInt(pool.length)].id];}
function fishingTourneyTick(now=Date.now()){
 let changed=false;
 for(const t of fishingTournaments.values()){
  if(t.phase==='waiting'&&now>=t.startsAt){
   const eligible=t.entries.filter(e=>tentPointBalance(fishingTourneyPlayer(e.id))>=FISH_TOURNEY_FEE);
   if(eligible.length<2){t.phase='cancelled';t.endedAt=now;t.reason='참가자가 2명 미만이거나 포인트가 부족해 취소됐어요.';fishingTourneyNotify(t,t.reason);}
   else {const removed=t.entries.filter(e=>!eligible.includes(e));for(const e of removed)fishingTourneyNotify({entries:[e]},'참가비가 부족해 낚시대회 참가가 취소됐어요.');t.entries=eligible;t.targets=fishingTourneyTargets();t.phase='running';t.startedAt=now;t.pot=eligible.length*FISH_TOURNEY_FEE;t.prize=Math.floor(t.pot*.8);for(const e of eligible)petRacePoints.set(e.id,(petRacePoints.get(e.id)||0)-FISH_TOURNEY_FEE);fishingTourneyNotify(t,'🎣 낚시대회가 시작됐어요! 목표 물고기를 확인하세요.');}
   changed=true;
  }
  if(t.phase==='running'&&t.vote&&now>=t.vote.expiresAt){t.vote=null;changed=true;}
 }
 if(changed){scheduleSave();fishingTourneyChanged();}return changed;
}
function fishingTourneyCatch(p,fish){
 fishingTourneyTick();for(const t of fishingTournaments.values()){
  if(t.phase!=='running'||!t.targets.includes(fish.id))continue;const e=t.entries.find(x=>x.id===p.badgeIdentity);if(!e||e.caught.includes(fish.id))continue;
  e.caught.push(fish.id);
  if(e.caught.length===t.targets.length){t.phase='finished';t.endedAt=Date.now();t.winner=e.name;t.winnerId=e.id;petRacePoints.set(e.id,(petRacePoints.get(e.id)||0)+t.prize);t.vote=null;fishingTourneyNotify(t,`🏆 낚시대회 우승: ${e.name} · ${t.prize.toLocaleString()}P`);}
  fishingTourneyChanged();
 }
}
function fishingTourneyView(identity){
 fishingTourneyTick();const now=Date.now();return {serverNow:now,items:[...fishingTournaments.values()].filter(t=>t.phase==='waiting'||t.phase==='running'||(t.entries.some(e=>e.id===identity)&&now-(t.endedAt||now)<86400000)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,40).map(t=>{const mine=t.entries.find(e=>e.id===identity);return {id:t.id,host:t.host,phase:t.phase,startsAt:t.startsAt,startedAt:t.startedAt,endedAt:t.endedAt,reason:t.reason,winner:t.winner,prize:t.prize||0,participantCount:t.entries.length,entries:t.entries.map(e=>({name:e.name,progress:e.caught.length,isMe:e.id===identity})),joined:!!mine,targets:t.phase==='waiting'?[]:(t.targets||[]).map(id=>FISH_BY_ID.get(id)).filter(Boolean),caught:mine?.caught||[],vote:t.vote?{yes:Object.values(t.vote.ballots).filter(Boolean).length,no:Object.values(t.vote.ballots).filter(v=>!v).length,total:t.entries.length,myVote:mine&&Object.hasOwn(t.vote.ballots,identity)?t.vote.ballots[identity]:null,expiresAt:t.vote.expiresAt}:null};})};
}
function fishingTourneyAction(p,d){
 fishingTourneyTick();const id=p.badgeIdentity,command=String(d.command||'state');if(command==='state')return;
 if(command==='create'||command==='join'){
  if([...fishingTournaments.values()].some(t=>['waiting','running'].includes(t.phase)&&t.entries.some(e=>e.id===id)))throw Error('이미 참가 중인 대회가 있어요.');
  if(tentPointBalance(p)<FISH_TOURNEY_FEE)throw Error('참가하려면 1,000P가 필요해요.');
  if(command==='create'){if([...fishingTournaments.values()].filter(t=>['waiting','running'].includes(t.phase)).length>=50)throw Error('진행 중인 대회가 너무 많아요.');const now=Date.now(),t={id:crypto.randomUUID(),host:clean(p.name,18)||'참가자',createdAt:now,startsAt:now+FISH_TOURNEY_WAIT,phase:'waiting',entries:[{id,name:clean(p.name,18)||'참가자',caught:[]}]};fishingTournaments.set(t.id,t);}
  else {const t=fishingTournaments.get(String(d.tournamentId||''));if(!t||t.phase!=='waiting')throw Error('모집 중인 대회가 아니에요.');if(t.entries.length>=100)throw Error('참가 인원이 가득 찼어요.');t.entries.push({id,name:clean(p.name,18)||'참가자',caught:[]});}
 }else{
  const t=fishingTournaments.get(String(d.tournamentId||'')),e=t?.entries.find(x=>x.id===id);if(!e)throw Error('참가한 대회가 아니에요.');
  if(command==='leave'){if(t.phase!=='waiting')throw Error('모집 중에만 나갈 수 있어요.');t.entries=t.entries.filter(x=>x.id!==id);if(!t.entries.length)fishingTournaments.delete(t.id);}
  else if(command==='vote_start'){if(t.phase!=='running')throw Error('진행 중인 대회에서만 투표할 수 있어요.');if(t.vote)throw Error('이미 투표가 진행 중이에요.');t.vote={expiresAt:Date.now()+120000,ballots:{[id]:true}};fishingTourneyNotify(t,'🗳️ 낚시대회 종료 투표가 시작됐어요.');}
  else if(command==='vote'){if(t.phase!=='running'||!t.vote)throw Error('진행 중인 투표가 없어요.');if(typeof d.yes!=='boolean')throw Error('찬성 또는 반대를 선택해 주세요.');if(Object.hasOwn(t.vote.ballots,id))throw Error('이미 투표했어요.');t.vote.ballots[id]=d.yes;}
  else throw Error('알 수 없는 요청입니다.');
  if(t.vote){const votes=Object.values(t.vote.ballots),majority=Math.floor(t.entries.length/2)+1;if(votes.filter(Boolean).length>=majority){t.phase='cancelled';t.endedAt=Date.now();t.reason='종료 투표가 가결되어 참가비를 전액 돌려드렸어요.';for(const entry of t.entries)petRacePoints.set(entry.id,(petRacePoints.get(entry.id)||0)+FISH_TOURNEY_FEE);t.vote=null;fishingTourneyNotify(t,t.reason);}else if(votes.filter(v=>!v).length>=majority){t.vote=null;fishingTourneyNotify(t,'종료 투표가 부결되어 낚시대회가 계속됩니다.');}}
 }
 scheduleSave();fishingTourneyChanged();
}

let mineKingDay=kstDate(),mineKingReward=null;const mineKingScores=new Map();
function mineKingRows(){return [...mineKingScores.entries()].map(([identity,v])=>({identity,...v})).sort((a,b)=>b.score-a.score||a.at-b.at||a.identity.localeCompare(b.identity));}
function playerIsMineKing(p){return !!(p?.badgeIdentity&&mineKingReward?.date===kstDate()&&mineKingReward.identity===p.badgeIdentity);}
function syncPlayerMineKing(p){const yes=playerIsMineKing(p),revoke=!yes&&p.action==='mineking';if(Boolean(p.mineKing)===yes&&!revoke)return false;p.mineKing=yes;if(revoke)p.action='idle';return true;}
function rotateMineKingDay(){const today=kstDate();if(today===mineKingDay)return;const winner=mineKingDay===previousKstDate(today)?mineKingRows()[0]:null;if(winner)awardDailyWinner(winner.identity);mineKingReward=winner?{date:today,sourceDate:mineKingDay,identity:winner.identity,name:winner.name,score:winner.score}:null;mineKingDay=today;mineKingScores.clear();for(const p of players.values())if(syncPlayerMineKing(p))broadcast({type:'profile',player:p});scheduleSave();}
function recordMiningPoints(p,points){rotateMineKingDay();if(!p.badgeIdentity||!Number.isSafeInteger(points)||points<=0)return;const old=mineKingScores.get(p.badgeIdentity);mineKingScores.set(p.badgeIdentity,{name:clean(p.name,18)||'ROCKER',score:(old?.score||0)+points,at:Date.now()});}
function mineKingPublic(){rotateMineKingDay();return {day:mineKingDay,leaderboard:mineKingRows().slice(0,5).map((r,i)=>({rank:i+1,name:r.name,score:r.score})),reward:mineKingReward&&mineKingReward.date===kstDate()?{name:mineKingReward.name,score:mineKingReward.score}:null};}

const MINING_CATALOG=JSON.parse(fs.readFileSync(path.join(PUBLIC,'assets/mining/catalog.json'),'utf8'));
if(MINING_CATALOG.length!==60||MINING_CATALOG.reduce((n,x)=>n+x.weight,0)!==10000)throw Error('Invalid mining catalog');
const MINING_BY_ID=new Map(MINING_CATALOG.map(x=>[x.id,x]));
const MINING_ROCKS=[{id:'rock1',x:-28,z:48},{id:'rock2',x:-19,z:54},{id:'rock3',x:-9,z:48},{id:'rock4',x:2,z:54},{id:'rock5',x:13,z:48},{id:'rock6',x:24,z:54},{id:'rock7',x:35,z:48},{id:'rock8',x:42,z:54}];
const MINING_HITS=20,MINING_HIT_MS=200;
const miningStats=new Map();
function miningAccount(identity){if(!miningStats.has(identity))miningStats.set(identity,{bonus:0,counts:{},active:null,lastResult:null});const a=miningStats.get(identity);if(a.active&&Date.now()-a.active.lastAt>90000)a.active=null;return a;}
function miningDistance(p,rock){return p&&!p.tentRoomId?Math.hypot((p.x-600)*.058-rock.x,(p.y-500)*.058+8-rock.z):Infinity;}
function miningView(p){const a=miningAccount(p.badgeIdentity);return {catalog:MINING_CATALOG,counts:a.counts,points:tentPointBalance(p),king:mineKingPublic(),required:MINING_HITS,active:a.active&&a.active.playerId===p.id?{id:a.active.id,rockId:a.active.rockId,hits:a.active.hits}:null,lastResult:a.lastResult};}
function clearMiningPlayer(p){if(!p?.badgeIdentity)return;const a=miningStats.get(p.badgeIdentity);if(a?.active?.playerId===p.id)a.active=null;}
function miningDraw(){const n=crypto.randomInt(10000);let sum=0;for(const item of MINING_CATALOG){sum+=item.weight;if(n<sum)return item;}return MINING_CATALOG[MINING_CATALOG.length-1];}

// Mission account and character XP are separate from lifetime collection counts.
const questAccounts=new Map(),combatNames=new Map();
const QUEST_CATALOG=[
 {kind:'fish',rarity:'common',goal:8,xp:260},{kind:'fish',rarity:'uncommon',goal:5,xp:380},{kind:'fish',rarity:'rare',goal:3,xp:560},{kind:'fish',rarity:'epic',goal:1,xp:850},
 {kind:'ore',rarity:'common',goal:10,xp:260},{kind:'ore',rarity:'uncommon',goal:6,xp:380},{kind:'ore',rarity:'rare',goal:4,xp:560},{kind:'ore',rarity:'epic',goal:2,xp:850}
];
// Keep legacy missions valid when restoring saves, but do not offer heroic missions.
const AVAILABLE_QUESTS=QUEST_CATALOG.filter(q=>q.rarity!=='epic');
function questAccount(id){let q=questAccounts.get(id);if(!q){q={day:kstDate(),used:0,spent:0,xp:0,active:null};questAccounts.set(id,q);}if(q.day!==kstDate()){q.day=kstDate();q.used=0;}return q;}
function questLevel(xp){let level=1;while(level<200&&xp>=40*level+8*level*(level+1))level++;return level;}
function questView(p){const q=questAccount(p.badgeIdentity),level=questLevel(q.xp);return {day:q.day,used:q.used,limit:10,cost:2000,xp:q.xp,level,combatPower:characterCombatPower(p.badgeIdentity),nextXp:level<200?40*level+8*level*(level+1):null,active:q.active,points:tentPointBalance(p)};}
function questProgress(p,kind,rarity){const q=questAccounts.get(p.badgeIdentity),m=q?.active;if(!m||m.done||m.kind!==kind||m.rarity!==rarity)return;m.progress=Math.min(m.goal,m.progress+1);if(m.progress===m.goal)m.done=true;for(const viewer of players.values()){if(viewer.badgeIdentity!==p.badgeIdentity)continue;const connection=clients.get(viewer.id);if(connection)try{send(connection,{type:'quest-progress',quest:{...m}})}catch{}}}

let petSkillRefund20261119Done=false,petSkillTicketRefund20261119Done=false;
const CRAFT_TIERS=['common','uncommon','rare','epic','legendary'],craftAccounts=new Map();
function craftAccount(id){let r=craftAccounts.get(id);if(!r){r={spentOre:{},spentFish:{},weapons:{},skills:{},equippedWeapon:null,equippedSkill:null,weaponVisible:false,awakening:{weapon:false,skill:false},tickets:{weapon:0,skill:0},upgradeTickets:{weapon:{},skill:{}},awakened:{weapon:null,skill:null}};craftAccounts.set(id,r)}return r;}
function craftAvailable(id,type,tier){const catalog=type==='weapon'?MINING_CATALOG:FISH_CATALOG,counts=type==='weapon'?(miningStats.get(id)?.counts||{}):(fishingStats.get(id)?.fishCounts||{}),spent=type==='weapon'?craftAccount(id).spentOre:craftAccount(id).spentFish;return Math.max(0,catalog.filter(x=>x.rarity===tier).reduce((sum,x)=>sum+(counts[x.id]||0),0)-(spent[tier]||0));}
function craftChance(level){return Math.max(20,100-4*level);}
function craftView(p){const r=craftAccount(p.badgeIdentity),available={weapon:{},skill:{}};for(const type of ['weapon','skill'])for(const tier of CRAFT_TIERS)available[type][tier]=craftAvailable(p.badgeIdentity,type,tier);return {available,weapons:r.weapons,skills:r.skills,equippedWeapon:r.equippedWeapon,equippedSkill:r.equippedSkill,weaponVisible:r.weaponVisible===true,awakening:r.awakening,tickets:r.tickets,upgradeTickets:r.upgradeTickets,awakened:r.awakened,weaponBookComplete:MINING_CATALOG.every(x=>(miningStats.get(p.badgeIdentity)?.counts?.[x.id]||0)>0),skillBookComplete:FISH_CATALOG.every(x=>(fishingStats.get(p.badgeIdentity)?.fishCounts?.[x.id]||0)>0),points:tentPointBalance(p)};}
function craftAct(p,d){const id=p.badgeIdentity,r=craftAccount(id),type=String(d.kind||''),tier=String(d.tier||''),command=String(d.command||'state');if(command==='state')return null;if(command==='weapon-visibility'){if(typeof d.visible!=='boolean')throw Error('표시 설정이 올바르지 않아요.');if(d.visible&&!r.equippedWeapon)throw Error('먼저 무기를 착용해 주세요.');r.weaponVisible=d.visible;return {message:d.visible?'무기 표시':'무기 숨김'};}if(!['weapon','skill'].includes(type))throw Error('종류를 선택해 주세요.');const owned=type==='weapon'?r.weapons:r.skills,spent=type==='weapon'?r.spentOre:r.spentFish;
 if(command==='awakening'){const complete=(type==='weapon'?MINING_CATALOG:FISH_CATALOG).every(x=>((type==='weapon'?miningStats.get(id)?.counts:fishingStats.get(id)?.fishCounts)?.[x.id]||0)>0);if(!complete)throw Error('해당 도감을 모두 채워 주세요.');if(r.awakening[type])throw Error('이미 각성권을 받았어요.');r.awakening[type]=true;r.tickets[type]++;return {message:'각성권을 받았어요.'};}
 if(!CRAFT_TIERS.includes(tier))throw Error('등급을 선택해 주세요.');
 if(command==='synthesize'){
  const index=CRAFT_TIERS.indexOf(tier),attempts=Number(d.attempts),chance=[100,80,50,10][index];
  if(index<0||index>=4)throw Error('전설 등급은 합성할 수 없어요.');
  if(!Number.isInteger(attempts)||attempts<1||attempts>10)throw Error('합성은 1~10회까지 할 수 있어요.');
  const required=attempts*10;if(craftAvailable(id,type,tier)<required)throw Error('합성할 재료가 부족해요.');
  const pool=(type==='weapon'?MINING_CATALOG:FISH_CATALOG).filter(item=>item.rarity===CRAFT_TIERS[index+1]);if(!pool.length)throw Error('결과 목록이 없습니다.');
  const counts=type==='weapon'?miningAccount(id).counts:fishingAccount(id).fishCounts,results=[];
  for(let i=0;i<attempts;i++){if(crypto.randomInt(100)<chance){const item=pool[crypto.randomInt(pool.length)];results.push({success:true,id:item.id,name:item.name});}else results.push({success:false});}
  spent[tier]=(spent[tier]||0)+required;for(const result of results)if(result.success)counts[result.id]=(counts[result.id]||0)+1;
  const success=results.filter(x=>x.success).length;return {message:`합성 ${attempts}회 중 ${success}회 성공!`,synthesis:{kind:type,tier,nextTier:CRAFT_TIERS[index+1],attempts,success,spent:required,chance,results}};
 }
 if(command==='exchange'){if(craftAvailable(id,type,tier)<10)throw Error('같은 등급 재료 10개가 필요해요.');spent[tier]=(spent[tier]||0)+10;r.upgradeTickets[type][tier]=(r.upgradeTickets[type][tier]||0)+1;return {message:'강화권을 교환했어요.'};}
 if(command==='awaken'){if(!Object.hasOwn(owned,tier))throw Error('먼저 제작해 주세요.');if(r.awakened[type])throw Error('이미 해당 종류의 각성권을 사용했어요.');if(!r.tickets[type])throw Error('각성권이 필요해요.');r.tickets[type]--;r.awakened[type]=tier;return {message:'각성 완료! 장비 전투력이 20% 증가했어요.'};}
 if(command==='craft'){if(Object.hasOwn(owned,tier))throw Error('이미 제작했어요.');const cost=type==='weapon'?(tier==='legendary'?50:100):(tier==='legendary'?10:tier==='epic'?50:100);if(craftAvailable(id,type,tier)<cost)throw Error('재료가 부족해요.');spent[tier]=(spent[tier]||0)+cost;owned[tier]=0;return {message:'제작 완료!'};}
 if(command==='equip'){if(!Object.hasOwn(owned,tier))throw Error('먼저 제작해 주세요.');r[type==='weapon'?'equippedWeapon':'equippedSkill']=tier;return {message:'착용 완료!'};}
 if(command==='upgrade'){if(!Object.hasOwn(owned,tier))throw Error('먼저 제작해 주세요.');const level=owned[tier];if(level>=20)throw Error('최고 강화 단계예요.');if((r.upgradeTickets[type][tier]||0)>0)r.upgradeTickets[type][tier]--;else{if(craftAvailable(id,type,tier)<10)throw Error('강화권 또는 같은 등급 재료 10개가 필요해요.');spent[tier]=(spent[tier]||0)+10;}const chance=craftChance(level),success=crypto.randomInt(100)<chance;if(success)owned[tier]++;return {success,chance,message:success?'강화 성공!':'강화 실패 · 단계 유지'};}
 throw Error('알 수 없는 명령입니다.');
}

const battleAccounts=new Map();
function battleAccount(id){if(!battleAccounts.has(id))battleAccounts.set(id,{highest:0,active:null});return battleAccounts.get(id);}
function battlePublic(p){const r=battleAccount(p.badgeIdentity),pet=petStats.get(p.badgeIdentity)?.pet;return {highest:r.highest,active:r.active,charPower:characterCombatPower(p.badgeIdentity),petPower:pet&&Date.now()>=pet.hatchAt?petEquippedCombatPower(p.badgeIdentity,petLevel(pet.xp)):0};}
function battleAction(p,d){const id=p.badgeIdentity,r=battleAccount(id),command=String(d.command||'state');if(command==='state')return null;
 if(command==='start'){
  if(p.tentRoomId||Math.hypot((p.x-600)*.058-44,(p.y-500)*.058+8-60)>8)throw Error('해변 포털 가까이 이동해 주세요.');
  const stage=Number(d.stage),pet=petStats.get(id)?.pet;if(!pet||Date.now()<pet.hatchAt||!pet.summoned)throw Error('부화한 펫을 소환해 주세요.');if(!Number.isInteger(stage)||stage<1||stage>20||stage>r.highest+1)throw Error('이전 단계를 먼저 클리어해 주세요.');if(r.active?.phase==='running')throw Error('진행 중인 전투가 있어요.');
  const level=questLevel(questAccounts.get(id)?.xp||0),playerPower=characterCombatPower(id),gear=craftAccounts.get(id),tier=gear?.equippedSkill,skillIndex=CRAFT_TIERS.indexOf(tier),petPower=petEquippedCombatPower(id,petLevel(pet.xp));
  const enemyMax=Math.round((180+stage*110+stage*stage*24)*(1+.032*(stage-1))),playerMax=260+level*42+Math.floor(petPower*1.5),enemyAttack=3+stage*5+stage*stage*4;
  r.active={id:crypto.randomUUID(),stage,phase:'running',turn:0,playerHp:playerMax,playerMax,enemyHp:enemyMax,enemyMax,playerPower,petPower,enemyAttack:Math.round(enemyAttack),skillTier:tier||null,last:null};return;
 }
 if(command==='abandon'){if(!r.active||r.active.phase!=='running')throw Error('진행 중인 전투가 없어요.');r.active.phase='abandoned';return;}
 if(command==='turn'){
  const b=r.active;if(!b||b.id!==String(d.battleId||''))throw Error('전투 기록을 찾을 수 없어요.');const turn=Number(d.turn);if(!Number.isInteger(turn))throw Error('전투 순서가 올바르지 않아요.');if(turn<b.turn)return;if(b.phase!=='running'||turn!==b.turn)throw Error('전투 순서가 올바르지 않아요.');
  const actor=['character','monster','pet','monster'][b.turn%4],power=actor==='character'?b.playerPower:actor==='pet'?b.petPower:b.enemyAttack,amount=Math.max(1,Math.round(power*(.9+crypto.randomInt(21)/100)));
  if(actor==='monster')b.playerHp=Math.max(0,b.playerHp-amount);else b.enemyHp=Math.max(0,b.enemyHp-amount);b.last={actor,damage:amount};b.turn++;
  if(b.enemyHp===0){b.phase='won';r.highest=Math.max(r.highest,b.stage);}else if(b.playerHp===0)b.phase='lost';return;
 }throw Error('지원하지 않는 전투 요청입니다.');
}

const fishingStats=new Map();
function fishingNearSea(p){
 if(!p||p.tentRoomId)return false;
 const wx=(p.x-600)*.058,wz=(p.y-500)*.058+8;
 return Math.abs(wx)<=51&&wz>=60&&wz<=69.5;
}
function fishingAccount(identity){
 let a=fishingStats.get(identity);
 if(a?.auto&&!players.has(a.auto.playerId))a.auto=null;
 if(!a){a={level:0,spent:0,bonus:0,fishCounts:{},totalMisses:0,lastCastAt:0,active:null,lastResult:null};fishingStats.set(identity,a);}
 if(a.active&&Date.now()>a.active.expiresAt+1000){
  a.lastResult={id:a.active.id,success:false,reason:'time',at:Date.now()};a.totalMisses++;a.active=null;scheduleSave();
 }
 return a;
}
async function settleAutoFish(p,a,now=Date.now()){
 const auto=a.auto;if(!auto||auto.playerId!==p.id||now<auto.nextAt)return null;
 auto.nextAt=now+180000;const fish=fishingDraw(),resultId=crypto.randomUUID();
 a.bonus+=fish.points;a.fishCounts[fish.id]=(a.fishCounts[fish.id]||0)+1;recordFishingPoints(p,fish.points);questProgress(p,'fish',fish.rarity);fishingTourneyCatch(p,fish);
 const result=a.lastResult={id:resultId,success:true,fish,points:fish.points,reason:'caught',at:now};
 await saveNow();broadcast({type:'fishing-find',playerId:p.id,fishId:fish.id,name:fish.name,points:fish.points,rarity:fish.rarity});announceRareFind(p,fish);
 const connection=clients.get(p.id);if(connection)try{send(connection,{type:'auto-fishing-update',result,fishing:fishingView(p)});}catch{}
 return result;
}
function processAutoFishing(now=Date.now()){
 if(!restored)return;
 for(const [identity,a] of fishingStats){const auto=a.auto;if(!auto)continue;const p=players.get(auto.playerId);if(!p||p.badgeIdentity!==identity||!playerSessions.has(p.id)||!fishingNearSea(p)||miningAccount(identity).active){a.auto=null;continue;}if(!clients.has(p.id)){if(!auto.disconnectedAt)auto.disconnectedAt=now;if(now-auto.disconnectedAt>=90000)a.auto=null;continue;}auto.disconnectedAt=0;if(now<auto.nextAt)continue;void settleAutoFish(p,a,now).catch(error=>console.error('Auto fishing save failed:',error.message));}
}
setInterval(processAutoFishing,1000).unref();
function fishPosition(session,at){return .5+.5*Math.sin((at-session.startAt)/1000*session.speed+session.phase);}
// Deterministic resistance phases are shared by the server and the display.
function fishStrugglePhase(s,at){
 const r=s.struggle;if(!r||!Number.isFinite(r.firstAt)||!Number.isFinite(r.periodMs)||!Number.isFinite(r.durationMs)||r.periodMs<=0)return 'calm';
 const elapsed=at-r.firstAt;
 if(elapsed<0)return elapsed>=-1300?'warning':'calm';
 const pos=elapsed%r.periodMs;
 if(pos<r.durationMs)return 'struggle';
 return pos>=r.periodMs-1300?'warning':'calm';
}
function fishIntegrate(s,until,held,maxMs=2000){
 const rates=s.rates;if(!rates)return {progress:s.progress||0,tension:s.tension||0};
 let progress=Number(s.progress)||0,tension=Number(s.tension)||0;
 let at=Math.max(Number(s.updatedAt)||until,until-maxMs);const strength=Math.max(1,Number(s.struggle?.strength)||1);
 while(at<until){const next=Math.min(until,at+50),dt=(next-at)/1000,active=fishStrugglePhase(s,(at+next)/2)==='struggle';
  if(held){progress=Math.min(1,progress+rates.reel*(active?.67:1)*dt);tension=Math.min(1,tension+rates.tension*(active?strength:1)*dt);}
  else {progress=Math.max(0,progress-rates.escape*(active?1.55:1)*dt);tension=Math.max(0,tension-rates.cool*(active?.75:1)*dt);}
  at=next;if(progress>=1||tension>=1)break;
 }
 return {progress,tension};
}
function fishPublicSession(s){return s?{id:s.id,biteAt:s.biteAt,expiresAt:s.expiresAt,center:s.center,width:s.width,speed:s.speed,phase:s.phase,startAt:s.startAt||null,progress:s.progress||0,tension:s.tension||0,held:!!s.held,updatedAt:s.updatedAt||s.startAt,rates:s.rates||null,struggle:s.struggle||null}:null;}
function fishingView(p){
 const a=fishingAccount(p.badgeIdentity);return {level:a.level,rodName:FISH_LEVEL_NAMES[a.level],nextPrice:a.level<FISH_MAX_LEVEL?FISH_ROD_PRICES[a.level+1]:null,
  maxLevel:FISH_MAX_LEVEL,prices:FISH_ROD_PRICES,points:tentPointBalance(p),caught:Object.values(a.fishCounts).reduce((n,v)=>n+v,0),
  collected:Object.keys(a.fishCounts).length,misses:a.totalMisses,fishCounts:a.fishCounts,lastResult:a.lastResult,session:fishPublicSession(a.active),auto:a.auto?.playerId===p.id?{nextAt:a.auto.nextAt}:null,
  cooldownUntil:a.lastCastAt+FISH_CAST_COOLDOWN_MS,near:fishingNearSea(p),catalog:FISH_CATALOG,king:fishKingPublic(),serverNow:Date.now()};
}
// Difficulty rises with rarity while rod upgrades still improve control.
function fishReelRates(fish,level){
 const boost={common:1.10,uncommon:1.18,rare:1.27,epic:1.35,legendary:1.42}[fish.rarity]||1.10;
 const d=fish.difficulty;
 return {reel:.115+level*.014,escape:(.012+d*.003)*(1+(boost-1)*.8),tension:(.14+d*.018-level*.014)*boost,cool:(.235+level*.009)*(1-(boost-1)*.18)};
}
function fishStruggleSetup(fish,level,startAt){
 const spec={common:[8800,900,1.25],uncommon:[7800,1100,1.4],rare:[6900,1300,1.6],epic:[6200,1550,1.85],legendary:[5600,1750,2.05]}[fish.rarity]||[8800,900,1.25];
 return {firstAt:startAt+4500+crypto.randomInt(1201),periodMs:spec[0],durationMs:spec[1],strength:Math.max(1.05,spec[2]-(level-1)*.10)};
}
function fishingDraw(){const n=crypto.randomInt(10000);let sum=0;for(const fish of FISH_CATALOG){sum+=fish.weight;if(n<sum)return fish;}return FISH_CATALOG[FISH_CATALOG.length-1]}
function fishingRestore(a){
 const record={level:Math.max(0,Math.min(FISH_MAX_LEVEL,Math.floor(Number(a?.level)||0))),spent:0,bonus:0,fishCounts:{},totalMisses:0,lastCastAt:0,active:null,lastResult:null};
 for(const key of ['spent','bonus','totalMisses','lastCastAt'])if(Number.isSafeInteger(a?.[key])&&a[key]>=0&&a[key]<=10000000000)record[key]=a[key];
 if(a?.fishCounts&&typeof a.fishCounts==='object')for(const [id,count] of Object.entries(a.fishCounts).slice(0,FISH_CATALOG.length))if(FISH_BY_ID.has(id)&&Number.isSafeInteger(count)&&count>0&&count<100000000)record.fishCounts[id]=count;
 const last=a?.lastResult;
 if(last&&/^[a-f0-9-]{36}$/.test(last.id||'')&&typeof last.success==='boolean'){
  const fish=last.success?FISH_BY_ID.get(last.fish?.id):null;
  record.lastResult={id:last.id,success:!!fish&&last.success,fish:fish||undefined,points:fish?.points||0,reason:typeof last.reason==='string'?last.reason:'',at:Number(last.at)||Date.now()};
 }
 const ac=a?.active;
 if(ac&&/^[a-f0-9-]{36}$/.test(ac.id||'')&&FISH_BY_ID.has(ac.fishId)&&Number.isFinite(ac.biteAt)&&Number.isFinite(ac.expiresAt)&&ac.expiresAt>Date.now()&&ac.expiresAt<Date.now()+70000&&Number.isFinite(ac.center)&&Number.isFinite(ac.width)&&Number.isFinite(ac.speed)&&Number.isFinite(ac.phase)){
  record.active={id:ac.id,fishId:ac.fishId,biteAt:ac.biteAt,expiresAt:ac.expiresAt,center:ac.center,width:ac.width,speed:ac.speed,phase:ac.phase,startAt:Number(ac.startAt)||null,progress:Number(ac.progress)||0,tension:Number(ac.tension)||0,held:false,updatedAt:Date.now(),rates:ac.rates||null,struggle:ac.struggle&&Number.isFinite(ac.struggle.firstAt)&&Number.isFinite(ac.struggle.periodMs)&&Number.isFinite(ac.struggle.durationMs)&&Number.isFinite(ac.struggle.strength)?ac.struggle:null};
 }
 return record;
}

const TENT_COST=3000;
const tentStats=new Map();
let tentPointBonusMigrated=false;
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
 const seatProvided=raw.chairSeatHeight!==null&&raw.chairSeatHeight!==undefined&&raw.chairSeatHeight!=='';const seatHeight=seatProvided?Number(raw.chairSeatHeight):null;
 if(seatProvided&&(!Number.isFinite(seatHeight)||seatHeight<.05||seatHeight>height))return null;
 return {name,cost,width,depth,height,description:String(raw.description||'').trim().slice(0,150),enabled:raw.enabled!==false,bedEnabled:typeof raw.bedEnabled==='boolean'?raw.bedEnabled:/(침대|매트리스|mattress|(^|[-_ ])bed($|[-_ ])|^bed|(^|[-_ ])cot($|[-_ ]))/i.test(id+' '+name),bedSurfaceHeight,colorEnabled:raw.colorEnabled===true,chairEnabled:raw.chairEnabled===true,chairSeatHeight:seatHeight,lightEnabled:typeof raw.lightEnabled==='boolean'?raw.lightEnabled:/(lantern|랜턴|등불|호롱|lamp|램프)/i.test(id+' '+name),
    ...(modelRevision?{modelRevision}:{})};
}
const FURNITURE_COLORS={black:'블랙',white:'화이트',gray:'그레이',beige:'베이지',burgundy:'버건디',navy:'남색',wood:'우드'};
function refreshFurnitureCatalog(){
 for(const key of Object.keys(TENT_FURNITURE_CATALOG))delete TENT_FURNITURE_CATALOG[key];
 Object.assign(TENT_FURNITURE_CATALOG,BUNDLED_TENT_FURNITURE);
 for(const [id,spec] of furnitureCatalogEdits){
  const base=TENT_FURNITURE_CATALOG[id];
  TENT_FURNITURE_CATALOG[id]={...base,...spec,asset:spec.modelRevision
   ?'/api/tent-item-model/'+id+'?v='+spec.modelRevision:(base?.asset||'')};
 }
 // Variants remain addressable if an admin later disables color choices.
 for(const [id,item] of Object.entries({...TENT_FURNITURE_CATALOG}))for(const [color,label] of Object.entries(FURNITURE_COLORS)){
  TENT_FURNITURE_CATALOG[id+'~'+color]={...item,name:item.name+' ('+label+')',baseId:id,variantColor:color,enabled:item.enabled!==false&&item.colorEnabled===true};
 }
}
refreshFurnitureCatalog();
function furnitureAdminCatalog(){return Object.fromEntries(Object.entries(TENT_FURNITURE_CATALOG).filter(([,item])=>!item.baseId).map(([id,item])=>[id,{...item,bundled:!!BUNDLED_TENT_FURNITURE[id],custom:!BUNDLED_TENT_FURNITURE[id]}]));}
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
function tentPointBalance(p){const earned=(petRacePoints.get(p?.badgeIdentity)||0)+Math.floor(badgeTotal(p)/60)+tentTimeBonus(p)+(p.badgeIdentity?rhythmAccount(p.badgeIdentity).bonus+powerAccount(p.badgeIdentity).bonus+moleAccount(p.badgeIdentity).bonus+(fieldCoinBonuses.get(p.badgeIdentity)||0)+(adminPointCredits.get(p.badgeIdentity)||0)+(lotteryStats.get(p.badgeIdentity)?.bonus||0)+(fishingStats.get(p.badgeIdentity)?.bonus||0)+(miningStats.get(p.badgeIdentity)?.bonus||0):0);return Math.max(0,earned-(questAccounts.get(p.badgeIdentity)?.spent||0)-(fishingStats.get(p.badgeIdentity)?.spent||0)-(lotteryStats.get(p.badgeIdentity)?.spent||0)-(tentOwnedBy(p.badgeIdentity)?TENT_COST:0)-(tentOwnedBy(p.badgeIdentity)?.upgradeLevel===1?10000:0)-(furnitureStats.get(p.badgeIdentity)?.spent||0)-(petStats.get(p.badgeIdentity)?.spent||0)-(decorationStats.get(p.badgeIdentity)?.spent||0)-(tentOwnedBy(p.badgeIdentity)?.outdoorDecorSpent||0));}
function safeFurniturePose(item,x,z,angle,record){
 if(!item||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(angle))return false;
 if(angle<0||angle>=360||angle%45!==0)return false;
 const c=Math.cos(angle*Math.PI/180),sn=Math.sin(angle*Math.PI/180);
 const hw=item.width/2,hd=item.depth/2;
 const corners=[[-hw,-hd],[-hw,hd],[hw,-hd],[hw,hd]].map(([px,pz])=>[x+px*c+pz*sn,z-px*sn+pz*c]);
 const extra=record?.upgradeLevel===1?2:0;return corners.every(([px,pz])=>Math.abs(px)<=5.89+extra+1e-8&&Math.abs(pz)<=4.89+extra+1e-8)&&Math.hypot(x,z-2.5)>1.28;
}
function furnitureCorners(item,placement){
 const a=placement.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),hw=item.width/2,hd=item.depth/2;
 return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([u,v])=>[placement.x+u*c+v*sn,placement.z-u*sn+v*c]);
}
function polygonsOverlap(a,b){
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const u=poly[i],v=poly[(i+1)%poly.length],nx=-(v[1]-u[1]),ny=v[0]-u[0];
  const pa=a.map(p=>p[0]*nx+p[1]*ny),pb=b.map(p=>p[0]*nx+p[1]*ny);
  if(Math.max(...pa)<=Math.min(...pb)+1e-8||Math.max(...pb)<=Math.min(...pa)+1e-8)return false;
 }
 return true;
}
function furniturePlacement(record,itemId,x,z,rotation,supportId=''){
 const item=TENT_FURNITURE_CATALOG[itemId];if(!safeFurniturePose(item,x,z,rotation,record))return null;
 const all=record.furnishings||[],support=supportId?all.find(f=>f.instanceId===supportId):null;if(supportId&&!support)return null;
 const parent=support&&TENT_FURNITURE_CATALOG[support.itemId];if(support&&!parent)return null;
 let y=0;
 if(support){
  y=(Number(support.y)||0)+parent.height;
  // Entire base must fit on the supporting item's footprint.
  const a=(Number(support.rotation)||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
  const r=rotation*Math.PI/180,cr=Math.cos(r),sr=Math.sin(r);
  for(const [u,v] of [[-item.width/2,-item.depth/2],[item.width/2,-item.depth/2],[item.width/2,item.depth/2],[-item.width/2,item.depth/2]]){
   const dx=x+u*cr+v*sr-support.x,dz=z-u*sr+v*cr-support.z;
   if(Math.abs(dx*c-dz*sn)>parent.width/2+.001||Math.abs(dx*sn+dz*c)>parent.depth/2+.001)return null;
  }
 }
 if(y+item.height>8)return null;
 const box=furnitureCorners(item,{x,z,rotation});
 for(const other of all){const spec=TENT_FURNITURE_CATALOG[other.itemId];if(!spec)continue;const oy=Number(other.y)||0;
  if(y+item.height<=oy+.001||y>=oy+spec.height-.001)continue;
  if(polygonsOverlap(box,furnitureCorners(spec,other)))return null;
 }
 return {y,supportId:support?.instanceId||''};
}
function canPlaceFurniture(record,itemId,x,z,rotation,supportId=''){return !!furniturePlacement(record,itemId,x,z,rotation,supportId);}
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
function storedTent(record){return {...publicTent(record),outdoorDecorSpent:record.outdoorDecorSpent||0,exteriorImage:record.exteriorImage||'',pointBonusStartMinute:record.pointBonusStartMinute};}

// v245: Entrance interaction requires walking to within five real world units.
const TENT_ENTER_DISTANCE=5.0;
function tentEntranceDistance(player,tent){return Math.hypot((player.x-600)*.058-tent.x,(player.y-500)*.058+8-tent.z);}
const TENT_PAINTS={default:null,red:'#ef615a',orange:'#f59b42',yellow:'#f4dd63',green:'#78bd89',blue:'#709bda',black:'#292d38',white:'#f5f5f1'};
function tentOccupancy(roomId){let count=0;for(const p of players.values())if(p.tentRoomId===roomId)count++;return count;}
function publicTent(record){return {id:record.id,name:record.name,color:record.color,upgradeLevel:record.upgradeLevel===1?1:0,placed:!!record.placed,x:record.placed?record.x:null,z:record.placed?record.z:null,occupancy:tentOccupancy(record.id),capacity:TENT_MAX_OCCUPANCY,wallColor:record.wallColor||'default',floorColor:record.floorColor||'default',roomLightOn:record.roomLightOn!==false,exteriorType:record.exteriorType||'none',exteriorText:record.exteriorType==='text'?(record.exteriorText||''):'',exteriorImageId:record.exteriorType==='image'?tentExteriorImageId(record):'',outdoorDecor:outdoorDecorState(record),furnishings:(record.furnishings||[]).map(x=>({...x}))};}
function allPlacedTents(){return [...tentStats.values()].filter(t=>t.placed).map(publicTent)}
function tentOwnedBy(identity){return identity?tentStats.get(identity)||null:null}
function tentTimeBonus(p,now=Date.now()){const t=tentOwnedBy(p?.badgeIdentity);if(!t||!Number.isSafeInteger(t.pointBonusStartMinute))return 0;return Math.max(0,Math.floor(badgeTotal(p,now)/60)-t.pointBonusStartMinute);}
function tentView(player){
 const t=tentOwnedBy(player.badgeIdentity);
 const earned=Math.floor(badgeTotal(player)/60)+tentTimeBonus(player);
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
 'butterfly-wings':{name:'요정 날개',slot:'back',cost:260},
 'bunny-ears':{name:'토끼 귀',slot:'head',cost:125},
 'balloon-hat':{name:'블루 블랙 풍선 모자',slot:'head',cost:0}
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
 const earned=Math.floor(badgeTotal(p,now)/60)+tentTimeBonus(p,now)+(p.badgeIdentity?rhythmAccount(p.badgeIdentity).bonus+powerAccount(p.badgeIdentity).bonus+moleAccount(p.badgeIdentity).bonus+(fieldCoinBonuses.get(p.badgeIdentity)||0):0); // time points + game and field coin rewards
 return {points:tentPointBalance(p),earned,spent:(tentOwnedBy(p.badgeIdentity)?TENT_COST:0)+(furnitureStats.get(p.badgeIdentity)?.spent||0)+(petStats.get(p.badgeIdentity)?.spent||0)+(tentOwnedBy(p.badgeIdentity)?.outdoorDecorSpent||0),refunded:record.refunded||0,testing:true,owned:Object.keys(publicMdItems()),equipped:{...record.equipped},items:publicMdItems()};
}
function setShopAppearance(p){
 p.equipped=p.badgeIdentity?{...shopRecord(p.badgeIdentity).equipped}:{};p.weaponTier=p.badgeIdentity?(craftAccounts.get(p.badgeIdentity)?.equippedWeapon||null):null;p.weaponVisible=p.badgeIdentity?(craftAccounts.get(p.badgeIdentity)?.weaponVisible===true):false;p.battleStage=p.badgeIdentity?(battleAccounts.get(p.badgeIdentity)?.highest||0):0;p.characterLevel=p.badgeIdentity?questLevel(questAccounts.get(p.badgeIdentity)?.xp||0):1;p.characterPower=p.badgeIdentity?characterCombatPower(p.badgeIdentity):0;
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
function stateData(){return {version:18,pizzaGameMigration,petSkillRefund20261119Done,petSkillTicketRefund20261119Done,combatNames:Object.fromEntries(combatNames),battleAccounts:Object.fromEntries(battleAccounts),craftAccounts:Object.fromEntries(craftAccounts),questAccounts:Object.fromEntries(questAccounts),fishingTournaments:[...fishingTournaments.values()],petRace:petRace.race,petRacePoints:Object.fromEntries(petRacePoints),mineKingDay,mineKingReward,mineKingScores:Object.fromEntries(mineKingScores),miningStats:Object.fromEntries([...miningStats].map(([id,r])=>[id,{bonus:r.bonus,counts:r.counts,lastResult:r.lastResult}])),decorationStats:Object.fromEntries(decorationStats),fishKingDay,fishKingReward,fishKingScores:Object.fromEntries(fishKingScores),fortuneStats:Object.fromEntries(fortuneStats),oneTimeCreditApplied,adminPointCredits:Object.fromEntries(adminPointCredits),adminPointLedger:Object.fromEntries(adminPointLedger),recoveryRecords:Object.fromEntries(recoveryRecords),fishingStats:Object.fromEntries([...fishingStats].map(([id,a])=>[id,{level:a.level,spent:a.spent,bonus:a.bonus,fishCounts:a.fishCounts,totalMisses:a.totalMisses,lastCastAt:a.lastCastAt,active:a.active,lastResult:a.lastResult}])),lotteryStats:Object.fromEntries([...lotteryStats].map(([identity,a])=>[identity,{day:a.day,used:a.used,spent:a.spent,bonus:a.bonus,pending:a.pending,lastResult:a.lastResult}])),petStats:Object.fromEntries([...petStats].map(([identity,record])=>[identity,{spent:record.spent,pet:record.pet,effectsOwned:record.effectsOwned||{},effectsEnabled:record.effectsEnabled||{}}])),fieldCoinLastSpawnAt,fieldCoins:fieldCoinPublic(),fieldCoinBonuses:Object.fromEntries(fieldCoinBonuses),moleDay,moleHammerRevision,moleReward,moleScores:Object.fromEntries(moleScores),moleAccounts:Object.fromEntries([...moleAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session,lastResult:v.lastResult}])),powerDay,powerReward,powerScores:Object.fromEntries(powerScores),powerAccounts:Object.fromEntries([...powerAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session,lastResult:v.lastResult||null}])),rhythmAccounts:Object.fromEntries([...rhythmAccounts].map(([k,v])=>[k,{day:v.day,used:v.used,bonus:v.bonus,session:v.session}])),furnitureCatalogEdits:Object.fromEntries(furnitureCatalogEdits),furnitureStats:Object.fromEntries([...furnitureStats].map(([id,v])=>[id,{spent:v.spent,owned:v.owned}])),tentStats:Object.fromEntries([...tentStats].map(([identity,t])=>[identity,storedTent(t)])),announcements:{entry:entranceNotices,ticker:tickerNotices,intervalMinutes:tickerIntervalMinutes,immediateHistory:immediateNoticeHistory},music,queue:[...queue],history:[...history],nextTrackToken,customMd:Object.fromEntries(customMd),shopStats:Object.fromEntries([...shopStats].map(([k,v])=>[k,{spent:0,refunded:v.refunded||0,owned:v.owned,equipped:v.equipped}])),badgeStats:Object.fromEntries([...badgeStats].map(([k,v])=>[k,Math.floor(v.seconds||0)])),rhythm:{day:rhythmDay,reward:rhythmReward,scores:Object.fromEntries([...rhythmScores].map(([k,v])=>[k,{name:v.name,score:Math.max(0,Math.floor(Number(v.score)||0)),updatedAt:Number(v.updatedAt)||0}]))},savedAt:Date.now()}}
function applySaved(d){
 if(d?.petRace&&['waiting','running','finished'].includes(d.petRace.phase))petRace.race=d.petRace;petRacePoints.clear();if(d?.petRacePoints&&typeof d.petRacePoints==='object')for(const [id,n] of Object.entries(d.petRacePoints))if(/^[a-zA-Z0-9_-]{20,100}$/.test(id)&&Number.isSafeInteger(n)&&Math.abs(n)<1e9)petRacePoints.set(id,n);
 if(!d||typeof d!=='object')return;
 pizzaGameMigration=d.pizzaGameMigration===true;
 petSkillRefund20261119Done=d.petSkillRefund20261119Done===true;
 petSkillTicketRefund20261119Done=d.petSkillTicketRefund20261119Done===true;
 battleAccounts.clear();if(d.battleAccounts&&typeof d.battleAccounts==='object')for(const [id,row] of Object.entries(d.battleAccounts).slice(0,50000)){if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!row)continue;const b=row.active,valid=b&&/^[a-f0-9-]{36}$/.test(b.id||'')&&Number.isInteger(b.stage)&&b.stage>=1&&b.stage<=20&&['running','won','lost','abandoned'].includes(b.phase)&&Number.isSafeInteger(b.turn)&&b.turn>=0&&['playerHp','playerMax','enemyHp','enemyMax','playerPower','petPower','enemyAttack'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<100000000);battleAccounts.set(id,{highest:Math.max(0,Math.min(20,Math.floor(Number(row.highest)||0))),active:valid?b:null});}
 combatNames.clear();if(d.combatNames&&typeof d.combatNames==='object')for(const [id,name] of Object.entries(d.combatNames).slice(0,50000))if(/^[a-zA-Z0-9_-]{20,100}$/.test(id))combatNames.set(id,clean(name,18)||'ROCKER');
 craftAccounts.clear();if(d.craftAccounts&&typeof d.craftAccounts==='object')for(const [id,row] of Object.entries(d.craftAccounts).slice(0,50000)){if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!row)continue;const r={spentOre:{},spentFish:{},weapons:{},skills:{},equippedWeapon:null,equippedSkill:null,weaponVisible:false,awakening:{weapon:row.awakening?.weapon===true,skill:row.awakening?.skill===true},tickets:{weapon:row.tickets?.weapon===1?1:0,skill:row.tickets?.skill===1?1:0},upgradeTickets:{weapon:{},skill:{}},awakened:{weapon:CRAFT_TIERS.includes(row.awakened?.weapon)?row.awakened.weapon:null,skill:CRAFT_TIERS.includes(row.awakened?.skill)?row.awakened.skill:null}};for(const tier of CRAFT_TIERS){for(const key of ['spentOre','spentFish'])r[key][tier]=Math.max(0,Math.min(1000000000,Math.floor(Number(row[key]?.[tier])||0)));for(const kind of ['weapon','skill'])r.upgradeTickets[kind][tier]=Math.max(0,Math.min(100000,Math.floor(Number(row.upgradeTickets?.[kind]?.[tier])||0)));for(const key of ['weapons','skills'])if(Number.isInteger(row[key]?.[tier])&&row[key][tier]>=0&&row[key][tier]<=20)r[key][tier]=row[key][tier];}r.weaponVisible=row.weaponVisible===true;if(Object.hasOwn(r.weapons,row.equippedWeapon))r.equippedWeapon=row.equippedWeapon;if(Object.hasOwn(r.skills,row.equippedSkill))r.equippedSkill=row.equippedSkill;craftAccounts.set(id,r);}
 questAccounts.clear();if(d.questAccounts&&typeof d.questAccounts==='object')for(const [id,row] of Object.entries(d.questAccounts).slice(0,50000)){if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!row)continue;const valid=QUEST_CATALOG.find(x=>x.kind===row.active?.kind&&x.rarity===row.active?.rarity&&x.goal===row.active?.goal&&x.xp===row.active?.xp);const m=valid?{...valid,progress:Math.max(0,Math.min(valid.goal,Math.floor(Number(row.active.progress)||0))),done:false}:null;if(m){if(m.rarity==='epic')m.progress=m.goal;m.done=m.progress>=m.goal;}questAccounts.set(id,{day:/^\d{4}-\d{2}-\d{2}$/.test(row.day)?row.day:kstDate(),used:Math.max(0,Math.min(10,Math.floor(Number(row.used)||0))),spent:Math.max(0,Math.min(1000000000,Math.floor(Number(row.spent)||0))),xp:Math.max(0,Math.min(1000000,Math.floor(Number(row.xp)||0))),active:m});}
 fishingTournaments.clear();if(Array.isArray(d.fishingTournaments))for(const t of d.fishingTournaments.slice(-1000)){if(t&&typeof t.id==='string'&&['waiting','running','finished','cancelled'].includes(t.phase)&&Array.isArray(t.entries))fishingTournaments.set(t.id,t);}
 fortuneStats.clear();
 if(d.fortuneStats&&typeof d.fortuneStats==='object')for(const [id,v] of Object.entries(d.fortuneStats).slice(0,50000)){if(/^[a-zA-Z0-9_-]{20,100}$/.test(id)&&v&&/^\d{4}-\d{2}-\d{2}$/.test(v.day)&&Number.isInteger(v.card)&&v.card>=0&&v.card<FORTUNE_CARDS.length&&Number.isInteger(v.message)&&v.message>=0&&v.message<FORTUNE_MESSAGES[v.card].length&&Number.isInteger(v.selected)&&v.selected>=0&&v.selected<7)fortuneStats.set(id,v);}
 oneTimeCreditApplied=d.oneTimeCreditApplied===true;adminPointCredits.clear();adminPointLedger.clear();
 if(d.adminPointCredits&&typeof d.adminPointCredits==='object')for(const [id,value] of Object.entries(d.adminPointCredits).slice(0,50000))if(/^[a-zA-Z0-9_-]{20,100}$/.test(id)&&Number.isSafeInteger(value)&&value>=0&&value<=1000000000)adminPointCredits.set(id,value);
 if(d.adminPointLedger&&typeof d.adminPointLedger==='object')for(const [id,row] of Object.entries(d.adminPointLedger).slice(-50000))if(/^[a-zA-Z0-9_-]{8,80}$/.test(id)&&row&&/^[a-zA-Z0-9_-]{20,100}$/.test(row.identity||'')&&Number.isSafeInteger(row.amount)&&row.amount>0&&row.amount<=1000000)adminPointLedger.set(id,{identity:row.identity,amount:row.amount,at:Number(row.at)||0,reason:String(row.reason||'').slice(0,100)});
 recoveryRecords.clear();recoveryIndex.clear();
 if(d.recoveryRecords&&typeof d.recoveryRecords==='object')for(const [identity,r] of Object.entries(d.recoveryRecords).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!r||!/^[a-f0-9]{64}$/.test(r.hash||'')||recoveryIndex.has(r.hash))continue;
  const profile=r.profile&&typeof r.profile==='object'?r.profile:null;
  recoveryRecords.set(identity,{hash:r.hash,profile});recoveryIndex.set(r.hash,identity);
 }
 decorationStats.clear();
 if(d.decorationStats&&typeof d.decorationStats==='object')for(const [id,row] of Object.entries(d.decorationStats).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!row||typeof row!=='object')continue;
  const record={spent:Number.isSafeInteger(row.spent)&&row.spent>=0?row.spent:0,owned:{bubble:{},trail:{}},equipped:{bubble:null,trail:null}};
  for(const kind of ['bubble','trail']){for(const key of Object.keys(DECORATIONS[kind]))if(row.owned?.[kind]?.[key]===true)record.owned[kind][key]=true;const active=row.equipped?.[kind];if(active&&Object.prototype.hasOwnProperty.call(DECORATIONS[kind],active)&&(record.owned[kind][active]||(kind==='trail'&&TRAIL_TEST_FREE)))record.equipped[kind]=active;}
  decorationStats.set(id,record);
 }
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
  const effectsOwned={},effectsEnabled={};for(const id of Object.keys(PET_EFFECTS)){effectsOwned[id]=r.effectsOwned?.[id]===true;effectsEnabled[id]=effectsOwned[id]&&r.effectsEnabled?.[id]===true;}
  petStats.set(identity,{spent,pet,effectsOwned,effectsEnabled});
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
 fishKingScores.clear();
 if(typeof d.fishKingDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.fishKingDay))fishKingDay=d.fishKingDay;
 if(d.fishKingScores&&typeof d.fishKingScores==='object'&&(fishKingDay===kstDate()||fishKingDay===previousKstDate()))for(const [id,r] of Object.entries(d.fishKingScores).slice(0,50000)){if(/^[a-zA-Z0-9_-]{20,100}$/.test(id)&&r&&Number.isSafeInteger(r.score)&&r.score>0&&Number.isFinite(r.at))fishKingScores.set(id,{name:clean(r.name,18)||'ROCKER',score:r.score,at:r.at});}
 if(d.fishKingReward&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.fishKingReward.identity||'')&&/^\d{4}-\d{2}-\d{2}$/.test(d.fishKingReward.date||''))fishKingReward={identity:d.fishKingReward.identity,name:clean(d.fishKingReward.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(d.fishKingReward.score)||0)),date:d.fishKingReward.date,sourceDate:String(d.fishKingReward.sourceDate||'')};
 mineKingScores.clear();
 if(typeof d.mineKingDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.mineKingDay))mineKingDay=d.mineKingDay;
 if(d.mineKingScores&&typeof d.mineKingScores==='object'&&(mineKingDay===kstDate()||mineKingDay===previousKstDate()))for(const [id,r] of Object.entries(d.mineKingScores).slice(0,50000)){if(/^[a-zA-Z0-9_-]{20,100}$/.test(id)&&r&&Number.isSafeInteger(r.score)&&r.score>0&&Number.isFinite(r.at))mineKingScores.set(id,{name:clean(r.name,18)||'ROCKER',score:r.score,at:r.at});}
 if(d.mineKingReward&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.mineKingReward.identity||'')&&/^\d{4}-\d{2}-\d{2}$/.test(d.mineKingReward.date||''))mineKingReward={identity:d.mineKingReward.identity,name:clean(d.mineKingReward.name,18)||'ROCKER',score:Math.max(0,Math.floor(Number(d.mineKingReward.score)||0)),date:d.mineKingReward.date,sourceDate:String(d.mineKingReward.sourceDate||'')};
 miningStats.clear();
 if(d.miningStats&&typeof d.miningStats==='object')for(const [id,r] of Object.entries(d.miningStats).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!r||typeof r!=='object')continue;
  const a={bonus:Number.isSafeInteger(r.bonus)&&r.bonus>=0?Math.min(r.bonus,10000000000):0,counts:{},active:null,lastResult:null};
  if(r.counts&&typeof r.counts==='object')for(const [key,count] of Object.entries(r.counts).slice(0,MINING_CATALOG.length))if(MINING_BY_ID.has(key)&&Number.isSafeInteger(count)&&count>0&&count<100000000)a.counts[key]=count;
  if(r.lastResult&&/^[a-f0-9-]{36}$/.test(r.lastResult.id||'')&&MINING_BY_ID.has(r.lastResult.oreId))a.lastResult={id:r.lastResult.id,oreId:r.lastResult.oreId,at:Number(r.lastResult.at)||0};
  miningStats.set(id,a);
 }
 fishingStats.clear();
 if(d.fishingStats&&typeof d.fishingStats==='object')for(const [id,a] of Object.entries(d.fishingStats).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(id)||!a||typeof a!=='object')continue;
  fishingStats.set(id,fishingRestore(a));
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
  const record={pointBonusStartMinute:Number.isSafeInteger(t.pointBonusStartMinute)&&t.pointBonusStartMinute>=0?t.pointBonusStartMinute:null,outdoorDecorOwned:Object.fromEntries(Object.keys(TENT_OUTDOOR_DECOR).map(k=>[k,t.outdoorDecor?.owned?.[k]===true])),outdoorDecorEnabled:Object.fromEntries(Object.keys(TENT_OUTDOOR_DECOR).map(k=>[k,t.outdoorDecor?.owned?.[k]===true&&t.outdoorDecor?.enabled?.[k]===true])),outdoorDecorSpent:Math.max(0,Math.min(1000,Math.floor(Number(t.outdoorDecorSpent)||0))),id:t.id,upgradeLevel:t.upgradeLevel===1?1:0,name:clean(t.name,22)||'나의 텐트',color:TENT_COLORS.includes(t.color)?t.color:TENT_COLORS[0],wallColor:Object.hasOwn(TENT_PAINTS,t.wallColor)?t.wallColor:'default',floorColor:Object.hasOwn(TENT_PAINTS,t.floorColor)?t.floorColor:'default',roomLightOn:t.roomLightOn!==false,exteriorType:artType==='image'&&!artImage?'none':artType==='text'&&!artText?'none':artType,exteriorText:artText,exteriorImage:artImage?.source||'',furnishings:[],placed:false,x:null,z:null};
  if(Array.isArray(t.furnishings))for(const f of t.furnishings.slice(0,TENT_FURNITURE_MAX_PLACED)){
   const x=Number(f.x),z=Number(f.z),rotation=Number(f.rotation);
   if(!TENT_FURNITURE_CATALOG[f.itemId]||!/^[-a-f0-9]{36}$/.test(f.instanceId||'')||record.furnishings.some(x=>x.instanceId===f.instanceId))continue;
   const placement=furniturePlacement(record,f.itemId,x,z,rotation,String(f.supportId||''));if(placement)record.furnishings.push({instanceId:f.instanceId,itemId:f.itemId,x,z,rotation,...placement});
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
 for(const [identity,t] of tentStats)if(t.pointBonusStartMinute===null){t.pointBonusStartMinute=Math.floor((badgeStats.get(identity)?.seconds||0)/60);tentPointBonusMigrated=true;}
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
  powerScores.set(identity,{name:clean(row.name,18)||'ROCKER',score:Math.max(0,Math.min(100000,Math.floor(Number(row.score)||0))),at:Number(row.at)||Date.now()});
 }
 if(d.powerReward&&typeof d.powerReward==='object'&&typeof d.powerReward.identity==='string'&&/^[a-zA-Z0-9_-]{20,100}$/.test(d.powerReward.identity)){
  powerReward={date:String(d.powerReward.date||''),identity:d.powerReward.identity,name:clean(d.powerReward.name,18)||'ROCKER',score:Math.max(0,Math.min(100000,Math.floor(Number(d.powerReward.score)||0))),sourceDate:String(d.powerReward.sourceDate||'')};
 }
 if(d.powerAccounts&&typeof d.powerAccounts==='object')for(const [identity,row] of Object.entries(d.powerAccounts).slice(0,50000)){
  if(!/^[a-zA-Z0-9_-]{20,100}$/.test(identity)||!row||typeof row!=='object')continue;
  const day=typeof row.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)?row.day:kstDate();
  const used=Math.max(0,Math.min(POWER_DAILY_COINS,Math.floor(Number(row.used)||0)));
  const bonus=Math.max(0,Math.min(100000000,Math.floor(Number(row.bonus)||0)));
  const v=row.session;const session=v&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&Number.isFinite(v.startedAt)?{id:v.id,startedAt:v.startedAt}:null;
  const result=row.lastResult&&typeof row.lastResult.id==='string'?{id:row.lastResult.id,score:Math.max(0,Math.min(100000,Number(row.lastResult.score)||0)),prize:Math.max(0,Math.min(50,Number(row.lastResult.prize)||0))}:null;powerAccounts.set(identity,{day,used,bonus,session:day===kstDate()?session:null,lastResult:result});
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
 if(!pizzaGameMigration){powerDay=kstDate();powerScores.clear();powerReward=null;for(const a of powerAccounts.values()){a.day=powerDay;a.used=0;a.session=null;}pizzaGameMigration=true;await strictSaveAdmin();}
 if(!petSkillRefund20261119Done){
  for(const r of craftAccounts.values())for(const tier of CRAFT_TIERS){
   if(!Object.hasOwn(r.skills,tier))continue;
   const minimumCraftCost=tier==='legendary'?10:50;
   const unusedTickets=(r.upgradeTickets.skill[tier]||0)*10;
   const retained=Math.min(r.spentFish[tier]||0,minimumCraftCost+unusedTickets);
   r.spentFish[tier]=retained;
   r.skills[tier]=0;
  }
  petSkillRefund20261119Done=true;
  await strictSaveAdmin();
 }
 if(!petSkillTicketRefund20261119Done){
  for(const r of craftAccounts.values())for(const tier of CRAFT_TIERS){
   const tickets=r.upgradeTickets.skill[tier]||0;if(!tickets)continue;
   const cost=tickets*10,spent=r.spentFish[tier]||0;
   if(spent<cost){console.error('Pet skill ticket refund skipped: inconsistent balance for tier',tier);continue;}
   r.spentFish[tier]=spent-cost;r.upgradeTickets.skill[tier]=0;
  }
  petSkillTicketRefund20261119Done=true;
  await strictSaveAdmin();
 }
 if([...questAccounts.values()].some(q=>q.active?.rarity==='epic'))scheduleSave();
 // The requested one-time credit is matched by code hash; never store the code.
 const specialIdentity=recoveryIndex.get(ONE_TIME_CREDIT_HASH);
 if(specialIdentity&&!oneTimeCreditApplied&&!adminPointLedger.has(ONE_TIME_CREDIT_ID)){
  adminPointCredits.set(specialIdentity,(adminPointCredits.get(specialIdentity)||0)+8700);
  adminPointLedger.set(ONE_TIME_CREDIT_ID,{identity:specialIdentity,amount:8700,at:Date.now(),reason:'요청 지급'});oneTimeCreditApplied=true;
  await strictSaveAdmin();
 }
 resetNoticeTicker();
 maybeRotateRhythmDay();
 rotatePowerDay();
 rotateMoleDay();
 rotateFishKingDay();
 rotateMineKingDay();
 maintainFieldCoins();
 // One-time v114 migration: legacy spent points were converted into refunded credits.
 // Persist the zero-spend records immediately so restarts never re-deduct them.
 if(tentPointBonusMigrated||petHatchDurationMigrated||[...shopStats.values()].some(r=>r.refunded>0))scheduleSave();
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
async function settlePetRace(){if(!restored||petRaceBusy)return;petRaceBusy=true;try{const result=petRace.settle();if(result){for(const x of result.awards)petRacePoints.set(x.identity,(petRacePoints.get(x.identity)||0)+x.amount);petRaceDirty=true;}if(petRaceDirty){await strictSaveAdmin();petRaceDirty=false;}}catch(e){console.error('Pet race save pending:',e.message)}finally{petRaceBusy=false;}}
setInterval(()=>{void settlePetRace();if(restored)fishingTourneyTick()},2000).unref();
setInterval(()=>{if(!restored||petRaceBusy||petRace.race?.phase!=='waiting')return;const online=new Set([...players.values()].map(p=>p.badgeIdentity));let changed=false;for(const entry of [...petRace.race.participants])if(!online.has(entry.identity)){petRace.leave(entry.identity);changed=true;}if(changed)scheduleSave();},15000).unref();
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
const SERVER_X_MIN=20,SERVER_X_MAX=1380,SERVER_Y_MIN=60,SERVER_Y_MAX=1550;
function cleanup(){const now=Date.now();for(const [id,p] of players)if(now-p.seen>180000&&!(()=>{const a=fishingStats.get(p.badgeIdentity)?.auto;return a?.playerId===id&&(clients.has(id)||(a.disconnectedAt&&now-a.disconnectedAt<90000));})()){settleBadge(p,Math.min(now,p.seen+45000));settleBadge(p);clearDuosFor(id);clearMiningPlayer(p);players.delete(id);forgetSession(id);voterLeaves(id);if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();const r=clients.get(id);if(r){r.end();clients.delete(id)}broadcast({type:'leave',id,count:players.size});sendTentUpdate()}}
setInterval(cleanup,7000).unref();
// Check connected, fresh players even while standing still; each coin has one winner.
setInterval(()=>{
 if(!restored||!fieldCoins.size)return;
 const now=Date.now();
 for(const p of players.values())if(clients.has(p.id)&&playerSessions.has(p.id)&&now-p.seen<=45000)collectNearbyFieldCoin(p);
},1000).unref();

setInterval(()=>{
 const now=Date.now();let changed=false;
 for(const p of players.values()){
  if(now-p.seen>45000)continue; // Do not reward stale tabs without heartbeat.
  if(updateBadge(p,now)){broadcast({type:'badge',id:p.id,badgeTier:p.badgeTier,badgeSeconds:p.badgeSeconds});changed=true;}
 }
 for(const p of players.values())if(p.badgeIdentity&&now-p.seen<=45000)settleBadge(p,now);
 if(changed)console.log('Visitor badge rank updated');
},60000).unref();
setInterval(()=>{if(restored){maybeRotateRhythmDay();rotatePowerDay();rotateMoleDay();rotateFishKingDay();rotateMineKingDay()}},30000).unref();

// One uninterrupted active dance minute per account yields 10 points.
const paidDanceActions=new Set(['headbang','buriburi','groove','dougie','windmill','skanking','airguitar','headspin','freestyle','rock-skank','shoulder-headbang']);
const danceRewardClocks=new Map();
function processDanceRewards(now=Date.now()){
 if(!restored)return;
 const active=new Map();
 for(const p of players.values())if(p.badgeIdentity&&clients.has(p.id)&&playerSessions.has(p.id)&&now-p.seen<=45000&&!p.gamePlaying&&paidDanceActions.has(p.action))active.set(p.badgeIdentity,p);
 for(const identity of danceRewardClocks.keys())if(!active.has(identity))danceRewardClocks.delete(identity);
 for(const [identity,p] of active){let clock=danceRewardClocks.get(identity);if(clock===undefined||now<clock){danceRewardClocks.set(identity,now);continue;}if(now-clock<60000)continue;danceRewardClocks.set(identity,now);adminPointCredits.set(identity,(adminPointCredits.get(identity)||0)+10);scheduleSave();for(const viewer of players.values())if(viewer.badgeIdentity===identity){const connection=clients.get(viewer.id);if(connection)try{send(connection,{type:'dance-reward',amount:10});}catch{}}}
}
setInterval(processDanceRewards,1000).unref();

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
    clients.get(id)?.end();clients.set(id,res);const auto=fishingStats.get(players.get(id)?.badgeIdentity)?.auto;if(auto?.playerId===id)auto.disconnectedAt=0;send(res,snapshot(id));
    const heartbeat=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},15000);
    req.on('close',()=>{clearInterval(heartbeat);if(clients.get(id)===res){clients.delete(id);const auto=fishingStats.get(players.get(id)?.badgeIdentity)?.auto;if(auto?.playerId===id)auto.disconnectedAt=Date.now();}});return;
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
        if(!previous&&Object.values(TENT_FURNITURE_CATALOG).filter(item=>!item.baseId).length>=60)return json(res,409,{error:'등록 한도는 60개예요.'});
        if(revision&&revision!==previous?.modelRevision&&!await storageExists(id,revision))return json(res,400,{error:'업로드한 GLB 파일을 찾지 못했어요. 다시 업로드해 주세요.'});
        const placed=[...tentStats.values()].some(t=>(t.furnishings||[]).some(f=>f.itemId===id||f.itemId.startsWith(id+'~')));
        if(placed&&previous&&(spec.width!==previous.width||spec.depth!==previous.depth||spec.height!==previous.height))return json(res,409,{error:'배치 중인 아이템의 가로·깊이·높이는 변경할 수 없어요. 먼저 회수한 뒤 수정해 주세요.'});
        furnitureCatalogEdits.set(id,spec);refreshFurnitureCatalog();await strictSaveAdmin();furnitureCatalogChanged();sendTentUpdate();
        return json(res,200,{ok:true,items:furnitureAdminCatalog()});
       }
       if(command==='delete'){
        const id=String(d.id||'');if(!TENT_ITEM_ID.test(id)||!TENT_FURNITURE_CATALOG[id])return json(res,404,{error:'상품이 없어요.'});
        if(BUNDLED_TENT_FURNITURE[id])return json(res,409,{error:'기본 제공 상품은 삭제할 수 없어요. 판매 중지로 설정해 주세요.'});
        if([...furnitureStats.values()].some(v=>Object.entries(v.owned||{}).some(([key,count])=>(key===id||key.startsWith(id+'~'))&&Number(count)>0))||[...tentStats.values()].some(v=>(v.furnishings||[]).some(f=>f.itemId===id||f.itemId.startsWith(id+'~'))))return json(res,409,{error:'구매하거나 배치한 사람이 있어 삭제할 수 없어요. 판매 중지로 바꿔 주세요.'});
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
      if(url.pathname==='/api/points-admin'){
        if(!MD_ADMIN_KEY)return json(res,503,{error:'관리자 키가 설정되지 않았어요.'});
        if(!adminAuthorized(req))return json(res,403,{error:'관리자 키가 올바르지 않아요.'});
        const code=String(d.code||'').trim();
        if(!/^OS-[A-Za-z0-9_-]{32}$/.test(code))return json(res,400,{error:'복구 코드 형식을 확인해 주세요.'});
        const identity=recoveryIndex.get(recoveryHash(code)),record=identity&&recoveryRecords.get(identity);
        if(!record)return json(res,404,{error:'해당 코드에 연결된 유저가 없어요.'});
        const p=[...players.values()].find(q=>q.badgeIdentity===identity)||{badgeIdentity:identity,badgeSince:Date.now()};
        const entries=()=>[...adminPointLedger.entries()].filter(([,v])=>v.identity===identity).slice(-50).reverse().map(([id,v])=>({id,amount:v.amount,at:v.at,reason:v.reason}));
        if(d.command==='lookup')return json(res,200,{ok:true,name:record.profile?.name||p.name||'유저',points:tentPointBalance(p),credits:adminPointCredits.get(identity)||0,history:entries()});
        if(d.command==='grant'){
          const amount=Number(d.amount),requestId=String(d.requestId||'');
          if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return json(res,400,{error:'1~1,000,000P의 정수를 입력해 주세요.'});
          if(!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))return json(res,400,{error:'지급 요청 번호가 올바르지 않아요.'});
          const prior=adminPointLedger.get(requestId);
          if(prior){if(prior.identity!==identity||prior.amount!==amount)return json(res,409,{error:'이미 사용된 지급 요청 번호예요.'});try{await strictSaveAdmin();}catch{return json(res,503,{error:'저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'});}return json(res,200,{ok:true,duplicate:true,points:tentPointBalance(p),history:entries()});}
          const oldCredit=adminPointCredits.get(identity)||0;if(oldCredit+amount>1000000000)return json(res,400,{error:'관리자 지급 한도를 초과했어요.'});
          adminPointCredits.set(identity,oldCredit+amount);adminPointLedger.set(requestId,{identity,amount,at:Date.now(),reason:String(d.reason||'').trim().slice(0,100)});
          // Never remove a ledger entry after an uncertain save: retry uses the same request ID.
          try{await strictSaveAdmin();}catch(error){return json(res,503,{error:'저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'});}
          for(const q of players.values())if(q.badgeIdentity===identity){const client=clients.get(q.id);if(client)try{send(client,{type:'points-admin-award',amount})}catch{}}
          return json(res,200,{ok:true,points:tentPointBalance(p),history:entries()});
        }
        return json(res,400,{error:'지원하지 않는 명령입니다.'});
      }
      if(url.pathname==='/api/recovery-restore'){
        const ip=req.socket.remoteAddress||'unknown',now=Date.now(),old=recoveryAttempts.get(ip),attempt=old&&now-old.start<60000?old:{start:now,count:0};
        attempt.count++;recoveryAttempts.set(ip,attempt);if(recoveryAttempts.size>5000)for(const [key,v] of recoveryAttempts)if(now-v.start>=60000)recoveryAttempts.delete(key);
        if(attempt.count>30)return json(res,429,{error:'시도가 너무 많아요. 잠시 후 다시 시도해 주세요.'});
        const code=String(d.code||'').trim();if(!/^OS-[A-Za-z0-9_-]{32}$/.test(code))return json(res,400,{error:'복구 코드 형식을 확인해 주세요.'});
        const identity=recoveryIndex.get(recoveryHash(code));const record=identity&&recoveryRecords.get(identity);
        if(!record)return json(res,400,{error:'일치하는 복구 코드가 없어요.'});
        return json(res,200,{ok:true,badgeIdentity:identity,profile:record.profile});
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
            syncPlayerRhythmKing(existing);syncPlayerPowerKing(existing);syncPlayerMoleKing(existing);syncPlayerFishKing(existing);rotateMineKingDay();syncPlayerMineKing(existing);syncDecoration(existing);existing.pet=petPublic(petStats.get(existing.badgeIdentity)?.pet,petStats.get(existing.badgeIdentity),existing.badgeIdentity);
            if(pageId)pageOwners.set(existingId,pageId);
            return json(res,200,{id:existingId,reused:true,...snapshot(existingId)});
          }
          if(existingId)sessionPlayers.delete(sessionKey);
        }
        maybeRotateRhythmDay();
        const id=crypto.randomUUID(),p={id,badgeSince:Date.now(),badgeTier:'bronze',badgeSeconds:0,name:clean(d.name,18)||'ROCKER',flagText:cleanFlag(d.flagText),flagImage:d.flagImage?storeFlagImage(d.flagImage)||'':'',color:colors.includes(d.color)?d.color:colors[0],...apparel(d),gender:d.gender==='female'?'female':'male',x:clamp(190+Math.random()*880,SERVER_X_MIN,SERVER_X_MAX),y:clamp(390+Math.random()*420,SERVER_Y_MIN,SERVER_Y_MAX),facing:0,action:'idle',pose:'stand',glowColor:'lime',glowEnabled:false,headbangBpm:120,headbangBeatAt:Date.now(),seen:Date.now(),rhythmKing:false,powerKing:false,moleKing:false};
        Object.defineProperty(p,'badgeIdentity',{value:badgeIdentity,writable:true,enumerable:false});if(badgeIdentity){combatNames.set(badgeIdentity,p.name);scheduleSave();}updateBadge(p);syncPlayerRhythmKing(p);syncPlayerPowerKing(p);syncPlayerMoleKing(p);rotateFishKingDay();syncPlayerFishKing(p);rotateMineKingDay();syncPlayerMineKing(p);syncDecoration(p);setShopAppearance(p);p.pet=petPublic(petStats.get(p.badgeIdentity)?.pet,petStats.get(p.badgeIdentity),p.badgeIdentity);players.set(id,p);
        if(sessionKey){sessionPlayers.set(sessionKey,id);playerSessions.set(id,sessionKey)}
        if(pageId)pageOwners.set(id,pageId);
        resumeForFirst();broadcast({type:'join',player:p,count:players.size});return json(res,200,{id,reused:false,...snapshot(id)});
      }
      const id=clean(d.id,80),p=players.get(id);if(!p)return json(res,401,{error:'Session expired. Please rejoin.'});p.seen=Date.now();
      if(url.pathname==='/api/combat-ranking'){if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});const ids=new Set([...questAccounts.keys(),...craftAccounts.keys(),...combatNames.keys()]);for(const person of players.values())if(person.badgeIdentity){ids.add(person.badgeIdentity);combatNames.set(person.badgeIdentity,person.name);}const rows=[...ids].map(identity=>({name:combatNames.get(identity)||recoveryRecords.get(identity)?.profile?.name||'이름 미등록',power:characterCombatPower(identity),level:questLevel(questAccounts.get(identity)?.xp||0)})).sort((a,b)=>b.power-a.power||b.level-a.level||a.name.localeCompare(b.name,'ko-KR')).slice(0,50).map((row,i)=>({...row,rank:i+1}));return json(res,200,{ok:true,rows});}
      if(url.pathname==='/api/battle'){
       if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서만 전투할 수 있어요.'});
       try{const previous=battleAccount(p.badgeIdentity).highest;battleAction(p,d);if(d.command!=='state')await saveNow();if(battleAccount(p.badgeIdentity).highest!==previous)for(const person of players.values())if(person.badgeIdentity===p.badgeIdentity){setShopAppearance(person);broadcast({type:'profile',player:person});}return json(res,200,{ok:true,battle:battlePublic(p)});}catch(error){return json(res,400,{error:error.message});}
      }
      if(url.pathname==='/api/craft'){
       if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
       if(!['state','weapon-visibility'].includes(String(d.command||'state'))&&(p.tentRoomId||Math.hypot((p.x-600)*.058-(-32),(p.y-500)*.058+8-(-7.2))>9))return json(res,403,{error:'제작 부스 가까이 이동해 주세요.'});
       try{const result=craftAct(p,d);if(result){await saveNow();if(d.kind==='skill'&&(d.command==='equip'||d.command==='upgrade'||d.command==='awaken'))syncPetPlayers(p.badgeIdentity);if(d.command==='weapon-visibility'||(d.kind==='weapon'&&(d.command==='equip'||d.command==='upgrade'||d.command==='awaken')))for(const person of players.values())if(person.badgeIdentity===p.badgeIdentity){setShopAppearance(person);broadcast({type:'profile',player:person});}}return json(res,200,{ok:true,result,craft:craftView(p)});}catch(error){return json(res,400,{error:error.message});}
      }
      if(url.pathname==='/api/quest'){
       if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
       const q=questAccount(p.badgeIdentity),command=String(d.command||'state');
       if(command==='accept'){
        if(p.tentRoomId||Math.hypot((p.x-600)*.058-(-45.6),(p.y-500)*.058+8-12)>16)return json(res,403,{error:'의뢰 부스 가까이 이동해 주세요.'});
        if(q.active)return json(res,409,{error:'진행 중인 의뢰를 완료해 주세요.'});if(q.used>=10)return json(res,409,{error:'오늘의 의뢰 10개를 모두 받았어요.'});if(tentPointBalance(p)<2000)return json(res,409,{error:'의뢰를 받으려면 2,000P가 필요해요.'});
        q.active={...AVAILABLE_QUESTS[crypto.randomInt(AVAILABLE_QUESTS.length)],progress:0,done:false};q.spent+=2000;q.used++;await saveNow();
       }else if(command==='claim'){
        if(!q.active?.done)return json(res,409,{error:'완료한 의뢰가 없어요.'});q.xp=Math.min(1000000,q.xp+q.active.xp);q.active=null;await saveNow();for(const person of players.values())if(person.badgeIdentity===p.badgeIdentity){setShopAppearance(person);broadcast({type:'profile',player:person});}
       }else if(command!=='state')return json(res,400,{error:'지원하지 않는 의뢰 명령입니다.'});
       return json(res,200,{ok:true,quest:questView(p)});
      }
      if(url.pathname==='/api/pet-race'){
       if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'입장 세션을 확인해 주세요.'});
       const identity=p.badgeIdentity,command=String(d.command||'state');
       if(petRaceBusy)return json(res,409,{error:'경주 상태를 저장하고 있어요. 잠시 후 다시 시도해 주세요.'});
       if(command!=='state'&&command!=='leave'&&(p.tentRoomId||Math.hypot((p.x-600)*.058+38,(p.y-500)*.058+8-39)>7))return json(res,403,{error:'해변의 펫 경주 부스에 가까이 와 주세요.'});
       try{
        if(command==='join'){const pet=petPublic(petStats.get(identity)?.pet,petStats.get(identity),identity);if(!pet?.hatched)throw Error('부화한 펫이 필요해요.');if(tentPointBalance(p)<Number(d.stake))throw Error('참가비가 부족해요.');petRace.join({identity,name:p.name,pet:{species:pet.species,color:pet.color,stage:pet.stage,hatched:true}},Number(d.stake));await saveNow();}
        else if(command==='watch'){petRace.watch(identity);await saveNow();}
        else if(command==='leave'){petRace.leave(identity);await saveNow();}
        else if(command==='start'){
         petRaceBusy=true;try{const balances={};for(const entry of petRace.race?.participants||[]){const other=[...players.values()].find(x=>x.badgeIdentity===entry.identity);balances[entry.identity]=other?tentPointBalance(other):0;}
          const started=petRace.start(identity,balances);for(const c of started.charges)petRacePoints.set(c.identity,(petRacePoints.get(c.identity)||0)-c.amount);petRaceDirty=true;await strictSaveAdmin();petRaceDirty=false;
         }finally{petRaceBusy=false;}
        }else if(command!=='state')throw Error('지원하지 않는 경주 요청이에요.');
        return json(res,200,{ok:true,race:petRace.view(identity),points:tentPointBalance(p)});
       }catch(error){return json(res,409,{error:error.message||'경주 요청을 처리하지 못했어요.'});}
      }
      if(url.pathname==='/api/recovery-code'){
        if(!p.badgeIdentity||!d.sessionKey||playerSessions.get(id)!==String(d.sessionKey))return json(res,403,{error:'본인 세션에서만 확인할 수 있어요.'});
        const existing=recoveryRecords.get(p.badgeIdentity),supplied=String(d.code||'').trim();
        if(existing){
          if(/^OS-[A-Za-z0-9_-]{32}$/.test(supplied)&&recoveryHash(supplied)===existing.hash)return json(res,200,{ok:true,valid:true});
          return json(res,200,{ok:true,valid:false,existing:true});
        }
        const code='OS-'+crypto.randomBytes(24).toString('base64url'),hash=recoveryHash(code);
        recoveryRecords.set(p.badgeIdentity,{hash,profile:recoveryProfile(p)});recoveryIndex.set(hash,p.badgeIdentity);
        try{await strictSaveAdmin();}catch(error){recoveryRecords.delete(p.badgeIdentity);recoveryIndex.delete(hash);return json(res,503,{error:'복구 코드를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'});}
        return json(res,200,{ok:true,valid:true,code});
      }
      if(url.pathname==='/api/field-coin'){
        if(String(d.command||'')==='state')return json(res,200,{ok:true,coins:fieldCoinPublic()});
        // Session secret prevents third-party use of the publicly visible avatar id.
        if(playerSessions.get(id)!==String(d.sessionKey||'')||!p.badgeIdentity)return json(res,403,{error:'본인 세션으로 접속해 주세요.'});
        if(p.tentRoomId)return json(res,400,{error:'텐트 밖에서만 동전을 주울 수 있어요.'});
        const coin=fieldCoins.get(String(d.coinId||''));
        if(!coin)return json(res,404,{error:'이미 다른 유저가 주운 동전이에요.'});
        if(Math.hypot((p.x-coin.x)*.058,(p.y-coin.y)*.058)>2.8)return json(res,400,{error:'동전에 더 가까이 가서 클릭해 주세요.'});
        const awarded=awardFieldCoin(p,coin,false);
        if(!awarded)return json(res,404,{error:'이미 다른 유저가 주운 동전이에요.'});
        await saveNow();
        return json(res,200,{ok:true,...awarded,points:tentPointBalance(p),coins:fieldCoinPublic()});
      }

      if(url.pathname==='/api/fishing-tournament'){
        if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
        try{fishingTourneyAction(p,d);return json(res,200,{ok:true,tournaments:fishingTourneyView(p.badgeIdentity),points:tentPointBalance(p)});}catch(error){return json(res,400,{error:error.message});}
      }
      if(url.pathname==='/api/fishing'){
        if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서만 낚시할 수 있어요.'});
        const command=String(d.command||'state'),a=fishingAccount(p.badgeIdentity);
        if(command==='state')return json(res,200,{ok:true,fishing:fishingView(p)});
        if(command==='auto-stop'){if(a.auto?.playerId===p.id)a.auto=null;return json(res,200,{ok:true,fishing:fishingView(p)});}
        if(!fishingNearSea(p))return json(res,403,{error:'바다 앞 모래사장으로 이동해 주세요.'});
        if(command==='auto-start'){
          if(!a.level)return json(res,409,{error:'낚싯대를 먼저 구매해 주세요.'});
          if(a.active)return json(res,409,{error:'현재 낚시를 마친 뒤 자동 낚시를 켜 주세요.'});
          if(miningAccount(p.badgeIdentity).active)return json(res,409,{error:'광질을 종료한 뒤 자동 낚시를 켜 주세요.'});
          if(a.auto&&a.auto.playerId!==p.id)return json(res,409,{error:'다른 창에서 자동 낚시 중이에요.'});
          if(!a.auto)a.auto={playerId:p.id,nextAt:Date.now()+180000};
          return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='auto-catch'){
          const auto=a.auto,now=Date.now();if(!auto||auto.playerId!==p.id)return json(res,409,{error:'자동 낚시가 종료됐어요.'});
          if(miningAccount(p.badgeIdentity).active){a.auto=null;return json(res,409,{error:'광질 중에는 자동 낚시를 할 수 없어요.'});}
          if(now<auto.nextAt)return json(res,429,{error:'아직 물고기를 기다리고 있어요.'});
          const result=await settleAutoFish(p,a,now);
          return json(res,200,{ok:true,result,fishing:fishingView(p)});
        }
        if(a.auto)return json(res,409,{error:'자동 낚시를 종료한 뒤 이용해 주세요.'});
        if(command==='buy'){
          if(a.level)return json(res,409,{error:'이미 낚싯대를 가지고 있어요.'});
          const cost=FISH_ROD_PRICES[1];if(tentPointBalance(p)<cost)return json(res,409,{error:'기본 낚싯대 구매에 500P가 필요해요.'});
          a.level=1;a.spent+=cost;await saveNow();return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='upgrade'){
          if(!a.level)return json(res,409,{error:'먼저 기본 낚싯대를 구매해 주세요.'});
          if(a.level>=FISH_MAX_LEVEL)return json(res,409,{error:'이미 최고 레벨 낚싯대예요.'});
          if(a.active)return json(res,409,{error:'낚시가 끝난 뒤 업그레이드할 수 있어요.'});
          const cost=FISH_ROD_PRICES[a.level+1];if(tentPointBalance(p)<cost)return json(res,409,{error:`업그레이드에 ${cost}P가 필요해요.`});
          a.level++;a.spent+=cost;await saveNow();return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='cast'){
          if(!a.level)return json(res,409,{error:'낚싯대를 먼저 구매해 주세요.'});
          if(a.active)return json(res,409,{error:'이미 낚시 중이에요.'});
          const now=Date.now();if(now-a.lastCastAt<FISH_CAST_COOLDOWN_MS)return json(res,429,{error:'낚싯대를 준비하는 중이에요.',fishing:fishingView(p)});
          const fish=fishingDraw();const biteAt=now+3000+crypto.randomInt(17001),phase=crypto.randomInt(6283)/1000;
          // Higher difficulty -> narrower target and faster cursor. Each upgrade widens success band.
          const width=Math.min(.30,.235-fish.difficulty*.032+(a.level-1)*.032);
          const speed=2.65+fish.difficulty*.38;
          a.active={id:crypto.randomUUID(),fishId:fish.id,biteAt,expiresAt:biteAt+15000,startAt:null,
           center:.27+crypto.randomInt(4600)/10000,width,speed,phase};
          a.lastCastAt=now;a.lastResult=null;
          await saveNow();return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='get'){
          const session=a.active, now=Date.now();
          if(!session||session.id!==String(d.castId||''))return json(res,409,{error:'진행 중인 낚시가 없어요.',fishing:fishingView(p)});
          if(now<session.biteAt||now>session.expiresAt)return json(res,409,{error:'입질 시간이 아니에요.',fishing:fishingView(p)});
          if(!session.startAt){session.startAt=now;session.expiresAt=now+60000;session.progress=0;session.tension=0;session.held=false;session.updatedAt=now;const hooked=FISH_BY_ID.get(session.fishId);session.rates=fishReelRates(hooked,a.level);session.struggle=fishStruggleSetup(hooked,a.level,now);await saveNow();}
          return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='reel_state'){
          const castId=String(d.castId||'');
          if(a.lastResult?.id===castId)return json(res,200,{ok:true,result:a.lastResult,fishing:fishingView(p)});
          const session=a.active,now=Date.now();
          if(!session||session.id!==castId||!session.startAt)return json(res,409,{error:'진행 중인 낚시가 없어요.',fishing:fishingView(p)});
          if(!session.rates)session.rates=fishReelRates(FISH_BY_ID.get(session.fishId),a.level);
          const result=fishIntegrate(session,now,session.held);session.progress=result.progress;session.tension=result.tension;
          session.updatedAt=now;session.held=d.held===true;
          if(session.progress>=1||session.tension>=1){
            const success=session.progress>=1&&session.tension<1, fish=FISH_BY_ID.get(session.fishId);a.active=null;
            if(success){a.bonus+=fish.points;a.fishCounts[fish.id]=(a.fishCounts[fish.id]||0)+1;recordFishingPoints(p,fish.points);questProgress(p,'fish',fish.rarity);fishingTourneyCatch(p,fish);}else a.totalMisses++;
            a.lastResult={id:castId,success,fish:success?fish:undefined,points:success?fish.points:0,reason:success?'caught':'line',at:now};
            await saveNow();if(success){broadcast({type:'fishing-find',playerId:p.id,fishId:fish.id,name:fish.name,points:fish.points,rarity:fish.rarity});announceRareFind(p,fish);}return json(res,200,{ok:true,result:a.lastResult,fishing:fishingView(p)});
          }
          return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        if(command==='cancel'){
          if(a.active){a.totalMisses++;a.lastResult={id:a.active.id,success:false,reason:'cancel',at:Date.now()};a.active=null;await saveNow();}
          return json(res,200,{ok:true,fishing:fishingView(p)});
        }
        return json(res,400,{error:'지원하지 않는 낚시 명령입니다.'});
      }
      if(url.pathname==='/api/fortune'){
        if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
        const command=String(d.command||'');
        if(command==='state')return json(res,200,{ok:true,fortune:fortuneView(p.badgeIdentity)});
        if(command!=='draw')return json(res,400,{error:'지원하지 않는 요청입니다.'});
        if(p.tentRoomId||Math.hypot((p.x-600)*.058-27,(p.y-500)*.058+8-(-7.2))>8)return json(res,403,{error:'운세 부스 근처에서 카드를 뽑아주세요.'});
        const selected=Number(d.selected);
        if(!Number.isInteger(selected)||selected<0||selected>=7)return json(res,400,{error:'카드를 선택해 주세요.'});
        if(!fortuneView(p.badgeIdentity).result){const card=crypto.randomInt(FORTUNE_CARDS.length);fortuneStats.set(p.badgeIdentity,{day:kstDate(),card,message:crypto.randomInt(FORTUNE_MESSAGES[card].length),selected});scheduleSave();}
        return json(res,200,{ok:true,fortune:fortuneView(p.badgeIdentity)});
      }
      if(url.pathname==='/api/mining'){
       if(!p.badgeIdentity||!playerSessions.get(id)||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서만 광질할 수 있어요.'});
       const command=String(d.command||'state'),a=miningAccount(p.badgeIdentity),now=Date.now();
       if(command==='state')return json(res,200,{ok:true,mining:miningView(p)});
       if(command==='start'){
        if(fishingAccount(p.badgeIdentity).auto)return json(res,409,{error:'자동 낚시를 종료한 뒤 광질해 주세요.'});
        const rock=MINING_ROCKS.find(x=>x.id===String(d.rockId||''));
        if(!rock||miningDistance(p,rock)>4)return json(res,403,{error:'광맥 가까이 이동해 주세요.'});
        if(a.active&&a.active.playerId!==p.id)return json(res,409,{error:'다른 창에서 광질 중이에요. 종료하거나 잠시 기다려 주세요.'});
        if(a.active)return json(res,200,{ok:true,mining:miningView(p)});
        a.active={id:crypto.randomUUID(),playerId:p.id,rockId:rock.id,hits:0,lastHit:0,lastAt:now};a.lastResult=null;
        p.action='mining';p.pose='stand';broadcast({type:'move',player:p});return json(res,200,{ok:true,mining:miningView(p)});
       }
       if(command==='stop'){
        if(a.active?.playerId===p.id)a.active=null;
        if(p.action==='mining'){p.action='idle';broadcast({type:'move',player:p});}
        return json(res,200,{ok:true,mining:miningView(p)});
       }
       if(command==='hit'){
        const session=a.active,sessionId=String(d.sessionId||'');
        if(a.lastResult?.id===sessionId){const item=MINING_BY_ID.get(a.lastResult.oreId);return json(res,200,{ok:true,result:item,mining:miningView(p)});}
        if(!session||session.playerId!==p.id||session.id!==sessionId)return json(res,409,{error:'광질을 다시 시작해 주세요.',mining:miningView(p)});
        const rock=MINING_ROCKS.find(x=>x.id===session.rockId);
        if(!rock||miningDistance(p,rock)>4.5){a.active=null;if(p.action==='mining'){p.action='idle';broadcast({type:'move',player:p});}return json(res,403,{error:'광맥에서 너무 멀어졌어요.',mining:miningView(p)});}
        const seq=Number(d.seq);if(!Number.isInteger(seq)||seq<1||seq>MINING_HITS)return json(res,400,{error:'올바르지 않은 채광 요청이에요.'});
        if(seq<=session.hits)return json(res,200,{ok:true,mining:miningView(p)});
        if(seq!==session.hits+1)return json(res,409,{error:'다시 시도해 주세요.',mining:miningView(p)});
        if(session.lastHit&&now-session.lastHit<MINING_HIT_MS)return json(res,429,{error:'조금 천천히 두드려 주세요.',mining:miningView(p)});
        session.hits++;session.lastHit=now;session.lastAt=now;
        if(session.hits===MINING_HITS){
         const ore=miningDraw();a.bonus+=ore.points;recordMiningPoints(p,ore.points);a.counts[ore.id]=(a.counts[ore.id]||0)+1;questProgress(p,'ore',ore.rarity);
         a.lastResult={id:session.id,oreId:ore.id,at:now};session.id=crypto.randomUUID();session.hits=0;session.lastHit=0;
         broadcast({type:'mining-find',playerId:p.id,oreId:ore.id,rarity:ore.rarity,rockId:rock.id,name:ore.name,points:ore.points});announceRareFind(p,ore);
         await saveNow();return json(res,200,{ok:true,result:{...ore},mining:miningView(p)});
        }
        return json(res,200,{ok:true,mining:miningView(p)});
       }
       return json(res,400,{error:'지원하지 않는 광질 요청이에요.'});
      }
      if(url.pathname==='/api/game-presence'){
        if(!playerSessions.get(id)||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
        if(typeof d.playing!=='boolean')return json(res,400,{error:'게임 상태가 올바르지 않아요.'});
        if(Boolean(p.gamePlaying)!==d.playing){p.gamePlaying=d.playing;broadcast({type:'game-presence',id:p.id,playing:p.gamePlaying});}
        return json(res,200,{ok:true,playing:Boolean(p.gamePlaying)});
      }
      if(url.pathname==='/api/decoration'){
       if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서 이용해 주세요.'});
       const command=String(d.command||'status');
       if(command==='status')return json(res,200,{ok:true,decoration:decorationView(p)});
       const kind=String(d.kind||''),item=String(d.item||'');
       if(!Object.prototype.hasOwnProperty.call(DECORATIONS,kind)||!Object.prototype.hasOwnProperty.call(DECORATIONS[kind],item))return json(res,400,{error:'존재하지 않는 꾸미기 아이템이에요.'});
       const r=decorationRecord(p.badgeIdentity),spec=DECORATIONS[kind][item];
       if(command==='buy'&&kind==='trail'&&TRAIL_TEST_FREE){
        r.equipped[kind]=item;
       }else if(command==='buy'){
        if(r.owned[kind][item])return json(res,409,{error:'이미 구매한 아이템이에요.'});
        if(tentPointBalance(p)<spec.cost)return json(res,409,{error:'포인트가 부족해요.'});
        r.owned[kind][item]=true;r.equipped[kind]=item;r.spent+=spec.cost;
       }else if(command==='equip'){
        if(!r.owned[kind][item]&&!(kind==='trail'&&TRAIL_TEST_FREE))return json(res,403,{error:'먼저 구매해 주세요.'});r.equipped[kind]=item;
       }else if(command==='unequip'){
        if(r.equipped[kind]===item)r.equipped[kind]=null;
       }else return json(res,400,{error:'지원하지 않는 꾸미기 요청이에요.'});
       for(const other of players.values())if(other.badgeIdentity===p.badgeIdentity){syncDecoration(other);broadcast({type:'profile',player:other});}
       await saveNow();return json(res,200,{ok:true,decoration:decorationView(p)});
      }
      if(url.pathname==='/api/lottery'){
        if(!p.badgeIdentity||playerSessions.get(id)!==String(d.sessionKey||''))return json(res,403,{error:'본인 세션에서만 복권을 이용할 수 있어요.'});
        const command=String(d.command||'');
        if(command==='state')return json(res,200,{ok:true,lottery:lotteryAccountView(p)});
        const a=lotteryAccount(p.badgeIdentity);
        if(command==='buy'){
          if(!lotteryNearBooth(p))return json(res,403,{error:'복권샵 부스 근처에서 구매할 수 있어요.'});
          if(a.pending)return json(res,409,{error:'먼저 구매한 복권을 긁어주세요.',lottery:lotteryAccountView(p)});
          if(a.used>=LOTTERY_DAILY_LIMIT)return json(res,409,{error:'오늘은 10장을 모두 구매했어요. 한국 시간 자정에 초기화돼요.'});
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
          // v304: Announce only settled ultra/jackpot wins. A duplicate reveal
          // returns above, so it cannot replay the public celebration.
          if(ticket.tier==='ultra'||ticket.tier==='jackpot'){
            const winLabel=ticket.tier==='ultra'?'초고액':'대박';
            broadcast({type:'festival-notice',kind:'lottery-win',id:noticeId(),
              tier:ticket.tier,text:noticeText(`🎆 ${p.name}님이 ${winLabel}에 당첨되셨습니다!`),at:Date.now()});
          }
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
        if(command==='effect-buy'||command==='effect-toggle'){
          const effectId=String(d.effect||''),item=PET_EFFECTS[effectId];
          if(!Object.hasOwn(PET_EFFECTS,effectId))return json(res,400,{error:'존재하지 않는 이펙트예요.'});
          record.effectsOwned||={};record.effectsEnabled||={};
          if(command==='effect-buy'){
            if(record.effectsOwned[effectId])return json(res,409,{error:'이미 구매한 이펙트예요.'});
            if(tentPointBalance(p)<item.cost)return json(res,400,{error:'포인트가 부족해요.'});
            record.spent+=item.cost;record.effectsOwned[effectId]=true;record.effectsEnabled[effectId]=true;
          }else{
            if(!record.effectsOwned[effectId])return json(res,400,{error:'먼저 이펙트를 구매해 주세요.'});
            if(typeof d.enabled!=='boolean')return json(res,400,{error:'이펙트 상태가 올바르지 않아요.'});
            record.effectsEnabled[effectId]=d.enabled;
          }
          syncPetPlayers(p.badgeIdentity);await saveNow();return json(res,200,{ok:true,...petView(p)});
        }
        if(command==='adopt'){
          if(pet)return json(res,409,{error:'이미 펫이 있어요. 기존 펫을 삭제한 후 새 알을 입양할 수 있어요.'});
          if(tentPointBalance(p)<PET_ADOPTION_COST)return json(res,400,{error:`입양 포인트가 부족해요. (${tentPointBalance(p)}/${PET_ADOPTION_COST}P)`});
          const now=Date.now();record.spent+=PET_ADOPTION_COST;
          record.pet={species:PET_SPECIES[crypto.randomInt(PET_SPECIES.length)],color:PET_COLORS[crypto.randomInt(PET_COLORS.length)],adoptedAt:now,hatchAt:now+PET_HATCH_MS,xp:0,summoned:true};
        }else if(command==='recolor'){
          if(!pet)return json(res,400,{error:'먼저 펫을 입양해 주세요.'});
          if(Date.now()<pet.hatchAt)return json(res,400,{error:'펫이 부화한 뒤 색상을 변경할 수 있어요.'});
          const color=String(d.color||'').toLowerCase();
          if(!PET_COLORS.includes(color))return json(res,400,{error:'지원하지 않는 색상이에요.'});
          if(pet.color===color)return json(res,409,{error:'현재 사용 중인 색상이에요.'});
          if(!petColorAvailable(pet.species,color))return json(res,409,{error:'이 색상의 진화 단계별 텍스처가 준비되지 않았어요.'});
          if(tentPointBalance(p)<PET_COLOR_CHANGE_COST)return json(res,400,{error:'색상 변경에 1,000P가 필요해요.'});
          record.spent+=PET_COLOR_CHANGE_COST;pet.color=color;
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
          record.pointBonusStartMinute=Math.floor(badgeTotal(p)/60);
          tentStats.set(p.badgeIdentity,record);
          await saveNow();
          return json(res,200,{ok:true,...tentView(p)});
        }
        if(command==='upgrade'){
          if(!record)return json(res,403,{error:'먼저 텐트를 구매해 주세요.'});
          if(record.upgradeLevel===1)return json(res,409,{error:'이미 첫 번째 확장을 완료했어요.',...tentView(p)});
          if(tentPointBalance(p)<10000)return json(res,400,{error:'포인트가 부족해요. 텐트 확장에는 10,000P가 필요해요.'});
          record.upgradeLevel=1;await saveNow();sendTentUpdate();return json(res,200,{ok:true,...tentView(p)});
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
          const room=[...tentStats.values()].find(t=>t.id===p.tentRoomId),extra=room?.upgradeLevel===1?2:0;p.tentRoomX=clamp(d.x,-4.6-extra,4.6+extra);p.tentRoomZ=clamp(d.z,-3.6-extra,3.6+extra);p.tentRoomFacing=clamp(d.facing,-Math.PI,Math.PI);
          broadcast({type:'tent-room',playerId:p.id,roomId:p.tentRoomId,x:p.tentRoomX,z:p.tentRoomZ,facing:p.tentRoomFacing});
          return json(res,200,{ok:true});
        }
        if(command==='room-action'){
          if(!p.tentRoomId)return json(res,400,{error:'먼저 텐트에 입장해 주세요.'});
          const allowed=['idle','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','dougie','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','beatking','powerking','moleking','fishking','mineking','putyourhandsup','birthday','heartbow','drum','electricguitar','bassguitar','vocal'];
          const action=String(d.action||'idle');
          p.action=allowed.includes(action)&&!(action==='birthday'&&!birthdayActive())&&!(action==='beatking'&&!playerIsRhythmKing(p))&&!(action==='powerking'&&!playerIsPowerKing(p))&&!(action==='moleking'&&!playerIsMoleKing(p))&&!(action==='fishking'&&!playerIsFishKing(p))&&!(action==='mineking'&&!playerIsMineKing(p))?action:'idle';
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
          if(!item||item.enabled===false||(item.colorEnabled===true&&!item.variantColor))return json(res,400,{error:'판매 중인 색상을 선택해 주세요.'});
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
          const supportId=String(d.supportId||'');const placement=furniturePlacement(record,itemId,x,z,rotation,supportId);if(!placement)return json(res,409,{error:'해당 위치는 소품을 배치할 수 없어요.'});
          record.furnishings??=[];record.furnishings.push({instanceId:crypto.randomUUID(),itemId,x:Math.round(x*100)/100,z:Math.round(z*100)/100,rotation,...placement});
          await saveNow();sendTentUpdate();return json(res,200,{ok:true,...furnitureInventoryView(p),room:publicTent(record)});
        }
        if(command==='furniture-remove'){
          if(!record||p.tentRoomId!==record.id)return json(res,403,{error:'텐트 주인만 소품을 회수할 수 있어요.'});
          const found=(record.furnishings||[]).findIndex(x=>x.instanceId===String(d.instanceId||''));
          if(found<0)return json(res,404,{error:'배치된 아이템을 찾지 못했어요.'});
          if(record.furnishings.some(f=>f.supportId===record.furnishings[found].instanceId))return json(res,409,{error:'위에 올린 아이템을 먼저 회수해 주세요.'});
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
      if(url.pathname==='/api/profile'){if(!d.sessionKey||playerSessions.get(id)!==String(d.sessionKey))return json(res,403,{error:'본인 세션에서만 변경할 수 있어요.'});p.name=clean(d.name,18)||'ROCKER';p.color=colors.includes(d.color)?d.color:p.color;p.gender=d.gender==='female'?'female':'male';Object.assign(p,apparel(d,p));if(p.badgeIdentity&&rhythmScores.has(p.badgeIdentity)){const row=rhythmScores.get(p.badgeIdentity);row.name=p.name;rhythmScores.set(p.badgeIdentity,row);broadcastRhythmState();scheduleSave();}if(p.badgeIdentity&&powerScores.has(p.badgeIdentity)){powerScores.get(p.badgeIdentity).name=p.name;broadcast({type:'power-state',power:publicPowerState()});scheduleSave();}syncPlayerRhythmKing(p);syncPlayerPowerKing(p);syncPlayerMoleKing(p);syncPlayerFishKing(p);syncPlayerMineKing(p);setRecoveryProfile(p);broadcast({type:'profile',player:p});return json(res,200,{ok:true,player:p})}
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
        if(d.action==='powerking'&&!playerIsPowerKing(p))d.action='idle';if(d.action==='moleking'&&!playerIsMoleKing(p))d.action='idle';if(d.action==='fishking'&&!playerIsFishKing(p))d.action='idle';if(d.action==='mineking'&&!playerIsMineKing(p))d.action='idle';
        // Validate campfire-only reaction server-side so remote spectators cannot see it outside the zone.
        if(d.action==='marshmallow'){
          const kstHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
          const wx=(p.x-600)*.058,wz=(p.y-500)*.058+8;
          if(!((kstHour>=20||kstHour<3)&&Math.hypot(wx-34,wz-10.5)<=8.8))d.action='idle';
        }

        if(d.action==='birthday'&&!birthdayActive())d.action='idle';
        // The fireworks reaction is available only from 01:00 to 04:00 in Korea.
        if(d.action==='nightfirework'){
          const kstHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
          if(kstHour<1||kstHour>=4)d.action='idle';
        }
        if(d.action==='fishing'&&(!fishingNearSea(p)||!fishingAccount(p.badgeIdentity).active))d.action='idle';
        if(d.action==='mining'&&(!p.badgeIdentity||miningAccount(p.badgeIdentity).active?.playerId!==p.id))d.action='idle';
        p.action=['idle','walk','peace','jump','run','wave','clap','sit','lie','drink','snack','headbang','buriburi','groove','dougie','windmill','skanking','airguitar','headspin','cheer','smoke','bubblegun','freestyle','beatking','powerking','moleking','fishking','mineking','marshmallow','putyourhandsup','nightfirework','birthday','fishing','mining','heartbow','drum','electricguitar','bassguitar','vocal','mosh-charge','slam-charge','slam-retreat','slam-celebrate','circle-run','train-run','row-paddle','toast-clink','surf-rider','surf-support','shoulder-headbang','rock-skank'].includes(d.action)?d.action:'idle';
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
        const entry={id:crypto.randomUUID(),playerId:p.id,name:p.name,message,at:Date.now(),roomId,bubbleStyle:p.cosmetics?.bubble||null};
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
          if(Date.now()>=session.startedAt+MOLE_DELAY_MS+MOLE_DURATION_MS){const result=await commitMoleResult(p.badgeIdentity,session.id);return json(res,200,{ok:true,result,points:tentPointBalance(p)});}
          a.session=null;const timer=moleFinishTimers.get(p.badgeIdentity);if(timer)clearTimeout(timer);moleFinishTimers.delete(p.badgeIdentity);
          await saveNow();return json(res,200,{ok:true});
        }
        if(command==='hit'){
          const index=Number(d.index),hole=Number(d.hole),receivedAt=Date.now(),reportedAt=Number(d.hitAt);
          // Accept a bounded network delay while still checking the server-generated slot and rejecting duplicates.
          const hitAt=Number.isFinite(reportedAt)&&reportedAt>=receivedAt-15000&&reportedAt<=receivedAt+500?reportedAt:receivedAt;
          const elapsed=hitAt-session.startedAt-MOLE_DELAY_MS;
          if(!Number.isInteger(index)||index<0||index>=MOLE_SLOTS||!Number.isInteger(hole)||hole!==session.positions[index])return json(res,400,{error:'잘못된 두더지 위치입니다.'});
          if(elapsed<MOLE_SLOT_STARTS_MS[index]-500||elapsed>MOLE_SLOT_STARTS_MS[index+1]+1000)return json(res,409,{error:'두더지가 이미 사라졌어요.'});
          if(session.hits.includes(index))return json(res,200,{ok:true,score:session.score,combo:session.lastCombo||1,duplicate:true});
          session.hits.push(index);const combo=index===session.lastHit+1?Math.min(10,session.hits.length):1;session.score+=100+combo*10;session.lastHit=index;session.lastCombo=combo;scheduleSave();
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
        if(!p.badgeIdentity||!d.sessionKey||playerSessions.get(id)!==String(d.sessionKey))return json(res,403,{error:'세션 인증이 필요합니다.'});
        const account=powerAccount(p.badgeIdentity);
        if(command==='state')return json(res,200,{power:publicPowerState(),account:powerAccountView(p),best:powerScores.get(p.badgeIdentity)?.score||0});
        if(command==='start'){
          if(p.tentRoomId||Math.hypot((p.x||0)-POWER_BOOTH.x,(p.y||0)-POWER_BOOTH.y)>POWER_BOOTH.radius)return json(res,403,{error:'게임부스 가까이에서만 플레이할 수 있어요.'});
          if(account.used>=POWER_DAILY_COINS)return json(res,409,{error:'오늘의 코인을 모두 사용했어요.'});
          if(account.session&&Date.now()-account.session.startedAt<32000)return json(res,409,{error:'이미 진행 중인 게임이 있어요.'});
          const events=[];for(let spawn=500;spawn<28000;spawn+=450){const roll=crypto.randomInt(100),kind=roll<17?'spoiled':roll<32?'special':'normal',duration=kind==='special'?700:kind==='spoiled'?1350:1500;events.push({id:events.length,kind,x:(80+crypto.randomInt(841))/1000,spawn,duration});}
          account.used++;account.session={id:crypto.randomUUID(),startedAt:Date.now(),events};await saveNow();return json(res,200,{ok:true,playId:account.session.id,startedAt:account.session.startedAt,serverNow:Date.now(),duration:30000,events,account:powerAccountView(p)});
        }
        if(command==='finish'){
          const game=account.session;if(account.lastResult?.id===String(d.playId||''))return json(res,200,{ok:true,score:account.lastResult.score,prize:account.lastResult.prize,points:tentPointBalance(p),best:powerScores.get(p.badgeIdentity)?.score||account.lastResult.score,account:powerAccountView(p),power:publicPowerState()});if(!game||!Array.isArray(game.events)||game.id!==String(d.playId||''))return json(res,409,{error:'진행 중인 게임을 찾을 수 없어요.'});
          const elapsed=Date.now()-game.startedAt;if(elapsed<29500)return json(res,409,{error:'아직 게임이 진행 중이에요.'});
          if(!Array.isArray(d.hits)||d.hits.length>game.events.length)return json(res,400,{error:'게임 기록이 올바르지 않아요.'});
          let score=0;const seen=new Set();for(const hit of d.hits){const i=Number(hit.id),x=Number(hit.x),t=Number(hit.t);if(!Number.isInteger(i)||i<0||i>=game.events.length||seen.has(i)||!Number.isFinite(x)||!Number.isFinite(t))return json(res,400,{error:'게임 기록이 올바르지 않아요.'});const e=game.events[i],landing=e.spawn+e.duration;if(Math.abs(t-landing)>350||Math.abs(x-e.x)>.105)return json(res,400,{error:'피자를 받은 위치가 올바르지 않아요.'});seen.add(i);score=Math.max(0,score+(e.kind==='special'?300:e.kind==='spoiled'?-100:100));}
          const prize=score>=4000?50:score>=2500?30:score>=1000?10:1;account.lastResult={id:game.id,score,prize};account.session=null;account.bonus+=prize;const best=powerScores.get(p.badgeIdentity);if(!best||score>best.score)powerScores.set(p.badgeIdentity,{name:p.name,score,at:Date.now()});await saveNow();broadcast({type:'power-state',power:publicPowerState()});return json(res,200,{ok:true,score,prize,points:tentPointBalance(p),best:powerScores.get(p.badgeIdentity)?.score||score,account:powerAccountView(p),power:publicPowerState()});
        }return json(res,400,{error:'지원하지 않는 피자왕 명령입니다.'});
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
        settleBadge(p);clearDuosFor(id);clearMiningPlayer(p);players.delete(id);forgetSession(id);voterLeaves(id);
        if(activeSlam?.participants.delete(id))slamUpdate();rockMemberLeaves(id);pauseForEmpty();
        clients.get(id)?.end();clients.delete(id);broadcast({type:'leave',id,count:players.size});sendTentUpdate();return json(res,200,{ok:true})
      }
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,400,{error:e.message})}
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return json(res,400,{error:'Invalid path'})}
  const f=path.resolve(PUBLIC,'.'+(pathname==='/'?'/index.html':pathname));if(!f.startsWith(PUBLIC+path.sep))return json(res,403,{error:'Forbidden'});
  if(pathname==='/md-admin.html'){try{const html=fs.readFileSync(f,'utf8').replace('</head>','<script src="/chair-admin.js?v=371"></script></head>');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});return res.end(html);}catch{}}
  fs.stat(f,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});fs.createReadStream(f).pipe(res)})
});
restorePlaylist().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`ONEseason running at http://localhost:${PORT} | storage: ${useSupabase?'Supabase':'local only'}`))).catch(err=>{console.error('Startup stopped to prevent playlist data loss:',err.message);process.exitCode=1});
