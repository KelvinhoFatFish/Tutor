--[[
	GameServer.luau  (Script)
	The only Script in this project. It boots everything else in dependency order
	and owns the player lifecycle.

	Place in ServerScriptService alongside the module scripts.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)

local Match = require(script.Parent.Match)
local WeaponServer = require(script.Parent.WeaponServer)
local HeroServer = require(script.Parent.HeroServer)
local ShopServer = require(script.Parent.ShopServer)

-- ---------------------------------------------------------------------------
-- Boot
-- ---------------------------------------------------------------------------
-- Order matters:
--   1. Weapon templates, so a player joining during warmup can be armed.
--   2. Match, which builds the arena and starts the phase loop.
--   3. Heroes and shop, which depend on Match state.
WeaponServer.buildTemplates()
Match.init()
HeroServer.init()
ShopServer.init()

print(string.format("[RIVALS] Server online. Hero arena, first to %d rounds.", Config.Match.RoundsToWin))

-- ---------------------------------------------------------------------------
-- Player lifecycle
-- ---------------------------------------------------------------------------
local function onPlayerAdded(player: Player)
	Match.setupPlayer(player)
	WeaponServer.trackPlayer(player)
	ShopServer.trackPlayer(player)

	-- Two-step control hint, so a new player is never lost.
	task.delay(3, function()
		if not player.Parent then
			return
		end
		Match.notify(player, "WASD move | Shift sprint | Ctrl slide | Space jump (twice)", Config.Palette.Cyan)
		task.delay(6, function()
			if player.Parent then
				Match.notify(player, "Q ultimate | B shop | R reload | Right mouse aim", Config.Palette.Cyan)
			end
		end)
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	Match.removePlayer(player)
	WeaponServer.removePlayer(player)
	HeroServer.removePlayer(player)
end)

-- ---------------------------------------------------------------------------
-- Death and respawn
-- ---------------------------------------------------------------------------
-- Manual respawn request, used by the death screen's "Respawn" button. Only
-- honoured during phases where bodies are allowed.
local respawnEvent = ReplicatedStorage:WaitForChild(Config.RemotesFolder):WaitForChild("RequestRespawn")
respawnEvent.OnServerEvent:Connect(function(player)
	local state = Match.getPlayerState(player)
	if not state or state.alive then
		return
	end
	local phase = Match.state.phase
	if phase == Config.Phase.Warmup or phase == Config.Phase.Buy then
		Match.spawnPlayer(player)
	end
end)

-- Warmup players respawn quickly so they can keep exploring the map.
task.spawn(function()
	while true do
		task.wait(1)
		if Match.state.phase == Config.Phase.Warmup then
			for _, state in pairs(Match.PlayerStates) do
				if not state.alive and os.clock() - state.lastDeathAt > Config.Combat.RespawnDelay then
					Match.spawnPlayer(state.player)
				end
			end
		end
		-- During Action, elimination is the round win condition, so no respawns.
	end
end)
