// ── Overwatch Slots — app logic ──────────────────────────────

const COMPS = {
  "5v5": { tank: 1, damage: 2, support: 2 },
  "6v6": { tank: 2, damage: 2, support: 2 },
  "solo": { tank: 1, damage: 1, support: 1 }, // caps, not a comp: the lone player may roll any role
};

const MODE_SIZE = { "5v5": 5, "6v6": 6, "solo": 1 };
const MODE_LABEL = { "5v5": "5v5", "6v6": "6v6", "solo": "Solo" };

const ROLE_ORDER = ["tank", "damage", "support"];
const ROLE_LABEL = { tank: "Tank", damage: "Damage", support: "Support" };

const ROLE_ICONS = {
  tank: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3z"/></svg>',
  damage: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M7 2h3v14H7zM10.5 2h3v14h-3zM14 2h3v14h-3zM7 17.5h10L12 23l-5-5.5z"/></svg>',
  support: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2z"/></svg>',
};

const STORAGE_KEY = "ow-slots-v1";

const MAX_DARE_LEN = 140; // longest built-in dare is ~95 chars
const MAX_CUSTOM_DARES = 100;

const GOLDEN_CHANCE = 0.05; // ~1 in 20 spins hits the jackpot
const TONIGHT_TTL = 12 * 60 * 60 * 1000; // a quiet half-day ends the session
const TONIGHT_MAX = 40; // spins kept in the session log

const ROLE_CSS_COLOR = { tank: "#5aa8f0", damage: "#f0655a", support: "#5ee39a" };
const heroColor = name =>
  HEROES.find(h => h.name === name)?.color ||
  ROLE_CSS_COLOR[HEROES.find(h => h.name === name)?.role] || "#eef2f9";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  mode: "5v5",
  players: ["", "", "", "", ""],
  playerBans: [[], [], [], [], []], // per-player excluded roles, aligned with players
  benched: [], // {name, bans} trimmed off by a mode switch, restored on the next size-up
  customDares: [], // {text, target} — target: "player" | "team" | a role | an exact hero name
  banned: new Set(),
  instant: false,
  portraits: true,
  perks: true,
  challenges: false,
  sound: true,
  rerolls: true,
  noRepeatTonight: false,
  sessionLog: [], // {t, deals: [{player, role, hero}]} — one entry per spin tonight
  poolOpen: false,
  daresOpen: false,
  results: null, // [{ player, role, hero, perkMinor?, perkMajor?, challenge?, punished? }]
  teamChallenge: null, // team-wide dare for the current results
  golden: false, // this deal was a jackpot spin
  spinning: false,
};

// The last spin's player → hero deal; a repeat feels rigged even when it's fair.
let lastSpinHeroes = {};

// The Tonight entry for the board on screen — null when showing a shared link,
// so rerolls/wild picks on someone else's board never rewrite our own history.
let currentLogEntry = null;

// ── Persistence ──────────────────────────────────────────────

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      players: state.players,
      playerBans: state.playerBans,
      benched: state.benched,
      customDares: state.customDares,
      banned: [...state.banned],
      instant: state.instant,
      portraits: state.portraits,
      perks: state.perks,
      challenges: state.challenges,
      sound: state.sound,
      rerolls: state.rerolls,
      noRepeatTonight: state.noRepeatTonight,
      sessionLog: state.sessionLog,
      poolOpen: state.poolOpen,
      daresOpen: state.daresOpen,
    }));
  } catch { /* storage unavailable — the session still works, it just won't persist */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (COMPS[saved.mode]) state.mode = saved.mode;
    if (Array.isArray(saved.players) && saved.players.length > 0) {
      state.players = saved.players.slice(0, teamSize()).map(p => String(p));
    }
    state.playerBans = state.players.map((_, i) =>
      Array.isArray(saved.playerBans?.[i])
        ? saved.playerBans[i].filter(r => ROLE_ORDER.includes(r))
        : []);
    if (Array.isArray(saved.benched)) {
      state.benched = saved.benched
        .filter(b => b && typeof b.name === "string")
        .map(b => ({
          name: b.name.slice(0, 24),
          bans: Array.isArray(b.bans) ? b.bans.filter(r => ROLE_ORDER.includes(r)) : [],
        }));
    }
    if (Array.isArray(saved.customDares)) {
      const heroNames = new Set(HEROES.map(h => h.name));
      const validTarget = t =>
        t === "player" || t === "team" || ROLE_ORDER.includes(t) || heroNames.has(t);
      state.customDares = saved.customDares
        .filter(d => d && typeof d.text === "string" && d.text.trim() && validTarget(d.target))
        .slice(0, MAX_CUSTOM_DARES)
        .map(d => ({ text: d.text.trim().slice(0, MAX_DARE_LEN), target: d.target }));
    }
    if (Array.isArray(saved.banned)) {
      const names = new Set(HEROES.map(h => h.name));
      state.banned = new Set(saved.banned.filter(n => names.has(n)));
    }
    state.instant = !!saved.instant;
    state.portraits = saved.portraits !== false; // default on
    state.perks = saved.perks !== false; // default on
    state.challenges = !!saved.challenges; // default off
    state.sound = saved.sound !== false; // default on
    state.rerolls = saved.rerolls !== false; // default on
    state.noRepeatTonight = !!saved.noRepeatTonight;
    if (Array.isArray(saved.sessionLog)) {
      state.sessionLog = saved.sessionLog
        .filter(e => e && typeof e.t === "number" && Array.isArray(e.deals))
        .map(e => ({
          t: e.t,
          deals: e.deals
            .filter(d => d && typeof d.player === "string" && typeof d.hero === "string"
              && ROLE_ORDER.includes(d.role))
            .map(d => ({ player: d.player.slice(0, 24), role: d.role, hero: d.hero })),
        }))
        .slice(-TONIGHT_MAX);
      // a quiet half-day ends the session — tomorrow starts fresh
      const last = state.sessionLog[state.sessionLog.length - 1];
      if (!last || Date.now() - last.t > TONIGHT_TTL) state.sessionLog = [];
    }
    state.poolOpen = !!saved.poolOpen;
    state.daresOpen = !!saved.daresOpen;
  } catch { /* corrupted storage — start fresh */ }
}

// ── Helpers ──────────────────────────────────────────────────

const teamSize = () => MODE_SIZE[state.mode];

const availableHeroes = role =>
  HEROES.filter(h => h.role === role && !state.banned.has(h.name));

// How many players this role can take in a spin.
const roleCapacity = role => availableHeroes(role).length;

const playerLabel = i => state.players[i].trim() || `Player ${i + 1}`;

const playerExcludes = (i, role) => (state.playerBans[i] || []).includes(role);

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Assignment feasibility ───────────────────────────────────

// Per-role seat caps: comp slots, shrunk by hero availability.
function slotCaps() {
  const comp = COMPS[state.mode];
  const caps = {};
  for (const r of ROLE_ORDER) {
    caps[r] = Math.min(comp[r], roleCapacity(r));
  }
  return caps;
}

// Max players that can be legally seated, honoring caps and per-player
// role exclusions. n ≤ 6 and 3 roles, so brute-force search is instant.
function maxAssignable() {
  const caps = slotCaps();
  const n = state.players.length;
  let best = 0;
  const used = { tank: 0, damage: 0, support: 0 };
  (function dfs(i, count) {
    if (best === n) return;
    if (i === n) { best = Math.max(best, count); return; }
    if (count + (n - i) <= best) return;
    for (const r of ROLE_ORDER) {
      if (used[r] < caps[r] && !playerExcludes(i, r)) {
        used[r]++;
        dfs(i + 1, count + 1);
        used[r]--;
      }
    }
    dfs(i + 1, count);
  })(0, 0);
  return best;
}

const spinFeasible = () => maxAssignable() === state.players.length;

