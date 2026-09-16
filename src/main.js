import './style.css';
import { App } from '@capacitor/app';

// ── SVG Icons (Newsroom & Broadcast Vectors) ──────────────────────────────────
const ICONS = {
  tv: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="13" rx="2"/>
    <path d="M12 17v4M8 21h8"/>
  </svg>`,

  radio: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="2"/>
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 7.76a6 6 0 0 0 0 8.49M20.49 3.51a12 12 0 0 1 0 16.98M3.51 3.51a12 12 0 0 0 0 16.98"/>
  </svg>`,

  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4.5l14 7.5-14 7.5V4.5z"/>
  </svg>`,

  pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="4" width="4.5" height="16" rx="1"/>
    <rect x="14.5" y="4" width="4.5" height="16" rx="1"/>
  </svg>`,

  stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>`,

  fullscreen: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>`,

  pip: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="14" rx="2"/>
    <rect x="12" y="10" width="8" height="6" rx="1"/>
  </svg>`,

  refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
  </svg>`
};

// ── Official Station Logos SVG ────────────────────────────────────────────────
const STATION_LOGOS = {
  cnews: `
    <div style="display:flex;align-items:center;font-family:'Montserrat',sans-serif;font-weight:900;">
      <span style="background:#e1001a;color:#fff;font-size:0.85rem;padding:2px 4px;border-radius:2px;margin-right:2px;">C</span>
      <span style="color:#fff;font-size:0.85rem;letter-spacing:0.02em;">NEWS</span>
    </div>
  `,
  cnewsRadio: `
    <div style="display:flex;flex-direction:column;align-items:center;font-family:'Montserrat',sans-serif;font-weight:900;line-height:1;">
      <div style="display:flex;align-items:center;">
        <span style="background:#e1001a;color:#fff;font-size:0.75rem;padding:1px 3px;border-radius:2px;margin-right:2px;">C</span>
        <span style="color:#fff;font-size:0.75rem;">NEWS</span>
      </div>
      <span style="font-size:0.5rem;color:#fca5a5;margin-top:2px;letter-spacing:0.08em;">RADIO</span>
    </div>
  `,
  europe1: `
    <div style="background:#003ec7;color:#fff;border-radius:99px;padding:2px 8px;font-family:'Montserrat',sans-serif;font-weight:800;font-size:0.75rem;letter-spacing:-0.02em;">
      europe <span style="font-weight:900">1</span>
    </div>
  `
};

// ── Stream Catalog ────────────────────────────────────────────────────────────
const CANAL_VIDEO = 'https://hls-m015.live-cft.canalplus-cdn.net/live/disk/cnews-clair-hd/hls-ios-fhddvr-clair/index.m3u8';
const CANAL_AUDIO = 'https://hls-m015.live-cft.canalplus-cdn.net/live/disk/cnews-clair-hd/hls-ios-fhddvr-clair/cnews-clair-hd-mp4a_96000_fra=20000.m3u8';

const streams = [
  {
    id: 1,
    title: 'CNews',
    sub: 'La chaîne d\'info en continu',
    channelTag: 'TNT CH 16',
    quality: '1080p HD',
    type: 'tv',
    theme: 'cnews',
    logoHtml: STATION_LOGOS.cnews,
    url: CANAL_VIDEO,
  },
  {
    id: 2,
    title: 'CNews Radio',
    sub: 'L\'antenne CNews en direct audio',
    channelTag: 'DAB+ / NUMÉRIQUE',
    quality: 'Audio HQ',
    type: 'radio',
    theme: 'cnews',
    logoHtml: STATION_LOGOS.cnewsRadio,
    audioUrl: CANAL_AUDIO,
    isHlsAudio: true,
  },
  {
    id: 3,
    title: 'Europe 1',
    sub: 'Écoutez le direct & les débats',
    channelTag: 'FM & DAB+',
    quality: 'MP3 128k',
    type: 'radio',
    theme: 'europe1',
    logoHtml: STATION_LOGOS.europe1,
    audioUrl: 'https://stream.europe1.fr/europe1.mp3',
    isHlsAudio: false,
  },
];

// ── Application State ─────────────────────────────────────────────────────────
let activeId = null;
let currentFilter = 'all';
let drawerFilter = 'all';
let videoHls = null;
let audioHls = null;
let webAudio = null;
let isPlaying = false;
let userVolume = parseFloat(localStorage.getItem('flux_volume') || '0.9');
let vuMeterInterval = null;
let allNewsArticles = [];

