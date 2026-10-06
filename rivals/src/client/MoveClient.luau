--[[
	MoveClient.luau  (LocalScript)
	Movement and camera. This is where the game's skill ceiling lives.

	  Sprint        hold Shift                      x1.35 walk speed
	  Slide         Shift + Ctrl/C while grounded   24 studs/s, 0.7s, 45 stamina
	  Double jump   Space while airborne            +32 vertical, 28 stamina
	  Wall run      hold Space against a wall       gravity off, 20 studs/s, 12/s stamina
	  Aim           hold right mouse button         lowered FOV, tighter spread

	Movement is client-authoritative for responsiveness, with server-side clamps
	(WeaponServer rejects impossible shot origins; Match bounds max health). The
	server never trusts a client's speed to decide damage.

	Exposes MoveClient.state for the HUD (stamina, wallrun animation, etc).
	See DESIGN.md section 3.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Util = require(Shared.Util)
local Weapons = require(Shared.Weapons)

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local Move = {}
Move.state = {
	stamina = Config.Movement.Stamina.Max,
	sliding = false,
	wallRunning = false,
	wallSide = 0,
	sprinting = false,
	ads = false,
	airborne = false,
}

local movement = Config.Movement
local staminaCfg = movement.Stamina

-- ---------------------------------------------------------------------------
-- Runtime state
-- ---------------------------------------------------------------------------
local humanoid: Humanoid? = nil
local root: BasePart? = nil

local stamina = staminaCfg.Max
local lastSpend = 0
local sprinting = false
local sliding = false
local slideEnds = 0
local slideDirection = Vector3.zero
local slideCooldownUntil = 0
local wallRunning = false
local wallRunEnds = 0
local wallRunNormal = Vector3.zero
local wallRunCooldownUntil = 0
local airJumpsUsed = 0
local wasGrounded = true
local lastJumpPress = 0
local ads = false
local currentFov = 70
local heroName = Heroes.default

-- ---------------------------------------------------------------------------
-- Character binding
-- ---------------------------------------------------------------------------
local function bindCharacter(character: Model)
	humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid
	root = character:WaitForChild("HumanoidRootPart", 10) :: BasePart

	if not humanoid or not root then
		return
	end

	humanoid.UseJumpPower = true
	humanoid.JumpPower = movement.JumpPower
	-- AutoRotate off: the camera drives facing, so strafing does not spin the body.
	humanoid.AutoRotate = false
	humanoid.WalkSpeed = Heroes.get(heroName).walkSpeed

	-- Reset per-life movement state.
	stamina = staminaCfg.Max
	sliding = false
	wallRunning = false
	airJumpsUsed = 0
	ads = false
	Move.state.ads = false

	-- Camera is fully keyboard/mouse driven (see renderCamera).
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CameraSubject = humanoid
	currentFov = 70
end

player.CharacterAdded:Connect(bindCharacter)
if player.Character then
	task.spawn(bindCharacter, player.Character)
end

-- ---------------------------------------------------------------------------
-- Input
-- ---------------------------------------------------------------------------
local function spend(amount: number): boolean
	if stamina < amount then
		return false
	end
	stamina -= amount
	lastSpend = os.clock()
	return true
end

local function isGrounded(): boolean
	if not humanoid or not root then
		return false
	end
	local state = humanoid:GetState()
	if state == Enum.HumanoidStateType.Landed or state == Enum.HumanoidStateType.Running then
		return true
	end
	if state == Enum.HumanoidStateType.RunningNoPhysics then
		return true
	end
	-- Raycast fallback, needed during the frames either side of a jump.
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { player.Character :: Instance }
	local result = workspace:Raycast(root.Position, Vector3.new(0, -4.5, 0), params)
	return result ~= nil
end

local function startSlide()
	if sliding or os.clock() < slideCooldownUntil or not humanoid or not root then
		return
	end
	if not isGrounded() then
		return
	end
	local velocity = root.AssemblyLinearVelocity
	local flat = Vector3.new(velocity.X, 0, velocity.Z)
	if flat.Magnitude < 6 then
		-- Not moving fast enough to slide; fall back to a crouch nudge forward.
		flat = root.CFrame.LookVector * 6
	end
	if not spend(movement.Slide.Cost) then
		return
	end
	sliding = true
	slideEnds = os.clock() + movement.Slide.Duration
	slideDirection = flat.Unit
	Move.state.sliding = true
	Net.toServer("MoveState", { action = "slide", direction = slideDirection })
end

local function endSlide()
	sliding = false
	Move.state.sliding = false
	slideCooldownUntil = os.clock() + movement.Slide.Cooldown
end

local function tryJump()
	if not humanoid or not root then
		return
	end

	local now = os.clock()
	if now - lastJumpPress < 0.15 then
		return
	end
	lastJumpPress = now

	if sliding then
		-- Jumping out of a slide keeps its momentum: the classic slide-hop.
		endSlide()
		humanoid.Jump = true
		return
	end

	if isGrounded() then
		humanoid.Jump = true
		airJumpsUsed = 0
		return
	end

	-- Wall run takes priority over the air jump when a wall is available.
	if wallRunning then
		-- Hop off the wall.
		wallRunning = false
		Move.state.wallRunning = false
		wallRunCooldownUntil = os.clock() + movement.WallRun.Cooldown
		root.AssemblyLinearVelocity = wallRunNormal * 26 + Vector3.new(0, 18, 0)
		return
	end

	if airJumpsUsed < movement.DoubleJump.MaxJumps - 1 and spend(movement.DoubleJump.Cost) then
		local velocity = root.AssemblyLinearVelocity
		root.AssemblyLinearVelocity = Vector3.new(velocity.X, movement.DoubleJump.Impulse, velocity.Z)
		airJumpsUsed += 1
	end
end

local function setAds(enabled: boolean)
	ads = enabled
	Move.state.ads = enabled
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.Space then
		tryJump()
	elseif input.KeyCode == Enum.KeyCode.LeftShift then
		sprinting = true
	elseif input.KeyCode == Enum.KeyCode.LeftControl or input.KeyCode == Enum.KeyCode.C then
		startSlide()
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		setAds(true)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.LeftShift then
		sprinting = false
	elseif input.KeyCode == Enum.KeyCode.LeftControl or input.KeyCode == Enum.KeyCode.C then
		if sliding then
			endSlide()
		end
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		setAds(false)
	end
end)

-- ---------------------------------------------------------------------------
-- Wall run detection
-- ---------------------------------------------------------------------------
--- Finds a wall beside the player, roughly perpendicular to their travel.
local function findWall(): (Vector3?, Vector3?)
	if not root then
		return nil, nil
	end
	local velocity = root.AssemblyLinearVelocity
	local flat = Vector3.new(velocity.X, 0, velocity.Z)
	if flat.Magnitude < movement.WallRun.MinSpeed then
		return nil, nil
	end
	local forward = flat.Unit
	local up = root.CFrame.UpVector

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { player.Character :: Instance }

	local cosine = math.cos(math.rad(movement.WallRun.MaxAngle))
	-- Try both sides, preferring the one the player is drifting into.
	for _, sign in ipairs({ -1, 1 }) do
		local side = forward:Cross(up) * sign
		local result = workspace:Raycast(root.Position, side * movement.WallRun.RayLength, params)
		if result and math.abs(result.Normal.Y) < cosine then
			return result.Normal, side
		end
	end
	return nil, nil
end

-- ---------------------------------------------------------------------------
-- Per-frame movement
-- ---------------------------------------------------------------------------
local function stepSlide(now: number, dt: number)
	if not root or not humanoid then
		return
	end
	if now >= slideEnds then
		endSlide()
		return
	end

	-- Keep the slide flat and at its fixed speed, ignoring friction and drag.
	local velocity = root.AssemblyLinearVelocity
	root.AssemblyLinearVelocity = Vector3.new(
		slideDirection.X * movement.Slide.Speed,
		math.min(velocity.Y, 0),
		slideDirection.Z * movement.Slide.Speed
	)
	humanoid.WalkSpeed = 0 -- the slide owns horizontal motion
end

local function stepWallRun(now: number, dt: number)
	if not humanoid or not root then
		return
	end

	if wallRunning then
		if now >= wallRunEnds or not UserInputService:IsKeyDown(Enum.KeyCode.Space) or isGrounded() then
			wallRunning = false
			Move.state.wallRunning = false
			wallRunCooldownUntil = now + movement.WallRun.Cooldown
			humanoid.WalkSpeed = Heroes.get(heroName).walkSpeed
			return
		end
		if not spend(movement.WallRun.StaminaPerSecond * dt) then
			wallRunning = false
			Move.state.wallRunning = false
			wallRunCooldownUntil = now + movement.WallRun.Cooldown
			humanoid.WalkSpeed = Heroes.get(heroName).walkSpeed
			return
		end

		-- Hold horizontal speed along the wall and cancel gravity.
		local along = wallRunNormal:Cross(Vector3.yAxis)
		if along.Magnitude < 0.01 then
			along = root.CFrame.LookVector
		end
		along = along.Unit
		local velocity = root.AssemblyLinearVelocity
		if velocity:Dot(along) < 0 then
			along = -along
		end
		root.AssemblyLinearVelocity = Vector3.new(
			along.X * movement.WallRun.Speed,
			2, -- slight lift so the run reads as a run, not a stick
			along.Z * movement.WallRun.Speed
		)
		humanoid.WalkSpeed = 0
		return
	end

	-- Try to attach.
	if now < wallRunCooldownUntil or isGrounded() or sliding then
		return
	end
	if not UserInputService:IsKeyDown(Enum.KeyCode.Space) then
		return
	end
	if stamina < 8 then
		return
	end

	local normal, side = findWall()
	if not normal or not side then
		return
	end
	wallRunning = true
	wallRunEnds = now + movement.WallRun.MaxDuration
	wallRunNormal = normal
	Move.state.wallRunning = true
	Move.state.wallSide = -math.sign(side:Dot(root.CFrame.RightVector))
	Net.toServer("MoveState", { action = "wallrun", normal = normal })
end

local function stepStamina(now: number, dt: number)
	if now - lastSpend >= staminaCfg.RegenDelay then
		stamina = math.min(staminaCfg.Max, stamina + staminaCfg.RegenPerSecond * dt)
	end
	Move.state.stamina = stamina
end

local function stepSpeed()
	if not humanoid or sliding or wallRunning then
		return
	end
	local hero = Heroes.get(heroName)
	local speed = hero.walkSpeed
	if sprinting then
		speed *= movement.SprintMultiplier
	end
	humanoid.WalkSpeed = speed
	Move.state.sprinting = sprinting
end

local function stepGrounded()
	local grounded = isGrounded()
	if grounded and not wasGrounded then
		airJumpsUsed = 0
	end
	if grounded and not wasGrounded and wallRunning then
		wallRunning = false
		Move.state.wallRunning = false
	end
	wasGrounded = grounded
	Move.state.airborne = not grounded
end

-- ---------------------------------------------------------------------------
-- Camera
-- ---------------------------------------------------------------------------
local yaw = 0
local pitch = 0
local MOUSE_SENSITIVITY = 0.0032
local MIN_PITCH = math.rad(-88)
local MAX_PITCH = math.rad(88)
local cameraDistance = 14

local function stepCamera(dt: number, now: number)
	if not root or not humanoid or humanoid.Health <= 0 then
		return
	end

	-- Mouse look.
	local delta = UserInputService:GetMouseDelta()
	yaw -= delta.X * MOUSE_SENSITIVITY
	pitch -= delta.Y * MOUSE_SENSITIVITY
	pitch = Util.clamp(pitch, MIN_PITCH, MAX_PITCH)

	local roll = 0
	if wallRunning then
		roll = math.rad(movement.WallRun.CameraRoll) * Move.state.wallSide
	end
	local dip = 0
	if sliding then
		dip = movement.Slide.CameraDip
	end

	local rotation = CFrame.Angles(0, yaw, 0) * CFrame.Angles(pitch, 0, roll)
	local eye = root.Position + Vector3.new(0, 1.35 - dip, 0)

	-- Face the body where the camera looks, so shots go where the crosshair is.
	local flatLook = Vector3.new(-math.sin(yaw), 0, -math.cos(yaw))
	local lookTarget = eye + flatLook * 100
	root.CFrame = CFrame.lookAt(root.Position, Vector3.new(lookTarget.X, root.Position.Y, lookTarget.Z))

	-- Third-person when not aiming, first-person when aiming.
	local targetDistance = ads and 0 or cameraDistance
	local look = rotation.LookVector
	local desired

	if targetDistance > 0 then
		-- Keep the camera out of walls.
		desired = eye - look * targetDistance
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Exclude
		params.FilterDescendantsInstances = { player.Character :: Instance }
		local result = workspace:Raycast(eye, -look * targetDistance, params)
		if result then
			desired = result.Position + result.Normal * 0.6
		end
	else
		-- Sights are mounted slightly right of centre, matching the gun model.
		desired = eye - look * 0.35 + rotation.RightVector * 0.32
	end

	local targetFov = 70
	if ads then
		local tool = player.Character and player.Character:FindFirstChildOfClass("Tool")
		local weaponName = tool and tool:GetAttribute("Weapon")
		local weapon = type(weaponName) == "string" and Weapons.get(weaponName) or nil
		targetFov = weapon and weapon.adsFov or 55
	end

	currentFov += (targetFov - currentFov) * math.min(1, dt * 12)
	camera.FieldOfView = currentFov
	camera.CFrame = CFrame.lookAt(desired, desired + look)
end

-- ---------------------------------------------------------------------------
-- Loop
-- ---------------------------------------------------------------------------
RunService:BindToRenderStep("RivalsMovement", Enum.RenderPriority.Camera.Value - 1, function(dt)
	local now = os.clock()
	stepGrounded()
	stepStamina(now, dt)
	stepSlide(now, dt)
	stepWallRun(now, dt)
	stepSpeed()
end)

RunService:BindToRenderStep("RivalsCamera", Enum.RenderPriority.Camera.Value + 1, function(dt)
	stepCamera(dt, os.clock())
end)

-- ---------------------------------------------------------------------------
-- Server sync
-- ---------------------------------------------------------------------------
-- The server tracks the hero so movement speed and health stay authoritative.
Net.event("HudState").OnClientEvent:Connect(function(payload)
	if type(payload) == "table" and type(payload.hero) == "string" and payload.hero ~= heroName then
		heroName = payload.hero
	end
end)

--- Called by InputClient when the local hero changes, so speed updates instantly.
function Move.setHero(name: string)
	heroName = name
end

Move.getAds = function(): boolean
	return ads
end

Move.getSprint = function(): boolean
	return sprinting
end

Move.getHero = function(): string
	return heroName
end

return Move
