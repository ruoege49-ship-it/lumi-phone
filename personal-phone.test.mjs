import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './dist/model.mjs';
import {renderPanel} from './dist/views.mjs';
import {GenerationEngine} from './dist/engine.mjs';

test('empty phone can open every personal app without an owner contact',()=>{
 const s=M.createPersonalPhone();assert.equal(s.roles.length,0);assert.equal(M.scopeFor(s).chats.length,0);
 for(const name of ['chats','roles','role-form','moments','diary','calendar','settings','appearance','identity','worlds','album','music','tasks','new-chat','new-group']){
  const panel=renderPanel(s,{name,key:M.activeKey(s)});assert.ok(panel.title);assert.ok(!panel.html.includes('进入这部手机'));assert.ok(!panel.html.includes('切换角色手机'));
 }
 const form=renderPanel(s,{name:'role-form'}).html;assert.ok(form.includes('从图库选择'));assert.ok(!form.includes('<select class="text-field" id="f-avatar"'));assert.ok(form.includes('设置背景'));
});

test('global and contact background choices reach the actual generation request',async()=>{
 const s=M.createPersonalPhone();s.worlds[0].body='GLOBAL-WORLD';s.worlds.push({id:'own',name:'自己的背景',body:'CONTACT-WORLD',date:M.localDate(),timeMode:'real'});
 const id=M.addRole(s,{name:'联系人'}),role=s.roles[0],key=M.activeKey(s),chat=M.scopeFor(s).chats[0];s.connections.text={baseUrl:'https://example.test/v1',model:'test-model'};
 const sent=[];const store={state:s,async commit(fn){const value=fn(this.state);return {state:this.state,value};},async secret(){return '';}};
 const engine=new GenerationEngine(store,async(c,k,kind,payload)=>{sent.push(JSON.stringify(payload));return '回复';});
 for(const [mode,enabled] of [['inherit',true],['own',true],['off',true],['own',false]]){
  role.worldMode=mode;role.worldId='own';s.phone.worldEnabled=enabled;const task=M.createTask(s,key,{kind:'chat',authorId:id,targetId:chat.id});await engine.run(key,task.id);assert.equal(task.status,'done');
 }
 assert.ok(sent[0].includes('GLOBAL-WORLD'));assert.ok(!sent[0].includes('CONTACT-WORLD'));
 assert.ok(sent[1].includes('CONTACT-WORLD'));assert.ok(!sent[1].includes('GLOBAL-WORLD'));
 for(const text of sent.slice(2)){assert.ok(!text.includes('GLOBAL-WORLD'));assert.ok(!text.includes('CONTACT-WORLD'));}
});

function legacyFixture(){
 const s=M.createPhone();delete s.phone;s.version=2;const r=s.roles[0];r.id='first';r.worldId='daily';s.activeId='first';
 s.roles.push(M.makeRole({id:'second',name:'另一位',worldId:'other'}));s.worlds.push({id:'other',name:'旧故事',body:'',date:M.localDate(),timeMode:'real'});s.scopes={};
 for(const [i,world] of ['daily','other'].entries()){
  const sc=M.makeScope(i?'second':'first',world);s.scopes[`${sc.roleId}::${world}`]=sc;
  sc.chats.push({id:'chat',kind:'private',name:'原会话',members:['first'],messages:[{id:'message',text:'原话'+i,authorId:'first',authorName:'第一位',at:10+i,media:[],deleted:false}],draft:'聊天草稿'+i,draftMedia:[],readAt:0});
  sc.posts.push({id:'post',text:'原动态'+i,at:20+i,audience:['first'],likes:[],media:[],comments:[{id:'comment',text:'评论',at:30+i},{id:'reply',text:'回复',replyTo:'comment',at:40+i}]});
  sc.memories.push({id:'memory',text:'回忆'+i,participants:['first'],enabled:true,at:50+i,sourceRefs:[M.sourceRef('message',sc.chats[0].messages[0])]});
  sc.tasks.push({id:'task',kind:'comment',authorId:'first',targetId:'post',replyTo:'comment',status:'failed',trace:{memoryIds:['memory']},sourceRefs:[{type:'message',id:'message',version:10+i}]});
  sc.favorites.push({type:'message',id:'message'});sc.drafts['role-form:new']={name:'新朋友'+i,persona:'草稿'+i,worldId:world,worldEnabled:['on']};sc.drafts['post-form:post']={text:'编辑动态'+i};
  sc.playback.position=10+i;sc.listening.push({id:'listen',participants:['first'],tracks:['builtin-music'],seconds:30,at:1,endedAt:null});
 }
 return s;
}

