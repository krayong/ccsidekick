// Pure {{token}} resolver for the website templates. Supports dotted paths ({{counts.widgets}}) and
// throws on any unknown/undefined token so a typo or a missing context value fails the build loudly
// instead of shipping a blank. The website templates have no literal {{ so this cannot false-match.
function resolve(ctx: Record<string, unknown>, path: string): unknown {
	let cur: unknown = ctx;
	for (const seg of path.split(".")) {
		if (cur === null || typeof cur !== "object" || !(seg in (cur as Record<string, unknown>)))
			return undefined;
		cur = (cur as Record<string, unknown>)[seg];
	}
	return cur;
}

export function renderTemplate(template: string, ctx: Record<string, unknown>): string {
	return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
		const value = resolve(ctx, key);
		if (
			typeof value !== "string" &&
			typeof value !== "number" &&
			typeof value !== "boolean" &&
			typeof value !== "bigint" &&
			typeof value !== "symbol"
		)
			throw new Error(`template token {{${key}}} has no primitive value`);
		return String(value);
	});
}
