import './style.css';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS = {
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>`,
  pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4.5" width="4.5" height="15" rx="1"/><rect x="14" y="4.5" width="4.5" height="15" rx="1"/></svg>`,
  eq: `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`,
  spinner: `<span class="spinner" aria-hidden="true"></span>`,
};

// ── Stations ──────────────────────────────────────────────────────────────────
const CANAL_BASE = 'https://hls-m015.live-cft.canalplus-cdn.net/live/disk/cnews-clair-hd/hls-ios-fhddvr-clair/';

const STATIONS = [
  {
    id: 'cnews-tv',
    title: 'CNews',
    subtitle: 'Télévision',
    type: 'tv',
    url: CANAL_BASE + 'index.m3u8',
    // Audio-only rendition used when the app goes to the background
    audioUrl: CANAL_BASE + 'cnews-clair-hd-mp4a_96000_fra=20000.m3u8',
    logo: `<span class="mark-cnews"><b>C</b>NEWS</span>`,
  },
  {
    id: 'cnews-radio',
    title: 'CNews Radio',
    subtitle: 'Radio',
    type: 'radio',
    url: CANAL_BASE + 'cnews-clair-hd-mp4a_96000_fra=20000.m3u8',
    logo: `<span class="mark-cnews"><b>C</b>NEWS</span>`,
  },
  {
    id: 'europe1',
    title: 'Europe 1',
    subtitle: 'Radio',
    type: 'radio',
    url: 'https://stream.europe1.fr/europe1.mp3',
    logo: `<span class="mark-e1">europe<b>1</b></span>`,
  },
];

const STATUS_LABEL = {
  loading: 'Connexion…',
  playing: 'En direct',
  paused: 'En pause',
};

// ── State ─────────────────────────────────────────────────────────────────────
const bridge = window.AndroidBridge; // Native player (Android app only)
const isAndroid = typeof bridge !== 'undefined';

const state = {
  station: null,   // active station
  status: 'idle',  // idle | loading | playing | paused
};
let handoff = false; // TV audio temporarily handed to the native service (app in background)
let videoHls = null;
let webAudio = null;
let audioHls = null;
let newsFilter = 'all';
let articles = [];

const $ = (id) => document.getElementById(id);

// Scale the whole UI (rem units) with the phone's font size setting
if (isAndroid && bridge.getFontScale) {
  const scale = bridge.getFontScale();
  if (scale > 0) document.documentElement.style.fontSize = `${16 * scale}px`;
}
const findStation = (id) => STATIONS.find(s => s.id === id) || null;

// ── Playback controller ───────────────────────────────────────────────────────
function play(station) {
  const previous = state.station;
  teardownVideo();
  stopWebAudio();
  // Switching radio → radio reuses the native service; anything else stops it
  if (isAndroid && previous?.type === 'radio' && station.type !== 'radio') bridge.stop();

  state.station = station;
  setStatus('loading');

  if (station.type === 'tv') {
    startVideo(station);
  } else if (isAndroid) {
    bridge.play(station.url, station.title, station.id);
  } else {
    startWebAudio(station);
  }
}

function pause() {
  const st = state.station;
  if (!st || state.status === 'paused') return;
  if (st.type === 'tv') {
    const video = $('tv-video');
    videoHls?.stopLoad();
    video?.pause();
  } else if (isAndroid) {
    bridge.pause();
  } else {
    stopWebAudio();
  }
  setStatus('paused');
}

function resume() {
  const st = state.station;
  if (!st || state.status !== 'paused') return;
  setStatus('loading');
  if (st.type === 'tv') {
    const video = $('tv-video');
    if (!videoHls || !video) return startVideo(st);
    // Back to the live edge
    videoHls.startLoad(-1);
    if (videoHls.liveSyncPosition) video.currentTime = videoHls.liveSyncPosition;
    video.play().catch(() => {});
  } else if (isAndroid) {
    bridge.resume();
  } else {
    startWebAudio(st);
  }
}

function togglePause() {
  state.status === 'paused' ? resume() : pause();
}

function stop() {
  teardownVideo();
  stopWebAudio();
  if (isAndroid) bridge.stop();
  state.station = null;
  setStatus('idle');
}

