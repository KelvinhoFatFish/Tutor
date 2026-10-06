--[[
	WeaponServer.luau
	Authoritative gunplay.

	  * Builds one Tool per weapon in ReplicatedStorage.WeaponTemplates at startup
	  * Validates every fire request (phase, cooldown, ammo, origin sanity)
	  * Does the raycast and damage on the server -- the client only reports where
	    it was aiming, never what it hit
	  * Handles reloads, auto-reload, and melee

	Damage is routed through Match.applyDamage so armor, assists and elimination
	all live in one place.

	See DESIGN.md sections 3 and 6.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")
local Debris = game:GetService("Debris")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Net = require(Shared.Net)
local Util = require(Shared.Util)
local Weapons = require(Shared.Weapons)

local Match = require(script.Parent.Match)

local WeaponServer = {}

local Phase = Config.Phase

-- ---------------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------------
type GunState = {
	weapon: string,
	tool: Tool,
	ammo: number,
	lastShot: number,
	reloading: boolean,
	reloadToken: number,
	burstLeft: number,
	equipped: boolean,
}

local gunStates: { [Player]: GunState? } = {}
local templates: Folder

-- ---------------------------------------------------------------------------
-- Model building
-- ---------------------------------------------------------------------------
local function weld(part: BasePart, handle: BasePart)
	local constraint = Instance.new("WeldConstraint")
	constraint.Part0 = handle
	constraint.Part1 = part
	constraint.Parent = part
end

--- Builds one weapon Tool from a Weapon definition. All parts are welded to the
--- Handle, so the whole gun follows the hand with no animation work.
local function buildWeapon(weapon: Weapons.Weapon): Tool
	local tool = Instance.new("Tool")
	tool.Name = weapon.name
	tool.RequiresHandle = true
	tool.CanBeDropped = false
	tool.ToolTip = weapon.displayName
	tool:SetAttribute("Weapon", weapon.name)
	tool:SetAttribute("DisplayName", weapon.displayName)

	local visual = weapon.visual
	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(0.42, 0.62, 0.36)
	handle.Color = visual.color
	handle.Material = visual.material
	handle.CanCollide = false
	handle.Massless = true
	handle.TopSurface = Enum.SurfaceType.Smooth
	handle.BottomSurface = Enum.SurfaceType.Smooth
	handle.Parent = tool

	-- Grip: the barrel looks down the handle's -Z, matching the character's
	-- facing, and the weapon sits a little forward and below the hand.
	tool.Grip = CFrame.new(0.15, 0.15, 0.4) * CFrame.Angles(0, math.rad(-90), 0)

	local bodies = { handle }

	local function body(
		name: string,
		size: Vector3,
		offset: CFrame,
		color: Color3?,
		material: Enum.Material?
	): BasePart
		local part = Instance.new("Part")
		part.Name = name
		part.Size = size
		part.CFrame = handle.CFrame * offset
		part.Color = color or visual.color
		part.Material = material or visual.material
		part.CanCollide = false
		part.Massless = true
		part.TopSurface = Enum.SurfaceType.Smooth
		part.BottomSurface = Enum.SurfaceType.Smooth
		part.Parent = tool
		weld(part, handle)
		table.insert(bodies, part)
		return part
	end

	local length = visual.length
	local width = visual.width

	-- Receiver: the main visual mass of the gun.
	body(
		"Receiver",
		Vector3.new(width, width, length),
		CFrame.new(0, 0.06, -(length / 2)),
		visual.color,
		visual.material
	)

	-- Barrel.
	local barrelLength = visual.barrel
	if barrelLength > 0 then
		local barrel = body(
			"Barrel",
			Vector3.new(width * 0.55, width * 0.55, barrelLength),
			CFrame.new(0, 0.09, -(length + barrelLength / 2)),
			Config.Palette.DarkGray,
			Enum.Material.Metal
		)

		-- Muzzle attachment: tracers and flashes hang off this.
		local muzzle = Instance.new("Attachment")
		muzzle.Name = "Muzzle"
		muzzle.CFrame = CFrame.new(0, 0, -(barrelLength / 2))
		muzzle.Parent = barrel
	end

	-- Stock.
	if visual.stock then
		body("Stock", Vector3.new(width * 0.8, width * 0.9, length * 0.4), CFrame.new(0, -0.02, length * 0.22), visual.color, visual.material)
	end

	-- Scope / top rail.
	if visual.scope then
		body("Sight", Vector3.new(width * 0.4, width * 0.5, length * 0.3), CFrame.new(0, width * 0.72, -(length * 0.35)), Config.Palette.Cyan, Enum.Material.Neon)
	end

	-- Magazine or drum.
	if visual.drum then
		body("Drum", Vector3.new(width * 1.1, width * 1.4, width * 1.4), CFrame.new(0, -(width * 1.2), -(length * 0.4)), Config.Palette.DarkGray, Enum.Material.Metal)
	elseif not Weapons.isMelee(weapon) then
		body("Mag", Vector3.new(width * 0.7, width * 1.5, width * 0.9), CFrame.new(0, -(width * 1.15), -(length * 0.35)), Config.Palette.DarkGray, Enum.Material.Metal)
	end

	-- Rarity trim glow, so a Bolt Rifle reads differently from a Sidearm at range.
	body(
		"Trim",
		Vector3.new(width * 1.05, 0.06, length * 0.5),
		CFrame.new(0, (width * 0.52), -(length * 0.5)),
		Config.Palette.Cyan,
		Enum.Material.Neon
	)

	return tool
end

--- Creates ReplicatedStorage.WeaponTemplates with one Tool per weapon.
function WeaponServer.buildTemplates()
	local existing = ReplicatedStorage:FindFirstChild("WeaponTemplates")
	if existing then
		existing:Destroy()
	end
	templates = Instance.new("Folder")
	templates.Name = "WeaponTemplates"
	for _, weapon in ipairs(Weapons.list) do
		buildWeapon(weapon).Parent = templates
	end
	templates.Parent = ReplicatedStorage
	return templates
end

-- ---------------------------------------------------------------------------
-- Raycast filtering
-- ---------------------------------------------------------------------------
local function bulletFilter(excludeCharacter: Model?, extraIgnore: { Instance }?): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.IgnoreWater = true

	local ignore: { Instance } = {}
	if excludeCharacter then
		table.insert(ignore, excludeCharacter)
	end
	if extraIgnore then
		for _, instance in ipairs(extraIgnore) do
			table.insert(ignore, instance)
		end
	end
	params.FilterDescendantsInstances = ignore
	return params
end

--- Applies the weapon's cone of fire using a seeded RNG, so the same shot
--- produces the same spread on both sides of the network.
local function applySpread(direction: Vector3, degrees: number, seed: number): Vector3
	if degrees <= 0 then
		return direction
	end
	local random = Random.new(seed)
	local yaw = math.rad(random:NextNumber(-degrees, degrees))
	local pitch = math.rad(random:NextNumber(-degrees, degrees))
	local cframe = CFrame.lookAt(Vector3.zero, direction) * CFrame.Angles(pitch, yaw, 0)
	return cframe.LookVector
end

--- True if the ray crosses a Tank dome before reaching `distance`.
local function crossesDome(origin: Vector3, direction: Vector3, distance: number, ownerTeam: number?): boolean
	local params = bulletFilter(nil)
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = CollectionService:GetTagged("ShieldDome")
	local result = workspace:Raycast(origin, direction * distance, params)
	if not result then
		return false
	end
	local dome = result.Instance
	-- A dome blocks enemy fire only.
	local domeTeam = dome:GetAttribute("Team")
	if domeTeam ~= nil and ownerTeam ~= nil and domeTeam == ownerTeam then
		return false
	end
	return true
end

-- ---------------------------------------------------------------------------
-- FX budget
-- ---------------------------------------------------------------------------
-- A shotgun blast is 8 pellets; a firefight is several shotguns. Without a
-- budget the impact remote would dominate the network, so impacts are capped per
-- shooter per tick. The tracer from the "fire" event always goes out, so a
-- dropped impact is a dropped spark, never a missing shot.
local impactBudget: { [Player]: { count: number, window: number } } = {}
local IMPACT_MAX_PER_TICK = 6
local IMPACT_WINDOW = 0.1

local function allowImpact(player: Player): boolean
	local now = os.clock()
	local entry = impactBudget[player]
	if not entry or now - entry.window > IMPACT_WINDOW then
		impactBudget[player] = { count = 1, window = now }
		return true
	end
	if entry.count >= IMPACT_MAX_PER_TICK then
		return false
	end
	entry.count += 1
	return true
end

--- Resolves one projectile: find the hit, work out damage, apply it.
local function resolveProjectile(
	player: Player,
	weapon: Weapons.Weapon,
	origin: Vector3,
	direction: Vector3,
	distance: number,
	seed: number
): (number, boolean)
	local params = bulletFilter(player.Character)
	local result = workspace:Raycast(origin, direction * distance, params)

	if not result then
		return distance, false
	end

	local travel = (result.Position - origin).Magnitude
	local hitPart = result.Instance
	local victim, victimCharacter = Util.playerFromPart(hitPart)
	local state = Match.getPlayerState(player)

	-- Impact spark for everyone, so misses still read as shots landing.
	if allowImpact(player) then
		Net.toAll("ShotFired", {
			kind = "impact",
			position = result.Position,
			normal = result.Normal,
			weapon = weapon.name,
		})
	end

	-- Shield dome between shooter and target eats the bullet.
	if state and crossesDome(origin, direction, travel, state.team) then
		return travel, false
	end

	if not victim or victim == player or not victimCharacter then
		return travel, false
	end

	local victimState = Match.getPlayerState(victim)
	if not victimState or not victimState.alive then
		return travel, false
	end
	if victimState.team == state.team and not Config.Combat.FriendlyFire then
		return travel, false
	end

	-- Damage: base, scaled by range falloff, then by headshot.
	local isHeadshot = hitPart.Name == "Head"
	local falloff = Util.falloff(travel, weapon.rangeMin, weapon.rangeMax, Config.Combat.FalloffFloor)
	local damage = weapon.damage * falloff
	if isHeadshot then
		damage *= Weapons.headshotMultiplier(weapon)
	end
	damage = math.floor(damage * 10 + 0.5) / 10

	Match.applyDamage(victim, damage, player, weapon.name, isHeadshot)

	-- Local hit spark at the victim.
	Net.toPlayer("HitConfirm", player, {
		kind = "spark",
		position = result.Position,
	})

	return travel, true
end

-- ---------------------------------------------------------------------------
-- Gun state
-- ---------------------------------------------------------------------------
-- (The impact FX budget lives above, next to resolveProjectile which uses it.)
local function ammoFor(weapon: Weapons.Weapon): number
	return weapon.magSize
end

--- Pushes just the ammo portion of the HUD, leaving credits/armor untouched.
local function notifyAmmo(player: Player, state: GunState)
	local weapon = Weapons.get(state.weapon)
	if state.tool and state.tool.Parent then
		state.tool:SetAttribute("Ammo", state.ammo)
		state.tool:SetAttribute("Reloading", state.reloading)
	end
	Net.toPlayer("HudState", player, {
		weapon = state.weapon,
		ammo = state.ammo,
		magSize = weapon and weapon.magSize or 0,
		reloading = state.reloading,
	})
end

local function startReload(player: Player, state: GunState)
	local weapon = Weapons.get(state.weapon)
	if not weapon or Weapons.isMelee(weapon) or state.reloading then
		return
	end
	if state.ammo >= weapon.magSize then
		return
	end

	state.reloading = true
	state.reloadToken += 1
	local token = state.reloadToken
	if state.tool then
		state.tool:SetAttribute("Reloading", true)
	end
	notifyAmmo(player, state)

	Net.toAll("ShotFired", {
		kind = "reload",
		weapon = state.weapon,
		player = player.Name,
	})

	task.delay(weapon.reloadTime, function()
		-- Bail if this reload was superseded (death, weapon swap, another reload).
		if not gunStates[player] or gunStates[player] ~= state or state.reloadToken ~= token then
			return
		end
		state.reloading = false
		state.ammo = weapon.magSize
		if state.tool then
			state.tool:SetAttribute("Reloading", false)
		end
		notifyAmmo(player, state)
	end)
end

-- ---------------------------------------------------------------------------
-- Firing
-- ---------------------------------------------------------------------------
local function canShoot(player: Player): (boolean, string?)
	local phase = Match.state.phase
	if phase == Phase.Buy then
		return false, "Buy phase - no shooting"
	elseif phase == Phase.RoundEnd or phase == Phase.MatchEnd then
		return false, "Round over"
	end
	local state = Match.getPlayerState(player)
	if not state or not state.alive then
		return false, "You are dead"
	end
	return true, nil
end

--- Fires one shot: validates the payload, applies spread, traces, damages.
--- Returns true if the shot actually went out.
local function resolveShot(player: Player, gun: GunState, payload: any): boolean
	local weapon = Weapons.get(gun.weapon)
	if not weapon then
		return false
	end

	local origin = payload.origin
	local direction = payload.direction
	if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then
		return false
	end
	if origin ~= origin or direction ~= direction then
		return false -- NaN guard
	end
	if direction.Magnitude < 0.001 then
		return false
	end
	direction = direction.Unit

	local character = player.Character
	local head = character and (character:FindFirstChild("Head") or character:FindFirstChild("HumanoidRootPart"))
	if not head or not head:IsA("BasePart") then
		return false
	end

	-- Origin sanity: never let a client fire from somewhere its body is not.
	local reference = head.Position + Vector3.new(0, 1.5, 0)
	if (origin - reference).Magnitude > Config.Combat.OriginTolerance then
		return false
	end

	-- Moving or airborne fire is less accurate. The server decides this, not the
	-- client, so "I was standing still" is not something a client can claim.
	local moving = false
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart")
	if humanoid and root and root:IsA("BasePart") then
		local horizontal = Vector3.new(root.AssemblyLinearVelocity.X, 0, root.AssemblyLinearVelocity.Z)
		moving = horizontal.Magnitude > 4 or humanoid:GetState() == Enum.HumanoidStateType.Freefall
	end

	local seed = tonumber(payload.seed) or os.time()
	if seed ~= seed then
		seed = 1
	end
	local ads = payload.ads == true
	-- Written as a statement rather than an inline if-expression: this is a
	-- three-way choice and the statement form reads better.
	local spreadDegrees = weapon.spread
	if ads then
		spreadDegrees = weapon.spread * 0.35
	elseif moving then
		spreadDegrees = weapon.spreadMoving
	end
	local directionWithSpread = applySpread(direction, spreadDegrees, seed)

	-- The shot is aimed from the camera but traced from the muzzle, so the tracer
	-- visually starts at the barrel.
	local muzzleOrigin = origin
	local handle = gun.tool and gun.tool:FindFirstChild("Handle")
	if handle and handle:IsA("BasePart") then
		muzzleOrigin = handle.Position + directionWithSpread * 1.2
	end

	if Weapons.isMelee(weapon) then
		local params = bulletFilter(character)
		local result = workspace:Spherecast(origin, 2.5, directionWithSpread * weapon.rangeMax, params)
		if result then
			local victim = Util.playerFromPart(result.Instance)
			local victimState = victim and Match.getPlayerState(victim)
			local state = Match.getPlayerState(player)
			if victim and victimState and state and victimState.alive and victimState.team ~= state.team then
				local isHeadshot = result.Instance.Name == "Head"
				local damage = weapon.damage * (if isHeadshot then Weapons.headshotMultiplier(weapon) else 1)
				Match.applyDamage(victim, damage, player, weapon.name, isHeadshot)
			end
		end
	else
		local shots = math.max(1, weapon.bulletCount)
		for shot = 1, shots do
			-- Every pellet in a shotgun blast gets its own spread seed.
			resolveProjectile(
				player,
				weapon,
				muzzleOrigin,
				directionWithSpread,
				Config.Combat.MaxRayDistance,
				seed + shot * 7919
			)
		end
	end

	-- Tell everyone else a shot happened, so they see the tracer and hear it.
	Net.toOthers("ShotFired", player, {
		kind = "fire",
		player = player.Name,
		weapon = weapon.name,
		origin = muzzleOrigin,
		direction = directionWithSpread,
	})

	if handle and handle:IsA("BasePart") then
		Util.playSound(handle, weapon.sound, 0.45, Util.rand(0.95, 1.05))
	end

	return true
end

local function onFire(player: Player, payload: any)
	if type(payload) ~= "table" then
		return
	end

	local gun = gunStates[player]
	if not gun or not gun.equipped then
		return
	end

	local weapon = Weapons.get(gun.weapon)
	if not weapon then
		return
	end

	local ok = canShoot(player)
	if not ok then
		return
	end
	if gun.reloading then
		return
	end

	local now = os.clock()

	-- A burst already in flight owns the trigger until it finishes.
	if gun.burstLeft > 0 then
		return
	end

	local rate = weapon.burstSize > 1 and (weapon.fireRate + (weapon.burstSize - 1) * weapon.burstDelay) or weapon.fireRate
	if now - gun.lastShot < rate then
		-- Rate limit: silently dropped. A spammer gets no feedback, which is fine.
		return
	end
	gun.lastShot = now

	-- Ammo is spent up front: a burst that is interrupted by death is still paid for.
	local cost = if weapon.burstSize > 1 then weapon.burstSize else math.max(1, weapon.bulletCount)
	if not Weapons.isMelee(weapon) then
		if gun.ammo <= 0 then
			startReload(player, gun)
			return
		end
		gun.ammo = math.max(0, gun.ammo - cost)
		notifyAmmo(player, gun)
		if gun.ammo <= 0 then
			task.defer(function()
				startReload(player, gun)
			end)
		end
	end

	local shots = math.max(1, weapon.burstSize)
	local interval = if weapon.burstSize > 1 then weapon.burstDelay else 0

	for index = 1, shots do
		if index > 1 then
			gun.burstLeft -= 1
			task.wait(interval)
		end
		-- Re-validate between burst shots: the player may have died or the phase
		-- may have changed mid-burst.
		if not canShoot(player) or gunStates[player] ~= gun or not gun.equipped or gun.reloading then
			gun.burstLeft = 0
			return
		end
		if not resolveShot(player, gun, payload) then
			gun.burstLeft = 0
			return
		end
	end
	gun.burstLeft = 0
end
-- ---------------------------------------------------------------------------
-- Equipping
-- ---------------------------------------------------------------------------
local function refreshWeaponDisplay(player: Player)
	local state = Match.getPlayerState(player)
	local gun = gunStates[player]
	if state and gun then
		local weapon = Weapons.get(gun.weapon)
		state.weaponDisplay = weapon and weapon.displayName or gun.weapon
	end
end

local function bindTool(player: Player, tool: Tool)
	if gunStates[player] and gunStates[player].tool == tool then
		return
	end

	local weaponName = tool:GetAttribute("Weapon")
	if type(weaponName) ~= "string" then
		weaponName = tool.Name
	end
	local weapon = Weapons.get(weaponName)
	if not weapon then
		return
	end

	local existing = gunStates[player]
	if existing and existing.equipped and existing.tool then
		existing.equipped = false
	end

	local state = Match.getPlayerState(player)
	if state then
		state.weapon = weapon.name
		state.weaponDisplay = weapon.displayName
	end

	local gun: GunState = {
		weapon = weapon.name,
		tool = tool,
		ammo = ammoFor(weapon),
		lastShot = 0,
		reloading = false,
		reloadToken = 0,
		burstLeft = 0,
		equipped = true,
	}
	gunStates[player] = gun

	tool:SetAttribute("Ammo", gun.ammo)
	tool:SetAttribute("Reloading", false)
	notifyAmmo(player, gun)
	refreshWeaponDisplay(player)

	tool.Equipped:Connect(function()
		gun.equipped = true
		if Match.getPlayerState(player) then
			Match.getPlayerState(player).weapon = gun.weapon
			Match.getPlayerState(player).weaponDisplay = weapon.displayName
		end
		notifyAmmo(player, gun)
	end)

	tool.Unequipped:Connect(function()
		gun.equipped = false
	end)
end

--- Watches a player's backpack and binds any tool that appears in it.
function WeaponServer.trackPlayer(player: Player)
	local function watchBackpack(backpack: Instance)
		local function onChild(child: Instance)
			if child:IsA("Tool") then
				if child.Parent == backpack then
					bindTool(player, child)
				end
			end
		end
		for _, child in ipairs(backpack:GetChildren()) do
			onChild(child)
		end
		backpack.ChildAdded:Connect(onChild)
	end

	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack then
		watchBackpack(backpack)
	end
	player.ChildAdded:Connect(function(child)
		if child:IsA("Backpack") then
			watchBackpack(child)
		end
	end)

	-- Fresh character: drop the stale gun reference and rebind.
	player.CharacterAdded:Connect(function()
		local gun = gunStates[player]
		if gun then
			gun.equipped = false
			gun.reloading = false
			gun.reloadToken += 1
		end
		gunStates[player] = nil
	end)
end

function WeaponServer.removePlayer(player: Player)
	gunStates[player] = nil
end

--- Server-side helper for other systems (hero ultimates) to refill a magazine.
function WeaponServer.refill(player: Player)
	local gun = gunStates[player]
	if not gun then
		return
	end
	local weapon = Weapons.get(gun.weapon)
	if not weapon then
		return
	end
	gun.reloading = false
	gun.reloadToken += 1
	gun.ammo = weapon.magSize
	if gun.tool then
		gun.tool:SetAttribute("Reloading", false)
	end
	notifyAmmo(player, gun)
end

--- Current ammo fraction, used by the HUD and by hero logic.
function WeaponServer.ammo(player: Player): (number, number)
	local gun = gunStates[player]
	if not gun then
		return 0, 0
	end
	local weapon = Weapons.get(gun.weapon)
	return gun.ammo, weapon and weapon.magSize or 0
end

--- Warns a player that they tried to shoot with an empty magazine.
function WeaponServer.reloadFor(player: Player)
	local gun = gunStates[player]
	if gun then
		startReload(player, gun)
	end
end

-- ---------------------------------------------------------------------------
-- Init
-- ---------------------------------------------------------------------------
function WeaponServer.init()
	WeaponServer.buildTemplates()

	Net.event("Fire").OnServerEvent:Connect(function(player, payload)
		local ok, err = pcall(onFire, player, payload)
		if not ok then
			warn("[RIVALS] Fire handler error: " .. tostring(err))
		end
	end)

	Net.event("Reload").OnServerEvent:Connect(function(player)
		local gun = gunStates[player]
		if gun then
			startReload(player, gun)
		end
	end)

	Players.PlayerRemoving:Connect(WeaponServer.removePlayer)
end

return WeaponServer