const isAndroid = typeof window.AndroidBridge !== 'undefined';
const grid = document.getElementById('stream-grid');
const container = document.getElementById('main-player-container');

// ── Real-time Broadcast Clock ─────────────────────────────────────────────────
function initBroadcastClock() {
  const dateEl = document.getElementById('clock-date');
  const timeEl = document.getElementById('clock-time');

  function update() {
    const now = new Date();
    if (dateEl) {
      const options = { weekday: 'short', day: 'numeric', month: 'short' };
      dateEl.textContent = now.toLocaleDateString('fr-FR', options).toUpperCase();
    }
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('fr-FR');
    }
  }

  update();
  setInterval(update, 1000);
}

// ── Navigation Filters ───────────────────────────────────────────────────────
function setupFilters() {
  const chips = document.querySelectorAll('.nav-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderStations();
    });
  });
}

// ── Render Station Tiles ──────────────────────────────────────────────────────
function renderStations() {
  grid.innerHTML = '';

  const filtered = streams.filter(s => {
    if (currentFilter === 'tv') return s.type === 'tv';
    if (currentFilter === 'radio') return s.type === 'radio';
    return true;
  });

  filtered.forEach(s => {
    const tile = document.createElement('div');
    const isActive = s.id === activeId;
    tile.className = `station-tile${isActive ? ' active' : ''}`;
    tile.dataset.id = s.id;
    tile.dataset.theme = s.theme;
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');

    tile.innerHTML = `
      <div class="station-logo-box" style="background: ${s.theme === 'cnews' ? '#0b0f19' : '#031b4d'}">
        ${s.logoHtml}
      </div>
      <div class="station-meta">
        <div class="station-headline">
          <span class="station-name">${s.title}</span>
          <span class="badge-live-tag">EN LIGNE</span>
        </div>
        <span class="station-sub">${s.sub}</span>
        <div class="station-badges">
          <span class="badge-canal">${s.channelTag}</span>
          <span class="badge-canal">${s.quality}</span>
        </div>
      </div>
    `;

    tile.addEventListener('click', () => selectStation(s));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectStation(s);
      }
    });

    grid.appendChild(tile);
  });
}

function updateStationTilesActiveState() {
  document.querySelectorAll('.station-tile').forEach(tile => {
    const isCurrent = parseInt(tile.dataset.id, 10) === activeId;
    tile.classList.toggle('active', isCurrent);
  });
}

// ── Select Station ────────────────────────────────────────────────────────────
function selectStation(stream) {
  if (stream.id === activeId) {
    stopBroadcast(true);
    return;
  }

  stopBroadcast(false);
  activeId = stream.id;
  isPlaying = true;
  updateStationTilesActiveState();

  if (stream.type === 'tv') {
    playTV(stream);
  } else {
    playRadio(stream);
  }
}

// ── CNews TV Live Playback ───────────────────────────────────────────────────
function playTV(stream) {
  stopVUMeter();

  container.innerHTML = `
    <div class="cnews-tv-view">
      <div class="tv-loader" id="tv-loading">
        <div class="spinner-news"></div>
        <p>CONNEXION DIRECT CANAL+ CDN (${stream.title})…</p>
      </div>

      <div class="tv-onair-bar">
        <div class="tv-onair-bug">
          <div class="bug-cnews">CNEWS</div>
          <div class="bug-direct"><span class="bug-dot"></span>DIRECT</div>
        </div>

        <div class="tv-toolbar-actions">
          <button class="tv-tool-btn" id="tv-refresh-btn" title="Actualiser le direct">
            ${ICONS.refresh}
          </button>
          <button class="tv-tool-btn" id="tv-pip-btn" title="Picture in Picture">
            ${ICONS.pip}
          </button>
          <button class="tv-tool-btn" id="tv-fs-btn" title="Plein écran">
            ${ICONS.fullscreen}
          </button>
        </div>
      </div>

      <video id="hls-video" playsinline autoplay controls></video>
    </div>
  `;

  const video = document.getElementById('hls-video');
  const loader = document.getElementById('tv-loading');
  video.volume = userVolume;

  document.getElementById('tv-refresh-btn')?.addEventListener('click', () => {
    if (activeId === stream.id) playTV(stream);
  });

  document.getElementById('tv-pip-btn')?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video?.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP non supporté:', e);
    }
  });

  document.getElementById('tv-fs-btn')?.addEventListener('click', () => {
    const frame = document.getElementById('player-wrapper');
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      (frame || video).requestFullscreen?.();
    }
  });

  if (window.Hls && Hls.isSupported()) {
    videoHls = new Hls({ maxBufferLength: 12, enableWorker: true, lowLatencyMode: true });
    videoHls.loadSource(stream.url);
    videoHls.attachMedia(video);

    videoHls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      videoHls.subtitleTrack = -1;
    });

    videoHls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (loader) loader.style.display = 'none';
      video.play().catch(() => {});
    });

    videoHls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal && activeId === stream.id) {
        setTimeout(() => { if (activeId === stream.id) playTV(stream); }, 3000);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = stream.url;
    video.addEventListener('loadedmetadata', () => {
      if (loader) loader.style.display = 'none';
      video.play().catch(() => {});
    });
  } else {
    if (loader) loader.innerHTML = `<p style="color:#ef4444;">Format non supporté.</p>`;
  }

  video.addEventListener('volumechange', () => {
    userVolume = video.volume;
    localStorage.setItem('flux_volume', userVolume.toString());
  });
}

