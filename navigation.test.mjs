import test from 'node:test';
import assert from 'node:assert/strict';
import {PhoneNavigation} from './dist/navigation.mjs';

test('message settings return through the same conversation and list position',()=>{
  const nav=new PhoneNavigation();
  const list=nav.go({name:'chats',key:'a'});list.view={scroll:320};list.query='林';
  const chat=nav.go({name:'conversation',key:'a',id:'chat-a'});chat.view={scroll:640};
  nav.go({name:'chat-options',key:'a',id:'chat-a'});
  nav.go({name:'chat-search',key:'a',id:'chat-a'});
  assert.ok(nav.back());assert.equal(nav.current.name,'chat-options');
  assert.ok(nav.back());assert.equal(nav.current,chat);assert.equal(nav.current.view.scroll,640);
  assert.ok(nav.back());assert.equal(nav.current,list);assert.equal(nav.current.view.scroll,320);assert.equal(nav.current.query,'林');
  assert.ok(nav.back());assert.equal(nav.current.name,'home');assert.equal(nav.back(),false);
});

test('saving and message search jumps do not leave duplicate pages behind',()=>{
  const nav=new PhoneNavigation();nav.go({name:'chats',key:'a'});
  const chat=nav.go({name:'conversation',key:'a',id:'chat-a'});
  nav.go({name:'chat-options',key:'a',id:'chat-a'});
  nav.go({name:'chat-search',key:'a',id:'chat-a'});
  nav.go({name:'conversation',key:'a',id:'chat-a'});
  assert.equal(nav.current,chat);nav.back();assert.equal(nav.current.name,'chats');
});

test('temporary actions close to their owner and editors replace the action menu',()=>{
  const nav=new PhoneNavigation();nav.go({name:'chats',key:'a'});
  nav.go({name:'conversation',key:'a',id:'chat-a'});
  nav.go({name:'message-actions',key:'a',id:'message-a'});
  assert.equal(nav.page.name,'conversation');
  nav.go({name:'edit-message',key:'a',id:'message-a'});
  nav.back();assert.equal(nav.current.name,'conversation');
  nav.go({name:'chat-options',key:'a',id:'chat-a'});
  nav.go({name:'respond',key:'a',id:'chat-a'});nav.back();
  assert.equal(nav.current.name,'chat-options');
});

test('new chats and role switches never expose a completed form or previous phone',()=>{
  const nav=new PhoneNavigation();nav.go({name:'chats',key:'a'});
  nav.go({name:'chat-create',key:'a'});nav.go({name:'new-group',key:'a'});
  nav.go({name:'conversation',key:'a',id:'group-a'});nav.back();
  assert.equal(nav.current.name,'chats');
  nav.go({name:'role-switch',key:'a'});nav.reset([{name:'chats',key:'b'}]);
  assert.equal(nav.current.key,'b');nav.back();assert.equal(nav.current.name,'home');
  assert.equal(nav.entries.some(entry=>entry.key==='a'),false);
});

test('cancelling a confirmation retains its form and scope',()=>{
  const nav=new PhoneNavigation();nav.go({name:'roles',key:'a'});
  const form=nav.go({name:'role-form',key:'a',id:'role-a'});form.view={fields:[{name:'persona',value:'未保存的人设'}]};
  nav.go({name:'confirm',key:'a',action:'confirm-delete-role'});nav.back();
  assert.equal(nav.current,form);assert.equal(nav.current.view.fields[0].value,'未保存的人设');
});
