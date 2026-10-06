--[[
	LeaderboardClient.luau  (LocalScript)
	Reads every player's leaderstats folder and draws a scoreboard under the kill
	feed. Sorted by kills, then by deaths ascending.

	The server creates the values (see Match.ensureLeaderstats): Kills, Deaths,
	Rounds, XP, Rating.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local P = Config.Palette

local ROW_HEIGHT = 22
local MAX_ROWS = 10

-- ---------------------------------------------------------------------------
-- UI shell
-- ---------------------------------------------------------------------------
local gui = Instance.new("ScreenGui")
gui.Name = "RivalsLeaderboard"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local panel = Instance.new("Frame")
panel.Name = "Panel"
panel.AnchorPoint = Vector2.new(1, 0)
panel.Position = UDim2.new(1, -18, 0, 260)
panel.Size = UDim2.fromOffset(330, ROW_HEIGHT * (MAX_ROWS + 1) + 14)
panel.BackgroundColor3 = P.Base
panel.BackgroundTransparency = 0.35
panel.BorderSizePixel = 0
panel.Visible = Config.Hud.ShowLeaderboard
panel.Parent = gui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 6)
corner.Parent = panel

local stroke = Instance.new("UIStroke")
stroke.Color = P.Gray
stroke.Thickness = 1
stroke.Transparency = 0.4
stroke.Parent = panel

local layout = Instance.new("UIListLayout")
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Padding = UDim.new(0, 1)
layout.Parent = panel

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 6)
padding.PaddingLeft = UDim.new(0, 8)
padding.PaddingRight = UDim.new(0, 8)
padding.Parent = panel

-- ---------------------------------------------------------------------------
-- Row helpers
-- ---------------------------------------------------------------------------
local function makeRow(order: number): (Frame, TextLabel, TextLabel, TextLabel)
	local row = Instance.new("Frame")
	row.Name = "Row"
	row.Size = UDim2.new(1, 0, 0, ROW_HEIGHT)
	row.BackgroundTransparency = 1
	row.LayoutOrder = order
	row.Parent = panel

	local function cell(x: number, width: number, align: Enum.TextXAlignment): TextLabel
		local label = Instance.new("TextLabel")
		label.Position = UDim2.fromOffset(x, 0)
		label.Size = UDim2.fromOffset(width, ROW_HEIGHT)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.GothamMedium
		label.TextSize = 14
		label.TextColor3 = P.White
		label.TextXAlignment = align
		label.Text = ""
		label.Parent = row
		return label
	end

	local name = cell(0, 170, Enum.TextXAlignment.Left)
	local kills = cell(172, 44, Enum.TextXAlignment.Center)
	local deaths = cell(216, 44, Enum.TextXAlignment.Center)
	local rating = cell(260, 62, Enum.TextXAlignment.Right)
	return row, name, kills, deaths, rating
end

local rows: { { row: Frame, name: TextLabel, kills: TextLabel, deaths: TextLabel, rating: TextLabel } } = {}

-- Header row.
do
	local header, nameCell, killCell, deathCell, ratingCell = makeRow(0)
	nameCell.Text = "PLAYER"
	nameCell.TextColor3 = P.Cyan
	killCell.Text = "K"
	killCell.TextColor3 = P.Cyan
	deathCell.Text = "D"
	deathCell.TextColor3 = P.Cyan
	ratingCell.Text = "RANK"
	ratingCell.TextColor3 = P.Cyan
	_ = header
end

for index = 1, MAX_ROWS do
	local row, name, kills, deaths, rating = makeRow(index)
	rows[index] = { row = row, name = name, kills = kills, deaths = deaths, rating = rating }
end

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------
local function statOf(target: Player, name: string): number
	local leaderstats = target:FindFirstChild("leaderstats")
	local value = leaderstats and leaderstats:FindFirstChild(name)
	if value and value:IsA("IntValue") then
		return value.Value
	end
	return 0
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

local function refresh()
	local entries = {}
	for _, target in ipairs(Players:GetPlayers()) do
		table.insert(entries, {
			player = target,
			kills = statOf(target, "Kills"),
			deaths = statOf(target, "Deaths"),
			rating = statOf(target, "Rating"),
		})
	end

	table.sort(entries, function(a, b)
		if a.kills ~= b.kills then
			return a.kills > b.kills
		end
		if a.deaths ~= b.deaths then
			return a.deaths < b.deaths
		end
		return a.player.Name < b.player.Name
	end)

	for index, entry in ipairs(rows) do
		local data = entries[index]
		if data then
			entry.row.Visible = true
			entry.name.Text = data.player.Name
			entry.name.TextColor3 = if data.player == player then P.Amber else P.White
			entry.kills.Text = tostring(data.kills)
			entry.deaths.Text = tostring(data.deaths)
			entry.rating.Text = rankFor(data.rating)
			entry.rating.TextColor3 = P.Violet
		else
			entry.row.Visible = false
		end
	end
end

task.spawn(function()
	while true do
		refresh()
		task.wait(1)
	end
end)

-- Tab toggles the scoreboard. The shop lives on B so the two never collide.
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.Tab then
		panel.Visible = not panel.Visible
	end
end)

return gui
