'use strict';
// Pure race rules. Integrating this module does not charge or pay any account.
const crypto=require('crypto');
const COSTS=new Set([500,1000]);
function calculatePayouts(count,stake){
 if(!Number.isInteger(count)||count<3||count>5||!COSTS.has(stake))throw Error('경주 조건이 올바르지 않습니다.');
 const pool=count*stake,fee=pool/10,available=pool-fee;
 const prizes=[available*6/10,available*3/10,available/10];
 if(!prizes.every(Number.isInteger))throw Error('포인트 정산이 정수가 아닙니다.');
 return {pool,fee,prizes};
}
function secureOrder(entrants){
 if(!Array.isArray(entrants)||entrants.length<3||entrants.length>5||new Set(entrants).size!==entrants.length)throw Error('경주 참가자가 올바르지 않습니다.');
 const order=entrants.slice();for(let i=order.length-1;i>0;i--){const j=crypto.randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}return order;
}
// Simulate every second on the server. The resulting positions are the single
// source of truth for all viewers, camera positions, standings and payouts.
function createRacePlan(entrants,stake){
 const settlement=calculatePayouts(entrants.length,stake);secureOrder(entrants);
 const kinds=['stumble','stone','missile','shock','boost'];
 for(let attempt=0;attempt<80;attempt++){
  const targetSeconds=111+crypto.randomInt(6),base=1/targetSeconds;
  const runners=entrants.map(id=>({id,distance:0,finish:null,speed:base*(.98+crypto.randomInt(41)/1000),effectUntil:0,multiplier:1}));
  const keyframes=[runners.map(()=>0)],events=[];let nextEvent=7+crypto.randomInt(6);
  for(let second=1;second<=150;second++){
   if(second===nextEvent&&runners.some(r=>r.finish===null)){
    const live=runners.filter(r=>r.finish===null);const actor=live[crypto.randomInt(live.length)];let kind=kinds[crypto.randomInt(kinds.length)];
    const ahead=live.filter(r=>r.id!==actor.id&&r.distance>actor.distance+.001);if(['stone','missile','shock'].includes(kind)&&!ahead.length)kind='boost';
    const target=['stone','missile','shock'].includes(kind)?ahead[crypto.randomInt(ahead.length)]:actor;
    const hitSecond=second+(['stone','missile'].includes(kind)?1:0),length=kind==='boost'?4:kind==='shock'?4:3;
    const multiplier=kind==='boost'?1.75:kind==='shock'?.4:.18;
    target.effectStart=hitSecond;target.effectUntil=hitSecond+length;target.multiplier=multiplier;
    events.push({ms:second*1000,hitMs:hitSecond*1000,kind,actor:actor.id,target:target.id});nextEvent=second+6+crypto.randomInt(6);
   }
   for(const r of runners){if(r.finish!==null)continue;const before=r.distance;const multiplier=r.effectStart<=second&&second<r.effectUntil?r.multiplier:1,step=r.speed*multiplier;r.distance=Math.min(1,r.distance+step);if(r.distance>=1)r.finish=(second-1+(1-before)/step)*1000;}
   keyframes.push(runners.map(r=>Number(r.distance.toFixed(6))));
   if(runners.every(r=>r.finish!==null))break;
  }
  if(runners.some(r=>r.finish===null))continue;
  const duration=(keyframes.length-1)*1000;if(duration<110000||duration>130000)continue;
  const order=[...runners].sort((a,b)=>a.finish-b.finish||entrants.indexOf(a.id)-entrants.indexOf(b.id)).map(r=>r.id);
  return {duration,order,events,settlement,keyframes,finishTimes:runners.map(r=>Math.round(r.finish)),intervalMs:1000};
 }
 throw Error('경주를 준비하지 못했어요. 다시 시도해 주세요.');
}
module.exports={calculatePayouts,secureOrder,createRacePlan};
