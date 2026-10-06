--[[
	HudClient.luau  (LocalScript)
	The entire interface: crosshair, health/armor/stamina, weapon and ammo, round
	score and timer, kill feed, banners, toasts, hit markers, hurt vignette, the
	buy menu, and the hero select screen.

	Built entirely in code. All layout numbers are in the LAYOUT block below so the
	HUD can be retuned without hunting through the build functions.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Util = require(Shared.Util)
local Weapons = require(Shared.Weapons)

local Move = require(script.Parent.MoveClient)

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local P = Config.Palette

-- ---------------------------------------------------------------------------
-- Layout constants
-- ---------------------------------------------------------------------------
local LAYOUT = {
	Pad = 18,
	PanelCorner = UDim.new(0, 6),
	BarWidth = 220,
	BarHeight = 14,
	BarGap = 6,
	Font = Enum.Font.GothamBold,
	FontMedium = Enum.Font.GothamMedium,
	Small = 13,
	Body = 15,
	Heading = 22,
	VignetteMax = Config.Hud.DamageVignetteMax,
}

-- ---------------------------------------------------------------------------
-- Build helpers
-- ---------------------------------------------------------------------------
local function frame(props: { [string]: any }): Frame
	local instance = Instance.new("Frame")
	instance.BorderSizePixel = 0
	for key, value in pairs(props) do
		(instance :: any)[key] = value
	end
	return instance
end

local function label(props: { [string]: any }): TextLabel
	local instance = Instance.new("TextLabel")
	instance.BackgroundTransparency = 1
	instance.BorderSizePixel = 0
	instance.Font = LAYOUT.Font
	instance.TextColor3 = P.White
	instance.TextXAlignment = Enum.TextXAlignment.Left
	for key, value in pairs(props) do
		(instance :: any)[key] = value
	end
	return instance
end

local function corner(parent: Instance, radius: UDim?): UICorner
	local instance = Instance.new("UICorner")
	instance.CornerRadius = radius or LAYOUT.PanelCorner
	instance.Parent = parent
	return instance
end

local function stroke(parent: Instance, color: Color3, thickness: number?): UIStroke
	local instance = Instance.new("UIStroke")
	instance.Color = color
	instance.Thickness = thickness or 1
	instance.Transparency = 0.35
	instance.Parent = parent
	return instance
end

-- ---------------------------------------------------------------------------
-- Root
-- ---------------------------------------------------------------------------
local gui = Instance.new("ScreenGui")
gui.Name = "RivalsHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

-- ===================== Crosshair =====================
local crosshair = frame({
	Name = "Crosshair",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(22, 22),
	BackgroundTransparency = 1,
	Parent = gui,
})
do
	local thickness = 2
	local length = 7
	local gap = 3
	local specs = {
		{ UDim2.fromOffset(gap, -thickness / 2), UDim2.fromOffset(length, thickness) },
		{ UDim2.fromOffset(-gap - length, -thickness / 2), UDim2.fromOffset(length, thickness) },
		{ UDim2.fromOffset(-thickness / 2, gap), UDim2.fromOffset(thickness, length) },
		{ UDim2.fromOffset(-thickness / 2, -gap - length), UDim2.fromOffset(thickness, length) },
	}
	for _, spec in ipairs(specs) do
		frame({
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.new(0.5, spec[1].X.Offset, 0.5, spec[1].Y.Offset),
			Size = spec[2],
			BackgroundColor3 = P.White,
			BackgroundTransparency = 0.15,
			Parent = crosshair,
		})
	end
end

--- Hit marker: a quick X at the crosshair.
local hitMarker = frame({
	Name = "HitMarker",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(26, 26),
	BackgroundTransparency = 1,
	Visible = false,
	Parent = gui,
})
do
	for _, rotation in ipairs({ 45, -45 }) do
		frame({
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.fromScale(0.5, 0.5),
			Size = UDim2.fromOffset(18, 2),
			BackgroundColor3 = P.White,
			Rotation = rotation,
			Parent = hitMarker,
		})
	end
end

-- ===================== Hurt vignette =====================
local vignette = frame({
	Name = "Vignette",
	Size = UDim2.fromScale(1, 1),
	BackgroundColor3 = P.Red,
	BackgroundTransparency = 1,
	ZIndex = 2,
	Parent = gui,
})
do
	local gradient = Instance.new("UIGradient")
	gradient.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0),
		NumberSequenceKeypoint.new(0.45, 1),
		NumberSequenceKeypoint.new(1, 0),
	})
	gradient.Rotation = 90
	gradient.Parent = vignette
end

-- ===================== Round bar (top centre) =====================
local roundBar = frame({
	Name = "RoundBar",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, LAYOUT.Pad),
	Size = UDim2.fromOffset(320, 56),
	BackgroundColor3 = P.Base,
	BackgroundTransparency = 0.25,
	Parent = gui,
})
corner(roundBar)
stroke(roundBar, P.Cyan)