// ── Radio Broadcast Studio Console & Stereo VU-Meter ──────────────────────────
function playRadio(stream) {
  isPlaying = true;

  if (isAndroid && window.AndroidBridge?.startRadio) {
    window.AndroidBridge.startRadio(stream.audioUrl, stream.title);
  } else {
    setupWebAudio(stream);
  }

  renderRadioConsole(stream, true);
  startVUMeter();
}

function setupWebAudio(stream) {
  stopWebAudio();
  webAudio = new Audio();
  webAudio.volume = userVolume;

  if (stream.isHlsAudio && window.Hls && Hls.isSupported()) {
    audioHls = new Hls({ lowLatencyMode: true });
    audioHls.loadSource(stream.audioUrl);
    audioHls.attachMedia(webAudio);
    audioHls.on(Hls.Events.MANIFEST_PARSED, () => {
      webAudio.play().catch(() => {});
    });
  } else {
    webAudio.src = stream.audioUrl;
    webAudio.play().catch(e => console.warn('Audio play notice:', e));
  }
}

function stopWebAudio() {
  if (audioHls) {
    audioHls.destroy();
    audioHls = null;
  }
  if (webAudio) {
    webAudio.pause();
    webAudio.src = '';
    webAudio = null;
  }
}

function renderRadioConsole(stream, playing) {
  const isCnews = stream.theme === 'cnews';
  const emblemClass = isCnews ? 'cnews-radio-theme' : 'europe1-theme';
  const emblemContent = isCnews ? STATION_LOGOS.cnewsRadio : STATION_LOGOS.europe1;

  const renderLeds = () => {
    return Array.from({ length: 20 }, (_, i) => {
      const color = i < 12 ? 'green' : i < 17 ? 'yellow' : 'red';
      return `<span class="vu-led ${color}"></span>`;
    }).join('');
  };

  container.innerHTML = `
    <div class="radio-console-view ${playing ? 'live' : ''}" id="radio-console">
      <!-- Studio ON AIR Warning Box -->
      <div class="studio-onair-sign">
        <span class="sign-bulb"></span>
        <span>STUDIO ON AIR</span>
      </div>

      <!-- Station Emblem -->
      <div class="studio-station-badge">
        <div class="station-emblem ${emblemClass}">
          ${emblemContent}
        </div>
        <h2 class="studio-station-title">${stream.title}</h2>
        <div class="studio-station-status">Diffusion Direct Studio · ${stream.quality}</div>
      </div>

      <!-- Professional Broadcast Stereo VU-Meter -->
      <div class="stereo-vumeter" aria-label="VU-mètre stéréo broadcast">
        <div class="vu-channel">
          <span class="vu-label">L</span>
          <div class="vu-led-track" id="vu-track-l">
            ${renderLeds()}
          </div>
        </div>
        <div class="vu-channel">
          <span class="vu-label">R</span>
          <div class="vu-led-track" id="vu-track-r">
            ${renderLeds()}
          </div>
        </div>
        <div class="vu-scale">
          <span>-36</span>
          <span>-24</span>
          <span>-12</span>
          <span>-6</span>
          <span>0dB</span>
          <span>+3</span>
        </div>
      </div>

      <!-- Control Deck -->
      <div class="radio-deck-controls">
        <button class="btn-broadcast-stop" id="btn-radio-stop" title="Interrompre la liaison">
          ${ICONS.stop}
        </button>
        <button class="btn-broadcast-master ${playing ? 'pause-mode' : 'play-mode'}" id="btn-radio-toggle">
          ${playing ? ICONS.pause : ICONS.play}
          <span id="btn-toggle-label">${playing ? 'SUSPENDRE L\'ANTENNE' : 'LANCER L\'ANTENNE'}</span>
        </button>
      </div>

      <!-- Master Volume Fader -->
      <div class="master-fader-bar">
        <span class="fader-label">NIVEAU MASTER</span>
        <input type="range" class="fader-slider" id="fader-slider" min="0" max="1" step="0.05" value="${userVolume}">
        <span class="fader-value" id="fader-readout">${Math.round(userVolume * 100)}%</span>
      </div>
    </div>
  `;

  document.getElementById('btn-radio-stop')?.addEventListener('click', () => stopBroadcast(true));
  document.getElementById('btn-radio-toggle')?.addEventListener('click', toggleRadioPlayback);

  const slider = document.getElementById('fader-slider');
  const readout = document.getElementById('fader-readout');

  slider?.addEventListener('input', (e) => {
    userVolume = parseFloat(e.target.value);
    localStorage.setItem('flux_volume', userVolume.toString());
    if (webAudio) webAudio.volume = userVolume;
    if (readout) readout.textContent = `${Math.round(userVolume * 100)}%`;
  });
}

