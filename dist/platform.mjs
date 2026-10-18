// Android exposes the bridge only to the app's bundled HTTPS origin.
const pending=new Map(),chunks=new Map();
export const isAndroid=()=>typeof globalThis.LumiNative?.request==='function';
globalThis.__lumiNativeChunk=(id,part,last)=>{
  if(!pending.has(id))return;
  const list=chunks.get(id)||[];list.push(part);chunks.set(id,list);
  if(!last)return;
  chunks.delete(id);const task=pending.get(id);pending.delete(id);task.cleanup();
  try{const value=JSON.parse(list.join(''));value.error?task.reject(Error(value.error)):task.resolve(value);}catch(error){task.reject(error);}
};
export function nativeCall(method,args=[],signal,timeout=105000){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason||new DOMException('已停止','AbortError'));return;}
    const id=crypto.randomUUID();let timer;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{if(!pending.has(id))return;pending.delete(id);chunks.delete(id);cleanup();globalThis.LumiNative.cancel(id);reject(signal?.reason||new DOMException('请求超时或已停止','AbortError'));};
    pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,timeout);
    try{globalThis.LumiNative[method](id,...args);}catch(error){pending.delete(id);cleanup();reject(error);}
  });
}
export function bytesBase64(bytes){let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);}
export async function nativeFetch(url,options,signal){
  const request=new Request(url,options),body=request.method==='GET'?'':bytesBase64(new Uint8Array(await request.arrayBuffer()));
  const result=await nativeCall('request',[JSON.stringify({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body})],signal);
  return new Response(Uint8Array.from(atob(result.body||''),c=>c.charCodeAt(0)),{status:result.status,headers:{'Content-Type':result.type||'application/json'}});
}
export async function saveJSON(value,name){
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  if(!isAndroid()){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}
  const choice=await nativeCall('saveBegin',[name,'application/json'],undefined,600000);
  if(choice.cancelled)return false;
  try{
    for(let offset=0;offset<blob.size;offset+=196608){
      const encoded=bytesBase64(new Uint8Array(await blob.slice(offset,offset+196608).arrayBuffer()));
      if(!globalThis.LumiNative.saveChunk(choice.handle,encoded))throw Error('备份写入失败，请检查剩余空间');
    }
    const result=await nativeCall('saveFinish',[choice.handle]);return result.saved===true;
  }catch(error){globalThis.LumiNative.saveCancel(choice.handle);throw error;}
}
