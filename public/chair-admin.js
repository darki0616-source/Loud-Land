(()=>{
 let catalog={};const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  let url='';try{url=typeof input==='string'?input:input.url}catch{}
  if(url.includes('/api/tent-item-admin')&&!url.includes('/model/')&&typeof options.body==='string'){
   try{const body=JSON.parse(options.body);if(body.command==='save'){const check=document.getElementById('furnitureChairEnabled'),height=document.getElementById('furnitureChairSeatHeight');if(check){body.chairEnabled=check.checked;body.chairSeatHeight=height.value.trim()?Number(height.value):null;body.colorEnabled=document.getElementById('furnitureColorEnabled')?.checked===true;options={...options,body:JSON.stringify(body)};}}}catch{}
   const result=await nativeFetch(input,options);try{const data=await result.clone().json();if(data.items)catalog=data.items}catch{}return result;
  }
  return nativeFetch(input,options);
 };
 function setValues(){const id=document.getElementById('furnitureId')?.value||'',item=catalog[id]||{};const check=document.getElementById('furnitureChairEnabled'),height=document.getElementById('furnitureChairSeatHeight');if(check){check.checked=item.chairEnabled===true;height.value=item.chairSeatHeight==null?'':item.chairSeatHeight;}const color=document.getElementById('furnitureColorEnabled');if(color)color.checked=item.colorEnabled===true;}
 function init(){const bed=document.getElementById('furnitureBedEnabled');if(!bed)return;const label=document.createElement('label');label.className='checklabel';label.innerHTML='<input id="furnitureChairEnabled" type="checkbox"> 🪑 의자로 사용 (클릭하여 앉기)';const title=document.createElement('label');title.htmlFor='furnitureChairSeatHeight';title.textContent='의자 앉는 면 높이 · 가구 바닥에서부터 (선택)';const input=document.createElement('input');input.id='furnitureChairSeatHeight';input.type='number';input.min='0.05';input.max='8';input.step='0.01';input.placeholder='비우면 전체 높이의 50%';const hint=document.createElement('small');hint.textContent='좌석과 등받이가 있는 의자는 실제 앉는 면의 높이를 입력해 주세요.';bed.closest('label').before(label,title,input,hint);const colorLabel=document.createElement('label');colorLabel.className='checklabel';colorLabel.innerHTML='<input id="furnitureColorEnabled" type="checkbox"> 🎨 구매 시 색상 선택 (기본 텍스처를 색상 재질로 교체)';hint.after(colorLabel);
  document.getElementById('furnitureList')?.addEventListener('click',()=>setTimeout(setValues,0));document.getElementById('furnitureNew')?.addEventListener('click',()=>setTimeout(setValues,0));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
