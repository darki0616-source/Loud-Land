'use strict';
const {createRacePlan}=require('./pet-race-core');
class PetRaceEngine {
 constructor(){this.race=null;}
 join({identity,name,pet},stake){
  if(!identity||!pet?.hatched||!pet.species)throw Error('부화한 펫이 필요합니다.');
  if(stake!==500&&stake!==1000)throw Error('참가비를 선택해 주세요.');
  let r=this.race;if(!r||r.phase==='finished')this.race=r={phase:'waiting',host:identity,participants:[],spectators:[]};
  if(r.phase!=='waiting')throw Error('이미 경주가 시작됐습니다.');
  let item=r.participants.find(p=>p.identity===identity);
  if(!item){if(r.participants.length>=5)throw Error('참가 인원이 가득 찼습니다.');item={identity,name,pet,stake};r.participants.push(item);}else item.stake=stake;
  r.spectators=r.spectators.filter(x=>x!==identity);return this.view(identity);
 }
 watch(identity){const r=this.race;if(!r||r.phase!=='waiting')throw Error('경주가 시작되기 전에 입장해야 합니다.');if(!r.spectators.includes(identity)&&!r.participants.some(p=>p.identity===identity))r.spectators.push(identity);return this.view(identity);}
 leave(identity){const r=this.race;if(!r||r.phase!=='waiting')return; r.participants=r.participants.filter(p=>p.identity!==identity);r.spectators=r.spectators.filter(x=>x!==identity);if(!r.participants.length){this.race=null;return;}if(r.host===identity)r.host=r.participants[0].identity;}
 start(identity,balances,now=Date.now()){
  const r=this.race;if(!r||r.phase!=='waiting'||r.host!==identity)throw Error('첫 참가자만 시작할 수 있습니다.');
  if(r.participants.length<3||r.participants.length>5)throw Error('참가자는 3~5명이어야 합니다.');
  const stake=r.participants[0].stake;if(!r.participants.every(p=>p.stake===stake))throw Error('모든 참가자가 같은 참가비를 선택해야 합니다.');
  if(!r.participants.every(p=>Number.isSafeInteger(balances[p.identity])&&balances[p.identity]>=stake))throw Error('포인트가 부족한 참가자가 있습니다.');
  const plan=createRacePlan(r.participants.map(p=>p.identity),stake);Object.assign(r,{phase:'running',stake,startAt:now,finishAt:now+plan.duration,plan});return {charges:r.participants.map(p=>({identity:p.identity,amount:stake})),view:this.view(identity)};
 }
 settle(now=Date.now()){
  const r=this.race;if(!r||r.phase!=='running'||now<r.finishAt)return null;
  const awards=r.plan.order.map((identity,i)=>({identity,name:r.participants.find(p=>p.identity===identity)?.name||'참가자',rank:i+1,amount:r.plan.settlement.prizes[i]||0}));r.resultAudience=[...new Set([...r.participants.map(p=>p.identity),...r.spectators])];r.phase='finished';r.awards=awards;r.participants=[];r.spectators=[];r.host=null;return {awards,fee:r.plan.settlement.fee};
 }
 view(identity){const r=this.race;if(!r)return null;const allowed=r.phase==='waiting'||r.host===identity||r.participants.some(p=>p.identity===identity)||r.spectators.includes(identity)||(r.phase==='finished'&&(r.resultAudience||[]).includes(identity));if(!allowed)throw Error('경주 시작 전에 입장한 사람만 볼 수 있습니다.');return {phase:r.phase,host:r.phase==='waiting'&&r.host===identity,viewer:r.spectators.includes(identity),participants:r.phase==='finished'?[]:r.participants.map(p=>({name:p.name,pet:p.pet,stake:p.stake,isMe:p.identity===identity})),startAt:r.startAt,finishAt:r.finishAt,serverNow:Date.now(),order:r.phase==='running'?r.plan.order.map(id=>r.participants.findIndex(p=>p.identity===id)):[],keyframes:r.phase==='running'?r.plan.keyframes||null:null,intervalMs:r.plan?.intervalMs||1000,finishTimes:r.phase==='running'?r.plan.finishTimes||null:null,events:r.phase==='running'?r.plan.events.map(e=>({ms:e.ms,hitMs:e.hitMs??e.ms,kind:e.kind,actor:r.participants.findIndex(p=>p.identity===e.actor),target:r.participants.findIndex(p=>p.identity===e.target)})):[],awards:r.phase==='finished'?r.awards.map(a=>({name:a.name||r.participants.find(p=>p.identity===a.identity)?.name||'참가자',rank:a.rank,amount:a.amount})):[]};}
}
module.exports={PetRaceEngine};