local roundLabel = label({
	Name = "Round",
	Position = UDim2.fromOffset(12, 4),
	Size = UDim2.fromOffset(120, 18),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Small,
	TextColor3 = P.Gray,
	Text = "WARMUP",
	Parent = roundBar,
})

local timerLabel = label({
	Name = "Timer",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 18),
	Size = UDim2.fromOffset(140, 28),
	TextSize = 24,
	TextXAlignment = Enum.TextXAlignment.Center,
	Text = "0:00",
	Parent = roundBar,
})

local scoreLeft = label({
	Name = "ScoreLeft",
	Position = UDim2.fromOffset(14, 22),
	Size = UDim2.fromOffset(60, 26),
	TextSize = LAYOUT.Heading,
	TextColor3 = Config.Teams[1].Color,
	Text = "0",
	Parent = roundBar,
})

local scoreRight = label({
	Name = "ScoreRight",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -14, 0, 22),
	Size = UDim2.fromOffset(60, 26),
	TextSize = LAYOUT.Heading,
	TextXAlignment = Enum.TextXAlignment.Right,
	TextColor3 = Config.Teams[2].Color,
	Text = "0",
	Parent = roundBar,
})

--- Small "3 v 2" alive counter under the round bar.
local aliveLabel = label({
	Name = "Alive",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 60),
	Size = UDim2.fromOffset(200, 18),
	TextXAlignment = Enum.TextXAlignment.Center,
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Small,
	TextColor3 = P.Gray,
	Text = "",
	Parent = gui,
})

-- ===================== Health / armor / stamina (bottom left) =====================
local vitals = frame({
	Name = "Vitals",
	AnchorPoint = Vector2.new(0, 1),
	Position = UDim2.new(0, LAYOUT.Pad, 1, -LAYOUT.Pad),
	Size = UDim2.fromOffset(LAYOUT.BarWidth + 60, 96),
	BackgroundTransparency = 1,
	Parent = gui,
})

local heroLabel = label({
	Name = "Hero",
	Position = UDim2.fromOffset(0, 0),
	Size = UDim2.fromOffset(LAYOUT.BarWidth + 60, 20),
	TextSize = LAYOUT.Body,
	Text = "The Rusher",
	Parent = vitals,
})

local function makeBar(y: number, color: Color3): (Frame, Frame)
	local track = frame({
		Position = UDim2.fromOffset(0, y),
		Size = UDim2.fromOffset(LAYOUT.BarWidth, LAYOUT.BarHeight),
		BackgroundColor3 = P.DarkGray,
		BackgroundTransparency = 0.25,
		Parent = vitals,
	})
	corner(track, UDim.new(0, 3))
	local fill = frame({
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = color,
		Parent = track,
	})
	corner(fill, UDim.new(0, 3))
	return track, fill
end

local healthTrack, healthFill = makeBar(26, P.Green)
local armorTrack, armorFill = makeBar(26 + LAYOUT.BarHeight + LAYOUT.BarGap, P.Cyan)
local staminaTrack, staminaFill = makeBar(26 + (LAYOUT.BarHeight + LAYOUT.BarGap) * 2, P.Amber)

local healthText = label({
	Name = "HealthText",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(0, LAYOUT.BarWidth + 58, 0, 24),
	Size = UDim2.fromOffset(60, 18),
	TextSize = LAYOUT.Body,
	TextXAlignment = Enum.TextXAlignment.Right,
	Text = "100",
	Parent = vitals,
})

local armorText = label({
	Name = "ArmorText",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(0, LAYOUT.BarWidth + 58, 0, 24 + LAYOUT.BarHeight + LAYOUT.BarGap),
	Size = UDim2.fromOffset(60, 14),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Small,
	TextXAlignment = Enum.TextXAlignment.Right,
	TextColor3 = P.Cyan,
	Text = "",
	Parent = vitals,
})

-- ===================== Weapon and ammo (bottom right) =====================
local weaponPanel = frame({
	Name = "Weapon",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -LAYOUT.Pad, 1, -LAYOUT.Pad),
	Size = UDim2.fromOffset(220, 72),
	BackgroundColor3 = P.Base,
	BackgroundTransparency = 0.3,
	Parent = gui,
})
corner(weaponPanel)
stroke(weaponPanel, P.Gray)

local weaponName = label({
	Name = "WeaponName",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -12, 0, 6),
	Size = UDim2.fromOffset(196, 22),
	TextSize = LAYOUT.Body,
	TextXAlignment = Enum.TextXAlignment.Right,
	Text = "Sidearm",
	Parent = weaponPanel,
})

