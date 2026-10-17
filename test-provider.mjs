// Local integration fixture. Never connects to a paid or external model service.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const audio=await readFile(new URL('./dist/assets/afternoon.wav',import.meta.url));
let total=0;
http.createServer(async(req,res)=>{
  if(req.url==='/checks'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({requests:total}));return;}
  if(req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'local-test-model'}]}));return;}
  const parts=[];for await(const chunk of req)parts.push(chunk);total++;
  if(req.url==='/v1/audio/speech'){res.writeHead(200,{'Content-Type':'audio/wav'});res.end(audio);return;}
  if(req.url==='/v1/audio/transcriptions'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({text:'这是本地录音识别联调文本。'}));return;}
  try{const data=JSON.parse(Buffer.concat(parts).toString('utf8')),system=data.messages?.[0]?.content||'',last=data.messages?.at(-1)?.content||'';const name=system.match(/你是角色 (.*?)。/)?.[1]||'角色';
    let text=`${name}：好，周五一起去看电影，我们把这个约定记下来。`;
    if(last.includes('只回复：连接成功'))text='连接成功';
    else if(last.includes('只输出该歌曲的 id'))text=last.match(/"id":"([^"]+)"/)?.[1]||'builtin-music';
    else if(last.includes('的日记'))text=`今天和你聊到了周五的电影。想到这个约定，我很期待。——${name}`;
    else if(last.includes('值得记住的事实'))text='我们聊到了周五一起看电影的约定。';
    else if(last.includes('朋友圈动态'))text=`想和你分享今天的好心情。——${name}`;
    else if(last.includes('写一条简短评论'))text=`${name}：我也想一起去，记得叫上我。`;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:text}}]}));
  }catch{res.writeHead(400);res.end();}
}).listen(43152,'127.0.0.1',()=>console.log('Local test provider: 43152'));
