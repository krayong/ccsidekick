import { homedir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { ccsidekickRoot, sessionDir } from "./configDir";

test("honors CLAUDE_CONFIG_DIR else ~/.claude", () => {
	expect(ccsidekickRoot({ CLAUDE_CONFIG_DIR: "/tmp/cc" })).toBe("/tmp/cc/ccsidekick");
	expect(ccsidekickRoot({})).toBe(join(homedir(), ".claude", "ccsidekick"));
	expect(sessionDir("/r", "abc")).toBe("/r/sessions/abc");
});