function setStatus(status) {
  state.status = status;
  if (isAndroid) {
    const st = state.station;
    const videoPlaying = st?.type === 'tv' && !handoff && (status === 'playing' || status === 'loading');
    bridge.setVideoActive(videoPlaying, st?.audioUrl || '', st?.title || '', st?.id || '');
  }
  render();
  updateWebMediaSession();
}

// ── TV (HLS video in the page) ────────────────────────────────────────────────
function startVideo(station) {
  teardownVideo();
  const frame = $('tv-frame');
  frame.innerHTML = `
    <video id="tv-video" playsinline autoplay controls></video>
    <div class="tv-loader" id="tv-loader">${ICONS.spinner}</div>
  `;
  $('tv-stage').hidden = false;

  const video = $('tv-video');
  const loader = $('tv-loader');
  const mine = () => $('tv-video') === video && state.station === station && !handoff;

  video.addEventListener('playing', () => {
    loader.hidden = true;
    if (mine()) setStatus('playing');
  });
  video.addEventListener('waiting', () => {
    if (mine() && state.status === 'playing') setStatus('loading');
  });
  // Pause / play from the native video controls
  video.addEventListener('pause', () => {
    if (mine() && state.status !== 'paused') setStatus('paused');
  });
  video.addEventListener('play', () => {
    if (mine() && state.status === 'paused') resume();
  });

  if (window.Hls?.isSupported()) {
    videoHls = new Hls({ maxBufferLength: 12, lowLatencyMode: true });
    videoHls.loadSource(station.url);
    videoHls.attachMedia(video);
    videoHls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => { videoHls.subtitleTrack = -1; });
    videoHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    videoHls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      setStatus('loading');
      setTimeout(() => {
        if (mine() && state.status !== 'paused') startVideo(station);
      }, 3000);
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = station.url;
  } else {
    loader.innerHTML = '<p>Format vidéo non supporté.</p>';
  }
}

function teardownVideo() {
  if (videoHls) {
    videoHls.destroy();
    videoHls = null;
  }
  const video = $('tv-video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  $('tv-frame').innerHTML = '';
  $('tv-stage').hidden = true;
}

// ── Radio in the browser (web version only) ───────────────────────────────────
function startWebAudio(station) {
  stopWebAudio();
  const audio = new Audio();
  webAudio = audio;
  const mine = () => webAudio === audio && state.station === station;

  audio.addEventListener('playing', () => mine() && setStatus('playing'));
  audio.addEventListener('waiting', () => mine() && setStatus('loading'));
  audio.addEventListener('error', () => {
    if (!mine()) return;
    setStatus('loading');
    setTimeout(() => mine() && startWebAudio(station), 3000);
  });

  if (station.url.includes('.m3u8') && window.Hls?.isSupported()) {
    audioHls = new Hls({ lowLatencyMode: true });
    audioHls.loadSource(station.url);
    audioHls.attachMedia(audio);
    audioHls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => {}));
  } else {
    audio.src = station.url;
    audio.play().catch(() => {});
  }
}

function stopWebAudio() {
  if (audioHls) {
    audioHls.destroy();
    audioHls = null;
  }
  if (webAudio) {
    webAudio.pause();
    webAudio.removeAttribute('src');
    webAudio.load();
    webAudio = null;
  }
}

function updateWebMediaSession() {
  if (isAndroid || !('mediaSession' in navigator)) return;
  const st = state.station;
  if (!st) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({ title: st.title, artist: 'En direct' });
  navigator.mediaSession.playbackState = state.status === 'paused' ? 'paused' : 'playing';
}

// ── Native (Android) callbacks ────────────────────────────────────────────────
// Service state changed (notification, lock screen, headset, audio focus…)
window.onNativeState = (status, stationId) => {
  const st = state.station;

  // App reopened while the service was already playing: adopt its state
  if (!st) {
    const native = findStation(stationId);
    if (!native || status === 'idle') return;
    if (native.type === 'tv') {
      state.station = native;
      handoff = true;
      window.onNativeReturn(status);
    } else {
      state.station = native;
      setStatus(status);
    }
    return;
  }

  if (st.type !== 'radio') return; // TV is driven by the <video> element
  if (stationId === st.id) {
    if (status === 'idle') stop();
    else if (status !== state.status) setStatus(status);
  } else if (status === 'idle' && stationId === '') {
    stop();
  }
};

