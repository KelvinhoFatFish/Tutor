# RIVALS

A 4v4 hero-based arena shooter for Roblox: four rival classes, one ultimate each,
sliding and wall-running, a 7-round match, and a cyberpunk arena called **Neon
Heights** that is generated entirely from code.

No external assets. No meshes, no textures, no uploaded sounds beyond stock
Roblox audio IDs. Every wall, every gun, every particle, every UI element is built
at runtime by the scripts in this repo, so nothing can break from a missing asset
or get taken down by moderation.

| | |
|---|---|
| **Players** | 4v4 (configurable to 5v5) |
| **Match** | First to 7 round wins, sides swap at 4 |
| **Round** | 20s buy phase + 90s action |
| **Heroes** | Rusher, Tank, Sniper, Support |
| **Arsenal** | 8 weapons + armor, grenades, stim |
| **Design doc** | [DESIGN.md](DESIGN.md) |

---

## Install

### Option A — Rojo (recommended)

```bash
cd rivals
rojo serve
```

Then in Roblox Studio: install the Rojo plugin, open a **Baseplate**, connect, and
sync. `default.project.json` places everything:

```
ReplicatedStorage/Shared        <- src/shared   (Config, Weapons, Heroes, Net, Util)
ServerScriptService/Server      <- src/server   (GameServer + modules)
StarterPlayer/StarterPlayerScripts/Client <- src/client
```

### Option B — manual, no tooling

No Rojo? Build the tree by hand. **The script *type* matters**, so follow the
`Script` / `ModuleScript` / `LocalScript` column exactly.

| File | Type | Parent in Explorer |
|---|---|---|
| [`Config.luau`](src/shared/Config.luau) | ModuleScript | `ReplicatedStorage/Shared` |
| [`Util.luau`](src/shared/Util.luau) | ModuleScript | `ReplicatedStorage/Shared` |
| [`Weapons.luau`](src/shared/Weapons.luau) | ModuleScript | `ReplicatedStorage/Shared` |
| [`Heroes.luau`](src/shared/Heroes.luau) | ModuleScript | `ReplicatedStorage/Shared` |
| [`Net.luau`](src/shared/Net.luau) | ModuleScript | `ReplicatedStorage/Shared` |
| [`GameServer.luau`](src/server/GameServer.luau) | **Script** | `ServerScriptService/Server` |
| [`ArenaBuilder.luau`](src/server/ArenaBuilder.luau) | ModuleScript | `ServerScriptService/Server` |
| [`Match.luau`](src/server/Match.luau) | ModuleScript | `ServerScriptService/Server` |
| [`WeaponServer.luau`](src/server/WeaponServer.luau) | ModuleScript | `ServerScriptService/Server` |
| [`HeroServer.luau`](src/server/HeroServer.luau) | ModuleScript | `ServerScriptService/Server` |
| [`ShopServer.luau`](src/server/ShopServer.luau) | ModuleScript | `ServerScriptService/Server` |
| [`MoveClient.luau`](src/client/MoveClient.luau) | **LocalScript** | `StarterPlayer/StarterPlayerScripts/Client` |
| [`InputClient.luau`](src/client/InputClient.luau) | **LocalScript** | `StarterPlayer/StarterPlayerScripts/Client` |
| [`FxClient.luau`](src/client/FxClient.luau) | **LocalScript** | `StarterPlayer/StarterPlayerScripts/Client` |
| [`HudClient.luau`](src/client/HudClient.luau) | **LocalScript** | `StarterPlayer/StarterPlayerScripts/Client` |
| [`LeaderboardClient.luau`](src/client/LeaderboardClient.luau) | **LocalScript** | `StarterPlayer/StarterPlayerScripts/Client` |

Name the parent folders exactly `Shared`, `Server` and `Client`: the modules
require each other by name.

Then set these on the services (Rojo does it for you, but manual installs need it):

| Service | Property | Value | Why |
|---|---|---|---|
| `Players` | `CharacterAutoLoads` | `false` | The match decides when you spawn |
| `Players` | `RespawnTime` | `3600` | No engine auto-respawn mid-round |
| `Lighting` | `Technology` | `Future` or `ShadowMap` | Neon reads correctly |
| `Lighting` | `Ambient` | very dark | The arena lights itself |

**Delete the baseplate.** `ArenaBuilder` builds its own floor; a baseplate under
Neon Heights will block the low flank tunnels.

### Playing solo to test

`Config.Match.MinPlayers` is `2`, so a lone player sits in warmup. For solo
testing set it to `1`, or use Studio's **Test → Clients and Servers → 2 players**.

---

## Controls

| Input | Action |
|---|---|
| `WASD` | Move |
| Mouse | Look |
| `Shift` (hold) | Sprint (×1.35) |
| `Ctrl` or `C` | Slide — 45 stamina, 0.7s of 24 studs/s |
| `Space` | Jump; again in the air to double jump (28 stamina) |
| `Space` (hold, against a wall, airborne) | Wall run (12 stamina/s) |
| Right mouse (hold) | Aim — lowered FOV, tighter spread |
| Left mouse | Fire. Automatic weapons hold; the Burst Rifle fires 3-round bursts |
| `R` | Reload |
| `Q` | Ultimate |
| `B` | Armory (buy menu) |
| `H` | Choose your Rival |
| `Tab` | Scoreboard |
| `Esc` | Close a menu |

