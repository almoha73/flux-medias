package com.almoha73.fluxmedias;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

/**
 * Foreground service playing live audio streams with ExoPlayer.
 *
 * - One MediaSession for the whole service life: lock screen, notification shade,
 *   Bluetooth/headset buttons all drive the same play / pause / stop logic.
 * - Pause stops the network (live stream); resume jumps back to the live edge.
 * - Swiping the app away from recents (onTaskRemoved) stops everything.
 * - State changes are pushed to MainActivity so the web UI stays in sync.
 */
public class PlaybackService extends Service {

    public static final String ACTION_PLAY   = "com.almoha73.fluxmedias.PLAY";
    public static final String ACTION_TOGGLE = "com.almoha73.fluxmedias.TOGGLE";
    public static final String ACTION_STOP   = "com.almoha73.fluxmedias.STOP";

    public static final String EXTRA_URL     = "url";
    public static final String EXTRA_TITLE   = "title";
    public static final String EXTRA_STATION = "station";

    public static final String STATE_IDLE    = "idle";
    public static final String STATE_LOADING = "loading";
    public static final String STATE_PLAYING = "playing";
    public static final String STATE_PAUSED  = "paused";

    private static final String CHANNEL_ID        = "FluxMediasPlayback";
    private static final String CUSTOM_ACTION_STOP = "stop";
    private static final int    NOTIFICATION_ID   = 101;
    private static final String USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/130.0.0.0 Mobile Safari/537.36";

    // ── Shared state (read by MainActivity, main thread only) ────────────────

    public interface StateListener {
        void onStateChanged(String state, String stationId);
    }

    private static PlaybackService instance;
    private static StateListener   listener;
    private static String currentState   = STATE_IDLE;
    private static String currentStation = "";

    public static void setListener(StateListener l) { listener = l; }
    public static String getState()   { return currentState; }
    public static String getStation() { return currentStation; }
    public static PlaybackService getInstance() { return instance; }

    // ── Instance state ───────────────────────────────────────────────────────

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer    player;
    private MediaSession session;
    private NotificationManager notifManager;

