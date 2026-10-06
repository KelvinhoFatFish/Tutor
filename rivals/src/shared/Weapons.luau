--[[
	Weapons.luau
	The arsenal. Pure data plus a few arithmetic helpers -- no Instance creation, so
	this module is safe to read from either side of the network.

	Damage model: baseDamage is applied at or inside `rangeMin`, then falls off
	linearly to `falloffFloor` (from Config.Combat) at `rangeMax`.

	Automatic fire: bulletCount > 1 with burstSize == 1 means one trigger pull
	sprays `bulletCount` projectiles (shotguns). burstSize > 1 means a burst weapon.

	See DESIGN.md section 6 for the shop table this mirrors.
]]

local Config = require(script.Parent.Config)
local Util = require(script.Parent.Util)

local Weapons = {}

export type WeaponCategory = "Pistol" | "SMG" | "Rifle" | "Sniper" | "Shotgun" | "Melee"

export type Weapon = {
	name: string,
	displayName: string,
	category: WeaponCategory,
	damage: number,
	fireRate: number, -- seconds between shots (or between bursts)
	rangeMin: number,
	rangeMax: number,
	magSize: number,
	reloadTime: number,
	spread: number, -- degrees of cone at rest
	spreadMoving: number, -- degrees while moving/jumping
	recoil: number, -- degrees of upward kick per shot
	auto: boolean,
	bulletCount: number, -- projectiles per trigger pull
	burstSize: number, -- shots per burst (1 = not a burst weapon)
	burstDelay: number, -- seconds between shots inside a burst
	headshotMultiplier: number,
	adsFov: number, -- camera FOV while aiming
	price: number,
	sound: string,
	-- visual recipe, consumed by WeaponServer.buildModel
	visual: {
		length: number,
		width: number,
		color: Color3,
		material: Enum.Material,
		barrel: number,
		stock: boolean,
		scope: boolean,
		drum: boolean,
		muzzleScale: number,
	},
}

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
local function skin(color: Color3, material: Enum.Material, props: { [string]: any }): { [string]: any }
	local visual = {
		length = 2,
		width = 0.28,
		color = color,
		material = material,
		barrel = 0,
		stock = false,
		scope = false,
		drum = false,
		muzzleScale = 1,
	}
	for key, value in pairs(props) do
		visual[key] = value
	end
	return visual
end