local ammoLabel = label({
	Name = "Ammo",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -12, 0, 26),
	Size = UDim2.fromOffset(196, 34),
	TextSize = 30,
	TextXAlignment = Enum.TextXAlignment.Right,
	Text = "12 / 12",
	Parent = weaponPanel,
})

local ultimateLabel = label({
	Name = "Ultimate",
	Position = UDim2.fromOffset(12, 34),
	Size = UDim2.fromOffset(180, 18),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Small,
	TextColor3 = P.Violet,
	Text = "Q  Blitz Dash",
	Parent = weaponPanel,
})

-- ===================== Kill feed (top right) =====================
local killFeed = frame({
	Name = "KillFeed",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -LAYOUT.Pad, 0, LAYOUT.Pad),
	Size = UDim2.fromOffset(340, 200),
	BackgroundTransparency = 1,
	Parent = gui,
})
local feedLayout = Instance.new("UIListLayout")
feedLayout.SortOrder = Enum.SortOrder.LayoutOrder
feedLayout.HorizontalAlignment = Enum.HorizontalAlignment.Right
feedLayout.Padding = UDim.new(0, 4)
feedLayout.Parent = killFeed

-- ===================== Toast column (left, under round bar) =====================
local toasts = frame({
	Name = "Toasts",
	Position = UDim2.new(0, LAYOUT.Pad, 0, 100),
	Size = UDim2.fromOffset(320, 240),
	BackgroundTransparency = 1,
	Parent = gui,
})
local toastLayout = Instance.new("UIListLayout")
toastLayout.SortOrder = Enum.SortOrder.LayoutOrder
toastLayout.Padding = UDim.new(0, 5)
toastLayout.Parent = toasts

-- ===================== Centre banner =====================
local banner = frame({
	Name = "Banner",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(0.5, 0, 0.34, 0),
	Size = UDim2.fromOffset(560, 92),
	BackgroundTransparency = 1,
	Visible = false,
	Parent = gui,
})

local bannerText = label({
	Name = "Text",
	Size = UDim2.new(1, 0, 0, 56),
	TextSize = 44,
	TextXAlignment = Enum.TextXAlignment.Center,
	Text = "",
	Parent = banner,
})

local bannerSub = label({
	Name = "Sub",
	Position = UDim2.fromOffset(0, 56),
	Size = UDim2.new(1, 0, 0, 26),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Body,
	TextXAlignment = Enum.TextXAlignment.Center,
	TextColor3 = P.White,
	Text = "",
	Parent = banner,
})

-- ===================== Death overlay =====================
local deathScreen = frame({
	Name = "Death",
	Size = UDim2.fromScale(1, 1),
	BackgroundColor3 = Color3.new(0, 0, 0),
	BackgroundTransparency = 0.55,
	Visible = false,
	ZIndex = 3,
	Parent = gui,
})

label({
	Name = "KilledBy",
	Position = UDim2.new(0, 0, 0.38, 0),
	Size = UDim2.new(1, 0, 0, 40),
	TextSize = 32,
	TextXAlignment = Enum.TextXAlignment.Center,
	Text = "Eliminated",
	ZIndex = 4,
	Parent = deathScreen,
})

label({
	Name = "Hint",
	Position = UDim2.new(0, 0, 0.46, 0),
	Size = UDim2.new(1, 0, 0, 24),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Body,
	TextXAlignment = Enum.TextXAlignment.Center,
	TextColor3 = P.Gray,
	Text = "You will respawn next round",
	ZIndex = 4,
	Parent = deathScreen,
})

-- ===================== Menu shell (shop + hero select) =====================
local menu = frame({
	Name = "Menu",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(760, 460),
	BackgroundColor3 = P.Base,
	BackgroundTransparency = 0.06,
	Visible = false,
	ZIndex = 5,
	Parent = gui,
})
corner(menu, UDim.new(0, 10))
stroke(menu, P.Cyan, 2)

local menuTitle = label({
	Name = "Title",
	Position = UDim2.fromOffset(20, 14),
	Size = UDim2.fromOffset(500, 30),
	TextSize = 24,
	Text = "ARMORY",
	ZIndex = 6,
	Parent = menu,
})

local menuHint = label({
	Name = "Hint",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -20, 0, 20),
	Size = UDim2.fromOffset(300, 22),
	Font = LAYOUT.FontMedium,
	TextSize = LAYOUT.Small,
	TextXAlignment = Enum.TextXAlignment.Right,
	TextColor3 = P.Gray,
	Text = "B / Tab to close   |   click to buy",
	ZIndex = 6,
	Parent = menu,
})

local menuCredits = label({
	Name = "Credits",
	Position = UDim2.fromOffset(20, 46),
	Size = UDim2.fromOffset(400, 24),
	TextSize = LAYOUT.Body,
	TextColor3 = P.Amber,
	Text = "800 credits",
	ZIndex = 6,
	Parent = menu,
})

