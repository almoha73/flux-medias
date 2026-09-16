package com.almoha73.fluxmedias;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Foreground service that plays audio with ExoPlayer (Media3) — v1.18.
 *
 * Fixes in this version:
 *  - MediaSession.Callback properly wired to ExoPlayer (play/pause/stop work)
 *  - Notification has ▶/⏸ toggle + ⏹ Stop button
 *  - ACTION_STOP broadcast to stop the service from the notification
 */
public class PlaybackService extends Service {

    // ── Constants ─────────────────────────────────────────────────────────────

    public static final String CHANNEL_ID         = "FluxMediasPlayback";
    public static final String EXTRA_TITLE        = "title";
    public static final String EXTRA_STREAM_URL   = "stream_url";
    public static final String EXTRA_VIDEO_ID     = "video_id";
    public static final String ACTION_PLAY_STREAM = "com.almoha73.fluxmedias.PLAY_STREAM";
    public static final String ACTION_PLAY_RADIO  = "com.almoha73.fluxmedias.PLAY_RADIO";
    public static final String ACTION_RESTART     = "com.almoha73.fluxmedias.RESTART";
    public static final String ACTION_TOGGLE_PLAY = "com.almoha73.fluxmedias.TOGGLE_PLAY";
    public static final String ACTION_STOP        = "com.almoha73.fluxmedias.STOP";
    public static final int    NOTIFICATION_ID    = 101;

    private static final String DM_META_BASE  = "https://www.dailymotion.com/player/metadata/video/";
    private static final String DM_ORIGIN     = "https://geo.dailymotion.com";
    private static final String DM_PLAYER_URL = "https://geo.dailymotion.com/player.html?video=";
    private static final String DM_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Mobile Safari/537.36";

    // ── State ─────────────────────────────────────────────────────────────────

    private MediaSession      mediaSession;
    private AudioManager      audioManager;
    private AudioFocusRequest audioFocusRequest;
    private NotificationManager notifManager;

    private ExoPlayer exoPlayer;
    private String    currentVideoId;
    private String    currentStreamUrl;   // direct URL (Canal+ CDN or other)
    private String    currentTitle  = "En direct";
    private boolean   screenIsOn    = true;
    private boolean   webViewActive = false;
    private boolean   isPlaying     = false;

