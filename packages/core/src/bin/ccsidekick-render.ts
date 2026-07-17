#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { runClassify, runRender } from "../cli";
import { DEFAULT_COLUMNS, type TermContext } from "../domain";
import { resolveClock, systemClock } from "../sources";

const sub = process.argv[2];

/**
 * The statusLine command (main agent only): read the payload, build the TermContext from the live terminal,
 * render, flush the line, then run the best-effort persist tail. Width is best-effort — `COLUMNS` when present,
 * else `DEFAULT_COLUMNS`. Any unexpected failure is swallowed so the status line never surfaces an error.
 */
function dispatchRender(): void {
	try {
		const columns = Number(process.env["COLUMNS"]) || DEFAULT_COLUMNS;
		const term: TermContext = {
			columns,
			noColor: process.env["NO_COLOR"] !== undefined,
			// Claude Code is the color-capable consumer: it runs this command and renders the ANSI itself.
			// The statusline stdout is always a pipe (never a TTY), so treat it as color-capable and let
			// NO_COLOR be the only gate that strips escapes.
			isTTY: true,
		};
		const { line, persist } = runRender(
			readFileSync(0, "utf8"),
			process.env,
			term,
			// systemClock normally; a fixed clock when CCSIDEKICK_NOW pins it, so generated snapshots reproduce.
			resolveClock(process.env),
		);
		process.stdout.write(`${line}\n`);
		persist();
	} catch {
		/* never surface a render error to Claude Code */
	}
}

/**
 * The classify hook fires on every tool call: it MUST always exit 0 and write NOTHING to stdout/stderr, or
 * Claude Code surfaces a hook error / injects context on each call. Swallow every failure, then exit 0.
 */
function dispatchClassify(): void {
	try {
		runClassify(readFileSync(0, "utf8"), process.env, systemClock);
	} catch {
		/* never surface a classify error */
	} finally {
		process.exit(0);
	}
}

if (sub === "classify") {
	dispatchClassify();
} else if (sub === "render") {
	dispatchRender();
} else {
	process.stderr.write("usage: ccsidekick-render <render|classify>\n");
	process.exit(2);
}
