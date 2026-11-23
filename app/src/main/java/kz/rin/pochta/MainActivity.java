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
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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
        if (web != null) web.destroy();
        if (ext != null) ext.destroy();
        super.onDestroy();
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