function toggleRadioPlayback() {
  const stream = streams.find(s => s.id === activeId);
  if (!stream) return;

  isPlaying = !isPlaying;

  if (isAndroid && window.AndroidBridge) {
    isPlaying
      ? window.AndroidBridge.startRadio(stream.audioUrl, stream.title)
      : window.AndroidBridge.stopStream();
  } else if (webAudio) {
    if (isPlaying) webAudio.play().catch(() => {});
    else webAudio.pause();
  }

  const consoleView = document.getElementById('radio-console');
  const toggleBtn = document.getElementById('btn-radio-toggle');

  if (consoleView) consoleView.classList.toggle('live', isPlaying);
  if (toggleBtn) {
    toggleBtn.className = `btn-broadcast-master ${isPlaying ? 'pause-mode' : 'play-mode'}`;
    toggleBtn.innerHTML = `${isPlaying ? ICONS.pause : ICONS.play} <span id="btn-toggle-label">${isPlaying ? 'SUSPENDRE L\'ANTENNE' : 'LANCER L\'ANTENNE'}</span>`;
  }

  if (isPlaying) startVUMeter();
  else stopVUMeter();
}

// ── Realistic VU-Meter Simulation ─────────────────────────────────────────────
function startVUMeter() {
  stopVUMeter();

  vuMeterInterval = setInterval(() => {
    if (!isPlaying) {
      resetVULeds();
      return;
    }

    const baseLevel = Math.max(3, Math.floor(userVolume * 14));
    const randomL = Math.min(20, Math.max(0, baseLevel + Math.floor((Math.random() - 0.45) * 7)));
    const randomR = Math.min(20, Math.max(0, baseLevel + Math.floor((Math.random() - 0.45) * 7)));

    updateChannelLEDs('vu-track-l', randomL);
    updateChannelLEDs('vu-track-r', randomR);
  }, 100);
}

function updateChannelLEDs(trackId, activeCount) {
  const track = document.getElementById(trackId);
  if (!track) return;
  const leds = track.children;
  for (let i = 0; i < leds.length; i++) {
    leds[i].classList.toggle('active', i < activeCount);
  }
}

function resetVULeds() {
  updateChannelLEDs('vu-track-l', 0);
  updateChannelLEDs('vu-track-r', 0);
}

function stopVUMeter() {
  if (vuMeterInterval) {
    clearInterval(vuMeterInterval);
    vuMeterInterval = null;
  }
  resetVULeds();
}

// ── Stop & Reset ──────────────────────────────────────────────────────────────
window.stopBroadcast = function(resetUI = true) {
  stopVUMeter();

  if (videoHls) {
    videoHls.destroy();
    videoHls = null;
  }
  const vid = document.getElementById('hls-video');
  if (vid) {
    vid.pause();
    vid.src = '';
  }

  stopWebAudio();

  if (isAndroid && window.AndroidBridge?.stopStream) {
    window.AndroidBridge.stopStream();
  }

  isPlaying = false;

  if (resetUI) {
    activeId = null;
    updateStationTilesActiveState();
    renderStandby();
  }
};