local menuBody = Instance.new("ScrollingFrame")
menuBody.Name = "Body"
menuBody.Position = UDim2.fromOffset(20, 78)
menuBody.Size = UDim2.fromOffset(720, 362)
menuBody.BackgroundTransparency = 1
menuBody.BorderSizePixel = 0
menuBody.ScrollBarThickness = 4
menuBody.ScrollBarImageColor3 = P.Cyan
menuBody.CanvasSize = UDim2.new()
menuBody.ZIndex = 6
menuBody.Parent = menu

local bodyLayout = Instance.new("UIListLayout")
bodyLayout.SortOrder = Enum.SortOrder.LayoutOrder
bodyLayout.Padding = UDim.new(0, 6)
bodyLayout.Parent = menuBody

-- ---------------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------------
local state = {
	health = 100,
	maxHealth = 100,
	armor = 0,
	maxArmor = 0,
	credits = Config.Economy.StartCredits,
	weapon = "sidearm",
	ammo = 0,
	magSize = 0,
	reloading = false,
	hero = Heroes.default,
	ultReady = true,
	ultCooldown = 0,
	phase = Config.Phase.Warmup,
	menuOpen = false,
	menuMode = "shop",
	catalog = {},
	alive = true,
}

local staminaValue = Config.Movement.Stamina.Max
local feedOrder = 0

-- ---------------------------------------------------------------------------
-- Small UI verbs
-- ---------------------------------------------------------------------------
local function setBar(fill: Frame, fraction: number)
	fill.Size = UDim2.fromScale(Util.clamp(fraction, 0, 1), 1)
end

local function toast(text: string, color: Color3)
	local row = frame({
		Size = UDim2.fromOffset(320, 26),
		BackgroundColor3 = P.Base,
		BackgroundTransparency = 0.35,
		LayoutOrder = -os.clock() * 1000,
		Parent = toasts,
	})
	corner(row, UDim.new(0, 4))
	stroke(row, color)

	local textLabel = label({
		Position = UDim2.fromOffset(9, 0),
		Size = UDim2.fromOffset(300, 26),
		Font = LAYOUT.FontMedium,
		TextSize = LAYOUT.Body,
		TextColor3 = color,
		Text = text,
		Parent = row,
	})

	task.delay(3.2, function()
		local tween = TweenService:Create(row, TweenInfo.new(0.35), { BackgroundTransparency = 1 })
		tween:Play()
		local textTween = TweenService:Create(textLabel, TweenInfo.new(0.35), { TextTransparency = 1 })
		textTween:Play()
		task.wait(0.4)
		row:Destroy()
	end)
end

local function showBanner(text: string, sub: string, color: Color3, duration: number)
	bannerText.Text = text
	bannerText.TextColor3 = color
	bannerSub.Text = sub or ""
	banner.Visible = true
	bannerText.TextTransparency = 0
	bannerSub.TextTransparency = 0
	task.delay(duration, function()
		local tween = TweenService:Create(bannerText, TweenInfo.new(0.4), { TextTransparency = 1 })
		tween:Play()
		local subTween = TweenService:Create(bannerSub, TweenInfo.new(0.4), { TextTransparency = 1 })
		subTween:Play()
		task.wait(0.45)
		if bannerText.Text == text then
			banner.Visible = false
		end
	end)
end

local hitMarkerToken = 0
local function showHitMarker(kind: string)
	hitMarkerToken += 1
	local token = hitMarkerToken

	local color = P.White
	local scale = 1
	if kind == "headshot" then
		color = P.Amber
		scale = 1.35
	elseif kind == "kill" then
		color = P.Red
		scale = 1.6
	end

	for _, child in ipairs(hitMarker:GetChildren()) do
		if child:IsA("Frame") then
			child.BackgroundColor3 = color
		end
	end
	hitMarker.Size = UDim2.fromOffset(26 * scale, 26 * scale)
	hitMarker.Visible = true

	task.delay(kind == "kill" and 0.45 or 0.22, function()
		if hitMarkerToken == token then
			hitMarker.Visible = false
		end
	end)
end

