// Browser stand-in for `node:url`. The pack loader is aliased away in the browser, so this is only a safety net
// for any stray reach; it returns the input unchanged.

export function fileURLToPath(u: unknown): string {
	return String(u);
}