window.stopCurrent = window.stopBroadcast;
window.goHome = window.stopBroadcast;

// ── Standby / Ready Screen ────────────────────────────────────────────────────
function renderStandby() {
  stopVUMeter();

  container.innerHTML = `
    <div class="standby-view">
      <div class="test-bars-box" aria-hidden="true">
        <span class="bar-c1"></span>
        <span class="bar-c2"></span>
        <span class="bar-c3"></span>
        <span class="bar-c4"></span>
        <span class="bar-c5"></span>
        <span class="bar-c6"></span>
        <span class="bar-c7"></span>
      </div>

      <h2 class="standby-title">RÉGIE DE DIFFUSION EN DIRECT</h2>
      <p class="standby-desc">Sélectionnez une station ci-dessus pour engager la liaison broadcast direct CNews (TV) ou Europe 1 (Radio).</p>

      <div class="standby-quick-buttons">
        <button class="quick-feed-btn" id="quick-btn-cnews">
          <span style="color:#e1001a">${ICONS.tv}</span> CNEWS TÉLÉVISION
        </button>
        <button class="quick-feed-btn" id="quick-btn-europe1">
          <span style="color:#003ec7">${ICONS.radio}</span> EUROPE 1 RADIO
        </button>
      </div>
    </div>
  `;

  document.getElementById('quick-btn-cnews')?.addEventListener('click', () => {
    const s = streams.find(st => st.id === 1);
    if (s) selectStation(s);
  });

  document.getElementById('quick-btn-europe1')?.addEventListener('click', () => {
    const s = streams.find(st => st.id === 3);
    if (s) selectStation(s);
  });
}

