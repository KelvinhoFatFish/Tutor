# RIVALS — Game Design Document

**Genre:** Hero-based arena shooter (Roblox)
**Players:** 4v4 (scales to 5v5)
**Match:** First to **7 round wins**, sides swap at 4
**Round length:** 90s action + 20s buy phase (configurable)
**Perspective:** First person with an optional third-person toggle
**Art direction:** Blocky low-poly, high-contrast neon on dark. All lighting and particles are code-generated, so the game ships with zero external assets.

> Every number in this document exists as a constant in `src/shared/Config.luau`, `Weapons.luau`, and `Heroes.luau`. The doc and the build are kept in sync on purpose — retune the code, not a spreadsheet.

---

## 1. One-page pitch

Four rival crews fight over a vertical cyberpunk block. You pick an identity, not a gun list: the Rusher who never stops moving, the Tank who walks through gunfire, the Sniper who makes one shot count, the Support who keeps the team standing.

Fights are decided by **movement and cooldown discipline**, not by who bought the better rifle. Sliding, double-jumping, and wall-running are always available; ultimates are earned, not bought, and each one changes the geometry of a fight in a single button press.

The loop is deliberately short: **buy → fight → die → adjust → fight again.** A full 7-round match lands at 10–14 minutes.

---

## 2. Match structure

| Phase | Duration | What happens |
|---|---|---|
| Warmup | until 2v2 present | Free-for-all in the arena, no damage, no score |
| Buy | 20s | Locked in spawn bubble. Spend credits, pick a hero. |
| Action | 90s | Standard combat. Teams eliminated or timer expires. |
| Round end | 6s | Winner banner, credits awarded, kills tallied. |
| Halftime | 20s | Sides swap at 4–3 / 4–0 / 3–4. |
| Match end | 15s | Victory banner, then map reset. |

**Round win conditions**
1. Eliminate the entire enemy team → win.
2. Timer hits 0 with both teams alive → the team with more total HP% wins. Tie → draw, no round point, sudden-death next round.
3. Defuse-style objective is intentionally out of scope for v1; the arena is the objective.

**Economy** (credits, per player)

| Source | Amount |
|---|---|
| Match start | 800 |
| Kill | +400 |
| Assist | +150 |
| Round win | +900 |
| Round loss | +500 (+100 per consecutive loss, max +400) |
| Survival bonus | +250 |
| Cap | 9000 |

**Loadout resets every round.** You rebuy. This keeps the economy meaningful and stops snowballing from carrying over a sniper for seven rounds.

---

## 3. Movement — the actual mechanic

Movement is the skill ceiling. All four abilities below are available to **every** hero; heroes differ in tuning multipliers, not in whether they can do it.

| Ability | Input | Effect | Cost |
|---|---|---|---|
| Sprint | hold Shift | ×1.35 walk speed | — |
| Slide | Shift + Ctrl/C while grounded and moving | 24 studs/s, 0.7s, camera dips 1.5 studs, friction near-zero | 45 stamina |
| Double jump | Space while airborne | +32 vertical impulse, once per airtime | 28 stamina |
| Wall run | hold Space against a wall while airborne at 16+ studs/s | gravity ~0, horizontal speed held at 20 studs/s, 1.6s max, camera rolls 8° | 12/s stamina |

**Stamina:** pool of 100, regen 45/s after a 0.5s delay. Sliding and wall-running share it, so a Rusher cannot slide *and* wall-run forever — that is the intended tension.

**Implementation notes** (`src/client/MoveClient.luau`)
- Slide writes `Humanoid.WalkSpeed` and `RootPart.AssemblyLinearVelocity` each frame; it does not use platformstanding or friction hacks, so it behaves identically on client and in server-side validation.
- Wall run is detected by a single `Workspace:Raycast` opposite the velocity vector, with `WallRunMinSpeed` gating entry. Vertical velocity is overwritten (not clamped) so you do not "stick" to the wall after release.
- The server does **not** trust client speed. `WeaponServer` rejects projectile origins that are more than `OriginTolerance` studs from the server-side head position, and `MoveClient` clamps to `MaxAllowedSpeed` which is hero speed × 1.6.