local function addKillFeed(entry: any)
	feedOrder += 1

	local row = frame({
		Name = "FeedRow",
		Size = UDim2.fromOffset(340, 26),
		BackgroundColor3 = P.Base,
		BackgroundTransparency = 0.4,
		LayoutOrder = feedOrder,
		Parent = killFeed,
	})
	corner(row, UDim.new(0, 4))

	-- The killer's name is tinted with their team colour, the victim's with
	-- theirs, so a glance tells you who traded into whom.
	local killerColor = entry.killerTeam and Config.Teams[entry.killerTeam].Color or P.White
	local victimColor = entry.victimTeam and Config.Teams[entry.victimTeam].Color or P.White
	local weaponNameText = tostring(entry.weapon or "")

	local killerText = label({
		Position = UDim2.fromOffset(9, 0),
		Size = UDim2.fromOffset(150, 26),
		Font = LAYOUT.FontMedium,
		TextSize = LAYOUT.Body,
		TextColor3 = killerColor,
		Text = tostring(entry.killer or "?"),
		TextTruncate = Enum.TextTruncate.AtEnd,
		Parent = row,
	})

	local weaponText = label({
		Position = UDim2.fromOffset(160, 0),
		Size = UDim2.fromOffset(120, 26),
		Font = LAYOUT.FontMedium,
		TextSize = LAYOUT.Small,
		TextColor3 = P.Gray,
		TextXAlignment = Enum.TextXAlignment.Center,
		Text = weaponNameText,
		TextTruncate = Enum.TextTruncate.AtEnd,
		Parent = row,
	})

	local victimText = label({
		Position = UDim2.fromOffset(282, 0),
		Size = UDim2.fromOffset(52, 26),
		Font = LAYOUT.FontMedium,
		TextSize = LAYOUT.Body,
		TextColor3 = victimColor,
		TextXAlignment = Enum.TextXAlignment.Right,
		Text = tostring(entry.victim or "?"),
		TextTruncate = Enum.TextTruncate.AtEnd,
		Parent = row,
	})

	if entry.headshot then
		label({
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -6, 0, 0),
			Size = UDim2.fromOffset(18, 26),
			TextSize = LAYOUT.Small,
			TextColor3 = P.Amber,
			Text = "HS",
			Parent = row,
		})
	end

	task.delay(Config.Hud.KillFeedLife, function()
		local tween = TweenService:Create(row, TweenInfo.new(0.4), { BackgroundTransparency = 1 })
		tween:Play()
		for _, text in ipairs({ killerText, weaponText, victimText }) do
			local textTween = TweenService:Create(text, TweenInfo.new(0.4), { TextTransparency = 1 })
			textTween:Play()
		end
		task.wait(0.45)
		row:Destroy()
	end)
end

-- ---------------------------------------------------------------------------
-- Menu rendering
-- ---------------------------------------------------------------------------
local function clearMenu()
	for _, child in ipairs(menuBody:GetChildren()) do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
end

local function menuHeader(text: string, order: number)
	label({
		Size = UDim2.fromOffset(700, 24),
		TextSize = LAYOUT.Body,
		TextColor3 = P.Cyan,
		Text = text,
		LayoutOrder = order,
		Parent = menuBody,
	})
end

local function menuItem(item: any, order: number)
	local affordable = state.credits >= item.price
	local owned = false
	if item.kindValue == "weapon" then
		owned = state.weapon == item.weapon
	elseif item.id == "utility:stim" and state.hasStim then
		owned = true
	end

	local button = Instance.new("TextButton")
	button.Name = item.displayName
	button.Size = UDim2.fromOffset(700, 44)
	button.BackgroundColor3 = owned and Color3.fromRGB(20, 60, 45) or P.DarkGray
	button.BackgroundTransparency = affordable and 0.05 or 0.55
	button.AutoButtonColor = true
	button.Text = ""
	button.LayoutOrder = order
	button.ZIndex = 6
	button.Parent = menuBody
	corner(button, UDim.new(0, 5))

	label({
		Position = UDim2.fromOffset(12, 4),
		Size = UDim2.fromOffset(420, 20),
		TextSize = LAYOUT.Body,
		TextColor3 = affordable and P.White or P.Gray,
		Text = item.displayName .. (owned and "   (equipped)" or ""),
		ZIndex = 7,
		Parent = button,
	})

	label({
		Position = UDim2.fromOffset(12, 23),
		Size = UDim2.fromOffset(520, 18),
		Font = LAYOUT.FontMedium,
		TextSize = LAYOUT.Small,
		TextColor3 = P.Gray,
		Text = item.description or "",
		ZIndex = 7,
		Parent = button,
	})

	label({
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -14, 0, 12),
		Size = UDim2.fromOffset(120, 22),
		TextSize = LAYOUT.Body,
		TextXAlignment = Enum.TextXAlignment.Right,
		TextColor3 = affordable and P.Amber or P.Red,
		Text = string.format("%d", item.price),
		ZIndex = 7,
		Parent = button,
	})

	button.MouseButton1Click:Connect(function()
		Net.toServer("Buy", item.id)
	end)
end