// Randomly assign every player a role that fits the comp, the bans, and
// their personal exclusions. Returns roles[] aligned with players, or null.
function drawAssignment() {
  const caps = slotCaps();
  const order = shuffle(state.players.map((_, i) => i));
  const roles = new Array(state.players.length).fill(null);
  const used = { tank: 0, damage: 0, support: 0 };
  const dfs = k => {
    if (k === order.length) return true;
    const i = order[k];
    for (const r of shuffle(ROLE_ORDER)) {
      if (used[r] < caps[r] && !playerExcludes(i, r)) {
        used[r]++;
        roles[i] = r;
        if (dfs(k + 1)) return true;
        used[r]--;
        roles[i] = null;
      }
    }
    return false;
  };
  return dfs(0) ? roles : null;
}

// explanation of why a spin can't happen (null if it can).
function spinProblem() {
  const comp = COMPS[state.mode];
  const n = state.players.length;
  const caps = slotCaps();
  const capacity = ROLE_ORDER.reduce((sum, r) => sum + caps[r], 0);
  const slots = c => `${c} slot${c === 1 ? "" : "s"}`;

  if (capacity < n) {
    const reasons = [];
    for (const r of ROLE_ORDER) {
      const avail = availableHeroes(r).length;
      if (avail < comp[r]) {
        reasons.push(avail === 0
          ? `every ${ROLE_LABEL[r]} hero is banned (${slots(comp[r])} lost)`
          : `only ${avail} ${ROLE_LABEL[r]} hero enabled (fills 1 of ${slots(comp[r])})`);
      }
    }
    const over = n - capacity;
    const headline = capacity === 0
      ? `No role slots are left for your ${n} player${n === 1 ? "" : "s"}`
      : `${n} players, but only ${slots(capacity)} left`;
    const fix = capacity === 0
      ? "Unban some heroes to spin."
      : `Unban some heroes, or remove ${over} player${over === 1 ? "" : "s"}.`;
    return `${headline} — ${reasons.join("; ")}. ${fix}`;
  }

  if (maxAssignable() < n) {
    const blocked = state.players
      .map((_, i) => i)
      .filter(i => ROLE_ORDER.every(r => caps[r] === 0 || playerExcludes(i, r)));
    const who = blocked.length
      ? `${blocked.map(playerLabel).join(", ")} ${blocked.length === 1 ? "has" : "have"} no playable role left. `
      : "";
    return `The per-player role exclusions make this comp impossible — ${who}Allow a crossed-out role or loosen your bans.`;
  }

  return null;
}

// ── DOM refs ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const modeToggle = $("mode-toggle");
const instantToggle = $("instant-toggle");
const playerList = $("player-list");
const playerCount = $("player-count");
const addPlayerBtn = $("add-player");
const heroPool = $("hero-pool");
const poolCount = $("pool-count");
const spinBtn = $("spin-btn");
const spinWarning = $("spin-warning");
const resultsSection = $("results");
const resultsGrid = $("results-grid");
const shareRow = $("share-row");
const emptyNote = $("empty-note");

// ── Sound (WebAudio, synthesized — no files) ─────────────────

let audioCtx = null;

function sound(fn) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    fn(audioCtx);
  } catch { /* audio unavailable — stay silent */ }
}

function blip(ctx, { freq = 1200, dur = 0.03, gain = 0.04, type = "square", when = 0 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + when);
  o.stop(ctx.currentTime + when + dur + 0.05);
}

const sfx = {
  tick: () => sound(ctx => blip(ctx, { freq: 1050 + Math.random() * 350, dur: 0.02, gain: 0.02 })),
  roleLock: () => sound(ctx => {
    blip(ctx, { freq: 170, dur: 0.12, gain: 0.11, type: "sine" });
    blip(ctx, { freq: 88, dur: 0.16, gain: 0.09, type: "sine", when: 0.03 });
  }),
  heroLock: i => sound(ctx => blip(ctx, { freq: 660 * Math.pow(1.12, i), dur: 0.22, gain: 0.08, type: "triangle" })),
  fanfare: () => sound(ctx =>
    [523, 659, 784, 1047].forEach((f, i) => blip(ctx, { freq: f, dur: 0.18, gain: 0.07, type: "triangle", when: i * 0.09 }))),
  jackpot: () => sound(ctx =>
    [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) =>
      blip(ctx, { freq: f, dur: 0.22, gain: 0.08, type: "triangle", when: i * 0.11 }))),
};

// ── Rendering ────────────────────────────────────────────────

