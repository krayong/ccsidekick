import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

const PLUGIN = ".claude-plugin/plugin.json";
const MARKETPLACE = ".claude-plugin/marketplace.json";

const readText = (rel: string): string => readFileSync(join(root, rel), "utf8");

const readJson = (rel: string): Record<string, unknown> =>
	JSON.parse(readText(rel)) as Record<string, unknown>;

const marketplaceEntries = (): readonly Record<string, unknown>[] => {
	const plugins = readJson(MARKETPLACE)["plugins"];
	if (!Array.isArray(plugins)) throw new Error(`${MARKETPLACE}: plugins is not an array`);
	return plugins as readonly Record<string, unknown>[];
};

// The plugin manifest advertises a version to `claude plugin validate --strict`, and Changesets bumps only
// packages/core/package.json. This assertion is what keeps the two from drifting apart; the bump itself is
// applied by scripts/sync-plugin-version.ts inside `bun run ci:version`.
test("plugin.json version matches the published package version", () => {
	const pkg = readJson("packages/core/package.json");
	const plugin = readJson(PLUGIN);
	// Assert the shape too. Both sides being absent would otherwise satisfy a bare equality check.
	expect(plugin["version"]).toMatch(/^\d+\.\d+\.\d+/);
	expect(plugin["version"]).toBe(pkg["version"]);
});

// sync-plugin-version.ts rewrites `"version": "…"` by string replacement, which is unbounded across nesting
// levels. One occurrence is the invariant that makes that safe; a nested version key (an mcpServers block, a
// second marketplace entry) would be silently overwritten with core's version on the next release.
test("each manifest holds at most one version key, so the sync cannot overreach", () => {
	expect(readText(PLUGIN).match(/"version":/g)).toHaveLength(1);
	expect(readText(MARKETPLACE).match(/"version":/g)).toBeNull();
});

// A marketplace whose single entry does not resolve to the plugin beside it installs as a broken id.
test("marketplace entry names the plugin and sources it at the repo root", () => {
	const plugin = readJson(PLUGIN);
	const entries = marketplaceEntries();
	expect(entries).toHaveLength(1);
	expect(entries[0]?.["name"]).toBe(plugin["name"]);
	expect(entries[0]?.["source"]).toBe("./");
});

// Version lives in plugin.json alone. A copy in the marketplace entry is optional to the validator and is a
// second thing that can drift, so its absence is asserted rather than merely tolerated.
test("marketplace entry carries no version of its own", () => {
	expect(marketplaceEntries()[0]?.["version"]).toBeUndefined();
});

// The entry does carry a description, because a browse listing may read it rather than falling back to
// plugin.json. It is the one duplicated string here, so pin it to the marketplace's own description: two
// copies in one file should never disagree, and a listing showing a bare name is the failure being avoided.
test("marketplace entry description matches the marketplace description", () => {
	const market = readJson(MARKETPLACE);
	const entry = marketplaceEntries()[0];
	expect(entry?.["description"]).toBe(market["description"]);
	expect(entry?.["description"]).toBeTruthy();
});
