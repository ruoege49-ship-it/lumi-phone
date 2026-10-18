package com.ruoege.lumiphone;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.MotionEvent;
import android.view.KeyEvent;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

public class SmokeInstrumentation extends Instrumentation {
    private MainActivity activity;
    private Bundle arguments;
    @Override public void onCreate(Bundle args){arguments=args;start();}
    private String evaluate(String expression) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        runOnMainSync(()->activity.web.evaluateJavascript(expression,value->{result.set(value);latch.countDown();}));
        if(!latch.await(8,TimeUnit.SECONDS))throw new Exception("WebView did not respond");return result.get();
    }
    private Object script(String body) throws Exception {
        body=body.replace("import('./","import('"+MainActivity.ORIGIN+"/");
        evaluate("window.__smokeResult=null;(async()=>{"+body+"})().then(value=>window.__smokeResult=JSON.stringify({ok:true,value})).catch(error=>window.__smokeResult=JSON.stringify({ok:false,error:String(error.stack||error)}));");
        long end=System.currentTimeMillis()+120000;
        while(System.currentTimeMillis()<end){String raw=evaluate("window.__smokeResult");if(raw!=null&&!raw.equals("null")){JSONObject result=new JSONObject((String)new JSONTokener(raw).nextValue());if(!result.getBoolean("ok"))throw new Exception(result.getString("error"));return result.opt("value");}Thread.sleep(100);}
        throw new Exception("JavaScript test timed out");
    }
    private void ready() throws Exception {
        long end=System.currentTimeMillis()+40000;
        while(System.currentTimeMillis()<end){if("true".equals(evaluate("Boolean(!window.__beforeReload&&window.lumiBack&&document.querySelector('#home-clock')?.dateTime)")))return;Thread.sleep(200);}
        throw new Exception("Application startup failed: "+evaluate("document.body.innerText"));
    }
    private void passed(String name){Bundle result=new Bundle();result.putString("stream","PASS "+name+"\n");sendStatus(0,result);}
    private void tap(String selector) throws Exception {
        JSONObject point=(JSONObject)script("const el=document.querySelector("+JSONObject.quote(selector)+");if(!el)throw Error('Missing tap target');el.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};");
        int[] location=new int[2];float[] scale=new float[1];runOnMainSync(()->{activity.web.getLocationOnScreen(location);scale[0]=activity.web.getScale();});
        float x=location[0]+(float)point.getDouble("x")*scale[0],y=location[1]+(float)point.getDouble("y")*scale[0];long time=SystemClock.uptimeMillis();
        MotionEvent down=MotionEvent.obtain(time,time,MotionEvent.ACTION_DOWN,x,y,0);sendPointerSync(down);down.recycle();
        MotionEvent up=MotionEvent.obtain(time,time+80,MotionEvent.ACTION_UP,x,y,0);sendPointerSync(up);up.recycle();
    }
    @Override public void onStart(){
        Uri exported=null;
        try{
            Intent launch=new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=(MainActivity)startActivitySync(launch);ready();
            if("restore".equals(arguments.getString("phase"))){
                script("const {PhoneStore}=await import('./storage.mjs');const store=new PhoneStore();const s=await store.open();if(!s.roles.some(r=>r.name==='安卓验收角色'))throw Error('角色未恢复');if(!(await store.blob('android-smoke-image')))throw Error('附件未恢复');return true;");
                passed("cold-process restore: character and original image");finish(Activity.RESULT_OK,new Bundle());return;
            }
            script("await document.fonts.ready;if(!isSecureContext||!navigator.mediaDevices||!window.LumiNative)throw Error('平台能力缺失');if(document.querySelector('.startup-error'))throw Error('启动异常');return true;");
            passed("bundled HTTPS origin, fonts, media support and offline startup");
            script("window.__testStore=new (await import('./storage.mjs')).PhoneStore();await window.__testStore.open();document.querySelector('[data-action=profile]').click();await new Promise(r=>setTimeout(r,100));document.querySelector('[data-action=new-role]').click();await new Promise(r=>setTimeout(r,100));const f=document.querySelector('#role-form');f.elements.name.value='安卓验收角色';f.elements.persona.value='用于安卓安装包验收';f.requestSubmit();for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if((await window.__testStore.read()).roles.some(r=>r.name==='安卓验收角色'))return true;}throw Error('添加角色未保存');");
            passed("visible character form -> submit -> IndexedDB");
            script("const {callService}=await import('./api.mjs');const config={baseUrl:'http://127.0.0.1:43154/v1',model:'local-test-model',voice:'test'};const models=await callService(config,'android-test-only','models');if(!models.includes('local-test-model'))throw Error('模型列表');const text=await callService(config,'android-test-only','chat',{messages:[{role:'user',content:'请只回复：连接成功'}]});if(text!=='连接成功')throw Error(text);const speech=await callService(config,'android-test-only','speech',{text:'测试'});if(speech.size<1000||!speech.type.startsWith('audio/'))throw Error('音频损坏');const asr=await callService(config,'android-test-only','transcription',{audio:'AAEC/w==',type:'audio/webm',name:'test.webm'});if(!asr.includes('识别'))throw Error(asr);return true;");
            passed("native HTTP: models, chat, binary speech, multipart transcription");
            script("const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO3cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const store=window.__testStore;await store.putBlob('android-smoke-image',new Blob([bytes],{type:'image/png'}));await store.commit(s=>{if(!s.media.some(m=>m.id==='android-smoke-image'))s.media.push({id:'android-smoke-image',name:'验收图片',type:'image/png',size:bytes.length,category:'照片',at:Date.now()});});await store.saveSecret('text','ANDROID-TEST-EXCLUDED','https://example.test/v1');window.__testBundle=await store.export();if(JSON.stringify(window.__testBundle).includes('ANDROID-TEST-EXCLUDED'))throw Error('备份包含密钥');if(!window.__testBundle.attachments['android-smoke-image'])throw Error('附件没有导出');return true;");
            passed("original image persistence and backup excludes service secret");
            ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,"lumi-smoke-backup.json");values.put(MediaStore.Downloads.MIME_TYPE,"application/json");
            exported=getTargetContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
            IntentFilter saveFilter=new IntentFilter(Intent.ACTION_CREATE_DOCUMENT);saveFilter.addCategory(Intent.CATEGORY_OPENABLE);saveFilter.addDataType("application/json");
            ActivityMonitor saveMonitor=addMonitor(saveFilter,new ActivityResult(Activity.RESULT_OK,new Intent().setData(exported)),true);
            script("const {saveJSON}=await import('./platform.mjs');if(!await saveJSON(window.__testBundle,'lumi-smoke-backup.json'))throw Error('保存取消');return true;");
            removeMonitor(saveMonitor);
            try(InputStream input=getTargetContext().getContentResolver().openInputStream(exported)){JSONObject backup=new JSONObject(new String(NativeBridge.readLimited(input,20*1024*1024),StandardCharsets.UTF_8));if(!backup.getString("format").equals("lumi-phone-backup"))throw new Exception("Saved backup invalid");}
            passed("Android document export writes a readable backup file");
            IntentFilter pickFilter=new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);pickFilter.addCategory(Intent.CATEGORY_OPENABLE);pickFilter.addDataType("application/json");
            ActivityMonitor pickMonitor=addMonitor(pickFilter,new ActivityResult(Activity.RESULT_OK,new Intent().setData(exported).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)),true);
            script("window.lumiBack();document.querySelector('[data-action=settings]').click();await new Promise(r=>setTimeout(r,100));document.querySelector('[data-action=data]').click();await new Promise(r=>setTimeout(r,100));return true;");
            tap("[data-action=import-backup]");
            script("for(let i=0;i<80;i++){if(document.querySelector('[data-action=apply-backup]'))return true;await new Promise(r=>setTimeout(r,100));}throw Error('文件导入没有出现恢复预览：'+document.querySelector('#toast').textContent);");
            removeMonitor(pickMonitor);passed("Android document selection -> WebView File -> JSON read");
            tap("[data-action=apply-backup]");
            script("for(let i=0;i<80&&document.querySelector('#sheet').open;i++)await new Promise(r=>setTimeout(r,100));if(document.querySelector('#sheet').open)throw Error('恢复未结束');if(await window.__testStore.secret('text','https://example.test/v1'))throw Error('恢复未清除密钥');if(!(await window.__testStore.blob('android-smoke-image')))throw Error('恢复丢图');return true;");
            passed("backup restore and attachment recovery");
            evaluate("window.__beforeReload=true");runOnMainSync(()->activity.web.reload());ready();
            script("const store=new (await import('./storage.mjs')).PhoneStore();const s=await store.open();if(!s.roles.some(r=>r.name==='安卓验收角色'))throw Error('刷新丢角色');if(!(await store.blob('android-smoke-image')))throw Error('刷新丢图');document.querySelector('[data-action=settings]').click();await new Promise(r=>setTimeout(r,100));if(!document.querySelector('#sheet').open)throw Error('设置未打开');return true;");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            script("for(let i=0;i<40;i++){if(!document.querySelector('#sheet').open)return true;await new Promise(r=>setTimeout(r,100));}throw Error('系统返回键未关闭面板');");
            passed("reload restores records; Android back closes the current panel");
            Bundle result=new Bundle();result.putString("stream","Android package smoke checks passed\n");finish(Activity.RESULT_OK,result);
        }catch(Throwable failure){Bundle result=new Bundle();result.putString("stream","FAIL "+failure+"\n");finish(Activity.RESULT_CANCELED,result);}
        finally{if(exported!=null)try{getTargetContext().getContentResolver().delete(exported,null,null);}catch(Exception ignored){}}
    }
}
