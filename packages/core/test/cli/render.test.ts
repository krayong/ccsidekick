// End-to-end over the full render pipeline: a real stdin payload + a temp CLAUDE_CONFIG_DIR flow through
// acquire → derive → compose → render → stdout string, plus the best-effort persist tail. Real disk, no mocks.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { runRender } from "../../src/cli";
import type { TermContext } from "../../src/domain";
import { stripAnsi } from "../../src/render";
import { fixedClock } from "../../src/sources";
import canonical from "../fixtures/payloads/canonical.json" with { type: "json" };

const NOW = 1_700_000_000_000;
const clock = fixedClock(NOW);

function freshRoot(): string {
	return track(mkdtempSync(join(tmpdir(), "cc-render-")));
}

/** Write a global `config.toml` under `<cfg>/ccsidekick/config.toml` and return the env. */
function withGlobalConfig(cfg: string, toml: string): NodeJS.ProcessEnv {
	const dir = join(cfg, "ccsidekick");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.toml"), toml);
	return { CLAUDE_CONFIG_DIR: cfg };
}

const term = (over: Partial<TermContext> = {}): TermContext => ({
	columns: 120,
	noColor: true,
	isTTY: true,
	...over,
});

const stdin = JSON.stringify(canonical);

test("renders the canonical payload (figure + fields) and persists state, cost, attribution", () => {
	const cfg = freshRoot();
	const { line, persist } = runRender(stdin, { CLAUDE_CONFIG_DIR: cfg }, term(), clock);

	const plain = stripAnsi(line);
	expect(line.length).toBeGreaterThan(0);
	expect(plain).toContain("Opus 4.8"); // the resolved model name (leading "Claude " stripped)
	expect(plain.split("\n").length).toBeGreaterThanOrEqual(9); // the 9-row figure drives the block height

	persist();
	const root = join(cfg, "ccsidekick");
	expect(existsSync(join(root, "sessions/sess-123/state.json"))).toBe(true);
	expect(existsSync(join(root, "cache/cost.json"))).toBe(true);

	const store = JSON.parse(readFileSync(join(root, "analytics/store.json"), "utf8")) as Record<
		string,
		{ project: string; character: string }
	>;
	expect(store["sess-123"]).toEqual({ project: "krayong/ccsidekick", character: "batman" });
});

test("a pack-load failure degrades to the [name] chip and never throws", () => {
	const cfg = freshRoot();
	const env = withGlobalConfig(cfg, '[character]\nmode = "fixed"\nname = "ghostpack"\n');
	const { line } = runRender(stdin, env, term(), clock);
	expect(typeof line).toBe("string");
	expect(stripAnsi(line)).toContain("[ghostpack]"); // identity chip survives the failed load
});

test("NO_COLOR / non-TTY emits plain output with no escapes", () => {
	const cfg = freshRoot();
	const out = runRender(stdin, { CLAUDE_CONFIG_DIR: cfg }, term({ noColor: true }), clock).line;
	expect(out).toBe(stripAnsi(out));
});

test("renders correctly at 100 columns (the default width)", () => {
	const cfg = freshRoot();
	const out = runRender(stdin, { CLAUDE_CONFIG_DIR: cfg }, term({ columns: 100 }), clock).line;
	const plain = stripAnsi(out);
	expect(plain).toContain("Opus 4.8");
	expect(plain.split("\n").length).toBeGreaterThanOrEqual(9); // the figure still fits at 100
});

test("gap 1 — the figure renders in color (SGR escapes present on a TTY)", () => {
	const cfg = freshRoot();
	const out = runRender(
		stdin,
		{ CLAUDE_CONFIG_DIR: cfg },
		term({ noColor: false, isTTY: true }),
		clock,
	).line;
	expect(out).toContain("\x1b[38;5;"); // figure shimmer gradient reached at least one SGR sequence
});

