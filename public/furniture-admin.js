import * as THREE from 'https://esm.sh/three@0.160.1';
import {GLTFLoader} from 'https://esm.sh/three@0.160.1/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls.js';

const el=id=>document.getElementById(id);
let catalog={},selectedId='',previewUrl='',renderer,scene,camera,controls,previewModel,previewTicket=0,loading=false;
const status=(text,error=false)=>{el('furnitureStatus').textContent=text;el('furnitureStatus').classList.toggle('error',error)};
async function request(command,data={}){
 const response=await fetch('/api/tent-item-admin',{method:'POST',headers:{'content-type':'application/json','x-md-admin-key':el('key').value},body:JSON.stringify({command,...data})});
 const body=await response.json();if(!response.ok)throw Error(body.error||'관리 요청이 실패했어요.');return body;
}
function uiTabs(selected){el('mdSection').hidden=selected!=='md';el('furnitureSection').hidden=selected!=='furniture';el('mdTab').classList.toggle('active',selected==='md');el('furnitureTab').classList.toggle('active',selected==='furniture')}
el('mdTab').addEventListener('click',()=>uiTabs('md'));
el('furnitureTab').addEventListener('click',async()=>{uiTabs('furniture');if(!Object.keys(catalog).length)await loadFurniture()});
function inventoryRows(){const root=el('furnitureList');root.replaceChildren();for(const [id,item] of Object.entries(catalog)){
 const b=document.createElement('button');b.type='button';b.classList.toggle('active',id===selectedId);
 const title=document.createElement('b');title.textContent=item.name+' · '+item.cost.toLocaleString()+'P';
 const info=document.createElement('small');info.textContent=id+' · '+item.width+'×'+item.depth+'×'+item.height+(item.enabled===false?' · 판매 중지':' · 판매 중')+(item.bundled?' · 기본 상품':'');
 b.append(title,info);b.onclick=()=>selectFurniture(id);root.append(b);
}if(!Object.keys(catalog).length)root.textContent='등록된 상품이 없어요.'}
async function loadFurniture(){try{const d=await request('list');catalog=d.items||{};el('furnitureStorageHint').textContent=d.storage==='supabase'?'업로드 저장소: Supabase Storage (영구 저장)':'업로드 저장소: 서버 로컬 파일 (Render 재배포 시 삭제될 수 있음)';inventoryRows();status('인테리어 상품 목록을 불러왔어.');}
catch(e){status(e.message,true)}}
function reset(){selectedId='';el('furnitureFormTitle').textContent='새 아이템 등록';el('furnitureId').readOnly=false;el('furnitureId').value='';el('furnitureName').value='';el('furnitureCost').value=500;el('furnitureWidth').value=1;el('furnitureDepth').value=1;el('furnitureHeight').value=1;el('furnitureDescription').value='';el('furnitureEnabled').checked=true;el('furnitureModel').value='';el('furnitureDelete').hidden=true;inventoryRows();setPreview('')}
el('furnitureNew').onclick=reset;el('furnitureRefresh').onclick=loadFurniture;
function selectFurniture(id){const item=catalog[id];if(!item)return;
 selectedId=id;el('furnitureFormTitle').textContent=item.name+' 수정';el('furnitureId').readOnly=true;el('furnitureId').value=id;el('furnitureName').value=item.name;el('furnitureCost').value=item.cost;el('furnitureWidth').value=item.width;el('furnitureDepth').value=item.depth;el('furnitureHeight').value=item.height;el('furnitureDescription').value=item.description||'';el('furnitureEnabled').checked=item.enabled!==false;el('furnitureModel').value='';el('furnitureDelete').hidden=item.bundled;inventoryRows();setPreview(item.asset);}
