--[[
	Heroes.luau
	The four Rivals. Pure data plus helpers -- nothing here creates Instances, so
	the shop UI, the HUD and the server all read the same numbers.

	Each hero has exactly one ultimate. Ultimate `kind` maps to an implementation
	in src/server/HeroServer.luau (and mirrored FX in src/client/FxClient.luau).

	See DESIGN.md section 4.
]]

local Config = require(script.Parent.Config)
local Weapons = require(script.Parent.Weapons)
local Util = require(script.Parent.Util)

local Heroes = {}

export type UltimateKind = "blitzDash" | "bulwark" | "railgun" | "rallyStation"

export type Ultimate = {
	kind: UltimateKind,
	displayName: string,
	description: string,
	cooldown: number,
	duration: number,
	-- blitzDash
	distance: number?,
	invulnerable: number?,
	reloadOnUse: boolean?,
	-- bulwark / rallyStation
	radius: number?,
	blocksBullets: boolean?,
	healPerSecond: number?,
	speedMultiplier: number?,
	-- railgun
	pierce: boolean?,
	revealDuration: number?,
	damage: number?,
}

export type Hero = {
	name: string,
	displayName: string,
	tagline: string,
	role: string,
	health: number,
	walkSpeed: number,
	weapon: string, -- starting weapon, keyed into Weapons.byName
	ultimate: Ultimate,
	color: Color3,
	passive: string,
}

local list: { Hero } = {
	{
		name = "rusher",
		displayName = "The Rusher",
		tagline = "Reload is for people who stopped moving.",
		role = "Entry fragger",
		health = 100,
		walkSpeed = 20,
		weapon = "dualsmg",
		color = Config.Palette.Cyan,
		passive = "Fastest hero in the game, and the only one who reloads mid-dash.",
		ultimate = {
			kind = "blitzDash",
			displayName = "Blitz Dash",
			description = "Dash 55 studs, invulnerable in transit, magazine refilled at both ends.",
			cooldown = 22,
			duration = 0.35,
			distance = 55,
			invulnerable = 0.35,
			reloadOnUse = true,
		},
	},
	{
		name = "tank",
		displayName = "The Tank",
		tagline = "Shoot me. I'll wait.",
		role = "Space taker",
		health = 175,
		walkSpeed = 13,
		weapon = "heavyshotgun",
		color = Config.Palette.Amber,
		passive = "Trades all mobility for the best effective health in the game.",
		ultimate = {
			kind = "bulwark",
			displayName = "Bulwark",
			description = "Deploy a 14-stud dome for 5s. Enemy bullets crossing it are destroyed.",
			cooldown = 30,
			duration = 5,
			radius = 14,
			blocksBullets = true,
		},
	},
	{
		name = "sniper",
		displayName = "The Sniper",
		tagline = "One shot. Then reposition.",
		role = "Information and picks",
		health = 110,
		walkSpeed = 16,
		weapon = "boltrifle",
		color = Config.Palette.Magenta,
		passive = "Holds the longest sightline on Neon Heights, and knows it.",
		ultimate = {
			kind = "railgun",
			displayName = "Railgun",
			description = "One shot that pierces walls and bodies, and reveals every enemy for 4s.",
			cooldown = 34,
			duration = 0.2,
			damage = 120,
			pierce = true,
			revealDuration = 4,
		},
	},
	{
		name = "support",
		displayName = "The Support",
		tagline = "You're welcome. Just don't die.",
		role = "Anchor",
		health = 120,
		walkSpeed = 16,
		weapon = "burstrifle",
		color = Config.Palette.Green,
		passive = "The only hero who can win a fight they already lost.",
		ultimate = {
			kind = "rallyStation",
			displayName = "Rally Station",
			description = "Deploy a station for 12s: +12 HP/s and +15% speed to allies inside 16 studs.",
			cooldown = 26,
			duration = 12,
			radius = 16,
			healPerSecond = 12,
			speedMultiplier = 1.15,
		},
	},
}

local byName: { [string]: Hero } = {}
for _, hero in ipairs(list) do
	byName[hero.name] = hero
end

Heroes.list = list
Heroes.byName = byName
Heroes.default = "rusher"

function Heroes.get(name: string?): Hero
	if name then
		local found = byName[name]
		if found then
			return found
		end
	end
	return byName[Heroes.default]
end

function Heroes.exists(name: string): boolean
	return byName[name] ~= nil
end

--- Ordered list of hero names, for menu rendering.
function Heroes.names(): { string }
	local names: { string } = {}
	for _, hero in ipairs(list) do
		table.insert(names, hero.name)
	end
	return names
end

--- True once `lastUsed` (a clock timestamp) is old enough for another ultimate.
function Heroes.isReady(hero: Hero, lastUsed: number, now: number): boolean
	return (now - lastUsed) >= hero.ultimate.cooldown
end

function Heroes.cooldownRemaining(hero: Hero, lastUsed: number, now: number): number
	return math.max(0, hero.ultimate.cooldown - (now - lastUsed))
end

--- The hero's starting weapon object.
function Heroes.weapon(hero: Hero)
	return Weapons.get(hero.weapon)
end

--- Slowest to fastest; used by the hero select screen.
function Heroes.bySpeed(): { Hero }
	local sorted = table.clone(list)
	table.sort(sorted, function(a, b)
		return a.walkSpeed > b.walkSpeed
	end)
	return sorted
end

-- Fail loudly at load time rather than mid-match if a hero points at a weapon
-- that does not exist.
for _, hero in ipairs(list) do
	if not Weapons.get(hero.weapon) then
		error(string.format("[RIVALS] Hero %q references unknown weapon %q", hero.name, hero.weapon))
	end
	if hero.ultimate.cooldown <= 0 then
		error(string.format("[RIVALS] Hero %q has a non-positive ultimate cooldown", hero.name))
	end
end

--- Effective movement speed including a hero multiplier and the sprint flag.
function Heroes.walkSpeed(hero: Hero, sprinting: boolean): number
	local base = hero.walkSpeed
	if sprinting then
		base *= Config.Movement.SprintMultiplier
	end
	return Util.clamp(base, 4, 40)
end

return Heroes
