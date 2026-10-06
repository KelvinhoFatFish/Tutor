--[[
	Config.luau
	Every global tuning number for RIVALS lives here. If you want to change how the
	game feels, this is the first file to open. See DESIGN.md section 10.
]]

local Config = {}

-- ---------------------------------------------------------------------------
-- Match flow
-- ---------------------------------------------------------------------------
Config.Match = {
	RoundsToWin = 7, -- first team to this many round wins takes the match
	BuyTime = 20, -- seconds locked in spawn to spend credits
	RoundTime = 90, -- seconds of action per round
	RoundEndTime = 6, -- seconds of banner between rounds
	WarmupMinPlayers = 2, -- players needed before the first round starts
	HalftimeSwapAt = 4, -- swap sides when a team reaches this score
	MinPlayers = 2, -- below this the match pauses
	-- "moreHP" = on a timeout, the team with more total health percentage wins
	TimeoutRule = "moreHP",
}

-- ---------------------------------------------------------------------------
-- Economy (credits). See DESIGN.md section 2.
-- ---------------------------------------------------------------------------
Config.Economy = {
	StartCredits = 800,
	KillReward = 400,
	AssistReward = 150,
	RoundWin = 900,
	RoundLoss = 500,
	LossStreakBonus = 100, -- added per consecutive loss...
	LossStreakBonusMax = 400, -- ...up to this cap
	SurvivalBonus = 250,
	MaxCredits = 9000,
	StartingArmor = 0,
}

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
Config.Teams = {
	[1] = { Name = "Cyan", Color = Color3.fromRGB(0, 229, 255) },
	[2] = { Name = "Magenta", Color = Color3.fromRGB(255, 45, 149) },
}

Config.TeamNames = { "Cyan", "Magenta" }

-- ---------------------------------------------------------------------------
-- Movement. Shared between the client controller and server clamps, so both
-- sides agree on what "legal" movement looks like.
-- ---------------------------------------------------------------------------
Config.Movement = {
	BaseWalkSpeed = 16,
	SprintMultiplier = 1.35,
	JumpPower = 50,
	MaxHealth = 100,

	Stamina = {
		Max = 100,
		RegenPerSecond = 45,
		RegenDelay = 0.5, -- seconds after spending before regen starts
	},

	Slide = {
		Cost = 45,
		Speed = 24,
		Duration = 0.7,
		CameraDip = 1.5,
		Cooldown = 0.55,
	},

	DoubleJump = {
		Cost = 28,
		Impulse = 32,
		MaxJumps = 2, -- ground jump + this many air jumps
	},

	WallRun = {
		MinSpeed = 16, -- horizontal speed needed to attach
		Speed = 20, -- speed held while attached
		MaxDuration = 1.6,
		StaminaPerSecond = 12,
		MaxAngle = 55, -- degrees: how far off-vertical a surface can be
		RayLength = 3.2,
		CameraRoll = 8, -- degrees of roll while running a wall
		Cooldown = 0.25,
	},

	-- The server rejects anything faster than heroSpeed * this, to bound exploits
	-- without punishing legitimate slide/dash momentum.
	MaxSpeedTolerance = 1.6,
}

-- ---------------------------------------------------------------------------
-- Combat
-- ---------------------------------------------------------------------------
Config.Combat = {
	HeadshotMultiplier = 2.0,
	HeadshotMultiplierLight = 1.5, -- shotguns / SMGs / pistols
	FalloffFloor = 0.5, -- damage never drops below this fraction of base
	OriginTolerance = 14, -- studs a client-reported ray origin may differ from the server's
	MaxRayDistance = 600,
	RespawnDelay = 4,
	FriendlyFire = false,
	ShieldRegenDelay = 8, -- seconds without damage before armor regenerates
	ShieldRegenPerSecond = 8,
}

-- ---------------------------------------------------------------------------
-- FX budget. These exist so a 10-player fight does not spawn 4000 particles.
-- ---------------------------------------------------------------------------
Config.Fx = {
	TracerLifetime = 0.06,
	ImpactLifetime = 0.5,
	MaxImpactPerSecond = 30,
	MuzzleLightRange = 12,
	MuzzleFlashLife = 0.05,
}

