// The pack registry: the characters that ship with the engine under `packages/packs/<name>`. Every pack is a
// bundled runtime dependency of the engine (data only, no install step), so a fresh install always has all of
// them. A parity test keeps this list in lockstep with the on-disk pack dirs and the engine's runtime deps.

export const PACKS = [
	"barbie",
	"batman",
	"ben10",
	"darth-vader",
	"deadpool",
	"gandalf",
	"harry-potter",
	"hello-kitty",
	"iron-man",
	"james-bond",
	"joker",
	"naruto",
	"pikachu",
	"sherlock-holmes",
	"shinchan",
	"spiderman",
	"superman",
	"yoda",
] as const;
