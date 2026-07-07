// Pack package-name helpers for the loader. A pack name maps to the scoped package `@ccsidekick/pack-<name>`,
// and `<name>` is a safe segment only when it matches `^[a-z0-9-]+$` (non-empty, no path separators). The loader
// (`load.ts`) validates the segment before it reaches `import.meta.resolve`, because a prefix-only check would
// pass `@ccsidekick/pack-../../evil` and feed a path traversal straight through resolve.

const PREFIX = "@ccsidekick/pack-";
const NAME_SEGMENT = /^[a-z0-9-]+$/;

export const packPackageName = (name: string): string => `${PREFIX}${name}`;

export function isAllowedPackPackage(pkg: string): boolean {
	if (!pkg.startsWith(PREFIX)) return false;
	return NAME_SEGMENT.test(pkg.slice(PREFIX.length));
}
