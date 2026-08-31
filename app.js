// ── Overwatch Slots — app logic ──────────────────────────────

const COMPS = {
  "5v5": { tank: 1, damage: 2, support: 2 },
  "6v6": { tank: 2, damage: 2, support: 2 },
};

const ROLE_ORDER = ["tank", "damage", "support"];
const ROLE_LABEL = { tank: "Tank", damage: "Damage", support: "Support" };

const ROLE_ICONS = {
  tank: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3z"/></svg>',
  damage: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M7 2h3v14H7zM10.5 2h3v14h-3zM14 2h3v14h-3zM7 17.5h10L12 23l-5-5.5z"/></svg>',
  support: '<svg class="role-icon" viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2z"/></svg>',
};

const STORAGE_KEY = "ow-slots-v1";

const ROLE_CSS_COLOR = { tank: "#5aa8f0", damage: "#f0655a", support: "#5ee39a" };
const heroColor = name =>
  HEROES.find(h => h.name === name)?.color ||
  ROLE_CSS_COLOR[HEROES.find(h => h.name === name)?.role] || "#eef2f9";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  mode: "5v5",
  players: ["", "", "", "", ""],
  playerBans: [[], [], [], [], []], // per-player excluded roles, aligned with players
  banned: new Set(),
  instant: false,
  portraits: true,
  perks: true,
  sound: true,
  poolOpen: false,
  results: null, // [{ player, role, hero, perkMinor?, perkMajor? }]
  spinning: false,
};

// Settings flipped while an animation runs get applied when it finishes.
const pendingToggle = { portraits: false, perks: false };

// ── Persistence ──────────────────────────────────────────────

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      players: state.players,
      playerBans: state.playerBans,
      banned: [...state.banned],
      instant: state.instant,
      portraits: state.portraits,
      perks: state.perks,
      sound: state.sound,
      poolOpen: state.poolOpen,
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
    if (Array.isArray(saved.banned)) {
      const names = new Set(HEROES.map(h => h.name));
      state.banned = new Set(saved.banned.filter(n => names.has(n)));
    }
    state.instant = !!saved.instant;
    state.portraits = saved.portraits !== false; // default on
    state.perks = saved.perks !== false; // default on
    state.sound = saved.sound !== false; // default on
    state.poolOpen = !!saved.poolOpen;
  } catch { /* corrupted storage — start fresh */ }
}

// ── Helpers ──────────────────────────────────────────────────

const teamSize = () => Object.values(COMPS[state.mode]).reduce((a, b) => a + b, 0);

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
        renderPlayers();
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
        if (state.banned.has(hero.name)) state.banned.delete(hero.name);
        else state.banned.add(hero.name);
        saveState();
        renderPool();
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

function updateSpinState() {
  const problem = spinProblem();
  spinBtn.disabled = state.spinning || !!problem;
  spinWarning.hidden = !problem;
  if (problem) spinWarning.textContent = problem;
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
  if (!hasResults) return;
  state.results.forEach((result, i) => resultsGrid.append(buildCard(result, i)));
}

// Announce the finished team to screen readers.
function announceResults(prefix = "Team rolled") {
  if (!state.results) return;
  $("sr-results").textContent = `${prefix}: ` + state.results
    .map(r => `${r.player}: ${ROLE_LABEL[r.role]}, ${r.hero}`)
    .join(". ");
}

