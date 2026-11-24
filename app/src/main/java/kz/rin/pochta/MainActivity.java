package kz.rin.pochta;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.Iterator;

public class MainActivity extends Activity {

    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Mobile Safari/537.36";

    private FrameLayout root;
    private WebView web;
    private LinearLayout overlay;
    private WebView ext;
    private TextView overlayTitle;
    private int barColor = Color.parseColor("#0F0C29");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(barColor);

        web = new WebView(this);
        configure(web);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String u = request.getUrl().toString();
                if (u.startsWith("file:")) return false;
                openExternal(u);
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    private void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setUserAgentString(UA);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setSupportZoom(false);
        s.setTextZoom(100);
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
        }
    }

    private void showOverlay(String title, String url) {
        if (overlay == null) {
            overlay = new LinearLayout(this);
            overlay.setOrientation(LinearLayout.VERTICAL);
            overlay.setBackgroundColor(Color.WHITE);
            overlay.setClickable(true);

            LinearLayout bar = new LinearLayout(this);
            bar.setOrientation(LinearLayout.HORIZONTAL);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setBackgroundColor(barColor);
            int pad = (int) (12 * getResources().getDisplayMetrics().density);
            bar.setPadding(pad, pad, pad, pad);

            TextView close = new TextView(this);
            close.setText("✕");
            close.setTextSize(20);
            close.setTextColor(Color.WHITE);
            close.setPadding(pad, 0, pad * 2, 0);
            close.setOnClickListener(v -> hideOverlay());

            overlayTitle = new TextView(this);
            overlayTitle.setTextColor(Color.WHITE);
            overlayTitle.setTextSize(16);
            overlayTitle.setSingleLine(true);

            TextView browser = new TextView(this);
            browser.setText("↗");
            browser.setTextSize(20);
            browser.setTextColor(Color.WHITE);
            browser.setPadding(pad * 2, 0, pad, 0);
            browser.setOnClickListener(v -> {
                if (ext != null && ext.getUrl() != null) openExternal(ext.getUrl());
            });

            bar.addView(close);
            bar.addView(overlayTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            bar.addView(browser);

            ext = new WebView(this);
            configure(ext);
            ext.setWebChromeClient(new WebChromeClient());
            ext.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String u = request.getUrl().toString();
                    if (u.startsWith("http://") || u.startsWith("https://")) return false;
                    openExternal(u);
                    return true;
                }
            });

            overlay.addView(bar, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            overlay.addView(ext, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
            root.addView(overlay, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        overlayTitle.setText(title);
        overlay.setVisibility(View.VISIBLE);
        ext.loadUrl(url);
    }

    private void hideOverlay() {
        if (overlay != null) {
            overlay.setVisibility(View.GONE);
            ext.loadUrl("about:blank");
        }
    }

    @Override
    public void onBackPressed() {
        if (overlay != null && overlay.getVisibility() == View.VISIBLE) {
            if (ext.canGoBack()) ext.goBack();
            else hideOverlay();
            return;
        }
        web.evaluateJavascript("(window.__back&&window.__back())?'1':'0'", value -> {
            if (!"\"1\"".equals(value) && !"1".equals(value)) finish();
        });
    }

    @Override
    protected void onDestroy() {
        scrapeQueue.clear();
        ui.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        if (ext != null) ext.destroy();
        super.onDestroy();
    }

    /* ===== Автоматический опрос сайтов скрытыми браузерами ===== */

    private static final int MAX_PARALLEL = 4;
    private static final int MAX_TICKS = 18;      // ~27 секунд на сайт
    private final ArrayDeque<String[]> scrapeQueue = new ArrayDeque<>();
    private int scrapeRunning = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());

    /** Перехватывает JSON-ответы (fetch/XHR), которые страница получает сама. */
    private static final String HOOK_JS = """
(function(){
  if(window.__rpHook)return; window.__rpHook=1; window.__rpCap=[];
  function keep(t){try{if(t&&t.length<100000){var c=t.trim().charAt(0);if(c==='{'||c==='['){window.__rpCap.push(t);if(window.__rpCap.length>40)window.__rpCap.shift();}}}catch(e){}}
  var of=window.fetch;
  if(of){window.fetch=function(){var p=of.apply(this,arguments);try{p.then(function(r){try{r.clone().text().then(keep);}catch(e){}}).catch(function(){});}catch(e){}return p;};}
  var oo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){this.addEventListener('load',function(){try{keep(this.responseText);}catch(e){}});return oo.apply(this,arguments);};
})();
""";

    /** Забирает текст страницы и пойманные JSON, проверяет, что результат уже появился. */
    private static final String GRAB_JS = """
(function(n){
  var t=document.body?document.body.innerText:'';
  var tu=t.toUpperCase();
  var re=new RegExp('[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}');
  var caps=(window.__rpCap||[]).filter(function(c){return c.toUpperCase().indexOf(n)>=0;}).slice(-8);
  var ok=(re.test(t)&&tu.indexOf(n)>=0)||caps.length>0;
  return JSON.stringify({text:t.slice(0,40000),json:caps,ok:ok,url:location.href});
})(__N__)
""";

    /** Вставляет номер в поле на странице и нажимает кнопку поиска. */
    private static final String FILL_JS = """
(function(n){
  function vis(e){var r=e.getBoundingClientRect();var s=getComputedStyle(e);return r.width>20&&r.height>10&&s.visibility!=='hidden'&&s.display!=='none';}
  var bad=['hidden','checkbox','radio','submit','button','file','password','email','tel','image','range','color','date'];
  var inputs=[].slice.call(document.querySelectorAll('input,textarea')).filter(function(i){var t=(i.type||'text').toLowerCase();return bad.indexOf(t)<0&&!i.disabled&&!i.readOnly&&vis(i);});
  if(!inputs.length)return '0';
  var inp=inputs[0];
  inp.focus();
  var proto=inp.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(inp,n);
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  var scope=inp.form||inp.closest('form')||(inp.parentElement&&inp.parentElement.parentElement)||document;
  var btns=[].slice.call(scope.querySelectorAll('button,input[type=submit],[role=button],a.btn,.btn')).filter(vis);
  if(!btns.length)btns=[].slice.call(document.querySelectorAll('button,input[type=submit],[role=button]')).filter(vis);
  var re=/отслед|найти|поиск|track|search|проверить|узнать|искать|find/i;
  var btn=btns.filter(function(b){return re.test((b.innerText||b.value||b.getAttribute('aria-label')||'')+'');})[0]||btns[0];
  setTimeout(function(){
    if(btn){btn.click();}
    ['keydown','keypress','keyup'].forEach(function(t){inp.dispatchEvent(new KeyboardEvent(t,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));});
    if(inp.form&&inp.form.requestSubmit){try{inp.form.requestSubmit();}catch(e){}}
  },400);
  return '1';
})(__N__)
""";

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private static String unquote(String value) {
        if (value == null || value.equals("null")) return "";
        try {
            return new JSONArray("[" + value + "]").getString(0);
        } catch (Exception e) {
            return "";
        }
    }

    private void enqueueScrape(String id, String url, String number, boolean form) {
        scrapeQueue.add(new String[]{id, url, number, form ? "1" : "0"});
        pumpScrape();
    }

    private void pumpScrape() {
        while (scrapeRunning < MAX_PARALLEL && !scrapeQueue.isEmpty()) {
            scrapeRunning++;
            startScrape(scrapeQueue.poll());
        }
    }

    private void startScrape(final String[] job) {
        final String id = job[0];
        final String url = job[1];
        final String number = job[2];
        final boolean form = "1".equals(job[3]);

        final WebView w = new WebView(this);
        configure(w);
        try {
            CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        } catch (Exception ignored) {
        }
        w.setTranslationX(-8000);
        root.addView(w, new FrameLayout.LayoutParams(dp(412), dp(800)));
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String u, String message, JsResult result) {
                result.confirm();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String u, String message, JsResult result) {
                result.cancel();
                return true;
            }
        });
        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String u, android.graphics.Bitmap icon) {
                view.evaluateJavascript(HOOK_JS, null);
            }

            @Override
            public void onPageFinished(WebView view, String u) {
                view.evaluateJavascript(HOOK_JS, null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String u = request.getUrl().toString();
                return !(u.startsWith("http://") || u.startsWith("https://"));
            }
        });

        // st: 0 — номер опроса, 1 — сколько раз подряд страница не менялась, 2 — длина прошлого ответа,
        // 3 — на каком опросе вставили номер, 4 — сколько раз вставляли
        final int[] st = {0, 0, 0, 0, 0};
        final boolean[] fin = {false};
        final Runnable[] loop = new Runnable[1];
        final String grab = GRAB_JS.replace("__N__", JSONObject.quote(number));
        final String fill = FILL_JS.replace("__N__", JSONObject.quote(number));

        loop[0] = () -> {
            if (fin[0]) return;
            st[0]++;
            if (form && st[0] >= 2 && st[4] < 3 && (st[3] == 0 || st[0] - st[3] >= 8)) {
                w.evaluateJavascript(fill, value -> {
                    if ("\"1\"".equals(value)) {
                        st[3] = st[0];
                        st[4]++;
                    }
                });
            }
            w.evaluateJavascript(grab, value -> {
                if (fin[0]) return;
                String payload = unquote(value);
                boolean ok = payload.contains("\"ok\":true");
                int len = payload.length();
                if (ok && len == st[2]) st[1]++;
                else st[1] = 0;
                st[2] = len;
                boolean done = (ok && st[1] >= 2 && st[0] >= 4) || st[0] >= MAX_TICKS;
                if (done) {
                    fin[0] = true;
                    web.evaluateJavascript("window.__scrape(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(payload) + ")", null);
                    root.removeView(w);
                    w.destroy();
                    scrapeRunning--;
                    pumpScrape();
                } else {
                    ui.postDelayed(loop[0], 1500);
                }
            });
        };

        w.loadUrl(url);
        ui.postDelayed(loop[0], 2500);
    }

    /** Мост JS -> Android. */
    private class Bridge {

        @JavascriptInterface
        public void http(final String id, final String method, final String url,
                         final String headersJson, final String body) {
            new Thread(() -> {
                int status = 0;
                String text = "";
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true);
                    c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                    c.setRequestProperty("User-Agent", UA);
                    c.setRequestProperty("Accept", "application/json, text/plain, */*");
                    c.setRequestProperty("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");
                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> it = h.keys();
                        while (it.hasNext()) {
                            String k = it.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                    }
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        byte[] bytes = body.getBytes("UTF-8");
                        OutputStream os = c.getOutputStream();
                        os.write(bytes);
                        os.close();
                    }
                    status = c.getResponseCode();
                    InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (is != null) {
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        int total = 0;
                        while ((n = is.read(buf)) > 0 && total < 3_000_000) {
                            bo.write(buf, 0, n);
                            total += n;
                        }
                        is.close();
                        text = bo.toString("UTF-8");
                    }
                    c.disconnect();
                } catch (Exception e) {
                    status = 0;
                    text = String.valueOf(e.getMessage());
                }
                final int st = status;
                final String tx = text;
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__http(" + JSONObject.quote(id) + "," + st + "," + JSONObject.quote(tx) + ")", null));
            }).start();
        }

        @JavascriptInterface
        public void scrape(final String id, final String url, final String number, final boolean form) {
            runOnUiThread(() -> enqueueScrape(id, url, number == null ? "" : number.toUpperCase(), form));
        }

        @JavascriptInterface
        public void openIn(final String title, final String url) {
            runOnUiThread(() -> showOverlay(title, url));
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public boolean openApp(final String pkg) {
            Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            final Intent launch = i;
            runOnUiThread(() -> startActivity(launch));
            return true;
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("Rin-pochta", text));
            });
        }

        @JavascriptInterface
        public String paste() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                    CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    return t == null ? "" : t.toString();
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Поделиться"));
            });
        }

        @JavascriptInterface
        public void toast(final String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
        }

        /** Цвет системных панелей под тему. */
        @JavascriptInterface
        public void setBars(final String color, final boolean lightIcons) {
            runOnUiThread(() -> {
                try {
                    barColor = Color.parseColor(color);
                } catch (Exception e) {
                    return;
                }
                root.setBackgroundColor(barColor);
                getWindow().setStatusBarColor(barColor);
                getWindow().setNavigationBarColor(barColor);
                if (Build.VERSION.SDK_INT >= 23) {
                    int flags = getWindow().getDecorView().getSystemUiVisibility();
                    if (lightIcons) {
                        flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    } else {
                        flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    }
                    if (Build.VERSION.SDK_INT >= 26) {
                        if (lightIcons) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        else flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                    getWindow().getDecorView().setSystemUiVisibility(flags);
                }
            });
        }
    }
}
