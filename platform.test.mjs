import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequest} from './dist/request.mjs';
import {nativeFetch,nativeCall,saveJSON} from './dist/platform.mjs';

function reply(id,value){const text=JSON.stringify(value);globalThis.__lumiNativeChunk(id,text.slice(0,9),false);globalThis.__lumiNativeChunk(id,text.slice(9),true);}
test('Android transport uses the saved model and headers, returns binary audio intact',async()=>{
  let captured;globalThis.LumiNative={request(id,raw){captured=JSON.parse(raw);queueMicrotask(()=>reply(id,{status:200,type:'audio/mpeg',body:'AAEC/w=='}));},cancel(){}};
  try{const {url,options}=prepareRequest({baseUrl:'https://example.test/v1',model:'chosen',voice:'soft'},'test-only','speech',{text:'早安'});const response=await nativeFetch(url,options);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,2,255]);assert.equal(captured.headers.authorization,'Bearer test-only');assert.equal(JSON.parse(Buffer.from(captured.body,'base64')).model,'chosen');assert.equal(captured.url,'https://example.test/v1/audio/speech');}finally{delete globalThis.LumiNative;}
});
test('Android cancellation rejects promptly and ignores late native replies',async()=>{
  let sent,cancelled;globalThis.LumiNative={request(id){sent=id;},cancel(id){cancelled=id;}};
  try{const controller=new AbortController(),result=nativeCall('request',['{}'],controller.signal);controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(cancelled,sent);reply(sent,{status:200});}finally{delete globalThis.LumiNative;}
});
test('transcription is real multipart with original binary audio and selected model',async()=>{
  const {url,options}=prepareRequest({baseUrl:'https://example.test/v1',model:'asr'},'test-only','transcription',{audio:'AAEC/w==',type:'audio/webm',name:'voice.webm'});const request=new Request(url,options);assert.match(request.headers.get('content-type'),/multipart\/form-data; boundary=/);const form=await request.formData();assert.equal(form.get('model'),'asr');assert.deepEqual([...new Uint8Array(await form.get('file').arrayBuffer())],[0,1,2,255]);
});
test('backup export waits for the Android document result and writes UTF-8 chunks',async()=>{
  const saved=[];globalThis.LumiNative={request(){},cancel(){},saveBegin(id){queueMicrotask(()=>reply(id,{handle:'file'}));},saveChunk(handle,chunk){saved.push(Buffer.from(chunk,'base64'));return true;},saveFinish(id){queueMicrotask(()=>reply(id,{saved:true}));},saveCancel(){}};
  try{const value={text:'中文'.repeat(80000)};assert.equal(await saveJSON(value,'backup.json'),true);assert.deepEqual(JSON.parse(Buffer.concat(saved).toString('utf8')),value);assert.ok(saved.length>1);globalThis.LumiNative.saveBegin=id=>queueMicrotask(()=>reply(id,{cancelled:true}));assert.equal(await saveJSON({},'cancel.json'),false);}finally{delete globalThis.LumiNative;}
});
test('Android native errors propagate instead of being reported as saved',async()=>{
  globalThis.LumiNative={request(id){queueMicrotask(()=>reply(id,{error:'服务连接失败'}));},cancel(){}};
  try{await assert.rejects(nativeCall('request',['{}']),/服务连接失败/);}finally{delete globalThis.LumiNative;}
});
