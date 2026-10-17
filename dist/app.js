import {STORAGE_KEY,AVATARS,localDate,validDate,companionDays,createState,normalizeState,sendMessage,completeReply} from './state.mjs';

const $ = (selector,root=document)=>root.querySelector(selector);
const $$ = (selector,root=document)=>[...root.querySelectorAll(selector)];
const esc = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const copy = value=>JSON.parse(JSON.stringify(value));
let state=createState();
let startupMessage='';
try {
  const stored=localStorage.getItem(STORAGE_KEY);
  if(stored){
    try{state=normalizeState(JSON.parse(stored));}
    catch{localStorage.setItem(`${STORAGE_KEY}.unread-${Date.now()}`,stored);startupMessage='旧记录格式有误，原始内容已单独留存。这次先打开新样品。';}
  }
}
catch {startupMessage='本机记录暂时无法读取，这次先打开新样品。';}
let replyTimer;
let sheetType='';
let previewAppearance=null;
let toastTimer;
let calendarOffset=0;
let pendingQuickReply='';
let lastSavedSecond=-1;
let audioRestored=false;
const dialog=$('#sheet');
const audio=$('#audio');
audio.volume=state.playback.volume;

function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3000);}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}
  catch{toast('本机空间不足或存储不可用，请先导出样品记录。');return false;}
}
function commitSettings(patch){
  const previous=state;state={...state,...patch};
  if(persist())return true;
  state=previous;return false;
}
function applyAppearance(appearance=previewAppearance||state.appearance){
  const root=document.documentElement;
  root.dataset.theme=appearance.theme;
  root.dataset.blur=String(appearance.blur);
  root.style.setProperty('--font-scale',appearance.fontScale);
  root.dataset.largeText=String(appearance.fontScale>1);
  $$('.avatar').forEach(img=>{img.src=AVATARS[appearance.avatar];img.alt=`${state.profile.name}的头像`;});
}
function renderHome(){
  $$('[data-character-name]').forEach(el=>el.textContent=state.profile.name);
  $('#music-widget').hidden=!state.widgets.music;
  applyAppearance();
}
function refreshClock(){
  const now=new Date();
  $('#home-clock').textContent=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  $('#home-clock').dateTime=now.toISOString();
  $('#today-label').textContent=`${now.getMonth()+1}月${now.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][now.getDay()]}`;
  $('#year-label').textContent=now.getFullYear();
  const monday=new Date(now);monday.setDate(now.getDate()-(now.getDay()+6)%7);
  $('#week-strip').innerHTML=['一','二','三','四','五','六','日'].map((label,i)=>{const date=new Date(monday);date.setDate(monday.getDate()+i);return `<li class="${localDate(date)===localDate(now)?'today':''}" ${localDate(date)===localDate(now)?'aria-current="date"':''}><span>${label}</span>${date.getDate()}</li>`;}).join('');
}
function renderMessages(){
  const list=$('#message-list');
  list.innerHTML='';let lastDate='';
  state.messages.forEach(message=>{
    const day=localDate(new Date(message.at));
    const label=message.example?'示例对话':day===localDate()?'今天':day.replaceAll('-','.');
    if(label!==lastDate){const date=document.createElement('p');date.className='chat-date';date.textContent=label;list.append(date);lastDate=label;}
    const row=document.createElement('article');row.className=`message ${message.role==='user'?'sent':'received'}`;
    row.setAttribute('aria-label',message.role==='user'?'我':state.profile.name);
    if(message.role==='character'){const img=document.createElement('img');img.className='avatar';img.src=AVATARS[state.appearance.avatar];img.alt=`${state.profile.name}的头像`;row.append(img);}
    const content=document.createElement('div');content.className='message-content';
    const bubble=document.createElement('p');bubble.className='bubble';bubble.textContent=message.text;
    const time=document.createElement('p');time.className='message-time';time.textContent=new Date(message.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
    content.append(bubble,time);row.append(content);list.append(row);
  });
  if(state.pending){const typing=document.createElement('p');typing.className='typing';typing.textContent='正在写一条演示回复…';typing.setAttribute('role','status');list.append(typing);}
  $('.send-button').disabled=!!state.pending||!$('#message-input').value.trim();
}
function bottom(){requestAnimationFrame(()=>{const list=$('#message-list');list.scrollTop=list.scrollHeight;});}
function fitInput(){const el=$('#message-input');el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,138)}px`;$('.send-button').disabled=!!state.pending||!el.value.trim();}
function showChat(){
  $('#home-view').hidden=true;$('#chat-view').hidden=false;
  $('#message-input').value=state.draft;renderMessages();fitInput();bottom();
  $('#draft-status').textContent=state.draft?'草稿已保存在本机':'对话保存在本机';
}
function showHome(){$('#chat-view').hidden=true;$('#home-view').hidden=false;renderHome();requestAnimationFrame(()=>goHomePage(homePage,false));}
function scheduleReply(){
  clearTimeout(replyTimer);
  if(!state.pending)return;
  replyTimer=setTimeout(()=>{completeReply(state);persist();renderMessages();renderHome();bottom();},Math.max(0,state.pending.dueAt-Date.now()));
}

function openSheet(type,title,kicker,html){
  if(previewAppearance){previewAppearance=null;applyAppearance();}
  sheetType=type;$('#sheet-title').textContent=title;$('#sheet-kicker').textContent=kicker;$('#sheet-body').innerHTML=html;
  if(!dialog.open)dialog.showModal();else $('#close-sheet').focus();dialog.scrollTop=0;
}
function closeSheet(){dialog.close();}
dialog.addEventListener('close',()=>{if(previewAppearance){previewAppearance=null;applyAppearance();}sheetType='';});
$('#close-sheet').addEventListener('click',closeSheet);
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSheet();});

function showAppearance(){
  openSheet('appearance','把喜欢设成日常','make it yours',`
    <p class="hint">切换后立即预览，保存后下次打开沿用。</p>
    <span class="field-label">光线与颜色</span><div class="segmented"><button class="choice" data-theme-choice="light" aria-pressed="${state.appearance.theme==='light'}">${icon('sun')}日光</button><button class="choice" data-theme-choice="dark" aria-pressed="${state.appearance.theme==='dark'}">${icon('moon')}夜色</button></div>
    <label class="switch-row"><span>轻玻璃<small>关掉后使用实色卡片</small></span><input class="switch" type="checkbox" id="blur-choice" aria-label="轻玻璃效果" ${state.appearance.blur?'checked':''}></label>
    <span class="field-label">角色头像</span><div class="avatar-options">${Object.entries(AVATARS).map(([key,src])=>`<button class="avatar-option" data-avatar-choice="${key}" aria-pressed="${state.appearance.avatar===key}"><img src="${src}" alt="${key==='flowers'?'花与少年':'飞鸟来信'}">${key==='flowers'?'花与少年':'飞鸟来信'}</button>`).join('')}</div>
    <label class="field-label" for="font-scale">阅读字号</label><select id="font-scale" class="text-field"><option value="1">标准 · 100%</option><option value="1.5">大字 · 150%</option><option value="2">特大 · 200%</option></select>
    <div class="sheet-actions"><button class="secondary" data-action="cancel">取消</button><button class="primary" data-action="save-appearance">保存外观</button></div>
    <p class="font-state" id="font-state">正在检查本地字体…</p>`);
  previewAppearance=copy(state.appearance);
  $('#font-scale').value=state.appearance.fontScale;
  document.fonts.ready.then(()=>{
    if(sheetType!=='appearance')return;
    const results=[['Noto Sans SC','400 15px "Noto Sans SC"','聊天 Aa 123'],['Noto Serif SC','700 17px "Noto Serif SC"','林屿']].map(([name,font,text])=>`${name} ${document.fonts.check(font,text)?'已载入':'使用系统字体'}`);
    $('#font-state').textContent=results.join(' · ');
  });
}
function showNote(){
  openSheet('note','给今天留一句话','a note to today',`<p class="hint">保存的文字会出现在首页纸条上。</p><form id="note-form"><label class="field-label" for="note-input">今天想记下什么</label><textarea class="text-field" id="note-input" maxlength="160" placeholder="一点心情，一个小愿望…">${esc(state.note)}</textarea><p class="font-state">${state.noteUpdatedAt?'上次保存：'+esc(new Date(state.noteUpdatedAt).toLocaleString('zh-CN')):'初始纸条 · 可以换成自己的话'}</p><div class="sheet-actions"><button class="secondary" type="button" data-action="cancel">取消</button><button class="primary" type="submit">保存纸条</button></div></form>`);
}
function showProfile(){
  openSheet('profile','角色资料','character',`<div class="profile-hero"><img class="avatar" src="${AVATARS[state.appearance.avatar]}" alt="${esc(state.profile.name)}的头像"><h3 class="serif">${esc(state.profile.name)}</h3><p>当前样品角色</p></div><div class="companion-count"><b>${companionDays(state.profile.metOn)}</b><span>天</span><p>从 ${esc(state.profile.metOn.replaceAll('-','.'))} 开始相遇</p></div><form id="profile-form"><label class="field-label" for="character-name">角色称呼</label><input class="text-field" id="character-name" value="${esc(state.profile.name)}" maxlength="30" required><label class="field-label" for="meeting-date">相遇日期</label><input class="text-field" id="meeting-date" type="date" value="${state.profile.metOn}" max="${localDate()}" min="1900-01-01" required><div class="sheet-actions"><button class="primary" type="submit">保存角色资料</button></div></form><button class="subtle-button" data-action="profile-chat">打开聊天</button>`);
}
function showAlbum(){
  openSheet('album','收藏的画面','little gallery',`<p class="hint">你提供的壁纸与头像。点开可以查看完整原图。</p><div class="album-grid">${[['wallpaper-ribbon.png','蓝色丝带 · 当前壁纸'],['portrait-flowers.png','花与少年 · 头像'],['portrait-birds.png','飞鸟来信 · 头像']].map(([src,name])=>`<a class="album-item" href="assets/${src}" target="_blank" rel="noopener"><img src="assets/${src}" alt="${name}"><span>${name}</span></a>`).join('')}</div>`);
}
function showCalendar(){calendarOffset=0;openSheet('calendar','日子慢慢过','days with you','');renderCalendar();}
function renderCalendar(){
  const month=new Date();month.setDate(1);month.setMonth(month.getMonth()+calendarOffset);
  const leading=(month.getDay()+6)%7;const length=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  let cells=['一','二','三','四','五','六','日'].map(d=>`<span class="day-name">${d}</span>`).join('')+'<span></span>'.repeat(leading);
  for(let d=1;d<=length;d++){const value=localDate(new Date(month.getFullYear(),month.getMonth(),d));cells+=`<span class="${value===localDate()?'current-day ':''}${value===state.profile.metOn?'meeting-day':''}" ${value===localDate()?'aria-current="date"':''}>${d}</span>`;}
  $('#sheet-body').innerHTML=`<div class="calendar-title"><button class="icon-button" data-action="previous-month" aria-label="上个月">${icon('back')}</button><strong>${month.getFullYear()}年${month.getMonth()+1}月</strong><button class="icon-button" data-action="next-month" aria-label="下个月">${icon('arrow')}</button></div><div class="calendar-grid">${cells}</div><p class="calendar-caption">今天是相遇的第 ${companionDays(state.profile.metOn)} 天。<br>相遇日：${state.profile.metOn.replaceAll('-','.')}</p><button class="subtle-button" data-action="calendar-today">回到本月</button>`;
}
function showMusic(){
  openSheet('music','给日常一点声音','a quiet moment',`<img class="big-cover" src="assets/portrait-birds.png" alt="飞鸟插画封面"><h3 class="player-title">午后片刻</h3><p class="player-subtitle">原创样品轻音 · 24秒 · 本地播放</p><label class="sr-only" for="seek">播放进度</label><input class="player-range" id="seek" type="range" min="0" max="24" step=".1" value="${audio.currentTime}"><div class="player-times"><span data-elapsed>0:00</span><span>0:24</span></div><div class="player-buttons"><button class="icon-button" data-action="replay" aria-label="从头播放">${icon('replay')}</button><button class="play-button" data-action="play" aria-label="播放样品轻音">${icon('play')}</button><button class="icon-button" data-action="music-home" aria-label="回到首页继续听">${icon('chat')}</button></div><label class="volume-row" for="volume">音量<input id="volume" type="range" min="0" max="1" step=".05" value="${audio.volume}"></label><p class="hint">切换页面会继续播放，进度跟随实际音频。</p>`);updateAudio();
}
function showSettings(){
  openSheet('settings','设置','settings',`<button class="setting-link" data-action="appearance"><span>${icon('theme')}外观</span>${icon('arrow')}</button><p class="hint">主题、头像、阅读字号与玻璃效果。</p><form id="widgets-form"><label class="switch-row"><span>桌面音乐组件</span><input class="switch" id="music-visible" type="checkbox" ${state.widgets.music?'checked':''} aria-label="显示音乐组件"></label><div class="sheet-actions"><button class="primary" type="submit">保存布局</button></div></form><span class="field-label">样品记录</span><button class="secondary" data-action="export">${icon('download')}导出样品记录</button><p class="font-state">当前样品使用本地演示回复。API、多角色与世界设置已纳入新版功能方案。</p>`);
}
function fillQuickReply(text){
  state.draft=text;$('#message-input').value=text;
  const saved=persist();fitInput();$('#message-input').focus();
  $('#draft-status').textContent=saved?'已填入草稿，点箭头发送':'草稿暂存在本页';
}
function savePlayback(){
  if(!audioRestored)return;
  state.playback={position:audio.currentTime||0,volume:audio.volume};persist();
}
function updateAudio(){
  const current=Math.floor(audio.currentTime||0);const elapsed=`${Math.floor(current/60)}:${String(current%60).padStart(2,'0')}`;
  $$('[data-elapsed]').forEach(el=>el.textContent=elapsed);
  $$('[data-progress]').forEach(el=>el.style.width=`${Math.min(100,(audio.currentTime/(audio.duration||24))*100)}%`);
  $$('[data-action="play"]').forEach(button=>{button.setAttribute('aria-label',audio.paused?'播放样品轻音':'暂停样品轻音');button.innerHTML=icon(audio.paused?'play':'pause');});
  if($('#seek'))$('#seek').value=audio.currentTime;
}
async function toggleAudio(){
  if(audio.paused){try{if(audio.ended)audio.currentTime=0;await audio.play();}catch{toast('轻音暂时无法播放，请重新点一下播放。');}}
  else audio.pause();updateAudio();
}
['timeupdate','play','pause','loadedmetadata','ended'].forEach(event=>audio.addEventListener(event,updateAudio));
function restoreAudio(){audio.currentTime=Math.min(state.playback.position,audio.duration||24);audioRestored=true;updateAudio();}
if(audio.readyState>=1)restoreAudio();else audio.addEventListener('loadedmetadata',restoreAudio,{once:true});
audio.addEventListener('timeupdate',()=>{const second=Math.floor(audio.currentTime);if(!audio.paused&&second!==lastSavedSecond){lastSavedSecond=second;savePlayback();}});
['pause','ended','volumechange','seeked'].forEach(event=>audio.addEventListener(event,savePlayback));
window.addEventListener('pagehide',savePlayback);
audio.addEventListener('error',()=>toast('轻音文件没有加载成功，请刷新后再试。'));

document.addEventListener('click',event=>{
  const draftButton=event.target.closest('[data-draft]');
  if(draftButton){
    const draft=draftButton.dataset.draft;
    if(state.draft.trim()&&state.draft!==draft){pendingQuickReply=draft;openSheet('quick-reply','草稿里还有一句话','keep your words',`<p class="hint">原来的草稿会保留。可以把这句接在后面。</p><p class="draft-preview">${esc(state.draft)}</p><p class="hint">准备加入：${esc(draft)}</p><div class="sheet-actions"><button class="secondary" data-action="cancel">保留原草稿</button><button class="primary" data-action="append-quick-reply">接在后面</button></div>`);}
    else fillQuickReply(draft);
    return;
  }
  const theme=event.target.closest('[data-theme-choice]');
  if(theme&&previewAppearance){previewAppearance.theme=theme.dataset.themeChoice;$$('[data-theme-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el===theme)));applyAppearance(previewAppearance);return;}
  const avatar=event.target.closest('[data-avatar-choice]');
  if(avatar&&previewAppearance){previewAppearance.avatar=avatar.dataset.avatarChoice;$$('[data-avatar-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el===avatar)));applyAppearance(previewAppearance);return;}
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(!action)return;
  const actions={chat:showChat,home:showHome,appearance:showAppearance,note:showNote,profile:showProfile,album:showAlbum,calendar:showCalendar,music:showMusic,settings:showSettings,cancel:closeSheet,play:toggleAudio,
    'save-appearance':()=>{if(!commitSettings({appearance:copy(previewAppearance)}))return;previewAppearance=null;closeSheet();renderHome();toast('新的外观已保存');},
    'append-quick-reply':()=>{const value=`${state.draft}\n${pendingQuickReply}`;if(value.length>4000){toast('草稿快写满了，先整理一下再加入');return;}closeSheet();fillQuickReply(value);},
    'profile-chat':()=>{closeSheet();showChat();},
    'music-home':()=>{closeSheet();showHome();},
    'previous-month':()=>{calendarOffset--;renderCalendar();},'next-month':()=>{calendarOffset++;renderCalendar();},'calendar-today':()=>{calendarOffset=0;renderCalendar();},
    'replay':()=>{audio.currentTime=0;if(audio.paused)toggleAudio();else updateAudio();},
    'export':()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`轻玻璃样品记录-${localDate()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  };actions[action]?.();
});
document.addEventListener('change',event=>{
  if(event.target.id==='blur-choice'&&previewAppearance){previewAppearance.blur=event.target.checked;applyAppearance(previewAppearance);}
  if(event.target.id==='font-scale'&&previewAppearance){previewAppearance.fontScale=Number(event.target.value);applyAppearance(previewAppearance);}
});
document.addEventListener('input',event=>{
  if(event.target.id==='seek')audio.currentTime=Math.min(Number(event.target.value),Number.isFinite(audio.duration)?audio.duration:24);
  if(event.target.id==='volume')audio.volume=Number(event.target.value);
});
document.addEventListener('submit',event=>{
  const id=event.target.id;event.preventDefault();
  if(id==='composer'){
    if(!sendMessage(state,$('#message-input').value,crypto.randomUUID()))return;
    const saved=persist();$('#message-input').value='';fitInput();renderMessages();bottom();scheduleReply();$('#draft-status').textContent=saved?'对话保存在本机':'对话暂存在本页';return;
  }
  if(id==='note-form'){if(!commitSettings({note:$('#note-input').value.trim(),noteUpdatedAt:Date.now()}))return;closeSheet();renderHome();toast('这句话留在首页了');}
  if(id==='profile-form'){
    const name=$('#character-name').value.trim();const date=$('#meeting-date').value;
    if(!name){$('#character-name').setCustomValidity('写一个称呼吧');$('#character-name').reportValidity();return;}
    if(!validDate(date)||date>localDate()){toast('请选今天或更早的相遇日期');return;}
    if(!commitSettings({profile:{name,metOn:date}}))return;closeSheet();renderHome();renderMessages();toast('角色资料已保存');
  }
  if(id==='widgets-form'){if(!commitSettings({widgets:{...state.widgets,music:$('#music-visible').checked}}))return;closeSheet();renderHome();toast('桌面布局已保存');}
});
document.addEventListener('input',event=>{if(event.target.id==='character-name')event.target.setCustomValidity('');});
$('#message-input').addEventListener('input',()=>{state.draft=$('#message-input').value;const saved=persist();fitInput();$('#draft-status').textContent=state.draft?(saved?'草稿已保存在本机':'草稿暂存在本页'):'对话保存在本机';});
$('#message-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#composer').requestSubmit();}});
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY||!event.newValue)return;
  try{state=normalizeState(JSON.parse(event.newValue));renderHome();if(!$('#chat-view').hidden){$('#message-input').value=state.draft;renderMessages();fitInput();bottom();}scheduleReply();}catch{}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshClock();scheduleReply();}});
