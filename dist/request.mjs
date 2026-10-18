export function endpoint(baseUrl,kind='chat') {
  let url;try{url=new URL(baseUrl);}catch{throw Error('请填写完整的服务地址，例如 https://你的服务/v1');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('服务地址格式不正确');
  if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('远程服务请使用 HTTPS 地址');
  const suffix={chat:'chat/completions',speech:'audio/speech',transcription:'audio/transcriptions',models:'models'}[kind];
  if(!suffix)throw Error('不支持的服务类型');
  const base=url.href.replace(/\/+$/,'').replace(/\/(chat\/completions|audio\/speech|audio\/transcriptions|models)$/,'');
  return `${base}/${suffix}`;
}
export function prepareRequest(config,secret,kind,payload={}){
  const url=endpoint(config.baseUrl,kind),headers={};let body;
  if(secret){if(typeof secret!=='string'||secret.length>4096||/[\r\n]/.test(secret))throw Error('密钥格式不正确');headers.Authorization=`Bearer ${secret}`;}
  if(kind==='chat'){
    if(!Array.isArray(payload.messages)||payload.messages.length>160||payload.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('消息格式不正确');
    body=JSON.stringify({model:config.model,messages:payload.messages,temperature:Math.max(0,Math.min(2,Number.isFinite(Number(config.temperature))?Number(config.temperature):.8)),max_tokens:Math.max(64,Math.min(8000,Number(config.maxTokens)||900)),stream:false});headers['Content-Type']='application/json';
  }else if(kind==='speech'){
    if(typeof payload.text!=='string'||payload.text.length>8000)throw Error('朗读文字最多 8000 字');
    body=JSON.stringify({model:config.model,voice:config.voice,input:payload.text,response_format:'mp3'});headers['Content-Type']='application/json';
  }else if(kind==='transcription'){
    if(typeof payload.audio!=='string'||!/^audio\/[\w.+;-]+$/.test(payload.type||''))throw Error('录音格式不正确');
    body=new FormData();body.set('model',config.model);body.set('file',new Blob([Uint8Array.from(atob(payload.audio),c=>c.charCodeAt(0))],{type:payload.type}),payload.name||'recording.webm');
  }
  return {url,options:{method:kind==='models'?'GET':'POST',headers,body,redirect:'error'}};
}
export function serviceError(status){return `${({401:'密钥无效或未授权',403:'服务拒绝访问',404:'地址或模型不存在',429:'额度不足或请求过快'})[status]||'服务返回错误'}（${status}），请检查设置`;}
