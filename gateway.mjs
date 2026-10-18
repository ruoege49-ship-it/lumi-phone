import {prepareRequest,serviceError} from './dist/request.mjs';

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
    const {url,options}=prepareRequest(config,secret,kind,payload);
    const upstream=await fetch(url,{...options,signal:controller.signal});
    if(!upstream.ok)return json(502,{error:serviceError(upstream.status)});
    const bytes=await upstream.arrayBuffer();if(bytes.byteLength>30*1024*1024)throw Error('响应超过 30 MB');
    if(kind==='speech'){const type=upstream.headers.get('content-type')||'audio/mpeg';if(!type.startsWith('audio/')&&type!=='application/octet-stream')throw Error('服务没有返回音频');res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(Buffer.from(bytes));}
    else {const data=JSON.parse(Buffer.from(bytes).toString('utf8'));json(200,data);}
  }catch(error){json(400,{error:controller.signal.aborted?'请求超时或已停止':error instanceof SyntaxError?'服务数据格式不正确':['请填写完整的服务地址，例如 https://你的服务/v1','服务地址格式不正确','远程服务请使用 HTTPS 地址','请求内容过大','不支持的服务类型','密钥格式不正确','消息格式不正确','朗读文字最多 8000 字','录音格式不正确','响应超过 30 MB','服务没有返回音频'].includes(error.message)?error.message:'无法连接服务，请检查地址和网络'});}
  finally{clearTimeout(timer);}
}