local function renderShop()
	clearMenu()
	menuTitle.Text = "ARMORY"
	menuHint.Text = "B to close   |   H for heroes   |   click to buy"
	menuCredits.Text = string.format("%d credits", state.credits)

	local order = 0
	local categories = {
		{ key = "Pistol", label = "PISTOLS" },
		{ key = "SMG", label = "SMGS" },
		{ key = "Rifle", label = "RIFLES" },
		{ key = "Sniper", label = "SNIPERS" },
		{ key = "Shotgun", label = "HEAVY" },
	}

	for _, category in ipairs(categories) do
		local items = {}
		for _, item in ipairs(state.catalog) do
			if item.category == category.key then
				table.insert(items, item)
			end
		end
		if #items > 0 then
			order += 1
			menuHeader(category.label, order)
			for _, item in ipairs(items) do
				order += 1
				menuItem(item, order)
			end
		end
	end

	order += 1
	menuHeader("UTILITY", order)
	for _, item in ipairs(state.catalog) do
		if item.kindValue ~= "weapon" then
			order += 1
			menuItem(item, order)
		end
	end

	menuBody.CanvasSize = UDim2.fromOffset(0, order * 50 + 20)
end

local function renderHeroSelect()
	clearMenu()
	menuTitle.Text = "CHOOSE YOUR RIVAL"
	menuHint.Text = "B to close   |   click to pick a hero"
	menuCredits.Text = "Switching is free during the buy phase"

	local order = 0
	for _, hero in ipairs(Heroes.list) do
		order += 1
		local button = Instance.new("TextButton")
		button.Name = hero.name
		button.Size = UDim2.fromOffset(700, 66)
		button.BackgroundColor3 = state.hero == hero.name and Color3.fromRGB(24, 46, 66) or P.DarkGray
		button.BackgroundTransparency = 0.1
		button.Text = ""
		button.LayoutOrder = order
		button.ZIndex = 6
		button.Parent = menuBody
		corner(button, UDim.new(0, 5))
		stroke(button, hero.color)

		label({
			Position = UDim2.fromOffset(14, 5),
			Size = UDim2.fromOffset(400, 22),
			TextSize = LAYOUT.Body,
			TextColor3 = hero.color,
			Text = hero.displayName .. "   (" .. hero.role .. ")",
			ZIndex = 7,
			Parent = button,
		})
		label({
			Position = UDim2.fromOffset(14, 25),
			Size = UDim2.fromOffset(660, 18),
			Font = LAYOUT.FontMedium,
			TextSize = LAYOUT.Small,
			TextColor3 = P.Gray,
			Text = string.format("%d HP   |   %d speed   |   %s: %s", hero.health, hero.walkSpeed, hero.ultimate.displayName, hero.ultimate.description),
			ZIndex = 7,
			Parent = button,
		})
		label({
			Position = UDim2.fromOffset(14, 43),
			Size = UDim2.fromOffset(660, 18),
			Font = LAYOUT.FontMedium,
			TextSize = LAYOUT.Small,
			TextColor3 = Config.Palette.Violet,
			Text = string.format("Start: %s   |   %ds cooldown", (Weapons.get(hero.weapon) or { displayName = hero.weapon }).displayName, hero.ultimate.cooldown),
			ZIndex = 7,
			Parent = button,
		})

		button.MouseButton1Click:Connect(function()
			Net.toServer("SelectHero", hero.name)
		end)
	end

	menuBody.CanvasSize = UDim2.fromOffset(0, order * 74 + 20)
end

local function setMenu(open: boolean, mode: string?)
	if open then
		state.menuMode = mode or state.menuMode
		state.menuOpen = true
		menu.Visible = true
		Net.toServer("Refresh")
		if state.menuMode == "hero" then
			renderHeroSelect()
		else
			renderShop()
		end
	else
		state.menuOpen = false
		menu.Visible = false
	end
end

-- Re-render on purchase results so affordability updates live.
Net.event("BuyResult").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if payload.kind == "catalog" then
		state.catalog = payload.items or {}
		if payload.loadout then
			state.weapon = payload.loadout.weapon or state.weapon
			state.armor = payload.loadout.armor or 0
			state.maxArmor = payload.loadout.maxArmor or 0
			state.hasStim = payload.loadout.hasStim == true
		end
		if state.menuOpen and state.menuMode == "shop" then
			renderShop()
		end
	elseif payload.kind == "reject" then
		toast(tostring(payload.reason or "Purchase failed"), P.Red)
		Util.playSound(playerGui, Config.Audio.UiClick, 0.3)
	elseif payload.kind == "accept" then
		toast(tostring(payload.message or "Purchased"), P.Green)
		Util.playSound(playerGui, Config.Audio.UiBuy, 0.4)
		if state.menuOpen and state.menuMode == "shop" then
			renderShop()
		end
	elseif payload.kind == "hero" then
		state.hero = payload.hero or state.hero
		Move.setHero(state.hero)
		renderHeroSelect()
	end
end)

