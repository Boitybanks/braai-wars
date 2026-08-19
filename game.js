/* ============================================================
   BRAAI WARS — Game Logic (M1A: Competition State Machine)
   
   STATE MACHINE PHASES:
   ─────────────────────
   start → character → playing → consequence → playing → ...
                                      ↓ (meter dies)
                                 consequence → judgement → end
                                      ↓ (timer hits 0)
                            playing → judgement → end
   
   WHY EXPLICIT PHASES?
   Using a string-based phase (not booleans) prevents:
   1. Timer ticking during consequence display (timer only decrements
      when phase === 'playing')
   2. Action buttons responding during consequence/judgement
   3. Multiple endGame() calls from race conditions
   4. Invalid screen combinations (only one screen visible per phase)
   
   The single `state.phase` check in the timer interval is what
   "pauses" the clock — no separate pause flag needed.
   ============================================================ */

// ─── GAME STATE ───────────────────────────────────────────────
const state = {
  // ── PHASE: the single source of truth for what the player should see.
  // Timer ONLY ticks when phase === 'playing'. This is the pause mechanism.
  phase: 'start',       // start | character | playing | consequence | judgement | end

  character: null,
  meters: {
    fire: 50,
    food: 50,
    vibe: 50,
    electricity: 50,
    neighbourPatience: 50
  },
  timer: 60,
  score: 0,
  timerInterval: null,  // setInterval reference — MUST be cleared to prevent duplicates
  bestScore: 0,
  actionsLocked: false,
  usedCardIndices: [],

  // ── SCORING TRACKERS (M1A) ──
  // These accumulate across all crisis decisions for final judgement.
  totalLeadership: 0,   // sum of leadershipImpact values from chosen actions
  totalUbuntu: 0,       // sum of ubuntuImpact values from chosen actions
  decisionsCount: 0,    // how many crisis decisions were made

  // ── TEMPTATION TRACKER ──
  // Selfish temptations give short-term boosts but hurt Ubuntu.
  // selfishCount: total temptation actions taken
  // selfishStreak: consecutive temptation picks (streak amplifies penalty)
  // maxStreak: longest consecutive streak achieved
  selfishCount: 0,
  selfishStreak: 0,
  maxSelfishStreak: 0
};