// App going to the background while the TV plays: the native service takes over the sound
window.onNativeHandoff = () => {
  if (state.station?.type !== 'tv') return;
  handoff = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (videoHls) {
    videoHls.destroy();
    videoHls = null;
  }
  $('tv-video')?.pause();
};

// Back in the foreground: resume the video where the background audio left off
window.onNativeReturn = (nativeStatus) => {
  if (!handoff) return;
  handoff = false;
  const st = state.station;
  bridge.stop();
  if (st?.type !== 'tv') return;

  if (nativeStatus === 'idle') {
    stop(); // stopped from the notification
  } else if (nativeStatus === 'paused') {
    teardownVideo();
    $('tv-stage').hidden = false;
    $('tv-frame').innerHTML = `<button class="tv-resume" type="button">${ICONS.play}<span>Reprendre le direct</span></button>`;
    $('tv-frame').querySelector('button').addEventListener('click', resume);
    setStatus('paused');
  } else {
    startVideo(st);
    setStatus('loading');
  }
};

// ── Rendering ─────────────────────────────────────────────────────────────────
function stationIndicator(station) {
  if (state.station !== station) return ICONS.play;
  if (state.status === 'loading') return ICONS.spinner;
  if (state.status === 'paused') return ICONS.pause;
  return ICONS.eq;
}

function renderStations() {
  const list = $('stations');
  if (!list.children.length) {
    list.innerHTML = STATIONS.map(s => `
      <button class="station" type="button" data-id="${s.id}" data-brand="${s.id === 'europe1' ? 'e1' : 'cnews'}">
        <span class="station-logo">${s.logo}</span>
        <span class="station-meta">
          <span class="station-name">${s.subtitle}</span>
          <span class="station-sub">${s.subtitle}</span>
        </span>
        <span class="station-state"></span>
      </button>
    `).join('');
    list.querySelectorAll('.station').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = findStation(btn.dataset.id);
        if (state.station === s) togglePause();
        else play(s);
      });
    });
  }

  list.querySelectorAll('.station').forEach(btn => {
    const s = findStation(btn.dataset.id);
    const active = state.station === s;
    btn.classList.toggle('active', active);
    btn.querySelector('.station-sub').textContent = active
      ? STATUS_LABEL[state.status] || ''
      : (s.type === 'tv' ? 'Regarder' : 'Écouter');
    btn.querySelector('.station-state').innerHTML = stationIndicator(s);
    btn.setAttribute('aria-label', active
      ? `${s.title}, ${STATUS_LABEL[state.status]}. Toucher pour ${state.status === 'paused' ? 'reprendre' : 'mettre en pause'}`
      : `Écouter ${s.title}`);
  });
}

function renderNowPlaying() {
  const bar = $('now-playing');
  const st = state.station;
  bar.hidden = !st;
  document.body.classList.toggle('has-player', !!st);
  if (!st) return;

  $('np-art').innerHTML = st.logo;
  $('np-art').dataset.brand = st.id === 'europe1' ? 'e1' : 'cnews';
  $('np-title').textContent = st.subtitle;
  $('np-status').textContent = STATUS_LABEL[state.status] || '';
  $('np-status').dataset.status = state.status;

  const paused = state.status === 'paused';
  const toggle = $('np-toggle');
  toggle.innerHTML = paused ? ICONS.play : ICONS.pause;
  toggle.setAttribute('aria-label', paused ? 'Reprendre' : 'Pause');
}

function render() {
  renderStations();
  renderNowPlaying();
}

// ── News (RSS) ────────────────────────────────────────────────────────────────
const isNative = Capacitor.isNativePlatform();
const SITES = {
  cnews: 'https://www.cnews.fr',
  europe1: 'https://www.europe1.fr',
};

function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').trim();
}

/**
 * Downloads a page from one of the news sites.
 * App: native HTTP (no CORS). Browser: local Vite proxy /api/site/<source>/<path>.
 */