test('v2 migration retains collisions, references, drafts, playback and an unchanged original',()=>{
 const raw=legacyFixture(),before=JSON.stringify(raw),s=M.validatePhone(raw),sc=M.scopeFor(s);assert.equal(JSON.stringify(raw),before);assert.equal(s.version,3);assert.equal(Object.keys(s.scopes).length,1);
 assert.equal(sc.chats.flatMap(c=>c.messages).length,2);assert.equal(new Set(sc.chats.flatMap(c=>c.messages.map(m=>m.id))).size,2);assert.deepEqual(sc.chats.filter(c=>c.messages.length).map(c=>c.draft),['聊天草稿0','聊天草稿1']);assert.ok(sc.chats[1].legacyLabel);
 for(const [i,m] of sc.memories.entries()){assert.ok(M.sourcesValid(sc,m));assert.equal(M.recordByRef(sc,m.sourceRefs[0]).text,'原话'+i);assert.equal(M.recordByRef(sc,sc.favorites[i]).text,'原话'+i);const p=sc.posts[i],t=sc.tasks[i];assert.equal(p.comments[1].replyTo,p.comments[0].id);assert.equal(t.replyTo,p.comments[0].id);assert.equal(t.targetId,p.id);assert.equal(t.trace.memoryIds[0],m.id);assert.equal(sc.drafts[`post-form:${p.id}`].text,'编辑动态'+i);}
 assert.equal(sc.playback.position,10);assert.equal(sc.listening.filter(l=>!l.endedAt).length,1);assert.equal(s.migration.personalPhone.draftCopies.length,1);assert.equal(s.migration.personalPhone.draftCopies[0].value.name,'新朋友1');assert.equal(sc.drafts['role-form:new'].name,'新朋友0');
 const prompt=JSON.stringify(M.buildPrompt(s,M.activeKey(s),{kind:'post',authorId:'first'}));assert.ok(prompt.includes('原话0'));assert.ok(!prompt.includes('原话1'));assert.ok(!prompt.includes('回忆1'));
 assert.deepEqual(M.validatePhone(s),s);
});

test('message IDs repeated across old conversations are unique after migration and keep reply parents',()=>{
 const raw=legacyFixture(),sc=raw.scopes['first::daily'];sc.chats.push({id:'group',kind:'group',name:'群',members:['first','second'],messages:[{id:'message',text:'群原文',authorId:'user',at:90,media:[]},{id:'answer',text:'群回复',authorId:'first',replyTo:'message',at:91,media:[]}],draft:'',draftMedia:[],readAt:0});sc.memories.push({id:'group-memory',text:'群回忆',participants:['first'],enabled:true,sourceRefs:[{type:'message',id:'message',version:90}]});
 const s=M.validatePhone(raw),merged=M.scopeFor(s),group=merged.chats.find(c=>c.id==='group');assert.equal(group.messages[1].replyTo,group.messages[0].id);assert.notEqual(group.messages[0].id,merged.chats[0].messages[0].id);assert.equal(M.recordByRef(merged,merged.memories.find(m=>m.id==='group-memory').sourceRefs[0]).text,'群原文');
});

test('personal avatar, settings, removed contact history and other pending replies survive reopening',()=>{
 const s=M.createPersonalPhone(),a=M.addRole(s,{name:'甲'}),b=M.addRole(s,{name:'乙'}),key=M.activeKey(s),sc=M.scopeFor(s);
 s.user.avatar='my-photo';s.media.push({id:'my-photo',type:'image/png',name:'自己的照片',category:'头像'});s.phone.appearance.theme='dark';const chat=sc.chats.find(c=>c.members[0]===a);M.addMessage(s,key,chat.id,'保留原文');const t=M.createTask(s,key,{kind:'chat',authorId:b,targetId:sc.chats.find(c=>c.members[0]===b).id});M.deleteRole(s,a);assert.equal(t.status,'waiting');
 const restored=M.validatePhone(s);assert.equal(restored.user.avatar,'my-photo');assert.equal(restored.phone.appearance.theme,'dark');assert.ok(M.scopeFor(restored).chats.flatMap(c=>c.messages).some(m=>m.text==='保留原文'));assert.ok(restored.roles.find(r=>r.id===a).deleted);assert.ok(M.scopeFor(restored).tasks.some(t=>t.authorId===b));
});
