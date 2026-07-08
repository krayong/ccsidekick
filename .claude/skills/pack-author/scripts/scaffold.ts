// `scaffold`: the pack-author setup step. It writes a skeleton pack under `packages/packs/<name>` (a full-shaped
// `pack.json` with every voice pool keyed and nested, one unique placeholder per leaf cell, plus a placeholder
// figure for `idle`), a `package.json`, a `README.md`, and a `REVIEW.md`, then registers the pack in
// `packs/registry.ts` (`PACKS`) and as a `workspace:*` runtime dependency of `packages/core` (both idempotent).
// That core dependency is what the render loader resolves the pack through, so without it the statusline shot
// drops the figure; the author must run `bun install` after scaffolding to materialize the workspace symlink. The
// skeleton passes `lint-pack --schema-only` and deliberately fails full
// lint (the pools sit at one placeholder per cell, not their authored counts), so an author fills the voice in
// from a structure that already loads. Runnable as a CLI (`bun scaffold.ts <name> --display <n> --emblem <g>`)
// or importable as `scaffold(name, opts)`; the optional `opts.root` retargets the workspace for tests.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	FIGURE_COLS,
	MOODS,
	type PackJson,
	PLACEHOLDER_TOKEN,
	PRESSURE_MOODS,
	REACTION_CATEGORIES,
	STACKS,
	TIERS,
} from "../../../../packages/core/src";

// These four key sets are validated in `packs/validate.ts` but are not exported there as runtime arrays; mirror
// them here (the types `GreetingBucket`, `MilestoneType`, `PositiveGitMoment`, `StackMoment` live in `domain/pack`).
const GREETING_BUCKETS = ["morning", "day", "evening", "night", "weekend"] as const;
const MILESTONES = ["tier_up", "comeback", "streak", "anniversary"] as const;
const POSITIVE_GIT = ["clean_tree", "op_cleared", "branch_created", "tag_pushed"] as const;
const STACK_MOMENTS = ["slow", "fail"] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts → pack-author → skills → .claude → repo root.
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

export interface ScaffoldOpts {
	readonly displayName: string;
	readonly emblem: string;
	readonly root?: string;
}

// One unique placeholder line per leaf cell, keyed by its dotted path and stamped with the reserved sentinel so
// the placeholder gate can detect un-replaced cells. Unique + short: never trips near-duplicate or width gates.
const cell = (path: string): string[] => [`${PLACEHOLDER_TOKEN} TODO ${path.split(".").join(" ")}`];

const r1 = (pool: string, keys: readonly string[]): Record<string, string[]> =>
	Object.fromEntries(keys.map((k) => [k, cell(`${pool}.${k}`)]));

const r2 = (
	pool: string,
	outer: readonly string[],
	inner: readonly string[],
): Record<string, Record<string, string[]>> =>
	Object.fromEntries(outer.map((o) => [o, r1(`${pool}.${o}`, inner)]));

// A placeholder figure the author replaces with sourced art. Each row is padded to the fixed column width so the
// figure is uniform and well under the legibility ceiling.
const figureFrame = (): string[] =>
	["TODO source the figure", "with the ascii-art skill", "a single figure", "(<= 9 x 25)."].map(
		(s) => s.slice(0, FIGURE_COLS).padEnd(FIGURE_COLS, " "),
	);

function buildSkeleton(name: string, opts: ScaffoldOpts): PackJson {
	const pack = {
		schema: 1,
		name,
		displayName: opts.displayName,
		attribution: {
			artist: "TODO credit the artist",
			source: "TODO image source URL or catalog",
		},
		emblem: opts.emblem,
		tone: "mild",
		// Starter theme (houston defaults). Replace via the theme-options step before shipping.
		theme: {
			hues: [75, 147, 77, 222, 210],
			comment: [75, 147, 222],
			signals: { nominal: 77, caution: 214, critical: 203 },
			separator: 147,
		},
		art: figureFrame(),
		lines: {
			mood: r2("mood", MOODS, TIERS),
			greeting: r2("greeting", GREETING_BUCKETS, TIERS),
			firstContact: r1("firstContact", TIERS),
			milestone: r2("milestone", MILESTONES, TIERS),
			positiveGit: r2("positiveGit", POSITIVE_GIT, TIERS),
			egg: r1("egg", TIERS),
			event: r1("event", REACTION_CATEGORIES),
			stack: r2("stack", STACKS, STACK_MOMENTS),
			pressure: r1("pressure", PRESSURE_MOODS),
			dateEgg: cell("dateEgg"),
		},
		spinnerVerbs: [`${PLACEHOLDER_TOKEN} TODO spinner verb`],
	};
	return pack as unknown as PackJson;
}

