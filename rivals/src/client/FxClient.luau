--[[
	FxClient.luau  (LocalScript)
	All combat visuals, built from parts and tweens. No uploaded textures and no
	uploaded meshes, so nothing here can break or be moderated.

	Consumes the server's "ShotFired" remote:
	  fire      -- muzzle flash + tracer, from another player
	  impact    -- spark burst where a bullet landed
	  dash      -- Rusher trail
	  railgun   -- thick piercing beam
	  dome      -- Tank dome deployment flash
	  station   -- Support station ring

	Every primitive self-gates through reserve(): when the effect budget is full
	the visual is skipped entirely. Effects are cosmetic, so dropping one under
	load is always better than dropping frames.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Net = require(Shared.Net)
local Weapons = require(Shared.Weapons)

-- ---------------------------------------------------------------------------
-- Budget
-- ---------------------------------------------------------------------------
local MAX_EFFECTS = 120
local live = 0

--- Reserves one effect slot. Returns false when nothing more may be drawn.
local function reserve(): boolean
	if live >= MAX_EFFECTS then
		return false
	end
	live += 1
	return true
end

--- Releases a slot after `lifetime`. Every reserve() must pair with exactly one
--- release(), which is why the primitives own both halves rather than callers.
local function release(lifetime: number)
	task.delay(lifetime, function()
		live = math.max(0, live - 1)
	end)
end

-- ---------------------------------------------------------------------------
-- Primitives
-- ---------------------------------------------------------------------------
local function neonPart(props: {
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	transparency: number?,
	shape: Enum.PartType?,
	parent: Instance?,
}): BasePart
	local part = Instance.new("Part")
	part.Shape = props.shape or Enum.PartType.Block
	part.Size = props.size
	part.CFrame = props.cframe
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.CastShadow = false
	part.Material = Enum.Material.Neon
	part.Color = props.color
	part.Transparency = props.transparency or 0
	part.Parent = props.parent or workspace
	return part
end

local function fadeAndDestroy(part: BasePart, lifetime: number)
	local tween = TweenService:Create(part, TweenInfo.new(lifetime, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Transparency = 1,
	})
	tween:Play()
	Debris:AddItem(part, lifetime + 0.05)
end

--- A thin beam between two points. Used for tracers and the railgun.
local function beam(from: Vector3, to: Vector3, color: Color3, thickness: number, lifetime: number)
	if not reserve() then
		return
	end
	local delta = to - from
	local length = delta.Magnitude
	if length < 0.1 then
		live -= 1
		return
	end
	local part = neonPart({
		size = Vector3.new(thickness, thickness, length),
		cframe = CFrame.lookAt(from + delta / 2, to),
		color = color,
		transparency = 0.15,
	})
	fadeAndDestroy(part, lifetime)
	release(lifetime)
end

local function muzzleFlash(position: Vector3, color: Color3, scale: number)
	if not reserve() then
		return
	end
	local flash = neonPart({
		size = Vector3.new(0.5, 0.5, 0.9) * scale,
		cframe = CFrame.new(position),
		color = color,
		transparency = 0.1,
		shape = Enum.PartType.Ball,
	})
	local light = Instance.new("PointLight")
	light.Color = color
	light.Range = Config.Fx.MuzzleLightRange * scale
	light.Brightness = 3
	light.Parent = flash
	fadeAndDestroy(flash, Config.Fx.MuzzleFlashLife)
	release(Config.Fx.MuzzleFlashLife)
end

local function impactSpark(position: Vector3, normal: Vector3, color: Color3)
	if not reserve() then
		return
	end
	local puff = neonPart({
		size = Vector3.new(0.35, 0.35, 0.35),
		cframe = CFrame.new(position + normal * 0.1),
		color = color,
		transparency = 0.2,
		shape = Enum.PartType.Ball,
	})

	local emitter = Instance.new("ParticleEmitter")
	emitter.Color = ColorSequence.new(color)
	emitter.LightEmission = 1
	emitter.Lifetime = NumberRange.new(0.2, 0.45)
	emitter.Speed = NumberRange.new(6, 16)
	emitter.SpreadAngle = Vector2.new(35, 35)
	emitter.Rate = 0
	emitter.Rotation = NumberRange.new(0, 360)
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.18),
		NumberSequenceKeypoint.new(1, 0),
	})
	emitter.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.2),
		NumberSequenceKeypoint.new(1, 1),
	})
	emitter.Parent = puff
	emitter:Emit(6)

	fadeAndDestroy(puff, Config.Fx.ImpactLifetime)
	release(Config.Fx.ImpactLifetime)
end

local function dashTrail(position: Vector3, direction: Vector3, distance: number, color: Color3)
	if not reserve() then
		return
	end
	local trail = neonPart({
		size = Vector3.new(2.2, 2.2, distance),
		cframe = CFrame.lookAt(position + direction * (distance / 2), position + direction * distance),
		color = color,
		transparency = 0.45,
	})
	fadeAndDestroy(trail, 0.3)
	release(0.3)
end

--- Expanding ring/sphere used by the dome and station flashes.
local function expandingShell(
	position: Vector3,
	color: Color3,
	targetSize: number,
	duration: number,
	shape: Enum.PartType
)
	if not reserve() then
		return
	end
	local baseSize = if shape == Enum.PartType.Cylinder then Vector3.new(0.4, 4, 4) else Vector3.new(1, 1, 1)
	local cframe = if shape == Enum.PartType.Cylinder
		then CFrame.new(position) * CFrame.Angles(0, 0, math.rad(90))
		else CFrame.new(position)
	local shell = neonPart({
		size = baseSize,
		cframe = cframe,
		color = color,
		transparency = 0.4,
		shape = shape,
	})
	local target = if shape == Enum.PartType.Cylinder
		then Vector3.new(0.4, targetSize, targetSize)
		else Vector3.new(targetSize, targetSize, targetSize)
	local tween = TweenService:Create(shell, TweenInfo.new(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Size = target,
		Transparency = 1,
	})
	tween:Play()
	Debris:AddItem(shell, duration + 0.1)
	release(duration)
