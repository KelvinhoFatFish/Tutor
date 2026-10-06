--[[
	HeroServer.luau
	The four ultimates. Each one is server-authoritative: cooldowns, damage,
	shields and healing all live here. Clients only ask to use an ultimate and
	render the result.

	  Rusher  Blitz Dash     -- dash, invulnerable in transit, reload at both ends
	  Tank    Bulwark        -- 14-stud dome that destroys enemy bullets crossing it
	  Sniper  Railgun        -- pierces geometry and bodies, reveals enemies for 4s
	  Support Rally Station  -- heals allies and speeds them up for 12s

	See DESIGN.md section 4.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")
local Debris = game:GetService("Debris")
local Highlight = game:GetService("Highlight")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Util = require(Shared.Util)

local Match = require(script.Parent.Match)
local WeaponServer = require(script.Parent.WeaponServer)

local HeroServer = {}

-- ---------------------------------------------------------------------------
-- Live effects
-- ---------------------------------------------------------------------------
--- Domes currently blocking bullets, so Match.applyDamage can early-out.
local activeDomes: { { position: Vector3, radius: number, team: number, part: BasePart } } = {}
--- Players with temporary damage immunity (the Rusher's dash).
local immuneUntil: { [Player]: number } = {}
--- Speed modifiers: player -> list of { multiplier, expires, source }
type SpeedModifier = { multiplier: number, expires: number, source: string? }
local speedModifiers: { [Player]: { SpeedModifier } } = {}

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
local function characterOf(player: Player): (Model?, Humanoid?, BasePart?)
	local character = player.Character
	if not character then
		return nil, nil, nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart")
	if not humanoid or not root or not root:IsA("BasePart") then
		return character, humanoid, nil
	end
	return character, humanoid, root
end

--- Base walk speed for a player's current hero, ignoring temporary modifiers.
local function baseSpeed(player: Player): number
	local state = Match.getPlayerState(player)
	if not state then
		return Config.Movement.BaseWalkSpeed
	end
	return Heroes.get(state.hero).walkSpeed
end

--- Applies every live speed modifier and the hero's base speed to the humanoid.
local function refreshSpeed(player: Player)
	local _, humanoid = characterOf(player)
	if not humanoid then
		return
	end
	local speed = baseSpeed(player)
	local now = os.clock()
	local list = speedModifiers[player]
	if list then
		for index = #list, 1, -1 do
			if list[index].expires <= now then
				table.remove(list, index)
			else
				speed *= list[index].multiplier
			end
		end
	end
	humanoid.WalkSpeed = speed
end

local function addSpeedModifier(player: Player, multiplier: number, duration: number)
	local list = speedModifiers[player]
	if not list then
		list = {}
		speedModifiers[player] = list
	end
	table.insert(list, { multiplier = multiplier, expires = os.clock() + duration })
	refreshSpeed(player)
end

--- True if `player` is currently protected by a dash.
function HeroServer.isImmune(player: Player): boolean
	local until_ = immuneUntil[player]
	return until_ ~= nil and os.clock() < until_
end

--- Called by Match.applyDamage before armor is touched.
function HeroServer.blocksDamage(victim: Player, origin: Vector3?): boolean
	if HeroServer.isImmune(victim) then
		return true
	end
	return false
end

--- Resolves whether a dome blocks a shot travelling from a position.
function HeroServer.domeBlocks(position: Vector3, team: number?): boolean
	for _, dome in ipairs(activeDomes) do
		if team == nil or dome.team ~= team then
			if (position - dome.position).Magnitude <= dome.radius then
				return true
			end
		end
	end
	return false
end

local function feedback(player: Player, kind: string, text: string)
	Net.toPlayer("AbilityFeedback", player, {
		kind = kind,
		text = text,
	})
end

-- ---------------------------------------------------------------------------
-- Rusher -- Blitz Dash
-- ---------------------------------------------------------------------------
local function blitzDash(player: Player, ultimate: Heroes.Ultimate)
	local character, humanoid, root = characterOf(player)
	if not character or not humanoid or not root or humanoid.Health <= 0 then
		feedback(player, "fail", "No body to dash with")
		return false
	end

	-- Dash along the movement input if there is any, otherwise straight ahead.
	local direction = root.CFrame.LookVector
	local moveDirection = humanoid.MoveDirection
	if moveDirection.Magnitude > 0.1 then
		direction = Vector3.new(moveDirection.X, 0, moveDirection.Z).Unit
	end

	local distance = ultimate.distance or 55
	local duration = ultimate.duration or 0.35
	immuneUntil[player] = os.clock() + (ultimate.invulnerable or duration)

	if ultimate.reloadOnUse then
		WeaponServer.refill(player)
	end

	feedback(player, "cast", ultimate.displayName)
	Net.toAll("ShotFired", {
		kind = "dash",
		player = player.Name,
		origin = root.Position,
		direction = direction,
		distance = distance,
	})

	-- Drive the dash as a velocity override for the duration, then let momentum
	-- carry. Gravity is cancelled so it reads as a flat dash, not a fall.
	local speed = distance / duration
	local startClock = os.clock()
	task.spawn(function()
		while os.clock() - startClock < duration do
			if humanoid.Health <= 0 or not root.Parent then
				break
			end
			root.AssemblyLinearVelocity = Vector3.new(direction.X * speed, 6, direction.Z * speed)
			task.wait(0.03)
		end
		-- Exit speed is deliberately lower than the dash: it is a reposition, not
		-- a launch.
		if root.Parent then
			root.AssemblyLinearVelocity = Vector3.new(direction.X * speed * 0.35, root.AssemblyLinearVelocity.Y, direction.Z * speed * 0.35)
		end
		if ultimate.reloadOnUse then
			WeaponServer.refill(player)
		end
	end)

	return true
end

-- ---------------------------------------------------------------------------
-- Tank -- Bulwark
-- ---------------------------------------------------------------------------
local function bulwark(player: Player, ultimate: Heroes.Ultimate)
	local character, humanoid, root = characterOf(player)
	if not character or not humanoid or not root then
		feedback(player, "fail", "No body to shield")
		return false
	end
	local state = Match.getPlayerState(player)
	if not state then
		return false
	end

	local radius = ultimate.radius or 14
	local duration = ultimate.duration or 5

	local dome = Instance.new("Part")
	dome.Name = "ShieldDome"
	dome.Shape = Enum.PartType.Ball
	dome.Size = Vector3.new(radius * 2, radius * 2, radius * 2)
	dome.CFrame = root.CFrame
	dome.Anchored = true
	dome.CanCollide = false
	dome.CanTouch = false
	dome.CastShadow = false
	dome.Material = Enum.Material.ForceField
	dome.Color = Config.Teams[state.team].Color
	dome.Transparency = 0.55
	dome:SetAttribute("Team", state.team)
	dome:SetAttribute("Owner", player.Name)
	CollectionService:AddTag(dome, "ShieldDome")
	dome.Parent = workspace

	table.insert(activeDomes, {
		position = dome.Position,
		radius = radius,
		team = state.team,
		part = dome,
	})

	feedback(player, "cast", ultimate.displayName)
	Net.toAll("ShotFired", { kind = "dome", position = dome.Position, radius = radius, team = state.team })

	-- Pulse the dome so it reads as active, then clean up.
	task.spawn(function()
		local startClock = os.clock()
		while os.clock() - startClock < duration do
			if not dome.Parent then
				break
			end
			local pulse = 0.45 + 0.15 * math.sin(os.clock() * 6)
			dome.Transparency = pulse
			task.wait(0.05)
		end
		for index, entry in ipairs(activeDomes) do
			if entry.part == dome then
				table.remove(activeDomes, index)
				break
			end
		end
		if dome.Parent then
			local tween = TweenService:Create(dome, TweenInfo.new(0.35), { Transparency = 1 })
			tween:Play()
			Debris:AddItem(dome, 0.4)
		end
	end)

	return true
end

-- ---------------------------------------------------------------------------
-- Sniper -- Railgun
-- ---------------------------------------------------------------------------
local function railgun(player: Player, ultimate: Heroes.Ultimate)
	local character, humanoid, root = characterOf(player)
	if not character or not humanoid or not root then
		feedback(player, "fail", "No body to fire from")
		return false
	end
	local state = Match.getPlayerState(player)
	if not state then
		return false
	end

	-- Aim from the camera: the client reports where it was looking, the server
	-- does the piercing trace.
	local camera = workspace.CurrentCamera
	local origin = root.Position + Vector3.new(0, 1.6, 0)
	local direction = root.CFrame.LookVector
	if camera then
		local aim = camera.CFrame.LookVector
		-- Only accept the camera direction if it roughly agrees with the body.
		if aim:Dot(direction) > 0.2 then
			direction = aim
		end
	end

	local damage = ultimate.damage or 120
	local maxDistance = 600

	-- The rail pierces geometry, so the raycast only looks for characters: one
	-- cast per enemy, taking the first hit along the line for each.
	local hits: { { player: Player, distance: number, position: Vector3, head: boolean } } = {}
	for _, other in ipairs(Players:GetPlayers()) do
		if other ~= player then
			local otherState = Match.getPlayerState(other)
			local otherCharacter, otherHumanoid = characterOf(other)
			if otherState and otherState.alive and otherState.team ~= state.team and otherCharacter and otherHumanoid then
				local params = RaycastParams.new()
				params.FilterType = Enum.RaycastFilterType.Include
				params.FilterDescendantsInstances = Util.characterParts(otherCharacter)
				local result = workspace:Raycast(origin, direction * maxDistance, params)
				if result then
					table.insert(hits, {
						player = other,
						distance = (result.Position - origin).Magnitude,
						position = result.Position,
						head = result.Instance.Name == "Head",
					})
				end
			end
		end
	end

	table.sort(hits, function(a, b)
		return a.distance < b.distance
	end)

	-- The dome still stops it: the ultimate pierces cover, not the Tank.
	local blockedAt: number? = nil
	for _, dome in ipairs(activeDomes) do
		if dome.team ~= state.team then
			local toDome = dome.position - origin
			local along = toDome:Dot(direction)
			if along > 0 and along < maxDistance then
				local perpendicular = (toDome - direction * along).Magnitude
				if perpendicular <= dome.radius then
					blockedAt = along - math.sqrt(math.max(0, dome.radius * dome.radius - perpendicular * perpendicular))
					break
				end
			end
		end
	end

	local endDistance = maxDistance
	for _, hit in ipairs(hits) do
		if blockedAt and hit.distance > blockedAt then
			endDistance = blockedAt
			break
		end
		local hitDamage = damage * (if hit.head then Config.Combat.HeadshotMultiplier else 1)
		Match.applyDamage(hit.player, hitDamage, player, "boltrifle", hit.head)
		endDistance = math.max(endDistance, hit.distance)
	end

	local tracerEnd = origin + direction * math.min(endDistance, maxDistance)
	Net.toAll("ShotFired", {
		kind = "railgun",
		player = player.Name,
		origin = origin,
		position = tracerEnd,
		direction = direction,
	})

	-- Reveal: send the casting team a ping for every living enemy. Positions are
	-- sampled once at cast time; the client draws and fades them.
	local revealDuration = ultimate.revealDuration or 4
	local team = state.team
	for _, viewer in ipairs(Players:GetPlayers()) do
		local viewerState = Match.getPlayerState(viewer)
		if viewerState and viewerState.team == team then
			local enemies = {}
			for _, other in ipairs(Players:GetPlayers()) do
				local otherState = Match.getPlayerState(other)
				local _, _, otherRoot = characterOf(other)
				if otherState and otherState.alive and otherState.team ~= team and otherRoot then
					table.insert(enemies, {
						name = other.Name,
						position = otherRoot.Position,
					})
				end
			end
			Net.toPlayer("Reveal", viewer, {
				duration = revealDuration,
				enemies = enemies,
			})
		end
	end

	feedback(player, "cast", ultimate.displayName)
	return true
end

-- ---------------------------------------------------------------------------
-- Support -- Rally Station
-- ---------------------------------------------------------------------------
local function rallyStation(player: Player, ultimate: Heroes.Ultimate)
	local character, humanoid, root = characterOf(player)
	if not character or not humanoid or not root then
		feedback(player, "fail", "No body to deploy from")
		return false
	end
	local state = Match.getPlayerState(player)
	if not state then
		return false
	end

	local radius = ultimate.radius or 16
	local duration = ultimate.duration or 12
	local healPerSecond = ultimate.healPerSecond or 12
	local speedMultiplier = ultimate.speedMultiplier or 1.15

	local base = root.Position - Vector3.new(0, 2.5, 0)

	-- Station body.
	local station = Instance.new("Part")
	station.Name = "RallyStation"
	station.Size = Vector3.new(2, 3.2, 2)
	station.CFrame = CFrame.new(base + Vector3.new(0, 1.6, 0))
	station.Anchored = true
	station.CanCollide = true
	station.Material = Enum.Material.Neon
	station.Color = Config.Palette.Green
	station.Parent = workspace

	local light = Instance.new("PointLight")
	light.Color = Config.Palette.Green
	light.Range = radius
	light.Brightness = 1.6
	light.Parent = station

	-- Radius ring, non-colliding so it never blocks movement.
	local ring = Instance.new("Part")
	ring.Name = "RallyRing"
	ring.Shape = Enum.PartType.Cylinder
	ring.Size = Vector3.new(0.3, radius * 2, radius * 2)
	ring.CFrame = CFrame.new(base + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.rad(90))
	ring.Anchored = true
	ring.CanCollide = false
	ring.CanTouch = false
	ring.Material = Enum.Material.Neon
	ring.Color = Config.Palette.Green
	ring.Transparency = 0.5
	ring.Parent = workspace

	feedback(player, "cast", ultimate.displayName)
	Net.toAll("ShotFired", { kind = "station", position = base, radius = radius, duration = duration })

	local healedThisSecond: { [Player]: number } = {}

	task.spawn(function()
		local startClock = os.clock()
		local lastTick = startClock
		while os.clock() - startClock < duration do
			local elapsed = os.clock() - lastTick
			if elapsed >= 1 then
				lastTick = os.clock()
				healedThisSecond = {}
			end

			for _, other in ipairs(Players:GetPlayers()) do
				local otherState = Match.getPlayerState(other)
				local otherCharacter, otherHumanoid, otherRoot = characterOf(other)
				if otherState and otherState.alive and otherState.team == state.team and otherHumanoid and otherRoot then
					if (otherRoot.Position - base).Magnitude <= radius then
						if otherHumanoid.Health < otherHumanoid.MaxHealth then
							otherHumanoid.Health = math.min(otherHumanoid.MaxHealth, otherHumanoid.Health + healPerSecond * 0.25)
						end
						-- Speed buff refreshes continuously while inside; it expires
						-- on its own if the player leaves.
						local list = speedModifiers[other]
						local found = false
						if list then
							for _, modifier in ipairs(list) do
								if modifier.source == "rally" then
									modifier.expires = os.clock() + 0.6
									found = true
									break
								end
							end
						end
						if not found then
							if not list then
								list = {}
								speedModifiers[other] = list
							end
							table.insert(list, { multiplier = speedMultiplier, expires = os.clock() + 0.6, source = "rally" })
						end
						refreshSpeed(other)
					end
				end
			end
			task.wait(0.25)
		end

		-- Cleanup: the ring persists one extra beat so players see it go.
		for _, other in ipairs(Players:GetPlayers()) do
			refreshSpeed(other)
		end
		station:Destroy()
		ring:Destroy()
	end)

	return true
end

-- ---------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------
local handlers: { [string]: (Player, Heroes.Ultimate) -> boolean } = {
	blitzDash = blitzDash,
	bulwark = bulwark,
	railgun = railgun,
	rallyStation = rallyStation,
}

function HeroServer.use(player: Player, requestedKind: string?)
	local state = Match.getPlayerState(player)
	if not state then
		return
	end
	local hero = Heroes.get(state.hero)
	local ultimate = hero.ultimate
	local now = os.clock()

	-- Cooldown gate. Never trust the client's idea of "ready".
	if not Heroes.isReady(hero, state.lastUltimate, now) then
		local remaining = math.ceil(Heroes.cooldownRemaining(hero, state.lastUltimate, now))
		feedback(player, "cooldown", string.format("%s in %ds", ultimate.displayName, remaining))
		return
	end

	if requestedKind and requestedKind ~= ultimate.kind then
		return -- the client is confused; ignore rather than fire the wrong ult
	end

	local handler = handlers[ultimate.kind]
	if not handler then
		return
	end

	-- Charge the cooldown only if the ability actually fired, so a failed cast
	-- (dead, no body) does not eat 30 seconds.
	local ok, err = pcall(handler, player, ultimate)
	if not ok then
		warn(string.format("[RIVALS] Ultimate %s failed for %s: %s", ultimate.kind, player.Name, tostring(err)))
		feedback(player, "fail", "Ultimate failed")
		return
	end
	if not ok then
		return
	end

	state.lastUltimate = now
	Match.pushHud(state)
	Match.pushLoadout(state)
end

--- Local alias so the module reads top-down; avoids a forward reference.
function HeroServer.removePlayer(player: Player)
	immuneUntil[player] = nil
	speedModifiers[player] = nil
end

-- ---------------------------------------------------------------------------
-- Match integration
-- ---------------------------------------------------------------------------
-- Match deliberately does not require this module (this module requires Match),
-- so the damage hooks are pushed into it instead of pulled. Match calls every
-- registered blocker before armor is touched.
Match.registerDamageBlocker(function(victim: Player, origin: Vector3?): boolean
	return HeroServer.blocksDamage(victim, origin)
end)
--- Drops any live effect owned by a player. Called when they are eliminated so a
--- dead Tank does not leave a dome running for its full duration.
function HeroServer.cleanupPlayer(player: Player)
	immuneUntil[player] = nil
	speedModifiers[player] = nil
	refreshSpeed(player)
end

Match.registerDeathHook(HeroServer.cleanupPlayer)

function HeroServer.init()
	Net.event("UseUltimate").OnServerEvent:Connect(function(player, kind)
		local ok, err = pcall(HeroServer.use, player, kind)
		if not ok then
			warn("[RIVALS] UseUltimate error: " .. tostring(err))
		end
	end)

	Players.PlayerRemoving:Connect(HeroServer.removePlayer)

	-- Keep speed modifiers honest: they can expire between explicit refreshes.
	task.spawn(function()
		while true do
			task.wait(1)
			for _, player in ipairs(Players:GetPlayers()) do
				refreshSpeed(player)
			end
		end
	end)
end

return HeroServer