**Design intent:** the arena is small and vertical precisely so that these three abilities are always useful within a 40-stud radius. There is nowhere to hide, so disengaging means out-maneuvering, not out-running.

---

## 4. The Rivals (heroes)

Four classes. Each has one passive-flavoured stat line and exactly **one** ultimate. No hero has two buttons, so a new player only ever learns one cooldown at a time.

### 4.1 The Rusher — `rusher`
> *"Reload is for people who stopped moving."*

| Stat | Value |
|---|---|
| Health | 100 |
| Walk speed | 20 |
| Weapon | Dual SMGs — 9 dmg/bullet, 13 rounds/s, 28 mag, 1.6s reload, 28 falloff studs |
| Ultimate | **Blitz Dash** — 55-stud dash along the movement vector, invulnerable for the 0.35s of travel, and **instantly refills the magazine on both entry and exit** |
| Cooldown | 22s |
| Role | Entry fragger. Wins by arriving before the enemy's crosshair does. |

Tuning guardrail: the dash is a reposition, not an escape. It does not break damage, and it does not clear the ultimate's 22s cooldown, so a Rusher who dashes in and fails has nothing.

### 4.2 The Tank — `tank`
> *"Shoot me. I'll wait."*

| Stat | Value |
|---|---|
| Health | 175 |
| Walk speed | 13 |
| Weapon | Heavy Shotgun — 8 pellets × 11 dmg, 0.85s between shots, 15 falloff studs, 6 shells |
| Ultimate | **Bulwark** — a 5s dome shield (radius 14) centred on the player that destroys enemy bullets crossing it. Friendly fire passes through freely. |
| Cooldown | 30s |
| Role | Space taker. The shield is a *dome*, not a wall, so teammates can shoot out of it while enemies must walk in. |

The 13 walk speed is the point: a Tank that cannot be shot and cannot be outrun would be broken, so the Tank trades all mobility for the shield.

### 4.3 The Sniper — `sniper`
> *"One shot. Then reposition."*

| Stat | Value |
|---|---|
| Health | 110 |
| Walk speed | 16 |
| Weapon | Bolt-action rifle — 85 body / ×2.0 headshot, 0.95s between shots, 5 mag, 3.2s reload, 300 falloff studs |
| Ultimate | **Railgun** — one shot that pierces geometry and every enemy in its path, and **reveals every enemy to your whole team for 4s** |
| Cooldown | 34s |
| Role | Information + pick. The reveal is often worth more than the kill. |

Wall-piercing is implemented as a `Raycast` with a whitelist of only enemy characters and the arena's `BulletBlockers`-tagged parts excluded, so a railgun shot ignores cover but still respects the dome shield.

### 4.4 The Support — `support`
> *"You're welcome. No, don't thank me, just don't die."*

| Stat | Value |
|---|---|
| Health | 120 |
| Walk speed | 16 |
| Weapon | Burst rifle — 3-round burst, 16 dmg/bullet, 0.11s intra-burst, 30 mag, 2.4s reload |
| Ultimate | **Rally Station** — deploys a healing station for 12s: 12 HP/s to allies in a 16-stud radius, and +15% walk speed while inside it |
| Cooldown | 26s |
| Role | Anchor. Turns a won fight into a held position. |

---

## 5. Map — **Neon Heights**

A single arena, 240 × 240 studs, enclosed by 60-stud-tall neon walls. Symmetric east–west so neither team gets a spawn advantage.