---

## What is actually implemented

**Heroes** — one ultimate each, all server-authoritative:

| Hero | HP / Speed | Weapon | Ultimate |
|---|---|---|---|
| The Rusher | 100 / 20 | Dual SMGs | **Blitz Dash** — 55-stud dash, invulnerable in transit, magazine refilled at both ends (22s) |
| The Tank | 175 / 13 | Heavy Shotgun | **Bulwark** — 5s dome that destroys enemy bullets crossing it (30s) |
| The Sniper | 110 / 16 | Bolt Rifle | **Railgun** — pierces walls and bodies, reveals every enemy for 4s (34s) |
| The Support | 120 / 16 | Burst Rifle | **Rally Station** — 12s zone, +12 HP/s and +15% speed to allies (26s) |

**Movement** — sprint, slide with slide-hop momentum, double jump, and wall run,
all sharing one stamina pool. The server never trusts a client's speed for damage:
it rejects shot origins more than 14 studs from the server-side head position.

**Combat** — hitscan with distance falloff, ×2.0 headshots (×1.5 on light
weapons), armor that soaks damage and regenerates after 8s, and a per-shot RNG
seed shared between client and server so spread is authoritative but predictable.

**Match flow** — warmup, buy, action, round end, halftime swap, match end, then a
full reset. Round wins by elimination, or by total remaining team health on a
timeout. Assists, loss-streak bonuses, and a survival bonus all pay out.

**Arena** — Neon Heights with seven distinct zones: central pad with a 110-stud
jump pad, mid cover blocks, two elevated sniper flanks, side corridors, low flank
tunnels, a gapped skybridge, and sealed spawn bubbles. Cover is scattered from a
fixed seed, so every server gets the identical arena.

**HUD** — crosshair, hit markers (white/amber/red), health, armor, stamina, ammo,
round score and timer, alive counter, kill feed, toasts, round banners, a damage
vignette, a death screen, the buy menu, hero select, and a live scoreboard.

---

## Verifying the code

There is no Roblox toolchain in this repo, but there is an offline structural
checker that runs without one:

```bash
python tools/verify_luau.py .
```

It tokenizes each `.luau` file (handling comments, long brackets, strings and
Luau type annotations), then checks:

1. Balanced brackets and unterminated strings.
2. Block balance across `function`/`if`/`for`/`while`/`do`/`repeat` vs
   `end`/`until`, including the `for ... do` double-count trap and inline
   if-expressions (which take no `end`).
3. Globals that do not exist in Roblox Luau (`io`, `dofile`, `loadfile`).
4. A local function called above its own definition — a runtime nil-index, not a
   compile error, which is the easiest bug to introduce by moving code.
5. Leftover `TODO`/`FIXME` markers.

Current state: **16 files, 0 errors.** The remaining warnings are known
conservative false positives (callback parameters and table keys it cannot
resolve without a full scope walk); they are listed rather than suppressed so a
real typo still stands out.

The verifier found three genuine bugs in this codebase during development: a
missing `end`, an inline-if misparse, and a function used before its definition.
Treat a clean run as necessary, not sufficient — it is not a type checker and not
a substitute for Studio's script analysis.

---

## Honest limitations

1. **Two heroes with the same loadout look identical.** Heroes differ by stats and
   ultimate, not silhouette. Fixing that needs art, not code.
2. **Movement is client-authoritative** for responsiveness, with server clamps.
   A determined exploiter can slide faster than intended; they cannot shoot faster
   than the server clock, hit through walls, or damage teammates.
3. **Progression does not persist.** `leaderstats` carries Kills/Deaths/Rounds/XP/
   Rating and the ranked UI reads real values, but there is no DataStore, so it
   resets when the server closes. `Config.Progression` holds the numbers.
4. **No matchmaking, spectating, or replay.**
5. **Asset IDs are stock Roblox ones and may change.** Every sound play is wrapped
   in `pcall`, so a dead ID degrades to silence instead of erroring.

## Not in this build

Objective modes (bomb/point), hero meshes and animations, a real battle-pass UI,
DataStore persistence, and anti-cheat beyond server-side validation.

---

## Tuning

Almost everything is a constant rather than a magic number. See
[TUNING.md](TUNING.md) for a map of which file to open for round timers, economy,
weapon stats, hero numbers, movement feel, arena layout, or FX budget.

## Layout

```
rivals/
├── DESIGN.md                 the full game design document
├── TUNING.md                 where to change what
├── default.project.json      Rojo project
├── README.md
├── src/
│   ├── shared/               Config, Util, Weapons, Heroes, Net
│   ├── server/               GameServer (Script) + ArenaBuilder, Match,
│   │                         WeaponServer, HeroServer, ShopServer
│   └── client/               MoveClient, InputClient, FxClient,
│                             HudClient, LeaderboardClient
└── tools/
    └── verify_luau.py        offline structural checker
```
