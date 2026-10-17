import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const address='http://127.0.0.1:43151/';
async function ready(){
  try{const response=await fetch(address,{signal:AbortSignal.timeout(1000)});return response.ok&&(await response.text()).includes('lumi.');}catch{return false;}
}
if(!await ready()){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./serve.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('.',import.meta.url)),detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  for(let attempt=0;attempt<20;attempt++){if(await ready())break;await new Promise(resolve=>setTimeout(resolve,250));}
}
if(!await ready()){console.error('Preview could not start on port 43151.');process.exitCode=1;}
else if(process.argv.includes('--check')){console.log(`Ready: ${address}`);}
else{
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',address],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
}
