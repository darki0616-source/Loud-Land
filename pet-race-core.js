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
function createRacePlan(entrants,stake){
 const settlement=calculatePayouts(entrants.length,stake),order=secureOrder(entrants),duration=180000+crypto.randomInt(60001);
 // Events are a visual timeline only; outcomes are fixed independently and kept server-side.
 const kinds=['stumble','stone','missile','shock','boost'],events=[];
 for(let ms=8000;ms<duration-10000;ms+=7000+crypto.randomInt(6001)){
  let kind=kinds[crypto.randomInt(kinds.length)];const actor=entrants[crypto.randomInt(entrants.length)],finish=id=>duration-(order.length-1-order.indexOf(id))*800;
  const possible=entrants.filter(x=>x!==actor&&ms/finish(x)>ms/finish(actor));if(['stone','missile','shock'].includes(kind)&&!possible.length)kind='boost';
  const target=['stone','missile','shock'].includes(kind)?possible[crypto.randomInt(possible.length)]:actor;events.push({ms,kind,actor,target});
 }
 return {duration,order,events,settlement};
}
module.exports={calculatePayouts,secureOrder,createRacePlan};
