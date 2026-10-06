# TUNING — where to change what

Every number worth touching is a named constant, not a literal buried in logic.
This is the map. Nothing here requires reading the surrounding code.

---

## Match flow — [`src/shared/Config.luau`](src/shared/Config.luau) → `Config.Match`

```lua
Config.Match = {
    RoundsToWin = 7,        -- first team to this many round wins takes the match
    BuyTime = 20,           -- seconds locked in spawn to spend credits
    RoundTime = 90,         -- seconds of action per round
    RoundEndTime = 6,       -- seconds of banner between rounds
    WarmupMinPlayers = 2,   -- players needed before the first round starts
    HalftimeSwapAt = 4,     -- swap sides when a team reaches this score
    MinPlayers = 2,         -- below this the match pauses
    TimeoutRule = "moreHP", -- on a timeout, more total team health wins
}
```

**Testing solo?** Set `MinPlayers = 1` and `WarmupMinPlayers = 1`. Otherwise a
lone player stays in warmup forever. For a quicker loop, `RoundsToWin = 3` and
`BuyTime = 8`.

**A faster, bloodier game:** `RoundTime = 60`, `Economy.RoundWin = 1200`,
`RoundsToWin = 5`.

---

## Economy — `Config.Economy`

```lua
StartCredits = 800,        -- at match start and after every reset
KillReward = 400,
AssistReward = 150,
RoundWin = 900,
RoundLoss = 500,
LossStreakBonus = 100,     -- added per consecutive loss...
LossStreakBonusMax = 400,  -- ...up to this cap
SurvivalBonus = 250,       -- paid to players who end the round alive
MaxCredits = 9000,
```

Loadouts are wiped at the start of every round (`Match.startRound`). If you want
loadouts to carry over instead, remove the reset loop there — but that changes the
economy from a per-round decision into a snowball, which is why it is not the
default.

---

## Weapons — [`src/shared/Weapons.luau`](src/shared/Weapons.luau)

One entry per weapon in the `list` table. Every field is documented in the
`Weapon` type at the top of the file.

| Field | Meaning |
|---|---|
| `damage` | Per bullet, or per pellet for shotguns |
| `fireRate` | Seconds between shots (or between bursts) |
| `rangeMin` / `rangeMax` | Damage is full inside `rangeMin` and falls to `Config.Combat.FalloffFloor` at `rangeMax` |
| `magSize` / `reloadTime` | Ammo and reload duration |
| `spread` / `spreadMoving` | Cone in degrees, standing and moving |
| `bulletCount` | Pellets per trigger pull (8 for the shotgun) |
| `burstSize` / `burstDelay` | 3 and 0.11 for the Burst Rifle; 1 elsewhere |
| `headshotMultiplier` | ×2.0 rifles/snipers, ×1.5 light weapons |
| `adsFov` | Camera FOV while aiming. 22 is a sniper scope, 62 is a pistol |
| `price` | 0 means not sold in the armory |
| `visual` | The code-built gun model: length, width, colour, barrel, stock, scope, drum, muzzle flash scale |

**Falloff floors and headshot multipliers** are global, in `Config.Combat`:
`FalloffFloor`, `HeadshotMultiplier`, `HeadshotMultiplierLight`.

**Design guardrail worth keeping:** the shotgun's `rangeMin`/`rangeMax` of 8/15 is
what makes it a Tank weapon rather than a general-purpose one. Widening that to
anything above ~25 studs makes the Tank oppressive.

### Adding a weapon

1. Append a table to `list` in `Weapons.luau` with a unique `name`.
2. Give it a `visual` block (copy a neighbour and change the numbers).
3. That is it — `WeaponServer.buildTemplates` builds a Tool for every entry at
   startup, and `ShopServer.catalog` puts anything with `price > 0` in the shop.

The verifier will catch a typo'd field only indirectly, so check the gun renders.

---

## Heroes — [`src/shared/Heroes.luau`](src/shared/Heroes.luau)

One entry per hero in `list`. `health`, `walkSpeed`, `weapon` (a key from
`Weapons.byName`), and a single `ultimate`.

```lua
{
    name = "rusher",            -- must match the ultimate's kind dispatch
    health = 100,
    walkSpeed = 20,
    weapon = "dualsmg",         -- validated at load: a bad name throws immediately
    ultimate = {
        kind = "blitzDash",     -- dispatches to HeroServer.blitzDash
        cooldown = 22,
        duration = 0.35,
        distance = 55,
        invulnerable = 0.35,
        reloadOnUse = true,
    },
}
```

Ultimate tuning per kind:

| `kind` | Fields that matter |
|---|---|
| `blitzDash` | `distance`, `duration`, `invulnerable`, `reloadOnUse`, `cooldown` |
| `bulwark` | `radius`, `duration`, `cooldown` |
| `railgun` | `damage`, `revealDuration`, `cooldown` |
| `rallyStation` | `radius`, `duration`, `healPerSecond`, `speedMultiplier`, `cooldown` |

**The four cooldowns (22/30/34/26) are the primary balance lever in the game.** If
a hero feels oppressive, raise its cooldown before touching its damage. The Tank's
dome at 30s is deliberately the longest because it is the hardest to play around.

Heroes are validated at module load: a hero pointing at a weapon that does not
exist throws an error immediately rather than failing mid-match.

---

## Movement — `Config.Movement`

