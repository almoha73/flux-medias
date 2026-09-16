package com.almoha73.fluxmedias;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import androidx.media3.common.MediaItem;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    // Fullscreen state for the Dailymotion overlay
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    // CPU WakeLock: prevents the CPU from sleeping when the screen is off
    private PowerManager.WakeLock wakeLock;

    // Native WebView that loads Dailymotion directly, independent of Capacitor
    private WebView dmWebView;
    private FrameLayout dmOverlay;

    // Captured m3u8 URL from the Dailymotion WebView — sent to PlaybackService for native audio
    private volatile String capturedM3u8Url = null;

    // ── Native HLS video player (replaces WebView + Dailymotion) ──────────────
    // Used for the TV mode when the stream URL is a direct .m3u8
    private ExoPlayer    tvPlayer;
    private FrameLayout  tvOverlay;

    private static final String CANAL_USER_AGENT =
        "CNews/8.7.0 (fr.canalplus.itele) Android/10";

    // ── WakeLock ─────────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "FluxMedias::PlaybackWakeLock"
                );
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    // ── Battery optimization exemption ───────────────────────────────────────

    /**
     * Requests the user to disable battery optimization for this app.
     * Required so Android does not throttle network access in Doze mode when screen is off.
     */
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }
        }
    }

    // ── Foreground service ────────────────────────────────────────────────────

    private void startPlaybackService(String streamTitle, String videoId) {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_PLAY_STREAM);
        intent.putExtra(PlaybackService.EXTRA_TITLE, streamTitle);
        if (videoId != null) intent.putExtra(PlaybackService.EXTRA_VIDEO_ID, videoId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    private void stopPlaybackService() {
        stopService(new Intent(this, PlaybackService.class));
    }

    // ── JavaScript bridge (called from main.js via AndroidBridge) ─────────────

    public class DailymotionBridge {
        @JavascriptInterface
        public void showPlayer(final String url, final String title) {
            runOnUiThread(() -> {
                if (url != null && url.contains(".m3u8")) {
                    // Direct HLS stream → use native ExoPlayer + PlayerView (no WebView)
                    showNativeVideoPlayer(url, title);
                } else {
                    // Legacy: Dailymotion embed URL → WebView
                    showDailymotionOverlay(url, title);
                }
            });
        }

        @JavascriptInterface
        public void hidePlayer() {
            runOnUiThread(() -> {
                if (tvOverlay != null) {
                    hideNativeVideoPlayer();
                } else {
                    hideDailymotionOverlay();
                }
            });
        }

        /**
         * Audio-only "radio" mode. The first parameter can be either:
         *  - A direct HLS stream URL (starts with "http") → play directly with ExoPlayer
         *  - A Dailymotion video ID → fetch stream URL via API first
         *
         * Does NOT open a WebView overlay. ExoPlayer plays in background even when
         * the screen is off.
         */
        @JavascriptInterface
        public void startRadio(final String urlOrVideoId, final String title) {
            Intent svcIntent = new Intent(MainActivity.this, PlaybackService.class);
            svcIntent.setAction(PlaybackService.ACTION_PLAY_RADIO);
            svcIntent.putExtra(PlaybackService.EXTRA_TITLE, title);
            // Detect whether this is a direct URL or a Dailymotion video ID
            if (urlOrVideoId != null && urlOrVideoId.startsWith("http")) {
                svcIntent.putExtra(PlaybackService.EXTRA_STREAM_URL, urlOrVideoId);
            } else {
                svcIntent.putExtra(PlaybackService.EXTRA_VIDEO_ID, urlOrVideoId);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svcIntent);
            } else {
                startService(svcIntent);
            }
        }

        /**
         * Stop the background playback service entirely.
         * Called when the user taps "⏹ Arrêter" in the app.
         */
        @JavascriptInterface
        public void stopStream() {
            stopService(new Intent(MainActivity.this, PlaybackService.class));
        }

        /**
         * Called from the JavaScript XHR/fetch interceptor injected into the WebView.
         * Backup URL capture in case shouldInterceptRequest() misses the URL.
         */
        @JavascriptInterface
        public void onStreamUrl(final String streamUrl) {
            if (streamUrl == null || streamUrl.startsWith("blob:")) return;
            if (capturedM3u8Url != null) return;
            capturedM3u8Url = streamUrl;
        }
    }


    // ── Native WebView overlay ────────────────────────────────────────────────


    private void showDailymotionOverlay(String url, String title) {
        // Extract the Dailymotion video ID from the embed URL (e.g. "?video=x3b68jn")
        String videoId = null;
        try {
            videoId = Uri.parse(url).getQueryParameter("video");
        } catch (Exception ignored) {}

        // If already open, just reload with the new URL
        if (dmWebView != null) {
            dmWebView.loadUrl(url);
            startPlaybackService(title, videoId);
            return;
        }

        // Start service immediately with the video ID — it will fetch the stream URL itself
        startPlaybackService(title, videoId);
        capturedM3u8Url = null; // reset so interception still works as fallback

        dmWebView = new WebView(this);
        WebSettings settings = dmWebView.getSettings();

        // Full browser-level settings for reliable video playback
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // Remove WebView markers from User-Agent to look like standard Chrome
        String ua = settings.getUserAgentString()
            .replace("; wv", "")
            .replaceAll("Version/\\d+\\.\\d+\\s?", "");
        settings.setUserAgentString(ua);

        CookieManager.getInstance().setAcceptThirdPartyCookies(dmWebView, true);

        // WebViewClient:
        // 1. Intercepts m3u8/mpd URLs via shouldInterceptRequest() (native HTTP requests)
        // 2. Injects JS to intercept XHR/fetch (backup for HLS.js / Dash.js requests)
        // 3. Injects JS to spoof Page Visibility API (prevents Dailymotion auto-pause)
        final String streamTitle = title;
        dmWebView.setWebViewClient(new WebViewClient() {

            // JavaScript XHR/fetch interceptor — captures stream URL from within the page
            private static final String JS_STREAM_INTERCEPTOR =
                "(function(){" +
                "if(window._fmIntercepted)return;window._fmIntercepted=true;" +
                // Intercept XMLHttpRequest.open
                "var origOpen=XMLHttpRequest.prototype.open;" +
                "XMLHttpRequest.prototype.open=function(m,u){" +
                "  if(typeof u==='string'&&(u.indexOf('.m3u8')>=0||u.indexOf('.mpd')>=0||u.indexOf('manifest')>=0)){" +
                "    try{window.AndroidBridge.onStreamUrl(u);}catch(e){}" +
                "  }" +
                "  return origOpen.apply(this,arguments);" +
                "};" +
                // Intercept fetch
                "if(window.fetch){" +
                "  var origFetch=window.fetch;" +
                "  window.fetch=function(input,init){" +
                "    var u=typeof input==='string'?input:(input&&input.url?input.url:'');" +
                "    if(u&&(u.indexOf('.m3u8')>=0||u.indexOf('.mpd')>=0||u.indexOf('manifest')>=0)){" +
                "      try{window.AndroidBridge.onStreamUrl(u);}catch(e){}" +
                "    }" +
                "    return origFetch.apply(this,arguments);" +
                "  };" +
                "}" +
                "})()"; 

            private static final String VISIBILITY_SPOOF =
                "(function(){" +
                "try{Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});}catch(e){}" +
                "try{Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});}catch(e){}" +
                "try{Object.defineProperty(Document.prototype,'hidden',{configurable:true,get:function(){return false;}});}catch(e){}" +
                "try{Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:function(){return 'visible';}});}catch(e){}" +
                "try{window.dispatchEvent(new Event('focus'));}catch(e){}" +
                "})()";

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString();
                // Capture first stream manifest (HLS m3u8 or MPEG-DASH mpd)
                // Broad filter: exclude known ad/analytics domains only
                boolean isManifest = reqUrl.contains(".m3u8")
                    || reqUrl.contains(".mpd")
                    || (reqUrl.contains("manifest") && reqUrl.contains("dailymotion"));
                boolean isAd = reqUrl.contains("doubleclick")
                    || reqUrl.contains("googlevideo")
                    || reqUrl.contains("adsystem")
                    || reqUrl.contains("googlesyndication");

                if (capturedM3u8Url == null && isManifest && !isAd) {
                    capturedM3u8Url = reqUrl;
                    String cookies = CookieManager.getInstance().getCookie(reqUrl);
                    Intent svcIntent = new Intent(MainActivity.this, PlaybackService.class);
                    svcIntent.setAction(PlaybackService.ACTION_PLAY_STREAM);
                    svcIntent.putExtra(PlaybackService.EXTRA_STREAM_URL, reqUrl);
                    svcIntent.putExtra(PlaybackService.EXTRA_TITLE, streamTitle);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(svcIntent);
                    } else {
                        startService(svcIntent);
                    }
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Inject XHR/fetch interceptor first, then page visibility spoof
                view.evaluateJavascript(JS_STREAM_INTERCEPTOR, null);
                view.evaluateJavascript(VISIBILITY_SPOOF, null);
            }
        });

        // Full-screen support within the overlay
        dmWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;

                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.addView(customView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                if (dmWebView != null) dmWebView.setVisibility(View.GONE);

                // Immersive fullscreen
                getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.removeView(customView);
                customView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                if (dmWebView != null) dmWebView.setVisibility(View.VISIBLE);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        });

        dmWebView.loadUrl(url);

        // Build full-screen overlay with close button
        dmOverlay = new FrameLayout(this);
        dmOverlay.setBackgroundColor(Color.BLACK);

        dmOverlay.addView(dmWebView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Close button top-left
        ImageButton closeBtn = new ImageButton(this);
        closeBtn.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        closeBtn.setBackgroundColor(0xCC000000);
        closeBtn.setContentDescription("Fermer");
        closeBtn.setOnClickListener(v -> hideDailymotionOverlay());
        int btnSizePx = (int) (48 * getResources().getDisplayMetrics().density);
        int marginPx  = (int) (12 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(btnSizePx, btnSizePx);
        btnParams.gravity  = Gravity.TOP | Gravity.START;
        btnParams.topMargin   = marginPx + getStatusBarHeight();
        btnParams.leftMargin  = marginPx;
        dmOverlay.addView(closeBtn, btnParams);

        // Add overlay above everything
        FrameLayout decor = (FrameLayout) getWindow().getDecorView();
        decor.addView(dmOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Service was already started with the video ID at the top of showDailymotionOverlay()
    }


    private void hideDailymotionOverlay() {
        // Exit fullscreen first if active
        if (customView != null) {
            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.removeView(customView);
            customView = null;
            if (customViewCallback != null) {
                customViewCallback.onCustomViewHidden();
                customViewCallback = null;
            }
        }
        if (dmOverlay != null) {
            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.removeView(dmOverlay);
            dmOverlay = null;
        }
        if (dmWebView != null) {
            dmWebView.destroy();
            dmWebView = null;
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        capturedM3u8Url = null; // Reset so next open re-captures the stream URL
        stopPlaybackService();
    }

    // ── Native HLS video player (ExoPlayer + PlayerView, no WebView) ──────────

    /**
     * Opens a full-screen ExoPlayer overlay playing the given HLS stream URL.
     * No WebView, no Dailymotion — pure Canal+ CDN stream.
     */
    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private void showNativeVideoPlayer(String hlsUrl, String title) {
        // If already open, just reload
        if (tvPlayer != null) {
            tvPlayer.stop();
            DefaultHttpDataSource.Factory dsf =
                new DefaultHttpDataSource.Factory().setUserAgent(CANAL_USER_AGENT);
            HlsMediaSource ms = new HlsMediaSource.Factory(dsf)
                .createMediaSource(MediaItem.fromUri(Uri.parse(hlsUrl)));
            tvPlayer.setMediaSource(ms);
            tvPlayer.prepare();
            tvPlayer.play();
            return;
        }

        // ── Create ExoPlayer ──
        tvPlayer = new ExoPlayer.Builder(this).build();

        DefaultHttpDataSource.Factory dsf =
            new DefaultHttpDataSource.Factory().setUserAgent(CANAL_USER_AGENT);
        HlsMediaSource mediaSource = new HlsMediaSource.Factory(dsf)
            .createMediaSource(MediaItem.fromUri(Uri.parse(hlsUrl)));

        tvPlayer.setMediaSource(mediaSource);
        tvPlayer.setPlayWhenReady(true);
        tvPlayer.prepare();

        // ── Create PlayerView ──
        PlayerView playerView = new PlayerView(this);
        playerView.setPlayer(tvPlayer);
        playerView.setUseController(true);        // show default controls
        playerView.setKeepScreenOn(true);

        // ── Build full-screen overlay ──
        tvOverlay = new FrameLayout(this);
        tvOverlay.setBackgroundColor(Color.BLACK);

        // PlayerView fills the whole overlay
        tvOverlay.addView(playerView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));

        // Close button top-left
        ImageButton closeBtn = new ImageButton(this);
        closeBtn.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        closeBtn.setBackgroundColor(0xCC000000);
        closeBtn.setContentDescription("Fermer");
        closeBtn.setOnClickListener(v -> hideNativeVideoPlayer());
        int btnSizePx = (int) (48 * getResources().getDisplayMetrics().density);
        int marginPx  = (int) (12 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(btnSizePx, btnSizePx);
        btnParams.gravity  = Gravity.TOP | Gravity.START;
        btnParams.topMargin   = marginPx + getStatusBarHeight();
        btnParams.leftMargin  = marginPx;
        tvOverlay.addView(closeBtn, btnParams);

        // Add overlay above everything
        FrameLayout decor = (FrameLayout) getWindow().getDecorView();
        decor.addView(tvOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));

        // Immersive fullscreen
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void hideNativeVideoPlayer() {
        if (tvPlayer != null) {
            tvPlayer.stop();
            tvPlayer.release();
            tvPlayer = null;
        }
        if (tvOverlay != null) {
            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.removeView(tvOverlay);
            tvOverlay = null;
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);

        // Notify the JS app to reset its UI back to the home/idle state
        try {
            android.webkit.WebView wv = this.bridge.getWebView();
            if (wv != null) {
                wv.post(() -> wv.evaluateJavascript("window.goHome && window.goHome();", null));
            }
        } catch (Exception ignored) {}
    }

    private int getStatusBarHeight() {
        int result = 0;
        int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resId > 0) result = getResources().getDimensionPixelSize(resId);
        return result;
    }


    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            // Spoof User-Agent
            String ua = settings.getUserAgentString()
                .replace("; wv", "")
                .replaceAll("Version/\\d+\\.\\d+\\s?", "");
            settings.setUserAgentString(ua);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            // Register bridge so main.js can call AndroidBridge.showPlayer() / hidePlayer()
            webView.addJavascriptInterface(new DailymotionBridge(), "AndroidBridge");
            webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge));
        }

        // Ask the user once to disable battery optimization (needed for screen-off playback)
        requestBatteryOptimizationExemption();
    }

    @Override
    public void onBackPressed() {
        if (tvOverlay != null) {
            hideNativeVideoPlayer();  // close native ExoPlayer overlay
        } else if (dmWebView != null) {
            hideDailymotionOverlay(); // close legacy WebView overlay
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // super.onPause() (Capacitor) may call pauseTimers() globally and asynchronously.
        // We use a 1-second delay to guarantee our resumeTimers() runs LAST.
        if (dmWebView != null) {
            dmWebView.onResume();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (dmWebView != null) {
                    dmWebView.onResume();
                    dmWebView.resumeTimers();
                    // Force-play video elements in case Dailymotion paused via visibilitychange
                    dmWebView.evaluateJavascript(
                        "try{document.querySelectorAll('video').forEach(" +
                        "function(v){if(v.paused){v.play();}});}catch(e){}", null);
                }
            }, 1000);
        }
        acquireWakeLock();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (dmWebView != null) {
            dmWebView.onResume();
            dmWebView.resumeTimers();
        }
        releaseWakeLock(); // Release CPU lock when app is in foreground (battery saving)
    }

    @Override
    public void onStop() {
        super.onStop();
        // Same delayed-resume pattern as onPause()
        if (dmWebView != null) {
            dmWebView.onResume();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (dmWebView != null) {
                    dmWebView.onResume();
                    dmWebView.resumeTimers();
                    dmWebView.evaluateJavascript(
                        "try{document.querySelectorAll('video').forEach(" +
                        "function(v){if(v.paused){v.play();}});}catch(e){}", null);
                }
            }, 1000);
        }
        acquireWakeLock();
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        // NOTE: do NOT stop PlaybackService here.
        // onDestroy() is called when Android recycles the Activity (e.g. memory pressure),
        // but the service + audio must keep running. The service only stops when the
        // user explicitly presses Back to close the player (hideDailymotionOverlay).
        if (dmWebView != null) {
            dmWebView.destroy();
            dmWebView = null;
        }
        super.onDestroy();
    }
}
