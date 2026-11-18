package com.youhui.mail;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Secure Android companion shell for the self-hosted Youhui Mail web workbench. */
public final class MainActivity extends Activity {
    private static final String PREFS = "youhui_android_client";
    private static final String PREF_SERVER_URL = "server_url";
    private static final int REQUEST_FILE_CHOOSER = 4102;
    private static final int TEAL = Color.rgb(24, 132, 118);
    private static final int INK = Color.rgb(37, 55, 61);
    private static final int MUTED = Color.rgb(109, 128, 133);
    private static final int PAGE = Color.rgb(245, 247, 251);

    private LinearLayout root;
    private WebView webView;
    private ProgressBar progressBar;
    private String serverUrl;
    private boolean hasSavedServerUrl;
    private ValueCallback<Uri[]> filePathCallback;
    private final List<WebView> popupWebViews = new ArrayList<>();
    private final Handler sessionHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService sessionProbeExecutor = Executors.newSingleThreadExecutor();
    private Runnable sessionProbe;
    private boolean sessionProbeActive;
    private boolean sessionAuthenticated;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        String savedServerUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_SERVER_URL, null);
        hasSavedServerUrl = savedServerUrl != null && !savedServerUrl.trim().isEmpty();
        serverUrl = hasSavedServerUrl ? savedServerUrl : null;
        if (hasSavedServerUrl) showWorkbench();
        else showSetupScreen();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(PAGE);
        window.setNavigationBarColor(Color.WHITE);
        window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true);
    }

    private void showSetupScreen() {
        releaseWebView();
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAGE);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout outer = new LinearLayout(this);
        outer.setGravity(Gravity.CENTER);
        outer.setPadding(dp(22), dp(28), dp(22), dp(28));
        scroll.addView(outer, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(24), dp(26), dp(24), dp(24));
        card.setBackground(rounded(Color.WHITE, dp(22), Color.rgb(231, 237, 239), dp(1)));
        card.setElevation(dp(3));
        outer.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(62), dp(62));
        iconParams.gravity = Gravity.CENTER_HORIZONTAL;
        iconParams.bottomMargin = dp(14);
        card.addView(icon, iconParams);

        TextView title = text("连接你的邮汇工作台", 24, INK, true);
        title.setGravity(Gravity.CENTER);
        card.addView(title, matchWrap());
        TextView intro = text("输入你自己部署的邮汇 HTTPS 地址。客户端不会预设或连接旧服务器。", 14, MUTED, false);
        intro.setGravity(Gravity.CENTER);
        intro.setLineSpacing(dp(3), 1.0f);
        LinearLayout.LayoutParams introParams = matchWrap();
        introParams.topMargin = dp(10);
        introParams.bottomMargin = dp(22);
        card.addView(intro, introParams);

        TextView label = text("工作台地址", 13, INK, true);
        card.addView(label, matchWrap());
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setTextSize(15);
        address.setTextColor(INK);
        address.setHintTextColor(Color.rgb(151, 164, 168));
        address.setHint("https://mail.example.com");
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setPadding(dp(14), dp(11), dp(14), dp(11));
        address.setBackground(rounded(Color.WHITE, dp(11), Color.rgb(211, 222, 224), dp(1)));
        if (serverUrl != null) address.setText(serverUrl);
        LinearLayout.LayoutParams addressParams = matchWrap();
        addressParams.topMargin = dp(8);
        card.addView(address, addressParams);

        TextView hint = text("仅接受 HTTPS 根地址（例如 https://mail.example.com），以保护登录会话和邮件内容。", 12, MUTED, false);
        hint.setLineSpacing(dp(2), 1.0f);
        LinearLayout.LayoutParams hintParams = matchWrap();
        hintParams.topMargin = dp(8);
        hintParams.bottomMargin = dp(20);
        card.addView(hint, hintParams);

        Button connect = button("连接工作台");
        card.addView(connect, matchWrap());
        connect.setOnClickListener(v -> {
            String normalized = normalizeServerUrl(address.getText().toString());
            if (normalized == null) {
                address.setError("请输入有效的 HTTPS 根地址，不要包含路径、查询参数或账号密码");
                address.requestFocus();
                return;
            }
            if (serverUrl != null && !serverUrl.equals(normalized)) {
                PushClient.unregister(this, serverUrl);
                PushClient.handleLoggedOut(this, serverUrl);
                PushDiagnostics.reset(this);
                sessionAuthenticated = false;
            }
            serverUrl = normalized;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_SERVER_URL, serverUrl).apply();
            hasSavedServerUrl = true;
            showWorkbench();
        });

        if (hasSavedServerUrl) {
            Button forget = quietButton("清除已保存的地址");
            LinearLayout.LayoutParams forgetParams = matchWrap();
            forgetParams.topMargin = dp(8);
            card.addView(forget, forgetParams);
            forget.setOnClickListener(v -> {
                if (serverUrl != null) {
                    PushClient.unregister(this, serverUrl);
                    PushClient.handleLoggedOut(this, serverUrl);
                }
                PushDiagnostics.reset(this);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(PREF_SERVER_URL).apply();
                hasSavedServerUrl = false;
                serverUrl = null;
                sessionAuthenticated = false;
                showSetupScreen();
            });
        }

        TextView security = text("邮汇密码和邮箱授权由你的邮汇服务器处理；本客户端只保存服务器地址。", 12, MUTED, false);
        security.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams securityParams = matchWrap();
        securityParams.topMargin = dp(18);
        card.addView(security, securityParams);
        setContentView(root);
    }

    private void showWorkbench() {
        releaseWebView();
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(14), dp(7), dp(12), dp(7));
        toolbar.setBackgroundColor(PAGE);
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        toolbar.addView(icon, new LinearLayout.LayoutParams(dp(34), dp(34)));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setPadding(dp(9), 0, 0, 0);
        brand.addView(text("邮汇", 17, INK, true), matchWrap());
        TextView host = text(serverHost(), 11, MUTED, false);
        host.setSingleLine(true);
        host.setEllipsize(android.text.TextUtils.TruncateAt.END);
        brand.addView(host, matchWrap());
        toolbar.addView(brand, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button changeServer = quietButton("更换地址");
        changeServer.setTextSize(12);
        toolbar.addView(changeServer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38)));
        changeServer.setOnClickListener(v -> showSetupScreen());

        Button pushDiagnostics = quietButton("推送诊断");
        pushDiagnostics.setTextSize(12);
        toolbar.addView(pushDiagnostics, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38)));
        pushDiagnostics.setOnClickListener(v -> showPushDiagnostics());

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(TEAL));
        progressBar.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(TEAL));
        root.addView(progressBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WorkbenchWebViewClient());
        webView.setWebChromeClient(new WorkbenchChromeClient());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " YouhuiAndroid/1.0");
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        webView.setDownloadListener(new WorkbenchDownloadListener());
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        webView.loadUrl(serverUrl);
    }

    private final class WorkbenchWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if ("https".equals(scheme) && isSameOrigin(uri)) return false;
            if (("http".equals(scheme) || "https".equals(scheme))
                    && (request.isRedirect() || !request.hasGesture())) {
                // Keep OAuth redirects in the same WebView so the server's state cookie stays available.
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // Never bypass certificate errors for a mail client.
            handler.cancel();
            toast("HTTPS 证书验证失败，已阻止连接。");
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) toast("工作台暂时无法加载，请检查地址或网络后重试。");
        }

        @Override
        public void onSafeBrowsingHit(WebView view, WebResourceRequest request,
                                      int threatType, SafeBrowsingResponse callback) {
            callback.backToSafety(true);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            if (view == webView && url != null && isSameOrigin(Uri.parse(url))) startSessionProbe();
        }
    }

    private void startSessionProbe() {
        if (webView == null) return;
        sessionProbeActive = true;
        if (sessionProbe == null) sessionProbe = this::probeWorkbenchSession;
        scheduleSessionProbe(0);
    }

    private void scheduleSessionProbe(long delayMillis) {
        if (!sessionProbeActive || sessionProbe == null) return;
        sessionHandler.removeCallbacks(sessionProbe);
        sessionHandler.postDelayed(sessionProbe, delayMillis);
    }

    private void stopSessionProbe() {
        sessionProbeActive = false;
        if (sessionProbe != null) sessionHandler.removeCallbacks(sessionProbe);
    }

    private void probeWorkbenchSession() {
        WebView current = webView;
        if (!sessionProbeActive || current == null) return;
        String probeUrl = serverUrl;
        String cookieCandidate;
        try { cookieCandidate = CookieManager.getInstance().getCookie(probeUrl); }
        catch (RuntimeException ignored) { cookieCandidate = null; }
        final String cookie = cookieCandidate;
        PushDiagnostics.recordCookiePresence(this, !PushClient.sessionCookieValue(cookie).isEmpty());
        sessionProbeExecutor.execute(() -> {
            HttpURLConnection connection = null;
            String status = "network";
            try {
                connection = (HttpURLConnection) new URL(probeUrl + "/api/notifications/events").openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
                status = String.valueOf(connection.getResponseCode());
            } catch (Exception ignored) {
                status = "network";
            } finally {
                if (connection != null) connection.disconnect();
            }
            String result = status;
            runOnUiThread(() -> handleSessionProbeResult(current, probeUrl, result));
        });
    }

    private void handleSessionProbeResult(WebView current, String probeUrl, String status) {
        if (!sessionProbeActive || webView != current || !probeUrl.equals(serverUrl)) return;
        PushDiagnostics.recordSessionProbe(this, status);
        if ("200".equals(status)) {
            sessionAuthenticated = true;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PushClient.PREF_SESSION_AUTHENTICATED, true).apply();
            PushClient.requestPermissionAndRegister(MainActivity.this, serverUrl);
            scheduleSessionProbe(30_000);
        } else if ("401".equals(status)) {
            boolean wasAuthenticated = sessionAuthenticated || getSharedPreferences(PREFS, MODE_PRIVATE)
                    .getBoolean(PushClient.PREF_SESSION_AUTHENTICATED, false);
            sessionAuthenticated = false;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PushClient.PREF_SESSION_AUTHENTICATED, false).apply();
            if (wasAuthenticated) PushClient.handleLoggedOut(MainActivity.this, serverUrl);
            scheduleSessionProbe(5_000);
        } else {
            scheduleSessionProbe(15_000);
        }
    }

    private void showPushDiagnostics() {
        new AlertDialog.Builder(this)
                .setTitle("推送登记诊断")
                .setMessage(PushDiagnostics.format(this))
                .setPositiveButton("刷新", (dialog, which) -> showPushDiagnostics())
                .setNegativeButton("关闭", null)
                .show();
    }

    private final class WorkbenchChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (progressBar == null) return;
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            try {
                Intent intent = params.createIntent();
                if (intent.getType() == null) intent.setType("*/*");
                startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                return true;
            } catch (Exception exception) {
                filePathCallback = null;
                toast("无法打开文件选择器。");
                return false;
            }
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView popup = new WebView(MainActivity.this);
            popupWebViews.add(popup);
            popup.setWebViewClient(new WebViewClient() {
                private boolean opened;
                private void forward(Uri uri) {
                    if (opened) return;
                    opened = true;
                    openExternal(uri);
                    popup.stopLoading();
                    popup.destroy();
                    popupWebViews.remove(popup);
                }
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    forward(request.getUrl());
                    return true;
                }
                @Override
                public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                    if (url != null && !"about:blank".equals(url)) forward(Uri.parse(url));
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    private final class WorkbenchDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                    String mimeType, long contentLength) {
            Uri uri = Uri.parse(url);
            if (!isSameOrigin(uri) || !"https".equalsIgnoreCase(uri.getScheme())) {
                toast("为保护账号安全，只允许从当前邮汇服务器下载附件。");
                return;
            }
            try {
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("从邮汇下载附件");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(false);
                request.setMimeType(mimeType == null ? "application/octet-stream" : mimeType);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                request.addRequestHeader("Referer", serverUrl + "/");
                manager.enqueue(request);
                toast("已开始下载，完成后可在“下载”中查看。");
            } catch (Exception exception) {
                toast("无法开始下载，请稍后重试。");
            }
        }
    }

    private boolean isSameOrigin(Uri uri) {
        try {
            URI base = new URI(serverUrl);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            int port = uri.getPort() < 0 ? 443 : uri.getPort();
            int basePort = base.getPort() < 0 ? 443 : base.getPort();
            return "https".equalsIgnoreCase(scheme)
                    && base.getHost() != null && host != null
                    && base.getHost().equalsIgnoreCase(host) && basePort == port;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception exception) {
            toast("没有可用于打开此链接的应用。");
        }
    }

    private void releaseWebView() {
        stopSessionProbe();
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            if (root != null) root.removeView(webView);
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        for (WebView popup : new ArrayList<>(popupWebViews)) {
            try { popup.stopLoading(); popup.destroy(); } catch (Exception ignored) {}
        }
        popupWebViews.clear();
        progressBar = null;
    }

    private String normalizeServerUrl(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty() || value.matches(".*\\s+.*")) return null;
        if (!value.contains("://")) value = "https://" + value;
        try {
            URI uri = new URI(value).normalize();
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
            if (uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) return null;
            int port = uri.getPort();
            if (port < -1 || port > 65535) return null;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            return "https://" + host + (port == -1 || port == 443 ? "" : ":" + port);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String serverHost() {
        try { return Uri.parse(serverUrl).getHost(); }
        catch (Exception ignored) { return serverUrl; }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PushClient.permissionRequestCode()) return;
        if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            if (sessionAuthenticated && serverUrl != null) PushClient.enableAndRegister(this, serverUrl);
        } else {
            toast("允许通知后，邮汇才能在后台提醒你有新邮件。");
        }
    }

    @Override
    protected void onPause() {
        stopSessionProbe();
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            startSessionProbe();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        releaseWebView();
        sessionProbeExecutor.shutdownNow();
        super.onDestroy();
    }

    private TextView text(String value, int sizeSp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String label) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTextColor(Color.WHITE);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setMinHeight(dp(48));
        view.setPadding(dp(16), dp(7), dp(16), dp(7));
        view.setBackground(rounded(TEAL, dp(12), TEAL, 0));
        return view;
    }

    private Button quietButton(String label) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setTextSize(13);
        view.setTextColor(TEAL);
        view.setMinHeight(dp(40));
        view.setPadding(dp(12), dp(5), dp(12), dp(5));
        view.setBackground(rounded(Color.WHITE, dp(10), Color.rgb(212, 228, 224), dp(1)));
        return view;
    }

    private GradientDrawable rounded(int fill, int radius, int stroke, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) drawable.setStroke(strokeWidth, stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_SHORT).show();
    }
}
