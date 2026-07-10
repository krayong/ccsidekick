// Generate the browser pack-loader module. It statically imports every pack in `PACKS` (so the bundler inlines
// each `pack.json`) and wires the map into the `makeLoadPack` factory from `web/pack-load.ts`. Deriving the
// import list from `PACKS` is what makes a new pack auto-wire into the web live-preview: adding it to the
// registry (which a parity test keeps in lockstep with the on-disk pack dirs) is the only step.

/** Source of the module that the web build substitutes for `packs/load`, covering every pack in `packs`. */
export function packLoadSource(packs: readonly string[], factoryModulePath: string): string {
	const imports = packs.map(
		(name, i) =>
			`import _${String(i)} from ${JSON.stringify(`@ccsidekick/pack-${name}/pack.json`)};`,
	);
	const entries = packs.map((name, i) => `\t${JSON.stringify(name)}: _${String(i)},`);
	return [
		...imports,
		`import { makeLoadPack } from ${JSON.stringify(factoryModulePath)};`,
		`export const loadPack = makeLoadPack({`,
		...entries,
		`});`,
		``,
	].join("\n");
}
