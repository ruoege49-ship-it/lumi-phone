export function endpoint(baseUrl,kind='chat') {
  let url;try{url=new URL(baseUrl);}catch{throw Error('请填写完整的服务地址，例如 https://你的服务/v1');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('服务地址格式不正确');
  if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('远程服务请使用 HTTPS 地址');
  const suffix={chat:'chat/completions',speech:'audio/speech',transcription:'audio/transcriptions',models:'models'}[kind];
  const base=url.href.replace(/\/+$/,'').replace(/\/(chat\/completions|audio\/speech|audio\/transcriptions|models)$/,'');
  return `${base}/${suffix}`;
}
export async function callService(config,secret,kind,payload={},signal) {
  endpoint(config.baseUrl,kind);
  if(kind!=='models'&&!config.model?.trim())throw Error('请先选择或填写模型');
  const response=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,secret,kind,payload}),signal:signal||AbortSignal.timeout(100000)});
  if(!response.ok){const body=await response.json().catch(()=>({error:'服务暂时无法连接'}));throw Error(body.error||`请求失败（${response.status}）`);}
  if(kind==='speech')return response.blob();
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
