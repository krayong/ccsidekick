import { homedir } from "node:os";
import { join } from "node:path";

export const ccsidekickRoot = (env: NodeJS.ProcessEnv = process.env): string =>
	join(env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"), "ccsidekick");

export const sessionDir = (root: string, id: string): string => join(root, "sessions", id);

export const cacheDir = (root: string): string => join(root, "cache");

export const analyticsDir = (root: string): string => join(root, "analytics");