```lua
BaseWalkSpeed = 16,
SprintMultiplier = 1.35,
JumpPower = 50,

Stamina = { Max = 100, RegenPerSecond = 45, RegenDelay = 0.5 },

Slide = { Cost = 45, Speed = 24, Duration = 0.7, CameraDip = 1.5, Cooldown = 0.55 },

DoubleJump = { Cost = 28, Impulse = 32, MaxJumps = 2 },

WallRun = {
    MinSpeed = 16, Speed = 20, MaxDuration = 1.6,
    StaminaPerSecond = 12, MaxAngle = 55, RayLength = 3.2,
    CameraRoll = 8, Cooldown = 0.25,
},

MaxSpeedTolerance = 1.6,  -- server rejects anything above heroSpeed * this
```

The implementation lives in [`src/client/MoveClient.luau`](src/client/MoveClient.luau).
Three things are balanced against each other:

- **Stamina is the shared budget.** Slide costs 45 up front, wall run drains 12/s.
  Lowering `Stamina.RegenPerSecond` is a single-knob way to slow the whole game
  down without touching any hero.
- **`Slide.Speed` and `Slide.Duration`** define slide-hop distance. Raising
  `Duration` past ~0.9s starts to feel like ice.
- **`WallRun.MaxAngle = 55`** is generous on purpose: Neon Heights is blocky, so a
  stricter angle makes wall running feel arbitrary rather than skilful.

`MaxSpeedTolerance` is a cheat clamp, not a feel knob. Lowering it toward 1.2 will
start rejecting legitimate slide-into-wall-run movement.

---

## Combat — `Config.Combat`

```lua
HeadshotMultiplier = 2.0,
HeadshotMultiplierLight = 1.5,
FalloffFloor = 0.5,        -- damage never drops below half of base
OriginTolerance = 14,      -- studs a client-reported ray origin may differ from the server's
MaxRayDistance = 600,
RespawnDelay = 4,
FriendlyFire = false,
ShieldRegenDelay = 8,      -- seconds without damage before armor regenerates
ShieldRegenPerSecond = 8,
```

`OriginTolerance` is anti-cheat: a client may not fire from a position far from
where the server thinks its head is. Raise it only if legitimate shots get eaten
on high-ping servers; lower it to tighten the exploit window.

---

## Arena — [`src/server/ArenaBuilder.luau`](src/server/ArenaBuilder.luau) → `LAYOUT`

The whole map is data. Coordinates are studs, origin at arena centre, `y = 0` is
the floor.

```lua
Size = 240,               -- square side length
WallHeight = 60,
CenterPad = { size = Vector3.new(14, 1, 14), height = 8 },
JumpPad = { size = Vector3.new(9, 1, 9), launch = 110, cooldown = 1.5 },
MidBlocks = { offsetX = 38, size = Vector3.new(18, 12, 18) },
Corridor = { offsetX = 88, width = 26, depth = 34, height = 24 },
Balcony = { offsetX = 88, size = Vector3.new(30, 2, 38), topY = 46 },
Skybridge = { y = 46, width = 12, outerX = 74, innerX = 12 },  -- the gap is innerX
Tunnel = { halfWidth = 66, roofY = 8, openings = { [58] = 14, [22] = 12, ... } },
CoverSeed = 20240614,     -- change for a different cover layout, same every server
CoverCount = 34,
JumpPadCeiling = 150,     -- players are stopped here so nobody leaves the map
```

**`CoverSeed` is the single best structural knob.** Every value gives a valid,
different arena, because `_scatterCover` rejects positions inside the functional
zones (`keepOut`). Add a zone to `keepOut` if you add a structure that cover must
not block.

**Raising `JumpPad.launch`** above ~130 lets players reach the skybridge from the
pad, which shortcuts the map's verticality. 110 is calibrated to *not* quite do it.

If you redraw the layout, remember that anything with `CanCollide = true` is
tagged `BulletBlocker` automatically, and the Tank's dome relies on its own
`ShieldDome` tag.

---

## FX budget — `Config.Fx` and `FxClient.luau`

```lua
TracerLifetime = 0.06,
ImpactLifetime = 0.5,
MaxImpactPerSecond = 30,
MuzzleLightRange = 12,
MuzzleFlashLife = 0.05,
```

Plus two hard caps that matter more than the above:

- `MAX_EFFECTS = 120` in [`FxClient.luau`](src/client/FxClient.luau) — concurrent
  visual effects. When it is full, new effects are *skipped*, never queued.
  Lower it for low-end devices.
- `IMPACT_MAX_PER_TICK = 6` in [`WeaponServer.luau`](src/server/WeaponServer.luau)
  — impact sparks per shooter per 0.1s. A shotgun blast is 8 pellets, so this is
  what stops four shotguns from flooding every client's network with 32 impact
  remotes per trigger pull.

---

## HUD — `Config.Hud` and `HudClient.luau` → `LAYOUT`

```lua
ShowLeaderboard = true,
DamageVignetteMax = 0.55,
KillFeedLife = 4.5,
BannerTime = 2.6,
LowHealthThreshold = 0.35,
```

`LAYOUT` at the top of [`HudClient.luau`](src/client/HudClient.luau) holds every
panel's size, padding, font and bar dimension, so the interface can be re-proportioned
without hunting through the build functions.

---

## Palette and audio — `Config.Palette`, `Config.Audio`

One source of truth for every colour in the game, including team colours.
`Config.Teams[1]` is Cyan and `Config.Teams[2]` is Magenta; enemies are always the
*other* colour from the local player, which is what removes friendly-fire
hesitation.

`Config.Audio` holds stock Roblox asset IDs. Every playback is wrapped in `pcall`
and uses `SoundService:PlayLocalSound` for per-player cues, so a dead ID is silent
rather than fatal.

---

## Progression — `Config.Progression`

XP per action, rating deltas, and the rank ladder (`Ranks`). The ranked UI reads
real `leaderstats` values, so wiring a DataStore into `Match.ensureLeaderstats`
is the only step needed to make it persistent. Not implemented by design — see
the limitations section of [README.md](README.md).
