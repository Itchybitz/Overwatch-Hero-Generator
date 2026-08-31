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
  poolOpen: false,
  daresOpen: false,
  results: null, // [{ player, role, hero, perkMinor?, perkMajor?, challenge? }]
  teamChallenge: null, // team-wide dare for the current results
  spinning: false,
};

// The last spin's player → hero deal; a repeat feels rigged even when it's fair.
let lastSpinHeroes = {};

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
  portraitToggle.disabled = perkToggle.disabled = challengeToggle.disabled = state.spinning;
  $("share-link").disabled = $("copy-text").disabled = state.spinning || !state.results;
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
  const fresh = base.filter(c => !exclude.has(c));
  const pool = fresh.length ? fresh : base;
  if (!pool.length) { delete result.challenge; return; }
  result.challenge = pick(pool);
}

// A team-wide dare hits on roughly a quarter of spins — jackpot rules.
function rollTeamChallenge() {
  const custom = customDaresFor("team");
  const pool = [
    ...(typeof CHALLENGES !== "undefined" ? CHALLENGES.team || [] : []),
    ...custom,
  ];
  state.teamChallenge =
    state.challenges && (state.results?.length || 0) > 1 && pool.length && Math.random() < 0.25
      ? (custom.length && Math.random() < 0.5 ? pick(custom) : pick(pool))
      : null;
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
  chip.className = "challenge-chip" + (custom ? " custom" : "");
  if (custom) chip.title = "One of your own house dares";
  const tag = document.createElement("span");
  tag.className = "perk-tag";
  tag.textContent = custom ? "🏠 house" : "🎲 dare";
  const text = document.createElement("span");
  text.className = "challenge-text";
  text.textContent = result.challenge;
  chip.append(tag, text);
  row.append(chip);
  card.append(row);
}

// Show/hide the team-wide dare banner (kept hidden while reels spin).
function renderTeamChallenge() {
  $("team-challenge").hidden = !state.teamChallenge || !state.results || state.spinning;
  if (state.teamChallenge) {
    $("team-challenge-text").textContent = state.teamChallenge;
    $("team-challenge-label").textContent =
      isCustomDare(state.teamChallenge) ? "🏠 House rule" : "💥 Team dare";
  }
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
  card.className = `result-card ${result.role}`;
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
  reroll.title = "Reroll this hero";
  reroll.setAttribute("aria-label", `Reroll hero for ${result.player}`);
  reroll.addEventListener("click", () => rerollHero(result, card, heroEl));

  card.append(watermarkSvg, roleEl, playerEl, reel, reroll);
  setCardPortrait(card, result.hero);
  setCardPerks(card, result);
  setCardChallenge(card, result);
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
    .map(r => `${r.player}: ${ROLE_LABEL[r.role]}, ${r.hero}` + (r.challenge ? `, dare: ${r.challenge}` : ""))
    .join(". ")
    + (state.teamChallenge ? `. Team dare: ${state.teamChallenge}` : "");
}

// ── Sharing ──────────────────────────────────────────────────

const ROLE_EMOJI = { tank: "🛡️", damage: "⚔️", support: "💚" };
const ROLE_FROM_CHAR = { t: "tank", d: "damage", s: "support" };

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
  ]);
  // plain rows unless a team dare needs carrying — keeps old-format links symmetrical
  const json = JSON.stringify(state.teamChallenge ? { r: rows, t: state.teamChallenge } : rows);
  const bytes = new TextEncoder().encode(json);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Accepts both the current name-based perk encoding and legacy index-based links.
function findPerk(list, key) {
  if (typeof key === "string") return list.find(x => x.name === key) || null;
  if (Number.isInteger(key) && key >= 0) return list[key] || null;
  return null;
}