```
                 N  (skybridge, y=46)
        ┌──────────────────────────────────────────┐
        │  ▓▓▓ rooftop ▓▓▓        ▓▓▓ rooftop ▓▓▓   │
        │   ▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓        │
        │        │                      │           │
        │   ┌────┴────┐            ┌────┴────┐      │
        │   │  plat   │   ┌────┐   │  plat   │      │
        │   └─────────┘   │PAD │   └─────────┘      │
        │  ═══════════    └────┘    ═══════════     │
        │   ░░ corridor ░░  ████  ░░ corridor ░░    │
        │   ░░          ░░  ████  ░░          ░░    │
        │   ░░          ░░  ████  ░░          ░░    │
        │  ═══════════              ═══════════     │
        │   ┌─────────┐            ┌─────────┐      │
        │   │ SPAWN W │            │ SPAWN E │      │
        │   └─────────┘            └─────────┘      │
        └──────────────────────────────────────────┘
                 S  (low flank tunnels, y=2)
```

**Zones**

| Zone | Description | Why it exists |
|---|---|---|
| **Central Pad** | 14×14 glowing platform at y=8 with a jump pad on top (110-stud launch). | The one place both teams want. Vertical escape route. |
| **Mid Blocks** | Two 18×18 grounded blocks at y=0 flanking the pad, 10 studs of cover each. | Sightline breakers; keeps the Sniper from owning centre. |
| **High Flanks (E/W)** | Rooftops at y=46 reached by ramps from the side corridors. | Sniper perches. Two of them, mirrored. |
| **Side Corridors** | 12-stud-wide, 24-stud-tall tunnels with pillar cover, connecting spawn to mid. | Rusher lanes and Support anchor points. |
| **Low Flank Tunnels** | 10-stud-tall tunnels running under the arena, y=2, with two exits per side. | The Tank's route; also the only cover from the high flanks. |
| **Skybridge** | A 40-stud bridge at y=46 spanning mid, with a gap in the middle. | Contested verticality; forces commitment. |
| **Spawn Bubbles** | Enclosed rooms behind each base, buy-phase only. | No spawn camping, guaranteed safe buy. |

**Cover props** are procedurally scattered (neon crates, pillars, half-walls, barrels) with a fixed seed, so the arena is identical in every server while still being generated by code.

**Jump pad:** `Velocity = Vector3.new(0, 110, 0)` on touch, 1.5s cooldown per player, with a neon ring that pulses. It is the only way to reach mid-air height without the Skybridge.

---

## 6. The Arsenal

Bought between rounds, never carried over. Four categories.

**Pistols**
| Weapon | Dmg | Fire rate | Mag | Cost |
|---|---|---|---|---|
| Sidearm | 24 | 0.18s | 12 | 500 (free) |
| Hand Cannon | 52 | 0.42s | 6 | 900 |

**SMGs**
| Weapon | Dmg | Fire rate | Mag | Cost |
|---|---|---|---|---|
| Compact SMG | 13 | 0.075s | 30 | 1200 |
| Dual SMGs | 9 | 0.077s | 28 | 1900 |

**Rifles**
| Weapon | Dmg | Fire rate | Mag | Cost |
|---|---|---|---|---|
| Burst Rifle | 16 | 0.11s ×3 | 30 | 1600 |
| Assault Rifle | 20 | 0.10s | 30 | 2400 |

**Snipers / Heavy**
| Weapon | Dmg | Fire rate | Mag | Cost |
|---|---|---|---|---|
| Bolt Rifle | 85 (×2 head) | 0.95s | 5 | 3200 |
| Heavy Shotgun | 11 ×8 pellets | 0.85s | 6 | 2100 |

**Utility**
| Item | Effect | Cost |
|---|---|---|
| Light Armor | +50 shield | 500 |
| Heavy Armor | +100 shield | 1100 |
| HE Grenade | 90 dmg, 12-stud radius, 2s fuse | 300 |
| Flash Grenade | 2.2s whiteout within 25 studs, line-of-sight only | 250 |
| Med Stim | Instant +60 HP, 1 use | 350 |

