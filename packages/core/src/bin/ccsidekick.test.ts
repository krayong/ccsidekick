import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

const bin = fileURLToPath(new URL("./ccsidekick.ts", import.meta.url));

// A non-TTY invocation prints the manual-setup hint. It must carry `refreshInterval` so a hand copy-paste
// yields an animating character rather than a frozen one.
test("manual-setup hint includes refreshInterval", async () => {
	const proc = Bun.spawn(["bun", bin], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;
	expect(stderr).toContain("refreshInterval");
});

// End-to-end: the user-facing `ccsidekick uninstall` dispatch (spawned, not a unit call) strips our wiring from a
// real settings.json and exits 0, leaving unrelated keys intact.
test("uninstall dispatch removes our statusLine + classify hook and exits 0", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-uninstall-"));
	try {
		const settings = join(dir, "settings.json");
		writeFileSync(
			settings,
			JSON.stringify({
				model: "sonnet",
				statusLine: { type: "command", command: "ccsidekick-render render" },
				hooks: {
					PostToolUse: [
						{ hooks: [{ type: "command", command: "ccsidekick-render classify" }] },
					],
				},
			}),
		);
		const proc = Bun.spawn(["bun", bin, "uninstall"], {
			env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(await proc.exited).toBe(0);
		const after = JSON.parse(readFileSync(settings, "utf8")) as Record<string, unknown>;
		expect(after["statusLine"]).toBeUndefined(); // our statusLine removed
		expect(after["hooks"]).toBeUndefined(); // the only hook was ours ⇒ the empty hooks key is dropped
		expect(after["model"]).toBe("sonnet"); // unrelated keys preserved
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