// Apply Portraits/Perks toggles that were flipped mid-animation.
function applyPendingToggles() {
  if (!pendingToggle.portraits && !pendingToggle.perks) return;
  if (pendingToggle.perks && state.results) state.results.forEach(rollPerks);
  pendingToggle.portraits = pendingToggle.perks = false;
  renderResults();
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
  ]);
  const json = JSON.stringify(rows);
  return btoa(unescape(encodeURIComponent(json)))
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
    const rows = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 6) return null;
    return rows.map(([player, roleChar, hero, mi, ma]) => {
      const role = ROLE_FROM_CHAR[roleChar];
      if (!role || !HEROES.some(h => h.name === hero && h.role === role)) throw new Error("bad hero");
      const result = { player: String(player).slice(0, 24) || "Player", role, hero };
      const p = typeof PERKS !== "undefined" ? PERKS[hero] : null;
      if (p) {
        const minor = findPerk(p.minor, mi);
        const major = findPerk(p.major, ma);
        if (minor) result.perkMinor = minor;
        if (major) result.perkMajor = major;
      }
      return result;
    });
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
    const perks = r.perkMinor ? ` (${r.perkMinor.name} / ${r.perkMajor.name})` : "";
    return `${ROLE_EMOJI[r.role]} ${r.player} → ${r.hero}${perks}`;
  });
  return `🎰 OVERWATCH SLOTS — ${state.mode}\n${lines.join("\n")}\nSpin your own: ${shareUrl()}`;
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
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
}

// Load (or clear) a shared team from the current #team= hash.
function applySharedHash(announce = true) {
  $("stale-link-note").hidden = true;
  const m = location.hash.match(/^#team=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  const shared = decodeSharedTeam(m[1]);
  if (shared) {
    state.results = shared;
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
  const results = state.players.map((_, i) => {
    const role = roles[i];
    const hero = pick(availableHeroes(role).filter(h => !taken.has(h.name)));
    taken.add(hero.name);
    const result = { player: playerLabel(i), role, hero: hero.name };
    rollPerks(result);
    return result;
  });

  // Display sorted Tank → Damage → Support.
  results.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  state.results = results;
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
  // rerolls unlock only once the whole team is revealed
  cards.forEach(c => { c.querySelector(".reroll-btn").disabled = false; });
  applyPendingToggles();
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
  rollPerks(result);
  card.classList.remove("spinning");
  void card.offsetWidth;
  card.classList.add("locked");
  setCardHeroColor(card, newHero);
  setCardPortrait(card, newHero);
  setCardPerks(card, result);
  heroEl.textContent = newHero;
  sfx.heroLock(0);
  announceResults("Rerolled");
  applyPendingToggles();
}

// ── Events ───────────────────────────────────────────────────

modeToggle.addEventListener("click", e => {
  const btn = e.target.closest(".seg-btn");
  if (!btn || btn.dataset.mode === state.mode || state.spinning) return;
  state.mode = btn.dataset.mode;
  const size = teamSize();
  if (state.players.length > size) {
    state.players.length = size;
    state.playerBans.length = size;
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

const portraitToggle = $("portrait-toggle");
portraitToggle.addEventListener("change", () => {
  state.portraits = portraitToggle.checked;
  saveState();
  if (state.spinning) pendingToggle.portraits = true; // applied when the animation ends
  else if (state.results) renderResults();
});

const perkToggle = $("perk-toggle");
perkToggle.addEventListener("change", () => {
  state.perks = perkToggle.checked;
  saveState();
  if (state.spinning) {
    pendingToggle.perks = true; // applied when the animation ends
  } else if (state.results) {
    state.results.forEach(rollPerks); // rolls fresh picks, or clears them when off
    renderResults();
  }
});

const soundToggle = $("sound-toggle");
soundToggle.addEventListener("change", () => {
  state.sound = soundToggle.checked;
  saveState();
});

addPlayerBtn.addEventListener("click", () => {
  if (state.players.length >= teamSize()) return;
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

loadState();
instantToggle.checked = state.instant;
portraitToggle.checked = state.portraits;
perkToggle.checked = state.perks;
soundToggle.checked = state.sound;

// the hero pool remembers whether you left it open
const poolDetails = $("pool-details");
poolDetails.open = state.poolOpen;
poolDetails.addEventListener("toggle", () => {
  state.poolOpen = poolDetails.open;
  saveState();
});

renderMode();
renderPlayers();
renderPool();
renderResults(); // shows the empty "pull the lever" state until the first spin
updateSpinState();
applySharedHash(false); // arriving via a share link? show that exact team
