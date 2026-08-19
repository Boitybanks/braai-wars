/* ============================================================
   BRAAI WARS — Game Logic (Phase 1: Navigation & State Skeleton)
   
   This file manages:
   - Game state object (single source of truth)
   - Screen transitions (start → character → playing → end)
   - Character selection rendering
   - LocalStorage for best score persistence
   
   Full gameplay (timer, cards, meter updates) will be added in Phase 2.
   ============================================================ */

// ─── GAME STATE ───────────────────────────────────────────────
// Central state object — everything the game needs to track lives here.
// This makes it easy to reset, save, or debug at any point.
const state = {
  phase: 'start',       // current screen: start | character | playing | end
  character: null,      // selected character object
  meters: {
    fire: 50,
    food: 50,
    vibe: 50,
    electricity: 50,
    neighbourPatience: 50
  },
  timer: 60,            // seconds remaining
  score: 0,             // sum of all meters at game end (max 500)
  timerInterval: null,  // reference to setInterval so we can clear it
  bestScore: 0          // loaded from localStorage on init
};

// ─── CHARACTER DATA ───────────────────────────────────────────
// Each character has flavour and a small starting bonus to one meter,
// giving replay variety without unbalancing the game.
const CHARACTERS = [
  {
    id: 'oom-hennie',
    emoji: '👴',
    name: 'Oom Hennie',
    description: 'Old-school braai legend. Refuses to use firelighters.',
    bonus: { meter: 'fire', amount: 10 }
  },
  {
    id: 'tannie-beauty',
    emoji: '👩‍🍳',
    name: 'Tannie Beauty',
    description: 'Her potato salad ends arguments. Queen of sides.',
    bonus: { meter: 'food', amount: 10 }
  },
  {
    id: 'dj-sbu',
    emoji: '🎧',
    name: 'DJ Sbu',
    description: 'Controls the playlist. One wrong song and the vibe dies.',
    bonus: { meter: 'vibe', amount: 10 }
  },
  {
    id: 'electrician-edgar',
    emoji: '⚡',
    name: 'Electrician Edgar',
    description: 'Jury-rigged the extension cord. Loadshedding? Not today.',
    bonus: { meter: 'electricity', amount: 10 }
  }
];

// ─── DOM REFERENCES ───────────────────────────────────────────
// Grab all screens and key elements once on load for performance.
const screens = {
  start: document.getElementById('screen-start'),
  character: document.getElementById('screen-character'),
  playing: document.getElementById('screen-playing'),
  end: document.getElementById('screen-end')
};

const els = {
  btnStart: document.getElementById('btn-start'),
  btnRestart: document.getElementById('btn-restart'),
  characterGrid: document.getElementById('character-grid'),
  startBestScore: document.getElementById('start-best-score'),
  timer: document.getElementById('timer'),
  currentCharacter: document.getElementById('current-character'),
  meters: document.getElementById('meters'),
  cardArea: document.getElementById('card-area'),
  endTitle: document.getElementById('end-title'),
  endSubtitle: document.getElementById('end-subtitle'),
  endScore: document.getElementById('end-score'),
  endBestScore: document.getElementById('end-best-score')
};

// ─── SCREEN NAVIGATION ───────────────────────────────────────
// Switches visible screen by toggling the 'active' class.
// Only one screen can be active at a time.
function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
  state.phase = screenName;
}

// ─── LOCAL STORAGE ────────────────────────────────────────────
// Load best score from browser storage so it persists between sessions.
function loadBestScore() {
  const saved = localStorage.getItem('braaiWars_bestScore');
  state.bestScore = saved ? parseInt(saved, 10) : 0;
  updateBestScoreDisplay();
}

function saveBestScore(score) {
  if (score > state.bestScore) {
    state.bestScore = score;
    localStorage.setItem('braaiWars_bestScore', score.toString());
  }
}

