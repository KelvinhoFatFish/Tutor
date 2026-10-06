--[[
	Util.luau
	Small dependency-free helpers shared by client and server. Everything here is
	pure or uses only services guaranteed to exist on both sides.
]]

local RunService = game:GetService("RunService")
local Players = game:GetService("Players")

local Util = {}

-- ---------------------------------------------------------------------------
-- Random
-- ---------------------------------------------------------------------------
local rng = Random.new()

--- Uniform float in [min, max].
function Util.rand(min: number, max: number): number
	if max < min then
		min, max = max, min
	end
	return min + rng:NextNumber() * (max - min)
end

--- Uniform integer in [min, max] inclusive.
function Util.randInt(min: number, max: number): number
	return rng:NextInteger(min, max)
end

--- True with probability `chance` (0..1).
function Util.chance(chance: number): boolean
	return rng:NextNumber() < chance
end

--- Deterministic RNG from a seed, for reproducible geometry (the arena).
function Util.seeded(seed: number): Random
	return Random.new(seed)
end

function Util.pick<T>(list: { T }): T?
	if #list == 0 then
		return nil
	end
	return list[rng:NextInteger(1, #list)]
end

-- ---------------------------------------------------------------------------
-- Numbers
-- ---------------------------------------------------------------------------
function Util.clamp(value: number, min: number, max: number): number
	if value < min then
		return min
	elseif value > max then
		return max
	end
	return value
end

function Util.lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

--- Linear damage falloff between `minRange` and `maxRange`.
--- Returns 1.0 inside minRange, `floor` beyond maxRange.
function Util.falloff(distance: number, minRange: number, maxRange: number, floor: number): number
	if distance <= minRange then
		return 1
	end
	if distance >= maxRange then
		return floor
	end
	local t = (distance - minRange) / (maxRange - minRange)
	return Util.lerp(1, floor, t)
end

--- Formats seconds as m:ss for the HUD.
function Util.formatClock(seconds: number): string
	local total = math.max(0, math.floor(seconds))
	return string.format("%d:%02d", total // 60, total % 60)
end

--- 12500 -> "12.5K"
function Util.abbreviate(n: number): string
	if n >= 1e6 then
		return string.format("%.1fM", n / 1e6)
	elseif n >= 1e3 then
		return string.format("%.1fK", n / 1e3)
	end
	return tostring(math.floor(n))
end

--- Shortest signed angular difference, in degrees.
function Util.angleDelta(a: number, b: number): number
	return ((a - b + 180) % 360) - 180
end

-- ---------------------------------------------------------------------------
-- Instances
-- ---------------------------------------------------------------------------
--- Creates an Instance and applies properties in one call.
--- Property assignment is pcall'd so an unsupported enum on one client/version
--- never takes down the whole build.
function Util.create(className: string, props: { [string]: any }?, children: { Instance }?): Instance
	local inst = Instance.new(className)
	if props then
		for key, value in pairs(props) do
			local ok, err = pcall(function()
				(inst :: any)[key] = value
			end)
			if not ok then
				warn(string.format("[RIVALS] Util.create(%s).%s failed: %s", className, key, tostring(err)))
			end
		end
	end
	if children then
		for _, child in ipairs(children) do
			child.Parent = inst
		end
	end
	return inst
end

--- Finds a direct child by name, or nil. No yielding.
function Util.find(parent: Instance?, name: string): Instance?
	if not parent then
		return nil
	end
	return parent:FindFirstChild(name)
end

--- Creates a folder if missing and returns it.
function Util.folder(parent: Instance, name: string): Folder
	local existing = parent:FindFirstChild(name)
	if existing and existing:IsA("Folder") then
		return existing
	end
	return Util.create("Folder", { Name = name, Parent = parent }) :: Folder
end

--- Everything under a character that a bullet can hit.
function Util.characterParts(character: Model): { BasePart }
	local parts: { BasePart } = {}
	for _, descendant in ipairs(character:GetDescendants()) do
		if descendant:IsA("BasePart") then
			table.insert(parts, descendant)
		end
	end
	return parts
end

--- Walks up from a hit part to the character Model and its Player, if any.
function Util.playerFromPart(part: Instance?): (Player?, Model?)
	if not part then
		return nil, nil
	end
	local model = part:FindFirstAncestorOfClass("Model")
	while model do
		local humanoid = model:FindFirstChildOfClass("Humanoid")
		if humanoid then
			return Players:GetPlayerFromCharacter(model), model
		end
		model = model:FindFirstAncestorOfClass("Model")
	end
	return nil, nil
end

--- True if the player has a living humanoid right now.
function Util.isAlive(player: Player): boolean
	local character = player.Character
	if not character then
		return false
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	return humanoid ~= nil and humanoid.Health > 0
end

--- Safe sound playback: never errors, always cleans up after itself.
function Util.playSound(parent: Instance, soundId: string, volume: number?, pitch: number?): Sound?
	if soundId == "" then
		return nil
	end
	local sound = Instance.new("Sound")
	sound.SoundId = soundId
	sound.Volume = volume or 1
	sound.PlaybackSpeed = pitch or 1
	sound.Parent = parent
	local ok = pcall(function()
		sound:Play()
	end)
	if not ok then
		sound:Destroy()
		return nil
	end
	task.delay(6, function()
		if sound.Parent then
			sound:Destroy()
		end
	end)
	return sound
end

-- ---------------------------------------------------------------------------
-- Environment
-- ---------------------------------------------------------------------------
function Util.isServer(): boolean
	return RunService:IsServer()
end

function Util.isClient(): boolean
	return RunService:IsClient()
end

--- "cyan" / "magenta" team key from a team number.
function Util.teamName(teamNumber: number?): string
	if teamNumber == 2 then
		return "Magenta"
	end
	return "Cyan"
end

--- The opposing team number.
function Util.enemyTeam(teamNumber: number): number
	if teamNumber == 1 then
		return 2
	end
	return 1
end

return Util
