// End-to-end over the full render pipeline with the real, complete batman pack: a canonical stdin payload + a
// temp CLAUDE_CONFIG_DIR flow through acquire → derive → load pack → compose → render → stdout string, plus the
// best-effort persist tail. Real disk, the real pack loader, a fixed clock, no network. Asserts the figure shows
// wide, the chip shows narrow, a character line renders within its column cap, and persist is safe.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import batman from "../../../packs/batman/pack.json" with { type: "json" };
import { runRender } from "../../src/cli";
import {
	CHAR_LINE_MAX,
	asProject,
	asSession,
	type Event,
	type TermContext,
} from "../../src/domain";
import { displayWidth, stripAnsi } from "../../src/render";
import {
	appendEvent,
	ccsidekickRoot,
	fixedClock,
	sessionDir,
	writeCostCache,
} from "../../src/sources";
import canonical from "../fixtures/payloads/canonical.json" with { type: "json" };

const NOW = 1_700_000_000_000;
const clock = fixedClock(NOW);
const SESSION = "sess-123"; // canonical.session_id; the derived project is "krayong/ccsidekick"
const PROJECT = "krayong/ccsidekick";

// eslint-disable-next-line regexp/no-obscure-range -- U+2801–U+28FF is the inked braille-pattern block, deliberately excluding the U+2800 blank gutter/gap
const BRAILLE = /[⠁-⣿]/;
const TEST_FAIL_LINES = batman.lines.event.test_fail;

const stdin = JSON.stringify(canonical);

const term = (over: Partial<TermContext> = {}): TermContext => ({
	columns: 120,
	noColor: true,
	isTTY: true,
	...over,
});

/**
 * A temp config dir seeded so the event reaction slot wins the priority chain: comments on, network and the
 * helpful layer off (no network), a fresh `test_fail` event, and a prior cost-cache record for this project so
 * familiarity reports `seenProject` — without it the higher-priority first-contact slot would win instead.
 */
function seededEnv(): NodeJS.ProcessEnv {
	const cfg = track(mkdtempSync(join(tmpdir(), "cc-batman-")));
	const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: cfg };
	const confDir = join(cfg, "ccsidekick");
	mkdirSync(confDir, { recursive: true });
	writeFileSync(
		join(confDir, "config.toml"),
		[
			"[character]",
			'mode = "fixed"',
			'name = "batman"',
			"[comments]",
			"enabled = true",
			"[helpful]",
			"enabled = false",
			"[network]",
			"usage_fetch = false",
			"fx_refresh = false",
			"",
		].join("\n"),
	);

	const root = ccsidekickRoot(env);

	// A prior session for this project so it reads as already seen (defeats the first-contact slot).
	writeCostCache(root, {
		files: {
			"prior.jsonl": {
				mtime: 0,
				size: 0,
				total: 1,
				lines: [
					{ id: "prior", reqId: "r", sidechain: false, ts: NOW - 86_400_000, cost: 1 },
				],
				models: [],
				projectPath: PROJECT,
				record: {
					session: asSession("prior-session"),
					project: asProject(PROJECT),
					start: NOW - 86_400_000,
					end: NOW - 86_400_000 + 1000,
					tokens: { input: 1, output: 1, cache_read: 0, cache_creation: 0 },
					messages: 1,
				},
			},
		},
		aggregate: { chat: {}, tokenPriced: {}, sessionProject: {}, byModel: {} },
		lastScanTs: NOW, // fresh: scanCostTree reuses the cache rather than re-walking the empty tree
	});

	// A fresh failing test → the event reaction slot.
	const failEvent: Event = { ts: NOW, category: "test_fail" };
	appendEvent(sessionDir(root, SESSION), failEvent);

	return env;
}

test("wide terminal renders the braille figure and the model name", () => {
	const env = seededEnv();
	const { line } = runRender(stdin, env, term({ columns: 120 }), clock);
	const plain = stripAnsi(line);

	expect(BRAILLE.test(plain)).toBe(true); // the figure shows
	expect(plain).toContain("Opus 4.8"); // …alongside the resolved model name
	// The block is the taller of the trimmed batman logo (5 art rows) and the text column, so it is a
	// multi-row figure block — no longer forced to a fixed 9.
	expect(plain.split("\n").length).toBeGreaterThanOrEqual(5);
});

test("narrow terminal drops the figure and leads with the [batman] chip", () => {
	const env = seededEnv();
	const { line } = runRender(stdin, env, term({ columns: 40 }), clock);
	const plain = stripAnsi(line);

	expect(plain).toContain("[batman]"); // identity chip below MIN_RIGHT_WIDTH
	expect(BRAILLE.test(plain)).toBe(false); // the figure is dropped, not merely shrunk
});

test("the event reaction slot renders a character line within the column cap", () => {
	const env = seededEnv();
	const { line } = runRender(stdin, env, term({ columns: 120 }), clock);
	const rows = stripAnsi(line).split("\n");

	const charRow = rows.find((row) => TEST_FAIL_LINES.some((voice) => row.includes(voice)));
	expect(charRow).toBeDefined(); // a real batman test_fail voice line rendered

	// The character line is the right-column section (emblem + voice), past the left figure gutter.
	const charLine = (charRow ?? "").slice((charRow ?? "").indexOf("❝"));
	expect(charLine).not.toBe(""); // the emblem-led character section was found
	expect(displayWidth(charLine)).toBeLessThanOrEqual(CHAR_LINE_MAX);
});

test("persist writes session state without throwing", () => {
	const env = seededEnv();
	const { persist } = runRender(stdin, env, term({ columns: 120 }), clock);

	expect(() => {
		persist();
	}).not.toThrow();

	const statePath = join(ccsidekickRoot(env), "sessions", SESSION, "state.json");
	expect(existsSync(statePath)).toBe(true);
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
