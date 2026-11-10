// v259: separate GLB upload tab, reusing the existing MD_ADMIN_KEY and Storage.
const byId=id=>document.getElementById(id);
const tab=byId('moleTab'),section=byId('moleSection');
if(tab){tab.onclick=()=>{byId('mdSection').hidden=true;byId('furnitureSection').hidden=true;section.hidden=false;for(const b of document.querySelectorAll('.admin-tabs button'))b.classList.toggle('active',b===tab);};
 for(const id of ['mdTab','furnitureTab'])byId(id)?.addEventListener('click',()=>{section.hidden=true;tab.classList.remove('active');});
}
byId('moleUpload')?.addEventListener('click',async()=>{
 const file=byId('moleGlb').files[0],key=byId('key').value,status=byId('moleAdminStatus'),button=byId('moleUpload');
 if(!file||!file.name.toLowerCase().endsWith('.glb')){status.textContent='GLB 파일을 선택해 주세요.';return;}
 if(file.size>12*1024*1024){status.textContent='12MB 이하 GLB만 업로드할 수 있어요.';return;}
 button.disabled=true;status.textContent='업로드 중...';
 try{
  const r=await fetch('/api/tent-item-admin/model/mole-hammer',{method:'PUT',headers:{'content-type':'model/gltf-binary','x-md-admin-key':key},body:file});
  const uploaded=await r.json();if(!r.ok)throw Error(uploaded.error||'업로드 실패');
  const saved=await fetch('/api/mole-admin',{method:'POST',headers:{'content-type':'application/json','x-md-admin-key':key},body:JSON.stringify({command:'save-hammer',revision:uploaded.revision})});
  const d=await saved.json();if(!saved.ok)throw Error(d.error||'모델 등록 실패');
  status.textContent='등록 완료. 새로 접속한 유저부터 새 망치가 보이고, 현재 접속자도 모델을 다시 불러옵니다.';
 }catch(e){status.textContent='오류: '+e.message;}finally{button.disabled=false;}
});