function renderMode() {
  modeToggle.querySelectorAll(".seg-btn").forEach(btn => {
    const active = btn.dataset.mode === state.mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function renderPlayers() {
  playerList.innerHTML = "";
  state.players.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "player-row";

    const num = document.createElement("span");
    num.className = "player-num";
    num.textContent = i + 1;

    const input = document.createElement("input");
    input.className = "player-input";
    input.type = "text";
    input.maxLength = 24;
    input.placeholder = `Player ${i + 1}`;
    input.setAttribute("aria-label", `Player ${i + 1} name`);
    input.value = name;
    input.addEventListener("input", () => {
      state.players[i] = input.value;
      saveState();
    });

    // per-player role exclusions: cross out roles this player refuses
    const picks = document.createElement("div");
    picks.className = "role-picks";
    for (const role of ROLE_ORDER) {
      const excluded = playerExcludes(i, role);
      const b = document.createElement("button");
      b.className = `role-pick ${role}` + (excluded ? " excluded" : "");
      b.innerHTML = ROLE_ICONS[role];
      b.setAttribute("aria-pressed", String(excluded));
      b.setAttribute("aria-label", `Exclude ${ROLE_LABEL[role]} for ${playerLabel(i)}`);
      b.title = excluded
        ? `${playerLabel(i)} won't roll ${ROLE_LABEL[role]} — click to allow it`
        : `Stop ${playerLabel(i)} from rolling ${ROLE_LABEL[role]}`;
      b.addEventListener("click", () => {
        const bans = state.playerBans[i] || (state.playerBans[i] = []);
        const idx = bans.indexOf(role);
        if (idx >= 0) bans.splice(idx, 1);
        else bans.push(role);
        saveState();
        // toggle this button in place — a full re-render would steal keyboard focus
        const nowExcluded = idx < 0;
        b.classList.toggle("excluded", nowExcluded);
        b.setAttribute("aria-pressed", String(nowExcluded));
        b.title = nowExcluded
          ? `${playerLabel(i)} won't roll ${ROLE_LABEL[role]} — click to allow it`
          : `Stop ${playerLabel(i)} from rolling ${ROLE_LABEL[role]}`;
        updateSpinState();
      });
      picks.append(b);
    }

    row.append(num, input, picks);

    if (state.players.length > 1) {
      const rm = document.createElement("button");
      rm.className = "remove-player";
      rm.textContent = "✕";
      rm.title = "Remove player";
      rm.setAttribute("aria-label", `Remove player ${i + 1}`);
      rm.addEventListener("click", () => {
        if (state.spinning) return;
        state.players.splice(i, 1);
        state.playerBans.splice(i, 1);
        saveState();
        renderPlayers();
        updateSpinState();
      });
      row.append(rm);
    }

    playerList.append(row);
  });

  playerCount.textContent = `${state.players.length} / ${teamSize()}`;
  addPlayerBtn.hidden = state.players.length >= teamSize();

  // benched players are invisible otherwise — say where they went
  const benched = state.benched.length;
  $("bench-note").hidden = !benched;
  if (benched) {
    $("bench-note").textContent =
      `${benched} player${benched === 1 ? "" : "s"} benched — switch to a bigger mode to bring them back.`;
  }
}

function renderPool() {
  heroPool.innerHTML = "";
  for (const role of ROLE_ORDER) {
    const group = document.createElement("div");
    group.className = "role-group";

    const label = document.createElement("div");
    label.className = "pool-role-label";
    label.style.color = `var(--${role})`;
    label.innerHTML = `${ROLE_ICONS[role]} ${ROLE_LABEL[role]}`;

    const grid = document.createElement("div");
    grid.className = "chip-grid";

    for (const hero of HEROES.filter(h => h.role === role)) {
      const heroBanned = state.banned.has(hero.name);
      const chip = document.createElement("button");
      chip.className = "hero-chip" + (heroBanned ? " banned" : "");
      chip.style.setProperty("--dot", hero.color || ROLE_CSS_COLOR[role]);
      const dot = document.createElement("span");
      dot.className = "chip-dot";
      chip.append(dot, document.createTextNode(hero.name));
      chip.setAttribute("aria-pressed", String(heroBanned));
      chip.title = heroBanned ? "Click to re-enable" : "Click to ban";
      chip.addEventListener("click", () => {
        const nowBanned = !state.banned.has(hero.name);
        if (nowBanned) state.banned.add(hero.name);
        else state.banned.delete(hero.name);
        saveState();
        // toggle this chip in place — rebuilding the grid would steal keyboard focus
        chip.classList.toggle("banned", nowBanned);
        chip.setAttribute("aria-pressed", String(nowBanned));
        chip.title = nowBanned ? "Click to re-enable" : "Click to ban";
        poolCount.textContent = `${HEROES.length - state.banned.size} / ${HEROES.length}`;
        updateSpinState();
      });
      grid.append(chip);
    }

    group.append(label, grid);
    heroPool.append(group);
  }

  const enabled = HEROES.length - state.banned.size;
  poolCount.textContent = `${enabled} / ${HEROES.length}`;
}

// Human label for a house dare's target (list rows).
const dareTargetLabel = t =>
  t === "player" ? "anyone" : t === "team" ? "team" : ROLE_LABEL[t] || t;

function renderDares() {
  const list = $("dare-list");
  list.innerHTML = "";
  state.customDares.forEach((dare, i) => {
    const row = document.createElement("div");
    row.className = "dare-row";

    const chip = document.createElement("div");
    chip.className = "challenge-chip custom";

    const tag = document.createElement("span");
    tag.className = "dare-tag" + (ROLE_ORDER.includes(dare.target) ? ` ${dare.target}` : "");
    const hero = HEROES.find(h => h.name === dare.target);
    if (hero) {
      const dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.setProperty("--dot", hero.color || ROLE_CSS_COLOR[hero.role]);
      tag.append(dot);
    }
    tag.append(document.createTextNode(dareTargetLabel(dare.target)));

    const text = document.createElement("span");
    text.className = "challenge-text";
    text.textContent = dare.text;
    chip.append(tag, text);

    const rm = document.createElement("button");
    rm.className = "remove-player";
    rm.textContent = "✕";
    rm.title = "Delete dare";
    rm.setAttribute("aria-label", `Delete dare: ${dare.text}`);
    rm.addEventListener("click", () => {
      state.customDares.splice(i, 1);
      saveState();
      renderDares();
    });

    row.append(chip, rm);
    list.prepend(row); // prepend flips array order: the newest dare lands on top
  });

  $("dares-count").textContent = state.customDares.length || "";
  $("dares-empty").hidden = state.customDares.length > 0;
  $("dares-off-note").hidden = state.challenges;
}

function updateSpinState() {
  const problem = spinProblem();
  spinBtn.disabled = state.spinning || !!problem;
  spinWarning.hidden = !problem;
  if (problem) spinWarning.textContent = problem;
  // these rewrite the dealt board, so they lock while the reels run
  portraitToggle.disabled = perkToggle.disabled = challengeToggle.disabled =
    rerollToggle.disabled = state.spinning;
  $("share-link").disabled = $("copy-text").disabled = $("copy-image").disabled =
    state.spinning || !state.results;
}

function setCardHeroColor(card, heroName) {
  const c = heroColor(heroName);
  card.style.setProperty("--hero-color", c);
  card.style.setProperty("--hero-glow", c + "66");
}

// Roll (or clear) the perk picks for one result, in place.
function rollPerks(result) {
  const heroPerks = typeof PERKS !== "undefined" ? PERKS[result.hero] : null;
  if (state.perks && heroPerks) {
    result.perkMinor = pick(heroPerks.minor);
    result.perkMajor = pick(heroPerks.major);
  } else {
    delete result.perkMinor;
    delete result.perkMajor;
  }
}

// House dares (user-written) aimed at one target: "player", a role, a hero name, or "team".
const customDaresFor = target =>
  state.customDares.filter(d => d.target === target).map(d => d.text);

const isCustomDare = text => state.customDares.some(d => d.text === text);

// Every dare this hero/role combination could draw.
const challengePoolFor = r => [
  ...(typeof CHALLENGES !== "undefined" ? [
    ...(CHALLENGES.player || []),
    ...(CHALLENGES.role?.[r.role] || []),
    ...(CHALLENGES.hero?.[r.hero] || []),
  ] : []),
  ...customDaresFor("player"),
  ...customDaresFor(r.role),
  ...customDaresFor(r.hero),
];

// Roll (or clear) the challenge dare for one result, in place.
function rollChallenge(result, exclude = new Set()) {
  if (result.punished) return; // a punishment dare was earned — it doesn't wash off
  if (!state.challenges) { delete result.challenge; return; }
  const custom = [...customDaresFor("player"), ...customDaresFor(result.role), ...customDaresFor(result.hero)];
  const heroPool = [
    ...(typeof CHALLENGES !== "undefined" ? CHALLENGES.hero?.[result.hero] || [] : []),
    ...customDaresFor(result.hero),
  ];
  // house dares are written for this exact group — first refusal 40% of the time;
  // hero-specific dares are the next-best gags and jump the queue about a third of the time
  const base =
    custom.length && Math.random() < 0.4 ? custom :
    heroPool.length && Math.random() < 0.35 ? heroPool :
    challengePoolFor(result);
  // a small priority pool can run dry mid-spin — widen to the full pool before repeating
  let pool = base.filter(c => !exclude.has(c));
  if (!pool.length) pool = challengePoolFor(result).filter(c => !exclude.has(c));
  if (!pool.length) pool = base;
  if (!pool.length) { delete result.challenge; return; }
  result.challenge = pick(pool);
}

// A team-wide dare hits on roughly a quarter of spins — a golden spin guarantees one.
function rollTeamChallenge() {
  const custom = customDaresFor("team");
  const pool = [
    ...(typeof CHALLENGES !== "undefined" ? CHALLENGES.team || [] : []),
    ...custom,
  ];
  const chance = state.golden ? 1 : 0.25;
  state.teamChallenge =
    state.challenges && (state.results?.length || 0) > 1 && pool.length && Math.random() < chance
      ? (custom.length && Math.random() < 0.5 ? pick(custom) : pick(pool))
      : null;
}

// The price of rejecting fate: a reroll always deals a dare, toggle or no toggle.
function rollPunishment(result, exclude = new Set()) {
  const base = challengePoolFor(result);
  const fresh = base.filter(c => !exclude.has(c));
  const pool = fresh.length ? fresh : base;
  if (!pool.length) return;
  result.challenge = pick(pool);
  result.punished = true;
}

// Roll fresh dares for the whole board (or clear them when the toggle is off).
function rerollAllChallenges() {
  const taken = new Set();
  state.results.forEach(r => {
    rollChallenge(r, taken);
    if (r.challenge) taken.add(r.challenge);
  });
  rollTeamChallenge();
}

// Add/replace the challenge chip on a card (removes it if nothing is rolled).
function setCardChallenge(card, result) {
  card.querySelector(".challenge-row")?.remove();
  if (!result.challenge) return;
  const row = document.createElement("div");
  row.className = "challenge-row";
  const custom = isCustomDare(result.challenge);
  const chip = document.createElement("div");
  chip.className = "challenge-chip" + (result.punished ? " punish" : custom ? " custom" : "");
  if (result.punished) chip.title = "The price of rerolling fate";
  else if (custom) chip.title = "One of your own house dares";
  const tag = document.createElement("span");
  tag.className = "perk-tag";
  tag.textContent = result.punished ? "😈 punishment" : custom ? "🏠 house" : "🎲 dare";
  const text = document.createElement("span");
  text.className = "challenge-text";
  text.textContent = result.challenge;
  chip.append(tag, text);
  row.append(chip);
  card.append(row);
}

// The golden spin's WILD card: the roll is just a suggestion — that player may
// play any hero of their role, banned ones included. The wild transcends bans.
function setCardWild(card, result) {
  card.querySelector(".wild-row")?.remove();
  card.classList.toggle("wild", !!result.wild);
  if (!result.wild) return;

  const row = document.createElement("div");
  row.className = "wild-row";

  const badge = document.createElement("span");
  badge.className = "wild-badge";
  const shimmer = document.createElement("span");
  shimmer.className = "wild-badge-text"; // the gradient clip would hollow out the emoji
  shimmer.textContent = "WILD";
  badge.append("🃏 ", shimmer);

  const text = document.createElement("span");
  text.className = "wild-text";
  text.textContent = `pick ANY ${ROLE_LABEL[result.role]} you want — even a banned one`;

  row.append(badge, text);
  card.append(row);
}

// Show/hide the team-wide dare banner and golden badge (kept hidden while reels spin).
function renderTeamChallenge() {
  $("team-challenge").hidden = !state.teamChallenge || !state.results || state.spinning;
  if (state.teamChallenge) {
    $("team-challenge-text").textContent = state.teamChallenge;
    $("team-challenge-label").textContent =
      isCustomDare(state.teamChallenge) ? "🏠 House rule" : "💥 Team dare";
  }
  $("golden-note").hidden = !state.golden || !state.results || state.spinning;
}

// Rebuild the Tonight session log (hidden until the first spin of the session).
function renderTonight() {
  const log = state.sessionLog;
  $("tonight-details").hidden = log.length === 0;
  $("tonight-count").textContent = log.length ? `${log.length} spin${log.length === 1 ? "" : "s"}` : "";
  const list = $("tonight-list");
  list.innerHTML = "";
  log.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "tonight-row";
    const num = document.createElement("span");
    num.className = "tonight-num";
    num.textContent = i + 1;
    const deals = document.createElement("span");
    deals.className = "tonight-deals";
    entry.deals.forEach((d, k) => {
      if (k) deals.append(" · ");
      const name = document.createElement("b");
      name.textContent = d.player;
      deals.append(name, ` → ${d.hero}`);
    });
    row.append(num, deals);
    list.prepend(row); // newest spin on top
  });
}

