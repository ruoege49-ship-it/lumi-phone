import * as M from './model.mjs';
import {PhoneStore,importMedia,blobBase64} from './storage.mjs';
import {callService,connectionFromJSON,endpoint} from './api.mjs';
import {saveJSON} from './platform.mjs';
import {GenerationEngine} from './engine.mjs';
import {PhoneNavigation,overlayRoutes} from './navigation.mjs';
import {renderPanel,esc,icon,btn,field,meta,avatar,tasksHTML,liveRoles,roleName} from './views.mjs';

const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const store=new PhoneStore(),dialog=$('#sheet'),audio=$('#audio');
const navigation=new PhoneNavigation(),draftInputs=new Map(),sendingChats=new Set();
let state,route=null,currentChatId=null,currentChatKey=null,toastTimer,preview=null,importBundle=null;
let homePage=0,mediaLoad=0,audioScope=null,audioTrack=null,audioReady=false,lastPlayedAt=0,playedSeconds=0,lastAudioSave=0;
let recorder=null,recordStream=null,recordTimer=null,recordedMedia=null,recordTarget=null;
const speechJobs=new Set();
window.lumiBack=()=>{const viewer=document.querySelector('.image-viewer[open]');if(viewer){viewer.close();return true;}if(!$('#chat-tools').hidden){toggleChatTools(false);return true;}if(navigation.canBack){close();return true;}if(homePage!==0){goPage(0);return true;}return false;};
window.lumiPause=()=>{if(recorder?.state==='recording')recorder.stop();audio.pause();whenError(savePlayback)();};
const key=()=>M.activeKey(state),scope=()=>M.scopeFor(state),role=()=>M.activeRole(state);
const engine=new GenerationEngine(store,callService,(next,error)=>{if(error)toast(error.message);if(next){state=next;renderHome();if(!$('#chat-view').hidden)renderMessages();if(route&&['chats','moments','diary','memories','tasks'].includes(route.name)&&!panelBody(route).contains(document.activeElement?.closest('form')))paintPanel();}});
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
async function commit(fn){const result=await store.commit(fn);state=result.state;renderHome();return result.value;}
const whenError=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>toast(error.message||'操作没有保存，请重试'));
function formatTime(seconds){seconds=Math.floor(Number.isFinite(seconds)?seconds:0);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function hasActive(){if(liveRoles(state).length)return true;show('roles');toast('添加联系人后就能一起互动');return false;}
async function hydrate(root=document){for(const img of $$('[data-media]',root)){const mid=img.dataset.media,media=state.media.find(m=>m.id===mid);const url=await store.mediaURL(media);if(img.isConnected&&img.dataset.media===mid&&url)img.src=url;}}
function renderHome(){
  const a=preview||state.phone.appearance;
  document.documentElement.dataset.theme=a.theme;document.documentElement.dataset.blur=String(a.blur);document.documentElement.dataset.largeText=String(a.fontScale>1);document.documentElement.style.setProperty('--font-scale',a.fontScale);
  $$('[data-character-name]').forEach(el=>el.textContent=state.user.name||'我');
  $$('[data-avatar]').forEach(el=>{el.dataset.media=state.user.avatar||'builtin-birds';el.alt='我的头像';});
  $('#home-role-world').textContent='我的资料 · 头像与称呼';
  $('#music-widget').hidden=!a.music;
  const wallpaperId=a.wallpaper;store.mediaURL(state.media.find(m=>m.id===wallpaperId)).then(url=>{if((preview||state.phone.appearance).wallpaper===wallpaperId&&url)$('.wallpaper').style.backgroundImage=`url(${JSON.stringify(url)})`;});
  const backgroundId=a.chatBackground;if(backgroundId)store.mediaURL(state.media.find(m=>m.id===backgroundId)).then(url=>{if(url&&(preview||state.phone.appearance).chatBackground===backgroundId)$('#chat-view').style.background=`var(--soft) url(${JSON.stringify(url)}) center/cover`;});else $('#chat-view').style.background='';
  const song=state.media.find(m=>m.id===scope()?.playback.trackId);$('#home-song-title').textContent=song?.name||'午后片刻';
  const listening=scope()?.listening.find(l=>!l.endedAt);$('#home-listening-label').textContent=listening?'与 '+listening.participants.map(cid=>roleName(state,cid)).join('、')+' 一起听':'音乐与一起听';
  const unread=scope()?.chats.reduce((sum,c)=>sum+c.messages.filter(m=>!m.deleted&&m.authorId!=='user'&&m.at>c.readAt).length,0)||0;
  const chatButton=$('.home-apps [data-action="chat"]');chatButton.setAttribute('aria-label',unread?`消息，${unread}条未读`:'消息');
  hydrate();
}
function refreshClock(){
  const now=new Date();$('#home-clock').textContent=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});$('#home-clock').dateTime=now.toISOString();
  $('#today-label').textContent=`${now.getMonth()+1}月${now.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][now.getDay()]}`;$('#year-label').textContent=now.getFullYear();
  const monday=new Date(now);monday.setDate(now.getDate()-(now.getDay()+6)%7);
  $('#week-strip').innerHTML=['一','二','三','四','五','六','日'].map((label,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return `<li class="${M.localDate(d)===M.localDate(now)?'today':''}"><span>${label}</span>${d.getDate()}</li>`;}).join('');
}
function formDraftKey(){return route?`${route.name}:${route.id||'new'}`:'';}
const panelBody=entry=>$(overlayRoutes.has(entry.name)?'#sheet-body':'#page-body');
const inputKey=(skey,cid)=>`${skey}:${cid}`;
function captureView(entry=navigation.current){
  if(entry.name==='home')return;
  if(entry.name==='conversation'){
    entry.view={scroll:$('#message-list').scrollTop};
    return;
  }
  const body=panelBody(entry),focus=document.activeElement;
  entry.view={scroll:body.scrollTop,fields:$$('input,textarea,select',body).map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked})),details:$$('details',body).map(el=>el.open)};
  if(body.contains(focus))entry.view.focus={id:focus.id,name:focus.name,start:focus.selectionStart,end:focus.selectionEnd};
}
function restoreView(entry,body){
  const view=entry.view;if(!view)return;
  const fields=$$('input,textarea,select',body);
  for(const [i,saved] of (view.fields||[]).entries()){
    const el=fields[i];if(!el||el.id!==saved.id||el.name!==saved.name||el.type==='file')continue;
    if(el.type==='checkbox'||el.type==='radio')el.checked=saved.checked;else el.value=saved.value;
  }
  $$('details',body).forEach((el,i)=>{if(i<(view.details||[]).length)el.open=view.details[i];});
  body.scrollTop=view.scroll||0;
}
function leaveView(){
  captureView();toggleChatTools(false);
  if(preview){preview=null;renderHome();}
  if(navigation.current.name==='record'&&recorder?.state==='recording')recorder.stop();
}
function show(name,extra={}){
  leaveView();const next=navigation.go({name,key:key(),...extra});if(extra.values)delete next.view;renderNavigation();
}
function paintPanel(preserve=true,entry=route){
  if(!entry)return;if(preserve)captureView(entry);
  const overlay=overlayRoutes.has(entry.name),prefix=overlay?'sheet':'page',body=panelBody(entry);
  const {title,kicker,html,actions=''}=renderPanel(state,entry);$(`#${prefix}-title`).textContent=title;$(`#${prefix}-kicker`).textContent=kicker||'';body.innerHTML=html;
  if(!overlay)$('#page-actions').innerHTML=actions;
  const draft=state.scopes[entry.key]?.drafts[`${entry.name}:${entry.id||'new'}`];if(draft){for(const el of $$('form [name]',body)){if(!(el.name in draft))continue;if(el.type==='checkbox')el.checked=Array.isArray(draft[el.name])?draft[el.name].includes(el.value):!!draft[el.name];else el.value=draft[el.name];}}
  restoreView(entry,body);syncFormMedia(body);hydrate(body);if(entry.name==='music')updateAudio();
  if(preserve&&entry.view?.focus){const f=entry.view.focus,el=$$('input,textarea,select',body).find(el=>f.id?el.id===f.id:el.name===f.name);if(el){el.focus({preventScroll:true});if(typeof f.start==='number'&&el.setSelectionRange&&['text','search','url','password','textarea'].includes(el.type))el.setSelectionRange(f.start,f.end);}}
}
function renderNavigation(){
  const current=navigation.current,page=navigation.page,overlay=overlayRoutes.has(current.name);
  route=['home','conversation'].includes(current.name)?null:current;
  if(!overlay&&dialog.open)dialog.close();
  $('#home-view').hidden=page.name!=='home';$('#chat-view').hidden=page.name!=='conversation';$('#app-view').hidden=['home','conversation'].includes(page.name);
  for(const el of $$('.phone > .view'))el.inert=overlay;
  if(page.name==='conversation'){
    const chat=state.scopes[page.key]?.chats.find(c=>c.id===page.id);if(!chat){home();return;}
    currentChatId=page.id;currentChatKey=page.key;
    $('#message-input').value=draftInputs.get(inputKey(page.key,page.id))??chat.draft;
    $('#draft-status').textContent=$('#message-input').value?'草稿已保存':'对话保存在本机';
    renderMessages();fitInput();
    requestAnimationFrame(()=>{if(navigation.page===page)$('#message-list').scrollTop=page.view?.scroll??$('#message-list').scrollHeight;});
  }else if(page.name==='home')requestAnimationFrame(()=>goPage(homePage,false));
  else paintPanel(false,page);
  if(overlay){paintPanel(false,current);if(!dialog.open)dialog.showModal();}
  else if(page.name!=='home')requestAnimationFrame(()=>$(page.name==='conversation'?'#chat-name':'#page-title').focus({preventScroll:true}));
}
function close(){leaveView();if(navigation.back())renderNavigation();}
dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
$('#close-sheet').addEventListener('click',close);
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
function home(){leaveView();navigation.reset();renderHome();renderNavigation();}
async function openChat(chatId,chatKey=key(),jumpId=null){
  leaveView();
  if(navigation.current.name==='home')navigation.go({name:'chats',key:chatKey});
  navigation.go({name:'conversation',id:chatId,key:chatKey});renderNavigation();
  if(jumpId){requestAnimationFrame(()=>{const el=document.getElementById(`msg-${jumpId}`);el?.scrollIntoView({block:'center'});el?.classList.add('highlight');});}
}
const seenMessages=new IntersectionObserver(entries=>{
  if($('#chat-view').hidden||dialog.open)return;
  const newest=Math.max(0,...entries.filter(e=>e.isIntersecting).map(e=>Number(e.target.dataset.at)||0));
  const skey=currentChatKey,cid=currentChatId,c=state?.scopes[skey]?.chats.find(c=>c.id===cid);
  if(c&&newest>c.readAt)whenError(()=>commit(s=>{const chat=s.scopes[skey].chats.find(c=>c.id===cid);chat.readAt=Math.max(chat.readAt,newest);} ))();
},{root:$('#message-list'),threshold:.1});
function renderMessages(){
  const s=state.scopes[currentChatKey],chat=s?.chats.find(c=>c.id===currentChatId);if(!chat)return;
  $('#chat-name').textContent=chat.name||roleName(state,chat.members[0]);$('#chat-avatar').dataset.media=state.roles.find(r=>r.id===chat.members[0])?.avatar||'builtin-flowers';
  $('#chat-status').textContent=chat.kind==='group'?`${chat.members.length} 位角色`:(state.roles.find(r=>r.id===chat.members[0])?.relation||'私聊');
  $('#chat-api-hint').hidden=!!(state.connections.text.baseUrl&&state.connections.text.model);
  const list=$('#message-list'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
  list.innerHTML=chat.messages.filter(m=>!m.deleted).map(m=>`<article class="message ${m.authorId==='user'?'sent':'received'}" id="msg-${m.id}">${m.authorId==='user'?'':avatar(state,m.authorId)}<div class="message-content">${chat.kind==='group'||m.demo?`<p class="message-author">${esc(m.authorName)}${state.roles.find(r=>r.id===m.authorId)?.deleted?' · 已移除':''}${m.demo?' · 演示消息':''}</p>`:''}<div class="bubble">${esc(m.text)}${(m.media||[]).map(mid=>{const media=state.media.find(x=>x.id===mid);return media?.type.startsWith('audio/')?`<audio controls preload="metadata" data-media="${mid}"></audio>`:`<img class="media-image" data-media="${mid}" alt="${esc(media?.name||'图片')}">`;}).join('')}</div><div class="message-foot"><span class="message-time">${new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>${btn('message-actions','···',`data-id="${m.id}" aria-label="${esc(m.authorName)}的消息操作"`,'message-more')}</div></div></article>`).join('')+tasksHTML(s,chat.id);
  $('#draft-attachments').innerHTML=chat.draftMedia.map(mid=>btn('remove-attachment',esc(state.media.find(m=>m.id===mid)?.name||'附件')+' ×',`data-id="${mid}"`)).join('');
  seenMessages.disconnect();for(const element of $$('.message',list)){element.dataset.at=chat.messages.find(m=>`msg-${m.id}`===element.id)?.at||0;seenMessages.observe(element);}
  hydrate(list);hydrate($('#chat-avatar').parentElement);fitInput();if(nearBottom)bottom();
}
function bottom(){requestAnimationFrame(()=>{const list=$('#message-list');list.scrollTop=list.scrollHeight;});}
function fitInput(){const input=$('#message-input');input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,138)}px`;const chat=state?.scopes[currentChatKey]?.chats.find(c=>c.id===currentChatId);$('.send-button').disabled=sendingChats.has(inputKey(currentChatKey,currentChatId))||(!input.value.trim()&&!chat?.draftMedia.length);}
function toggleChatTools(force){const open=force??$('#chat-tools').hidden;$('#chat-tools').hidden=!open;$('#chat-tools-toggle').setAttribute('aria-expanded',String(open));}
async function makeTasks(kind,authors,options={},taskKey=key()){
  const taskIds=await commit(s=>authors.filter(cid=>s.roles.some(r=>r.id===cid&&!r.deleted)).map(authorId=>M.createTask(s,taskKey,{kind,authorId,authorName:roleName(s,authorId),...options}).id));
  engine.runMany(taskKey,taskIds);if(!$('#chat-view').hidden)renderMessages();return taskIds;
}
async function send(){
  const taskKey=currentChatKey,chatId=currentChatId,text=$('#message-input').value,owner=inputKey(taskKey,chatId),media=[...state.scopes[taskKey].chats.find(c=>c.id===chatId).draftMedia];
  if(sendingChats.has(owner)||(!text.trim()&&!media.length))return;
  sendingChats.add(owner);fitInput();
  try{
    const data=await commit(s=>{const chat=s.scopes[taskKey].chats.find(c=>c.id===chatId);const m=M.addMessage(s,taskKey,chatId,text,media);if(chat.draft===text)chat.draft='';chat.draftMedia=chat.draftMedia.filter(mid=>!media.includes(mid));return {id:m.id,authors:chat.members.filter(cid=>s.roles.some(r=>r.id===cid&&!r.deleted)).slice(0,3)};});
    if(draftInputs.get(owner)===text)draftInputs.delete(owner);
    if(currentChatId===chatId&&currentChatKey===taskKey){if($('#message-input').value===text)$('#message-input').value='';$('#draft-status').textContent=$('#message-input').value?'草稿已保存':'对话保存在本机';renderMessages();bottom();}
    await makeTasks('chat',data.authors,{targetId:chatId,sourceId:data.id},taskKey);
  }finally{sendingChats.delete(owner);fitInput();}
}
function syncFormMedia(body){for(const el of $$('[data-avatar-preview]',body)){const input=$('input[name="avatar"]',el.closest('form'));if(input)el.dataset.media=input.value;}const mode=$('[name="worldMode"]',body),own=$('[data-own-world]',body);if(mode&&own)own.hidden=mode.value!=='own';}
async function pickAvatar(el){
  const form=el.closest('form'),at=route;captureView();
  const [file]=await chooseFile('image/png,image/jpeg,image/webp,image/gif');if(!file)return;
  const media=await importMedia(store,file,'头像');await commit(s=>s.media.push(media));
  if(!form.isConnected||route!==at)return;
  const input=$('[name="avatar"]',form);input.value=media.id;input.dispatchEvent(new Event('input',{bubbles:true}));syncFormMedia(form);await hydrate(form);
}
function chooseFile(accept,multiple=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;document.body.append(input);input.addEventListener('change',()=>{const files=[...input.files];input.remove();resolve(files);},{once:true});input.addEventListener('cancel',()=>{input.remove();resolve([]);},{once:true});input.click();});}
const downloadJSON=saveJSON;
async function readJSON(file,maxMB=3){if(file.size>maxMB*1024*1024)throw Error(`文件超过 ${maxMB} MB`);try{return JSON.parse(await file.text());}catch{throw Error('JSON 文件无法读取');}}
function currentAppearance(form){const d=new FormData(form);return {...state.phone.appearance,theme:d.get('theme'),blur:d.has('blur'),wallpaper:d.get('wallpaper'),chatBackground:d.get('chatBackground'),fontScale:Number(d.get('fontScale')),music:d.has('music')};}
function connectionForm(){const d=new FormData($('#api-form'));return {baseUrl:String(d.get('baseUrl')).trim(),model:String(d.get('model')).trim(),temperature:Number(d.get('temperature')),maxTokens:Number(d.get('maxTokens'))};}
async function testConnection(models=false){
  const config=connectionForm(),secret=$('#f-secret').value||await store.secret('text',config.baseUrl),status=$('#api-status');status.textContent='正在连接…';
  try{const result=await callService(config,secret,models?'models':'chat',{messages:[{role:'user',content:'请只回复：连接成功'}]});if(!status.isConnected)return;if(models){$('#api-models').innerHTML=result.map(name=>`<option value="${esc(name)}"></option>`).join('');status.textContent=`已获取 ${result.length} 个模型，可在模型框选择。`;}else status.textContent=`连接成功 · ${config.model}`;}catch(error){if(status.isConnected)status.textContent=error.message;}
}

// Actions are registered below; all saved changes go through the same transactional store.
const actions={
  home,back:close,chat:()=>show('chats'),'chat-list':close,moments:()=>show('moments'),diary:()=>show('diary'),calendar:()=>show('calendar'),profile:()=>show('roles'),settings:()=>show('settings'),cancel:close,
  'chat-tools':()=>toggleChatTools(),'chat-create':()=>show('chat-create'),'pick-avatar':pickAvatar,
  'start-private':async el=>{const skey=key(),cid=await commit(s=>M.createChat(s,skey,'private',[el.dataset.id],''));await openChat(cid,skey);},
  appearance:()=>show('appearance'),worlds:()=>show('worlds'),api:()=>show('api'),'voice-settings':()=>show('voice-settings'),identity:()=>show('identity'),data:()=>show('data'),tasks:()=>show('tasks'),album:()=>show('album'),
  'new-chat':()=>show('new-chat'),'new-group':()=>show('new-group'),'open-chat':el=>openChat(el.dataset.id),
  'new-role':()=>show('role-form'),'edit-role':el=>show('role-form',{id:el.dataset.id}),'role-trash':()=>show('role-trash'),
  'delete-role':el=>show('confirm',{title:'移除角色',message:'聊天和署名会保留。角色移入可恢复列表，并停止新的回复。',action:'confirm-delete-role',extra:`data-id="${el.dataset.id}"`}),
  'confirm-delete-role':async el=>{await commit(s=>M.deleteRole(s,el.dataset.id));navigation.reset([{name:'roles',key:key()}]);renderNavigation();},
  'restore-role':async el=>{await commit(s=>{s.roles.find(r=>r.id===el.dataset.id).deleted=false;});show('roles');},
  'new-world':el=>show('world-form',{selectFor:el.dataset.selectFor||'phone'}),'edit-world':el=>show('world-form',{id:el.dataset.id}),
  'edit-current-world':()=>show('world-form',{id:state.phone.worldId}),
  'choose-own-world':el=>show('world-form',{id:$('#f-worldId')?.value||el.dataset.id}),
  'use-world':async el=>{await commit(s=>M.setPhoneWorld(s,el.dataset.id,s.phone.worldEnabled));delete route.view;paintPanel(false);toast('已切换世界背景');},
  proactive:el=>show('proactive',{id:el.dataset.id||role().id}),
  memories:el=>show('memories',{owner:el.dataset.owner}),
  'new-memory':()=>hasActive()&&show('memory-form',{owner:route?.owner}),'generate-memory':()=>hasActive()&&show('generate-memory',{owner:route?.owner}),
  'new-diary':()=>show('diary-form'),'generate-diary':()=>hasActive()&&show('generate-diary'),'new-event':()=>hasActive()&&show('event-form'),'new-post':()=>show('post-form'),'generate-post':()=>hasActive()&&show('generate-post'),
  'comment-post':el=>show('comment-form',{id:el.dataset.id}),'reply-comment':el=>show('comment-form',{id:el.dataset.post,replyTo:el.dataset.id}),'role-comments':el=>show('role-comments',{id:el.dataset.id,replyTo:el.dataset.reply||null}),
  'like-post':async el=>{await commit(s=>{const p=s.scopes[route.key].posts.find(p=>p.id===el.dataset.id);p.likes=p.likes.includes('user')?p.likes.filter(x=>x!=='user'):[...p.likes,'user'];});paintPanel();},
  favorite:async el=>{const rkey=route?.key||currentChatKey;await commit(s=>M.toggleFavorite(s.scopes[rkey],el.dataset.kind,el.dataset.id));paintPanel();},
  'favorites-filter':()=>{route.favorites=!route.favorites;paintPanel();},
  'view-sources':el=>show('sources',{id:el.dataset.id,kind:el.dataset.kind,key:route.key}),
  'open-source':async el=>{const skey=route.key;if(el.dataset.kind==='message'){const chat=state.scopes[skey].chats.find(c=>c.messages.some(m=>m.id===el.dataset.id));if(chat)await openChat(chat.id,skey,el.dataset.id);}else{show(({post:'moments',diary:'diary',event:'calendar',memory:'memories'})[el.dataset.kind],{key:skey});requestAnimationFrame(()=>document.getElementById(`record-${el.dataset.id}`)?.scrollIntoView({block:'center'}));}},
  'edit-record':el=>{const type=el.dataset.kind;show(({message:'edit-message',post:'post-form',diary:'diary-form',memory:'memory-form',event:'event-form'})[type],{id:el.dataset.id,key:route?.key||currentChatKey});},
  'delete-record':async el=>{const type=el.dataset.kind,rkey=route?.key||currentChatKey;await commit(s=>M.deleteRecord(s.scopes[rkey],type,el.dataset.id));if(type==='message'){close();renderMessages();}else show(({post:'moments',diary:'diary',memory:'memories',event:'calendar'})[type],{key:rkey});toast('已移入回收站');},
  'restore-record':async el=>{await commit(s=>{const r=M.recordByRef(s.scopes[route.key],{type:el.dataset.kind,id:el.dataset.id});r.deleted=false;r.updatedAt=Date.now();});paintPanel();},
  'toggle-memory':async el=>{await commit(s=>{const m=s.scopes[route.key].memories.find(m=>m.id===el.dataset.id);if(!m.enabled&&!M.sourcesValid(s.scopes[route.key],m))throw Error('原始内容已变化，请先编辑这段回忆');m.enabled=!m.enabled;});paintPanel();},
  'pin-memory':async el=>{await commit(s=>{const m=s.scopes[route.key].memories.find(m=>m.id===el.dataset.id);m.pinned=!m.pinned;});paintPanel();},
  'complete-event':async el=>{await commit(s=>{const e=s.scopes[route.key].events.find(e=>e.id===el.dataset.id);e.status='done';e.updatedAt=Date.now();});paintPanel();},
  'cancel-event':async el=>{await commit(s=>{const e=s.scopes[route.key].events.find(e=>e.id===el.dataset.id);e.status='cancelled';e.updatedAt=Date.now();});paintPanel();},
  'chat-options':()=>show('chat-options',{id:currentChatId,key:currentChatKey}),respond:()=>show('respond',{id:currentChatId,key:currentChatKey}),'chat-search':()=>show('chat-search',{id:currentChatId,key:currentChatKey}),
  'message-actions':el=>show('message-actions',{id:el.dataset.id,key:currentChatKey}),'jump-message':el=>openChat(currentChatId,currentChatKey,el.dataset.id),
  'quote-message':async el=>{const m=M.recordByRef(state.scopes[currentChatKey],{type:'message',id:el.dataset.id});const text=`回复 ${m.authorName}：「${m.text.slice(0,150)}」\n`;await commit(s=>{const c=s.scopes[currentChatKey].chats.find(c=>c.id===currentChatId);c.draft=c.draft?c.draft+'\n'+text:text;});await openChat(currentChatId,currentChatKey);},
  'memory-from-message':el=>{const c=state.scopes[currentChatKey].chats.find(c=>c.id===currentChatId),m=c.messages.find(m=>m.id===el.dataset.id);show('memory-form',{text:m.text,sourceRefs:[M.sourceRef('message',m)],allowed:c.members,key:currentChatKey});},
  'event-from-message':el=>{const m=M.recordByRef(state.scopes[currentChatKey],{type:'message',id:el.dataset.id});show('event-form',{text:m.text.slice(0,120),sourceRefs:[M.sourceRef('message',m)],key:currentChatKey});},
  'retry-task':async el=>{const rkey=route?.key||currentChatKey;await commit(s=>{const t=s.scopes[rkey].tasks.find(t=>t.id===el.dataset.id);if(t.status!=='done'){t.status='waiting';t.error='';}});engine.run(rkey,el.dataset.id);if(route)paintPanel();else renderMessages();},
  'cancel-task':el=>engine.cancel(route?.key||currentChatKey,el.dataset.id),
  'preview-appearance':()=>{preview=currentAppearance($('#appearance-form'));renderHome();toast('正在预览，保存后沿用');},models:()=>testConnection(true),'test-api':()=>testConnection(false),
  'clear-key':async el=>{await store.saveSecret(el.dataset.kind,'');toast('已清除这个服务的密钥');},
  'import-role':async()=>{const [file]=await chooseFile('.json');if(!file)return;const raw=await readJSON(file),c=raw.data||raw;if(typeof c.name!=='string')throw Error('角色 JSON 需要 name 字段');show('role-form',{imported:true,values:{name:c.name,persona:[c.description||c.persona,c.personality,c.scenario].filter(Boolean).join('\n\n'),relation:c.relation||'',worldId:state.phone.worldId,worldMode:'inherit',avatar:'builtin-flowers',metOn:M.localDate()}});},
  'import-api':async()=>{const [file]=await chooseFile('.json');if(!file)return;show('api',{values:connectionFromJSON(await readJSON(file))});},
  'trash':()=>show('trash'),
  export:async()=>{toast('正在整理记录和原始附件…');if(await downloadJSON(await store.export(),`小手机备份-${M.localDate()}.json`))toast('备份已导出');},
  'import-backup':async()=>{const [file]=await chooseFile('.json');if(!file)return;const bundle=await readJSON(file,150);if(bundle.format!=='lumi-phone-backup')throw Error('请选择小手机完整备份');const checked=M.validatePhone(bundle.state);for(const m of checked.media.filter(m=>!m.builtin&&!m.url))if(!bundle.attachments?.[m.id])throw Error('备份缺少附件：'+m.name);importBundle={...bundle,state:checked};show('backup-preview',{summary:{roles:checked.roles.length,scopes:Object.keys(checked.scopes).length,media:checked.media.length}});},
  'apply-backup':async()=>{if(engine.controllers.size||speechJobs.size)throw Error('请先等生成结束或停止任务');audio.pause();state=await store.restore(importBundle);importBundle=null;await loadAudio();home();toast('备份已恢复，服务密钥需重新填写');},
  'restore-points':async()=>show('restore-points',{points:await store.restorePoints()}),
  'legacy-drafts':()=>show('legacy-drafts'),
  'open-legacy-draft':async el=>{const index=Number(el.dataset.index),copy=state.migration.personalPhone.draftCopies[index];const separator=copy.key.indexOf(':'),name=copy.key.slice(0,separator),id=copy.key.slice(separator+1);await commit(s=>{const drafts=M.scopeFor(s).drafts,item=s.migration.personalPhone.draftCopies[index],old=drafts[item.key];drafts[item.key]=M.clone(item.value);if(old)item.value=old;});show(name,id==='new'?{}:{id});toast('已打开旧草稿，可以继续编辑');},
  rollback:el=>show('confirm',{title:'回到恢复点',message:'当前记录会再次保存为恢复点，然后回到所选记录。',action:'confirm-rollback',extra:`data-id="${el.dataset.id}"`}),
  'confirm-rollback':async el=>{if(engine.controllers.size)throw Error('请先停止正在生成的任务');audio.pause();state=await store.rollback(el.dataset.id);await loadAudio();home();toast('已回到所选恢复点');}
};

Object.assign(actions,{
  attachments:()=>show('attachments',{key:currentChatKey}),
  'upload-images':async()=>{const target={...route},files=await chooseFile('image/png,image/jpeg,image/webp,image/gif',true);for(const file of files){const media=await importMedia(store,file,target.category||'照片');await commit(s=>s.media.push(media));}if(files.length)show(target.name,{...target});},
  'album-filter':()=>{route.category=route.category?'':'表情';paintPanel();},
  'media-detail':el=>show('media-detail',{id:el.dataset.id}),
  'attach-image':async el=>{const ckey=currentChatKey,cid=currentChatId;await commit(s=>{const c=s.scopes[ckey].chats.find(c=>c.id===cid);if(!c.draftMedia.includes(el.dataset.id))c.draftMedia.push(el.dataset.id);});close();renderMessages();},
  'remove-attachment':async el=>{await commit(s=>{const c=s.scopes[currentChatKey].chats.find(c=>c.id===currentChatId);c.draftMedia=c.draftMedia.filter(mid=>mid!==el.dataset.id);});renderMessages();},
  'media-wallpaper':async el=>{await commit(s=>s.phone.appearance.wallpaper=el.dataset.id);toast('已设为手机壁纸');},
  'media-avatar':async el=>{await commit(s=>s.user.avatar=el.dataset.id);toast('我的头像已更新');},
  'media-sticker':async el=>{await commit(s=>{const m=s.media.find(m=>m.id===el.dataset.id);m.category=m.category==='表情'?'照片':'表情';});paintPanel();},
  'rename-media':async el=>{const name=$('#f-mediaName').value.trim();if(!name)throw Error('请填写图片名称');await commit(s=>s.media.find(m=>m.id===el.dataset.id).name=name);paintPanel();},
  'open-original':async el=>{const media=state.media.find(m=>m.id===el.dataset.id);const url=await store.mediaURL(media);if(!url)return;const viewer=document.createElement('dialog');viewer.className='image-viewer';const image=document.createElement('img');image.src=url;image.alt=media?.name||'原图';const button=document.createElement('button');button.className='secondary';button.textContent='关闭原图';button.onclick=()=>viewer.close();viewer.append(image,button);viewer.addEventListener('close',()=>viewer.remove(),{once:true});document.body.append(viewer);viewer.showModal();},
  music:()=>show('music'),play:()=>toggleAudio(),
  'upload-music':async()=>{const skey=key(),files=await chooseFile('audio/*',true);for(const file of files){const media=await importMedia(store,file,'音乐');await commit(s=>{s.media.push(media);s.scopes[skey].playlist.push(media.id);});}show('music');},
  'select-track':el=>selectTrack(el.dataset.id),
  'previous-track':()=>{const s=scope(),i=s.playlist.indexOf(s.playback.trackId);return selectTrack(s.playlist[(i-1+s.playlist.length)%s.playlist.length]);},
  'next-track':()=>{const s=scope(),i=s.playlist.indexOf(s.playback.trackId);return selectTrack(s.playlist[(i+1)%s.playlist.length]);},
  'listen-together':async()=>{const current=scope().listening.find(l=>!l.endedAt);if(current){await savePlayback();await commit(s=>{const l=s.scopes[key()].listening.find(l=>l.id===current.id);l.endedAt=Date.now();});show('music');}else if(hasActive())show('listen-form');},
  'share-song':()=>hasActive()&&show('share-song'),
  'share-song-to':async el=>{const skey=key(),track=state.media.find(m=>m.id===scope().playback.trackId),cid=el.dataset.id;await commit(s=>{const c=s.scopes[skey].chats.find(c=>c.id===cid);const text=`一起听这首《${track.name}》吧。`;c.draft=c.draft?c.draft+'\n'+text:text;});await openChat(cid,skey);},
  'choose-song':async()=>{const l=scope().listening.find(l=>!l.endedAt);if(!l)return;const skey=key(),author=l.participants[(l.nextPicker||0)%l.participants.length];const taskId=await commit(s=>M.createTask(s,skey,{kind:'song',authorId:author,authorName:roleName(s,author)}).id);toast('角色正在从歌单里选歌…');await engine.run(skey,taskId);const t=state.scopes[skey].tasks.find(t=>t.id===taskId);if(t.status==='done'&&key()===skey){await commit(s=>{const session=s.scopes[skey].listening.find(x=>x.id===l.id);session.nextPicker=(session.nextPicker||0)+1;});await selectTrack(t.trackId);toast('角色选好了，点播放一起听');}else if(t.error)toast(t.error);},
  record:()=>{recordedMedia=null;recordTarget={key:currentChatKey,id:currentChatId};show('record');},
  'upload-voice':async()=>{const target={...recordTarget},[file]=await chooseFile('audio/*');if(!file)return;const media=await importMedia(store,file,'语音');await commit(s=>{s.media.push(media);s.scopes[target.key].chats.find(c=>c.id===target.id).draftMedia.push(media.id);});recordedMedia=media;if(route?.name==='record'){$('#recorder-content').innerHTML=`<audio controls data-media="${media.id}"></audio><div class="toolbar">${btn('transcribe-recording','转成文字')}${btn('finish-recording','回聊天检查并发送')}</div>`;$('#record-status').textContent='录音已放入草稿';hydrate($('#recorder-content'));}},
  'start-recording':()=>startRecording(),'stop-recording':()=>recorder?.state==='recording'&&recorder.stop(),
  'transcribe-recording':async()=>{if(!recordedMedia)return;const target={...recordTarget},media=recordedMedia,config={...state.connections.transcription};if(!config.baseUrl||!config.model)throw Error('先在设置中填写录音识别服务，也可以直接输入文字说明');$('#record-status').textContent='正在识别录音…';const text=await callService(config,await store.secret('transcription',config.baseUrl),'transcription',{audio:await blobBase64(await store.blob(media.id)),type:media.type.split(';')[0],name:media.name});if(!text)throw Error('没有识别到文字，可手工补充');await commit(s=>{const c=s.scopes[target.key].chats.find(c=>c.id===target.id);c.draft=c.draft?c.draft+'\n'+text:text;});if(route?.name==='record')$('#record-status').textContent='文字已放入聊天草稿，可以检查后发送';},
  'finish-recording':()=>openChat(recordTarget.id,recordTarget.key),
  'speak-message':async el=>{
    const skey=route.key,mid=el.dataset.id,message=M.recordByRef(state.scopes[skey],{type:'message',id:mid}),text=message.text,config={...state.connections.speech};
    if(!config.baseUrl||!config.model||!config.voice)throw Error('先在设置中填写朗读服务、模型和声音');
    if(message.ttsText===text&&message.ttsMedia){toast('这条回复已有语音，可在消息中播放');return;}
    if(el.disabled||speechJobs.has(mid))return;speechJobs.add(mid);el.disabled=true;toast('正在生成音频…');
    try{const blob=await callService(config,await store.secret('speech',config.baseUrl),'speech',{text});const media={id:M.id(),name:'语音回复',type:blob.type.startsWith('audio/')?blob.type:'audio/mpeg',size:blob.size,category:'语音',at:Date.now()};await store.putBlob(media.id,blob);await commit(s=>{const m=M.recordByRef(s.scopes[skey],{type:'message',id:mid});if(!m||m.deleted||m.text!==text)throw Error('消息已修改，请重新朗读');s.media.push(media);m.media=m.media.filter(x=>x!==m.ttsMedia);m.media.push(media.id);m.ttsMedia=media.id;m.ttsText=text;});if(currentChatKey===skey)renderMessages();toast('语音已保存到消息');}finally{speechJobs.delete(mid);if(el.isConnected)el.disabled=false;}
  }
});

async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('此浏览器不支持录音，可以上传音频文件');
  recordStream=await navigator.mediaDevices.getUserMedia({audio:true});
  const options=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?{mimeType:'audio/webm;codecs=opus'}:{};
  recorder=new MediaRecorder(recordStream,options);const chunks=[],target={...recordTarget};
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=whenError(async()=>{
    clearTimeout(recordTimer);recordStream?.getTracks().forEach(track=>track.stop());
    const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});if(!blob.size)throw Error('没有录到声音，请重试');
    const file=new File([blob],`录音-${M.localDate()}.webm`,{type:blob.type}),media=await importMedia(store,file,'语音');recordedMedia=media;
    await commit(s=>{s.media.push(media);s.scopes[target.key].chats.find(c=>c.id===target.id).draftMedia.push(media.id);});
    if(route?.name==='record'){$('#recorder-content').innerHTML=`<audio controls data-media="${media.id}"></audio><div class="toolbar">${btn('transcribe-recording','转成文字')}${btn('finish-recording','回聊天检查并发送')}</div>`;$('#record-status').textContent='录音已放入草稿';hydrate($('#recorder-content'));}else if(currentChatId===target.id)renderMessages();
  });
  recorder.start();recordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
  $('#recorder-content').innerHTML=`<div class="recording">正在录音…</div>${btn('stop-recording','结束录音','','primary')}`;
}

async function loadAudio(){
  const generation=++mediaLoad,skey=key(),s=scope();audioReady=false;audio.pause();if(!s){audioScope=null;return;}
  const track=state.media.find(m=>m.id===s.playback.trackId),url=await store.mediaURL(track);if(generation!==mediaLoad||skey!==key())return;
  audioScope=skey;audioTrack=track?.id;audio.volume=s.playback.volume;audio.src=url||'assets/afternoon.wav';audio.load();
  const restore=()=>{if(generation!==mediaLoad)return;audio.currentTime=Math.min(s.playback.position||0,Number.isFinite(audio.duration)?audio.duration:0);audioReady=true;lastPlayedAt=0;updateAudio();};
  if(audio.readyState>=1)restore();else audio.addEventListener('loadedmetadata',restore,{once:true});
}
function updateAudio(){
  $$('[data-elapsed]').forEach(el=>el.textContent=formatTime(audio.currentTime));$$('[data-duration]').forEach(el=>el.textContent=formatTime(audio.duration));
  $$('[data-progress]').forEach(el=>el.style.width=`${audio.duration?audio.currentTime/audio.duration*100:0}%`);
  $$('[data-action="play"]').forEach(el=>{el.innerHTML=icon(audio.paused?'play':'pause');el.setAttribute('aria-label',audio.paused?'播放音乐':'暂停音乐');});
  if($('#seek')){$('#seek').max=Number.isFinite(audio.duration)?audio.duration:100;$('#seek').value=audio.currentTime;}
}
async function toggleAudio(){if(!audioScope)await loadAudio();if(audio.paused){try{await audio.play();}catch{throw Error('歌曲暂时无法播放，请检查音频文件');}}else audio.pause();updateAudio();}
async function selectTrack(trackId){await savePlayback();audio.pause();await commit(s=>{const sc=M.scopeFor(s);if(!sc.playlist.includes(trackId))throw Error('歌曲不在当前歌单');sc.playback.trackId=trackId;sc.playback.position=0;const listening=sc.listening.find(l=>!l.endedAt);if(listening&&!listening.tracks.includes(trackId))listening.tracks.push(trackId);});playedSeconds=0;await loadAudio();if(route?.name==='music')paintPanel();}
async function savePlayback(){
  if(!audioReady||!audioScope||!state.scopes[audioScope])return;
  const skey=audioScope,trackId=audioTrack,position=audio.currentTime||0,volume=audio.volume,seconds=playedSeconds;playedSeconds=0;
  try{await commit(s=>{const sc=s.scopes[skey];if(sc.playback.trackId===trackId)sc.playback={trackId,position,volume};const l=sc.listening.find(l=>!l.endedAt);if(l)l.seconds=(l.seconds||0)+seconds;});}catch(error){playedSeconds+=seconds;throw error;}
}
['play','pause','ended','loadedmetadata','seeked','volumechange'].forEach(event=>audio.addEventListener(event,()=>{updateAudio();if(['pause','ended','seeked','volumechange'].includes(event))whenError(savePlayback)();if(event==='pause'||event==='seeked')lastPlayedAt=0;}));
audio.addEventListener('timeupdate',()=>{updateAudio();const now=performance.now();if(!audio.paused&&!audio.seeking){if(lastPlayedAt)playedSeconds+=Math.max(0,Math.min((now-lastPlayedAt)/1000,2));lastPlayedAt=now;}if(audioReady&&!audio.paused&&now-lastAudioSave>2000){lastAudioSave=now;whenError(savePlayback)();}});
audio.addEventListener('error',()=>{if(audioScope)toast('音频没有加载成功，请重新选择歌曲');});

document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled){const action=actions[el.dataset.action];if(action)whenError(()=>action(el))();}});
document.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target,formId=form.id;if(formId==='composer'){whenError(send)();return;}
  const at={...route},d=new FormData(form),text=name=>String(d.get(name)||'').trim(),all=name=>d.getAll(name).map(String),draftKey=formDraftKey();
  const save=fn=>commit(s=>{fn(s,s.scopes[at.key]);if(s.scopes[at.key])delete s.scopes[at.key].drafts[draftKey];});
  whenError(async()=>{
    if(formId==='search-form'){route.query=text('query');paintPanel();return;}
    if(formId==='role-form'){
      if(!text('name')||!M.validDate(text('metOn')))throw Error('请填写名字和有效的相遇日期');
      const values={name:text('name'),persona:text('persona'),relation:text('relation'),metOn:text('metOn'),avatar:text('avatar'),worldId:text('worldId')||state.phone.worldId,worldMode:text('worldMode')||'inherit'};
      await save(s=>{if(at.id){const r=s.roles.find(r=>r.id===at.id),oldName=r.name;Object.assign(r,values);for(const c of M.scopeFor(s).chats)if(c.kind==='private'&&c.members[0]===r.id&&c.name===oldName)c.name=r.name;}else M.addRole(s,values);});close();if(navigation.current.name==='home')show('roles');toast(at.id?'联系人已保存':'已添加到联系人');return;
    }
    if(formId==='world-form'){if(!text('name')||!M.validDate(text('date')))throw Error('请填写名字和有效日期');const wid=at.id||M.id();await save(s=>{const values={name:text('name'),body:text('body'),timeMode:text('timeMode'),date:text('date')};if(at.id)Object.assign(s.worlds.find(w=>w.id===wid),values);else s.worlds.push({id:wid,...values});if(at.selectFor==='phone')M.setPhoneWorld(s,wid,s.phone.worldEnabled);});close();if(at.selectFor==='role'&&route?.name==='role-form'){const input=$('#f-worldId');input.value=wid;input.dispatchEvent(new Event('input',{bubbles:true}));}toast('世界背景已保存');return;}
    if(formId==='new-chat-form'){const cid=await commit(s=>M.createChat(s,at.key,at.name==='new-group'?'group':'private',at.name==='new-group'?all('members'):[text('member')],text('name')));await openChat(cid,at.key);return;}
    if(formId==='chat-settings-form'){await save((s,sc)=>{const c=sc.chats.find(c=>c.id===at.id);if(c.kind==='group'){if(all('members').length<2)throw Error('群聊至少保留两位角色');c.members=all('members');for(const t of sc.tasks)if(t.targetId===c.id&&!c.members.includes(t.authorId)&&['waiting','running'].includes(t.status)){t.status='cancelled';t.error='角色已离开群聊';}}c.name=text('name');});await openChat(at.id,at.key);return;}
    if(formId==='respond-form'){if(!all('members').length)throw Error('选择至少一位角色');await openChat(at.id,at.key);await makeTasks('chat',all('members'),{targetId:at.id},at.key);return;}
    if(formId==='edit-message-form'){await save((s,sc)=>{const m=M.recordByRef(sc,{type:'message',id:at.id});m.text=text('text');m.updatedAt=Date.now();for(const memory of sc.memories)if(memory.sourceRefs?.some(r=>r.id===m.id)){memory.enabled=false;memory.stale=true;}for(const diary of sc.diaries)if(diary.sourceRefs?.some(r=>r.id===m.id))diary.stale=true;});close();renderMessages();return;}
    if(formId==='memory-form'){if(!all('participants').length)throw Error('选择知道这件事的角色');await save((s,sc)=>{const values={text:text('text'),participants:all('participants'),enabled:d.has('enabled'),pinned:d.has('pinned'),manual:true,stale:false};if(at.id){const m=sc.memories.find(m=>m.id===at.id);Object.assign(m,values,{originalSources:m.originalSources||m.sourceRefs,sourceRefs:[],updatedAt:Date.now()});}else sc.memories.push({id:M.id(),originWorldId:s.phone.worldId,...values,sourceRefs:at.sourceRefs||[],at:Date.now(),deleted:false});});close();toast('回忆已保存');return;}
    if(formId==='event-form'){if(!M.validDate(text('date'))||!all('participants').length)throw Error('填写有效日期，并选择参与角色');await save((s,sc)=>{const values={title:text('title'),date:text('date'),time:text('time'),repeat:text('repeat'),participants:all('participants'),note:text('note')};if(at.id)Object.assign(sc.events.find(e=>e.id===at.id),values,{updatedAt:Date.now()});else sc.events.push({id:M.id(),originWorldId:s.phone.worldId,...values,status:'planned',sourceRefs:at.sourceRefs||[],at:Date.now(),deleted:false});});close();toast('约定已保存');return;}
    if(formId==='diary-form'){if(!M.validDate(text('date')))throw Error('请选择有效日期');await save((s,sc)=>{const values={title:text('title')||'今天',text:text('text'),date:text('date'),status:'saved'};if(at.id)Object.assign(sc.diaries.find(e=>e.id===at.id),values,{updatedAt:Date.now(),stale:false});else sc.diaries.push({id:M.id(),originWorldId:s.phone.worldId,...values,authorId:'user',authorName:s.user.name,sourceRefs:[],at:Date.now(),deleted:false});});close();toast('日记已保存');return;}
    if(formId==='generate-diary-form'){show('diary');await makeTasks('diary',[text('authorId')],{date:text('date')},at.key);paintPanel();return;}
    if(formId==='generate-role-form'){show(at.name==='generate-memory'?'memories':'moments');await makeTasks(at.name==='generate-memory'?'memory':'post',[text('authorId')],{audience:all('audience')},at.key);paintPanel();return;}
    if(formId==='post-form'){if(!text('text')&&!all('media').length)throw Error('写点文字或选择一张图片');await save((s,sc)=>{const values={text:text('text'),audience:all('audience'),media:all('media')};if(at.id)Object.assign(sc.posts.find(p=>p.id===at.id),values,{updatedAt:Date.now()});else sc.posts.push({id:M.id(),originWorldId:s.phone.worldId,...values,authorId:'user',authorName:s.user.name,comments:[],likes:[],at:Date.now(),storyDate:M.storyDate(s,at.key),deleted:false});});close();toast('动态已发布');return;}
    if(formId==='comment-form'){await save((s,sc)=>{const post=sc.posts.find(p=>p.id===at.id);post.comments.push({id:M.id(),text:text('text'),authorId:'user',authorName:s.user.name,replyTo:at.replyTo||null,at:Date.now(),deleted:false});});close();return;}
    if(formId==='role-comments-form'){if(!all('members').length)throw Error('至少选择一位角色');show('moments');await makeTasks('comment',all('members'),{targetId:at.id,replyTo:at.replyTo||null},at.key);paintPanel();return;}
    if(formId==='appearance-form'){const appearance=currentAppearance(form);await save(s=>s.phone.appearance=appearance);preview=null;close();renderHome();toast('外观已保存');return;}
    if(formId==='identity-form'){await save(s=>s.user={...s.user,name:text('name'),description:text('description'),avatar:text('avatar')});close();toast('资料已保存');return;}
    if(formId==='api-form'){const config=connectionForm();endpoint(config.baseUrl);if(!config.model)throw Error('请填写模型名称');if(text('secret'))await store.saveSecret('text',text('secret'),config.baseUrl);else if(config.baseUrl!==state.connections.text.baseUrl)await store.saveSecret('text','');await save(s=>s.connections.text=config);close();toast('连接已保存');return;}
    if(formId==='voice-form'){for(const kind of ['speech','transcription']){if(text(kind+'Url'))endpoint(text(kind+'Url'),kind);if(text(kind+'Key'))await store.saveSecret(kind,text(kind+'Key'),text(kind+'Url'));else if(text(kind+'Url')!==state.connections[kind].baseUrl)await store.saveSecret(kind,'');}await save(s=>{s.connections.speech={baseUrl:text('speechUrl'),model:text('speechModel'),voice:text('speechVoice')};s.connections.transcription={baseUrl:text('transcriptionUrl'),model:text('transcriptionModel')};});close();toast('语音服务已保存');return;}
    if(formId==='proactive-form'){await save(s=>{const r=s.roles.find(r=>r.id===at.id),old=r.proactive;r.proactive={...old,enabled:d.has('enabled'),interval:Number(text('interval')),dailyLimit:Number(text('dailyLimit')),quietStart:Number(text('quietStart')),quietEnd:Number(text('quietEnd')),lastAt:!old.enabled&&d.has('enabled')?Date.now():old.lastAt};if(!r.proactive.enabled)for(const sc of Object.values(s.scopes))for(const t of sc.tasks)if(t.kind==='proactive'&&t.authorId===r.id&&['waiting','running'].includes(t.status)){t.status='cancelled';t.error='主动来信已关闭';}});close();toast('主动来信规则已保存');return;}
    if(formId==='listen-form'){if(!all('members').length)throw Error('选择一起听的角色');await save((s,sc)=>sc.listening.push({id:M.id(),participants:all('members'),tracks:[sc.playback.trackId],at:Date.now(),seconds:0,endedAt:null}));close();return;}
  })();
});

const draftForms=new Set(['role-form','identity-form','world-form','post-form','comment-form','diary-form','memory-form','event-form']);
document.addEventListener('input',event=>{
  if(event.target.name==='worldMode')syncFormMedia(event.target.closest('form'));
  if(event.target.id==='phone-world-enabled'){const enabled=event.target.checked;whenError(async()=>{await commit(s=>M.setPhoneWorld(s,s.phone.worldId,enabled));delete route.view;paintPanel(false);}) ();}
  if(event.target.id==='message-input'){
    const skey=currentChatKey,cid=currentChatId,text=event.target.value,owner=inputKey(skey,cid);draftInputs.set(owner,text);fitInput();$('#draft-status').textContent='正在保存…';
    whenError(async()=>{await commit(s=>{s.scopes[skey].chats.find(c=>c.id===cid).draft=text;});if(draftInputs.get(owner)===text){draftInputs.delete(owner);if(currentChatKey===skey&&currentChatId===cid)$('#draft-status').textContent=text?'草稿已保存':'对话保存在本机';}})();
  }
  if(event.target.name==='query'&&route?.name==='chats'){route.query=event.target.value;paintPanel();}
  if(event.target.id==='seek'&&audioReady)audio.currentTime=Math.min(Number(event.target.value),audio.duration||0);
  if(event.target.id==='volume')audio.volume=Number(event.target.value);
  const form=event.target.closest('form');if(form&&draftForms.has(form.id)&&route?.key){const skey=route.key,dkey=formDraftKey(),fd=new FormData(form),values={};for(const name of new Set([...fd.keys()]))values[name]=fd.getAll(name).length>1?fd.getAll(name):fd.get(name);for(const el of $$('input[type=checkbox]',form))values[el.name]=fd.getAll(el.name);whenError(()=>commit(s=>s.scopes[skey].drafts[dkey]=values))();}
});
$('#message-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!matchMedia('(pointer: coarse)').matches){event.preventDefault();$('#composer').requestSubmit();}});
$('#message-input').addEventListener('focus',()=>toggleChatTools(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.open&&!document.querySelector('.image-viewer[open]')){if(window.lumiBack())event.preventDefault();}});
function syncViewport(){document.documentElement.style.setProperty('--visual-height',`${window.visualViewport?.height||window.innerHeight}px`);if(!$('#chat-view').hidden)fitInput();}
window.visualViewport?.addEventListener('resize',syncViewport);syncViewport();
const pages=$('#home-pages');
function goPage(index,smooth=true){homePage=Math.max(0,Math.min(1,index));pages.scrollTo({left:homePage*pages.clientWidth,behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});}
pages.addEventListener('scroll',()=>{homePage=Math.max(0,Math.min(1,Math.round(pages.scrollLeft/Math.max(1,pages.clientWidth))));$$('[data-home-page]').forEach(el=>{if(Number(el.dataset.homePage)===homePage)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});},{passive:true});
$$('[data-home-page]').forEach(el=>el.addEventListener('click',()=>goPage(Number(el.dataset.homePage))));
pages.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();goPage(homePage+(e.key==='ArrowRight'?1:-1));}});
let drag=null,suppressUntil=0;
pages.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0)drag={x:e.clientX,y:e.clientY,page:homePage};});
pages.addEventListener('pointerup',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y,original=drag.page;drag=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){e.preventDefault();suppressUntil=performance.now()+350;goPage(original+(dx<0?1:-1));}});
pages.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopPropagation();}},true);pages.addEventListener('pointercancel',()=>drag=null);
new ResizeObserver(()=>{if(!$('#home-view').hidden)goPage(homePage,false);}).observe(pages);
let proactiveChecking=false;
async function checkReminders(){if(!state||document.hidden)return;const skey=key();if(!M.dueReminders(state,skey).length)return;const rows=await commit(s=>{const due=M.dueReminders(s,skey);s.scopes[skey].reminders??=[];s.scopes[skey].reminders.push(...due.map(e=>({...e,at:Date.now()})));return due;});if(rows.length)toast(`今天的约定：${rows.map(r=>r.title).join('、')}。点桌面日期可查看。`);}
async function checkProactive(){
  if(!state||document.hidden||proactiveChecking)return;proactiveChecking=true;
  try{const skey=key();for(const rid of liveRoles(state).map(r=>r.id)){const due=M.proactiveDue(state,skey,rid);if(!due)continue;
    const taskId=await commit(s=>{const current=M.proactiveDue(s,skey,rid);if(!current)return null;const r=s.roles.find(r=>r.id===rid),sc=s.scopes[skey],chat=sc.chats.find(c=>c.kind==='private'&&c.members[0]===rid);const task=M.createTask(s,skey,{kind:'proactive',targetId:chat.id,authorId:rid,authorName:r.name,...current});const day=M.localDate();r.proactive.count=r.proactive.day===day?r.proactive.count+1:1;r.proactive.day=day;r.proactive.lastAt=Date.now();return task.id;});
    if(taskId)await engine.run(skey,taskId);}
  }finally{proactiveChecking=false;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshClock();whenError(checkProactive)();whenError(checkReminders)();}else whenError(savePlayback)();});
window.addEventListener('pagehide',()=>{audio.pause();recordStream?.getTracks().forEach(t=>t.stop());});
store.listeners.push(next=>{if(next){state=next;renderHome();if(!$('#chat-view').hidden)renderMessages();}});
try{state=await store.open();renderHome();refreshClock();await loadAudio();setInterval(()=>{if(!document.hidden)refreshClock();},20000);setInterval(()=>{whenError(checkProactive)();whenError(checkReminders)();},30000);whenError(checkReminders)();}
catch(error){const panel=document.createElement('section');panel.className='startup-error';panel.innerHTML=`<h2>本机记录暂时无法打开</h2><p class="hint">${esc(error.message)}</p><p>原有记录仍然保留。请刷新重试，或检查浏览器存储权限。</p>`;document.body.append(panel);}