async function fetchSite(source, url) {
  if (isNative) {
    // Browser user agent: the sites' bot protection rejects the default HTTP client one
    const res = await CapacitorHttp.get({ url, responseType: 'text', headers: { 'User-Agent': navigator.userAgent } });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return typeof res.data === 'string' ? res.data : String(res.data);
  }
  const path = url.replace(SITES[source], '');
  const res = await fetch(`/api/site/${source}${path}`);
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('text/html') && path.endsWith('.xml')) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseRSS(xmlText, source) {
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  return [...xml.querySelectorAll('item')].map(item => {
    const text = (sel) => item.querySelector(sel)?.textContent?.trim() || '';
    const media = item.querySelector('enclosure[type^="image"]') || item.getElementsByTagName('media:content')[0];
    return {
      title: text('title'),
      link: text('link').split('?')[0],
      pubDate: new Date(text('pubDate') || Date.now()),
      description: htmlToText(text('description')),
      image: media?.getAttribute('url') || '',
      source,
    };
  }).filter(a => a.title);
}

async function fetchRSS(source) {
  const rssUrl = `${SITES[source]}/rss.xml`;
  try {
    const items = parseRSS(await fetchSite(source, rssUrl), source);
    if (items.length) return items;
  } catch (e) { /* static hosting without proxy: use the gateway below */ }

  // Fallback: public RSS → JSON gateway
  try {
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && Array.isArray(data.items)) {
        return data.items.map(item => ({
          title: item.title || '',
          link: (item.link || '').split('?')[0],
          pubDate: item.pubDate ? new Date(item.pubDate.replace(' ', 'T') + 'Z') : new Date(),
          description: htmlToText(item.description),
          image: item.thumbnail || item.enclosure?.link || '',
          source,
        })).filter(a => a.title);
      }
    }
  } catch (e) {
    console.warn(`Flux RSS indisponible (${source})`, e);
  }
  return [];
}

async function loadNews() {
  const refresh = $('news-refresh');
  refresh.classList.add('spinning');
  const [cnews, europe1] = await Promise.all([
    fetchRSS('cnews'),
    fetchRSS('europe1'),
  ]);
  refresh.classList.remove('spinning');
  const merged = [...cnews, ...europe1].sort((a, b) => b.pubDate - a.pubDate);
  // Keep the previous list if the network failed this time
  if (merged.length || !articles.length) articles = merged;
  renderNews();
}