// Heroes each player has already been dealt tonight (for the no-repeats toggle).
function playedTonight() {
  const map = {};
  for (const entry of state.sessionLog) {
    for (const d of entry.deals) (map[d.player] = map[d.player] || new Set()).add(d.hero);
  }
  return map;
}

// Add/replace the perk chips on a card (removes them if nothing is rolled).
function setCardPerks(card, result) {
  card.querySelector(".perk-row")?.remove();
  if (!result.perkMinor) return;
  const row = document.createElement("div");
  row.className = "perk-row";
  for (const [kind, perk] of [["minor", result.perkMinor], ["major", result.perkMajor]]) {
    const chip = document.createElement("div");
    chip.className = `perk-chip ${kind}`;
    chip.title = perk.desc;
    const icon = document.createElement("img");
    icon.className = "perk-icon";
    icon.src = perk.icon;
    icon.alt = "";
    icon.loading = "lazy";
    icon.addEventListener("error", () => icon.remove());
    const tag = document.createElement("span");
    tag.className = "perk-tag";
    tag.textContent = kind;
    const name = document.createElement("span");
    name.className = "perk-name";
    name.textContent = perk.name;
    // screen readers get the description too (visually it's the hover tooltip)
    const desc = document.createElement("span");
    desc.className = "visually-hidden";
    desc.textContent = ` — ${perk.desc}`;
    chip.append(icon, tag, name, desc);
    row.append(chip);
  }
  card.querySelector(".hero-reel").after(row);
}

// Add/replace the portrait on a card (removes it if portraits are off or no image).
function setCardPortrait(card, heroName) {
  card.querySelector(".portrait-frame")?.remove();
  const img = HEROES.find(h => h.name === heroName)?.img;
  if (!state.portraits || !img) {
    card.classList.remove("has-portrait");
    return;
  }
  card.classList.add("has-portrait");
  const frame = document.createElement("div");
  frame.className = "portrait-frame";
  const pic = document.createElement("img");
  pic.className = "hero-portrait";
  pic.src = img;
  pic.alt = "";
  pic.draggable = false;
  // if the CDN is unreachable, fall back to the text-only card
  pic.addEventListener("error", () => {
    frame.remove();
    card.classList.remove("has-portrait");
  });
  frame.append(pic);
  card.append(frame);
}

function buildCard(result, index = 0) {
  const card = document.createElement("div");
  card.className = `result-card ${result.role}` + (state.golden ? " golden" : "");
  card.style.animationDelay = `${index * 0.06}s`;
  setCardHeroColor(card, result.hero);

  const watermark = document.createElement("div");
  watermark.innerHTML = ROLE_ICONS[result.role];
  const watermarkSvg = watermark.firstChild;
  watermarkSvg.classList.remove("role-icon");
  watermarkSvg.classList.add("card-watermark");

  const roleEl = document.createElement("div");
  roleEl.className = "result-role";
  roleEl.innerHTML = `${ROLE_ICONS[result.role]} ${ROLE_LABEL[result.role]}`;

  const playerEl = document.createElement("div");
  playerEl.className = "result-player";
  playerEl.textContent = result.player;

  const reel = document.createElement("div");
  reel.className = "hero-reel";

  const heroEl = document.createElement("div");
  heroEl.className = "result-hero";
  heroEl.textContent = result.hero;
  reel.append(heroEl);

  const reroll = document.createElement("button");
  reroll.className = "reroll-btn";
  reroll.textContent = "↻";
  reroll.hidden = !state.rerolls; // hardcore mode: fate is final
  reroll.title = "Reroll this hero — costs a punishment dare";
  reroll.setAttribute("aria-label", `Reroll hero for ${result.player}`);
  reroll.addEventListener("click", () => rerollHero(result, card, heroEl));

  card.append(watermarkSvg, roleEl, playerEl, reel, reroll);
  setCardPortrait(card, result.hero);
  setCardPerks(card, result);
  setCardChallenge(card, result);
  setCardWild(card, result);
  return card;
}

// Bring the team into view the moment a spin starts (stacked layout only —
// on wide screens the team sits beside the setup and is already visible).
function revealResults() {
  if (window.matchMedia("(min-width: 1080px)").matches) return;
  resultsSection.scrollIntoView({
    behavior: REDUCED_MOTION.matches ? "auto" : "smooth",
    block: "start",
  });
}

function renderResults() {
  resultsGrid.innerHTML = "";
  const hasResults = !!state.results;
  shareRow.hidden = !hasResults;
  emptyNote.hidden = hasResults;
  renderTeamChallenge();
  if (!hasResults) return;
  state.results.forEach((result, i) => resultsGrid.append(buildCard(result, i)));
}

// Announce the finished team to screen readers.
function announceResults(prefix = "Team rolled") {
  if (!state.results) return;
  $("sr-results").textContent = `${prefix}: ` + state.results
    .map(r => `${r.player}: ${ROLE_LABEL[r.role]}, ${r.hero}`
      + (r.wild ? ` (wild — may pick any ${ROLE_LABEL[r.role]})` : "")
      + (r.challenge ? `, dare: ${r.challenge}` : ""))
    .join(". ")
    + (state.teamChallenge ? `. Team dare: ${state.teamChallenge}` : "");
}

// ── Sharing ──────────────────────────────────────────────────

const ROLE_EMOJI = { tank: "🛡️", damage: "⚔️", support: "💚" };
const ROLE_FROM_CHAR = { t: "tank", d: "damage", s: "support" };

