import {endpoint} from './dist/api.mjs';

export async function gateway(req,res){
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const host=req.headers.host||'';
  if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))return json(403,{error:'仅支持本机访问'});
  if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(403,{error:'来源不允许'});
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return json(405,{error:'请求格式不支持'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>36*1024*1024)throw Error('请求内容过大');chunks.push(chunk);}
    const {config,secret='',kind,payload={}}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!['chat','models','speech','transcription'].includes(kind))throw Error('不支持的服务类型');
    const target=endpoint(config.baseUrl,kind),headers={};
    if(secret){if(typeof secret!=='string'||secret.length>4096||/[\r\n]/.test(secret))throw Error('密钥格式不正确');headers.Authorization=`Bearer ${secret}`;}
    let body;
    if(kind==='chat'){
      if(!Array.isArray(payload.messages)||payload.messages.length>160||payload.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('消息格式不正确');
      body=JSON.stringify({model:config.model,messages:payload.messages,temperature:Math.max(0,Math.min(2,Number.isFinite(Number(config.temperature))?Number(config.temperature):.8)),max_tokens:Math.max(64,Math.min(8000,Number(config.maxTokens)||900)),stream:false});headers['Content-Type']='application/json';
    }else if(kind==='speech'){
      if(typeof payload.text!=='string'||payload.text.length>8000)throw Error('朗读文字最多 8000 字');
      body=JSON.stringify({model:config.model,voice:config.voice,input:payload.text,response_format:'mp3'});headers['Content-Type']='application/json';
    }else if(kind==='transcription'){
      if(typeof payload.audio!=='string'||!/^audio\/[\w.+;-]+$/.test(payload.type||''))throw Error('录音格式不正确');
      body=new FormData();body.set('model',config.model);body.set('file',new Blob([Buffer.from(payload.audio,'base64')],{type:payload.type}),payload.name||'recording.webm');
    }
    const upstream=await fetch(target,{method:kind==='models'?'GET':'POST',headers,body,signal:controller.signal,redirect:'error'});
    if(!upstream.ok){const reason={401:'密钥无效或未授权',403:'服务拒绝访问',404:'地址或模型不存在',429:'额度不足或请求过快'}[upstream.status]||'服务返回错误';return json(502,{error:`${reason}（${upstream.status}），请检查设置`});}
    const bytes=await upstream.arrayBuffer();if(bytes.byteLength>30*1024*1024)throw Error('响应超过 30 MB');
    if(kind==='speech'){const type=upstream.headers.get('content-type')||'audio/mpeg';if(!type.startsWith('audio/')&&type!=='application/octet-stream')throw Error('服务没有返回音频');res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(Buffer.from(bytes));}
    else {const data=JSON.parse(Buffer.from(bytes).toString('utf8'));json(200,data);}
  }catch(error){json(400,{error:controller.signal.aborted?'请求超时或已停止':error instanceof SyntaxError?'服务数据格式不正确':['请填写完整的服务地址，例如 https://你的服务/v1','服务地址格式不正确','远程服务请使用 HTTPS 地址','请求内容过大','不支持的服务类型','密钥格式不正确','消息格式不正确','朗读文字最多 8000 字','录音格式不正确','响应超过 30 MB','服务没有返回音频'].includes(error.message)?error.message:'无法连接服务，请检查地址和网络'});}
  finally{clearTimeout(timer);}
}