-- ---------------------------------------------------------------------------
-- Keybinds
-- ---------------------------------------------------------------------------
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.B then
		setMenu(not state.menuOpen, state.menuOpen and state.menuMode or "shop")
	elseif input.KeyCode == Enum.KeyCode.H then
		setMenu(not state.menuOpen or state.menuMode ~= "hero", "hero")
	elseif input.KeyCode == Enum.KeyCode.Escape and state.menuOpen then
		setMenu(false)
	elseif state.menuOpen then
		-- Any movement or fire key closes the menu: you should never be stuck in it.
		local movementKeys = {
			Enum.KeyCode.W,
			Enum.KeyCode.A,
			Enum.KeyCode.S,
			Enum.KeyCode.D,
			Enum.KeyCode.Space,
			Enum.KeyCode.LeftShift,
			Enum.KeyCode.LeftControl,
		}
		for _, key in ipairs(movementKeys) do
			if input.KeyCode == key then
				setMenu(false)
				return
			end
		end
	end
end)

-- ---------------------------------------------------------------------------
-- Server state
-- ---------------------------------------------------------------------------
Net.event("HudState").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if type(payload.credits) == "number" then
		state.credits = payload.credits
	elseif type(payload.ammo) == "number" then
		state.ammo = payload.ammo
		state.magSize = payload.magSize or state.magSize
		state.reloading = payload.reloading == true
	end
	if type(payload.armor) == "number" then
		state.armor = payload.armor
		state.maxArmor = payload.maxArmor or state.maxArmor
	end
	if type(payload.weapon) == "string" then
		state.weapon = payload.weapon
	end
	if type(payload.hero) == "string" then
		state.hero = payload.hero
	end
	if type(payload.hasStim) == "boolean" then
		state.hasStim = payload.hasStim
	end
	if type(payload.ultReady) == "boolean" then
		state.ultReady = payload.ultReady
	end
	if type(payload.ultCooldown) == "number" then
		state.ultCooldown = payload.ultCooldown
	end
	if state.menuOpen and state.menuMode == "shop" then
		renderShop()
	end
end)

--- Match.pushLoadout sends a flat table: weapon, hero, credits, armor, maxArmor,
--- hasStim, grenades, kills, deaths, assists, ultReady.
Net.event("Loadout").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if type(payload.weapon) == "string" then
		state.weapon = payload.weapon
	end
	if type(payload.hero) == "string" then
		state.hero = payload.hero
		Move.setHero(payload.hero)
	end
	if type(payload.credits) == "number" then
		state.credits = payload.credits
	end
	if type(payload.armor) == "number" then
		state.armor = payload.armor
	end
	if type(payload.maxArmor) == "number" then
		state.maxArmor = payload.maxArmor
	end
	if type(payload.hasStim) == "boolean" then
		state.hasStim = payload.hasStim
	end
	if type(payload.ultReady) == "boolean" then
		state.ultReady = payload.ultReady
	end

	local weapon = Weapons.get(state.weapon)
	if weapon then
		state.magSize = weapon.magSize
	end
end)

Net.event("RoundState").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	state.phase = payload.phase or state.phase

	local phaseNames = {
		Warmup = "WARMUP",
		Buy = string.format("BUY PHASE  |  ROUND %d", payload.round or 0),
		Action = string.format("ROUND %d", payload.round or 0),
		RoundEnd = "ROUND OVER",
		MatchEnd = "MATCH OVER",
	}
	roundLabel.Text = phaseNames[state.phase] or state.phase
	scoreLeft.Text = tostring((payload.scores and payload.scores[1]) or 0)
	scoreRight.Text = tostring((payload.scores and payload.scores[2]) or 0)

	if payload.phase == Config.Phase.Warmup or payload.phase == Config.Phase.Buy then
		deathScreen.Visible = state.alive == false
		-- Everyone is alive again during buy.
		if payload.phase == Config.Phase.Buy then
			deathScreen.Visible = false
			state.alive = true
		end
	end
	if payload.phase == Config.Phase.Buy and not state.menuOpen then
		setMenu(true, "shop")
	end
	if payload.phase == Config.Phase.Action and state.menuOpen then
		setMenu(false)
	end
end)

Net.event("Banner").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	showBanner(tostring(payload.text or ""), tostring(payload.subtext or ""), payload.color or P.White, tonumber(payload.duration) or Config.Hud.BannerTime)
end)

Net.event("Notify").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	toast(tostring(payload.text or ""), payload.color or P.White)
end)

Net.event("KillFeed").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	addKillFeed(payload)
end)

Net.event("HitConfirm").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	if payload.kind == "hit" or payload.kind == "headshot" or payload.kind == "kill" then
		showHitMarker(payload.kind)
		if payload.kind == "kill" then
			Util.playSound(playerGui, Config.Audio.Kill, 0.35)
		elseif payload.kind == "headshot" then
			Util.playSound(playerGui, Config.Audio.Headshot, 0.3)
		else
			Util.playSound(playerGui, Config.Audio.Hitmarker, 0.25)
		end
	end
end)