// URL-safe base64 over UTF-8 — shared by team links and setup links.
const toB64url = json => {
  const bytes = new TextEncoder().encode(json);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = enc => {
  const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
};

// Share links encode perks by NAME so links survive perk-data updates
// (a renamed perk degrades to "no perk" instead of showing the wrong one).
function encodeResults() {
  const rows = state.results.map(r => [
    r.player,
    r.role[0],
    r.hero,
    r.perkMinor ? r.perkMinor.name : null,
    r.perkMajor ? r.perkMajor.name : null,
    r.challenge || null,
    r.punished ? 1 : null,
  ]);
  // plain rows unless a team dare or jackpot needs carrying — keeps old links symmetrical
  const extras = {};
  if (state.teamChallenge) extras.t = state.teamChallenge;
  if (state.golden) extras.g = 1;
  return toB64url(JSON.stringify(Object.keys(extras).length ? { r: rows, ...extras } : rows));
}

// Accepts both the current name-based perk encoding and legacy index-based links.
function findPerk(list, key) {
  if (typeof key === "string") return list.find(x => x.name === key) || null;
  if (Number.isInteger(key) && key >= 0) return list[key] || null;
  return null;
}

function decodeSharedTeam(encoded) {
  try {
    const parsed = JSON.parse(fromB64url(encoded));
    // legacy links are a bare rows array; newer ones wrap it to carry the team dare
    const rows = Array.isArray(parsed) ? parsed : parsed.r;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 6) return null;
    const results = rows.map(([player, roleChar, hero, mi, ma, dare, pun]) => {
      const role = ROLE_FROM_CHAR[roleChar];
      if (!role || !HEROES.some(h => h.name === hero && h.role === role)) throw new Error("bad hero");
      const result = { player: String(player).slice(0, 24) || "Player", role, hero };
      const p = typeof PERKS !== "undefined" ? PERKS[hero] : null;
      if (p) {
        const minor = findPerk(p.minor, mi);
        const major = findPerk(p.major, ma);
        // only as a pair — a half-set perk pick crashes the card render and copy-as-text
        if (minor && major) {
          result.perkMinor = minor;
          result.perkMajor = major;
        }
      }
      // any dare text rides along — house dares aren't in the recipient's pools
      if (typeof dare === "string" && dare.trim()) {
        result.challenge = dare.trim().slice(0, MAX_DARE_LEN);
        if (pun === 1) result.punished = true;
      }
      return result;
    });
    const team = !Array.isArray(parsed)
      && typeof parsed.t === "string"
      && parsed.t.trim()
      && results.length > 1
      ? parsed.t.trim().slice(0, MAX_DARE_LEN) : null;
    const golden = !Array.isArray(parsed) && parsed.g === 1;
    return { results, team, golden };
  } catch {
    return null;
  }
}

// location.origin is the string "null" for file:// pages in Firefox.
function siteBase() {
  return location.protocol === "file:"
    ? location.href.split("#")[0]
    : location.origin + location.pathname;
}

function shareUrl() {
  return siteBase() + "#team=" + encodeResults();
}

function resultsAsText() {
  const lines = state.results.map(r => {
    const perks = r.perkMinor && r.perkMajor ? ` (${r.perkMinor.name} / ${r.perkMajor.name})` : "";
    const tag = r.punished ? "😈" : r.challenge && isCustomDare(r.challenge) ? "🏠" : "🎲";
    const dare = r.challenge ? `\n   ${tag} ${r.challenge}` : "";
    return `${ROLE_EMOJI[r.role]} ${r.player} → ${r.hero}${r.wild ? " 🃏" : ""}${perks}${dare}`;
  });
  const team = state.teamChallenge
    ? `\n${isCustomDare(state.teamChallenge) ? "🏠 House rule" : "💥 Team dare"}: ${state.teamChallenge}`
    : "";
  const golden = state.golden ? " · ✨ GOLDEN SPIN" : "";
  return `🎰 OVERWATCH SLOTS — ${MODE_LABEL[state.mode] || state.mode}${golden}\n${lines.join("\n")}${team}\nSpin your own: ${shareUrl()}`;
}

// ── Copy as image ────────────────────────────────────────────

// Word-wrap: the lines `text` needs at `maxWidth` in the context's current font.
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (let w of text.split(" ")) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
    if (line) { lines.push(line); line = ""; }
    // a single unbroken word wider than the card gets hard-split by characters
    while (ctx.measureText(w).width > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxWidth) cut--;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    line = w;
  }
  if (line) lines.push(line);
  return lines;
}

// Draw the current team onto a canvas. No CDN portraits — cross-origin images
// would taint the canvas and block export, so cards are text-and-color only.
function teamImage() {
  const W = 760, PAD = 26, SCALE = 2;
  const INNER = W - PAD * 2;
  const display = "800 19px Bahnschrift, 'Arial Narrow', sans-serif";
  const body = "15px 'Segoe UI', sans-serif";

  // measure pass: card heights depend on how the dare text wraps
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = body;
  const cards = state.results.map(r => {
    const dareLines = r.challenge ? wrapText(meas, r.challenge, INNER - 130) : [];
    const h = 74 + (r.perkMinor && r.perkMajor ? 24 : 0) + (dareLines.length ? 10 + dareLines.length * 21 : 0);
    return { r, dareLines, h };
  });
  const teamLines = state.teamChallenge ? wrapText(meas, state.teamChallenge, INNER - 44) : [];
  let y = 66;
  if (state.golden) y += 34;
  const teamBoxH = teamLines.length ? 34 + teamLines.length * 21 : 0;
  if (teamBoxH) y += teamBoxH + 14;
  const H = y + cards.reduce((s, c) => s + c.h + 12, 0) + 40;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const x = canvas.getContext("2d");
  x.scale(SCALE, SCALE);

  // backdrop
  x.fillStyle = "#0c101a";
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, -60, 0, W / 2, -60, 420);
  glow.addColorStop(0, "rgba(249,158,26,0.20)");
  glow.addColorStop(1, "rgba(249,158,26,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  // header
  x.textAlign = "center";
  x.font = "italic 800 24px Bahnschrift, 'Arial Narrow', sans-serif";
  x.fillStyle = "#eef2f9";
  x.fillText(`🎰 OVERWATCH SLOTS — ${MODE_LABEL[state.mode] || state.mode}`, W / 2, 38);
  let cy = 66;
  if (state.golden) {
    x.font = "italic 800 17px Bahnschrift, 'Arial Narrow', sans-serif";
    x.fillStyle = "#f5d675";
    x.fillText("✨ G O L D E N   S P I N ✨", W / 2, cy - 6);
    cy += 34 - 6;
  }

  const roundRect = (rx, ry, rw, rh, rad) => {
    x.beginPath();
    x.roundRect(rx, ry, rw, rh, rad);
  };

  // team dare banner
  if (teamBoxH) {
    x.strokeStyle = "rgba(249,158,26,0.55)";
    x.setLineDash([5, 4]);
    x.fillStyle = "rgba(249,158,26,0.08)";
    roundRect(PAD, cy - 14, INNER, teamBoxH, 9);
    x.fill();
    x.stroke();
    x.setLineDash([]);
    x.font = "italic 800 12px Bahnschrift, 'Arial Narrow', sans-serif";
    x.fillStyle = "#f99e1a";
    x.fillText(isCustomDare(state.teamChallenge) ? "🏠 HOUSE RULE" : "💥 TEAM DARE", W / 2, cy + 6);
    x.font = body;
    x.fillStyle = "#eef2f9";
    teamLines.forEach((l, i) => x.fillText(l, W / 2, cy + 27 + i * 21));
    cy += teamBoxH + 14;
  }

  // cards
  x.textAlign = "left";
  for (const { r, dareLines, h } of cards) {
    x.fillStyle = "#1a2130";
    x.strokeStyle = state.golden ? "rgba(245,214,117,0.65)" : "#2e3950";
    roundRect(PAD, cy, INNER, h, 10);
    x.fill();
    x.stroke();
    const rc = ROLE_CSS_COLOR[r.role];
    x.fillStyle = rc;
    x.fillRect(PAD, cy + 8, 4, h - 16);

    x.font = "700 11px 'Segoe UI', sans-serif";
    x.fillStyle = rc;
    x.fillText(ROLE_LABEL[r.role].toUpperCase(), PAD + 18, cy + 24);

    x.font = display;
    x.fillStyle = "#eef2f9";
    x.fillText(r.player, PAD + 18, cy + 50);
    x.textAlign = "right";
    x.font = "italic 800 20px Bahnschrift, 'Arial Narrow', sans-serif";
    x.fillStyle = heroColor(r.hero);
    x.fillText((r.wild ? "🃏 " : "") + r.hero, W - PAD - 18, cy + 44);
    x.textAlign = "left";

    let ly = cy + 74;
    if (r.perkMinor && r.perkMajor) {
      x.font = "13px 'Segoe UI', sans-serif";
      x.fillStyle = "#8a94ab";
      x.fillText(`MINOR ${r.perkMinor.name}   ·   MAJOR ${r.perkMajor.name}`, PAD + 18, ly - 4);
      ly += 24;
    }
    if (dareLines.length) {
      x.font = body;
      x.fillStyle = r.punished ? "#f0655a" : "#ffb84d";
      const tag = r.punished ? "😈" : isCustomDare(r.challenge) ? "🏠" : "🎲";
      dareLines.forEach((l, i) => x.fillText(`${i === 0 ? tag + " " : "    "}${l}`, PAD + 18, ly + i * 21));
    }
    cy += h + 12;
  }

  // footer
  x.textAlign = "center";
  x.font = "700 13px Bahnschrift, 'Arial Narrow', sans-serif";
  x.fillStyle = "#f99e1a";
  x.fillText("owherogenerator.com", W / 2, H - 16);
  return canvas;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for older browsers / non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function flashButton(btn, ok) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = ok ? "✓ Copied!" : "✗ Couldn't copy";
  btn.disabled = true;
  // updateSpinState reasserts the disabled state for the buttons it manages
  setTimeout(() => { btn.textContent = original; btn.disabled = false; updateSpinState(); }, 1400);
}

