import { expect, test } from "bun:test";

import { loadConfig } from "../../../src/sources";
import { previewConfigToml } from "../../../src/tui";
import { buildSaveConfirm, type SaveTarget } from "../../../src/tui/shell";

const cfg = loadConfig("");

test("previewConfigToml round-trips the draft through the loader's defaults", () => {
	const toml = previewConfigToml(cfg);
	expect(toml).toContain("schema_version");
	expect(toml).toContain("[character]");
});

test("previewConfigToml reflects an edited field", () => {
	const edited = { ...cfg, comments: { ...cfg.comments, character: false } };
	const toml = previewConfigToml(edited);
	expect(toml).toContain("[comments]");
	expect(toml.toLowerCase()).toContain("character = false");
});

test("buildSaveConfirm reports a single global target's scope and dir", () => {
	const targets: SaveTarget[] = [{ dir: "/home/dev/.claude", scope: "global" }];
	const view = buildSaveConfirm(targets);
	expect(view.scope).toBe("global");
	expect(view.targets).toEqual(["/home/dev/.claude"]);
});

test("mixed targets report scope 'mixed'", () => {
	const targets: SaveTarget[] = [
		{ dir: "/home/dev/.claude", scope: "global" },
		{ dir: "/project/.claude", scope: "local", cwd: "/project" },
	];
	const view = buildSaveConfirm(targets);
	expect(view.scope).toBe("mixed");
	expect(view.targets).toEqual(["/home/dev/.claude", "/project/.claude"]);
});