Damage falloff is linear between `rangeMin` and `rangeMax` down to 50% of base damage. Headshots are ×2.0 for rifles/snipers, ×1.5 for everything else (so a shotgun headshot is a bonus, not the entire game plan).

---

## 7. Progression

**Cosmetic-only battle pass.** No stat is ever purchasable. Track is 30 tiers, 1000 XP per tier:

| Action | XP |
|---|---|
| Match played | 100 |
| Round won | 60 |
| Kill | 25 |
| Ultimate kill | 40 |
| Assist | 10 |
| Match win | 300 |

Rewards alternate between weapon skins (material/colour swaps — `Neon Wrap`, `Carbon`, `Chrome`, `Vaporwave`), hero banner frames, and emote variants. Skins change `Handle.Color` / `Material` only.

**Ranked (Bronze → Grandmaster).** Rating starts at 1000, ±25 per match result weighted by round differential.

| Rank | Rating |
|---|---|
| Bronze | 0–1099 |
| Silver | 1100–1299 |
| Gold | 1300–1499 |
| Platinum | 1500–1699 |
| Diamond | 1700–1899 |
| Master | 1900–2099 |
| Grandmaster | 2100+ |

Queue rules: solo/duo only up to Diamond, 5-stack allowed at Master+, and no rating change if a match ends 4v4 with a leaver before round 3.

---

## 8. Art & feel

- **Palette:** near-black base `#0A0A12`, cyan `#00E5FF`, magenta `#FF2D95`, amber `#FFB300`, violet `#8A2BE2`. Team A reads cyan, Team B reads magenta — enemies are always the *other* colour, which removes friendly-fire hesitation.
- **Lighting:** `Technology = Future` where available, one dim ambient at `0.06` brightness, neon parts use `Neon` material + `PointLight` so the arena lights itself.
- **Particles:** all `ParticleEmitter`s are constructed in code — muzzle flash, impact sparks, dash trail, dome shimmer, heal pulses. No uploaded textures; `roblox` asset IDs are avoided so nothing can break or be moderated.
- **Audio:** stock `rbxassetid://` gunshot/reload/UI sounds only, wrapped in `pcall` so a missing asset degrades to silence instead of erroring.
- **Hit feedback:** hitmarker (white for body, amber for headshot, red for kill), screen-edge damage vignette scaled to damage taken, kill banner with the victim's hero name.

---

## 9. Scope

**In v1 (implemented in this repo)**
- 4 heroes with working ultimates
- Slide / double-jump / wall-run with stamina
- 7-round match flow, buy phase, halftime, economy
- 8 buyable weapons + armor + grenades
- Procedural Neon Heights with jump pad and 4 vertical layers
- Full HUD, buy menu, hero select, kill feed, round banner, leaderboard
- Code-generated FX and map

**Deliberately out of v1**
- Objective modes (bomb/point)
- DataStore persistence for XP/rating (the UI reads from leaderstats so it is a drop-in later)
- Custom hero meshes/animations (heroes differ by stats + ultimate, not silhouette — the honest weak point of this build)
- Matchmaking, spectate, replay, anti-cheat beyond server-side validation

**Known honest limitations**
1. Two heroes with the same loadout are visually indistinguishable; that needs art, not code.
2. Movement is client-authoritative for responsiveness, with server clamps. A determined exploiter can still *slide* faster than intended; they cannot shoot faster than the server clock.
3. No DataStore means progression resets when the server closes.

---

## 10. Tuning appendix (where to change things)

| Want to change | File |
|---|---|
| Round count, phase timers, economy | `src/shared/Config.luau` |
| Weapon stats, prices, falloff | `src/shared/Weapons.luau` |
| Hero health/speed/ultimate numbers | `src/shared/Heroes.luau` |
| Movement feel (slide, dash, wall run) | `src/shared/Config.luau` → `Movement` |
| Arena size, jump pad force, prop density | `src/server/Arena.luau` |
| Ultimate cooldowns and durations | `src/shared/Heroes.luau` → `ultimate` |
