import './style.css';

// Favoris par défaut
const DEFAULT_STREAMS = [
  {
    id: 1,
    title: "France 24",
    description: "L'actualité internationale 24h/24.",
    type: "tv",
    html: `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="https://static.france24.com/live/f24_fr.m3u8"></video>`
  },
  {
    id: 2,
    title: "Europe 1",
    description: "La radio généraliste d'actualité et de divertissement.",
    type: "radio",
    html: `
      <div class="radio-player-container">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:1rem; opacity:0.8;"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg>
        <audio controls style="width:80%; max-width:300px; border-radius:30px; margin-top:10px;">
          <source src="https://stream.europe1.fr/europe1.mp3" type="audio/mpeg">
          Votre navigateur ne supporte pas l'élément audio.
        </audio>
      </div>
    `
  },
  {
    id: 3,
    title: "ARTE en direct",
    description: "La chaîne culturelle européenne.",
    type: "tv",
    html: `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/index.m3u8"></video>`
  },
  {
    id: 4,
    title: "BFM TV",
    description: "Première chaîne d'info de France.",
    type: "tv",
    html: `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="https://bfmtv-video.akamaized.net/hls/live/2042211/bfmtv/master.m3u8"></video>`
  },
  {
    id: 5,
    title: "TV5 Monde Info",
    description: "Le journal télévisé international en continu.",
    type: "tv",
    html: `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="https://ott.tv5monde.com/Content/HLS/Live/channel(info)/index.m3u8"></video>`
  },
  {
    id: 6,
    title: "CNEWS",
    description: "La chaîne d'information du groupe Canal+.",
    type: "tv",
    html: `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="https://cnews-hls.live-streaming.canalplus.com/canalplus/cnews_hls/index.m3u8"></video>`
  }
];

// État de l'application
let streams = JSON.parse(localStorage.getItem('my_fav_streams')) || DEFAULT_STREAMS;
let activeHls = null;
let currentActiveStreamId = null;
let activePlaylistChannels = [];
let globalIptvChannels = [];
let currentSource = 'favorites'; // 'favorites' or 'playlist'
let wakeLock = null;

// DOM Elements
const m3uInput = document.getElementById('m3u-url-input');
const m3uLoadBtn = document.getElementById('m3u-load-btn');
const freeBtn = document.getElementById('m3u-free-btn');
const frBtn = document.getElementById('m3u-fr-btn');
const dropboxBtn = document.getElementById('m3u-dropbox-btn');
const playlistFilterBtn = document.getElementById('playlist-filter-btn');
const searchBtn = document.getElementById('iptv-search-btn');
const searchInput = document.getElementById('iptv-search-input');
const playerContainer = document.getElementById('main-player-container');
const playerInfo = document.getElementById('main-player-info');

function saveFavs() {
  localStorage.setItem('my_fav_streams', JSON.stringify(streams));
}

function addFavorite(stream) {
  if (!streams.some(s => s.title === stream.title && s.url === stream.url)) {
    // Créer une copie propre pour les favoris
    const newFav = {
      ...stream,
      id: Date.now(),
      description: "Ajouté aux favoris"
    };
    streams.push(newFav);
    saveFavs();
    renderStreams(currentSource === 'favorites' ? 'all' : currentSource);
  }
}

function removeFavorite(id) {
  streams = streams.filter(s => s.id !== id);
  saveFavs();
  renderStreams(currentSource === 'favorites' ? 'all' : currentSource);
}

