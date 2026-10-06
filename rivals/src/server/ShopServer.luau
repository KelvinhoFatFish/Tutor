--[[
	ShopServer.luau
	The between-round arsenal. All purchases are validated here: the client sends
	a purchase id, never a price.

	Rules (DESIGN.md section 6):
	  * Buying is only legal during the buy phase.
	  * One weapon per category -- buying a new rifle replaces the old one.
	  * Armor and grenades may be topped up repeatedly.
	  * Every loadout is wiped at the start of a round, so nothing carries over.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Heroes = require(Shared.Heroes)
local Net = require(Shared.Net)
local Weapons = require(Shared.Weapons)

local Match = require(script.Parent.Match)

local ShopServer = {}

local Phase = Config.Phase

-- ---------------------------------------------------------------------------
-- Utility catalogue (weapons come from Weapons.purchasable)
-- ---------------------------------------------------------------------------
local UTILITY = {
	{
		id = "armor_light",
		displayName = "Light Armor",
		description = "+50 shield, regenerates after 8s without damage.",
		price = 500,
		kind = "armor",
		amount = 50,
	},
	{
		id = "armor_heavy",
		displayName = "Heavy Armor",
		description = "+100 shield, regenerates after 8s without damage.",
		price = 1100,
		kind = "armor",
		amount = 100,
	},
	{
		id = "he",
		displayName = "HE Grenade",
		description = "90 damage in a 12-stud radius, 2s fuse.",
		price = 300,
		kind = "grenade",
		grenade = "he",
	},
	{
		id = "flash",
		displayName = "Flash Grenade",
		description = "2.2s whiteout within 25 studs, line of sight only.",
		price = 250,
		kind = "grenade",
		grenade = "flash",
	},
	{
		id = "stim",
		displayName = "Med Stim",
		description = "Instant +60 health. Single use.",
		price = 350,
		kind = "stim",
	},
}

local utilityById: { [string]: any } = {}
for _, item in ipairs(UTILITY) do
	utilityById[item.id] = item
end

ShopServer.Utility = UTILITY

-- ---------------------------------------------------------------------------
-- Loadout helpers
-- ---------------------------------------------------------------------------
local function defaultLoadout()
	return {
		weapon = "sidearm",
		armor = 0,
		maxArmor = 0,
		hasStim = false,
		grenades = { he = 0, flash = 0 },
	}
end

--- Which slot a weapon occupies. Rifles/SMGs/pistols/snipers each hold one slot;
--- the shotgun competes with snipers as the "heavy" pick.
local function categoryFor(weapon: Weapons.Weapon): string
	if weapon.category == "Shotgun" or weapon.category == "Sniper" then
		return "heavy"
	end
	return weapon.category
end

--- The complete buy menu, sent to the client once.
function ShopServer.catalog()
	local items = {}
	for _, weapon in ipairs(Weapons.purchasable()) do
		table.insert(items, {
			id = "weapon:" .. weapon.name,
			kindValue = "weapon",
			weapon = weapon.name,
			displayName = weapon.displayName,
			category = weapon.category,
			slot = categoryFor(weapon),
			description = string.format(
				"%d dmg  |  %.2fs  |  %d mag  |  %s",
				weapon.damage,
				weapon.fireRate,
				weapon.magSize,
				weapon.auto and "auto" or (weapon.burstSize > 1 and (weapon.burstSize .. "-burst") or "semi")
			),
			price = weapon.price,
		})
	end
	for _, item in ipairs(UTILITY) do
		table.insert(items, {
			id = "utility:" .. item.id,
			kindValue = item.kind,
			displayName = item.displayName,
			description = item.description,
			price = item.price,
		})
	end
	return items
end

local function pushCatalog(player: Player)
	Net.toPlayer("BuyResult", player, {
		kind = "catalog",
		items = ShopServer.catalog(),
		loadout = Match.getPlayerState(player) and {
			weapon = Match.getPlayerState(player).weapon,
			armor = Match.getPlayerState(player).armor,
			maxArmor = Match.getPlayerState(player).maxArmor,
			hasStim = Match.getPlayerState(player).hasStim,
			grenades = Match.getPlayerState(player).grenades,
		} or defaultLoadout(),
	})
end

local function reject(player: Player, reason: string)
	Net.toPlayer("BuyResult", player, {
		kind = "reject",
		reason = reason,
	})
	Net.toPlayer("Notify", player, {
		text = reason,
		color = Config.Palette.Red,
	})
end

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
local function buyWeapon(player: Player, state: any, weapon: Weapons.Weapon)
	if state.weapon == weapon.name then
		reject(player, "Already equipped")
		return
	end

	-- Buying within the same slot replaces the old weapon; there is no refund,
	-- which is what keeps the economy a real decision.
	if state.credits < weapon.price then
		reject(player, string.format("Need %d more credits", weapon.price - state.credits))
		return
	end

	Match.spendCredits(player, weapon.price)
	state.weapon = weapon.name
	state.weaponDisplay = weapon.displayName
	Match.setLoadout(player, state)

	Net.toPlayer("BuyResult", player, {
		kind = "accept",
		id = "weapon:" .. weapon.name,
		message = weapon.displayName .. " equipped",
	})
end

local function buyUtility(player: Player, state: any, item: any)
	if state.credits < item.price then
		reject(player, string.format("Need %d more credits", item.price - state.credits))
		return
	end

	if item.kind == "armor" then
		local newMax = math.max(state.maxArmor, item.amount)
		-- Do not charge for an armor tier you already own or beat.
		if state.maxArmor >= item.amount then
			reject(player, "You already have better armor")
			return
		end
		Match.spendCredits(player, item.price)
		state.maxArmor = newMax
		state.armor = newMax
	elseif item.kind == "grenade" then
		local held = state.grenades[item.grenade] or 0
		if held >= 2 then
			reject(player, "Max 2 of that grenade")
			return
		end
		Match.spendCredits(player, item.price)
		state.grenades[item.grenade] = held + 1
	elseif item.kind == "stim" then
		if state.hasStim then
			reject(player, "Stim already carried")
			return
		end
		Match.spendCredits(player, item.price)
		state.hasStim = true
	else
		reject(player, "Unknown item")
		return
	end

	Match.setLoadout(player, state)
	Net.toPlayer("BuyResult", player, {
		kind = "accept",
		id = "utility:" .. item.id,
		message = item.displayName .. " purchased",
	})
end

local function onBuy(player: Player, purchaseId: any)
	if type(purchaseId) ~= "string" then
		return
	end

	local state = Match.getPlayerState(player)
	if not state then
		return
	end

	-- Buy phase only. Warmup is free practice, so allow it there too.
	local phase = Match.state.phase
	if phase ~= Phase.Buy and phase ~= Phase.Warmup then
		reject(player, "Wait for the buy phase")
		return
	end

	local kind, key = string.match(purchaseId, "^(%w+):(.+)$")
	if not kind or not key then
		reject(player, "Unknown item")
		return
	end

	if kind == "weapon" then
		local weapon = Weapons.get(key)
		if not weapon or weapon.price <= 0 then
			reject(player, "Unknown weapon")
			return
		end
		buyWeapon(player, state, weapon)
	elseif kind == "utility" then
		local item = utilityById[key]
		if not item then
			reject(player, "Unknown item")
			return
		end
		buyUtility(player, state, item)
	else
		reject(player, "Unknown item")
	end
end

-- ---------------------------------------------------------------------------
-- Hero selection
-- ---------------------------------------------------------------------------
local function onSelectHero(player: Player, heroName: any)
	if type(heroName) ~= "string" then
		return
	end
	local phase = Match.state.phase
	if phase ~= Phase.Buy and phase ~= Phase.Warmup then
		reject(player, "Hero changes are buy-phase only")
		return
	end
	if not Heroes.exists(heroName) then
		reject(player, "Unknown hero")
		return
	end
	Match.equipHero(player, heroName)
	local state = Match.getPlayerState(player)
	if state then
		Net.toPlayer("BuyResult", player, {
			kind = "hero",
			hero = heroName,
			message = "Hero selected",
		})
		Match.pushHud(state)
	end
end

-- ---------------------------------------------------------------------------
-- Init
-- ---------------------------------------------------------------------------
function ShopServer.trackPlayer(player: Player)
	-- Send the catalogue shortly after join, once the client's remotes are live.
	task.delay(2, function()
		if player.Parent then
			pushCatalog(player)
		end
	end)
end

function ShopServer.init()
	Net.event("Buy").OnServerEvent:Connect(function(player, purchaseId)
		local ok, err = pcall(onBuy, player, purchaseId)
		if not ok then
			warn("[RIVALS] Buy handler error: " .. tostring(err))
		end
	end)

	Net.event("SelectHero").OnServerEvent:Connect(function(player, heroName)
		local ok, err = pcall(onSelectHero, player, heroName)
		if not ok then
			warn("[RIVALS] SelectHero error: " .. tostring(err))
		end
	end)

	-- Clients ask for the catalogue when they open the shop menu.
	Net.event("Refresh").OnServerEvent:Connect(function(player)
		pushCatalog(player)
		local state = Match.getPlayerState(player)
		if state then
			Match.pushHud(state)
		end
	end)

	Players.PlayerAdded:Connect(function(player)
		ShopServer.trackPlayer(player)
	end)
	for _, player in ipairs(Players:GetPlayers()) do
		ShopServer.trackPlayer(player)
	end

	-- Push the catalogue again at the start of every buy phase.
	task.spawn(function()
		local lastPhase = Match.state.phase
		while true do
			task.wait(0.5)
			local phase = Match.state.phase
			if phase ~= lastPhase then
				if phase == Phase.Buy then
					for _, player in ipairs(Players:GetPlayers()) do
						pushCatalog(player)
					end
				end
				lastPhase = phase
			end
		end
	end)
end

return ShopServer
