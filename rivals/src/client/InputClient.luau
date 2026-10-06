--[[
	InputClient.luau  (LocalScript)
	Firing, reloading, and ultimates.

	Firing is client-initiated for responsiveness: the client traces the crosshair
	to find a point in the world and reports that point plus a direction. The
	server decides spread, does the real trace, and applies damage. The client's
	raycast is only used to decide where the mouse was pointing.

	Holds fire for automatic weapons, one request per shot for semi-auto, and
	three requests for a burst.

	See DESIGN.md section 6.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Weapons = require(Shared.Weapons)

local Move = require(script.Parent.MoveClient)
local Fx = require(script.Parent.FxClient)

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local Input = {}

local heroName = Heroes.default
local ready = false
local ultimateReady = false
local ultimateCooldown = 0
local mouseDown = false
local lastRequest = 0
local burstRemaining = 0
local burstUntil = 0
local shotCounter = 0

-- ---------------------------------------------------------------------------
-- Aim resolution
-- ---------------------------------------------------------------------------
--- Returns the world point under the crosshair, and the aim direction.
local function crosshairPoint(): (Vector3, Vector3)
	local origin = camera.CFrame.Position
	local direction = camera.CFrame.LookVector

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { player.Character :: Instance }
	local result = workspace:Raycast(origin, direction * Config.Combat.MaxRayDistance, params)
	if result then
		return result.Position, (result.Position - origin).Unit
	end
	return origin + direction * Config.Combat.MaxRayDistance, direction
end

--- The weapon currently held, from the server-set Tool attribute.
local function currentWeapon()
	local character = player.Character
	if not character then
		return nil
	end
	local tool = character:FindFirstChildOfClass("Tool")
	if not tool then
		return nil
	end
	local name = tool:GetAttribute("Weapon")
	if type(name) ~= "string" then
		return nil
	end
	return Weapons.get(name)
end

-- ---------------------------------------------------------------------------
-- Firing
-- ---------------------------------------------------------------------------
--- World position of the held weapon's muzzle, for the local muzzle flash.
local function muzzlePosition(): Vector3?
	local character = player.Character
	if not character then
		return nil
	end
	local tool = character:FindFirstChildOfClass("Tool")
	if not tool then
		return nil
	end
	for _, descendant in ipairs(tool:GetDescendants()) do
		if descendant:IsA("Attachment") and descendant.Name == "Muzzle" then
			return descendant.WorldPosition
		end
	end
	local handle = tool:FindFirstChild("Handle")
	if handle and handle:IsA("BasePart") then
		return handle.Position
	end
	return nil
end

local function sendShot()
	local weapon = currentWeapon()
	if not weapon then
		return
	end

	local origin = camera.CFrame.Position
	local _, aimDirection = crosshairPoint()

	shotCounter += 1
	-- The seed is shared with the server, so the spread pattern the server
	-- applies is the same one the player can predict.
	local seed = (os.time() * 1000 + shotCounter) % 2147483647

	Net.toServer("Fire", {
		origin = origin,
		direction = aimDirection,
		seed = seed,
		ads = Move.getAds(),
	})

	-- Local muzzle flash: the shooter never receives their own "fire" event, so
	-- it has to be drawn here to feel instant.
	local muzzle = muzzlePosition()
	if muzzle then
		Fx.localShot(muzzle, aimDirection, weapon.visual.color, weapon.visual.muzzleScale)
	end
end

local function canFire(): boolean
	if not ready then
		return false
	end
	local weapon = currentWeapon()
	if not weapon then
		return false
	end
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid or humanoid.Health <= 0 then
		return false
	end
	local tool = character:FindFirstChildOfClass("Tool")
	if tool and tool:GetAttribute("Reloading") == true then
		return false
	end
	if tool and (tool:GetAttribute("Ammo") or 0) <= 0 and not Weapons.isMelee(weapon) then
		-- Auto-reload rather than making the player notice.
		Net.toServer("Reload")
		return false
	end
	return true
end

--- Sends the shots for one trigger pull: one for semi-auto, a burst for burst
--- weapons. Automatic weapons rely on the held-mouse loop instead.
local function pullTrigger()
	local weapon = currentWeapon()
	if not weapon or not canFire() then
		return
	end

	-- A burst already in flight owns the trigger.
	if burstRemaining > 0 then
		return
	end

	if weapon.burstSize > 1 then
		burstRemaining = weapon.burstSize
		-- The whole burst must land inside the weapon's cycle time.
		burstUntil = os.clock() + (weapon.burstSize - 1) * weapon.burstDelay + 0.25
		lastRequest = os.clock()
		return
	end

	local now = os.clock()
	if now - lastRequest < weapon.fireRate then
		return
	end
	lastRequest = now
	sendShot()
end

-- ---------------------------------------------------------------------------
-- Ultimate
-- ---------------------------------------------------------------------------
-- The server owns the cooldown; this only forwards the intent. Pressing Q early
-- gets a "still cooling down" message back, which is better feedback than a
-- silently dead key.
local function useUltimate()
	if not ready then
		return
	end
	Net.toServer("UseUltimate", Heroes.get(heroName).ultimate.kind)
end

-- ---------------------------------------------------------------------------
-- Input
-- ---------------------------------------------------------------------------
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		mouseDown = true
		pullTrigger()
	elseif input.KeyCode == Enum.KeyCode.R then
		Net.toServer("Reload")
	elseif input.KeyCode == Enum.KeyCode.Q then
		useUltimate()
	elseif input.KeyCode == Enum.KeyCode.One then
		local character = player.Character
		local tool = character and character:FindFirstChildOfClass("Tool")
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if tool and humanoid then
			humanoid:UnequipTools()
		end
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		mouseDown = false
		burstRemaining = 0
	end
end)

-- ---------------------------------------------------------------------------
-- Automatic fire and burst stepping
-- ---------------------------------------------------------------------------
RunService.Heartbeat:Connect(function()
	local now = os.clock()
	local weapon = currentWeapon()
	if not weapon then
		burstRemaining = 0
		return
	end

	-- Finish an in-flight burst first.
	if burstRemaining > 0 then
		if now > burstUntil then
			burstRemaining = 0
		elseif now - lastRequest >= weapon.burstDelay then
			lastRequest = now
			burstRemaining -= 1
			sendShot()
		end
		return
	end

	if not mouseDown then
		return
	end

	-- Holding the mouse keeps bursts coming, at the weapon's cycle rate.
	if weapon.burstSize > 1 then
		local cycle = weapon.fireRate + (weapon.burstSize - 1) * weapon.burstDelay
		if now - lastRequest >= cycle then
			pullTrigger()
		end
		return
	end

	if not weapon.auto then
		return
	end
	if now - lastRequest < weapon.fireRate then
		return
	end
	if not canFire() then
		return
	end
	lastRequest = now
	sendShot()
end)

-- ---------------------------------------------------------------------------
-- Server state
-- ---------------------------------------------------------------------------
Net.event("HudState").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if type(payload.hero) == "string" then
		heroName = payload.hero
		Move.setHero(payload.hero)
	end
	if type(payload.ultReady) == "boolean" then
		ultimateReady = payload.ultReady
	end
	if type(payload.ultCooldown) == "number" then
		ultimateCooldown = payload.ultCooldown
	end
end)

Net.event("AbilityFeedback").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if payload.kind == "cooldown" or payload.kind == "fail" then
		ultimateReady = false
	end
end)

--- Blocks input until the match says the round is live.
Net.event("RoundState").OnClientEvent:Connect(function(payload)
	if type(payload) == "table" then
		ready = payload.phase == Config.Phase.Action or payload.phase == Config.Phase.Warmup
	end
end)

Input.currentWeapon = currentWeapon
Input.isReady = function(): boolean
	return ready
end
Input.ultimateCooldown = function(): number
	return ultimateCooldown
end
Input.ultimateReady = function(): boolean
	return ultimateReady
end

return Input