function playStream(stream) {
  currentActiveStreamId = stream.id;
  document.querySelectorAll('.stream-list-item').forEach(el => {
    if (el.dataset.id == stream.id) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  playerContainer.innerHTML = '';

  const url = stream.url || (stream.html ? (stream.html.match(/src="([^"]+)"/)?.[1] || stream.html.match(/data-hls-url="([^"]+)"/)?.[1]) : null);

  if (url && url.startsWith('rtp://')) {
    playerContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-secondary); padding:2rem; text-align:center; background:#000;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:1rem; color:#f59e0b;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <p style="color:white; font-size:1.1rem; font-weight:600;">Flux RTP (Box TV) détecté</p>
        <p style="font-size: 0.9rem; margin-top: 0.5rem;">Les navigateurs web ne peuvent pas lire directement le protocole <strong>rtp://</strong>.</p>
        <div style="margin-top: 1.5rem; background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; text-align: left; font-size: 0.85rem;">
          <p>Pour lire cette chaîne, vous devez :</p>
          <ul style="margin-top:0.5rem; margin-left: 1.2rem;">
            <li>Utiliser un logiciel comme <strong>VLC Media Player</strong>.</li>
            <li>Copier l'URL : <code style="background:#333; padding:2px 4px; border-radius:4px;">${url}</code></li>
            <li>Dans VLC : Média > Ouvrir un flux réseau.</li>
          </ul>
        </div>
      </div>`;
  } else if (stream.type === 'radio') {
    playerContainer.innerHTML = `
      <div class="radio-player-container">
        <div class="radio-pulse"></div>
        <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:2rem; filter: drop-shadow(0 0 10px var(--accent));"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg>
        <div id="radio-audio-target"></div>
        <p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.9rem;">Lecture en cours...</p>
      </div>
    `;

    const target = document.getElementById('radio-audio-target');
    const url = stream.url || (stream.html ? (stream.html.match(/src="([^"]+)"/)?.[1] || stream.html.match(/data-hls-url="([^"]+)"/)?.[1]) : null);
    const isHls = url && (url.includes('.m3u8') || url.includes('manifest'));

    if (isHls) {
      const video = document.createElement('video');
      video.controls = true;
      video.style.width = '300px';
      video.style.height = '50px';
      target.appendChild(video);
      initHls(video, url, stream.id);
    } else {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.style.width = '300px';
      audio.src = url;
      target.appendChild(audio);
      audio.onerror = () => handleStreamError(stream.id);
      audio.play().catch(() => { });
    }
  } else {
    playerContainer.innerHTML = stream.html;
    const video = playerContainer.querySelector('video[data-hls-url]');
    if (video) {
      initHls(video, video.getAttribute('data-hls-url'), stream.id);
    } else {
      const nativeVideo = playerContainer.querySelector('video');
      if (nativeVideo) {
        nativeVideo.onerror = () => handleStreamError(stream.id);
      }
    }
  }

  playerInfo.style.display = 'block';
  document.getElementById('main-player-type').className = `stream-type ${stream.type}`;
  document.getElementById('main-player-type').innerText = stream.type.toUpperCase();
  document.getElementById('main-player-title').innerText = stream.title;
  document.getElementById('main-player-desc').innerText = stream.description;

  // Empêcher l'écran de s'éteindre (Wake Lock)
  requestWakeLock();
}

// --- Gestion du Wake Lock (Empêcher l'écran de s'éteindre) ---
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      if (wakeLock) await wakeLock.release();
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('La veille de l\'écran est désactivée');

      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock relâché');
      });
    } catch (err) {
      console.error(`${err.name}, ${err.message}`);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}

// Re-demander le wake lock si on revient sur l'onglet
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

function initHls(element, url, streamId) {
  if (window.Hls && window.Hls.isSupported()) {
    activeHls = new window.Hls();
    activeHls.loadSource(url);
    activeHls.attachMedia(element);
    activeHls.on(window.Hls.Events.MANIFEST_PARSED, () => element.play().catch(() => { }));

    // Gestion des erreurs HLS
    activeHls.on(window.Hls.Events.ERROR, function (event, data) {
      if (data.fatal) {
        console.error("HLS fatal error:", data.type);
        handleStreamError(streamId);
      }
    });
  } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
    element.src = url;
    element.addEventListener('loadedmetadata', () => element.play());
    element.onerror = () => handleStreamError(streamId);
  }
}

function handleStreamError(streamId) {
  console.warn("Stream error detected for ID:", streamId);

  // Marquer le flux comme cassé dans la session
  const markAsBroken = (s) => {
    if (s.id == streamId) s.isBroken = true;
  };

  streams.forEach(markAsBroken);
  activePlaylistChannels.forEach(markAsBroken);
  globalIptvChannels.forEach(markAsBroken);

  // Alerte visuelle discrète ou passage au suivant ?
  // Pour l'instant on rafraîchit juste la liste (le flux disparaîtra)
  renderStreams(document.querySelector('.filter-btn.active').dataset.type || 'all');

  // Informer l'utilisateur
  const infoTitle = document.getElementById('main-player-title');
  if (infoTitle) infoTitle.innerText += " (Lien mort)";
}


function renderStreams(filter = 'all', overrideStreams = null) {
  const grid = document.getElementById('stream-grid');
  grid.innerHTML = '';

  let baseStreams;
  if (overrideStreams) {
    baseStreams = overrideStreams;
  } else {
    baseStreams = (currentSource === 'playlist') ? activePlaylistChannels : streams;
  }

  let filteredStreams;
  if (filter === 'all' || (currentSource === 'playlist' && filter === 'playlist')) {
    filteredStreams = baseStreams;
  } else {
    filteredStreams = baseStreams.filter(s => s.type === filter);
  }

  // Filtrer les flux qui ont été marqués comme erronés
  filteredStreams = filteredStreams.filter(s => !s.isBroken);

  if (filteredStreams.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 1rem;">Aucun canal valide dans cette catégorie.</p>`;
    return;
  }

  filteredStreams.forEach((stream, index) => {
    const item = document.createElement('div');
    item.className = 'stream-list-item';
    if (stream.id === currentActiveStreamId) item.classList.add('active');
    item.dataset.id = stream.id;

    const isAlreadyFav = streams.some(s => s.title === stream.title);

    let actionBtn = '';
    if (currentSource === 'favorites') {
      actionBtn = `
        <button class="delete-fav-btn" title="Enlever des favoris" onclick="event.stopPropagation(); window.removeFavorite(${stream.id})">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      `;
    } else if (!isAlreadyFav) {
      actionBtn = `
        <button class="add-fav-btn" title="Ajouter aux favoris" id="add-btn-${index}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      `;
    }

    item.innerHTML = `
      <div class="stream-item-content">
        <div class="stream-list-title">${stream.title}</div>
        <div class="stream-list-desc">${stream.description}</div>
      </div>
      ${actionBtn}
    `;

    if (!isAlreadyFav && currentSource !== 'favorites') {
      const btn = item.querySelector('.add-fav-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          addFavorite(stream);
        });
      }
    }

    item.addEventListener('click', () => playStream(stream));
    grid.appendChild(item);
  });
}

