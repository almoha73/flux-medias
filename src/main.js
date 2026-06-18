import './style.css';

const streams = [
  {
    id: 1,
    title: "CNEWS",
    description: "La chaîne d'information en continu.",
    type: "tv",
    html: `<iframe src="https://geo.dailymotion.com/player.html?video=x3b68jn" style="width:100%; height:100%; border:none; border-radius:16px 16px 0 0;" allowfullscreen title="Dailymotion Video Player" allow="web-share"></iframe>`
  },
  {
    id: 2,
    title: "Europe 1",
    description: "La radio généraliste d'actualité et de divertissement.",
    type: "radio",
    html: `
      <div class="radio-player-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:2rem; background: #111; border-radius: 16px 16px 0 0;">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:1rem; opacity:0.8;"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path></svg>
        <audio controls style="width:100%; max-width:300px; border-radius:30px; margin-top:10px;" autoplay>
          <source src="https://stream.europe1.fr/europe1.mp3" type="audio/mpeg">
          Votre navigateur ne supporte pas l'élément audio.
        </audio>
      </div>
    `
  }
];

let currentActiveStreamId = null;

const playerContainer = document.getElementById('main-player-container');
const playerInfo = document.getElementById('main-player-info');

function playStream(stream) {
  currentActiveStreamId = stream.id;
  document.querySelectorAll('.stream-list-item').forEach(el => {
    if (el.dataset.id == stream.id) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  playerContainer.innerHTML = stream.html;
  playerInfo.style.display = 'block';
  
  document.getElementById('main-player-type').className = `stream-type ${stream.type}`;
  document.getElementById('main-player-type').innerText = stream.type.toUpperCase();
  document.getElementById('main-player-title').innerText = stream.title;
  document.getElementById('main-player-desc').innerText = stream.description;
}

function renderStreams() {
  const grid = document.getElementById('stream-grid');
  grid.innerHTML = '';

  streams.forEach((stream) => {
    const item = document.createElement('div');
    item.className = 'stream-list-item';
    if (stream.id === currentActiveStreamId) item.classList.add('active');
    item.dataset.id = stream.id;

    item.innerHTML = `
      <div class="stream-item-content">
        <div class="stream-list-title">${stream.title}</div>
        <div class="stream-list-desc">${stream.description}</div>
      </div>
    `;

    item.addEventListener('click', () => playStream(stream));
    grid.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', () => renderStreams());
