#!/usr/bin/env node
// The user-facing entry point. Bare `ccsidekick` (a TTY, no subcommand) launches the Ink TUI; a non-TTY pipe
// prints manual-setup guidance and exits non-zero (the TUI is the only setup path). `uninstall` runs without the
// UI. This is the one place outside `tui/**` allowed to import Ink/React, and it does so lazily so the uninstall
// path never loads the UI runtime.

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runUninstall } from "../cli";
import { REFRESH_INTERVAL_SEC } from "../domain";
import { engineRoot, listInstalledPacks } from "../sources";

const sub = process.argv[2];

/** The default Claude config dir (honoring `CLAUDE_CONFIG_DIR`); the TUI header shows it explicitly. */
function claudeDir(): string {
	return process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
}

function printHelp(): void {
	process.stdout.write(
		[
			"ccsidekick — animated Claude Code status line (no API, no tokens)",
			"",
			"Usage:",
			"  ccsidekick                      launch the setup TUI (needs a terminal)",
			"  ccsidekick uninstall            remove the status line + hooks from settings.json",
			"  ccsidekick uninstall --restore-backup   restore the pre-install settings backup",
			"  ccsidekick help | --help | -h   show this help",
			"",
			"ccsidekick-render (hot path, wired into settings.json — not run by hand):",
			"  ccsidekick-render render        render one status line from a stdin payload",
			"  ccsidekick-render classify      PostToolUse-family event classifier",
			"",
			"State lives under ${CLAUDE_CONFIG_DIR:-~/.claude}/ccsidekick.",
			"",
		].join("\n"),
	);
}

function printManualSetup(): void {
	const dir = claudeDir();
	process.stderr.write(
		[
			"ccsidekick: the setup TUI needs an interactive terminal (a TTY).",
			"Run `ccsidekick` directly in your terminal to configure and wire it.",
			"",
			"To wire it by hand, add to your Claude Code settings.json:",
			`  • settings.json: ${join(dir, "settings.json")}`,
			`  • "statusLine": { "type": "command", "command": "ccsidekick-render render", "refreshInterval": ${String(REFRESH_INTERVAL_SEC)} }`,
			'  • three hooks, each running "ccsidekick-render classify" with the same matcher:',
			'      "PostToolUse", "PostToolUseFailure", and "PostToolBatch"',
			"",
		].join("\n"),
	);
}

async function launchTui(): Promise<void> {
	const { render } = await import("ink");
	const { createElement } = await import("react");
	const { App } = await import("../tui/shell");

	const engineDir = engineRoot(import.meta.url);
	const renderBin = fileURLToPath(new URL("ccsidekick-render.js", import.meta.url));
	const installed = listInstalledPacks(engineDir);
	const suggested = process.env["CLAUDE_CONFIG_DIR"];

	const instance = render(
		createElement(App, {
			homeDir: homedir(),
			renderBin,
			installed,
			...(suggested !== undefined ? { suggestedDir: suggested } : {}),
		}),
	);
	await instance.waitUntilExit();
}

async function main(): Promise<void> {
	if (sub === "help" || sub === "--help" || sub === "-h") {
		printHelp();
		process.exit(0);
	}

	if (sub === "uninstall") {
		runUninstall({
			settingsPath: join(claudeDir(), "settings.json"),
			restoreBackup: process.argv.includes("--restore-backup"),
		});
		process.exit(0);
	}

	if (!process.stdout.isTTY || !process.stdin.isTTY) {
		printManualSetup();
		process.exit(1);
	}

	await launchTui();
	process.exit(0);
}

void main();
