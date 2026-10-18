import {endpoint,prepareRequest,serviceError} from './request.mjs';
import {isAndroid,nativeFetch} from './platform.mjs';
export {endpoint} from './request.mjs';
export async function callService(config,secret,kind,payload={},signal) {
  endpoint(config.baseUrl,kind);
  if(kind!=='models'&&!config.model?.trim())throw Error('请先选择或填写模型');
  const android=isAndroid(),request=android?prepareRequest(config,secret,kind,payload):null;
  const response=android?await nativeFetch(request.url,request.options,signal):await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,secret,kind,payload}),signal:signal||AbortSignal.timeout(100000)});
  if(android&&!response.ok)throw Error(serviceError(response.status));
  if(!response.ok){const body=await response.json().catch(()=>({error:'服务暂时无法连接'}));throw Error(body.error||`请求失败（${response.status}）`);}
  if(kind==='speech'){const type=response.headers.get('content-type')||'';if(!type.startsWith('audio/')&&type!=='application/octet-stream')throw Error('服务没有返回音频');return response.blob();}
  const data=await response.json();
  if(kind==='models')return data.data?.map(m=>m.id).filter(Boolean)||[];
  if(kind==='transcription')return data.text||'';
  const content=data.choices?.[0]?.message?.content;
  const text=typeof content==='string'?content:Array.isArray(content)?content.map(c=>c.text||'').join(''):'';
  if(!text.trim())throw Error('模型没有返回文字，请检查模型与接口格式');
  return text.trim();
}
export function connectionFromJSON(raw) {
  const c=raw.text||raw.connection||raw;
  const baseUrl=String(c.baseUrl||c.base_url||c.apiUrl||c.endpoint||'').trim();
  endpoint(baseUrl);
  return {baseUrl,model:String(c.model||c.model_name||''),secret:String(c.apiKey||c.api_key||c.key||''),temperature:Number.isFinite(c.temperature)?c.temperature:.8,maxTokens:Number.isFinite(c.maxTokens)?c.maxTokens:900};
}