-- ---------------------------------------------------------------------------
-- HUD
-- ---------------------------------------------------------------------------
Config.Hud = {
	ShowLeaderboard = true,
	DamageVignetteMax = 0.55, -- max opacity of the hurt vignette
	KillFeedLife = 4.5,
	BannerTime = 2.6,
	LowHealthThreshold = 0.35,
}

-- ---------------------------------------------------------------------------
-- Palette. Single source of truth for every colour in the game.
-- ---------------------------------------------------------------------------
Config.Palette = {
	Base = Color3.fromRGB(10, 10, 18),
	Cyan = Color3.fromRGB(0, 229, 255),
	Magenta = Color3.fromRGB(255, 45, 149),
	Amber = Color3.fromRGB(255, 179, 0),
	Violet = Color3.fromRGB(138, 43, 226),
	White = Color3.fromRGB(240, 245, 255),
	Gray = Color3.fromRGB(70, 74, 92),
	DarkGray = Color3.fromRGB(28, 30, 40),
	Red = Color3.fromRGB(255, 62, 62),
	Green = Color3.fromRGB(64, 235, 140),
}

-- ---------------------------------------------------------------------------
-- Audio. All stock Roblox IDs. Every play is wrapped in pcall, so a missing or
-- moderated asset degrades to silence rather than erroring mid-fight.
-- ---------------------------------------------------------------------------
Config.Audio = {
	UiClick = "rbxassetid://6016487245",
	UiBuy = "rbxassetid://6016487165",
	RoundStart = "rbxassetid://6026984224",
	RoundWin = "rbxassetid://6026984224",
	Hitmarker = "rbxassetid://5689535122",
	Headshot = "rbxassetid://5689536019",
	Kill = "rbxassetid://5689533709",
}

-- ---------------------------------------------------------------------------
-- Progression (cosmetic only). See DESIGN.md section 7.
-- ---------------------------------------------------------------------------
Config.Progression = {
	XpPerTier = 1000,
	MaxTier = 30,
	Xp = {
		MatchPlayed = 100,
		RoundWon = 60,
		Kill = 25,
		UltimateKill = 40,
		Assist = 10,
		MatchWin = 300,
	},
	RatingStart = 1000,
	RatingPerWin = 25,
	RatingPerLoss = -20,
	Ranks = {
		{ Name = "Bronze", Min = 0 },
		{ Name = "Silver", Min = 1100 },
		{ Name = "Gold", Min = 1300 },
		{ Name = "Platinum", Min = 1500 },
		{ Name = "Diamond", Min = 1700 },
		{ Name = "Master", Min = 1900 },
		{ Name = "Grandmaster", Min = 2100 },
	},
}

-- ---------------------------------------------------------------------------
-- Remote plumbing. Must stay identical on client and server.
-- ---------------------------------------------------------------------------
Config.RemotesFolder = "RivalsRemotes"

-- server -> client (one per player)
Config.ServerEvents = {
	"RoundState", -- current phase, timer, scores
	"Loadout", -- authoritative loadout for this player
	"ShotFired", -- replicated shot for other players' FX
	"DamageTaken", -- drives the hurt vignette
	"HitConfirm", -- hitmarker / headshot / kill feedback
	"KillFeed", -- kill feed line
	"Banner", -- round banners
	"Notify", -- toast messages
	"AbilityFeedback", -- ultimate ready / used / failed
	"Reveal", -- sniper ult: enemy positions
	"BuyResult", -- shop purchase accepted or rejected
	"HudState", -- credits, stamina, armor, hero
}

-- client -> server
Config.ClientEvents = {
	"Fire", -- request to fire
	"Reload",
	"SelectHero",
	"Buy",
	"UseUltimate",
	"MoveState", -- slide/wallrun reporting for FX (never trusted for damage)
	"RequestRespawn",
	"Refresh", -- client asks for a fresh shop catalogue / HUD state
}

-- ---------------------------------------------------------------------------
-- Convenience: the phase names used by every system, so nothing typos a string.
-- ---------------------------------------------------------------------------
Config.Phase = {
	Warmup = "Warmup",
	Buy = "Buy",
	Action = "Action",
	RoundEnd = "RoundEnd",
	MatchEnd = "MatchEnd",
}

return Config
