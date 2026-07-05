// The in-repo first-party pack registry: the curated catalog of packs that ship in this workspace under
// `packages/packs/<name>`. This is the list the TUI character catalog offers; it is distinct from the
// install-time package-name gate in `allowlist.ts`. batman is the one runtime-dependency carve-out and is not
// installed through the catalog path. A parity test keeps this list in lockstep with the on-disk pack dirs.

export const FIRST_PARTY_PACKS = [
	"barbie",
	"batman",
	"harry-potter",
	"hello-kitty",
	"spiderman",
	"james-bond",
	"deadpool",
] as const;

// The bundled default character: a runtime dependency of the engine, so it is always installed and never offered
// through the catalog install path. Every other pack (first-party or third-party) is catalog-installable.
export const BUNDLED_PACK = "batman";
