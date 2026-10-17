import {createPhone,validatePhone,BUILTIN_MEDIA,clone} from './model.mjs';
import {STORAGE_KEY} from './state.mjs';
const DB_NAME='lumi.functional.phone.v2';
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completed=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('保存已取消'));});
export class PhoneStore {
  constructor(){this.urls=new Map();this.listeners=[];this.channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(DB_NAME):null;this.channel?.addEventListener('message',()=>this.read().then(s=>this.listeners.forEach(fn=>fn(s))));}
  async open(){
    const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{for(const name of ['records','media','secrets'])req.result.createObjectStore(name);};this.db=await request(req);
    let state=await this.read();
    if(!state){let legacy;const stored=localStorage.getItem(STORAGE_KEY);if(stored){try{legacy=JSON.parse(stored);}catch{throw Error('旧记录无法读取。原记录仍在，请先导出检查。');}}state=createPhone(legacy);await this.replace(state,false);}
    else {state=validatePhone(state);await this.replace(state,false);}
    return state;
  }
  async read(){return request(this.db.transaction('records','readonly').objectStore('records').get('state'));}
  async commit(mutator){
    const tx=this.db.transaction('records','readwrite'),done=completed(tx),records=tx.objectStore('records');
    try{const current=await request(records.get('state'));const next=clone(current);const value=mutator(next);if(value?.then)throw Error('保存操作必须同步');next.revision=(current.revision||0)+1;records.put(next,'state');await done;this.channel?.postMessage(next.revision);return {state:next,value};}
    catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
  }
  async replace(state,backup=true){const tx=this.db.transaction('records','readwrite'),done=completed(tx),records=tx.objectStore('records');if(backup){const old=await request(records.get('state'));if(old)records.put(old,`restore-${Date.now()}`);}records.put(state,'state');await done;this.channel?.postMessage(state.revision);}
  async secret(kind,baseUrl){const saved=await request(this.db.transaction('secrets','readonly').objectStore('secrets').get(kind));return saved?.baseUrl===baseUrl?saved.key:'';}
  async saveSecret(kind,key,baseUrl){const tx=this.db.transaction('secrets','readwrite'),done=completed(tx);key?tx.objectStore('secrets').put({key,baseUrl},kind):tx.objectStore('secrets').delete(kind);await done;}
  async putBlob(mediaId,blob){const tx=this.db.transaction('media','readwrite'),done=completed(tx);tx.objectStore('media').put(blob,mediaId);await done;}
  async blob(mediaId){return request(this.db.transaction('media','readonly').objectStore('media').get(mediaId));}
  async mediaURL(media){if(!media)return '';if(media.url)return media.url;if(this.urls.has(media.id))return this.urls.get(media.id);const blob=await this.blob(media.id);if(!blob)return '';const url=URL.createObjectURL(blob);this.urls.set(media.id,url);return url;}
  async export(){
    const state=validatePhone(await this.read()),attachments={};
    for(const media of state.media.filter(m=>!m.builtin&&!m.url)){const blob=await this.blob(media.id);if(!blob)throw Error(`附件缺失：${media.name}`);attachments[media.id]=await blobBase64(blob);}
    return {format:'lumi-phone-backup',version:2,exportedAt:new Date().toISOString(),state,attachments};
  }
  async restore(bundle){
    const state=validatePhone(bundle.state),blobs=[];if(bundle.format!=='lumi-phone-backup')throw Error('备份格式不正确');
    for(const media of state.media.filter(m=>!m.builtin&&!m.url)){const data=bundle.attachments?.[media.id];if(typeof data!=='string')throw Error(`缺少附件：${media.name}`);const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(bytes.length>30*1024*1024)throw Error('单个附件超过 30 MB');blobs.push([media.id,new Blob([bytes],{type:media.type})]);}
    // Records, originals, and the rollback snapshot are committed in one transaction.
    const tx=this.db.transaction(['records','media','secrets'],'readwrite'),done=completed(tx),records=tx.objectStore('records');
    const old=await request(records.get('state'));if(old)records.put({state:old,media:await request(tx.objectStore('media').getAll()),mediaKeys:await request(tx.objectStore('media').getAllKeys())},`restore-${Date.now()}`);
    for(const [key,blob] of blobs)tx.objectStore('media').put(blob,key);tx.objectStore('secrets').clear();state.revision=(old?.revision||0)+1;records.put(state,'state');await done;
    for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();this.channel?.postMessage(state.revision);return state;
  }
  async restorePoints(){const tx=this.db.transaction('records','readonly');return (await request(tx.objectStore('records').getAllKeys())).filter(k=>String(k).startsWith('restore-')).reverse();}
  async rollback(key){const saved=await request(this.db.transaction('records','readonly').objectStore('records').get(key));if(!saved)throw Error('恢复点不存在');if(saved.state){const attachments={};for(let i=0;i<saved.mediaKeys.length;i++)attachments[saved.mediaKeys[i]]=await blobBase64(saved.media[i]);return this.restore({format:'lumi-phone-backup',state:saved.state,attachments});}await this.replace(validatePhone(saved));return this.read();}
}
export function blobBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});}
export async function importMedia(store,file,category='照片'){
  if(!/^(image\/(png|jpeg|webp|gif)|audio\/[\w.+-]+)/.test(file.type))throw Error('支持 PNG、JPG、WebP、GIF 和音频文件');
  if(file.size>25*1024*1024)throw Error('每个附件请控制在 25 MB 内');
  const media={id:crypto.randomUUID(),name:file.name||'录音',type:file.type,size:file.size,at:Date.now(),category};await store.putBlob(media.id,file);return media;
}