// Rendre les fonctions accessibles
window.removeFavorite = removeFavorite;
window.addFavorite = addFavorite;

function parseM3U(text, sourceName) {
  const lines = text.split('\n');
  const channels = [];
  let currentChannel = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const extinfParts = line.split(',');
      const title = extinfParts[extinfParts.length - 1].trim();
      const isRadio = line.includes('radio="true"') ||
        line.toLowerCase().includes('group-title="radio"') ||
        line.toLowerCase().includes(';radio') ||
        title.toLowerCase().includes(' radio ');

      currentChannel = {
        title: title || "Sans nom",
        description: `Source: ${sourceName}`,
        type: isRadio ? "radio" : "tv"
      };
    } else if (line.startsWith('http') || line.startsWith('rtsp') || line.startsWith('rtp://')) {
      if (currentChannel.title) {
        const url = line;
        channels.push({
          ...currentChannel,
          id: 'pl_' + channels.length + '_' + Date.now(),
          url: url,
          html: (currentChannel.type === "tv" && !url.startsWith('rtp://'))
            ? `<video controls style="width:100%; height:100%; position:absolute; left:0px; top:0px; border-radius:16px 16px 0 0;" data-hls-url="${url}"></video>`
            : null
        });
      }
      currentChannel = {};
    }
  }
  return channels;
}

async function loadM3UFromUrl(url, sourceName = "M3U") {
  if (!url) return;
  m3uLoadBtn.innerText = "Chargement...";
  try {
    // Ajouter un timestamp pour éviter le cache navigateur et forcer la mise à jour
    const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
    const res = await fetch(url + cacheBuster);
    const text = await res.text();
    activePlaylistChannels = parseM3U(text, sourceName);
    currentSource = 'playlist';
    playlistFilterBtn.style.display = 'block';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    playlistFilterBtn.classList.add('active');
    renderStreams('playlist');
  } catch (e) {
    alert("Erreur de chargement.");
  } finally {
    m3uLoadBtn.innerText = "Charger M3U";
  }
}

async function loadGlobalIptv() {
  if (globalIptvChannels.length > 0) return;
  searchBtn.innerText = "...";
  try {
    const res = await fetch("https://iptv-org.github.io/iptv/index.m3u");
    const text = await res.text();
    globalIptvChannels = parseM3U(text, "Mondial");
    searchBtn.innerText = "Chercher";
  } catch (e) {
    searchBtn.innerText = "Erreur";
  }
}

async function performSearch() {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) { renderStreams('all'); return; }

  const results = [
    ...streams.filter(s => s.title.toLowerCase().includes(query)),
    ...activePlaylistChannels.filter(c => c.title.toLowerCase().includes(query)),
    ...globalIptvChannels.filter(c => c.title.toLowerCase().includes(query))
  ].filter((v, i, a) => a.findIndex(t => (t.title === v.title && t.url === v.url)) === i).slice(0, 500);

  renderStreams('all', results);
  if (globalIptvChannels.length === 0 && results.length < 5) {
    await loadGlobalIptv();
    performSearch();
  }
}

// Event Listeners
document.querySelectorAll('.filter-btn[data-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (type === 'all') currentSource = 'favorites';
    else if (type === 'playlist') currentSource = 'playlist';
    renderStreams(type);
  });
});

if (m3uLoadBtn) m3uLoadBtn.addEventListener('click', () => loadM3UFromUrl(m3uInput.value));
if (freeBtn) freeBtn.addEventListener('click', () => loadM3UFromUrl("http://mafreebox.freebox.fr/freeboxtv/playlist.m3u", "Freebox"));
if (frBtn) frBtn.addEventListener('click', () => loadM3UFromUrl("https://iptv-org.github.io/iptv/countries/fr.m3u", "France"));
if (dropboxBtn) dropboxBtn.addEventListener('click', () => loadM3UFromUrl("/FR - - BE - FR - LU - CH - V.2025-11-23 - M3U.m3u", "Radios Locales"));

if (searchBtn) searchBtn.addEventListener('click', performSearch);
if (searchInput) searchInput.addEventListener('keypress', (e) => e.key === 'Enter' && performSearch());

document.addEventListener('DOMContentLoaded', () => renderStreams());