// ── Live RSS News Feeds (CNews & Europe 1) ────────────────────────────────────
async function fetchRSS(localProxyUrl, directRssUrl, sourceName) {
  // 1. Essai via le proxy local Vite
  try {
    const res = await fetch(localProxyUrl);
    if (res.ok) {
      const text = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');
      const items = xml.querySelectorAll('item');
      const results = [];

      items.forEach(item => {
        const title = item.querySelector('title')?.textContent?.trim() || '';
        const link = item.querySelector('link')?.textContent?.trim() || '';
        const pubDateRaw = item.querySelector('pubDate')?.textContent?.trim() || '';
        const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
        let description = item.querySelector('description')?.textContent?.trim() || '';

        // Extract image enclosure if available
        let image = '';
        const imgEnclosure = item.querySelector('enclosure[type^="image"]');
        if (imgEnclosure && imgEnclosure.getAttribute('url')) {
          image = imgEnclosure.getAttribute('url');
        } else {
          const mediaContent = item.querySelector('media\\:content, content');
          if (mediaContent && mediaContent.getAttribute('url')) {
            image = mediaContent.getAttribute('url');
          }
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = description;
        description = tempDiv.textContent || tempDiv.innerText || '';

        if (title) {
          results.push({ title, link, pubDate, description, source: sourceName, image });
        }
      });

      if (results.length > 0) return results;
    }
  } catch (e) {
    // Proxy local non disponible (ex: APK standalone)
  }

  // 2. Fallback pour APK Android / standalone sans proxy local
  try {
    const fallbackUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(directRssUrl)}`;
    const res = await fetch(fallbackUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && Array.isArray(data.items)) {
        return data.items.map(item => {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = item.description || '';
          const description = tempDiv.textContent || tempDiv.innerText || '';
          const image = item.thumbnail || (item.enclosure && item.enclosure.link) || '';

          return {
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            description: description,
            source: sourceName,
            image: image
          };
        });
      }
    }
  } catch (err) {
    console.warn(`Fallback RSS échoué pour ${sourceName}:`, err);
  }

  return [];
}

async function loadAllNewsFeeds() {
  const syncStatus = document.getElementById('rss-sync-status');
  if (syncStatus) syncStatus.textContent = 'Actualisation des flux RSS…';

  const [cnewsItems, europe1Items] = await Promise.all([
    fetchRSS('/api/rss/cnews', 'https://www.cnews.fr/rss.xml', 'cnews'),
    fetchRSS('/api/rss/europe1', 'https://www.europe1.fr/rss.xml', 'europe1')
  ]);

  // Combine and sort by date descending
  let combined = [...cnewsItems, ...europe1Items];

  // If both failed or empty (e.g. offline fallback), provide recent editorial dispatches
  if (combined.length === 0) {
    combined = [
      {
        title: "CNEWS en direct 24h/24 : retrouvez tous les débats et l'actualité politique",
        link: "https://www.cnews.fr",
        pubDate: new Date(),
        description: "Suivez l'information en continu en France et à l'international depuis le studio broadcast.",
        source: "cnews"
      },
      {
        title: "EUROPE 1 en direct : interviews, libre antenne et grands reportages",
        link: "https://www.europe1.fr",
        pubDate: new Date(),
        description: "Écoutez les rendez-vous d'actualité et d'analyse en direct de l'antenne radio.",
        source: "europe1"
      }
    ];
  } else {
    combined.sort((a, b) => b.pubDate - a.pubDate);
  }

  allNewsArticles = combined;
  updateMarquee(combined);
  renderDrawerNews();

  if (syncStatus) {
    const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    syncStatus.textContent = `Dépêches synchronisées (${timeStr})`;
  }
}

function updateMarquee(articles) {
  const marquee = document.getElementById('rss-marquee');
  if (!marquee) return;

  const topArticles = articles.slice(0, 15);
  const itemsHtml = topArticles.map((a, idx) => `
    <button class="ticker-item" type="button" data-ticker-idx="${idx}">
      <span class="ticker-source ${a.source}">${a.source === 'cnews' ? 'CNEWS' : 'EUROPE 1'}</span>
      <span>${escapeHtml(a.title)}</span>
    </button>
    <span class="ticker-sep">•</span>
  `).join('');

  // Duplicate for smooth seamless loop
  marquee.innerHTML = itemsHtml + itemsHtml;

  // In-app click handler (no external navigation)
  marquee.querySelectorAll('.ticker-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.dataset.tickerIdx, 10);
      const article = topArticles[idx];
      if (article) {
        openArticleModal(article);
      }
    });
  });

  // Régler une vitesse de lecture calme et confortable (~50px/seconde)
  requestAnimationFrame(() => {
    const halfWidth = marquee.scrollWidth / 2;
    const speed = 50; // pixels par seconde
    const duration = Math.max(140, Math.round(halfWidth / speed));
    marquee.style.animationDuration = `${duration}s`;
  });
}

function renderDrawerNews() {
  const containerEl = document.getElementById('news-feed-scroll');
  if (!containerEl) return;

  const filtered = allNewsArticles.filter(a => {
    if (drawerFilter === 'cnews') return a.source === 'cnews';
    if (drawerFilter === 'europe1') return a.source === 'europe1';
    return true;
  });

  if (filtered.length === 0) {
    containerEl.innerHTML = `
      <div class="feed-loading-state">
        <p>Aucune dépêche trouvée pour cette source.</p>
      </div>
    `;
    return;
  }

  containerEl.innerHTML = filtered.map((item, idx) => {
    const timeAgo = formatTimeAgo(item.pubDate);
    const sourceLabel = item.source === 'cnews' ? 'CNEWS' : 'EUROPE 1';

    return `
      <article class="feed-item-card" data-feed-idx="${idx}" role="button" tabindex="0">
        <div class="feed-item-top">
          <span class="feed-source-tag ${item.source}">${sourceLabel}</span>
          <span class="feed-time">${timeAgo}</span>
        </div>
        <div class="feed-item-title">
          ${escapeHtml(item.title)}
        </div>
        ${item.description ? `<p class="feed-item-snippet">${escapeHtml(item.description)}</p>` : ''}
        <button class="feed-item-link" type="button">
          Lire la dépêche en direct →
        </button>
      </article>
    `;
  }).join('');

  containerEl.querySelectorAll('.feed-item-card').forEach(card => {
    const idx = parseInt(card.dataset.feedIdx, 10);
    const article = filtered[idx];
    const clickHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (article) openArticleModal(article);
    };

    card.addEventListener('click', clickHandler);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (article) openArticleModal(article);
      }
    });
  });
}

function formatTimeAgo(date) {
  if (!date || isNaN(date.getTime())) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'À l\'instant';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── In-App News Article Reader Modal ──────────────────────────────────────────
function openArticleModal(article) {
  if (!article) return;

  const overlay = document.getElementById('article-modal-overlay');
  const titleEl = document.getElementById('modal-article-title');
  const descEl = document.getElementById('modal-article-desc');
  const timeEl = document.getElementById('modal-article-time');
  const pillEl = document.getElementById('modal-source-pill');
  const imgBox = document.getElementById('modal-article-img-box');
  const imgEl = document.getElementById('modal-article-img');

  if (titleEl) titleEl.textContent = article.title || 'Actualité en direct';
  if (descEl) descEl.textContent = article.description || 'Suivez les prochaines éditions en direct sur l\'antenne pour plus de précisions sur cette information.';
  if (timeEl) timeEl.textContent = formatTimeAgo(article.pubDate) || 'En continu';

  if (pillEl) {
    const isCnews = article.source === 'cnews';
    pillEl.textContent = isCnews ? 'CNEWS DIRECT' : 'EUROPE 1 DIRECT';
    pillEl.className = `modal-source-pill ${article.source}`;
  }

  if (imgBox && imgEl) {
    if (article.image) {
      imgEl.src = article.image;
      imgEl.alt = article.title || 'Illustration';
      imgBox.style.display = 'block';
    } else {
      imgBox.style.display = 'none';
      imgEl.src = '';
    }
  }

  overlay?.classList.add('open');
  overlay?.setAttribute('aria-hidden', 'false');

  // Push state to browser/webview history so Android back gesture returns cleanly
  try {
    history.pushState({ modal: 'article' }, '');
  } catch (e) {
    // Ignored in restricted contexts
  }
}

function closeArticleModal() {
  const overlay = document.getElementById('article-modal-overlay');
  if (overlay && overlay.classList.contains('open')) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function setupArticleModal() {
  const overlay = document.getElementById('article-modal-overlay');
  const backBtn = document.getElementById('btn-modal-back');
  const closeMainBtn = document.getElementById('btn-modal-close-main');

  const closeAndBack = () => {
    closeArticleModal();
    if (window.history.state && window.history.state.modal === 'article') {
      window.history.back();
    }
  };

  backBtn?.addEventListener('click', closeAndBack);
  closeMainBtn?.addEventListener('click', closeAndBack);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAndBack();
    }
  });
}

// ── Android Back Button & Popstate Support ────────────────────────────────────
function setupAndroidBackButton() {
  try {
    App.addListener('backButton', () => {
      const modal = document.getElementById('article-modal-overlay');
      if (modal && modal.classList.contains('open')) {
        closeArticleModal();
        return;
      }

      const drawer = document.getElementById('news-drawer-overlay');
      if (drawer && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        return;
      }

      // If no overlays are open, exit app smoothly
      App.exitApp();
    });
  } catch (e) {
    console.warn('Capacitor App backButton listener non disponible:', e);
  }

  // Also support window popstate (web / Android WebView back gesture)
  window.addEventListener('popstate', () => {
    const modal = document.getElementById('article-modal-overlay');
    if (modal && modal.classList.contains('open')) {
      closeArticleModal();
    }
    const drawer = document.getElementById('news-drawer-overlay');
    if (drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
    }
  });
}

// ── Drawer Open / Close / Filter Events ──────────────────────────────────────
function setupDrawer() {
  const overlay = document.getElementById('news-drawer-overlay');
  const openBtn = document.getElementById('btn-open-feed');
  const closeBtn = document.getElementById('btn-close-drawer');
  const refreshBtn = document.getElementById('btn-refresh-rss');
  const feedTabs = document.querySelectorAll('.feed-tab');

  const openDrawer = () => {
    overlay?.classList.add('open');
    renderDrawerNews();
    try {
      history.pushState({ drawer: true }, '');
    } catch (e) {}
  };

  const closeDrawer = () => {
    overlay?.classList.remove('open');
    if (window.history.state && window.history.state.drawer) {
      window.history.back();
    }
  };

  openBtn?.addEventListener('click', openDrawer);
  closeBtn?.addEventListener('click', closeDrawer);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDrawer();
    }
  });

  refreshBtn?.addEventListener('click', () => {
    loadAllNewsFeeds();
  });

  feedTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      feedTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      drawerFilter = tab.dataset.source;
      renderDrawerNews();
    });
  });
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initBroadcastClock();
  setupFilters();
  setupDrawer();
  setupArticleModal();
  setupAndroidBackButton();
  renderStations();
  renderStandby();
  loadAllNewsFeeds();

  // Auto-refresh news feeds every 3 minutes
  setInterval(loadAllNewsFeeds, 180000);
});