const pages=$('#home-pages');
let homePage=0;
function syncPageControls(){
  homePage=Math.max(0,Math.min(1,Math.round(pages.scrollLeft/Math.max(1,pages.clientWidth))));
  $$('[data-home-page]').forEach(button=>{if(Number(button.dataset.homePage)===homePage)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
}
function goHomePage(index,smooth=true){
  homePage=Math.max(0,Math.min(1,index));
  pages.scrollTo({left:homePage*pages.clientWidth,behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
}
$$('[data-home-page]').forEach(button=>button.addEventListener('click',()=>goHomePage(Number(button.dataset.homePage))));
pages.addEventListener('scroll',syncPageControls,{passive:true});
pages.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();goHomePage(homePage+(event.key==='ArrowRight'?1:-1));}});
let dragStart=null;
let suppressHomeClickUntil=0;
pages.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button===0)dragStart={x:event.clientX,y:event.clientY,page:homePage};});
pages.addEventListener('pointerup',event=>{if(!dragStart)return;const dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;const original=dragStart.page;dragStart=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){event.preventDefault();suppressHomeClickUntil=performance.now()+300;goHomePage(original+(dx<0?1:-1));}});
pages.addEventListener('click',event=>{if(performance.now()<suppressHomeClickUntil){event.preventDefault();event.stopPropagation();}},true);
pages.addEventListener('pointercancel',()=>dragStart=null);
new ResizeObserver(()=>{if(!$('#home-view').hidden)goHomePage(homePage,false);}).observe(pages);
renderHome();refreshClock();updateAudio();scheduleReply();
setInterval(()=>{if(!document.hidden)refreshClock();},20000);
if(startupMessage)toast(startupMessage);