// ── Setup sharing (#setup= links hand your whole config to a friend) ──

function encodeSetup() {
  return toB64url(JSON.stringify({
    v: 1,
    m: state.mode,
    p: state.players,
    x: state.playerBans,
    b: [...state.banned],
    d: state.customDares,
  }));
}

function decodeSetup(encoded) {
  try {
    const s = JSON.parse(fromB64url(encoded));
    // Object.hasOwn: a crafted mode like "constructor" is truthy on any plain object
    if (!s || s.v !== 1 || !Object.hasOwn(COMPS, s.m) || !Array.isArray(s.p)) return null;
    const heroNames = new Set(HEROES.map(h => h.name));
    const players = s.p.slice(0, MODE_SIZE[s.m]).map(p => String(p).slice(0, 24));
    if (players.length === 0) return null;
    const playerBans = players.map((_, i) =>
      Array.isArray(s.x?.[i]) ? [...new Set(s.x[i].filter(r => ROLE_ORDER.includes(r)))] : []);
    const banned = Array.isArray(s.b) ? [...new Set(s.b.filter(n => heroNames.has(n)))] : [];
    const validTarget = t =>
      t === "player" || t === "team" || ROLE_ORDER.includes(t) || heroNames.has(t);
    const seen = new Set();
    const dares = (Array.isArray(s.d) ? s.d : [])
      .filter(d => d && typeof d.text === "string" && d.text.trim() && validTarget(d.target))
      .map(d => ({ text: d.text.trim().slice(0, MAX_DARE_LEN), target: d.target }))
      .filter(d => {
        const key = d.target + "\n" + d.text.toLowerCase();
        if (seen.has(key)) return false; // a payload full of copies is still one dare
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CUSTOM_DARES);
    return { mode: s.m, players, playerBans, banned, dares };
  } catch {
    return null;
  }
}

// Import a #setup= link: replaces squad config, merges house dares — with consent.
function applySharedSetup(encoded) {
  const clearHash = () => {
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* file:// quirks */ }
  };
  const setup = decodeSetup(encoded);
  if (!setup) { $("stale-link-note").hidden = false; return; }
  const newDares = setup.dares.filter(d =>
    !state.customDares.some(o => o.target === d.target && o.text.toLowerCase() === d.text.toLowerCase()));
  const summary = [
    `${setup.players.length} player${setup.players.length === 1 ? "" : "s"} (${MODE_LABEL[setup.mode]})`,
    `${setup.banned.length} hero ban${setup.banned.length === 1 ? "" : "s"}`,
    `${newDares.length} new house dare${newDares.length === 1 ? "" : "s"}`,
  ].join(", ");
  if (!confirm(`Import this shared setup? ${summary}.\n\nPlayers, role crosses, and bans are replaced; house dares are added to yours.`)) {
    clearHash();
    return;
  }
  state.mode = setup.mode;
  state.players = setup.players;
  state.playerBans = setup.playerBans;
  state.benched = [];
  state.banned = new Set(setup.banned);
  state.customDares = state.customDares.concat(newDares).slice(0, MAX_CUSTOM_DARES);
  saveState();
  renderMode();
  renderPlayers();
  renderPool();
  renderDares();
  updateSpinState();
  clearHash();
}

// Load (or clear) a shared team from the current #team= hash.
function applySharedHash(announce = true) {
  $("stale-link-note").hidden = true;
  const setupMatch = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (setupMatch) { applySharedSetup(setupMatch[1]); return; }
  const m = location.hash.match(/^#team=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  const shared = decodeSharedTeam(m[1]);
  if (shared) {
    state.results = shared.results;
    state.teamChallenge = shared.team;
    state.golden = shared.golden;
    currentLogEntry = null; // someone else's board — not part of our Tonight
    renderResults();
    $("shared-note").hidden = false;
    if (announce) announceResults("Shared team");
    revealResults();
  } else {
    // recognized share link, but it references heroes/roles that no longer exist
    $("stale-link-note").hidden = false;
  }
}

// ── Spin ─────────────────────────────────────────────────────

async function spin() {
  if (state.spinning || !spinFeasible()) return;

  const roles = drawAssignment();
  if (!roles) { updateSpinState(); return; }

  state.golden = Math.random() < GOLDEN_CHANCE;

  // Draw a unique hero for each assigned role.
  const taken = new Set();
  const takenDares = new Set();
  const tonight = state.noRepeatTonight ? playedTonight() : {};
  const results = state.players.map((_, i) => {
    const role = roles[i];
    const label = playerLabel(i);
    const options = availableHeroes(role).filter(h => !taken.has(h.name));
    // skip everything this player already played tonight, then last spin's hero;
    // fall back a tier whenever a filter would empty the pool
    const noTonight = options.filter(h => !tonight[label]?.has(h.name));
    const pool = noTonight.length ? noTonight : options;
    const fresh = pool.filter(h => h.name !== lastSpinHeroes[label]);
    const hero = pick(fresh.length ? fresh : pool);
    taken.add(hero.name);
    const result = { player: label, role, hero: hero.name };
    rollPerks(result);
    rollChallenge(result, takenDares);
    if (result.challenge) takenDares.add(result.challenge);
    return result;
  });

  // Display sorted Tank → Damage → Support.
  results.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  // a golden spin crowns one WILD: that player may swap to any hero of their role
  if (state.golden) results[Math.floor(Math.random() * results.length)].wild = true;
  state.results = results;
  lastSpinHeroes = Object.fromEntries(results.map(r => [r.player, r.hero]));
  state.sessionLog.push({
    t: Date.now(),
    deals: results.map(({ player, role, hero }) => ({ player, role, hero })),
  });
  state.sessionLog = state.sessionLog.slice(-TONIGHT_MAX);
  currentLogEntry = state.sessionLog[state.sessionLog.length - 1];
  saveState();
  rollTeamChallenge();
  $("shared-note").hidden = true; // it's your own team now
  $("stale-link-note").hidden = true;
  if (/^#team=/.test(location.hash)) {
    // drop the stale shared-team hash so the address bar matches what's shown
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* file:// quirks */ }
  }

  if (state.instant || REDUCED_MOTION.matches) {
    renderResults();
    renderTonight();
    revealResults();
    announceResults(state.golden ? "Golden spin! Team rolled" : "Team rolled");
    return;
  }

  // Slot-machine animation: all cards cycle, then lock in one by one.
  state.spinning = true;
  updateSpinState();
  resultsGrid.innerHTML = "";
  shareRow.hidden = false;
  emptyNote.hidden = true;
  renderTeamChallenge(); // hide any old team dare while the reels run
  revealResults();

  const cards = results.map((result, i) => {
    const card = buildCard(result, i);
    card.classList.add("spinning");
    card.querySelector(".reroll-btn").disabled = true;
    resultsGrid.append(card);
    return card;
  });

  const setCardRole = (card, role) => {
    ROLE_ORDER.forEach(r => card.classList.remove(r));
    card.classList.add(role);
    card.querySelector(".result-role").innerHTML = `${ROLE_ICONS[role]} ${ROLE_LABEL[role]}`;
  };

  // Both reels spin: role flickers through all three, hero cycles the full roster.
  const timers = cards.map((card, i) => {
    const heroEl = card.querySelector(".result-hero");
    let rIdx = i % ROLE_ORDER.length;
    return {
      role: setInterval(() => {
        rIdx = (rIdx + 1) % ROLE_ORDER.length;
        setCardRole(card, ROLE_ORDER[rIdx]);
      }, 110),
      hero: setInterval(() => { heroEl.textContent = pick(HEROES).name; }, 65),
    };
  });

  const ticker = setInterval(sfx.tick, 90);

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const result = results[i];
    const heroEl = card.querySelector(".result-hero");

    // Stage 1: lock the role reel (golden spins draw out the suspense).
    await delay((i === 0 ? 900 : 500) * (state.golden ? 1.6 : 1));
    clearInterval(timers[i].role);
    setCardRole(card, result.role);
    card.classList.add("role-locked");
    sfx.roleLock();

    // Hero reel narrows to the locked role's heroes.
    clearInterval(timers[i].hero);
    const pool = HEROES.filter(h => h.role === result.role);
    timers[i].hero = setInterval(() => { heroEl.textContent = pick(pool).name; }, 65);

    // Stage 2: lock the hero reel.
    await delay(550 * (state.golden ? 1.6 : 1));
    clearInterval(timers[i].hero);
    card.classList.remove("spinning");
    card.classList.add("locked");
    heroEl.textContent = result.hero;
    sfx.heroLock(i);
  }

  clearInterval(ticker);
  state.spinning = false;
  updateSpinState();
  renderTeamChallenge(); // the team dare lands with the fanfare
  renderTonight(); // and only now does the log show it — no reading ahead of the reels
  // rerolls unlock only once the whole team is revealed
  cards.forEach(c => { c.querySelector(".reroll-btn").disabled = false; });
  state.golden ? sfx.jackpot() : sfx.fanfare();
  announceResults(state.golden ? "Golden spin! Team rolled" : "Team rolled");
}

async function rerollHero(result, card, heroEl) {
  if (state.spinning || !state.rerolls) return;

  const taken = new Set(state.results.map(r => r.hero));
  let options = availableHeroes(result.role).filter(h => !taken.has(h.name));
  // the no-repeats-tonight promise holds through rerolls too (with the same fallback)
  if (state.noRepeatTonight) {
    const played = playedTonight()[result.player];
    const fresh = options.filter(h => !played?.has(h.name));
    if (fresh.length) options = fresh;
  }

  if (options.length === 0) {
    card.classList.remove("shake");
    void card.offsetWidth; // restart animation
    card.classList.add("shake");
    return;
  }

  let newHero = pick(options).name;

  if (!state.instant && !REDUCED_MOTION.matches) {
    state.spinning = true;
    updateSpinState();
    card.classList.remove("locked");
    card.classList.add("role-locked", "spinning"); // role stays locked; only the hero reel spins
    const pool = HEROES.filter(h => h.role === result.role);
    const interval = setInterval(() => { heroEl.textContent = pick(pool).name; }, 65);
    const ticker = setInterval(sfx.tick, 90);
    await delay(600);
    clearInterval(interval);
    clearInterval(ticker);
    state.spinning = false;
    updateSpinState();

    // the pool may have changed during the animation (bans clicked mid-reroll)
    const takenNow = new Set(state.results.filter(r => r !== result).map(r => r.hero));
    if (state.banned.has(newHero) || takenNow.has(newHero)) {
      const fresh = availableHeroes(result.role).filter(h => !takenNow.has(h.name));
      newHero = fresh.length ? pick(fresh).name : result.hero; // nothing left — keep the old hero
    }
  }

  result.hero = newHero;
  // continuity applies only to our own spins — a shared board isn't our history
  if (currentLogEntry) {
    lastSpinHeroes[result.player] = newHero; // next spin avoids the hero they kept
    const deal = currentLogEntry.deals.find(d => d.player === result.player);
    if (deal) { deal.hero = newHero; saveState(); renderTonight(); }
  }
  rollPerks(result);
  // rejecting fate has a price: a punishment dare, dares toggle or not
  const takenDares = new Set(state.results.map(r => r.challenge).filter(Boolean));
  rollPunishment(result, takenDares);
  card.classList.remove("spinning");
  void card.offsetWidth;
  card.classList.add("locked");
  setCardHeroColor(card, newHero);
  setCardPortrait(card, newHero);
  setCardPerks(card, result);
  setCardChallenge(card, result);
  heroEl.textContent = newHero;
  sfx.heroLock(0);
  announceResults("Rerolled");
}

// ── Events ───────────────────────────────────────────────────

modeToggle.addEventListener("click", e => {
  const btn = e.target.closest(".seg-btn");
  if (!btn || btn.dataset.mode === state.mode || state.spinning) return;
  state.mode = btn.dataset.mode;
  const size = teamSize();
  if (state.players.length > size) {
    // bench the overflow instead of deleting it — switching back restores the squad
    state.benched = state.players.slice(size)
      .map((name, k) => ({ name, bans: state.playerBans[size + k] || [] }))
      .concat(state.benched);
    state.players.length = size;
    state.playerBans.length = size;
  } else {
    while (state.players.length < size && state.benched.length) {
      const b = state.benched.shift();
      state.players.push(b.name);
      state.playerBans.push(b.bans);
    }
  }
  saveState();
  renderMode();
  renderPlayers();
  updateSpinState();
});

instantToggle.addEventListener("change", () => {
  state.instant = instantToggle.checked;
  saveState();
});

const rerollToggle = $("reroll-toggle");
rerollToggle.addEventListener("change", () => {
  state.rerolls = rerollToggle.checked;
  saveState();
  if (state.results) renderResults(); // show/hide the ↻ buttons
});

const moreControls = $("more-controls");
moreControls.addEventListener("click", () => {
  const sec = $("controls-secondary");
  sec.hidden = !sec.hidden;
  moreControls.setAttribute("aria-expanded", String(!sec.hidden));
});

// The board-rewriting toggles are disabled while a spin animation runs
// (updateSpinState), so these handlers never race the reels.
const portraitToggle = $("portrait-toggle");
portraitToggle.addEventListener("change", () => {
  state.portraits = portraitToggle.checked;
  saveState();
  if (state.results) renderResults();
});

const perkToggle = $("perk-toggle");
perkToggle.addEventListener("change", () => {
  state.perks = perkToggle.checked;
  saveState();
  if (state.results) {
    state.results.forEach(rollPerks); // rolls fresh picks, or clears them when off
    renderResults();
  }
});

const challengeToggle = $("challenge-toggle");
challengeToggle.addEventListener("change", () => {
  state.challenges = challengeToggle.checked;
  saveState();
  renderDares(); // the house-dares nudge tracks the toggle
  if (state.results) {
    rerollAllChallenges(); // rolls fresh dares, or clears them when off
    renderResults();
    announceResults(state.challenges ? "Dares dealt" : "Dares cleared");
  }
});

// ── House dares ──────────────────────────────────────────────

const dareTarget = $("dare-target");
const dareHero = $("dare-hero");
const dareText = $("dare-text");

const DARE_PLACEHOLDERS = {
  player: "e.g. Do a full spin before every ult…",
  tank: "e.g. Apologize every time your shield breaks…",
  damage: "e.g. Call your shots before you take them…",
  support: "e.g. Heal whoever asks nicest first…",
  team: "e.g. Everyone leaves spawn in single file…",
  hero: name => `e.g. Only speak in ${name}'s voice all match…`,
};

// the effective target: the hero picker's value when "A specific hero…" is chosen
const currentDareTarget = () => dareTarget.value === "hero" ? dareHero.value : dareTarget.value;

function refreshDareForm() {
  dareHero.hidden = dareTarget.value !== "hero";
  dareText.placeholder = dareTarget.value === "hero"
    ? DARE_PLACEHOLDERS.hero(dareHero.value)
    : DARE_PLACEHOLDERS[dareTarget.value];
}

dareTarget.addEventListener("change", refreshDareForm);
dareHero.addEventListener("change", refreshDareForm);

$("dare-form").addEventListener("submit", e => {
  e.preventDefault();
  const text = dareText.value.trim().slice(0, MAX_DARE_LEN);
  const target = currentDareTarget();
  const dupe = state.customDares.some(
    d => d.target === target && d.text.toLowerCase() === text.toLowerCase());
  if (!text || dupe || state.customDares.length >= MAX_CUSTOM_DARES) {
    dareText.classList.remove("shake");
    void dareText.offsetWidth; // restart animation
    dareText.classList.add("shake");
    return;
  }
  state.customDares.push({ text, target });
  saveState();
  renderDares();
  dareText.value = "";
  dareText.focus();
  sfx.heroLock(2); // little "added to the deck" blip
});

$("dares-enable").addEventListener("click", () => {
  challengeToggle.checked = true;
  challengeToggle.dispatchEvent(new Event("change")); // runs the real handler, pendingToggle and all
});

const soundToggle = $("sound-toggle");
soundToggle.addEventListener("change", () => {
  state.sound = soundToggle.checked;
  saveState();
});

addPlayerBtn.addEventListener("click", () => {
  if (state.spinning || state.players.length >= teamSize()) return;
  state.players.push("");
  state.playerBans.push([]);
  saveState();
  renderPlayers();
  updateSpinState();
});

$("enable-all").addEventListener("click", () => {
  state.banned.clear();
  saveState();
  renderPool();
  updateSpinState();
});

spinBtn.addEventListener("click", spin);

$("share-link").addEventListener("click", async e => {
  if (!state.results || state.spinning) return;
  const btn = e.currentTarget; // capture before any await — currentTarget is null after dispatch
  if (btn.disabled) return;
  btn.disabled = true;
  const url = shareUrl();
  // native share sheet on mobile, clipboard elsewhere
  if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ title: "Overwatch Slots", url });
      btn.disabled = false;
      return;
    } catch { /* cancelled or unsupported — fall through to copy */ }
  }
  flashButton(btn, await copyToClipboard(url));
});