function setupPreview(){if(renderer)return;
 const canvas=el('furniturePreview');renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.setSize(460,290,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
 scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x647387,2.5));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,4);scene.add(light);
 camera=new THREE.PerspectiveCamera(38,460/290,.01,100);camera.position.set(2.2,1.8,3.2);
 controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=true;controls.autoRotate=true;controls.autoRotateSpeed=1.1;
 const run=()=>{requestAnimationFrame(run);if(el('furnitureSection').hidden)return;controls.update();renderer.render(scene,camera)};run();
}
async function setPreview(url){const ticket=++previewTicket;
 if(previewModel){scene?.remove(previewModel);previewModel=null}if(!url)return;
 try{setupPreview();const gltf=await new GLTFLoader().loadAsync(url);if(ticket!==previewTicket)return;
 const object=gltf.scene;const bounds=new THREE.Box3().setFromObject(object);const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const scale=1.7/Math.max(size.x,size.y,size.z,0.01);object.scale.setScalar(scale);object.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
 scene.add(object);previewModel=object;controls.target.set(0,.8,0);camera.position.set(2.5,1.7,3.4);controls.update();status('3D 미리보기를 불러왔어.');
 }catch(e){status('미리보기 오류: '+e.message,true)}
}
el('furnitureModel').addEventListener('change',()=>{const file=el('furnitureModel').files?.[0];if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}
 if(!file){if(selectedId)setPreview(catalog[selectedId].asset);return}
 if(file.size>12*1024*1024){el('furnitureModel').value='';return status('GLB 최대 크기는 12MB야. 파일을 최적화해 줘.',true)}
 if(!file.name.toLowerCase().endsWith('.glb')){el('furnitureModel').value='';return status('.glb 파일만 선택할 수 있어.',true)}
 previewUrl=URL.createObjectURL(file);setPreview(previewUrl);
});
el('furnitureSave').onclick=async()=>{
 if(loading)return;
 const id=el('furnitureId').value.trim(),name=el('furnitureName').value.trim();
 if(!/^[a-z0-9_-]{1,32}$/.test(id))return status('ID는 영문 소문자·숫자·-·_로 1~32자 입력해 줘.',true);
 const fields={id,name,cost:Number(el('furnitureCost').value),width:Number(el('furnitureWidth').value),depth:Number(el('furnitureDepth').value),height:Number(el('furnitureHeight').value),description:el('furnitureDescription').value.trim(),enabled:el('furnitureEnabled').checked};
 if(!name||![fields.width,fields.depth,fields.height].every(x=>Number.isFinite(x)&&x>=.1&&x<=8)||!Number.isInteger(fields.cost)||fields.cost<0||fields.cost>50000)return status('이름·가격·크기를 확인해 줘.',true);
 const file=el('furnitureModel').files?.[0];if(!catalog[id]&&!file)return status('새 아이템은 GLB 파일을 선택해야 해.',true);
 loading=true;el('furnitureSave').disabled=true;
 try{
  if(file){status('GLB 업로드 중...');const response=await fetch('/api/tent-item-admin/model/'+id,{method:'PUT',headers:{'x-md-admin-key':el('key').value,'content-type':'model/gltf-binary'},body:file});const payload=await response.json();if(!response.ok)throw Error(payload.error||'GLB 업로드 실패');fields.modelRevision=payload.revision;}
  status('상품 정보 저장 중...');const d=await request('save',fields);catalog=d.items||{};selectFurniture(id);status('저장 완료! 게임 상점에 반영됐어.');
 }catch(e){status(e.message,true)}finally{loading=false;el('furnitureSave').disabled=false}
};
el('furnitureDelete').onclick=async()=>{
 const id=selectedId;if(!id||!confirm('정말 '+(catalog[id]?.name||id)+'을(를) 삭제할까? 기존 구매자가 있으면 삭제할 수 없어.'))return;
 try{const d=await request('delete',{id});catalog=d.items||{};reset();status('아이템을 삭제했어.')}catch(e){status(e.message,true)}
};
// The existing MD login button also refreshes the furniture list.
el('load').addEventListener('click',()=>{if(!el('furnitureSection').hidden)loadFurniture()});
reset();
