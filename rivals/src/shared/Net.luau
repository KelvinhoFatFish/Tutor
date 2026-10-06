--[[
	Net.luau
	Creates and caches the RemoteEvents declared in Config, on whichever side
	requires this module first. Client code should WaitForChild so it survives
	loading before the server has built the folder.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(script.Parent.Config)
local Util = require(script.Parent.Util)

local Net = {}

local folder: Folder

local function makeEvent(parent: Instance, name: string): RemoteEvent
	local existing = parent:FindFirstChild(name)
	if existing and existing:IsA("RemoteEvent") then
		return existing
	end
	local event = Instance.new("RemoteEvent")
	event.Name = name
	event.Parent = parent
	return event
end

if RunService:IsServer() then
	folder = Util.folder(ReplicatedStorage, Config.RemotesFolder)
	for _, name in ipairs(Config.ServerEvents) do
		makeEvent(folder, name)
	end
	for _, name in ipairs(Config.ClientEvents) do
		makeEvent(folder, name)
	end
else
	folder = ReplicatedStorage:WaitForChild(Config.RemotesFolder, 30) :: Folder
	if not folder then
		error("[RIVALS] Remotes folder never replicated. Is the server running?")
	end
end

--- RemoteEvent by name. Errors loudly on a typo rather than returning nil.
function Net.event(name: string): RemoteEvent
	if RunService:IsClient() then
		local found = folder:WaitForChild(name, 20)
		if not found then
			error(string.format("[RIVALS] RemoteEvent %q never replicated", name))
		end
		return found :: RemoteEvent
	end

	local existing = folder:FindFirstChild(name)
	if existing and existing:IsA("RemoteEvent") then
		return existing
	end
	return makeEvent(folder, name)
end

--- Fire-and-forget to one player (server only).
function Net.toPlayer(name: string, player: Player, ...)
	Net.event(name):FireClient(player, ...)
end

--- Fire-and-forget to everyone (server only).
function Net.toAll(name: string, ...)
	Net.event(name):FireAllClients(...)
end

--- Fire-and-forget except one player (server only).
function Net.toOthers(name: string, except: Player, ...)
	for _, player in ipairs(game:GetService("Players"):GetPlayers()) do
		if player ~= except then
			Net.event(name):FireClient(player, ...)
		end
	end
end

--- Client -> server request.
function Net.toServer(name: string, ...)
	Net.event(name):FireServer(...)
end

function Net.folder(): Folder
	return folder
end

return Net
