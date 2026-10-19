export const PERSONAL_SCOPE = 'personal-phone';

// PhoneStore keeps an untouched recovery point before installing this migration.
export function upgradePersonalPhone(state, makeScope, defaultAppearance) {
  if (state.phone) return state;
  const owner = state.roles.find(r => r.id === state.activeId) || state.roles[0];
  const oldKey = owner ? `${owner.id}::${owner.worldId}` : null;
  const worldId = owner?.worldId || state.worlds[0]?.id;
  if (!worldId) throw Error('备份缺少世界背景');
  const merged = makeScope('user', worldId);
  const scopes = Object.entries(state.scopes).sort(([a], [b]) => Number(b === oldKey) - Number(a === oldKey));
  const used = new Map(), draftCopies = [];
  let openListening=false;
  const unique = (type, old, index) => {
    const taken = used.get(type) || new Set(); used.set(type, taken);
    let result = old, n = 0;
    while (taken.has(result)) result = `${old.slice(0, 130)}-legacy-${index}-${++n}`;
    taken.add(result); return result;
  };
  for (const [index, [sourceKey, scope]] of scopes.entries()) {
    const rows = {
      chat: scope.chats, message: scope.chats.flatMap(c => c.messages),
      post: scope.posts, comment: scope.posts.flatMap(p => p.comments),
      diary: scope.diaries, memory: scope.memories, event: scope.events,
      task: scope.tasks, listening: scope.listening
    };
    const entries = {}, assigned = new Map(), parents = new Map();
    for (const c of scope.chats) for (const m of c.messages) parents.set(m,c);
    for (const p of scope.posts) for (const c of p.comments) parents.set(c,p);
    for (const [type, records] of Object.entries(rows)) entries[type] = records.map(record => {
      const next = unique(type,record.id,index);assigned.set(record,next);
      return {record, old:record.id, next, parent:parents.get(record), version:record.updatedAt||record.at};
    });
    const find = (type,old,version,parent) => {
      const candidates = (entries[type]||[]).filter(e=>e.old===old);
      return (candidates.find(e=>parent&&e.parent===parent&&(!version||e.version===version))||candidates.find(e=>version&&e.version===version)||candidates[0]);
    };
    const mapped = (type,old,version,parent) => find(type,old,version,parent)?.next||old;
    const ref = (r,parent) => ({...r,id:mapped(r.type,r.id,r.version,parent)});
    for (const [type, records] of Object.entries(rows)) for (const record of records) {
      const parent = type==='task'?find(record.kind==='comment'?'post':'chat',record.targetId)?.record:parents.get(record);
      for (const field of ['sourceRefs','originalSources']) if (record[field]) record[field] = record[field].map(r=>ref(r,parent));
      if (record.taskId) record.taskId = mapped('task',record.taskId);
      if (record.replyTo) record.replyTo = mapped(type==='comment'||record.kind==='comment'?'comment':'message',record.replyTo,null,parent);
      if (type === 'task') {
        if (record.targetId) record.targetId = mapped(record.kind==='comment'?'post':'chat',record.targetId);
        if (record.sourceId) record.sourceId = mapped('message',record.sourceId,null,parent);
        if (record.eventId) record.eventId = mapped('event',record.eventId);
        if (record.trace?.memoryIds) record.trace.memoryIds=record.trace.memoryIds.map(id=>mapped('memory',id));
      }
      record.id=assigned.get(record);
      record.originWorldId ??= scope.worldId;
    }
    for (const chat of scope.chats) {
      if (merged.chats.some(c => c.kind==='private'&&chat.kind==='private'&&c.members[0]===chat.members[0])) chat.legacyLabel=`旧会话 · ${state.worlds.find(w=>w.id===scope.worldId)?.name||'日常'}`;
    }
    for (const l of scope.listening) if (!l.endedAt) {if(sourceKey!==oldKey||openListening)l.endedAt=Date.now();else openListening=true;}
    for (const field of ['chats','posts','diaries','memories','events','tasks','listening']) merged[field].push(...scope[field]);
    merged.favorites.push(...scope.favorites.map(r=>ref(r)));
    merged.reminders.push(...(scope.reminders||[]).map(r=>({...r,eventId:mapped('event',r.eventId)})));
    merged.playlist=[...new Set([...merged.playlist,...scope.playlist])];
    if (sourceKey===oldKey) merged.playback={...scope.playback};
    for (const [key,value] of Object.entries(scope.drafts||{})) {
      const separator=key.indexOf(':'),name=key.slice(0,separator),old=key.slice(separator+1);
      const type={'world-form':'world','role-form':'role','post-form':'post','comment-form':'post','diary-form':'diary','memory-form':'memory','event-form':'event','edit-message':'message'}[name];
      const target=old==='new'?old:mapped(type,old),newKey=`${name}:${target}`;
      if (name==='role-form'&&!value.worldMode) value.worldMode=Array.isArray(value.worldEnabled)&&!value.worldEnabled.length?'off':value.worldId&&value.worldId!==worldId?'own':'inherit';
      if (!(newKey in merged.drafts)) merged.drafts[newKey]=value;
      else if (JSON.stringify(merged.drafts[newKey])!==JSON.stringify(value)) draftCopies.push({sourceKey,key:newKey,value});
    }
  }
  state.phone={worldId,worldEnabled:owner?.worldEnabled!==false,appearance:{...defaultAppearance,...owner?.appearance}};
  state.user={name:'我',description:'',avatar:'builtin-birds',...state.user};
  for (const role of state.roles) role.worldMode=role.worldEnabled===false?'off':role.worldId!==worldId?'own':'inherit';
  state.scopes={[PERSONAL_SCOPE]:merged};
  state.version=3;
  state.migration={...state.migration,personalPhone:{from:2,at:Date.now(),scopeCount:scopes.length,draftCopies}};
  return state;
}