// A git config value (e.g. `user.name`), trimmed; "" when git or the key is unavailable.
function gitConfig(key: string): string {
	try {
		return execFileSync("git", ["config", key], { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

// The pack's author, read from the ambient git identity so the credit is whoever scaffolds the pack rather than a
// hardcoded name. `user.name`/`user.email` combine into the standard "Name <email>" form; a missing identity falls
// back to a generic credit so the generated package.json still clears the author gate.
function gitAuthor(): string {
	const name = gitConfig("user.name");
	const email = gitConfig("user.email");
	if (name !== "" && email !== "") return `${name} <${email}>`;
	if (name !== "") return name;
	if (email !== "") return email;
	return "ccsidekick contributors";
}

function packageJson(name: string, displayName: string): string {
	return `${JSON.stringify(
		{
			name: `@ccsidekick/pack-${name}`,
			version: "0.0.0",
			description: `${displayName} character pack for ccsidekick`,
			type: "module",
			files: ["pack.json", "README.md", "assets"],
			exports: { "./pack.json": "./pack.json" },
			license: "MIT",
			repository: {
				type: "git",
				url: "git+https://github.com/krayong/ccsidekick.git",
				directory: `packages/packs/${name}`,
			},
			author: gitAuthor(),
		},
		null,
		"\t",
	)}\n`;
}

const readmeMd = (name: string, displayName: string): string =>
	`# ${displayName} pack

A ccsidekick character pack, authored through the \`pack-author\` skill. A pack is data; nothing here runs.

- Voice: drafted against \`voice-pack.md\`, written into \`pack.json\` \`lines\`.
- Figure: sourced via the \`ascii-art\` skill, credited in \`pack.json\` \`attribution\`.
- Tone: set in \`pack.json\`.

Lint: \`bun run lint-pack packages/packs/${name}\`. README + shot: \`bun run pack-readme packages/packs/${name}\` (regenerates this file).
`;

const reviewMd = (displayName: string): string =>
	`# Review: ${displayName}

A reviewer who did not author the pack signs this before it ships. Check each item, then sign.

- [ ] Figure is recognizable and legible at 9×25.
- [ ] Lines are on-voice and match the declared tone.
- [ ] \`voice-pack.md\` reflects the shipped voice.
- [ ] Variety holds across cells (no line reused between cells, no other pack's signature line).
- [ ] License and attribution are acceptable.

\`lint-pack\` enforces \`package.json\` completeness (name, \`files\`, \`repository.directory\`, author), so it is not a manual check.

Reviewer (not the author): ____________________    Date: __________
`;

function registerPack(root: string, name: string): void {
	const registryPath = join(root, "packages", "core", "src", "packs", "registry.ts");
	const src = readFileSync(registryPath, "utf8");
	const match = /export const PACKS = \[([^\]]*)\] as const;/.exec(src);
	if (match === null) throw new Error("scaffold: could not find PACKS in registry.ts");
	const existing = [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	if (existing.includes(name)) return; // already registered, no-op
	const next = [...existing, name].map((n) => `"${n}"`).join(", ");
	const replacement = `export const PACKS = [${next}] as const;`;
	writeFileSync(registryPath, src.replace(match[0], replacement));
}

// Link the pack as a `workspace:*` runtime dependency of `packages/core`. Every pack ships bundled, so the
// render loader (and thus the README statusline shot) resolves it through `node_modules/@ccsidekick/pack-<name>`,
// which the workspace only creates for declared dependencies. Idempotent; a no-op if already declared.
function linkCoreDependency(root: string, name: string): void {
	const pkgPath = join(root, "packages", "core", "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		dependencies?: Record<string, string>;
		[k: string]: unknown;
	};
	const dep = `@ccsidekick/pack-${name}`;
	const deps = pkg.dependencies ?? {};
	if (deps[dep] !== undefined) return; // already declared
	deps[dep] = "workspace:*";
	// Keep the pack entries alphabetical up front; leave any non-pack dependencies after them in place.
	const entries = Object.entries(deps);
	const packEntries = entries
		.filter(([k]) => k.startsWith("@ccsidekick/pack-"))
		.sort(([a], [b]) => a.localeCompare(b));
	const otherEntries = entries.filter(([k]) => !k.startsWith("@ccsidekick/pack-"));
	pkg.dependencies = Object.fromEntries([...packEntries, ...otherEntries]);
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
}

export function scaffold(name: string, opts: ScaffoldOpts): void {
	const root = opts.root ?? REPO_ROOT;
	const dir = join(root, "packages", "packs", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "pack.json"),
		`${JSON.stringify(buildSkeleton(name, opts), null, "\t")}\n`,
	);
	writeFileSync(join(dir, "package.json"), packageJson(name, opts.displayName));
	writeFileSync(join(dir, "README.md"), readmeMd(name, opts.displayName));
	writeFileSync(join(dir, "REVIEW.md"), reviewMd(opts.displayName));
	registerPack(root, name);
	linkCoreDependency(root, name);
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
}

function runCli(): void {
	const argv = process.argv.slice(2);
	const name = argv.find((a) => !a.startsWith("--"));
	if (name === undefined) {
		process.stderr.write(
			'usage: scaffold <name> --display "<DisplayName>" --emblem "<glyph>"\n',
		);
		process.exit(2);
	}
	const displayName =
		flagValue(argv, "--display") ?? (name[0] ?? "").toUpperCase() + name.slice(1);
	const emblem = flagValue(argv, "--emblem") ?? "◆";
	scaffold(name, { displayName, emblem });
	process.stdout.write(
		`scaffold: wrote packages/packs/${name}, registered it, and linked it as a core devDependency. Next: run \`bun install\` (materializes the workspace symlink the render/shot needs), then source the figure and lint --schema-only.\n`,
	);
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) runCli();