test("gap 2 — cost fields carry the local-currency parenthetical", () => {
	const cfg = freshRoot();
	// Pin INR explicitly: the default currency now follows the host locale, so a bare default would be USD on
	// most machines (and USD suppresses the parenthetical). INR keeps this a deterministic parenthetical check.
	const env = withGlobalConfig(cfg, 'schema_version = 1\n\n[line]\ncurrency = "INR"\n');
	const out = runRender(stdin, env, term(), clock).line;
	// payload cost 0.4231 USD → "$0.42 (₹36)" at the bundled INR rate (ceil).
	expect(stripAnsi(out)).toContain("(₹36)");
});

test("gap 3 — a non-subscription provider renders the badge on the model row", () => {
	const cfg = freshRoot();
	const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_API_KEY: "sk-test" };
	const out = runRender(stdin, env, term(), clock).line;
	expect(stripAnsi(out)).toContain("🔑 API");
});

test("gap 4 — a [theme.icons] override reaches stdout via the resolved theme", () => {
	const cfg = freshRoot();
	const env = withGlobalConfig(cfg, '[theme.icons]\ndir = "ΔIR"\n');
	const out = runRender(stdin, env, term(), clock).line;
	expect(stripAnsi(out)).toContain("ΔIR"); // the configured dir glyph, not the engine default "◈"
});

test("gap 5 — the helpful layer is skipped when [helpful].enabled is false", () => {
	const cfg = freshRoot();
	const balancePath = join(cfg, "balance.json");
	writeFileSync(balancePath, JSON.stringify({ amount: 5, currency: "USD", ts: NOW }));

	const enabledEnv = withGlobalConfig(
		cfg,
		`[helpful]\nenabled = true\n[network]\nbalance_path = "${balancePath}"\n`,
	);
	const enabled = stripAnsi(runRender(stdin, enabledEnv, term(), clock).line);
	expect(enabled).toContain("Top up"); // the low-balance helpful tip

	const disabledEnv = withGlobalConfig(
		cfg,
		`[helpful]\nenabled = false\n[network]\nbalance_path = "${balancePath}"\n`,
	);
	const disabled = stripAnsi(runRender(stdin, disabledEnv, term(), clock).line);
	expect(disabled).not.toContain("Top up"); // section skipped, not merely hidden
});

test("gap 5 — [character].enabled = false drops the figure (figureless, no chip)", () => {
	const cfg = freshRoot();

	const enabled = stripAnsi(runRender(stdin, { CLAUDE_CONFIG_DIR: cfg }, term(), clock).line);
	expect(enabled).toContain("⣿"); // batman's figure body renders by default
	expect(enabled.split("\n").length).toBeGreaterThanOrEqual(9); // the 9-row figure block

	const disabledEnv = withGlobalConfig(freshRoot(), "[character]\nenabled = false\n");
	const disabled = stripAnsi(runRender(stdin, disabledEnv, term(), clock).line);
	expect(disabled).not.toContain("⣿"); // figure section skipped, not merely hidden
	expect(disabled).not.toContain("[batman]"); // a disabled character omits the chip too
	expect(disabled).toContain("Opus 4.8"); // the statusline still renders, figureless
});

test('the "default" session (no id, no transcript path) is never recorded', () => {
	const cfg = freshRoot();
	const anon = { ...canonical } as Record<string, unknown>;
	delete anon["session_id"];
	delete anon["transcript_path"];
	const { persist } = runRender(JSON.stringify(anon), { CLAUDE_CONFIG_DIR: cfg }, term(), clock);
	persist();

	const root = join(cfg, "ccsidekick");
	expect(existsSync(join(root, "sessions/default/state.json"))).toBe(false);
	if (existsSync(join(root, "analytics/store.json"))) {
		const store = JSON.parse(
			readFileSync(join(root, "analytics/store.json"), "utf8"),
		) as Record<string, unknown>;
		expect(Object.keys(store)).not.toContain("default");
	}
});

const tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs.length = 0;
});
function track(d: string): string {
	tmpDirs.push(d);
	return d;
}
