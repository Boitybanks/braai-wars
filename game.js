/* ============================================================
   BRAAI WARS — Full Game Logic (Phase 2)
   
   This file manages:
   - Game state object (single source of truth)
   - Screen transitions (start → character → playing → end)
   - Character selection with +10 meter bonus
   - 15+ original crisis cards with 3 actions each
   - 60-second countdown timer with cleanup
   - Meter updates with clamping (0–100)
   - Win/loss detection and funny result titles
   - LocalStorage for best score persistence
   - Double-click prevention on action buttons
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
  score: 0,            // sum of all meters at game end (max 500)
  timerInterval: null,  // reference to setInterval — MUST be cleared to prevent duplicates
  bestScore: 0,         // loaded from localStorage on init
  actionsLocked: false, // prevents double-clicks while showing result feedback
  usedCardIndices: []   // tracks which cards have been shown to avoid repeats within a game
};

// ─── CHARACTER DATA ───────────────────────────────────────────
// Each character has flavour and a small starting bonus to one meter,
// giving replay variety without unbalancing the game.
// NOTE: "DJ Vaya" is an original fictional character (renamed from Phase 1).
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
    id: 'dj-vaya',
    emoji: '🎧',
    name: 'DJ Vaya',
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

// ─── CRISIS CARD DECK ─────────────────────────────────────────
// Each card has a title (the crisis) and exactly 3 actions.
// Each action has a label, a result message shown after picking,
// and an effects array of { meter, delta } objects (1–3 meters affected).
// Deltas can be positive (helpful) or negative (damaging).
const CRISIS_CARDS = [
  {
    title: '🐕 The neighbour\'s boerboel jumped the fence!',
    actions: [
      {
        label: 'Offer it a wors roll to calm down',
        result: 'The boerboel is your best friend now. But that was the last wors.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'neighbourPatience', delta: +10 }]
      },
      {
        label: 'Chase it with tongs while yelling',
        result: 'You look ridiculous but it worked. Neighbours are filming.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -15 }]
      },
      {
        label: 'Ignore it and hope for the best',
        result: 'The boerboel knocked over the braai stand. Chaos.',
        effects: [{ meter: 'fire', delta: -20 }, { meter: 'food', delta: -10 }]
      }
    ]
  },
  {
    title: '⚡ Eskom announces Stage 4 loadshedding in 5 minutes!',
    actions: [
      {
        label: 'Quickly charge all the phones',
        result: 'Everyone\'s phone is alive. You\'re a hero. But the speakers died.',
        effects: [{ meter: 'electricity', delta: -10 }, { meter: 'vibe', delta: -10 }]
      },
      {
        label: 'Fire up the petrol generator',
        result: 'Generator roars to life! The neighbours cover their ears.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'neighbourPatience', delta: -15 }]
      },
      {
        label: 'Accept your fate and braai by candlelight',
        result: 'Romantic vibes, actually. The fire does the work.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'electricity', delta: -20 }]
      }
    ]
  },
  {
    title: '🌧️ Sudden downpour! The coals are getting wet!',
    actions: [
      {
        label: 'Shield the braai with a patio umbrella',
        result: 'Smart move. Fire saved, but the umbrella is now ash.',
        effects: [{ meter: 'fire', delta: +5 }]
      },
      {
        label: 'Move everything inside to the kitchen',
        result: 'The smoke alarm goes off. Neighbours call security.',
        effects: [{ meter: 'fire', delta: +10 }, { meter: 'neighbourPatience', delta: -20 }]
      },
      {
        label: 'Pour brandy on the coals to revive them',
        result: 'WHOOSH! Eyebrows gone but the fire is roaring!',
        effects: [{ meter: 'fire', delta: +20 }, { meter: 'food', delta: -10 }, { meter: 'vibe', delta: -5 }]
      }
    ]
  },
  {
    title: '🎵 Someone connected to the Bluetooth speaker and is playing awful music!',
    actions: [
      {
        label: 'Disconnect them and play your playlist',
        result: 'Your amapiano mix saves the day. Crowd goes wild.',
        effects: [{ meter: 'vibe', delta: +15 }]
      },
      {
        label: 'Let them finish their song to be polite',
        result: 'The song was 7 minutes of recorder solos. Pain.',
        effects: [{ meter: 'vibe', delta: -15 }, { meter: 'neighbourPatience', delta: +5 }]
      },
      {
        label: 'Accidentally spill beer on the speaker',
        result: 'Oops! No more music at all. Awkward silence.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'electricity', delta: -10 }]
      }
    ]
  },
  {
    title: '🥩 You\'ve been accused of burning the chops!',
    actions: [
      {
        label: 'Confidently say "It\'s called chargrilled"',
        result: 'Nobody believes you, but they respect the confidence.',
        effects: [{ meter: 'food', delta: -5 }, { meter: 'vibe', delta: +10 }]
      },
      {
        label: 'Blame loadshedding for the timing',
        result: 'Everyone nods knowingly. Eskom takes another L.',
        effects: [{ meter: 'food', delta: -10 }, { meter: 'vibe', delta: +5 }]
      },
      {
        label: 'Quickly flip them and add secret sauce',
        result: 'Sauce saves everything! The crowd cheers.',
        effects: [{ meter: 'food', delta: +10 }, { meter: 'fire', delta: -5 }]
      }
    ]
  },
  {
    title: '👶 The kids knocked over the cooler box!',
    actions: [
      {
        label: 'Save the drinks, sacrifice the ice',
        result: 'Warm beer incoming, but at least there IS beer.',
        effects: [{ meter: 'vibe', delta: -5 }, { meter: 'food', delta: +5 }]
      },
      {
        label: 'Yell at the kids to be careful',
        result: 'The kids cry. Their parents give you the look.',
        effects: [{ meter: 'neighbourPatience', delta: -15 }, { meter: 'vibe', delta: -10 }]
      },
      {
        label: 'Laugh it off and send them to buy more ice',
        result: 'Kids come back with ice AND sweets. Genius move.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'food', delta: +5 }]
      }
    ]
  },
  {
    title: '🔥 The fire is dying! Coals turning grey!',
    actions: [
      {
        label: 'Fan it aggressively with a newspaper',
        result: 'Ash everywhere! But the coals are glowing again.',
        effects: [{ meter: 'fire', delta: +15 }, { meter: 'food', delta: -5 }]
      },
      {
        label: 'Add more charcoal on top',
        result: 'Slow but steady. You\'ll need 10 more minutes though.',
        effects: [{ meter: 'fire', delta: +10 }, { meter: 'vibe', delta: -5 }]
      },
      {
        label: 'Squirt firelighter directly onto hot coals',
        result: 'The fireball singed the washing line. Spectacular though.',
        effects: [{ meter: 'fire', delta: +20 }, { meter: 'neighbourPatience', delta: -15 }]
      }
    ]
  },
  {
    title: '🏏 Uncle Fanie wants to tell his 45-minute cricket story AGAIN!',
    actions: [
      {
        label: 'Politely listen and nod along',
        result: 'Your soul left your body but Fanie is happy.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'neighbourPatience', delta: +10 }]
      },
      {
        label: 'Distract him with braai duty',
        result: 'He\'s now in charge of the grid. Bold strategy.',
        effects: [{ meter: 'fire', delta: -10 }, { meter: 'vibe', delta: +10 }]
      },
      {
        label: 'Turn the music up louder',
        result: 'Can\'t hear the story! But also can\'t hear anything else.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -10 }, { meter: 'electricity', delta: -5 }]
      }
    ]
  },
  {
    title: '🐜 Ants have invaded the potato salad!',
    actions: [
      {
        label: 'Scrape off the top layer and serve anyway',
        result: 'What they don\'t know won\'t hurt them. Extra protein.',
        effects: [{ meter: 'food', delta: -5 }, { meter: 'vibe', delta: +5 }]
      },
      {
        label: 'Throw it away and make a new batch',
        result: 'Fresh salad takes 20 minutes. People are getting hangry.',
        effects: [{ meter: 'food', delta: +10 }, { meter: 'vibe', delta: -10 }]
      },
      {
        label: 'Spray insecticide near the table',
        result: 'Ants gone! But now everything smells like poison.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'neighbourPatience', delta: -5 }]
      }
    ]
  },
  {
    title: '📱 Tannie Marlene posted a photo of your braai and tagged it "amateur hour"!',
    actions: [
      {
        label: 'Post a better photo with a savage caption',
        result: 'Social media war declared. The comments are wild.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: -10 }]
      },
      {
        label: 'Invite her over to prove her wrong',
        result: 'She arrives with her own tongs. Power move respected.',
        effects: [{ meter: 'neighbourPatience', delta: +10 }, { meter: 'food', delta: +5 }]
      },
      {
        label: 'Ignore it and focus on the braai',
        result: 'Zen master energy. The meat appreciates your focus.',
        effects: [{ meter: 'fire', delta: +5 }, { meter: 'food', delta: +5 }]
      }
    ]
  },
  {
    title: '💡 The outdoor lights just blew! It\'s getting dark!',
    actions: [
      {
        label: 'Use phone torches to light the braai area',
        result: 'Phones die one by one. At least you can see the meat.',
        effects: [{ meter: 'electricity', delta: -15 }, { meter: 'food', delta: +5 }]
      },
      {
        label: 'Light citronella candles for ambience',
        result: 'Romantic AND mosquito-free. Unexpected vibe upgrade.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'electricity', delta: -5 }]
      },
      {
        label: 'Run an extension cord from inside',
        result: 'Tripping hazard created. Someone WILL fall.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'neighbourPatience', delta: -5 }]
      }
    ]
  },
  {
    title: '🍺 You\'ve run out of cold drinks!',
    actions: [
      {
        label: 'Send someone on a bottle store run',
        result: 'They come back 30 minutes later. Heroes are late sometimes.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'food', delta: +10 }]
      },
      {
        label: 'Offer everyone homemade ginger beer',
        result: 'It\'s... unique. Some love it, some pretend to.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'food', delta: +5 }]
      },
      {
        label: 'Announce it\'s now a water-only braai',
        result: 'Three people immediately leave. Yoh.',
        effects: [{ meter: 'vibe', delta: -20 }, { meter: 'neighbourPatience', delta: +10 }]
      }
    ]
  },
  {
    title: '🚗 Five extra guests just arrived uninvited!',
    actions: [
      {
        label: 'Welcome them warmly and stretch the food',
        result: 'Smaller portions but bigger hearts. Ubuntu wins.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'vibe', delta: +10 }]
      },
      {
        label: 'Tell them there\'s a R50 cover charge',
        result: 'They actually pay up. Entrepreneurship!',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -5 }]
      },
      {
        label: 'Pretend you don\'t have enough chairs',
        result: 'They\'re standing awkwardly. The vibe is stiff.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'neighbourPatience', delta: -5 }]
      }
    ]
  },
  {
    title: '🔊 The neighbours are threatening to call the police about the noise!',
    actions: [
      {
        label: 'Turn the music down immediately',
        result: 'Peace is maintained. But the dance floor is empty.',
        effects: [{ meter: 'neighbourPatience', delta: +20 }, { meter: 'vibe', delta: -15 }]
      },
      {
        label: 'Invite the neighbours to join the braai',
        result: 'They bring sides AND dessert. Diplomacy masterclass.',
        effects: [{ meter: 'neighbourPatience', delta: +15 }, { meter: 'food', delta: +10 }]
      },
      {
        label: 'Pretend you can\'t hear them over the music',
        result: 'They\'re definitely calling the cops now.',
        effects: [{ meter: 'neighbourPatience', delta: -25 }, { meter: 'vibe', delta: +5 }]
      }
    ]
  },
  {
    title: '🌬️ A gust of wind blew all the paper plates away!',
    actions: [
      {
        label: 'Chase them down the street',
        result: 'You caught 3 out of 12. Cardio counts.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'food', delta: -5 }]
      },
      {
        label: 'Switch to using pot lids as plates',
        result: 'Innovative! Messy, but people are impressed.',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'vibe', delta: +5 }]
      },
      {
        label: 'Tell everyone to eat with their hands',
        result: 'Primal braai energy unlocked. Messy but fun.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: -5 }]
      }
    ]
  },
  {
    title: '🐝 A swarm of bees is hovering over the honey-glazed ribs!',
    actions: [
      {
        label: 'Calmly smoke them away with the braai smoke',
        result: 'Smooth operator. The bees relocate peacefully.',
        effects: [{ meter: 'fire', delta: -5 }, { meter: 'food', delta: +10 }]
      },
      {
        label: 'Swat at them wildly with the braai tongs',
        result: 'You got stung twice. The ribs fell on the ground.',
        effects: [{ meter: 'food', delta: -20 }, { meter: 'vibe', delta: -10 }]
      },
      {
        label: 'Sacrifice the ribs and move to a safe distance',
        result: 'The bees win this round. Everyone is safe though.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: +5 }]
      }
    ]
  },
  {
    title: '🔌 Someone plugged in a bouncy castle and tripped the main switch!',
    actions: [
      {
        label: 'Reset the switch and ban the bouncy castle',
        result: 'Power restored! Kids are devastated though.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'vibe', delta: -10 }]
      },
      {
        label: 'Let the bouncy castle stay and braai in the dark',
        result: 'Kids are ecstatic. Adults are walking into things.',
        effects: [{ meter: 'electricity', delta: -15 }, { meter: 'vibe', delta: +10 }]
      },
      {
        label: 'Run both on the generator',
        result: 'Generator is sweating. How long can it last?',
        effects: [{ meter: 'electricity', delta: -5 }, { meter: 'neighbourPatience', delta: -10 }, { meter: 'vibe', delta: +5 }]
      }
    ]
  },
  {
    title: '🦎 A massive parktown prawn just landed on the salad bowl!',
    actions: [
      {
        label: 'Flick it away with a spatula like a pro',
        result: 'It flew into the neighbour\'s yard. Their problem now.',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'neighbourPatience', delta: -10 }]
      },
      {
        label: 'Scream and knock the whole table over',
        result: 'Total carnage. The braai is now a crime scene.',
        effects: [{ meter: 'food', delta: -20 }, { meter: 'vibe', delta: -10 }, { meter: 'fire', delta: -5 }]
      },
      {
        label: 'Trap it under a glass and name it Gerald',
        result: 'Gerald is the braai mascot now. Weirdly wholesome.',
        effects: [{ meter: 'vibe', delta: +15 }, { meter: 'food', delta: -5 }]
      }
    ]
  }
];

// ─── FUNNY END-GAME TITLES ────────────────────────────────────
// Different titles depending on how the game ended and the score.
const WIN_TITLES = [
  { minScore: 400, title: 'Braai Royalty! 👑', subtitle: 'The neighbourhood bows to your tong skills.' },
  { minScore: 300, title: 'Certified Braai Boss 🥩', subtitle: 'Solid performance. Oom Hennie approves.' },
  { minScore: 200, title: 'Survived the Smoke 💨', subtitle: 'It wasn\'t pretty, but you made it.' },
  { minScore: 0, title: 'Barely Standing 😅', subtitle: 'The braai survived on vibes and prayers alone.' }
];

// Loss titles keyed by which meter hit zero
const LOSS_TITLES = {
  fire: { title: 'The Fire Died ☠️🔥', subtitle: 'No fire, no braai. You\'re now hosting a sad picnic.' },
  food: { title: 'Famine at the Braai 🥩💀', subtitle: 'Everyone left hungry. Tannie Beauty is disappointed.' },
  vibe: { title: 'Vibe: Deceased 🪦🎶', subtitle: 'The party died harder than your playlist.' },
  electricity: { title: 'Total Blackout ⚡🕯️', subtitle: 'Even Eskom felt sorry for you.' },
  neighbourPatience: { title: 'Cops Called! 🚔😤', subtitle: 'The neighbours won. Your braai is now a noise complaint.' }
};

// ─── DOM REFERENCES ───────────────────────────────────────────
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
// Best score persists between sessions using browser localStorage.
// We store it as a simple string and parse back to integer on load.
function loadBestScore() {
  const saved = localStorage.getItem('braaiWars_bestScore');
  state.bestScore = saved ? parseInt(saved, 10) : 0;
  updateBestScoreDisplay();
}

// Only saves if the new score beats the existing best.
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
// Renders the 4 character cards as accessible buttons.
function renderCharacters() {
  els.characterGrid.innerHTML = CHARACTERS.map(char => `
    <button class="character-card" data-id="${char.id}" aria-label="Select ${char.name}">
      <span class="emoji">${char.emoji}</span>
      <span class="name">${char.name}</span>
      <span class="bonus">${char.description}</span>
    </button>
  `).join('');

  els.characterGrid.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      const selected = CHARACTERS.find(c => c.id === card.dataset.id);
      selectCharacter(selected);
    });
  });
}

// Applies the character's +10 bonus to the correct meter and starts the game.
function selectCharacter(character) {
  state.character = character;

  // ── METER BONUS APPLICATION ──
  // Each character boosts one specific meter by +10 at the start.
  // We clamp to 100 to prevent overflow (though 50+10=60 is safe, this
  // future-proofs against balance changes).
  state.meters[character.bonus.meter] = clampMeter(
    state.meters[character.bonus.meter] + character.bonus.amount
  );

  els.currentCharacter.textContent = `${character.emoji} ${character.name}`;

  showScreen('playing');
  startGame();
}

// ─── GAME SETUP & RESET ──────────────────────────────────────
// Resets ALL game state back to defaults for a fresh round.
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
  state.actionsLocked = false;
  state.usedCardIndices = [];

  // ── TIMER CLEANUP ──
  // Always clear any existing interval before starting a new one.
  // This prevents "duplicate timers" where two intervals tick simultaneously
  // if the player somehow re-enters the play screen without a proper reset.
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ─── METER HELPERS ────────────────────────────────────────────

// ── CLAMPING ──
// Meters must stay within 0–100. This function enforces that boundary
// so we never render negative widths or values above the track width.
function clampMeter(value) {
  return Math.max(0, Math.min(100, value));
}

// Returns a colour level string for CSS class assignment.
function getMeterLevel(value) {
  if (value > 60) return 'high';
  if (value > 30) return 'mid';
  return 'low';
}

// ─── METER RENDERING ─────────────────────────────────────────
const METER_CONFIG = [
  { key: 'fire', label: '🔥 Fire' },
  { key: 'food', label: '🥩 Food' },
  { key: 'vibe', label: '🎶 Vibe' },
  { key: 'electricity', label: '⚡ Electricity' },
  { key: 'neighbourPatience', label: '😤 Neighbours' }
];

// Full re-render of all meters (called once at game start).
function renderMeters() {
  els.meters.innerHTML = METER_CONFIG.map(m => {
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

// ── INDIVIDUAL METER UPDATE ──
// Updates a single meter's bar width, colour class, and numeric display.
// Adds a brief flash animation to draw attention to the change.
function updateMeterDisplay(meterKey) {
  const row = els.meters.querySelector(`[data-meter="${meterKey}"]`);
  if (!row) return;

  const value = state.meters[meterKey];
  const fill = row.querySelector('.meter-fill');
  const valueEl = row.querySelector('.meter-value');

  // Update width and number
  fill.style.width = `${value}%`;
  valueEl.textContent = value;

  // Update colour class based on new value
  fill.className = 'meter-fill';
  fill.classList.add(`level-${getMeterLevel(value)}`);

  // Trigger flash animation by removing and re-adding the class.
  // The brief timeout ensures the browser registers the class removal
  // before adding it back (required for CSS animation restart).
  fill.classList.remove('flash');
  void fill.offsetWidth; // force reflow to restart animation
  fill.classList.add('flash');
}

// ─── GAME START ──────────────────────────────────────────────
function startGame() {
  renderMeters();
  updateTimerDisplay();
  els.timer.classList.remove('danger');
  showNextCard();
  startTimer();
}

// ─── TIMER ───────────────────────────────────────────────────

// ── TIMER START ──
// Creates a 1-second interval that decrements the timer.
// IMPORTANT: We clear any existing interval FIRST to guarantee only
// one timer runs at a time. This is the primary defence against the
// "duplicate timer" bug that can occur if startGame() is called twice.
function startTimer() {
  // Safety: clear any pre-existing timer interval
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.timerInterval = setInterval(() => {
    // Only tick while on the playing screen
    if (state.phase !== 'playing') return;

    state.timer--;
    updateTimerDisplay();

    // Add danger styling when time is running low (≤10 seconds)
    if (state.timer <= 10) {
      els.timer.classList.add('danger');
    }

    // ── WIN CONDITION ──
    // Timer reaches 0 and all meters are still above 0 = survival win.
    if (state.timer <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      endGame(true); // player survived!
    }
  }, 1000);
}

function updateTimerDisplay() {
  els.timer.textContent = `⏱️ ${state.timer}s`;
}

// ─── CRISIS CARDS ────────────────────────────────────────────

// Picks a random card that hasn't been used yet this game.
// If all cards have been shown, resets the used list (shuffle restart).
function getNextCard() {
  if (state.usedCardIndices.length >= CRISIS_CARDS.length) {
    state.usedCardIndices = []; // all cards seen — allow repeats
  }

  let index;
  do {
    index = Math.floor(Math.random() * CRISIS_CARDS.length);
  } while (state.usedCardIndices.includes(index));

  state.usedCardIndices.push(index);
  return CRISIS_CARDS[index];
}

// Renders a new crisis card with 3 action buttons.
function showNextCard() {
  const card = getNextCard();
  state.actionsLocked = false; // re-enable action buttons

  els.cardArea.innerHTML = `
    <div class="crisis-card">
      <p class="card-title">${card.title}</p>
      <div class="card-actions">
        ${card.actions.map((action, i) => `
          <button class="btn-action" data-action-index="${i}" aria-label="${action.label}">
            ${action.label}
          </button>
        `).join('')}
      </div>
    </div>
  `;

  // Attach click handlers to the 3 action buttons
  els.cardArea.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const actionIndex = parseInt(btn.dataset.actionIndex, 10);
      handleAction(card.actions[actionIndex]);
    });
  });
}

// ─── ACTION HANDLING ─────────────────────────────────────────
// Called when the player picks one of the 3 actions on a crisis card.
function handleAction(action) {
  // ── DOUBLE-CLICK PREVENTION ──
  // Once an action is selected, we lock all buttons until the next card
  // appears. This prevents rapid clicks from applying effects multiple times.
  if (state.actionsLocked) return;
  state.actionsLocked = true;

  // Visually disable all action buttons
  els.cardArea.querySelectorAll('.btn-action').forEach(btn => {
    btn.disabled = true;
    btn.classList.add('disabled');
  });

  // ── APPLY METER EFFECTS ──
  // Each action can affect 1–3 meters. We update state first, then visuals.
  action.effects.forEach(effect => {
    // Apply delta and clamp to 0–100 range
    state.meters[effect.meter] = clampMeter(
      state.meters[effect.meter] + effect.delta
    );
    updateMeterDisplay(effect.meter);
  });

  // ── LOSS CHECK ──
  // After applying effects, check if ANY meter has hit 0.
  // If so, the game ends immediately with a loss.
  const deadMeter = checkForDeadMeter();
  if (deadMeter) {
    // Small delay so the player sees the meter hit zero visually
    setTimeout(() => endGame(false, deadMeter), 600);
    return;
  }

  // Show the action's result message before moving to the next card.
  showActionResult(action.result);
}

// Checks all meters — returns the key of the first one at 0, or null.
function checkForDeadMeter() {
  for (const key of Object.keys(state.meters)) {
    if (state.meters[key] <= 0) return key;
  }
  return null;
}

// Displays the consequence text for 1.5 seconds, then shows next card.
function showActionResult(resultText) {
  els.cardArea.innerHTML = `
    <div class="crisis-card result-card">
      <p class="result-text">${resultText}</p>
    </div>
  `;

  // After a brief pause, show the next crisis card
  setTimeout(() => {
    // Only proceed if we're still in the playing phase
    // (the game might have ended during this timeout)
    if (state.phase === 'playing') {
      showNextCard();
    }
  }, 1500);
}

// ─── END GAME ────────────────────────────────────────────────
// Called when the game ends — either by timer hitting 0 (win) or
// a meter hitting 0 (loss).
function endGame(isWin, deadMeterKey) {
  // ── TIMER CLEANUP ──
  // Critical: stop the interval immediately so it doesn't keep ticking
  // and potentially trigger a second endGame call.
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // ── SCORE CALCULATION ──
  // Score = sum of all five meter values at end of game (max 500).
  state.score = Object.values(state.meters).reduce((sum, val) => sum + val, 0);

  // ── PERSIST BEST SCORE ──
  // localStorage update only happens if this score beats the record.
  saveBestScore(state.score);

  // ── DETERMINE END TITLE ──
  if (isWin) {
    // Find the appropriate win tier based on score
    const tier = WIN_TITLES.find(t => state.score >= t.minScore);
    els.endTitle.textContent = tier.title;
    els.endSubtitle.textContent = tier.subtitle;
  } else {
    // Loss — show which meter caused the failure
    const lossInfo = LOSS_TITLES[deadMeterKey];
    els.endTitle.textContent = lossInfo.title;
    els.endSubtitle.textContent = lossInfo.subtitle;
  }

  // Update score displays
  els.endScore.textContent = state.score;
  els.endBestScore.textContent = state.bestScore;

  // Transition to end screen
  showScreen('end');
}

// ─── EVENT LISTENERS ─────────────────────────────────────────
els.btnStart.addEventListener('click', () => {
  showScreen('character');
});

els.btnRestart.addEventListener('click', () => {
  resetState();
  showScreen('start');
  updateBestScoreDisplay();
});

// ─── INITIALISE ──────────────────────────────────────────────
function init() {
  loadBestScore();
  renderCharacters();
  showScreen('start');
}

init();