local NEON = Enum.Material.Neon
local METAL = Enum.Material.Metal
local SMOOTH = Enum.Material.SmoothPlastic

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
local list: { Weapon } = {
	-- ===================== Pistols =====================
	{
		name = "sidearm",
		displayName = "Sidearm",
		category = "Pistol",
		damage = 24,
		fireRate = 0.18,
		rangeMin = 22,
		rangeMax = 120,
		magSize = 12,
		reloadTime = 1.3,
		spread = 0.5,
		spreadMoving = 1.6,
		recoil = 0.5,
		auto = false,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplierLight,
		adsFov = 62,
		price = 500,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Gray, SMOOTH, {
			length = 1.5,
			width = 0.24,
			barrel = 0.35,
		}),
	},
	{
		name = "handcannon",
		displayName = "Hand Cannon",
		category = "Pistol",
		damage = 52,
		fireRate = 0.42,
		rangeMin = 26,
		rangeMax = 140,
		magSize = 6,
		reloadTime = 1.8,
		spread = 0.7,
		spreadMoving = 2.2,
		recoil = 1.6,
		auto = false,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplierLight,
		adsFov = 55,
		price = 900,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Amber, METAL, {
			length = 1.9,
			width = 0.28,
			barrel = 0.5,
			drum = true,
		}),
	},

	-- ===================== SMGs =====================
	{
		name = "compact",
		displayName = "Compact SMG",
		category = "SMG",
		damage = 13,
		fireRate = 0.075,
		rangeMin = 16,
		rangeMax = 95,
		magSize = 30,
		reloadTime = 1.7,
		spread = 1.1,
		spreadMoving = 2.6,
		recoil = 0.35,
		auto = true,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplierLight,
		adsFov = 62,
		price = 1200,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Cyan, SMOOTH, {
			length = 1.8,
			width = 0.26,
			barrel = 0.6,
			stock = true,
		}),
	},
	{
		name = "dualsmg",
		displayName = "Dual SMGs",
		category = "SMG",
		damage = 9,
		fireRate = 0.077,
		rangeMin = 18,
		rangeMax = 95,
		magSize = 28,
		reloadTime = 1.6,
		spread = 1.4,
		spreadMoving = 3.0,
		recoil = 0.3,
		auto = true,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplierLight,
		adsFov = 66,
		price = 1900,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Cyan, NEON, {
			length = 1.4,
			width = 0.22,
			barrel = 0.4,
		}),
	},

	-- ===================== Rifles =====================
	{
		name = "burstrifle",
		displayName = "Burst Rifle",
		category = "Rifle",
		damage = 16,
		fireRate = 0.34,
		rangeMin = 45,
		rangeMax = 190,
		magSize = 30,
		reloadTime = 2.4,
		spread = 0.55,
		spreadMoving = 1.8,
		recoil = 0.7,
		auto = false,
		bulletCount = 1,
		burstSize = 3,
		burstDelay = 0.11,
		headshotMultiplier = Config.Combat.HeadshotMultiplier,
		adsFov = 52,
		price = 1600,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Green, SMOOTH, {
			length = 2.4,
			width = 0.28,
			barrel = 0.9,
			stock = true,
			scope = true,
		}),
	},
	{
		name = "assaultrifle",
		displayName = "Assault Rifle",
		category = "Rifle",
		damage = 20,
		fireRate = 0.1,
		rangeMin = 40,
		rangeMax = 190,
		magSize = 30,
		reloadTime = 2.2,
		spread = 0.75,
		spreadMoving = 2.2,
		recoil = 0.62,
		auto = true,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplier,
		adsFov = 50,
		price = 2400,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Violet, SMOOTH, {
			length = 2.6,
			width = 0.3,
			barrel = 1.0,
			stock = true,
			scope = true,
		}),
	},

	-- ===================== Snipers & Heavy =====================
	{
		name = "boltrifle",
		displayName = "Bolt Rifle",
		category = "Sniper",
		damage = 85,
		fireRate = 0.95,
		rangeMin = 300,
		rangeMax = 600,
		magSize = 5,
		reloadTime = 3.2,
		spread = 0.06,
		spreadMoving = 3.4,
		recoil = 3.2,
		auto = false,
		bulletCount = 1,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplier,
		adsFov = 22,
		price = 3200,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Magenta, METAL, {
			length = 3.2,
			width = 0.26,
			barrel = 1.5,
			stock = true,
			scope = true,
			muzzleScale = 1.4,
		}),
	},
	{
		name = "heavyshotgun",
		displayName = "Heavy Shotgun",
		category = "Shotgun",
		damage = 11,
		fireRate = 0.85,
		rangeMin = 8,
		rangeMax = 15,
		magSize = 6,
		reloadTime = 3.0,
		spread = 4.2,
		spreadMoving = 5.0,
		recoil = 4.0,
		auto = false,
		bulletCount = 8,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = Config.Combat.HeadshotMultiplierLight,
		adsFov = 68,
		price = 2100,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.Amber, SMOOTH, {
			length = 2.5,
			width = 0.34,
			barrel = 0.8,
			stock = true,
			drum = true,
			muzzleScale = 1.6,
		}),
	},

	-- ===================== Melee =====================
	{
		name = "melee",
		displayName = "Combat Knife",
		category = "Melee",
		damage = 55,
		fireRate = 0.55,
		rangeMin = 8,
		rangeMax = 8,
		magSize = 0,
		reloadTime = 0,
		spread = 0,
		spreadMoving = 0,
		recoil = 0,
		auto = false,
		bulletCount = 0,
		burstSize = 1,
		burstDelay = 0,
		headshotMultiplier = 1,
		adsFov = 70,
		price = 0,
		sound = "rbxassetid://9114221324",
		visual = skin(Config.Palette.White, METAL, {
			length = 1.2,
			width = 0.12,
			barrel = 0.6,
		}),
	},
}

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------
local byName: { [string]: Weapon } = {}
for _, weapon in ipairs(list) do
	byName[weapon.name] = weapon
end

Weapons.list = list
Weapons.byName = byName

function Weapons.get(name: string): Weapon?
	return byName[name]
end

--- All weapons in a category, in table order.
function Weapons.byCategory(category: WeaponCategory): { Weapon }
	local out: { Weapon } = {}
	for _, weapon in ipairs(list) do
		if weapon.category == category then
			table.insert(out, weapon)
		end
	end
	return out
end

--- Everything the shop can sell, cheapest first.
function Weapons.purchasable(): { Weapon }
	local out: { Weapon } = {}
	for _, weapon in ipairs(list) do
		if weapon.price > 0 then
			table.insert(out, weapon)
		end
	end
	table.sort(out, function(a, b)
		return a.price < b.price
	end)
	return out
end

--- Headshot multiplier for a specific weapon.
function Weapons.headshotMultiplier(weapon: Weapon): number
	return weapon.headshotMultiplier or Config.Combat.HeadshotMultiplier
end

--- Seconds of sustained fire before a reload is required, used by the bot brain
--- and the HUD's "time to empty" readout.
function Weapons.timeToEmpty(weapon: Weapon): number
	if weapon.magSize <= 0 then
		return math.huge
	end
	if weapon.burstSize > 1 then
		local bursts = weapon.magSize / weapon.burstSize
		return bursts * weapon.fireRate
	end
	return weapon.magSize * weapon.fireRate
end

--- True if this weapon needs no ammo tracking (melee).
function Weapons.isMelee(weapon: Weapon): boolean
	return weapon.category == "Melee"
end

return Weapons
