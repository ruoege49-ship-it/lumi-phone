package com.ruoege.lumiphone;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.*;
import java.util.*;

public class MainActivity extends Activity {
    static final String ORIGIN="https://lumi-phone.local";
    static final int PICK_FILE=401, SAVE_FILE=402, MICROPHONE=403;
    WebView web;
    NativeBridge bridge;
    private ValueCallback<Uri[]> fileChoice;
    private PermissionRequest microphone;
    volatile boolean trusted=true;

    static boolean local(Uri uri){return "https".equals(uri.getScheme())&&"lumi-phone.local".equals(uri.getHost())&&uri.getPort()==-1;}
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(220,229,237));
        setContentView(frame);
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            frame.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                android.graphics.Insets ime=insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));return insets;
            });
        }
        web=new WebView(this);web.setBackgroundColor(Color.rgb(220,229,237));
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        web.setVerticalScrollBarEnabled(false);web.setHorizontalScrollBarEnabled(false);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);settings.setTextZoom(100);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        bridge=new NativeBridge(this,web);web.addJavascriptInterface(bridge,"LumiNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return asset(request);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(local(request.getUrl()))return false;
                if(request.isForMainFrame()&&request.hasGesture()&&Arrays.asList("https","http").contains(request.getUrl().getScheme())){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception ignored){Toast.makeText(MainActivity.this,"没有找到可打开此链接的应用",Toast.LENGTH_SHORT).show();}
                }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){trusted=local(Uri.parse(url));}
            @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!trusted){callback.onReceiveValue(null);return true;}
                if(fileChoice!=null)fileChoice.onReceiveValue(null);fileChoice=callback;
                List<String> types=new ArrayList<>();
                for(String value:params.getAcceptTypes())for(String type:value.split(",")){
                    type=type.trim();if(type.equals(".json"))type="application/json";
                    if(type.contains("/"))types.add(type);
                }
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(types.size()==1?types.get(0):"*/*");
                if(types.size()>1)intent.putExtra(Intent.EXTRA_MIME_TYPES,types.toArray(new String[0]));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try{startActivityForResult(intent,PICK_FILE);}catch(Exception error){fileChoice.onReceiveValue(null);fileChoice=null;}
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
                if(!trusted||!local(request.getOrigin())||!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){request.deny();return;}
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});return;}
                if(microphone!=null)microphone.deny();microphone=request;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MICROPHONE);
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(microphone==request)microphone=null;}
        });
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0,this::handleBack);
        web.loadUrl(ORIGIN+"/");
    }
    private WebResourceResponse asset(WebResourceRequest request){
        Uri uri=request.getUrl();
        try{
            if(!local(uri)||!Arrays.asList("GET","HEAD").contains(request.getMethod()))return response(403,"Forbidden","text/plain",new byte[0],new HashMap<>());
            String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
            if(path.contains("..")||path.contains("\\")||path.indexOf(0)>=0)return response(403,"Forbidden","text/plain",new byte[0],new HashMap<>());
            byte[] bytes;try(InputStream input=getAssets().open("web"+path)){bytes=NativeBridge.readLimited(input,16*1024*1024);}
            String type=mime(path);Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");headers.put("Accept-Ranges","bytes");
            String range=request.getRequestHeaders().get("Range");
            if(range!=null&&range.matches("bytes=\\d+-\\d*")){
                String[] bounds=range.substring(6).split("-",-1);int start=Integer.parseInt(bounds[0]),end=bounds[1].isEmpty()?bytes.length-1:Math.min(Integer.parseInt(bounds[1]),bytes.length-1);
                if(start>end||start>=bytes.length)return response(416,"Range Not Satisfiable",type,new byte[0],headers);
                headers.put("Content-Range","bytes "+start+"-"+end+"/"+bytes.length);bytes=Arrays.copyOfRange(bytes,start,end+1);
                headers.put("Content-Length",Integer.toString(bytes.length));return response(206,"Partial Content",type,bytes,headers);
            }
            headers.put("Content-Length",Integer.toString(bytes.length));return response(200,"OK",type,request.getMethod().equals("HEAD")?new byte[0]:bytes,headers);
        }catch(Exception error){return response(404,"Not Found","text/plain",new byte[0],new HashMap<>());}
    }
    private static String mime(String path){
        String extension=path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        switch(extension){case "html":return "text/html";case "mjs":case "js":return "application/javascript";case "css":return "text/css";case "woff2":return "font/woff2";case "ttf":return "font/ttf";case "wav":return "audio/wav";case "png":return "image/png";case "jpg":return "image/jpeg";case "svg":return "image/svg+xml";default:return "application/octet-stream";}
    }
    private static WebResourceResponse response(int status,String reason,String type,byte[] bytes,Map<String,String> headers){return new WebResourceResponse(type,type.startsWith("text/")||type.contains("javascript")?"UTF-8":null,status,reason,headers,new ByteArrayInputStream(bytes));}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(code,permissions,grants);
        if(code==MICROPHONE&&microphone!=null){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)microphone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else microphone.deny();microphone=null;}
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==PICK_FILE&&fileChoice!=null){Uri[] values=WebChromeClient.FileChooserParams.parseResult(result,data);if(values!=null)values=Arrays.stream(values).filter(uri->"content".equals(uri.getScheme())).toArray(Uri[]::new);fileChoice.onReceiveValue(values);fileChoice=null;}
        else if(code==SAVE_FILE)bridge.finishSelection(result==RESULT_OK&&data!=null?data.getData():null);
    }
    private void handleBack(){web.evaluateJavascript("Boolean(window.lumiBack&&window.lumiBack())",value->{if(!"true".equals(value))moveTaskToBack(true);});}
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.lumiPause&&window.lumiPause()",null);web.onPause();}super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){if(bridge!=null)bridge.close();if(fileChoice!=null)fileChoice.onReceiveValue(null);if(microphone!=null)microphone.deny();if(web!=null)web.destroy();super.onDestroy();}
}
