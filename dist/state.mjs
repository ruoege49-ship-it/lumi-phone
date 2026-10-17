export const STORAGE_KEY = 'lumi.lightglass.sample.v1';
export const AVATARS = Object.freeze({flowers:'assets/portrait-flowers.png',birds:'assets/portrait-birds.png'});
export function localDate(now = new Date()) {return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}
export function companionDays(start, now = new Date()) {
  if (!validDate(start)) return 1;
  const [y,m,d] = start.split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(y,m-1,d))/86400000)+1);
}
export function createState(now = new Date()) {
  return {version:1, appearance:{theme:'light',blur:true,avatar:'flowers',fontScale:1},profile:{name:'林屿',metOn:localDate(now)},widgets:{character:true,music:true},playback:{position:0,volume:.35},note:'今天也有好心情',noteUpdatedAt:null,draft:'',pending:null,messages:[
    {id:'seed-1',role:'character',text:'我把今天的一小段时间留给你了。',at:now.getTime()-180000,example:true},
    {id:'seed-2',role:'user',text:'那先陪我待一会儿吧。',at:now.getTime()-120000,example:true},
    {id:'seed-3',role:'character',text:'好呀。不着急，慢慢说，我在听。',at:now.getTime()-60000,example:true}
  ]};
}
export function normalizeState(raw,now = new Date()) {
  const fresh = createState(now);
  if (!raw || raw.version!==1 || !Array.isArray(raw.messages)) throw new Error('样品记录格式不正确');
  const messages = raw.messages.filter(m=>m && typeof m.id==='string' && ['user','character'].includes(m.role) && typeof m.text==='string' && Number.isFinite(m.at)).map(m=>({id:m.id,role:m.role,text:m.text.slice(0,4000),at:m.at,example:m.example===true,...(typeof m.replyTo==='string'?{replyTo:m.replyTo}:{})}));
  const ids = new Set();
  fresh.messages = messages.filter(m=>ids.has(m.id)?false:(ids.add(m.id),true));
  const a = raw.appearance || {};
  fresh.appearance={theme:a.theme==='dark'?'dark':'light',blur:a.blur!==false,avatar:AVATARS[a.avatar]?a.avatar:'flowers',fontScale:[1,1.5,2].includes(a.fontScale)?a.fontScale:1};
  if (typeof raw.profile?.name==='string' && raw.profile.name.trim()) fresh.profile.name=raw.profile.name.trim().slice(0,30);
  if (validDate(raw.profile?.metOn) && raw.profile.metOn<=localDate(now)) fresh.profile.metOn=raw.profile.metOn;
  fresh.widgets={character:raw.widgets?.character!==false,music:raw.widgets?.music!==false};
  fresh.playback={position:Number.isFinite(raw.playback?.position)?Math.min(24,Math.max(0,raw.playback.position)):0,volume:Number.isFinite(raw.playback?.volume)?Math.min(1,Math.max(0,raw.playback.volume)):.35};
  if (typeof raw.note==='string') fresh.note=raw.note.slice(0,160);
  if (typeof raw.noteUpdatedAt==='number') fresh.noteUpdatedAt=raw.noteUpdatedAt;
  if (typeof raw.draft==='string') fresh.draft=raw.draft.slice(0,4000);
  if (raw.pending && typeof raw.pending.messageId==='string' && fresh.messages.some(m=>m.id===raw.pending.messageId && m.role==='user') && !fresh.messages.some(m=>m.replyTo===raw.pending.messageId)) fresh.pending={messageId:raw.pending.messageId,dueAt:Number.isFinite(raw.pending.dueAt)?raw.pending.dueAt:now.getTime()};
  return fresh;
}
export function sendMessage(state,text,id,now = Date.now()) {
  const value=text.trim().slice(0,4000);
  if (!value || state.pending) return false;
  state.messages.push({id,role:'user',text:value,at:now});
  state.draft='';
  state.pending={messageId:id,dueAt:now+750};
  return true;
}
export function completeReply(state,now = Date.now()) {
  if (!state.pending) return false;
  const {messageId}=state.pending;
  const source=state.messages.find(m=>m.id===messageId && m.role==='user');
  state.pending=null;
  if (!source || state.messages.some(m=>m.replyTo===messageId)) return false;
  const text=/听|歌|音乐/.test(source.text)?'好呀。点开音乐，我们把这段轻音一起听完。':/想你/.test(source.text)?'我也在这里，等你把今天的故事讲给我听。':/今天|怎么样/.test(source.text)?'今天最期待的，就是这样和你聊一会儿。你呢，有没有遇到一点小开心？':/晚安|睡/.test(source.text)?'那就把今天轻轻放下。晚安，愿你有个柔软的梦。':'嗯，我在听。慢慢说，今天的时间还很长。';
  state.messages.push({id:`reply-${messageId}`,role:'character',text,at:now,replyTo:messageId});
  return true;
}