end

-- ---------------------------------------------------------------------------
-- Remote handling
-- ---------------------------------------------------------------------------
local function colorForWeapon(weaponName: any): Color3
	if type(weaponName) ~= "string" then
		return Config.Palette.Amber
	end
	local weapon = Weapons.get(weaponName)
	return weapon and weapon.visual.color or Config.Palette.Amber
end

local function onFireEffect(payload: any)
	if type(payload) ~= "table" then
		return
	end

	local kind = payload.kind

	if kind == "fire" then
		local origin = payload.origin
		local direction = payload.direction
		if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then
			return
		end
		local weapon = type(payload.weapon) == "string" and Weapons.get(payload.weapon) or nil
		local scale = weapon and weapon.visual.muzzleScale or 1
		local color = weapon and weapon.visual.color or Config.Palette.Amber
		muzzleFlash(origin, color, scale)
		beam(origin, origin + direction * 220, color, 0.12, Config.Fx.TracerLifetime)
	elseif kind == "impact" then
		local position = payload.position
		local normal = payload.normal
		if typeof(position) == "Vector3" and typeof(normal) == "Vector3" then
			impactSpark(position, normal, Config.Palette.Amber)
		end
	elseif kind == "dash" then
		local origin = payload.origin
		local direction = payload.direction
		if typeof(origin) == "Vector3" and typeof(direction) == "Vector3" then
			dashTrail(origin, direction, tonumber(payload.distance) or 55, Config.Palette.Cyan)
		end
	elseif kind == "railgun" then
		local origin = payload.origin
		local endpoint = payload.position
		if typeof(origin) == "Vector3" and typeof(endpoint) == "Vector3" then
			beam(origin, endpoint, Config.Palette.Magenta, 0.6, 0.35)
			-- A brighter core makes it read as a rail rather than a laser.
			beam(origin, endpoint, Config.Palette.White, 0.2, 0.35)
		end
	elseif kind == "dome" then
		if typeof(payload.position) == "Vector3" then
			expandingShell(payload.position, Config.Palette.Cyan, (tonumber(payload.radius) or 14) * 2, 0.3, Enum.PartType.Ball)
		end
	elseif kind == "station" then
		if typeof(payload.position) == "Vector3" then
			expandingShell(payload.position, Config.Palette.Green, (tonumber(payload.radius) or 16) * 2, 0.5, Enum.PartType.Cylinder)
		end
	end
end

Net.event("ShotFired").OnClientEvent:Connect(function(payload)
	local ok, err = pcall(onFireEffect, payload)
	if not ok then
		warn("[RIVALS] FX error: " .. tostring(err))
	end
end)

-- ---------------------------------------------------------------------------
-- Local hit spark
-- ---------------------------------------------------------------------------
Net.event("HitConfirm").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" or payload.kind ~= "spark" then
		return
	end
	if typeof(payload.position) == "Vector3" then
		impactSpark(payload.position, Vector3.yAxis, Config.Palette.Red)
	end
end)

-- ---------------------------------------------------------------------------
-- Sniper reveal: a world-space ping over each revealed enemy
-- ---------------------------------------------------------------------------
local function ping(position: Vector3, name: string, duration: number)
	local anchor = Instance.new("Part")
	anchor.Name = "RevealPing"
	anchor.Size = Vector3.new(0.2, 0.2, 0.2)
	anchor.CFrame = CFrame.new(position)
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanTouch = false
	anchor.CanQuery = false
	anchor.Transparency = 1
	anchor.Parent = workspace

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "RevealLabel"
	billboard.Size = UDim2.fromOffset(140, 34)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, 4.2, 0)
	billboard.AlwaysOnTop = true
	billboard.MaxDistance = 900
	billboard.Parent = anchor

	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 16
	label.TextColor3 = Config.Palette.Red
	label.TextStrokeTransparency = 0.4
	label.TextStrokeColor3 = Color3.new(0, 0, 0)
	label.Text = "v " .. name
	label.Parent = billboard

	-- The ping fades out over exactly the reveal duration, so it cannot be camped.
	local tween = TweenService:Create(label, TweenInfo.new(duration), { TextTransparency = 1, TextStrokeTransparency = 1 })
	tween:Play()
	Debris:AddItem(anchor, duration)
end

Net.event("Reveal").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" or type(payload.enemies) ~= "table" then
		return
	end
	local duration = tonumber(payload.duration) or 4
	for _, enemy in ipairs(payload.enemies) do
		if type(enemy) == "table" and typeof(enemy.position) == "Vector3" and reserve() then
			ping(enemy.position, tostring(enemy.name), duration)
			release(duration)
		end
	end
end)

-- ---------------------------------------------------------------------------
-- Local prediction
-- ---------------------------------------------------------------------------
--- Called by InputClient so the local player's muzzle flash is instant rather
--- than waiting for the server's broadcast (which excludes the shooter).
local Fx = {}

function Fx.localShot(origin: Vector3, direction: Vector3, color: Color3, scale: number)
	muzzleFlash(origin, color, scale)
	beam(origin, origin + direction * 200, color, 0.12, Config.Fx.TracerLifetime)
end

return Fx
