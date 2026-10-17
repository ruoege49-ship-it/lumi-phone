import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,normalizeState,sendMessage,completeReply,companionDays,validDate} from './dist/state.mjs';

test('calendar days are inclusive across month and year boundaries',()=>{
  assert.equal(companionDays('2026-12-31',new Date(2027,0,1,1)),2);
  assert.equal(companionDays('2024-02-28',new Date(2024,2,1)),3);
  assert.equal(validDate('2026-02-29'),false);
  assert.equal(validDate('2024-02-29'),true);
});
test('draft and customized data survive saving and reopening',()=>{
  const state=createState(new Date(2026,9,15));
  state.draft='还没有发出去的话';state.note='记住今天';state.appearance={theme:'dark',avatar:'birds',blur:false,fontScale:2};state.widgets.music=false;
  const restored=normalizeState(JSON.parse(JSON.stringify(state)),new Date(2026,9,16));
  assert.equal(restored.draft,state.draft);assert.equal(restored.note,state.note);assert.deepEqual(restored.appearance,state.appearance);assert.deepEqual(restored.widgets,state.widgets);assert.equal(restored.messages.length,3);
});
test('sending and reloading while reply is pending produces one linked reply',()=>{
  const state=createState();state.draft='陪我听歌';
  assert.equal(sendMessage(state,state.draft,'send-1',1000),true);assert.equal(state.draft,'');
  assert.equal(sendMessage(state,'不要重复','send-2',1010),false);
  const resumed=normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(completeReply(resumed,1800),true);assert.equal(completeReply(resumed,1900),false);
  assert.equal(resumed.messages.filter(m=>m.replyTo==='send-1').length,1);assert.equal(resumed.pending,null);
  assert.equal(resumed.messages.at(-1).text.includes('轻音'),true);
});
test('stale pending flag cannot duplicate a reply after reopening',()=>{
  const state=createState();sendMessage(state,'你好','m-1',1000);completeReply(state,1800);
  state.pending={messageId:'m-1',dueAt:1100};
  assert.equal(normalizeState(state).pending,null);
});
test('blank messages do not mutate the conversation',()=>{
  const state=createState();assert.equal(sendMessage(state,' \n ','empty'),false);assert.equal(state.messages.length,3);assert.equal(state.pending,null);
});
test('malformed stored preferences recover to supported values',()=>{
  const state=createState(new Date(2026,9,15));state.appearance={avatar:'untrusted',fontScale:99,theme:'invalid'};state.profile.metOn='2026-02-31';
  const result=normalizeState(state,new Date(2026,9,15));assert.equal(result.appearance.avatar,'flowers');assert.equal(result.appearance.fontScale,1);assert.equal(result.profile.metOn,'2026-10-15');
});
test('audio resume stores bounded position and volume without autoplay',()=>{
  const state=createState();state.playback={position:12.34,volume:.2};
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))).playback,state.playback);
  state.playback={position:Infinity,volume:4};assert.deepEqual(normalizeState(state).playback,{position:0,volume:1});
});
