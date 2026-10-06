--[[
	Arena.luau  (Script)
	Builds "Neon Heights" from nothing at server start: floor, perimeter, four
	vertical layers, spawn bubbles, the jump pad, and a seeded scatter of cover.

	Geometry comes from the LAYOUT table below, so the whole map is retunable
	without touching construction code. The seed is fixed, so every server gets
	an identical arena.

	Every part is tagged "Arena" and lives under Workspace.RivalsArena.
	Tag "BulletBlocker" on any part you want to stop bullets (the Tank's dome uses
	its own tag). See DESIGN.md section 5.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")
local Debris = game:GetService("Debris")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Util = require(Shared.Util)

-- ---------------------------------------------------------------------------
-- Layout -- all coordinates are studs, origin at arena centre, y=0 is the floor
-- ---------------------------------------------------------------------------
local LAYOUT = {
	Size = 240, -- square side length
	WallHeight = 60,
	WallThickness = 4,

	FloorTop = 0, -- walkable surface height
	FloorThickness = 24, -- bedrock below y=0 hides the void

	-- Central objective
	CenterPad = { size = Vector3.new(14, 1, 14), height = 8 },
	JumpPad = { size = Vector3.new(9, 1, 9), launch = 110, cooldown = 1.5 },
	JumpPadCeiling = 150, -- players are caught here so they cannot leave the map

	-- Grounded cover blocks flanking centre
	MidBlocks = { offsetX = 38, offsetZ = 0, size = Vector3.new(18, 12, 18) },

	-- Side corridors (east/west lanes)
	Corridor = {
		offsetX = 88,
		width = 26, -- along X
		depth = 34, -- along Z
		height = 24,
		roofY = 30,
		roofThickness = 3,
	},

	-- Elevated sniper flanks standing on the corridor roofs
	Balcony = {
		offsetX = 88,
		size = Vector3.new(30, 2, 38),
		topY = 46,
		rampWidth = 10,
	},

	-- Skybridge across the middle at balcony height
	Skybridge = {
		y = 46,
		thickness = 2,
		width = 12, -- along Z
		-- inner edge of each half bridge; the gap in the middle is intentional
		outerX = 74,
		innerX = 12,
	},

	-- Low flank tunnels under the arena
	Tunnel = {
		halfWidth = 66, -- tunnel spans x = -halfWidth .. +halfWidth
		zInner = 20,
		zOuter = 30,
		roofY = 8,
		roofThickness = 2,
		openings = { [58] = 14, [22] = 12, [-26] = 12, [-62] = 14 }, -- x -> gap width
	},

	-- Team spawn bubbles
	Spawns = {
		[1] = {
			center = Vector3.new(-108, 0, 0),
			facing = Vector3.new(1, 0, 0),
			points = {
				Vector3.new(-104, 3, -6),
				Vector3.new(-104, 3, 0),
				Vector3.new(-104, 3, 6),
				Vector3.new(-112, 3, 0),
			},
		},
		[2] = {
			center = Vector3.new(108, 0, 0),
			facing = Vector3.new(-1, 0, 0),
			points = {
				Vector3.new(104, 3, -6),
				Vector3.new(104, 3, 0),
				Vector3.new(104, 3, 6),
				Vector3.new(112, 3, 0),
			},
		},
	},

	CoverSeed = 20240614,
	CoverCount = 34,
}

-- ---------------------------------------------------------------------------
-- Part helper
-- ---------------------------------------------------------------------------
type PartProps = {
	size: Vector3,
	position: Vector3,
	color: Color3?,
	material: Enum.Material?,
	transparency: number?,
	anchored: boolean?,
	canCollide: boolean?,
	canTouch: boolean?,
	shape: Enum.PartType?,
	name: string?,
	parent: Instance?,
	cframe: CFrame?,
}

local function part(props: PartProps): BasePart
	local shape = props.shape or Enum.PartType.Block
	local instance = Instance.new(shape == Enum.PartType.Block and "Part" or "Part")
	instance.Shape = shape
	instance.Size = props.size
	instance.CFrame = props.cframe or CFrame.new(props.position)
	instance.Color = props.color or Config.Palette.DarkGray
	instance.Material = props.material or Enum.Material.SmoothPlastic
	instance.Transparency = props.transparency or 0
	instance.Anchored = props.anchored ~= false
	instance.CanCollide = props.canCollide ~= false
	instance.CanTouch = props.canTouch ~= false
	instance.TopSurface = Enum.SurfaceType.Smooth
	instance.BottomSurface = Enum.SurfaceType.Smooth
	if props.name then
		instance.Name = props.name
	end
	CollectionService:AddTag(instance, "Arena")
	-- Anything solid is a bullet blocker by default; rails and decor opt out.
	if instance.CanCollide then
		CollectionService:AddTag(instance, "BulletBlocker")
	end
	instance.Parent = props.parent
	return instance
end

-- ---------------------------------------------------------------------------
-- Arena construction
-- ---------------------------------------------------------------------------
local Arena = {}

function Arena.build(): Model
	-- Rebuild from scratch so a Studio "Play" after editing never double-builds.
	local existing = workspace:FindFirstChild("RivalsArena")
	if existing then
		existing:Destroy()
	end

	local root = Instance.new("Model")
	root.Name = "RivalsArena"

	local geometry = Util.folder(root, "Geometry")
	local props = Util.folder(root, "Props")
	local spawnFolder = Util.folder(root, "Spawns")

	local size = LAYOUT.Size
	local half = size / 2
	local wallHeight = LAYOUT.WallHeight

	-- ======================= Floor and bedrock =======================
	part({
		name = "Floor",
		size = Vector3.new(size, LAYOUT.FloorThickness, size),
		position = Vector3.new(0, LAYOUT.FloorTop - LAYOUT.FloorThickness / 2, 0),
		color = Color3.fromRGB(18, 19, 26),
		material = Enum.Material.Slate,
		parent = geometry,
	})

	-- Neon floor inlays: a grid that reads as cyberpunk without any textures.
	for i = -4, 4 do
		local offset = i * 26
		local alongZ = math.abs(i) % 2 == 0
		part({
			name = "Inlay",
			size = alongZ and Vector3.new(3, 0.2, size - 12) or Vector3.new(size - 12, 0.2, 3),
			position = alongZ and Vector3.new(offset, 0.1, 0) or Vector3.new(0, 0.1, offset),
			color = i == 0 and Config.Palette.Cyan or Config.Palette.Violet,
			material = Enum.Material.Neon,
			transparency = i == 0 and 0.35 or 0.7,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
	end

	-- ======================= Perimeter =======================
	local wallSpecs = {
		{ Vector3.new(size + LAYOUT.WallThickness * 2, wallHeight, LAYOUT.WallThickness), Vector3.new(0, wallHeight / 2, -half) },
		{ Vector3.new(size + LAYOUT.WallThickness * 2, wallHeight, LAYOUT.WallThickness), Vector3.new(0, wallHeight / 2, half) },
		{ Vector3.new(LAYOUT.WallThickness, wallHeight, size), Vector3.new(-half, wallHeight / 2, 0) },
		{ Vector3.new(LAYOUT.WallThickness, wallHeight, size), Vector3.new(half, wallHeight / 2, 0) },
	}
	for index, spec in ipairs(wallSpecs) do
		part({
			name = "Perimeter" .. index,
			size = spec[1],
			position = spec[2],
			color = Color3.fromRGB(22, 23, 33),
			material = Enum.Material.Concrete,
			parent = geometry,
		})
	end

	-- Vertical neon accents break up the walls and give players a sense of speed.
	for _, x in ipairs({ -96, -48, 48, 96 }) do
		for _, z in ipairs({ -half + 2, half - 2 }) do
			local accent = part({
				name = "Accent",
				size = Vector3.new(2, wallHeight - 6, 0.6),
				position = Vector3.new(x, (wallHeight - 6) / 2, z),
				color = math.abs(x) > 70 and Config.Palette.Magenta or Config.Palette.Cyan,
				material = Enum.Material.Neon,
				canCollide = false,
				canTouch = false,
				parent = geometry,
			})
			local light = Instance.new("PointLight")
			light.Color = accent.Color
			light.Range = 26
			light.Brightness = 1.2
			light.Parent = accent
		end
	end

	-- ======================= Central pad and jump pad =======================
	local pad = LAYOUT.CenterPad
	local padY = LAYOUT.FloorTop + pad.height
	part({
		name = "CenterPad",
		size = pad.size,
		position = Vector3.new(0, padY - pad.size.Y / 2, 0),
		color = Color3.fromRGB(26, 28, 40),
		material = Enum.Material.Metal,
		parent = geometry,
	})
	-- The pad's glowing rim, so it reads as the objective from across the map.
	for _, sign in ipairs({ 1, -1 }) do
		part({
			name = "PadRim",
			size = Vector3.new(pad.size.X + 1, 0.4, 1),
			position = Vector3.new(0, padY + 0.2, sign * (pad.size.Z / 2)),
			color = Config.Palette.Cyan,
			material = Enum.Material.Neon,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
		part({
			name = "PadRim",
			size = Vector3.new(1, 0.4, pad.size.Z + 1),
			position = Vector3.new(sign * (pad.size.X / 2), padY + 0.2, 0),
			color = Config.Palette.Cyan,
			material = Enum.Material.Neon,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
	end

	local jumpSpec = LAYOUT.JumpPad
	Arena._jumpPad = part({
		name = "JumpPad",
		size = jumpSpec.size,
		position = Vector3.new(0, padY + jumpSpec.size.Y / 2, 0),
		color = Config.Palette.Cyan,
		material = Enum.Material.Neon,
		transparency = 0.15,
		parent = geometry,
	})
	Arena._jumpPadCooldowns = {}

	-- ======================= Mid cover blocks =======================
	local mid = LAYOUT.MidBlocks
	for _, sign in ipairs({ 1, -1 }) do
		local center = Vector3.new(sign * mid.offsetX, mid.size.Y / 2, mid.offsetZ)
		part({
			name = "MidBlock",
			size = mid.size,
			position = center,
			color = Color3.fromRGB(24, 26, 36),
			material = Enum.Material.Concrete,
			parent = geometry,
		})
		part({
			name = "MidBlockTrim",
			size = Vector3.new(mid.size.X + 0.6, 0.5, mid.size.Z + 0.6),
			position = center + Vector3.new(0, mid.size.Y / 2, 0),
			color = Config.Palette.Magenta,
			material = Enum.Material.Neon,
			transparency = 0.3,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
	end

	-- ======================= Side corridors + balcony roofs =======================
	local corridor = LAYOUT.Corridor
	for _, sign in ipairs({ 1, -1 }) do
		local cx = sign * corridor.offsetX
		-- Corridor walls leave a walkable lane down the middle.
		for _, zSign in ipairs({ 1, -1 }) do
			part({
				name = "CorridorWall",
				size = Vector3.new(corridor.width, corridor.height, 2),
				position = Vector3.new(cx, corridor.height / 2, zSign * (corridor.depth / 2)),
				color = Color3.fromRGB(20, 21, 30),
				material = Enum.Material.Concrete,
				parent = geometry,
			})
		end

		-- Corner pillars: cover you can peek around, and they break up sightlines.
		for _, zSign in ipairs({ 1, -1 }) do
			for _, xSign in ipairs({ 1, -1 }) do
				part({
					name = "CorridorPillar",
					size = Vector3.new(3, corridor.height, 3),
					position = Vector3.new(cx + xSign * 8, corridor.height / 2, zSign * 6),
					color = Color3.fromRGB(30, 32, 44),
					material = Enum.Material.Metal,
					parent = geometry,
				})
			end
		end

		-- The roof doubles as the elevated flank, so it is solid and walkable.
		local balcony = LAYOUT.Balcony
		part({
			name = "Balcony",
			size = balcony.size,
			position = Vector3.new(sign * balcony.offsetX, balcony.topY - balcony.size.Y / 2, 0),
			color = Color3.fromRGB(27, 29, 41),
			material = Enum.Material.Metal,
			parent = geometry,
		})
		part({
			name = "BalconyLip",
			size = Vector3.new(balcony.size.X, 1.2, 0.6),
			position = Vector3.new(sign * balcony.offsetX, balcony.topY + 0.6, -balcony.size.Z / 2),
			color = Config.Palette.Cyan,
			material = Enum.Material.Neon,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
		part({
			name = "BalconyLip",
			size = Vector3.new(balcony.size.X, 1.2, 0.6),
			position = Vector3.new(sign * balcony.offsetX, balcony.topY + 0.6, balcony.size.Z / 2),
			color = Config.Palette.Cyan,
			material = Enum.Material.Neon,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})

		-- Ramp from the corridor up onto the balcony.
		local rise = balcony.topY - LAYOUT.FloorTop
		local rampLength = math.sqrt(rise * rise + 34 * 34)
		local rampAngle = math.deg(math.atan(rise / 34))
		part({
			name = "BalconyRamp",
			size = Vector3.new(34.5, 1.2, balcony.rampWidth),
			cframe = CFrame.new(sign * 108, rise / 2, 0)
				* CFrame.Angles(0, 0, math.rad(sign * rampAngle)),
			color = Color3.fromRGB(30, 32, 44),
			material = Enum.Material.Metal,
			parent = geometry,
		})
	end

	-- ======================= Skybridge (with a deliberate gap) =======================
	local bridge = LAYOUT.Skybridge
	for _, sign in ipairs({ 1, -1 }) do
		local span = math.abs(bridge.outerX - bridge.innerX)
		local centerX = sign * (bridge.outerX + bridge.innerX) / 2
		part({
			name = "Skybridge",
			size = Vector3.new(span, bridge.thickness, bridge.width),
			position = Vector3.new(centerX, bridge.y - bridge.thickness / 2, 0),
			color = Color3.fromRGB(28, 30, 42),
			material = Enum.Material.Metal,
			parent = geometry,
		})
		-- Rails, non-colliding so they never block a shot you can see.
		for _, zSign in ipairs({ 1, -1 }) do
			part({
				name = "SkybridgeRail",
				size = Vector3.new(span, 1.4, 0.4),
				position = Vector3.new(centerX, bridge.y + 0.7, zSign * (bridge.width / 2)),
				color = Config.Palette.Violet,
				material = Enum.Material.Neon,
				transparency = 0.25,
				canCollide = false,
				canTouch = false,
				parent = geometry,
			})
		end
		-- Connector from balcony out to the bridge.
		part({
			name = "SkybridgeLink",
			size = Vector3.new(8, bridge.thickness, bridge.width),
			position = Vector3.new(sign * 82, bridge.y - bridge.thickness / 2, 0),
			color = Color3.fromRGB(28, 30, 42),
			material = Enum.Material.Metal,
			parent = geometry,
		})
	end

	-- ======================= Low flank tunnels =======================
	local tunnel = LAYOUT.Tunnel
	for _, zSign in ipairs({ 1, -1 }) do
		local zCenter = zSign * (tunnel.zInner + tunnel.zOuter) / 2
		local zDepth = math.abs(tunnel.zOuter - tunnel.zInner)

		-- Roof slabs, split around each opening so the exits are real holes.
		local cuts = {}
		for x, width in pairs(tunnel.openings) do
			table.insert(cuts, { x = x, width = width })
		end
		table.sort(cuts, function(a, b)
			return a.x < b.x
		end)

		local cursor = -tunnel.halfWidth
		for _, cut in ipairs(cuts) do
			local gapStart = cut.x - cut.width / 2
			if gapStart > cursor then
				part({
					name = "TunnelRoof",
					size = Vector3.new(gapStart - cursor, tunnel.roofThickness, zDepth + 2),
					position = Vector3.new((cursor + gapStart) / 2, tunnel.roofY - tunnel.roofThickness / 2, zCenter),
					color = Color3.fromRGB(23, 25, 34),
					material = Enum.Material.Concrete,
					parent = geometry,
				})
			end
			cursor = cut.x + cut.width / 2
		end
		if cursor < tunnel.halfWidth then
			part({
				name = "TunnelRoof",
				size = Vector3.new(tunnel.halfWidth - cursor, tunnel.roofThickness, zDepth + 2),
				position = Vector3.new((cursor + tunnel.halfWidth) / 2, tunnel.roofY - tunnel.roofThickness / 2, zCenter),
				color = Color3.fromRGB(23, 25, 34),
				material = Enum.Material.Concrete,
				parent = geometry,
			})
		end

		-- Outer back wall so the tunnel is a corridor, not a hole in the map.
		part({
			name = "TunnelBack",
			size = Vector3.new(tunnel.halfWidth * 2, tunnel.roofY, 2),
			position = Vector3.new(0, tunnel.roofY / 2, zSign * (tunnel.zOuter + 1)),
			color = Color3.fromRGB(20, 21, 30),
			material = Enum.Material.Concrete,
			parent = geometry,
		})

		-- Neon strip along the tunnel ceiling, purely for readability.
		part({
			name = "TunnelStrip",
			size = Vector3.new(tunnel.halfWidth * 2 - 8, 0.3, 1),
			position = Vector3.new(0, tunnel.roofY - tunnel.roofThickness - 0.2, zCenter),
			color = Config.Palette.Amber,
			material = Enum.Material.Neon,
			transparency = 0.4,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
	end

	-- ======================= Spawn bubbles =======================
	for team, spec in pairs(LAYOUT.Spawns) do
		Arena._buildSpawn(spawnFolder, geometry, team, spec)
	end

	-- ======================= Seeded cover scatter =======================
	Arena._scatterCover(props, geometry)

	root.Parent = workspace
	return root
end

-- ---------------------------------------------------------------------------
-- Spawn bubble
-- ---------------------------------------------------------------------------
function Arena._buildSpawn(spawnFolder: Folder, geometry: Folder, team: number, spec: any)
	local teamColor = Config.Teams[team].Color
	local center = spec.center
	local bubble = Util.folder(spawnFolder, "Spawn" .. team)

	-- Back wall, two side walls, and a partial front wall with a doorway: keeps
	-- spawns safe without letting players shoot out of them.
	part({
		name = "SpawnBack",
		size = Vector3.new(4, 22, 46),
		position = center + Vector3.new(-math.sign(center.X) * 14, 11, 0),
		color = Color3.fromRGB(22, 23, 33),
		material = Enum.Material.Concrete,
		parent = geometry,
	})
	for _, zSign in ipairs({ 1, -1 }) do
		part({
			name = "SpawnSide",
			size = Vector3.new(28, 22, 3),
			position = center + Vector3.new(0, 11, zSign * 22),
			color = Color3.fromRGB(22, 23, 33),
			material = Enum.Material.Concrete,
			parent = geometry,
		})
	end

	-- Spawn points, oriented to face the arena.
	local facing = CFrame.lookAt(Vector3.zero, spec.facing)
	for index, point in ipairs(spec.points) do
		local pad = part({
			name = string.format("SpawnPad%d", index),
			size = Vector3.new(7, 0.4, 7),
			position = point - Vector3.new(0, 0.2, 0),
			color = teamColor,
			material = Enum.Material.Neon,
			transparency = 0.35,
			canCollide = false,
			canTouch = false,
			parent = geometry,
		})
		local light = Instance.new("PointLight")
		light.Color = teamColor
		light.Range = 18
		light.Brightness = 1.6
		light.Parent = pad

		local spawn = Instance.new("SpawnLocation")
		spawn.Name = "SpawnPoint"
		spawn.Size = Vector3.new(6, 1, 6)
		spawn.CFrame = CFrame.new(point) * (facing - facing.Position)
		spawn.Anchored = true
		spawn.CanCollide = false
		spawn.Transparency = 1
		spawn.Neutral = true
		spawn.Duration = 0
		spawn.TeamColor = BrickColor.new(Config.Teams[team].Color)
		spawn.Parent = bubble
		CollectionService:AddTag(spawn, "Arena")
	end
end

-- ---------------------------------------------------------------------------
-- Cover scatter
-- ---------------------------------------------------------------------------
--- Places crates, pillars, half-walls and barrels using a fixed seed.
--- Positions are validated against the functional zones so cover never blocks a
--- doorway, sits on the jump pad, or spawns inside a wall.
function Arena._scatterCover(props: Folder, geometry: Folder)
	local random = Util.seeded(LAYOUT.CoverSeed)
	local half = LAYOUT.Size / 2

	-- Rectangles cover must avoid: x range, z range.
	local keepOut = {
		{ -14, 14, -14, 14 }, -- central pad
		{ -47, -29, -9, 9 }, -- mid block west
		{ 29, 47, -9, 9 }, -- mid block east
		{ -105, -71, -20, 20 }, -- corridor west
		{ 71, 105, -20, 20 }, -- corridor east
		{ -120, -96, -24, 24 }, -- spawn west
		{ 96, 120, -24, 24 }, -- spawn east
		{ -half, half, 18, 32 }, -- tunnel roof strip north
		{ -half, half, -32, -18 }, -- tunnel roof strip south
	}

	local function blocked(x: number, z: number): boolean
		for _, zone in ipairs(keepOut) do
			if x >= zone[1] and x <= zone[2] and z >= zone[3] and z <= zone[4] then
				return true
			end
		end
		return false
	end

	local kinds = { "crate", "pillar", "halfwall", "barrel" }
	local placed = 0
	local attempts = 0

	while placed < LAYOUT.CoverCount and attempts < LAYOUT.CoverCount * 40 do
		attempts += 1
		local x = random:NextNumber(-half + 16, half - 16)
		local z = random:NextNumber(-half + 16, half - 16)
		if not blocked(x, z) then
			local kind = kinds[random:NextInteger(1, #kinds)]
			local color = Config.Palette.Gray
			local material = Enum.Material.SmoothPlastic
			local size: Vector3

			if kind == "crate" then
				local s = random:NextNumber(4, 7)
				size = Vector3.new(s, s, s)
				color = Color3.fromRGB(38, 40, 54)
				material = Enum.Material.WoodPlanks
			elseif kind == "pillar" then
				size = Vector3.new(3, random:NextNumber(8, 14), 3)
				color = Color3.fromRGB(30, 32, 44)
				material = Enum.Material.Metal
			elseif kind == "halfwall" then
				size = Vector3.new(random:NextNumber(8, 14), random:NextNumber(3, 4), 1.5)
				color = Color3.fromRGB(34, 36, 48)
				material = Enum.Material.Concrete
			else
				local diameter = random:NextNumber(3, 4.5)
				size = Vector3.new(diameter, diameter * 1.4, diameter)
				color = Config.Palette.Amber
				material = Enum.Material.Metal
			end

			local y = LAYOUT.FloorTop + size.Y / 2
			local cframe = CFrame.new(x, y, z) * CFrame.Angles(0, math.rad(random:NextNumber(0, 360)), 0)
			if kind == "barrel" then
				-- Cylinders stand up only when rotated on Z; do it here so the
				-- random yaw still applies.
				cframe = CFrame.new(x, y, z) * CFrame.Angles(0, math.rad(random:NextNumber(0, 360)), math.rad(90))
			end

			part({
				name = "Cover",
				size = size,
				position = Vector3.new(x, y, z),
				cframe = cframe,
				color = color,
				material = material,
				parent = props,
			})
			placed += 1
		end
	end

	-- Guaranteed cover on each mid block, so the blocks always play as intended.
	local mid = LAYOUT.MidBlocks
	for _, sign in ipairs({ 1, -1 }) do
		part({
			name = "MidCover",
			size = Vector3.new(10, 3.5, 2),
			position = Vector3.new(sign * mid.offsetX, mid.size.Y + 1.75, 0),
			color = Config.Palette.Gray,
			material = Enum.Material.Concrete,
			parent = geometry,
		})
	end
end

-- ---------------------------------------------------------------------------
-- Jump pad
-- ---------------------------------------------------------------------------
--- Wires the pad's Touch event. Called once from the server after build().
function Arena.activate()
	local pad = Arena._jumpPad
	if not pad then
		return
	end

	local spec = LAYOUT.JumpPad
	local cooldowns = Arena._jumpPadCooldowns

	pad.Touched:Connect(function(otherPart)
		local character = otherPart:FindFirstAncestorOfClass("Model")
		if not character then
			return
		end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		local root = character:FindFirstChild("HumanoidRootPart")
		if not humanoid or not root or humanoid.Health <= 0 then
			return
		end

		local player = game:GetService("Players"):GetPlayerFromCharacter(character)
		local key = player or character
		local now = os.clock()
		if cooldowns[key] and now - cooldowns[key] < spec.cooldown then
			return
		end
		cooldowns[key] = now

		root.AssemblyLinearVelocity = Vector3.new(root.AssemblyLinearVelocity.X, spec.launch, root.AssemblyLinearVelocity.Z)

		-- FX: flash the pad and fire a beam upward.
		pad.Transparency = 0.55
		task.delay(0.12, function()
			if pad.Parent then
				pad.Transparency = 0.15
			end
		end)

		local beam = Instance.new("Part")
		beam.Name = "JumpBeam"
		beam.Size = Vector3.new(7, 90, 7)
		beam.CFrame = pad.CFrame * CFrame.new(0, 45, 0)
		beam.Anchored = true
		beam.CanCollide = false
		beam.CanTouch = false
		beam.Material = Enum.Material.Neon
		beam.Color = Config.Palette.Cyan
		beam.Transparency = 0.6
		beam.Parent = pad
		local tween = game:GetService("TweenService"):Create(beam, TweenInfo.new(0.45), {
			Transparency = 1,
			Size = Vector3.new(7, 130, 7),
		})
		tween:Play()
		Debris:AddItem(beam, 0.6)
	end)
end

-- ---------------------------------------------------------------------------
-- Ceiling catch: nobody leaves the arena, even on a jump pad into a wall run.
-- ---------------------------------------------------------------------------
function Arena.watchCeiling()
	local ceiling = LAYOUT.JumpPadCeiling
	task.spawn(function()
		while true do
			task.wait(0.15)
			for _, player in ipairs(game:GetService("Players"):GetPlayers()) do
				local character = player.Character
				local root = character and character:FindFirstChild("HumanoidRootPart")
				if root and root.Position.Y > ceiling then
					local velocity = root.AssemblyLinearVelocity
					if velocity.Y > 0 then
						root.AssemblyLinearVelocity = Vector3.new(velocity.X, 0, velocity.Z)
					end
				end
			end
		end
	end)
end

Arena.Layout = LAYOUT

return Arena