function updateBestScoreDisplay() {
  if (state.bestScore > 0) {
    els.startBestScore.textContent = `🏆 Best Score: ${state.bestScore} / 500`;
  } else {
    els.startBestScore.textContent = '';
  }
}

// ─── CHARACTER SELECTION ──────────────────────────────────────
// Renders the 4 character cards into the grid.
// Each card is a button for accessibility (keyboard + screen readers).
function renderCharacters() {
  els.characterGrid.innerHTML = CHARACTERS.map(char => `
    <button class="character-card" data-id="${char.id}" aria-label="Select ${char.name}">
      <span class="emoji">${char.emoji}</span>
      <span class="name">${char.name}</span>
      <span class="bonus">${char.description}</span>
    </button>
  `).join('');

  // Attach click handlers to each card
  els.characterGrid.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      const selected = CHARACTERS.find(c => c.id === card.dataset.id);
      selectCharacter(selected);
    });
  });
}

// Called when a player picks a character — applies bonus and moves to play screen.
function selectCharacter(character) {
  state.character = character;

  // Apply the character's starting bonus to the relevant meter
  state.meters[character.bonus.meter] = Math.min(
    100,
    state.meters[character.bonus.meter] + character.bonus.amount
  );

  // Show chosen character in the playing screen top bar
  els.currentCharacter.textContent = `${character.emoji} ${character.name}`;

  // Transition to the playing screen
  showScreen('playing');
  startGame();
}

// ─── GAME SETUP & RESET ──────────────────────────────────────
// Resets all meters and timer back to defaults for a fresh game.
function resetState() {
  state.character = null;
  state.meters = {
    fire: 50,
    food: 50,
    vibe: 50,
    electricity: 50,
    neighbourPatience: 50
  };
  state.timer = 60;
  state.score = 0;
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ─── METER RENDERING ─────────────────────────────────────────
// Draws all 5 meter bars with correct widths and colour levels.
// Called once on game start; individual meters update via updateMeter().
function renderMeters() {
  const meterConfig = [
    { key: 'fire', label: '🔥 Fire', },
    { key: 'food', label: '🥩 Food' },
    { key: 'vibe', label: '🎶 Vibe' },
    { key: 'electricity', label: '⚡ Electricity' },
    { key: 'neighbourPatience', label: '😤 Neighbours' }
  ];

  els.meters.innerHTML = meterConfig.map(m => {
    const value = state.meters[m.key];
    const level = getMeterLevel(value);
    return `
      <div class="meter-row" data-meter="${m.key}">
        <span class="meter-label">${m.label}</span>
        <div class="meter-track">
          <div class="meter-fill level-${level}" style="width: ${value}%"></div>
        </div>
        <span class="meter-value">${value}</span>
      </div>
    `;
  }).join('');
}

// Returns a colour level string based on meter value thresholds.
function getMeterLevel(value) {
  if (value > 60) return 'high';
  if (value > 30) return 'mid';
  return 'low';
}

// ─── PLACEHOLDER: GAME START ─────────────────────────────────
// This will be expanded in Phase 2 with timer countdown and card logic.
function startGame() {
  renderMeters();
  els.timer.textContent = '⏱️ 60s';
  els.timer.classList.remove('danger');
  els.cardArea.innerHTML = `
    <div class="crisis-card">
      <p class="card-title">🃏 Get ready...</p>
      <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-top: 0.5rem;">
        Crisis cards and the countdown timer are coming in the next phase!
      </p>
    </div>
  `;
}

// ─── EVENT LISTENERS ─────────────────────────────────────────
// Wire up the start and restart buttons.
els.btnStart.addEventListener('click', () => {
  showScreen('character');
});

els.btnRestart.addEventListener('click', () => {
  resetState();
  showScreen('start');
  updateBestScoreDisplay();
});

// ─── INITIALISE ──────────────────────────────────────────────
// Run on page load: render characters, load saved data, show start screen.
function init() {
  loadBestScore();
  renderCharacters();
  showScreen('start');
}

init();
