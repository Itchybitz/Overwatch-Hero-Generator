# 🎰 Overwatch Slots

**Spin the wheel. Play what fate gives you.**

A fan-made team roulette for Overwatch — enter your group's names, hit **SPIN**, and every player gets a random role and hero dealt slot-machine style, always in a legal team comp.

**▶ Play it here:**

## What it does

* 🎲 **Random roles + heroes** — each spin deals roles that fit the team composition, then a unique hero for every player (no duplicates)
* ⚔️ **5v5 and 6v6 modes** — 1‑2‑2 or 2‑2‑2 comps
* 👥 **Any group size** — solo up to a full team; smaller groups draw a random subset of the comp's role slots, so 3 players can never end up with 2 tanks in 5v5
* 🃏 **Perk picker** — each hero also rolls a random minor and major perk (hover a perk for what it does)
* 🚫 **Hero bans** — click heroes in the pool to ban them from the wheel
* 🙅 **Per-player role exclusions** — cross out a role on a player's row ("I don't tank") and they'll never roll it, while the comp stays legal for everyone else
* 🖼️ **Hero portraits** — official portrait art on the result cards (toggleable)
* 🎰 **Two-stage slot animation** — the role reel slams in first, then the hero reel locks with a flash; there's an instant-results toggle for the impatient
* 🔄 **Per-player rerolls** — hate your pull? Reroll just your hero without touching the rest of the team
* 📣 **Share your spin** — copy a link that replays the exact team for anyone who opens it, or copy a Discord-ready text summary
* 🔊 **Slot-machine sound** — synthesized reel ticks, role clunks, and a jackpot sting (toggleable)
* ♿ **Accessible** — keyboard and screen-reader friendly, honors reduced-motion preferences, comfy touch targets on phones
* 💾 **Remembers your setup** — names, bans, exclusions, and toggles are saved in your browser

## Running it yourself

It's a plain static site — no build step, no dependencies. Clone the repo and open `index.html` in a browser, or serve the folder with any static file server:

```bash
npx serve .
```

## Updating the roster

The full hero list lives in [`heroes.js`](heroes.js). When a new hero drops, add one line:

```js
{ name: "Hero Name", role: "tank" | "damage" | "support", color: "#hex", img: "portrait-url" },
```

`color` (signature color for the hero's name on cards) and `img` (portrait URL) are optional — cards fall back to role colors and a text-only look.

## Credits

Overwatch, all hero names, and portrait artwork are © Blizzard Entertainment — this is an unofficial fan project, not affiliated with or endorsed by Blizzard. Portrait images load from Blizzard's public CDN via URLs catalogued by [OverFast API](https://overfast-api.tekrop.fr/).