// ─── CHARACTER DATA ───────────────────────────────────────────
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
// Each action now includes:
//   leadershipImpact: number (-2 to +2) — positive = good leadership
//   ubuntuImpact: number (-2 to +2) — positive = fair/inclusive/cooperative
//   tags: string[] — descriptive labels for future use
const CRISIS_CARDS = [
  {
    title: '🐕 The neighbour\'s boerboel jumped the fence!',
    actions: [
      {
        label: 'Offer it a wors roll to calm down',
        result: 'The boerboel is your best friend now. But that was the last wors.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'neighbourPatience', delta: +10 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['cooperative', 'fair']
      },
      {
        label: 'Chase it with tongs while yelling',
        result: 'You look ridiculous but it worked. Neighbours are filming.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -15 }],
        leadershipImpact: 0,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Ignore it and hope for the best',
        result: 'The boerboel knocked over the braai stand. Chaos.',
        effects: [{ meter: 'fire', delta: -20 }, { meter: 'food', delta: -10 }],
        leadershipImpact: -2,
        ubuntuImpact: 0,
        tags: ['selfish']
      }
    ]
  },
  {
    title: '⚡ Eskom announces Stage 4 loadshedding in 5 minutes!',
    actions: [
      {
        label: 'Quickly charge all the phones',
        result: 'Everyone\'s phone is alive. You\'re a hero. But the speakers died.',
        effects: [{ meter: 'electricity', delta: -10 }, { meter: 'vibe', delta: -10 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['cooperative', 'fair']
      },
      {
        label: 'Fire up the petrol generator',
        result: 'Generator roars to life! The neighbours cover their ears.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'neighbourPatience', delta: -15 }],
        leadershipImpact: 1,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Accept your fate and braai by candlelight',
        result: 'Romantic vibes, actually. The fire does the work.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'electricity', delta: -20 }],
        leadershipImpact: 0,
        ubuntuImpact: 1,
        tags: ['inclusive']
      }
    ]
  },
  {
    title: '🌧️ Sudden downpour! The coals are getting wet!',
    actions: [
      {
        label: 'Shield the braai with a patio umbrella',
        result: 'Smart move. Fire saved, but the umbrella is now ash.',
        effects: [{ meter: 'fire', delta: +5 }],
        leadershipImpact: 2,
        ubuntuImpact: 1,
        tags: ['cooperative']
      },
      {
        label: 'Move everything inside to the kitchen',
        result: 'The smoke alarm goes off. Neighbours call security.',
        effects: [{ meter: 'fire', delta: +10 }, { meter: 'neighbourPatience', delta: -20 }],
        leadershipImpact: 0,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Pour brandy on the coals to revive them',
        result: 'WHOOSH! Eyebrows gone but the fire is roaring!',
        effects: [{ meter: 'fire', delta: +20 }, { meter: 'food', delta: -10 }, { meter: 'vibe', delta: -5 }],
        leadershipImpact: -1,
        ubuntuImpact: -1,
        tags: ['reckless']
      }
    ]
  },
  {
    title: '🎵 Someone connected to the Bluetooth speaker and is playing awful music!',
    actions: [
      {
        label: 'Disconnect them and play your playlist',
        result: 'Your amapiano mix saves the day. Crowd goes wild.',
        effects: [{ meter: 'vibe', delta: +15 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      },
      {
        label: 'Let them finish their song to be polite',
        result: 'The song was 7 minutes of recorder solos. Pain.',
        effects: [{ meter: 'vibe', delta: -15 }, { meter: 'neighbourPatience', delta: +5 }],
        leadershipImpact: 0,
        ubuntuImpact: 2,
        tags: ['inclusive', 'fair']
      },
      {
        label: 'Accidentally spill beer on the speaker',
        result: 'Oops! No more music at all. Awkward silence.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'electricity', delta: -10 }],
        leadershipImpact: -1,
        ubuntuImpact: -2,
        tags: ['selfish', 'reckless']
      }
    ]
  },
  {
    title: '🥩 You\'ve been accused of burning the chops!',
    actions: [
      {
        label: 'Confidently say "It\'s called chargrilled"',
        result: 'Nobody believes you, but they respect the confidence.',
        effects: [{ meter: 'food', delta: -5 }, { meter: 'vibe', delta: +10 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      },
      {
        label: 'Blame loadshedding for the timing',
        result: 'Everyone nods knowingly. Eskom takes another L.',
        effects: [{ meter: 'food', delta: -10 }, { meter: 'vibe', delta: +5 }],
        leadershipImpact: -1,
        ubuntuImpact: -1,
        tags: ['selfish']
      },
      {
        label: 'Quickly flip them and add secret sauce',
        result: 'Sauce saves everything! The crowd cheers.',
        effects: [{ meter: 'food', delta: +10 }, { meter: 'fire', delta: -5 }],
        leadershipImpact: 2,
        ubuntuImpact: 1,
        tags: ['cooperative']
      }
    ]
  },
  {
    title: '👶 The kids knocked over the cooler box!',
    actions: [
      {
        label: 'Save the drinks, sacrifice the ice',
        result: 'Warm beer incoming, but at least there IS beer.',
        effects: [{ meter: 'vibe', delta: -5 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      },
      {
        label: 'Yell at the kids to be careful',
        result: 'The kids cry. Their parents give you the look.',
        effects: [{ meter: 'neighbourPatience', delta: -15 }, { meter: 'vibe', delta: -10 }],
        leadershipImpact: -1,
        ubuntuImpact: -2,
        tags: ['selfish', 'reckless']
      },
      {
        label: 'Laugh it off and send them to buy more ice',
        result: 'Kids come back with ice AND sweets. Genius move.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      }
    ]
  },
  {
    title: '🔥 The fire is dying! Coals turning grey!',
    actions: [
      {
        label: 'Fan it aggressively with a newspaper',
        result: 'Ash everywhere! But the coals are glowing again.',
        effects: [{ meter: 'fire', delta: +15 }, { meter: 'food', delta: -5 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      },
      {
        label: 'Add more charcoal on top',
        result: 'Slow but steady. You\'ll need 10 more minutes though.',
        effects: [{ meter: 'fire', delta: +10 }, { meter: 'vibe', delta: -5 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['cooperative']
      },
      {
        label: 'Squirt firelighter directly onto hot coals',
        result: 'The fireball singed the washing line. Spectacular though.',
        effects: [{ meter: 'fire', delta: +20 }, { meter: 'neighbourPatience', delta: -15 }],
        leadershipImpact: -1,
        ubuntuImpact: -2,
        tags: ['reckless']
      }
    ]
  },
  {
    title: '🏏 Uncle Fanie wants to tell his 45-minute cricket story AGAIN!',
    actions: [
      {
        label: 'Politely listen and nod along',
        result: 'Your soul left your body but Fanie is happy.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'neighbourPatience', delta: +10 }],
        leadershipImpact: 0,
        ubuntuImpact: 2,
        tags: ['inclusive', 'fair']
      },
      {
        label: 'Distract him with braai duty',
        result: 'He\'s now in charge of the grid. Bold strategy.',
        effects: [{ meter: 'fire', delta: -10 }, { meter: 'vibe', delta: +10 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['cooperative']
      },
      {
        label: 'Turn the music up louder',
        result: 'Can\'t hear the story! But also can\'t hear anything else.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -10 }, { meter: 'electricity', delta: -5 }],
        leadershipImpact: -1,
        ubuntuImpact: -1,
        tags: ['selfish']
      }
    ]
  },
  {
    title: '🐜 Ants have invaded the potato salad!',
    actions: [
      {
        label: 'Scrape off the top layer and serve anyway',
        result: 'What they don\'t know won\'t hurt them. Extra protein.',
        effects: [{ meter: 'food', delta: -5 }, { meter: 'vibe', delta: +5 }],
        leadershipImpact: 0,
        ubuntuImpact: -1,
        tags: ['selfish']
      },
      {
        label: 'Throw it away and make a new batch',
        result: 'Fresh salad takes 20 minutes. People are getting hangry.',
        effects: [{ meter: 'food', delta: +10 }, { meter: 'vibe', delta: -10 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['fair', 'cooperative']
      },
      {
        label: 'Spray insecticide near the table',
        result: 'Ants gone! But now everything smells like poison.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'neighbourPatience', delta: -5 }],
        leadershipImpact: -2,
        ubuntuImpact: -2,
        tags: ['reckless']
      }
    ]
  },
  {
    title: '📱 Tannie Marlene posted a photo of your braai and tagged it "amateur hour"!',
    actions: [
      {
        label: 'Post a better photo with a savage caption',
        result: 'Social media war declared. The comments are wild.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: -10 }],
        leadershipImpact: 0,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Invite her over to prove her wrong',
        result: 'She arrives with her own tongs. Power move respected.',
        effects: [{ meter: 'neighbourPatience', delta: +10 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      },
      {
        label: 'Ignore it and focus on the braai',
        result: 'Zen master energy. The meat appreciates your focus.',
        effects: [{ meter: 'fire', delta: +5 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['fair']
      }
    ]
  },
  {
    title: '💡 The outdoor lights just blew! It\'s getting dark!',
    actions: [
      {
        label: 'Use phone torches to light the braai area',
        result: 'Phones die one by one. At least you can see the meat.',
        effects: [{ meter: 'electricity', delta: -15 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['cooperative']
      },
      {
        label: 'Light citronella candles for ambience',
        result: 'Romantic AND mosquito-free. Unexpected vibe upgrade.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'electricity', delta: -5 }],
        leadershipImpact: 2,
        ubuntuImpact: 1,
        tags: ['inclusive', 'fair']
      },
      {
        label: 'Run an extension cord from inside',
        result: 'Tripping hazard created. Someone WILL fall.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'neighbourPatience', delta: -5 }],
        leadershipImpact: 0,
        ubuntuImpact: -1,
        tags: ['reckless']
      }
    ]
  },
  {
    title: '🍺 You\'ve run out of cold drinks!',
    actions: [
      {
        label: 'Send someone on a bottle store run',
        result: 'They come back 30 minutes later. Heroes are late sometimes.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'food', delta: +10 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      },
      {
        label: 'Offer everyone homemade ginger beer',
        result: 'It\'s... unique. Some love it, some pretend to.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'food', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      },
      {
        label: 'Announce it\'s now a water-only braai',
        result: 'Three people immediately leave. Yoh.',
        effects: [{ meter: 'vibe', delta: -20 }, { meter: 'neighbourPatience', delta: +10 }],
        leadershipImpact: -1,
        ubuntuImpact: -1,
        tags: ['selfish']
      }
    ]
  },
  {
    title: '🚗 Five extra guests just arrived uninvited!',
    actions: [
      {
        label: 'Welcome them warmly and stretch the food',
        result: 'Smaller portions but bigger hearts. Ubuntu wins.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'vibe', delta: +10 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative', 'fair']
      },
      {
        label: 'Tell them there\'s a R50 cover charge',
        result: 'They actually pay up. Entrepreneurship!',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: -5 }],
        leadershipImpact: 1,
        ubuntuImpact: -1,
        tags: ['selfish']
      },
      {
        label: 'Pretend you don\'t have enough chairs',
        result: 'They\'re standing awkwardly. The vibe is stiff.',
        effects: [{ meter: 'vibe', delta: -10 }, { meter: 'neighbourPatience', delta: -5 }],
        leadershipImpact: -1,
        ubuntuImpact: -2,
        tags: ['selfish', 'reckless']
      }
    ]
  },
  {
    title: '🔊 The neighbours are threatening to call the police about the noise!',
    actions: [
      {
        label: 'Turn the music down immediately',
        result: 'Peace is maintained. But the dance floor is empty.',
        effects: [{ meter: 'neighbourPatience', delta: +20 }, { meter: 'vibe', delta: -15 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['cooperative', 'fair']
      },
      {
        label: 'Invite the neighbours to join the braai',
        result: 'They bring sides AND dessert. Diplomacy masterclass.',
        effects: [{ meter: 'neighbourPatience', delta: +15 }, { meter: 'food', delta: +10 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      },
      {
        label: 'Pretend you can\'t hear them over the music',
        result: 'They\'re definitely calling the cops now.',
        effects: [{ meter: 'neighbourPatience', delta: -25 }, { meter: 'vibe', delta: +5 }],
        leadershipImpact: -2,
        ubuntuImpact: -2,
        tags: ['reckless', 'selfish']
      }
    ]
  },
  {
    title: '🌬️ A gust of wind blew all the paper plates away!',
    actions: [
      {
        label: 'Chase them down the street',
        result: 'You caught 3 out of 12. Cardio counts.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'food', delta: -5 }],
        leadershipImpact: 0,
        ubuntuImpact: 1,
        tags: ['cooperative']
      },
      {
        label: 'Switch to using pot lids as plates',
        result: 'Innovative! Messy, but people are impressed.',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'vibe', delta: +5 }],
        leadershipImpact: 2,
        ubuntuImpact: 1,
        tags: ['cooperative', 'inclusive']
      },
      {
        label: 'Tell everyone to eat with their hands',
        result: 'Primal braai energy unlocked. Messy but fun.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: -5 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['fair']
      }
    ]
  },
  {
    title: '🐝 A swarm of bees is hovering over the honey-glazed ribs!',
    actions: [
      {
        label: 'Calmly smoke them away with the braai smoke',
        result: 'Smooth operator. The bees relocate peacefully.',
        effects: [{ meter: 'fire', delta: -5 }, { meter: 'food', delta: +10 }],
        leadershipImpact: 2,
        ubuntuImpact: 1,
        tags: ['fair', 'cooperative']
      },
      {
        label: 'Swat at them wildly with the braai tongs',
        result: 'You got stung twice. The ribs fell on the ground.',
        effects: [{ meter: 'food', delta: -20 }, { meter: 'vibe', delta: -10 }],
        leadershipImpact: -2,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Sacrifice the ribs and move to a safe distance',
        result: 'The bees win this round. Everyone is safe though.',
        effects: [{ meter: 'food', delta: -15 }, { meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['inclusive', 'fair']
      }
    ]
  },
  {
    title: '🔌 Someone plugged in a bouncy castle and tripped the main switch!',
    actions: [
      {
        label: 'Reset the switch and ban the bouncy castle',
        result: 'Power restored! Kids are devastated though.',
        effects: [{ meter: 'electricity', delta: +15 }, { meter: 'vibe', delta: -10 }],
        leadershipImpact: 1,
        ubuntuImpact: -1,
        tags: ['selfish']
      },
      {
        label: 'Let the bouncy castle stay and braai in the dark',
        result: 'Kids are ecstatic. Adults are walking into things.',
        effects: [{ meter: 'electricity', delta: -15 }, { meter: 'vibe', delta: +10 }],
        leadershipImpact: 0,
        ubuntuImpact: 2,
        tags: ['inclusive', 'fair']
      },
      {
        label: 'Run both on the generator',
        result: 'Generator is sweating. How long can it last?',
        effects: [{ meter: 'electricity', delta: -5 }, { meter: 'neighbourPatience', delta: -10 }, { meter: 'vibe', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 0,
        tags: ['cooperative']
      }
    ]
  },
  {
    title: '🦎 A massive parktown prawn just landed on the salad bowl!',
    actions: [
      {
        label: 'Flick it away with a spatula like a pro',
        result: 'It flew into the neighbour\'s yard. Their problem now.',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'neighbourPatience', delta: -10 }],
        leadershipImpact: 1,
        ubuntuImpact: -1,
        tags: ['selfish']
      },
      {
        label: 'Scream and knock the whole table over',
        result: 'Total carnage. The braai is now a crime scene.',
        effects: [{ meter: 'food', delta: -20 }, { meter: 'vibe', delta: -10 }, { meter: 'fire', delta: -5 }],
        leadershipImpact: -2,
        ubuntuImpact: -1,
        tags: ['reckless']
      },
      {
        label: 'Trap it under a glass and name it Gerald',
        result: 'Gerald is the braai mascot now. Weirdly wholesome.',
        effects: [{ meter: 'vibe', delta: +15 }, { meter: 'food', delta: -5 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      }
    ]
  },
  // ─── TEMPTATION CARDS ───────────────────────────────────────────
  // These crises present a particularly juicy selfish option that gives
  // a big short-term boost to vibe or food, but damages other meters
  // and tanks your Ubuntu score. The temptation is marked explicitly
  // with isTemptation: true so the game can track selfish choices.
  {
    title: '🍖 The premium fillet steak is done — but there\'s only enough for you!',
    actions: [
      {
        label: 'Eat it yourself before anyone notices',
        result: 'Heavenly. But Gogo saw you and she\'s telling everyone.',
        effects: [{ meter: 'food', delta: +20 }, { meter: 'vibe', delta: -15 }, { meter: 'neighbourPatience', delta: -10 }],
        leadershipImpact: -2,
        ubuntuImpact: -2,
        tags: ['selfish'],
        isTemptation: true
      },
      {
        label: 'Slice it up and share with the whole crew',
        result: 'Tiny pieces but massive respect. Ubuntu energy.',
        effects: [{ meter: 'food', delta: +5 }, { meter: 'vibe', delta: +15 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative', 'fair']
      },
      {
        label: 'Give it to the guest of honour',
        result: 'Classy move. Everyone raises their glass to you.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: +5 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['fair', 'inclusive']
      }
    ]
  },
  {
    title: '💰 A guest left their wallet on the table with R200 sticking out!',
    actions: [
      {
        label: 'Pocket R100 for "braai expenses"',
        result: 'Extra budget! But your conscience is heavy... and someone noticed.',
        effects: [{ meter: 'food', delta: +15 }, { meter: 'vibe', delta: -10 }, { meter: 'neighbourPatience', delta: -15 }],
        leadershipImpact: -2,
        ubuntuImpact: -2,
        tags: ['selfish'],
        isTemptation: true
      },
      {
        label: 'Return it immediately and announce it loudly',
        result: 'Hero moment! Trust levels through the roof.',
        effects: [{ meter: 'vibe', delta: +15 }, { meter: 'neighbourPatience', delta: +10 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['fair', 'cooperative']
      },
      {
        label: 'Quietly put it in their bag without saying anything',
        result: 'Humble and honest. The ancestors are pleased.',
        effects: [{ meter: 'vibe', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['fair', 'inclusive']
      }
    ]
  },
  {
    title: '🎤 The DJ slot opened up — do you take the aux?',
    actions: [
      {
        label: 'Hijack the speaker and play YOUR playlist for an hour',
        result: 'Your taste is fire... but nobody else got a turn. Egos bruised.',
        effects: [{ meter: 'vibe', delta: +20 }, { meter: 'neighbourPatience', delta: -10 }, { meter: 'electricity', delta: -10 }],
        leadershipImpact: -1,
        ubuntuImpact: -2,
        tags: ['selfish'],
        isTemptation: true
      },
      {
        label: 'Create a shared queue and let everyone add songs',
        result: 'Democracy in action! Some questionable choices but everyone\'s happy.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'electricity', delta: -5 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['inclusive', 'cooperative']
      },
      {
        label: 'Let the kids pick first — they never get a turn',
        result: 'Baby Shark plays 3 times. Worth it for the smiles.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 2,
        tags: ['inclusive', 'fair']
      }
    ]
  },
  {
    title: '🏆 You just won the braai-off bet — do you rub it in?',
    actions: [
      {
        label: 'Do a victory lap and roast the losers publicly',
        result: 'LEGENDARY flex! But three people are now plotting revenge.',
        effects: [{ meter: 'vibe', delta: +15 }, { meter: 'neighbourPatience', delta: -20 }, { meter: 'fire', delta: -5 }],
        leadershipImpact: -2,
        ubuntuImpact: -2,
        tags: ['selfish', 'reckless'],
        isTemptation: true
      },
      {
        label: 'Thank your crew and share the prize',
        result: 'Grace in victory. People actually clap. Goosebumps.',
        effects: [{ meter: 'vibe', delta: +10 }, { meter: 'neighbourPatience', delta: +10 }],
        leadershipImpact: 2,
        ubuntuImpact: 2,
        tags: ['cooperative', 'inclusive', 'fair']
      },
      {
        label: 'Offer a rematch to keep things fair',
        result: 'Sportsmanship! The vibe is competitive but respectful.',
        effects: [{ meter: 'vibe', delta: +5 }, { meter: 'neighbourPatience', delta: +5 }, { meter: 'fire', delta: +5 }],
        leadershipImpact: 1,
        ubuntuImpact: 1,
        tags: ['fair']
      }
    ]
  }
];

// ─── FUNNY END-GAME TITLES ────────────────────────────────────
const WIN_TITLES = [
  { minScore: 400, title: 'Braai Royalty! 👑', subtitle: 'The neighbourhood bows to your tong skills.' },
  { minScore: 300, title: 'Certified Braai Boss 🥩', subtitle: 'Solid performance. Oom Hennie approves.' },
  { minScore: 200, title: 'Survived the Smoke 💨', subtitle: 'It wasn\'t pretty, but you made it.' },
  { minScore: 0, title: 'Barely Standing 😅', subtitle: 'The braai survived on vibes and prayers alone.' }
];

const LOSS_TITLES = {
  fire: { title: 'The Fire Died ☠️🔥', subtitle: 'No fire, no braai. You\'re now hosting a sad picnic.' },
  food: { title: 'Famine at the Braai 🥩💀', subtitle: 'Everyone left hungry. Tannie Beauty is disappointed.' },
  vibe: { title: 'Vibe: Deceased 🪦🎶', subtitle: 'The party died harder than your playlist.' },
  electricity: { title: 'Total Blackout ⚡🕯️', subtitle: 'Even Eskom felt sorry for you.' },
  neighbourPatience: { title: 'Cops Called! 🚔😤', subtitle: 'The neighbours won. Your braai is now a noise complaint.' }
};

// ─── METER DISPLAY NAMES (for consequence breakdown) ──────────
const METER_NAMES = {
  fire: '🔥 Fire',
  food: '🥩 Food',
  vibe: '🎶 Vibe',
  electricity: '⚡ Electricity',
  neighbourPatience: '😤 Neighbours'
};

// ─── DOM REFERENCES ───────────────────────────────────────────
const screens = {
  start: document.getElementById('screen-start'),
  character: document.getElementById('screen-character'),
  playing: document.getElementById('screen-playing'),
  judgement: document.getElementById('screen-judgement'),
  end: document.getElementById('screen-end')
};

const els = {
  btnStart: document.getElementById('btn-start'),
  btnRestart: document.getElementById('btn-restart'),
  btnSeeResults: document.getElementById('btn-see-results'),
  characterGrid: document.getElementById('character-grid'),
  startBestScore: document.getElementById('start-best-score'),
  timer: document.getElementById('timer'),
  currentCharacter: document.getElementById('current-character'),
  meters: document.getElementById('meters'),
  cardArea: document.getElementById('card-area'),
  judgementGrid: document.getElementById('judgement-grid'),
  judgementTotal: document.getElementById('judgement-total'),
  endTitle: document.getElementById('end-title'),
  endSubtitle: document.getElementById('end-subtitle'),
  endScore: document.getElementById('end-score'),
  endBestScore: document.getElementById('end-best-score')
};

// ─── SCREEN NAVIGATION ───────────────────────────────────────
// Only one screen visible at a time. The phase string prevents invalid states.
function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
  state.phase = screenName;
}

// ─── LOCAL STORAGE ────────────────────────────────────────────
// Best score persists between browser sessions.
// Stored as a plain string; parsed to integer on load.
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

function selectCharacter(character) {
  state.character = character;

  // Apply the character's +10 bonus to the correct meter, clamped to 100.
  state.meters[character.bonus.meter] = clampMeter(
    state.meters[character.bonus.meter] + character.bonus.amount
  );

  els.currentCharacter.textContent = `${character.emoji} ${character.name}`;
  showScreen('playing');
  startGame();
}

// ─── GAME SETUP & RESET ──────────────────────────────────────
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
  state.totalLeadership = 0;
  state.totalUbuntu = 0;
  state.decisionsCount = 0;
  state.selfishCount = 0;
  state.selfishStreak = 0;
  state.maxSelfishStreak = 0;

  // ── TIMER CLEANUP ──
  // Always clear before reassigning to prevent duplicate intervals.
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ─── METER HELPERS ────────────────────────────────────────────

// Clamp enforces 0–100 bounds. Without this, CSS width could be
// negative or >100%, and score calculation would be wrong.
function clampMeter(value) {
  return Math.max(0, Math.min(100, value));
}

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

// Updates a single meter bar with animation flash.
function updateMeterDisplay(meterKey) {
  const row = els.meters.querySelector(`[data-meter="${meterKey}"]`);
  if (!row) return;

  const value = state.meters[meterKey];
  const fill = row.querySelector('.meter-fill');
  const valueEl = row.querySelector('.meter-value');

  fill.style.width = `${value}%`;
  valueEl.textContent = value;

  fill.className = 'meter-fill';
  fill.classList.add(`level-${getMeterLevel(value)}`);

  // Force reflow to restart CSS animation
  fill.classList.remove('flash');
  void fill.offsetWidth;
  fill.classList.add('flash');
}

// ─── GAME START ──────────────────────────────────────────────
function startGame() {
  renderMeters();
  updateTimerDisplay();
  els.timer.classList.remove('danger', 'paused');
  showNextCard();
  startTimer();
}

// ─── TIMER ───────────────────────────────────────────────────

// ── TIMER START ──
// Creates a 1-second interval. ONLY decrements when phase === 'playing'.
// This means entering 'consequence' phase automatically pauses the clock
// without needing a separate boolean flag. Clean and race-condition-free.
function startTimer() {
  // Safety: clear any pre-existing interval to prevent duplicates.
  // This is the primary defence against the "two timers ticking" bug.
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.timerInterval = setInterval(() => {
    // ── PHASE-GATED TICK ──
    // Timer only counts down during the 'playing' phase.
    // During 'consequence', 'judgement', or 'end', it naturally pauses.
    if (state.phase !== 'playing') return;

    state.timer--;
    updateTimerDisplay();

    if (state.timer <= 10) {
      els.timer.classList.add('danger');
    }

    // ── WIN CONDITION ──
    // Timer reaches 0 while all meters > 0 = player survived.
    if (state.timer <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      goToJudgement(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  els.timer.textContent = `⏱️ ${state.timer}s`;
}

// ─── CRISIS CARDS ────────────────────────────────────────────

function getNextCard() {
  if (state.usedCardIndices.length >= CRISIS_CARDS.length) {
    state.usedCardIndices = [];
  }

  let index;
  do {
    index = Math.floor(Math.random() * CRISIS_CARDS.length);
  } while (state.usedCardIndices.includes(index));

  state.usedCardIndices.push(index);
  return CRISIS_CARDS[index];
}

function showNextCard() {
  const card = getNextCard();
  state.actionsLocked = false;

  // Ensure we're in 'playing' phase and timer is visually active
  state.phase = 'playing';
  els.timer.classList.remove('paused');

  els.cardArea.innerHTML = `
    <div class="crisis-card">
      <p class="card-title">${card.title}</p>
      <div class="card-actions">
        ${card.actions.map((action, i) => {
          // Mark temptation options with a devil emoji so players know
          // the choice is selfish (but tempting!)
          const isTemp = action.isTemptation === true ||
            (action.tags.includes('selfish') && action.ubuntuImpact <= -2);
          const tempLabel = isTemp ? '<span class="temptation-badge" aria-label="Temptation">😈</span> ' : '';
          return `
            <button class="btn-action${isTemp ? ' temptation' : ''}" data-action-index="${i}" aria-label="${action.label}">
              ${tempLabel}${action.label}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  els.cardArea.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const actionIndex = parseInt(btn.dataset.actionIndex, 10);
      handleAction(card.actions[actionIndex]);
    });
  });
}

// ─── ACTION HANDLING ─────────────────────────────────────────
function handleAction(action) {
  // ── PHASE GUARD ──
  // Only accept actions during the 'playing' phase. This prevents any
  // stale event listener from firing during consequence or other phases.
  if (state.phase !== 'playing') return;

  // ── DOUBLE-CLICK PREVENTION ──
  if (state.actionsLocked) return;
  state.actionsLocked = true;

  // Disable buttons visually
  els.cardArea.querySelectorAll('.btn-action').forEach(btn => {
    btn.disabled = true;
    btn.classList.add('disabled');
  });

  // ── PHASE TRANSITION: playing → consequence ──
  // This immediately pauses the timer (interval checks phase !== 'playing').
  state.phase = 'consequence';
  els.timer.classList.add('paused');

  // ── TRACK SCORING METADATA ──
  state.totalLeadership += action.leadershipImpact;
  state.totalUbuntu += action.ubuntuImpact;
  state.decisionsCount++;

  // ── TEMPTATION TRACKING ──
  // An action is a "temptation" if explicitly marked OR if it's tagged
  // selfish with strong negative ubuntu (the devil-on-your-shoulder options).
  const isTemptation = action.isTemptation === true ||
    (action.tags.includes('selfish') && action.ubuntuImpact <= -2);

  if (isTemptation) {
    state.selfishCount++;
    state.selfishStreak++;
    if (state.selfishStreak > state.maxSelfishStreak) {
      state.maxSelfishStreak = state.selfishStreak;
    }
  } else {
    // Streak resets when you pick a non-selfish action
    state.selfishStreak = 0;
  }

  // ── APPLY METER EFFECTS with clamping ──
  action.effects.forEach(effect => {
    state.meters[effect.meter] = clampMeter(
      state.meters[effect.meter] + effect.delta
    );
    updateMeterDisplay(effect.meter);
  });

  // ── CHECK FOR DEATH ──
  const deadMeter = checkForDeadMeter();

  // Show the consequence screen (paused, player must press Continue)
  showConsequence(action, deadMeter);
}

function checkForDeadMeter() {
  for (const key of Object.keys(state.meters)) {
    if (state.meters[key] <= 0) return key;
  }
  return null;
}

// ─── CONSEQUENCE DISPLAY ─────────────────────────────────────
// Replaces the card area with:
// 1. The result text (what happened)
// 2. Explicit meter change breakdown with +/- and colour
// 3. A "Next Crisis" or "See Final Judgement" button
//
// Timer remains paused until the player presses Continue.
function showConsequence(action, deadMeterKey) {
  // Build meter change breakdown HTML
  // Uses both colour AND symbols (▲/▼) + text labels so it's
  // accessible to colourblind users (not colour-only indication).
  const changesHTML = action.effects.map(effect => {
    const isPositive = effect.delta > 0;
    const sign = isPositive ? '+' : '';
    const arrow = isPositive ? '▲' : '▼';
    const cls = isPositive ? 'positive' : 'negative';
    const label = isPositive ? 'Gain' : 'Loss';
    return `
      <div class="meter-change ${cls}" aria-label="${METER_NAMES[effect.meter]} ${label} ${Math.abs(effect.delta)}">
        <span>${arrow}</span>
        <span>${METER_NAMES[effect.meter]} ${sign}${effect.delta}</span>
      </div>
    `;
  }).join('');

  // Death notice if a meter hit zero
  const deathHTML = deadMeterKey
    ? `<div class="death-notice" role="alert">
        💀 ${METER_NAMES[deadMeterKey]} reached zero! The braai is over.
       </div>`
    : '';

  // Button: either continue playing or go to judgement
  const buttonHTML = deadMeterKey
    ? `<button class="btn-continue" id="btn-to-judgement">See Final Judgement 📋</button>`
    : `<button class="btn-continue" id="btn-next-crisis">Next Crisis →</button>`;

  els.cardArea.innerHTML = `
    <div class="consequence-panel">
      <p class="consequence-result">${action.result}</p>
      <div class="meter-changes">${changesHTML}</div>
      ${deathHTML}
      ${buttonHTML}
    </div>
  `;

  // Wire up the continue button
  if (deadMeterKey) {
    document.getElementById('btn-to-judgement').addEventListener('click', () => {
      // Guard: only proceed if still in consequence phase (prevents double-click)
      if (state.phase !== 'consequence') return;
      goToJudgement(false, deadMeterKey);
    });
  } else {
    document.getElementById('btn-next-crisis').addEventListener('click', () => {
      // Guard: only proceed if still in consequence phase (prevents double-click)
      if (state.phase !== 'consequence') return;
      showNextCard(); // this sets phase back to 'playing' and resumes timer
    });
  }
}

// ─── JUDGEMENT SCREEN ────────────────────────────────────────
// Calculates 5-category scores and displays them before the end screen.

function goToJudgement(isWin, deadMeterKey) {
  // ── STOP TIMER ── (prevent any further ticks)
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  const scores = calculateScores();
  state.score = scores.total;

  // ── BEST SCORE RULE ──
  // Only successful braais (wins) update the best score.
  // A defeat does not count — you must survive the full 60 seconds.
  if (isWin) {
    saveBestScore(state.score);
  }

  // Store win/loss info for the end screen
  state._isWin = isWin;
  state._deadMeterKey = deadMeterKey;

  renderJudgement(scores);
  showScreen('judgement');
}

// ── SCORE CALCULATION ──
// Fire Mastery: based on final fire meter value (0–100)
// Food Quality: based on final food meter value (0–100)
// Vibe: based on final vibe meter value (0–100)
// Crisis Leadership: based on accumulated leadershipImpact across decisions.
//   Normalised: (totalLeadership / maxPossibleLeadership) * 100, clamped 0–100.
//   Max possible = decisionsCount * 2 (each decision can give max +2).
// Ubuntu: same normalisation approach as leadership using ubuntuImpact.
function calculateScores() {
  const fireMastery = state.meters.fire;
  const foodQuality = state.meters.food;
  const vibe = state.meters.vibe;

  // Leadership: normalise from accumulated impact.
  // Range of totalLeadership is [-2*n, +2*n] where n = decisionsCount.
  // We map this to 0–100: shift by adding max negative, then scale.
  const maxLeadership = state.decisionsCount * 2;
  const minLeadership = state.decisionsCount * -2;
  const leadershipRange = maxLeadership - minLeadership || 1; // avoid division by zero
  const crisisLeadership = Math.round(
    clampMeter(((state.totalLeadership - minLeadership) / leadershipRange) * 100)
  );

  // Ubuntu: same normalisation as leadership, with TEMPTATION PENALTY.
  // Each selfish action reduces the raw score by 5 points.
  // A streak of 3+ consecutive selfish picks adds an extra -15 penalty
  // (the crew loses faith in your leadership when you keep taking).
  const maxUbuntu = state.decisionsCount * 2;
  const minUbuntu = state.decisionsCount * -2;
  const ubuntuRange = maxUbuntu - minUbuntu || 1;
  let ubuntu = Math.round(
    clampMeter(((state.totalUbuntu - minUbuntu) / ubuntuRange) * 100)
  );

  // ── TEMPTATION PENALTY ──
  // Each selfish pick costs 5 Ubuntu points. A long streak adds bonus penalty.
  const temptationPenalty = (state.selfishCount * 5) +
    (state.maxSelfishStreak >= 3 ? 15 : 0);
  ubuntu = clampMeter(ubuntu - temptationPenalty);

  const total = Math.min(500, fireMastery + foodQuality + vibe + crisisLeadership + ubuntu);

  return { fireMastery, foodQuality, vibe, crisisLeadership, ubuntu, total };
}

function renderJudgement(scores) {
  const categories = [
    { name: '🔥 Fire Mastery', score: scores.fireMastery },
    { name: '🥩 Food Quality', score: scores.foodQuality },
    { name: '🎶 Vibe', score: scores.vibe },
    { name: '🧠 Crisis Leadership', score: scores.crisisLeadership },
    { name: '🤝 Ubuntu', score: scores.ubuntu }
  ];

  // Show temptation warning if player was selfish
  const temptationNote = state.selfishCount > 0
    ? `<div class="temptation-note" role="status">
        😈 Temptations taken: ${state.selfishCount}${state.maxSelfishStreak >= 3 ? ' (streak penalty!)' : ''}
        <br><small>Each selfish choice cost you 5 Ubuntu points</small>
       </div>`
    : `<div class="temptation-note positive" role="status">
        😇 You resisted all temptations! Ubuntu preserved.
       </div>`;

  els.judgementGrid.innerHTML = categories.map(cat => `
    <div class="judgement-card">
      <span class="category-name">${cat.name}</span>
      <span class="category-score">${cat.score} / 100</span>
    </div>
  `).join('') + temptationNote;

  els.judgementTotal.textContent = `${scores.total} / 500`;
}

// ─── END GAME (from judgement → end) ─────────────────────────
function goToEndScreen() {
  const isWin = state._isWin;
  const deadMeterKey = state._deadMeterKey;

  if (isWin) {
    const tier = WIN_TITLES.find(t => state.score >= t.minScore);
    els.endTitle.textContent = tier.title;
    els.endSubtitle.textContent = tier.subtitle;
  } else {
    const lossInfo = LOSS_TITLES[deadMeterKey];
    els.endTitle.textContent = lossInfo.title;
    els.endSubtitle.textContent = lossInfo.subtitle;
  }

  els.endScore.textContent = state.score;
  els.endBestScore.textContent = state.bestScore;

  showScreen('end');
}

// ─── EVENT LISTENERS ─────────────────────────────────────────
els.btnStart.addEventListener('click', () => {
  showScreen('character');
});

els.btnSeeResults.addEventListener('click', () => {
  goToEndScreen();
});

els.btnRestart.addEventListener('click', () => {
  resetState();
  showScreen('start');
  updateBestScoreDisplay();
});

// ─── DEV TEST HELPERS ────────────────────────────────────────
// These helpers allow quick testing of win, loss, and judgement screens
// without playing through a full 60-second game.
//
// USAGE: Open browser DevTools console and call:
//   devWin()   — immediately trigger a win with high meters
//   devLose()  — immediately trigger a loss (fire hits 0)
//   devJudge() — jump to judgement with custom meter values
//
// AVAILABILITY:
// Only enabled when running on localhost/127.0.0.1 OR when the URL
// contains ?dev=true. On the published GitHub Pages site, these
// functions will NOT exist on window — preventing players from
// cheating or accessing internal state.
(function registerDevHelpers() {
  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  const isDevFlag = params.get('dev') === 'true';

  if (!isLocal && !isDevFlag) return; // ← skip registration on production

  window.devWin = function () {
    state.meters = { fire: 80, food: 70, vibe: 75, electricity: 65, neighbourPatience: 60 };
    state.totalLeadership = 8;
    state.totalUbuntu = 6;
    state.decisionsCount = 5;
    goToJudgement(true);
    console.log('🏆 DEV: Triggered win scenario');
  };

  window.devLose = function () {
    state.meters = { fire: 0, food: 40, vibe: 30, electricity: 50, neighbourPatience: 20 };
    state.totalLeadership = -2;
    state.totalUbuntu = 1;
    state.decisionsCount = 4;
    goToJudgement(false, 'fire');
    console.log('💀 DEV: Triggered loss scenario (fire died)');
  };

  window.devJudge = function (customMeters) {
    if (customMeters) {
      Object.assign(state.meters, customMeters);
    }
    state.totalLeadership = state.totalLeadership || 3;
    state.totalUbuntu = state.totalUbuntu || 4;
    state.decisionsCount = state.decisionsCount || 5;
    goToJudgement(true);
    console.log('📋 DEV: Jumped to judgement screen');
  };

  console.log('🔧 DEV: Test helpers enabled (devWin, devLose, devJudge)');
})();

// ─── INITIALISE ──────────────────────────────────────────────
function init() {
  loadBestScore();
  renderCharacters();
  showScreen('start');
}

init();
