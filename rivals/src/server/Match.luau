--[[
	Match.luau
	Authoritative match state: teams, phases, economy, round wins, damage, and
	eliminations. Clients render what this module broadcasts; they never decide
	any of it.

	Public API
	  Match.init()
	  Match.state                      -- live table, read-only by convention
	  Match.getPlayerState(player)
	  Match.setLoadout(player, loadout)
	  Match.equipHero(player, heroName)
	  Match.applyDamage(victim, amount, attacker, weapon, isHeadshot)
	  Match.eliminate(victim, attacker, weapon, isHeadshot)
	  Match.spawnPlayer(player)
	  Match.addCredits(player, amount)
	  Match.notify(player, text, color)
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Util = require(Shared.Util)
local Weapons = require(Shared.Weapons)

local Arena = (function()
	local module = script.Parent:FindFirstChild("ArenaBuilder")
	if not module then
		return nil
	end
	local ok, loaded = pcall(function()
		return require(module)
	end)
	if ok then
		return loaded
	end
	warn("[RIVALS] ArenaBuilder failed to load: " .. tostring(loaded))
	return nil
end)()

local Match = {}

local Phase = Config.Phase

-- ---------------------------------------------------------------------------
-- Live state
-- ---------------------------------------------------------------------------
Match.state = {
	phase = Phase.Warmup,
	phaseEnds = math.huge,
	round = 0,
	scores = { [1] = 0, [2] = 0 },
	lossStreak = { [1] = 0, [2] = 0 },
	lastWinner = nil :: number?,
	buyLocked = true,
	winner = nil :: number?,
	started = false,
	kills = 0,
}

local playerStates: { [Player]: any } = {}
local damageLog: { [Player]: { [Player]: number } } = {}
local lastDamageAt: { [Player]: number } = {}
local lastRoundReward: { [Player]: number } = {}

--- Damage blockers let other systems veto damage without Match having to require
--- them (which would be a circular dependency). HeroServer registers here.
type DamageBlocker = (victim: Player, origin: Vector3?) -> boolean
local damageBlockers: { DamageBlocker } = {}

function Match.registerDamageBlocker(blocker: DamageBlocker)
	table.insert(damageBlockers, blocker)
end

--- Called when a player is eliminated, so hero effects can be cleaned up.
type DeathHook = (victim: Player) -> ()
local deathHooks: { DeathHook } = {}

function Match.registerDeathHook(hook: DeathHook)
	table.insert(deathHooks, hook)
end

local function damageIsBlocked(victim: Player, origin: Vector3?): boolean
	for _, blocker in ipairs(damageBlockers) do
		local ok, blocked = pcall(blocker, victim, origin)
		if ok and blocked then
			return true
		end
	end
	return false
end

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
local function now(): number
	return os.clock()
end

function Match.getPlayerState(player: Player)
	return playerStates[player]
end

function Match.livingStates(): { any }
	local out = {}
	for _, state in pairs(playerStates) do
		if state.alive then
			table.insert(out, state)
		end
	end
	return out
end

function Match.teamAlive(team: number): number
	local count = 0
	for _, state in pairs(playerStates) do
		if state.team == team and state.alive then
			count += 1
		end
	end
	return count
end

function Match.teamPlayers(team: number): { any }
	local out = {}
	for _, state in pairs(playerStates) do
		if state.team == team then
			table.insert(out, state)
		end
	end
	return out
end

--- Total remaining health across a team, as a fraction of its maximum. Used by
--- the timeout rule.
function Match.teamHealthFraction(team: number): number
	local current, maximum = 0, 0
	for _, state in pairs(playerStates) do
		if state.team == team then
			local hero = Heroes.get(state.hero)
			maximum += hero.health
			if state.alive then
				local character = state.player.Character
				local humanoid = character and character:FindFirstChildOfClass("Humanoid")
				if humanoid then
					current += humanoid.Health
				end
			end
		end
	end
	if maximum <= 0 then
		return 0
	end
	return current / maximum
end

-- ---------------------------------------------------------------------------
-- Broadcasts
-- ---------------------------------------------------------------------------
function Match.broadcastState()
	local payload = {
		phase = Match.state.phase,
		phaseEnds = Match.state.phaseEnds,
		timeLeft = math.max(0, Match.state.phaseEnds - now()),
		round = Match.state.round,
		scores = { Match.state.scores[1], Match.state.scores[2] },
		buyLocked = Match.state.buyLocked,
		winner = Match.state.winner,
		alive = {
			[1] = Match.teamAlive(1),
			[2] = Match.teamAlive(2),
		},
	}
	Net.toAll("RoundState", payload)
end

function Match.notify(player: Player, text: string, color: Color3?)
	Net.toPlayer("Notify", player, {
		text = text,
		color = color or Config.Palette.White,
	})
end

function Match.banner(text: string, subtext: string, color: Color3?)
	Net.toAll("Banner", {
		text = text,
		subtext = subtext,
		color = color or Config.Palette.White,
		duration = Config.Hud.BannerTime,
	})
end

--- Plays a 2D sound for one player only. SoundService:PlayLocalSound is the
--- correct tool here -- parenting a Sound to workspace would replicate it to
--- everyone, which is exactly what we do not want for a per-player cue.
local function playCueFor(player: Player, soundId: string, volume: number?)
	if soundId == "" then
		return
	end
	local sound = Instance.new("Sound")
	sound.SoundId = soundId
	sound.Volume = volume or 0.5
	local ok = pcall(function()
		game:GetService("SoundService"):PlayLocalSound(sound)
	end)
	if not ok then
		sound:Destroy()
		return
	end
	game:GetService("Debris"):AddItem(sound, 6)
end

local function playCueAll(soundId: string, volume: number?)
	for _, player in ipairs(Players:GetPlayers()) do
		playCueFor(player, soundId, volume)
	end
end

--- Sends a player the authoritative view of their own loadout and stats.
function Match.pushLoadout(state)
	local player = state.player
	Net.toPlayer("Loadout", player, {
		weapon = state.weapon,
		hero = state.hero,
		credits = state.credits,
		armor = state.armor,
		maxArmor = state.maxArmor,
		hasStim = state.hasStim,
		grenades = state.grenades,
		kills = state.kills,
		deaths = state.deaths,
		assists = state.assists,
		ultReady = Heroes.isReady(Heroes.get(state.hero), state.lastUltimate, now()),
	})
end

function Match.pushHud(state)
	Net.toPlayer("HudState", state.player, {
		credits = state.credits,
		armor = state.armor,
		maxArmor = state.maxArmor,
		weapon = state.weapon,
		hero = state.hero,
		kills = state.kills,
		deaths = state.deaths,
		assists = state.assists,
		grenades = state.grenades,
		hasStim = state.hasStim,
		ultReady = Heroes.isReady(Heroes.get(state.hero), state.lastUltimate, now()),
		ultCooldown = Heroes.cooldownRemaining(Heroes.get(state.hero), state.lastUltimate, now()),
	})
end

-- ---------------------------------------------------------------------------
-- Leaderstats
-- ---------------------------------------------------------------------------
local function ensureLeaderstats(player: Player)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		leaderstats = Instance.new("Folder")
		leaderstats.Name = "leaderstats"
		leaderstats.Parent = player
	end
	local function value(name: string, initial: number, className: string?): Instance
		local existing = leaderstats:FindFirstChild(name)
		if existing then
			return existing
		end
		local instance = Instance.new(className or "IntValue")
		instance.Name = name
		instance.Value = initial
		instance.Parent = leaderstats
		return instance
	end
	value("Kills", 0)
	value("Deaths", 0)
	value("Rounds", 0)
	value("XP", Config.Progression.Xp.MatchPlayed, "IntValue")
	value("Rating", Config.Progression.RatingStart, "IntValue")
end

local function addStat(player: Player, name: string, amount: number)
	local leaderstats = player:FindFirstChild("leaderstats")
	local stat = leaderstats and leaderstats:FindFirstChild(name)
	if stat and stat:IsA("IntValue") then
		stat.Value = math.max(0, stat.Value + amount)
	end
end

local function rankFor(rating: number): string
	local name = "Bronze"
	for _, rank in ipairs(Config.Progression.Ranks) do
		if rating >= rank.Min then
			name = rank.Name
		end
	end
	return name
end

-- ---------------------------------------------------------------------------
-- Economy
-- ---------------------------------------------------------------------------
function Match.addCredits(player: Player, amount: number)
	local state = playerStates[player]
	if not state then
		return
	end
	state.credits = Util.clamp(state.credits + amount, 0, Config.Economy.MaxCredits)
	Match.pushHud(state)
end

function Match.spendCredits(player: Player, amount: number): boolean
	local state = playerStates[player]
	if not state or state.credits < amount then
		return false
	end
	state.credits -= amount
	Match.pushHud(state)
	return true
end

-- ---------------------------------------------------------------------------
-- Loadout
-- ---------------------------------------------------------------------------
local defaultLoadout = {
	weapon = "sidearm",
	armor = 0,
	maxArmor = 0,
	hasStim = false,
	grenades = { he = 0, flash = 0 },
}

function Match.setLoadout(player: Player, loadout: any)
	local state = playerStates[player]
	if not state then
		return
	end
	state.weapon = loadout.weapon or defaultLoadout.weapon
	state.armor = loadout.armor or 0
	state.maxArmor = loadout.maxArmor or 0
	state.hasStim = loadout.hasStim or false
	state.grenades = loadout.grenades or { he = 0, flash = 0 }

	-- Re-issue the tool if the player is alive.
	if state.alive then
		Match.giveWeapon(state)
	end
	Match.pushLoadout(state)
end

--- Swaps the player's weapon tool for the one in their loadout.
function Match.giveWeapon(state)
	local player = state.player
	local character = player.Character
	if not character then
		return
	end

	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack then
		for _, child in ipairs(backpack:GetChildren()) do
			if child:IsA("Tool") then
				child:Destroy()
			end
		end
	end
	if character then
		for _, child in ipairs(character:GetChildren()) do
			if child:IsA("Tool") then
				child:Destroy()
			end
		end
	end

	local template = ReplicatedStorage:FindFirstChild("WeaponTemplates")
	local tool = template and template:FindFirstChild(state.weapon)
	if not tool then
		warn(string.format("[RIVALS] No template for weapon %q", tostring(state.weapon)))
		return
	end

	local clone = tool:Clone()
	clone.Parent = player:FindFirstChildOfClass("Backpack") or player
	-- Auto-equip: this is a fast shooter, nobody wants to press a hotbar key.
	task.defer(function()
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid and clone.Parent then
			humanoid:EquipTool(clone)
		end
	end)
end

--- Applies a hero's stats to the player's character and adds their ult cooldown.
function Match.equipHero(player: Player, heroName: string)
	local state = playerStates[player]
	if not state then
		return
	end
	state.hero = Heroes.exists(heroName) and heroName or state.hero
	-- No hero restrictions in v1: anyone may switch during buy time.
	state.lastUltimate = state.lastUltimate or -math.huge

	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		local hero = Heroes.get(state.hero)
		humanoid.MaxHealth = hero.health
		humanoid.Health = math.min(humanoid.Health, hero.health)
		humanoid.WalkSpeed = hero.walkSpeed
	end
	Match.pushHud(state)
end

-- ---------------------------------------------------------------------------
-- Damage and elimination
-- ---------------------------------------------------------------------------
--- The single funnel for all damage. `attacker` may be nil (fall, world harm).
function Match.applyDamage(
	victim: Player,
	amount: number,
	attacker: Player?,
	weaponName: string?,
	isHeadshot: boolean?
): number
	local state = playerStates[victim]
	if not state or not state.alive or amount <= 0 then
		return 0
	end

	local attackerState = attacker and playerStates[attacker] or nil
	if attackerState and attackerState.team == state.team and not Config.Combat.FriendlyFire then
		return 0
	end

	-- Ultimates can veto damage entirely (the Rusher's dash immunity).
	if damageIsBlocked(victim, nil) then
		return 0
	end

	lastDamageAt[victim] = now()

	-- Armor soaks damage first, at full value.
	local remaining = amount
	if state.armor > 0 then
		local soaked = math.min(state.armor, remaining)
		state.armor -= soaked
		remaining -= soaked
	end

	local character = victim.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return 0
	end

	if remaining > 0 then
		humanoid:TakeDamage(remaining)
	end

	-- Credit assists: everyone who damaged the victim this life, except the killer.
	if attackerState and attackerState.player ~= victim then
		local log = damageLog[victim]
		if not log then
			log = {}
			damageLog[victim] = log
		end
		log[attackerState.player] = (log[attackerState.player] or 0) + amount
	end

	Net.toPlayer("DamageTaken", victim, {
		amount = amount,
		remaining = humanoid.Health,
		from = attacker and attacker.Name or nil,
	})

	if attackerState and attackerState.player ~= victim then
		Net.toPlayer("HitConfirm", attackerState.player, {
			kind = isHeadshot and "headshot" or "hit",
			amount = amount,
			victim = victim.Name,
		})
	end

	if humanoid.Health <= 0 then
		Match.eliminate(victim, attacker, weaponName, isHeadshot)
	end

	Match.pushHud(state)
	return amount
end

function Match.eliminate(victim: Player, attacker: Player?, weaponName: string?, isHeadshot: boolean?)
	local state = playerStates[victim]
	if not state or not state.alive then
		return
	end
	state.alive = false
	state.deaths += 1
	state.lastDeathAt = now()

	-- Let hero systems drop this player's live effects (dashes, domes, stations).
	for _, hook in ipairs(deathHooks) do
		pcall(hook, victim)
	end

	addStat(victim, "Deaths", 1)

	local victimHero = Heroes.get(state.hero)
	local killerName = attacker and attacker.Name or "the arena"
	local weaponLabel = weaponName and (Weapons.get(weaponName) and Weapons.get(weaponName).displayName or weaponName)
		or victimHero.displayName

	-- Determine the killer's current weapon name for the feed.
	local killerState = attacker and playerStates[attacker] or nil
	if killerState then
		weaponLabel = killerState.weaponDisplay or weaponLabel
	end

	Net.toAll("KillFeed", {
		killer = killerName,
		killerHero = killerState and Heroes.get(killerState.hero).displayName or nil,
		killerTeam = killerState and killerState.team or nil,
		victim = victim.Name,
		victimHero = victimHero.displayName,
		victimTeam = state.team,
		weapon = weaponLabel,
		headshot = isHeadshot == true,
	})

	-- Assist payout.
	local log = damageLog[victim]
	if log then
		for helper, total in pairs(log) do
			if helper ~= attacker and total >= 40 and helper ~= victim then
				local helperState = playerStates[helper]
				if helperState then
					helperState.assists += 1
					addStat(helper, "Kills", 0)
					Match.addCredits(helper, Config.Economy.AssistReward)
					Match.notify(helper, string.format("Assist  +%d", Config.Economy.AssistReward), Config.Palette.Cyan)
					Match.pushHud(helperState)
				end
			end
		end
		damageLog[victim] = nil
	end

	if killerState then
		killerState.kills += 1
		addStat(attacker :: Player, "Kills", 1)
		Match.addCredits(attacker :: Player, Config.Economy.KillReward)
		addStat(attacker :: Player, "XP", Config.Progression.Xp.Kill)
		Net.toPlayer("HitConfirm", attacker :: Player, {
			kind = "kill",
			amount = 0,
			victim = victim.Name,
		})
		Match.pushHud(killerState)
	end

	-- Warmup kills are practice; they never score.
	if Match.state.phase == Phase.Action then
		local winner = Match.checkRoundEnd()
		if winner then
			Match.endRound(winner)
		end
	end

	-- Corpse cleanup: hide the body quickly so it never blocks a sightline.
	local character = victim.Character
	if character then
		task.delay(1.5, function()
			if character.Parent and not state.alive then
				character:Destroy()
			end
		end)
	end
end

-- ---------------------------------------------------------------------------
-- Spawning
-- ---------------------------------------------------------------------------
local function pickSpawn(team: number): CFrame
	if not Arena then
		return CFrame.new(0, 20, 0)
	end
	local spec = Arena.Layout.Spawns[team]
	local points = spec.points
	-- Prefer the spawn point furthest from any living enemy.
	local best = points[1]
	local bestScore = -math.huge
	for _, point in ipairs(points) do
		local score = math.huge
		for _, state in pairs(playerStates) do
			if state.alive and state.team ~= team then
				local character = state.player.Character
				local root = character and character:FindFirstChild("HumanoidRootPart")
				if root then
					score = math.min(score, (root.Position - point).Magnitude)
				end
			end
		end
		if score == math.huge then
			score = 0
		end
		score += math.random() * 4 -- break ties so players do not stack
		if score > bestScore then
			bestScore = score
			best = point
		end
	end
	return CFrame.lookAt(best, Vector3.new(0, best.Y, 0))
end

function Match.spawnPlayer(player: Player)
	local state = playerStates[player]
	if not state then
		return
	end
	-- Only live phases spawn bodies.
	local live = Match.state.phase == Phase.Action
		or Match.state.phase == Phase.Warmup
		or Match.state.phase == Phase.Buy
	if not live then
		return
	end

	-- Destroying the old body fires Humanoid.Died; suppress the double count.
	state.pendingRespawn = true
	state.alive = false
	local character = player.Character
	if character then
		character:Destroy()
	end

	character = player:LoadCharacter()
	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid
	local root = character:WaitForChild("HumanoidRootPart", 10) :: BasePart
	if not humanoid or not root then
		state.pendingRespawn = false
		return
	end
	state.pendingRespawn = false

	local hero = Heroes.get(state.hero)
	humanoid.MaxHealth = hero.health
	humanoid.Health = hero.health
	humanoid.WalkSpeed = hero.walkSpeed
	humanoid.JumpPower = Config.Movement.JumpPower
	humanoid.UseJumpPower = true
	humanoid.BreakJointsOnDeath = true
	humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None

	character:PivotTo(pickSpawn(state.team))

	-- Team-coloured body, so enemies read instantly at a glance.
	for _, part in ipairs(Util.characterParts(character)) do
		if part.Name ~= "HumanoidRootPart" then
			local isHead = part.Name == "Head"
			part.Color = isHead and Config.Palette.White or Config.Teams[state.team].Color
			part.Material = Enum.Material.SmoothPlastic
		end
	end

	state.alive = true
	state.spawnedAt = now()
	state.armor = math.min(state.armor, state.maxArmor)
	state.lastUltimate = state.lastUltimate or -math.huge

	Match.giveWeapon(state)
	Match.pushLoadout(state)
	Match.pushHud(state)
	Match.broadcastState()
end

--- Respawns everyone who is dead, used at the start of each round.
function Match.respawnAll()
	for _, state in pairs(playerStates) do
		state.armor = state.maxArmor
		Match.spawnPlayer(state.player)
	end
end

-- ---------------------------------------------------------------------------
-- Phases
-- ---------------------------------------------------------------------------
local function setPhase(phase: string, duration: number)
	Match.state.phase = phase
	Match.state.phaseEnds = duration == math.huge and math.huge or (now() + duration)
	Match.broadcastState()
end

--- How many players are needed before a match can run.
local function hasEnoughPlayers(): boolean
	return #Players:GetPlayers() >= Config.Match.MinPlayers
end

function Match.startRound()
	Match.state.round += 1
	-- During the buy phase purchases are allowed but nobody may shoot.
	Match.state.buyLocked = false
	Match.state.canBuy = true

	-- Strip loadouts back to nothing: you rebuy every round.
	for _, state in pairs(playerStates) do
		state.armor = 0
		state.maxArmor = 0
		state.hasStim = false
		state.grenades = { he = 0, flash = 0 }
		state.weapon = "sidearm"
		state.roundKills = 0
	end

	for _, state in pairs(playerStates) do
		if state.phaseKills then
			state.phaseKills = 0
		end
	end

	setPhase(Phase.Buy, Config.Match.BuyTime)
	Match.banner(string.format("Round %d", Match.state.round), "Buy phase - pick a hero and a gun", Config.Palette.Cyan)
	playCueAll(Config.Audio.RoundStart, 0.4)

	-- Everybody gets a fresh body for the buy phase.
	task.spawn(function()
		Match.respawnAll()
		for _, state in pairs(playerStates) do
			state.frozen = true
		end
	end)
end

function Match.beginAction()
	Match.state.canBuy = false
	setPhase(Phase.Action, Config.Match.RoundTime)
	Match.banner(
		"FIGHT",
		string.format("%s %d - %d %s", Config.Teams[2].Name, Match.state.scores[2], Match.state.scores[1], Config.Teams[1].Name),
		Config.Palette.Amber
	)
	-- Freeze is lifted with a short countdown so nobody leaves spawn early.
	task.spawn(function()
		for _, state in pairs(playerStates) do
			Match.notify(state.player, "Fight!", Config.Palette.Amber)
		end
	end)
	for _, state in pairs(playerStates) do
		state.frozen = false
		Match.pushHud(state)
	end
end

--- Returns the winning team number if the round is decided, else nil.
function Match.checkRoundEnd(): number?
	local alive1 = Match.teamAlive(1)
	local alive2 = Match.teamAlive(2)

	-- Count teams that actually have players; a one-team server has no winner.
	local team1Players = #Match.teamPlayers(1)
	local team2Players = #Match.teamPlayers(2)
	if team1Players == 0 or team2Players == 0 then
		return nil
	end

	if alive1 == 0 and alive2 == 0 then
		return nil -- double KO: handled by the timer/draw path
	elseif alive1 == 0 then
		return 2
	elseif alive2 == 0 then
		return 1
	end
	return nil
end

function Match.endRound(winner: number)
	if Match.state.phase == Phase.RoundEnd or Match.state.phase == Phase.MatchEnd then
		return
	end

	Match.state.scores[winner] += 1
	local loser = Util.enemyTeam(winner)
	Match.state.lossStreak[loser] += 1
	Match.state.lossStreak[winner] = 0

	-- Payouts.
	for _, state in pairs(playerStates) do
		local base = state.team == winner and Config.Economy.RoundWin or Config.Economy.RoundLoss
		local bonus = 0
		if state.team == loser then
			bonus = math.min(
				Config.Economy.LossStreakBonus * math.max(0, Match.state.lossStreak[loser] - 1),
				Config.Economy.LossStreakBonusMax
			)
		end
		local survival = state.alive and Config.Economy.SurvivalBonus or 0
		local total = base + bonus + survival
		state.credits = Util.clamp(state.credits + total, 0, Config.Economy.MaxCredits)
		lastRoundReward[state.player] = total

		local credited = state.team == winner
		Match.notify(state.player, string.format("%s  +%d credits", credited and "Round won" or "Round lost", total), credited and Config.Palette.Green or Config.Palette.Red)
		if credited then
			addStat(state.player, "Rounds", 1)
			addStat(state.player, "XP", Config.Progression.Xp.RoundWon)
		end
		Match.pushHud(state)
	end

	local teamName = Config.Teams[winner].Name
	Match.banner(
		string.format("%s take the round", teamName),
		string.format("%d - %d", Match.state.scores[1], Match.state.scores[2]),
		Config.Teams[winner].Color
	)
	playCueAll(Config.Audio.RoundWin, 0.4)

	local achieved = Match.state.scores[winner]
	if achieved >= Config.Match.RoundsToWin then
		setPhase(Phase.MatchEnd, 15)
		Match.state.winner = winner
		Match.banner(string.format("%s WIN THE MATCH", string.upper(teamName)), string.format("Final %d - %d", Match.state.scores[1], Match.state.scores[2]), Config.Teams[winner].Color)
		for _, state in pairs(playerStates) do
			addStat(state.player, "XP", Config.Progression.Xp.MatchPlayed)
			if state.team == winner then
				addStat(state.player, "XP", Config.Progression.Xp.MatchWin)
				addStat(state.player, "Rating", Config.Progression.RatingPerWin)
			else
				addStat(state.player, "Rating", Config.Progression.RatingPerLoss)
			end
			local rating = 0
			local leaderstats = state.player:FindFirstChild("leaderstats")
			local ratingValue = leaderstats and leaderstats:FindFirstChild("Rating")
			if ratingValue and ratingValue:IsA("IntValue") then
				rating = ratingValue.Value
			end
			Match.notify(state.player, string.format("Rank: %s (%d)", rankFor(rating), rating), Config.Palette.Violet)
		end
		Match.state.lastWinner = winner
		task.delay(15, function()
			Match.resetMatch()
		end)
		return
	end

	setPhase(Phase.RoundEnd, Config.Match.RoundEndTime)

	-- Halftime: swap sides the first time a team reaches the swap threshold.
	if achieved == Config.Match.HalftimeSwapAt then
		Match.state.halftimeDone = true
		task.delay(2, function()
			for _, state in pairs(playerStates) do
				state.team = Util.enemyTeam(state.team)
			end
			Match.banner("SIDES SWAPPED", "Finish it.", Config.Palette.Amber)
			Match.respawnAll()
		end)
	end
end

function Match.draw()
	Match.banner("DRAW", "No point awarded", Config.Palette.Gray)
	setPhase(Phase.RoundEnd, Config.Match.RoundEndTime)
end

function Match.resetMatch()
	Match.state.scores[1] = 0
	Match.state.scores[2] = 0
	Match.state.round = 0
	Match.state.winner = nil
	Match.state.lossStreak[1] = 0
	Match.state.lossStreak[2] = 0
	Match.state.halftimeDone = false
	for _, state in pairs(playerStates) do
		state.credits = Config.Economy.StartCredits
		state.kills = 0
		state.deaths = 0
		state.assists = 0
		state.weapon = "sidearm"
		state.hero = state.hero or Heroes.default
		Match.pushHud(state)
	end
	Match.startRound()
end

-- ---------------------------------------------------------------------------
-- Main loop
-- ---------------------------------------------------------------------------
function Match.init()
	-- Build the arena and wire its jump pad.
	if Arena then
		Arena.build()
		Arena.activate()
		Arena.watchCeiling()
	else
		warn("[RIVALS] Arena module missing: running with an empty map")
	end

	-- Ceiling on credits every second is unnecessary; push HUD on demand instead.
	-- Armor regeneration tick for the Tank's Heavy Armor.
	task.spawn(function()
		while true do
			task.wait(1)
			for _, state in pairs(playerStates) do
				if state.alive and state.maxArmor > 0 and state.armor < state.maxArmor then
					local last = lastDamageAt[state.player]
					if last and now() - last >= Config.Combat.ShieldRegenDelay then
						state.armor = math.min(state.maxArmor, state.armor + Config.Combat.ShieldRegenPerSecond)
						Match.pushHud(state)
					end
				end
			end
		end
	end)

	task.spawn(function()
		while true do
			task.wait(0.25)
			local state = Match.state
			local phase = state.phase

			if phase == Phase.Warmup then
				if hasEnoughPlayers() then
					state.started = true
					Match.banner("RIVALS", "First to " .. Config.Match.RoundsToWin .. " rounds", Config.Palette.Cyan)
					task.wait(2)
					Match.startRound()
				else
					state.phaseEnds = math.huge
				end
			elseif phase == Phase.Buy then
				if not hasEnoughPlayers() then
					Match.banner("WAITING FOR PLAYERS", "Match paused", Config.Palette.Gray)
					Match.state.canBuy = false
					while not hasEnoughPlayers() do
						task.wait(1)
					end
					Match.banner("RESUMING", "", Config.Palette.Cyan)
					Match.startRound()
				elseif now() >= state.phaseEnds then
					Match.beginAction()
				end
			elseif phase == Phase.Action then
				-- Round can end early with an elimination.
				local winner = Match.checkRoundEnd()
				if winner then
					Match.endRound(winner)
				elseif now() >= state.phaseEnds then
					-- Timeout: decide by remaining team health.
					local fraction1 = Match.teamHealthFraction(1)
					local fraction2 = Match.teamHealthFraction(2)
					if math.abs(fraction1 - fraction2) < 0.001 then
						Match.draw()
					else
						Match.endRound(fraction1 > fraction2 and 1 or 2)
					end
				else
					-- Push a lightweight timer update twice a second.
					Match.broadcastState()
				end
			elseif phase == Phase.RoundEnd then
				if now() >= state.phaseEnds then
					Match.startRound()
				end
			elseif phase == Phase.MatchEnd then
				-- resetMatch handles the transition on its own timer.
			end
		end
	end)

	return Match
end

-- ---------------------------------------------------------------------------
-- Player lifecycle
-- ---------------------------------------------------------------------------
function Match.setupPlayer(player: Player)
	local team = Match.assignTeam()
	local state = {
		player = player,
		team = team,
		hero = Heroes.default,
		weapon = "sidearm",
		weaponDisplay = "Sidearm",
		credits = Config.Economy.StartCredits,
		armor = 0,
		maxArmor = 0,
		hasStim = false,
		grenades = { he = 0, flash = 0 },
		kills = 0,
		deaths = 0,
		assists = 0,
		alive = false,
		frozen = true,
		lastUltimate = -math.huge,
		lastDeathAt = 0,
		spawnedAt = 0,
		roundKills = 0,
	}
	playerStates[player] = state
	ensureLeaderstats(player)
	lastDamageAt[player] = 0

	-- Any death that did not route through applyDamage (falling off the map, for
	-- example) still needs to count. Respawns destroy the old body on purpose,
	-- so pendingRespawn suppresses the resulting Died event.
	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid", 10)
		if humanoid and humanoid:IsA("Humanoid") then
			humanoid.Died:Connect(function()
				if state.alive and not state.pendingRespawn then
					Match.eliminate(player, nil, nil, false)
				end
			end)
		end
	end)

	Match.notify(player, string.format("You are on team %s", Config.Teams[team].Name), Config.Teams[team].Color)
	Match.pushHud(state)

	-- Warmup gets a free body so players can learn the map while waiting.
	if Match.state.phase == Phase.Warmup then
		task.spawn(function()
			Match.spawnPlayer(player)
		end)
	end
end

function Match.removePlayer(player: Player)
	playerStates[player] = nil
	damageLog[player] = nil
	lastDamageAt[player] = nil
	Match.broadcastState()
end

--- Smallest team gets the next player; ties go to team 1.
function Match.assignTeam(): number
	local count1 = 0
	local count2 = 0
	for _, state in pairs(playerStates) do
		if state.team == 1 then
			count1 += 1
		elseif state.team == 2 then
			count2 += 1
		end
	end
	if count1 <= count2 then
		return 1
	end
	return 2
end

--- Number of seconds left in the current phase, for the HUD.
function Match.timeLeft(): number
	return math.max(0, Match.state.phaseEnds - now())
end

--- Arms the next round's buy phase. Called by ShopServer after a purchase.
function Match.refreshLoadout(player: Player)
	local state = playerStates[player]
	if state then
		Match.pushLoadout(state)
	end
end

Match.PlayerStates = playerStates

return Match