Net.event("DamageTaken").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	local amount = tonumber(payload.amount) or 0
	local strength = Util.clamp(amount / 60, 0.18, 1) * LAYOUT.VignetteMax
	vignette.BackgroundTransparency = 1 - strength
	local tween = TweenService:Create(vignette, TweenInfo.new(0.5, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		BackgroundTransparency = 1,
	})
	tween:Play()
end)

Net.event("AbilityFeedback").OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then
		return
	end
	local color = payload.kind == "fail" and P.Red or (payload.kind == "cooldown" and P.Gray or P.Violet)
	toast(tostring(payload.text or ""), color)
end)

-- ---------------------------------------------------------------------------
-- Local per-frame HUD updates
-- ---------------------------------------------------------------------------
local function localCharacter(): (Model?, Humanoid?)
	local character = player.Character
	if not character then
		return nil, nil
	end
	return character, character:FindFirstChildOfClass("Humanoid")
end

-- The clock is pushed by the server a few times a second; it is ticked down
-- locally in between so the display is smooth rather than stepping.
local lastStatePush = 0
local lastTimeLeft = 0

Net.event("RoundState").OnClientEvent:Connect(function(payload)
	if type(payload) == "table" and type(payload.timeLeft) == "number" then
		lastTimeLeft = payload.timeLeft
		lastStatePush = os.clock()
		if type(payload.alive) == "table" then
			aliveLabel.Text = string.format("%d alive   vs   %d alive", payload.alive[1] or 0, payload.alive[2] or 0)
		end
	end
end)

RunService.RenderStepped:Connect(function()
	-- Vitals, read live from the character so damage shows immediately rather
	-- than waiting for the next server push.
	local character, humanoid = localCharacter()
	if humanoid then
		local wasAlive = state.alive
		state.health = humanoid.Health
		state.maxHealth = humanoid.MaxHealth
		state.alive = humanoid.Health > 0
		if state.alive ~= wasAlive then
			deathScreen.Visible = not state.alive
		end
	end

	local hero = Heroes.get(state.hero)
	local healthFraction = state.health / math.max(1, state.maxHealth)
	heroLabel.Text = string.format("%s  |  %d HP", hero.displayName, hero.health)
	setBar(healthFill, healthFraction)
	healthText.Text = string.format("%d", math.max(0, math.floor(state.health)))
	healthFill.BackgroundColor3 = if healthFraction < Config.Hud.LowHealthThreshold then P.Red else P.Green

	setBar(armorFill, state.maxArmor > 0 and state.armor / state.maxArmor or 0)
	armorText.Text = state.maxArmor > 0 and string.format("%d", math.floor(state.armor)) or ""

	-- Stamina comes straight from the movement controller.
	staminaValue = Move.state.stamina
	setBar(staminaFill, staminaValue / Config.Movement.Stamina.Max)

	-- Weapon and ammo. The Tool's Ammo attribute is server-authored and
	-- replicates instantly, so it is the right source for the live readout.
	local weapon = Weapons.get(state.weapon)
	local tool = character and character:FindFirstChildOfClass("Tool")
	if tool then
		local name = tool:GetAttribute("Weapon")
		if type(name) == "string" then
			weapon = Weapons.get(name) or weapon
			if weapon then
				state.weapon = name
			end
		end
		local ammoAttr = tool:GetAttribute("Ammo")
		if type(ammoAttr) == "number" then
			state.ammo = ammoAttr
		end
		state.reloading = tool:GetAttribute("Reloading") == true
	elseif weapon then
		state.magSize = weapon.magSize
	end

	weaponName.Text = weapon and weapon.displayName or state.weapon
	if weapon then
		state.magSize = weapon.magSize
	end
	if weapon and Weapons.isMelee(weapon) then
		ammoLabel.Text = "--"
		ammoLabel.TextColor3 = P.White
	elseif state.reloading then
		ammoLabel.Text = "RELOADING"
		ammoLabel.TextColor3 = P.Amber
	else
		ammoLabel.Text = string.format("%d / %d", state.ammo, state.magSize)
		ammoLabel.TextColor3 = if state.ammo <= math.max(1, math.floor(state.magSize * 0.25)) then P.Red else P.White
	end

	-- Ultimate readout.
	local ult = hero.ultimate
	if state.ultReady then
		ultimateLabel.Text = string.format("Q  %s  READY", ult.displayName)
		ultimateLabel.TextColor3 = P.Green
	else
		ultimateLabel.Text = string.format("Q  %s  %ds", ult.displayName, math.ceil(state.ultCooldown))
		ultimateLabel.TextColor3 = P.Gray
	end

	-- Round clock.
	if lastStatePush > 0 then
		local remaining = math.max(0, lastTimeLeft - (os.clock() - lastStatePush))
		timerLabel.Text = Util.formatClock(remaining)
		timerLabel.TextColor3 = remaining <= 10 and P.Red or P.White
	end
end)

return gui
