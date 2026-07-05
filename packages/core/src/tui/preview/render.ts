// The draft-faithful bridge: write the current draft to a scratch config dir and run the REAL render pipeline
// (cli/render) against a scenario's payload/env/overrides, so the preview reflects both the unsaved draft and the
// chosen provider/billing state, offline. Plain Node (no Ink/React).

import { join } from "node:path";

import { runRender, writeConfigToml } from "../../cli";
import type { TermContext } from "../../domain";
import { type Clock, type Config, fixedClock } from "../../sources";

import { previewEnv, scratchRoot, seedCostFixture, setupGitFixture } from "./fixture";
import { type Scenario, scenarioPayloadJson } from "./scenarios";

interface RenderScenarioOpts {
	readonly columns: number;
	readonly noColor: boolean;
	readonly clock?: Clock;
	readonly scratchDir?: string;
}

const DEFAULT_CLOCK = fixedClock(20_000 * 86_400_000 + 12 * 3_600_000, "UTC");

/**
 * Render the multi-line statusline preview for `draft` under `scenario`, as colored ANSI (or plain, when
 * `noColor`). Returns the renderer's exact output; on any failure returns a short "preview unavailable"
 * string. Fixture I/O and the render are guarded so this never throws into React.
 */
export function renderScenario(
	scenario: Scenario,
	draft: Config,
	opts: RenderScenarioOpts,
): string {
	try {
		const clock = opts.clock ?? DEFAULT_CLOCK;
		const root = scratchRoot(opts.scratchDir);
		writeConfigToml(join(root, "ccsidekick"), draft);

		const env = previewEnv(root, scenario.env ?? {});
		const home = env["HOME"] ?? root;
		const workdir = join(home, "ccsidekick");
		setupGitFixture(workdir);
		seedCostFixture(root, workdir);

		const term: TermContext = { columns: opts.columns, noColor: opts.noColor, isTTY: true };
		return runRender(
			scenarioPayloadJson(scenario, workdir),
			env,
			term,
			clock,
			scenario.overrides,
		).line;
	} catch (e) {
		// Never let scratch-dir/git fixture I/O throw into the React render path (it blanks the popup).
		return `preview unavailable: ${e instanceof Error ? e.message : String(e)}`;
	}
}