    // ── Screen receiver ───────────────────────────────────────────────────────

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                screenIsOn = false;
                setPlayerVolume(1.0f);
            } else if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
                screenIsOn = true;
                if (webViewActive) setPlayerVolume(0.0f);
            }
        }
    };

    private void setPlayerVolume(float vol) {
        if (exoPlayer != null) {
            try { exoPlayer.setVolume(vol); } catch (Exception ignored) {}
        }
    }

    // ── Service lifecycle ─────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : null;
        notifManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        // ── Handle control actions from notification ──
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE_PLAY.equals(action)) {
            togglePlayPause();
            return START_STICKY;
        }
        if (ACTION_RESTART.equals(action)) {
            if (currentStreamUrl != null) {
                startExoPlayer(currentStreamUrl, currentVideoId, webViewActive && screenIsOn);
            } else if (currentVideoId != null) {
                fetchVariantAndStart(currentVideoId, webViewActive && screenIsOn);
            }
            return START_STICKY;
        }

        // ── Update title if provided ──
        if (intent != null && intent.getStringExtra(EXTRA_TITLE) != null) {
            currentTitle = intent.getStringExtra(EXTRA_TITLE);
        }

        createNotificationChannel();
        setupMediaSession(currentTitle);
        requestAudioFocus();
        startForegroundWithNotification(false);

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {}
        registerReceiver(screenReceiver, filter);

        // ── Radio mode (audio only, no WebView) ──
        if (ACTION_PLAY_RADIO.equals(action) && intent != null) {
            String directUrl = intent.getStringExtra(EXTRA_STREAM_URL);
            String videoId   = intent.getStringExtra(EXTRA_VIDEO_ID);
            webViewActive = false;

            if (directUrl != null) {
                currentStreamUrl = directUrl;
                currentVideoId   = null;
                new Handler(Looper.getMainLooper()).post(() ->
                    startExoPlayer(directUrl, null, false));
            } else if (videoId != null && !videoId.equals(currentVideoId)) {
                currentVideoId = videoId;
                fetchVariantAndStart(videoId, false);
            }
        }

        // ── TV mode (WebView shows video, ExoPlayer silent until screen off) ──
        if (ACTION_PLAY_STREAM.equals(action) && intent != null) {
            String videoId = intent.getStringExtra(EXTRA_VIDEO_ID);
            if (videoId != null && !videoId.equals(currentVideoId)) {
                webViewActive  = true;
                currentVideoId = videoId;
                fetchVariantAndStart(videoId, true);
            }
        }

        return START_STICKY;
    }

    private void togglePlayPause() {
        if (exoPlayer == null) return;
        if (exoPlayer.isPlaying()) {
            exoPlayer.pause();
            isPlaying = false;
            updatePlaybackState(PlaybackState.STATE_PAUSED);
        } else {
            exoPlayer.play();
            isPlaying = true;
            updatePlaybackState(PlaybackState.STATE_PLAYING);
        }
        refreshNotification();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {}
        stopExoPlayer();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        stopForeground(true);
        super.onDestroy();
    }

    // ── Dailymotion stream resolution (fallback when no direct URL) ───────────

    private void fetchVariantAndStart(String videoId, boolean startMuted) {
        new Thread(() -> {
            try {
                HttpURLConnection meta = openConnection(DM_META_BASE + videoId, videoId);
                meta.setRequestProperty("Accept", "application/json");
                if (meta.getResponseCode() != 200) {
                    scheduleRetry(videoId, startMuted, 5000); return;
                }
                String json = readAll(meta.getInputStream());
                JSONObject obj = new JSONObject(json);
                JSONArray auto = obj.getJSONObject("qualities").getJSONArray("auto");
                if (auto.length() == 0) { scheduleRetry(videoId, startMuted, 5000); return; }
                String masterUrl = auto.getJSONObject(0).getString("url");

                HttpURLConnection m3u8 = openConnection(masterUrl, videoId);
                if (m3u8.getResponseCode() != 200) {
                    scheduleRetry(videoId, startMuted, 5000); return;
                }
                String playlist = readAll(m3u8.getInputStream());
                String variantUrl = lowestVariant(playlist);
                if (variantUrl == null) { scheduleRetry(videoId, startMuted, 5000); return; }

                currentStreamUrl = variantUrl;
                new Handler(Looper.getMainLooper()).post(() ->
                    startExoPlayer(variantUrl, videoId, startMuted));
            } catch (Exception e) {
                scheduleRetry(videoId, startMuted, 5000);
            }
        }).start();
    }

    private HttpURLConnection openConnection(String url, String videoId) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new java.net.URL(url).openConnection();
        conn.setRequestProperty("User-Agent", DM_USER_AGENT);
        if (videoId != null) {
            conn.setRequestProperty("Referer", DM_PLAYER_URL + videoId);
            conn.setRequestProperty("Origin",  DM_ORIGIN);
        }
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(12000);
        return conn;
    }

    private String lowestVariant(String master) {
        Pattern bw = Pattern.compile("BANDWIDTH=(\\d+)");
        String[] lines = master.split("\n");
        String best = null;
        int lowest = Integer.MAX_VALUE;
        for (int i = 0; i < lines.length - 1; i++) {
            String info = lines[i].trim();
            if (!info.startsWith("#EXT-X-STREAM-INF")) continue;
            Matcher m = bw.matcher(info);
            if (!m.find()) continue;
            int b = Integer.parseInt(m.group(1));
            String urlLine = lines[i + 1].trim();
            int hash = urlLine.indexOf('#');
            if (hash > 0) urlLine = urlLine.substring(0, hash);
            if (b < lowest) { lowest = b; best = urlLine; }
        }
        return best;
    }

    private void scheduleRetry(String videoId, boolean startMuted, long delay) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (videoId != null && videoId.equals(currentVideoId))
                fetchVariantAndStart(videoId, startMuted);
        }, delay);
    }

    private String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
        is.close();
        return out.toString(StandardCharsets.UTF_8.name());
    }

    // ── ExoPlayer ─────────────────────────────────────────────────────────────

    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private void startExoPlayer(String url, String videoId, boolean startMuted) {
        stopExoPlayer();

        Map<String, String> hdrs = new HashMap<>();
        hdrs.put("User-Agent", DM_USER_AGENT);
        if (videoId != null) {
            hdrs.put("Referer", DM_PLAYER_URL + videoId);
            hdrs.put("Origin",  DM_ORIGIN);
        }

        DefaultHttpDataSource.Factory dsf =
            new DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(hdrs)
                .setUserAgent(DM_USER_AGENT);

        // Choose media source based on stream type:
        //  .m3u8 → HLS (Canal+ CDN streams)
        //  .mp3 / .aac / other → Progressive (Europe 1, etc.)
        MediaSource mediaSource;
        if (url.contains(".m3u8")) {
            mediaSource = new HlsMediaSource.Factory(dsf)
                .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
        } else {
            mediaSource = new ProgressiveMediaSource.Factory(dsf)
                .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
        }

        exoPlayer = new ExoPlayer.Builder(this).build();
        float vol = (startMuted && screenIsOn) ? 0f : 1f;
        exoPlayer.setVolume(vol);

        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean playing) {
                isPlaying = playing;
                updatePlaybackState(playing
                    ? PlaybackState.STATE_PLAYING
                    : PlaybackState.STATE_PAUSED);
                refreshNotification();
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) {
                    // Live stream ended unexpectedly → refetch
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (currentStreamUrl != null)
                            startExoPlayer(currentStreamUrl, currentVideoId,
                                           webViewActive && screenIsOn);
                        else if (currentVideoId != null)
                            fetchVariantAndStart(currentVideoId, webViewActive && screenIsOn);
                    }, 2000);
                }
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (currentStreamUrl != null)
                        startExoPlayer(currentStreamUrl, currentVideoId,
                                       webViewActive && screenIsOn);
                    else if (currentVideoId != null)
                        fetchVariantAndStart(currentVideoId, webViewActive && screenIsOn);
                }, 3000);
            }
        });

        exoPlayer.setMediaSource(mediaSource);
        exoPlayer.setPlayWhenReady(true);
        exoPlayer.prepare();
        isPlaying = true;
    }

    private void stopExoPlayer() {
        if (exoPlayer != null) {
            try { exoPlayer.stop(); } catch (Exception ignored) {}
            try { exoPlayer.release(); } catch (Exception ignored) {}
            exoPlayer = null;
        }
        isPlaying = false;
    }

    // ── MediaSession ──────────────────────────────────────────────────────────

    private void setupMediaSession(String title) {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        mediaSession = new MediaSession(this, "FluxMedias");

        // ── Callbacks: these make the notification buttons actually work ──
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                if (exoPlayer != null) exoPlayer.play();
            }
            @Override
            public void onPause() {
                if (exoPlayer != null) exoPlayer.pause();
            }
            @Override
            public void onStop() {
                stopSelf();
            }
        });

        mediaSession.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "FluxMedias — Direct")
            .build());

        updatePlaybackState(PlaybackState.STATE_PLAYING);
        mediaSession.setActive(true);
    }

    private void updatePlaybackState(int state) {
        if (mediaSession == null) return;
        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY
                      | PlaybackState.ACTION_PAUSE
                      | PlaybackState.ACTION_STOP
                      | PlaybackState.ACTION_PLAY_PAUSE)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
            .build());
    }

    // ── Audio focus ───────────────────────────────────────────────────────────

    private void requestAudioFocus() {
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setOnAudioFocusChangeListener(fc -> {})
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            //noinspection deprecation
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            //noinspection deprecation
            audioManager.abandonAudioFocus(null);
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private void refreshNotification() {
        if (notifManager != null) {
            notifManager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void startForegroundWithNotification(boolean paused) {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private Notification buildNotification() {
        // Open app on tap
        PendingIntent openApp = PendingIntent.getActivity(
            this, 0,
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Play/Pause toggle
        PendingIntent toggleIntent = PendingIntent.getService(
            this, 2,
            new Intent(this, PlaybackService.class).setAction(ACTION_TOGGLE_PLAY),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Stop (kills the service)
        PendingIntent stopIntent = PendingIntent.getService(
            this, 3,
            new Intent(this, PlaybackService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        boolean playing = (exoPlayer != null && exoPlayer.isPlaying());
        int playPauseIcon  = playing
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play;
        String playPauseLabel = playing ? "⏸ Pause" : "▶ Reprendre";

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("FluxMedias — " + currentTitle)
            .setContentText(playing ? "▶ Lecture en cours" : "⏸ En pause")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            // Action 0: Play/Pause
            .addAction(new Notification.Action.Builder(
                playPauseIcon, playPauseLabel, toggleIntent).build())
            // Action 1: Stop
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_delete, "⏹ Arrêter", stopIntent).build());

        if (mediaSession != null) {
            builder.setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1));  // show both actions in compact view
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Lecture en arrière-plan", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Maintient la lecture active lorsque l'écran est éteint");
            ch.setShowBadge(false);
            ch.enableVibration(false);
            ch.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }
}
