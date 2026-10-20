package com.almoha73.fluxmedias;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "fluxmedias";

    // Live video playing in the WebView: handed off to the native audio service
    // when the app goes to the background, so the sound continues with lock-screen controls.
    private boolean videoActive = false;
    private String  videoAudioUrl, videoTitle, videoStation;
    private boolean handedOff = false;

    // ── JavaScript bridge (window.AndroidBridge) ─────────────────────────────

    public class NativeBridge {
        @JavascriptInterface
        public void play(String url, String title, String stationId) {
            runOnUiThread(() -> {
                askBatteryExemptionOnce();
                PlaybackService.start(MainActivity.this, url, title, stationId);
            });
        }

        @JavascriptInterface
        public void pause() {
            runOnUiThread(() -> {
                PlaybackService s = PlaybackService.getInstance();
                if (s != null) s.pause();
            });
        }

        @JavascriptInterface
        public void resume() {
            runOnUiThread(() -> {
                PlaybackService s = PlaybackService.getInstance();
                if (s != null) s.resume();
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                PlaybackService s = PlaybackService.getInstance();
                if (s != null) s.stop();
            });
        }

        /** System font size setting (1.0 = default). The web UI scales its whole layout with it. */
        @JavascriptInterface
        public float getFontScale() {
            return getResources().getConfiguration().fontScale;
        }

        @JavascriptInterface
        public String getState() {
            try {
                return new JSONObject()
                    .put("state", PlaybackService.getState())
                    .put("station", PlaybackService.getStation())
                    .toString();
            } catch (Exception e) {
                return "{\"state\":\"idle\",\"station\":\"\"}";
            }
        }

        /** Called by the web UI when the TV video starts / stops playing. */
        @JavascriptInterface
        public void setVideoActive(boolean active, String audioUrl, String title, String stationId) {
            runOnUiThread(() -> {
                videoActive   = active;
                videoAudioUrl = audioUrl;
                videoTitle    = title;
                videoStation  = stationId;
            });
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = bridge.getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Text-only zoom breaks the layout (logos, buttons keep their size): the page
        // applies the system font scale to the whole UI instead (see main.js).
        webView.getSettings().setTextZoom(100);
        webView.addJavascriptInterface(new NativeBridge(), "AndroidBridge");
        webView.setWebChromeClient(new FullscreenChromeClient());

        PlaybackService.setListener((state, station) -> callJs(
            "window.onNativeState && window.onNativeState('" + state + "','" + station + "')"));

        askNotificationPermissionOnce();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (handedOff) {
            handedOff = false;
            callJs("window.onNativeReturn && window.onNativeReturn('" + PlaybackService.getState() + "')");
        } else {
            // The user may have paused / stopped from the notification while we were away
            callJs("window.onNativeState && window.onNativeState('"
                + PlaybackService.getState() + "','" + PlaybackService.getStation() + "')");
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (videoActive && !isChangingConfigurations() && !isFinishing()) {
            handedOff = true;
            callJs("window.onNativeHandoff && window.onNativeHandoff()");
            PlaybackService.start(this, videoAudioUrl, videoTitle, videoStation);
        }
    }

    @Override
    public void onDestroy() {
        PlaybackService.setListener(null);
        super.onDestroy();
    }

    private void callJs(String js) {
        WebView wv = bridge != null ? bridge.getWebView() : null;
        if (wv != null) wv.post(() -> wv.evaluateJavascript(js, null));
    }

    // ── Permissions (asked only once) ────────────────────────────────────────

    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean("notif_asked", false)) return;
        prefs.edit().putBoolean("notif_asked", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    /** Keeps the stream alive with the screen off on aggressive OEM battery savers. */
    private void askBatteryExemptionOnce() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean("battery_asked", false)) return;
        prefs.edit().putBoolean("battery_asked", true).apply();
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {}
    }

    // ── Video fullscreen (Capacitor's default client ignores it) ─────────────

    private class FullscreenChromeClient extends BridgeWebChromeClient {
        private View fullscreenView;
        private CustomViewCallback fullscreenCallback;

        FullscreenChromeClient() { super(bridge); }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            WindowInsetsControllerCompat ctl =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            ctl.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            ctl.hide(WindowInsetsCompat.Type.systemBars());
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView == null) return;
            ((FrameLayout) getWindow().getDecorView()).removeView(fullscreenView);
            fullscreenView = null;
            if (fullscreenCallback != null) {
                fullscreenCallback.onCustomViewHidden();
                fullscreenCallback = null;
            }
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .show(WindowInsetsCompat.Type.systemBars());
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }
}