function renderNews() {
  const list = $('news-list');
  const items = articles.filter(a => newsFilter === 'all' || a.source === newsFilter);

  if (!items.length) {
    list.innerHTML = `<p class="news-empty">Aucune dépêche disponible pour le moment.</p>`;
    return;
  }

  list.innerHTML = items.map((a, i) => `
    <button class="news-item" type="button" data-idx="${i}">
      <span class="news-text">
        <span class="news-top">
          <span class="news-source" data-source="${a.source}">${a.source === 'cnews' ? 'CNews' : 'Europe 1'}</span>
          <span class="news-time">${formatTimeAgo(a.pubDate)}</span>
        </span>
        <span class="news-title">${escapeHtml(a.title)}</span>
      </span>
      ${a.image ? `<img class="news-thumb" src="${escapeHtml(a.image)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}
    </button>
  `).join('');

  list.querySelectorAll('.news-item').forEach(btn => {
    btn.addEventListener('click', () => openArticle(items[+btn.dataset.idx]));
  });
}

function formatTimeAgo(date) {
  if (!date || isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Article sheet ─────────────────────────────────────────────────────────────
const articleCache = new Map();
let openedArticle = null;

/** Extracts the article text (both sites share the same CMS layout). */
function parseArticle(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.querySelector('.article-body .field-name-body') || doc.querySelector('.article-body');
  const blocks = [];

  body?.querySelectorAll('p, h2, h3, blockquote, li').forEach(el => {
    if (el.parentElement.closest('blockquote, li')) return; // already taken with its parent
    if (el.querySelector('iframe, video, script') || /iframe|embed|twitter|instagram/i.test(el.className)) return;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!text || /^(à|a) lire (aussi|également)/i.test(text) || /^lire aussi/i.test(text)) return;
    const tag = { H2: 'h4', H3: 'h4', BLOCKQUOTE: 'blockquote', LI: 'li' }[el.tagName] || 'p';
    blocks.push({ tag, text, lead: el.classList.contains('dm_article-chapeau') });
  });

  // Fallback: structured data
  if (!blocks.length) {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const body = (Array.isArray(data) ? data : [data]).find(d => d.articleBody)?.articleBody;
        if (body) {
          htmlToText(body).split(/\n+/).map(t => t.trim()).filter(Boolean)
            .forEach(text => blocks.push({ tag: 'p', text }));
          break;
        }
      } catch (e) { /* ignore */ }
    }
  }

  const image = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  return { blocks, image };
}

function renderArticleBody(blocks) {
  const content = $('article-content');
  content.innerHTML = '';
  for (const b of blocks) {
    const el = document.createElement(b.tag === 'li' ? 'p' : b.tag);
    el.textContent = b.tag === 'li' ? `• ${b.text}` : b.text;
    if (b.lead) el.className = 'lead';
    content.appendChild(el);
  }
}

async function loadFullArticle(article) {
  let full = articleCache.get(article.link);
  if (!full) {
    full = parseArticle(await fetchSite(article.source, article.link));
    if (full.blocks.length) articleCache.set(article.link, full);
  }
  if (openedArticle !== article) return; // sheet closed or another article opened
  if (full.blocks.length) renderArticleBody(full.blocks);
  else $('article-status').textContent = 'Texte complet indisponible.';
  $('article-status').hidden = full.blocks.length > 0;

  const img = $('article-img');
  if (!article.image && full.image) {
    img.src = full.image;
    img.hidden = false;
  }
}

function openArticle(article) {
  if (!article) return;
  openedArticle = article;
  $('article-source').textContent = article.source === 'cnews' ? 'CNews' : 'Europe 1';
  $('article-source').dataset.source = article.source;
  $('article-time').textContent = formatTimeAgo(article.pubDate);
  $('article-title').textContent = article.title;

  // Summary first, replaced by the full text once downloaded
  renderArticleBody(article.description ? [{ tag: 'p', text: article.description, lead: true }] : []);
  const status = $('article-status');
  status.hidden = !article.link;
  status.innerHTML = `${ICONS.spinner}<span>Chargement de l’article…</span>`;

  const img = $('article-img');
  img.hidden = !article.image;
  if (article.image) img.src = article.image; else img.removeAttribute('src');

  const link = $('article-link');
  link.hidden = !article.link;
  link.href = article.link || '#';

  const sheet = $('article-sheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.querySelector('.sheet-body').scrollTop = 0;

  if (article.link) {
    loadFullArticle(article).catch(() => {
      if (openedArticle !== article) return;
      status.textContent = 'Impossible de charger l’article complet.';
    });
  }
}

function closeArticle() {
  openedArticle = null;
  const sheet = $('article-sheet');
  if (!sheet.classList.contains('open')) return false;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  return true;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function setupEvents() {
  $('np-toggle').addEventListener('click', togglePause);
  $('np-stop').addEventListener('click', stop);
  $('news-refresh').addEventListener('click', loadNews);
  $('article-close').addEventListener('click', closeArticle);
  $('article-sheet').addEventListener('click', (e) => {
    if (e.target.id === 'article-sheet') closeArticle();
  });

  document.querySelectorAll('#news-tabs button').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#news-tabs button').forEach(t => t.classList.toggle('active', t === tab));
      newsFilter = tab.dataset.source;
      renderNews();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeArticle();
  });

  // Browser / headset media keys (web version)
  if (!isAndroid && 'mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', resume);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('stop', stop);
  }
}

function setupNative() {
  if (!isAndroid) return;

  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#07090d' }).catch(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

  // Back: close the article, leave fullscreen, otherwise send the app to the background
  // (playback continues with the notification controls)
  App.addListener('backButton', () => {
    if (closeArticle()) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    App.minimizeApp();
  });

  // Service may already be playing (app reopened)
  try {
    const { state: status, station } = JSON.parse(bridge.getState());
    window.onNativeState(status, station);
  } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  setupNative();
  render();

  const initial = findStation(new URLSearchParams(location.search).get('station'));
  if (initial && !state.station) play(initial);

  loadNews();
  setInterval(loadNews, 3 * 60 * 1000);
  // Keep the "il y a X min" labels fresh
  setInterval(renderNews, 60 * 1000);
});