$("copy-text").addEventListener("click", async e => {
  if (!state.results || state.spinning) return;
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  flashButton(btn, await copyToClipboard(resultsAsText()));
});

$("copy-image").addEventListener("click", async e => {
  if (!state.results || state.spinning) return;
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const canvas = teamImage();
    // hand ClipboardItem the promise synchronously — Safari refuses writes that
    // start after an await has consumed the click's transient activation
    const blobPromise = new Promise(res => canvas.toBlob(res, "image/png"));
    let copied = false;
    if (navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
        copied = true;
      } catch { /* refused (permissions, focus) — fall through to the download */ }
    }
    if (!copied) {
      const blob = await blobPromise;
      if (!blob) throw new Error("no blob");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "overwatch-slots-team.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    flashButton(btn, true);
  } catch {
    flashButton(btn, false);
  }
});

$("share-setup").addEventListener("click", async e => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  flashButton(btn, await copyToClipboard(siteBase() + "#setup=" + encodeSetup()));
});

$("norepeat-toggle").addEventListener("change", e => {
  state.noRepeatTonight = e.currentTarget.checked;
  saveState();
});

$("tonight-clear").addEventListener("click", () => {
  state.sessionLog = [];
  currentLogEntry = null;
  saveState();
  renderTonight();
});

