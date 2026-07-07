// The pack registry: the characters that ship with the engine under `packages/packs/<name>`. Every pack is a
// bundled runtime dependency of the engine (data only, no install step), so a fresh install always has all of
// them. A parity test keeps this list in lockstep with the on-disk pack dirs and the engine's runtime deps.

export const PACKS = [
	"barbie",
	"batman",
	"harry-potter",
	"hello-kitty",
	"spiderman",
	"james-bond",
	"deadpool",
] as const;