function decodeSharedTeam(encoded) {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
    // legacy links are a bare rows array; newer ones wrap it to carry the team dare
    const rows = Array.isArray(parsed) ? parsed : parsed.r;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 6) return null;
    const results = rows.map(([player, roleChar, hero, mi, ma, dare]) => {
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
      }
      return result;
    });
    const team = !Array.isArray(parsed)
      && typeof parsed.t === "string"
      && parsed.t.trim()
      && results.length > 1
      ? parsed.t.trim().slice(0, MAX_DARE_LEN) : null;
    return { results, team };
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
    const dare = r.challenge ? `\n   ${isCustomDare(r.challenge) ? "🏠" : "🎲"} ${r.challenge}` : "";
    return `${ROLE_EMOJI[r.role]} ${r.player} → ${r.hero}${perks}${dare}`;
  });
  const team = state.teamChallenge
    ? `\n${isCustomDare(state.teamChallenge) ? "🏠 House rule" : "💥 Team dare"}: ${state.teamChallenge}`
    : "";
  return `🎰 OVERWATCH SLOTS — ${MODE_LABEL[state.mode] || state.mode}\n${lines.join("\n")}${team}\nSpin your own: ${shareUrl()}`;
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
  setTimeout(() => { btn.textContent = original; btn.disabled = state.spinning || !state.results; }, 1400);
}

// Load (or clear) a shared team from the current #team= hash.
function applySharedHash(announce = true) {
  $("stale-link-note").hidden = true;
  const m = location.hash.match(/^#team=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  const shared = decodeSharedTeam(m[1]);
  if (shared) {
    state.results = shared.results;
    state.teamChallenge = shared.team;
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

  // Draw a unique hero for each assigned role.
  const taken = new Set();
  const takenDares = new Set();
  const results = state.players.map((_, i) => {
    const role = roles[i];
    const label = playerLabel(i);
    const options = availableHeroes(role).filter(h => !taken.has(h.name));
    // skip whoever this player rolled last spin, as long as an alternative exists
    const fresh = options.filter(h => h.name !== lastSpinHeroes[label]);
    const hero = pick(fresh.length ? fresh : options);
    taken.add(hero.name);
    const result = { player: label, role, hero: hero.name };
    rollPerks(result);
    rollChallenge(result, takenDares);
    if (result.challenge) takenDares.add(result.challenge);
    return result;
  });

  // Display sorted Tank → Damage → Support.
  results.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  state.results = results;
  lastSpinHeroes = Object.fromEntries(results.map(r => [r.player, r.hero]));
  rollTeamChallenge();
  $("shared-note").hidden = true; // it's your own team now
  $("stale-link-note").hidden = true;
  if (/^#team=/.test(location.hash)) {
    // drop the stale shared-team hash so the address bar matches what's shown
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* file:// quirks */ }
  }

  if (state.instant || REDUCED_MOTION.matches) {
    renderResults();
    revealResults();
    announceResults();
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

    // Stage 1: lock the role reel.
    await delay(i === 0 ? 900 : 500);
    clearInterval(timers[i].role);
    setCardRole(card, result.role);
    card.classList.add("role-locked");
    sfx.roleLock();

    // Hero reel narrows to the locked role's heroes.
    clearInterval(timers[i].hero);
    const pool = HEROES.filter(h => h.role === result.role);
    timers[i].hero = setInterval(() => { heroEl.textContent = pick(pool).name; }, 65);

    // Stage 2: lock the hero reel.
    await delay(550);
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
  // rerolls unlock only once the whole team is revealed
  cards.forEach(c => { c.querySelector(".reroll-btn").disabled = false; });
  sfx.fanfare();
  announceResults();
}

async function rerollHero(result, card, heroEl) {
  if (state.spinning) return;

  const taken = new Set(state.results.map(r => r.hero));
  const options = availableHeroes(result.role).filter(h => !taken.has(h.name));

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
  lastSpinHeroes[result.player] = newHero; // next spin avoids the hero they kept
  rollPerks(result);
  // a fresh dare too — excluding everyone's current ones so it visibly changes
  const takenDares = new Set(state.results.map(r => r.challenge).filter(Boolean));
  rollChallenge(result, takenDares);
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

window.addEventListener("hashchange", () => applySharedHash());

// ── About modal ──────────────────────────────────────────────

const aboutModal = $("about-modal");
$("about-link").addEventListener("click", () => aboutModal.showModal());
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
renderResults(); // shows the empty "pull the lever" state until the first spin
updateSpinState();
applySharedHash(false); // arriving via a share link? show that exact team