window.addEventListener("hashchange", () => applySharedHash());

// ── About modal ──────────────────────────────────────────────

const aboutModal = $("about-modal");
$("about-link").addEventListener("click", () => aboutModal.showModal());
$("about-top").addEventListener("click", () => aboutModal.showModal());
$("about-close").addEventListener("click", () => aboutModal.close());
// only backdrop clicks target the dialog element itself — content clicks hit .about-body.
// the press must START on the backdrop too, or a text-selection drag that ends out
// there would close the dialog (click fires on the common ancestor of down+up targets)
let aboutPressedBackdrop = false;
aboutModal.addEventListener("pointerdown", e => { aboutPressedBackdrop = e.target === aboutModal; });
aboutModal.addEventListener("click", e => {
  if (e.target === aboutModal && aboutPressedBackdrop) aboutModal.close();
});

// ── Init ─────────────────────────────────────────────────────

// Surface roster/perk data drift for whoever edits heroes.js by hand.
if (typeof PERKS !== "undefined") {
  for (const h of HEROES) {
    if (!PERKS[h.name]) console.warn(`Overwatch Slots: no perks found for "${h.name}" — perks won't roll for them (check perks.js).`);
  }
  for (const name of Object.keys(PERKS)) {
    if (!HEROES.some(h => h.name === name)) console.warn(`Overwatch Slots: perks.js lists unknown hero "${name}" (check heroes.js).`);
  }
}
if (typeof CHALLENGES !== "undefined") {
  for (const name of Object.keys(CHALLENGES.hero || {})) {
    if (!HEROES.some(h => h.name === name)) console.warn(`Overwatch Slots: challenges.js lists unknown hero "${name}" (check heroes.js).`);
  }
}

loadState();
instantToggle.checked = state.instant;
portraitToggle.checked = state.portraits;
perkToggle.checked = state.perks;
challengeToggle.checked = state.challenges;
soundToggle.checked = state.sound;
rerollToggle.checked = state.rerolls;
$("norepeat-toggle").checked = state.noRepeatTonight;

// the hero pool remembers whether you left it open
const poolDetails = $("pool-details");
poolDetails.open = state.poolOpen;
poolDetails.addEventListener("toggle", () => {
  state.poolOpen = poolDetails.open;
  saveState();
});

// house dares: hero picker grouped by role, and the panel remembers its open state
for (const role of ROLE_ORDER) {
  const group = document.createElement("optgroup");
  group.label = ROLE_LABEL[role];
  for (const hero of HEROES.filter(h => h.role === role)) {
    const opt = document.createElement("option");
    opt.value = hero.name;
    opt.textContent = hero.name;
    group.append(opt);
  }
  dareHero.append(group);
}
refreshDareForm();

const daresDetails = $("dares-details");
daresDetails.open = state.daresOpen;
daresDetails.addEventListener("toggle", () => {
  state.daresOpen = daresDetails.open;
  saveState();
});

renderMode();
renderPlayers();
renderPool();
renderDares();
renderTonight();
renderResults(); // shows the empty "pull the lever" state until the first spin
updateSpinState();
applySharedHash(false); // arriving via a share link? show that exact team