    private String  streamUrl;
    private String  title = "En direct";
    private boolean wantPlaying = false;
    private int     retryCount  = 0;
    private final Runnable retryRunnable = this::reconnect;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notifManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannel();
        createSession();
        createPlayer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_PLAY.equals(action)) {
            // Must go foreground right away when started with startForegroundService()
            startForegroundCompat();
            play(intent.getStringExtra(EXTRA_URL),
                 intent.getStringExtra(EXTRA_TITLE),
                 intent.getStringExtra(EXTRA_STATION));
        } else if (ACTION_TOGGLE.equals(action) && streamUrl != null) {
            togglePause();
        } else if (ACTION_STOP.equals(action)) {
            stop();
        } else if (streamUrl == null) {
            // Restarted without a stream (or unknown action): nothing to do
            stop();
        }
        // Never restart automatically after being killed: no zombie notification
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App swiped away from recents → stop the sound and the notification
        stop();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        instance = null;
        wantPlaying = false;
        setState(STATE_IDLE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Public controls (main thread) ────────────────────────────────────────

    public void play(String url, String newTitle, String stationId) {
        if (url == null) return;
        handler.removeCallbacks(retryRunnable);
        streamUrl  = url;
        title      = newTitle != null ? newTitle : "En direct";
        currentStation = stationId != null ? stationId : "";
        retryCount = 0;
        wantPlaying = true;

        player.setMediaSource(buildSource(url));
        player.prepare();
        player.play();

        updateMetadata();
        session.setActive(true);
        setState(STATE_LOADING);
    }

    public void pause() {
        if (player == null || !wantPlaying) return;
        handler.removeCallbacks(retryRunnable);
        wantPlaying = false;
        // Live stream: release the connection instead of buffering in the background
        player.stop();
        setState(STATE_PAUSED);
    }

    public void resume() {
        if (player == null || streamUrl == null) return;
        handler.removeCallbacks(retryRunnable);
        wantPlaying = true;
        retryCount = 0;
        // Back to the live edge
        player.seekToDefaultPosition();
        player.prepare();
        player.play();
        setState(STATE_LOADING);
    }

    public void togglePause() {
        if (wantPlaying) pause(); else resume();
    }

    public void stop() {
        handler.removeCallbacks(retryRunnable);
        wantPlaying = false;
        streamUrl = null;
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        if (session != null) session.setActive(false);
        currentStation = "";
        setState(STATE_IDLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    // ── Player ───────────────────────────────────────────────────────────────

    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private void createPlayer() {
        player = new ExoPlayer.Builder(this).build();
        // ExoPlayer handles audio focus (phone calls, other apps) and headphones unplugged
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build(), true);
        player.setHandleAudioBecomingNoisy(true);
        // Keeps CPU + Wi-Fi awake while playing with the screen off
        player.setWakeMode(C.WAKE_MODE_NETWORK);

        player.addListener(new Player.Listener() {
            @Override
            public void onEvents(Player p, Player.Events events) {
                if (!wantPlaying) return;
                if (p.isPlaying()) {
                    retryCount = 0;
                    setState(STATE_PLAYING);
                } else if (p.getPlaybackState() == Player.STATE_BUFFERING) {
                    setState(STATE_LOADING);
                }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                // Paused by the system (headphones unplugged, another app took audio focus)
                if (!playWhenReady && wantPlaying
                        && reason != Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                    pause();
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                // A live stream should never end: reconnect
                if (state == Player.STATE_ENDED && wantPlaying) scheduleReconnect();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (wantPlaying) scheduleReconnect();
            }
        });
    }

    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private MediaSource buildSource(String url) {
        DefaultHttpDataSource.Factory dsf = new DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true);
        MediaItem item = MediaItem.fromUri(Uri.parse(url));
        if (url.contains(".m3u8")) {
            return new HlsMediaSource.Factory(dsf).createMediaSource(item);
        }
        return new ProgressiveMediaSource.Factory(dsf).createMediaSource(item);
    }

    private void scheduleReconnect() {
        setState(STATE_LOADING);
        handler.removeCallbacks(retryRunnable);
        long delay = Math.min(30000, 2000L * (1L << Math.min(retryCount, 4)));
        retryCount++;
        handler.postDelayed(retryRunnable, delay);
    }

    private void reconnect() {
        if (!wantPlaying || streamUrl == null || player == null) return;
        player.setMediaSource(buildSource(streamUrl));
        player.prepare();
        player.play();
    }

    // ── State broadcast ──────────────────────────────────────────────────────

    private void setState(String state) {
        boolean changed = !state.equals(currentState);
        currentState = state;
        updatePlaybackState();
        if (!STATE_IDLE.equals(state)) refreshNotification();
        if (changed && listener != null) listener.onStateChanged(state, currentStation);
    }

    // ── MediaSession ─────────────────────────────────────────────────────────

    private void createSession() {
        session = new MediaSession(this, "FluxMedias");
        session.setSessionActivity(openAppIntent());
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay()  { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop()  { stop(); }
            @Override
            public void onCustomAction(String action, android.os.Bundle extras) {
                if (CUSTOM_ACTION_STOP.equals(action)) stop();
            }
        });
    }

    private void updatePlaybackState() {
        if (session == null) return;
        int state;
        switch (currentState) {
            case STATE_PLAYING: state = PlaybackState.STATE_PLAYING;   break;
            case STATE_LOADING: state = PlaybackState.STATE_BUFFERING; break;
            case STATE_PAUSED:  state = PlaybackState.STATE_PAUSED;    break;
            default:            state = PlaybackState.STATE_STOPPED;
        }
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY
                      | PlaybackState.ACTION_PAUSE
                      | PlaybackState.ACTION_PLAY_PAUSE
                      | PlaybackState.ACTION_STOP)
            // Android 13+ builds the media controls from the session: the Stop button
            // must be a custom action to be shown next to play/pause.
            .addCustomAction(new PlaybackState.CustomAction.Builder(
                CUSTOM_ACTION_STOP, "Arrêter", R.drawable.ic_notif_stop).build())
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
            .build());
    }

    private void updateMetadata() {
        if (session == null) return;
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "En direct")
            .putBitmap(MediaMetadata.METADATA_KEY_ART, buildArtwork())
            .build());
    }

    /** Simple station artwork for the lock screen / media controls. */
    private Bitmap buildArtwork() {
        boolean europe1 = currentStation.startsWith("europe1");
        int size = 512;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(europe1 ? Color.parseColor("#003ec7") : Color.parseColor("#0b0e14"));

        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextAlign(Paint.Align.CENTER);
        p.setColor(Color.WHITE);

        if (europe1) {
            p.setTextSize(120);
            c.drawText("europe 1", size / 2f, size / 2f + 40, p);
        } else {
            // Red "C" box + "NEWS"
            Paint red = new Paint(Paint.ANTI_ALIAS_FLAG);
            red.setColor(Color.parseColor("#e1001a"));
            c.drawRoundRect(new RectF(70, 196, 190, 316), 10, 10, red);
            p.setTextSize(110);
            c.drawText("C", 130, 296, p);
            p.setTextAlign(Paint.Align.LEFT);
            c.drawText("NEWS", 205, 296, p);
            if (currentStation.contains("radio")) {
                p.setTextAlign(Paint.Align.CENTER);
                p.setTextSize(44);
                p.setColor(Color.parseColor("#9aa4b8"));
                c.drawText("RADIO", size / 2f, 390, p);
            }
        }
        return bmp;
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        boolean showPause = wantPlaying;
        String status;
        switch (currentState) {
            case STATE_PLAYING: status = "En direct"; break;
            case STATE_PAUSED:  status = "En pause"; break;
            default:            status = "Connexion…";
        }

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        b.setContentTitle(title)
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_notif_radio)
            .setContentIntent(openAppIntent())
            .setDeleteIntent(serviceIntent(ACTION_STOP, 4))
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(
                showPause ? R.drawable.ic_notif_pause : R.drawable.ic_notif_play,
                showPause ? "Pause" : "Lecture",
                serviceIntent(ACTION_TOGGLE, 2)).build())
            .addAction(new Notification.Action.Builder(
                R.drawable.ic_notif_stop, "Arrêter",
                serviceIntent(ACTION_STOP, 3)).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1));
        return b.build();
    }

    private void startForegroundCompat() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void refreshNotification() {
        if (notifManager != null && streamUrl != null) {
            notifManager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Lecture en cours", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Contrôles de lecture de la radio et du direct");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        notifManager.createNotificationChannel(ch);
    }

    /** Helper used by MainActivity to start playback. */
    public static void start(Context ctx, String url, String title, String stationId) {
        Intent i = new Intent(ctx, PlaybackService.class)
            .setAction(ACTION_PLAY)
            .putExtra(EXTRA_URL, url)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_STATION, stationId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }
}
