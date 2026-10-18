package com.ruoege.lumiphone;

import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class NativeBridge {
    private final MainActivity activity;
    private final WebView web;
    private final ExecutorService workers=Executors.newFixedThreadPool(4);
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentHashMap<String,Job> jobs=new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String,Save> saves=new ConcurrentHashMap<>();
    private String saveRequest;
    private volatile boolean closed;
    static class Job {volatile HttpURLConnection connection;volatile Future<?> future;final AtomicBoolean done=new AtomicBoolean();}
    static class Save {final Uri uri;final OutputStream stream;long size;Save(Uri uri,OutputStream stream){this.uri=uri;this.stream=stream;}}
    NativeBridge(MainActivity activity,WebView web){this.activity=activity;this.web=web;}
    private boolean allowed(String id){return !closed&&activity.trusted&&id!=null&&id.matches("[a-zA-Z0-9-]{1,80}");}
    private void reply(String id,JSONObject data){
        String json=data.toString();
        for(int offset=0;offset<json.length();offset+=65536){
            int end=Math.min(offset+65536,json.length());String part=json.substring(offset,end);boolean last=end==json.length();
            activity.runOnUiThread(()->{if(!closed&&activity.trusted)web.evaluateJavascript("window.__lumiNativeChunk&&window.__lumiNativeChunk("+JSONObject.quote(id)+","+JSONObject.quote(part)+","+last+")",null);});
        }
    }
    private static JSONObject object(String key,Object value){JSONObject result=new JSONObject();try{result.put(key,value);}catch(Exception ignored){}return result;}
    private void error(String id,String message){reply(id,object("error",message));}
    @JavascriptInterface public void request(String id,String raw){
        if(!allowed(id))return;
        if(raw==null||raw.length()>50*1024*1024||jobs.size()>=12){error(id,"请求内容过大或同时请求过多");return;}
        Job job=new Job();if(jobs.putIfAbsent(id,job)!=null)return;
        ScheduledFuture<?> timeout=clock.schedule(()->{if(job.done.compareAndSet(false,true)){if(job.connection!=null)job.connection.disconnect();if(job.future!=null)job.future.cancel(true);jobs.remove(id);error(id,"请求超时，请检查网络后重试");}},100,TimeUnit.SECONDS);
        job.future=workers.submit(()->{
            try{
                JSONObject input=new JSONObject(raw);URI uri=new URI(input.getString("url"));
                String host=uri.getHost(),scheme=uri.getScheme();
                boolean loopback=Arrays.asList("127.0.0.1","localhost","[::1]","::1").contains(host);
                if(host==null||!("https".equals(scheme)||"http".equals(scheme)&&loopback)||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getQuery()!=null)throw new IOException("destination");
                String method=input.getString("method");if(!Arrays.asList("GET","POST").contains(method))throw new IOException("method");
                HttpURLConnection connection=(HttpURLConnection)uri.toURL().openConnection();job.connection=connection;
                if(job.done.get()){connection.disconnect();return;}
                connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(20000);connection.setReadTimeout(90000);connection.setRequestMethod(method);connection.setUseCaches(false);
                JSONObject headers=input.getJSONObject("headers");Iterator<String> names=headers.keys();
                while(names.hasNext()){
                    String name=names.next(),value=headers.getString(name);
                    if(!Arrays.asList("authorization","content-type","accept").contains(name.toLowerCase(Locale.ROOT))||value.length()>8192||value.contains("\r")||value.contains("\n"))throw new IOException("headers");
                    connection.setRequestProperty(name,value);
                }
                if(method.equals("POST")){
                    byte[] body=Base64.decode(input.optString("body"),Base64.DEFAULT);if(body.length>36*1024*1024)throw new IOException("size");
                    connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(OutputStream output=connection.getOutputStream()){output.write(body);}
                }
                int status=connection.getResponseCode();InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();byte[] bytes;
                try(InputStream source=stream){bytes=source==null?new byte[0]:readLimited(source,30*1024*1024);}
                JSONObject result=new JSONObject();result.put("status",status);result.put("type",connection.getContentType()==null?"application/json":connection.getContentType());result.put("body",Base64.encodeToString(bytes,Base64.NO_WRAP));
                if(job.done.compareAndSet(false,true))reply(id,result);
            }catch(Exception failure){if(job.done.compareAndSet(false,true))error(id,"无法连接服务，请检查地址、网络或响应大小");}
            finally{timeout.cancel(false);jobs.remove(id);if(job.connection!=null)job.connection.disconnect();}
        });
    }
    static byte[] readLimited(InputStream source,int max) throws IOException {
        ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int count,total=0;
        while((count=source.read(buffer))!=-1){total+=count;if(total>max)throw new IOException("size");output.write(buffer,0,count);}return output.toByteArray();
    }
    @JavascriptInterface public void cancel(String id){
        Job job=jobs.remove(id);if(job!=null){job.done.set(true);if(job.connection!=null)job.connection.disconnect();if(job.future!=null)job.future.cancel(true);}
        activity.runOnUiThread(()->{if(id!=null&&id.equals(saveRequest))saveRequest=null;});
    }
    @JavascriptInterface public void saveBegin(String id,String name,String type){
        if(!allowed(id))return;
        activity.runOnUiThread(()->{
            if(saveRequest!=null||!saves.isEmpty()){error(id,"请先完成当前备份保存");return;}
            saveRequest=id;
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE,name.replaceAll("[/\\\\\\r\\n]","_").substring(0,Math.min(name.length(),120)));
            try{activity.startActivityForResult(intent,MainActivity.SAVE_FILE);}catch(Exception failure){saveRequest=null;error(id,"无法打开系统保存窗口");}
        });
    }
    void finishSelection(Uri uri){
        String id=saveRequest;saveRequest=null;if(id==null)return;
        if(uri==null){reply(id,object("cancelled",true));return;}
        try{
            if(!"content".equals(uri.getScheme()))throw new IOException("uri");
            OutputStream stream=activity.getContentResolver().openOutputStream(uri,"wt");if(stream==null)throw new IOException("stream");
            String handle=UUID.randomUUID().toString();saves.put(handle,new Save(uri,stream));reply(id,object("handle",handle));
        }catch(Exception failure){error(id,"无法写入这个位置，请选择其他文件夹");}
    }
    @JavascriptInterface public synchronized boolean saveChunk(String handle,String encoded){
        Save save=saves.get(handle);if(closed||!activity.trusted||save==null||encoded==null||encoded.length()>270000)return false;
        try{byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);save.size+=bytes.length;if(save.size>150L*1024*1024)throw new IOException("size");save.stream.write(bytes);return true;}catch(Exception failure){saveCancel(handle);return false;}
    }
    @JavascriptInterface public synchronized void saveFinish(String id,String handle){
        if(!allowed(id))return;Save save=saves.get(handle);
        if(save==null){error(id,"备份文件已关闭，请重新导出");return;}
        try{save.stream.flush();save.stream.close();saves.remove(handle);reply(id,object("saved",true));}catch(Exception failure){saveCancel(handle);error(id,"备份写入失败，请检查剩余空间");}
    }
    @JavascriptInterface public synchronized void saveCancel(String handle){
        Save save=saves.remove(handle);if(save==null)return;
        try{save.stream.close();}catch(Exception ignored){}
        try{DocumentsContract.deleteDocument(activity.getContentResolver(),save.uri);}catch(Exception ignored){}
    }
    void close(){closed=true;for(String id:jobs.keySet())cancel(id);for(String handle:saves.keySet())saveCancel(handle);workers.shutdownNow();clock.shutdownNow();}
}
