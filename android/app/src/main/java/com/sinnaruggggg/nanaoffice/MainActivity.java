package com.sinnaruggggg.nanaoffice;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String HOST = "offline.nanaoffice.local";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int OPEN_FILE = 410;
    private static final int CREATE_FILE = 411;
    private static final int MAX_ENCODED = 72 * 1024 * 1024;
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private WebView web;
    private ValueCallback<Uri[]> pendingOpen;
    private String pendingSave;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setDomStorageEnabled(true);
        web.addJavascriptInterface(new LocalStorageBridge(), "NanaAndroid");
        web.setWebViewClient(new LocalAssets());
        web.setWebChromeClient(new DocumentPicker());
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(246, 247, 242));
        frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        setContentView(frame);
        web.loadUrl(HOME);
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private class LocalAssets extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !local(request.getUrl());
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String path = url.getPath();
            if (!local(url) || path == null || path.contains("..") || !path.startsWith("/")) return deny();
            path = path.substring(1);
            String mime;
            if (path.endsWith(".html")) mime = "text/html";
            else if (path.endsWith(".js")) mime = "text/javascript";
            else if (path.endsWith(".css")) mime = "text/css";
            else if (path.endsWith(".wasm")) mime = "application/wasm";
            else if (path.endsWith(".png")) mime = "image/png";
            else mime = "application/octet-stream";
            try {
                Map<String, String> headers = new HashMap<>();
                headers.put("X-Content-Type-Options", "nosniff");
                return new WebResourceResponse(mime, null, 200, "OK", headers, getAssets().open(path));
            } catch (IOException error) { return deny(); }
        }
    }

    private WebResourceResponse deny() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private class DocumentPicker extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingOpen != null) pendingOpen.onReceiveValue(null);
            pendingOpen = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try { startActivityForResult(intent, OPEN_FILE); }
            catch (Exception error) { pendingOpen = null; callback.onReceiveValue(null); }
            return true;
        }
    }

    private class LocalStorageBridge {
        @JavascriptInterface public void save(String filename, String encoded) {
            runOnUiThread(() -> {
                if (pendingSave != null) return;
                if (encoded == null || encoded.length() > MAX_ENCODED || filename == null ||
                    !filename.matches("[^/\\\\]{1,220}\\.(hwp|hwpx|xlsx|pptx)")) {
                    saveResult("error", "파일 이름 또는 크기를 확인하세요.");
                    return;
                }
                pendingSave = encoded;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/octet-stream");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try { startActivityForResult(intent, CREATE_FILE); }
                catch (Exception error) { pendingSave = null; saveResult("error", "저장 위치를 열 수 없습니다."); }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_FILE && pendingOpen != null) {
            ValueCallback<Uri[]> callback = pendingOpen;
            pendingOpen = null;
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        } else if (request == CREATE_FILE) {
            String encoded = pendingSave;
            pendingSave = null;
            Uri destination = data == null ? null : data.getData();
            if (result != RESULT_OK || destination == null || encoded == null) {
                saveResult("cancelled", "");
                return;
            }
            storage.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IOException();
                    output.write(Base64.decode(encoded, Base64.DEFAULT));
                } catch (IOException | IllegalArgumentException error) {
                    runOnUiThread(() -> saveResult("error", "저장 위치와 남은 공간을 확인하세요."));
                    return;
                }
                runOnUiThread(() -> saveResult("saved", ""));
            });
        }
    }

    private void saveResult(String result, String detail) {
        if (!isDestroyed()) web.evaluateJavascript("window.nanaSaveResult(" +
                JSONObject.quote(result) + "," + JSONObject.quote(detail) + ")", null);
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("document.getElementById('workspace').hidden", value -> {
            if ("false".equals(value)) web.evaluateJavascript("document.getElementById('home-button').click()", null);
            else new AlertDialog.Builder(this).setMessage("NANAOFFICE를 닫을까요?")
                .setNegativeButton("취소", null).setPositiveButton("닫기", (dialog, which) -> finish()).show();
        });
    }

    @Override protected void onDestroy() {
        storage.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
