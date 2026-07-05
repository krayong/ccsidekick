// The official first-party source allowlist for pack installs. A pack package is installable only when its npm
// name is `@ccsidekick/pack-<name>` AND the `<name>` segment matches `^[a-z0-9-]+$` (non-empty, no path
// separators). The `<name>` segment is validated — not just the `@ccsidekick/pack-` prefix — because both
// `npm install` and `import.meta.resolve` consume it: a prefix-only check would pass
// `@ccsidekick/pack-../../evil` and feed a path traversal straight through resolve. The first-party TUI catalog
// installs through this gate with `--ignore-scripts`; there is no third-party or auto-install path.

const PREFIX = "@ccsidekick/pack-";
const NAME_SEGMENT = /^[a-z0-9-]+$/;

export const packPackageName = (name: string): string => `${PREFIX}${name}`;

export function isAllowedPackPackage(pkg: string): boolean {
	if (!pkg.startsWith(PREFIX)) return false;
	return NAME_SEGMENT.test(pkg.slice(PREFIX.length));
}
