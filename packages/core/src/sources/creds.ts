import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { keychainService } from "./oauthUsage";

type SubscriptionType = "pro" | "max" | "team" | "enterprise";

/** Subscription tier read from the OAuth creds blob; `present` is true whenever any creds blob was found. */
export interface CredsInfo {
	readonly subscriptionType?: SubscriptionType;
	readonly present: boolean;
}

/** A credential-lookup subprocess runner: takes command + args, returns stdout ("" on any failure). */
export type Runner = (cmd: string, args: string[]) => string;

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const SUBSCRIPTIONS: ReadonlySet<string> = new Set(["pro", "max", "team", "enterprise"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Default runner: `spawnSync` with a timeout; nonzero exit / error / throw ⇒ "". */
const defaultRunner: Runner = (cmd, args) => {
	try {
		const r = spawnSync(cmd, args, {
			encoding: "utf8",
			timeout: 1500,
			killSignal: "SIGKILL",
		});
		if (r.error || r.status !== 0) return "";
		return r.stdout;
	} catch {
		return "";
	}
};

/** The Claude config dir (honoring `CLAUDE_CONFIG_DIR`); the creds file and config-scoped keychain live here. */
function configBase(): string {
	return process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
}

/**
 * Best-effort read of the OAuth creds blob: macOS keychain (the config-scoped service Claude Code writes, then
 * the legacy bare service), else the creds file, else Linux secret-tool. `base` is the config dir.
 */
function readBlob(run: Runner, base: string): string {
	for (const service of [keychainService(base), KEYCHAIN_SERVICE]) {
		const keychain = run("security", ["find-generic-password", "-s", service, "-w"]);
		if (keychain.trim() !== "") return keychain;
	}
	try {
		const file = readFileSync(join(base, ".credentials.json"), "utf8");
		if (file.trim() !== "") return file;
	} catch {
		/* no creds file ⇒ fall through to secret-tool */
	}
	const secretTool = run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE]);
	if (secretTool.trim() !== "") return secretTool;
	return "";
}

/** The subscription tier named in a creds JSON blob, or undefined when absent/unrecognized. */
function parseSubscription(blob: string): SubscriptionType | undefined {
	const parsed: unknown = JSON.parse(blob);
	const oauth = isObject(parsed) ? parsed["claudeAiOauth"] : undefined;
	const raw = isObject(oauth) ? oauth["subscriptionType"] : undefined;
	if (typeof raw === "string" && SUBSCRIPTIONS.has(raw)) return raw as SubscriptionType;
	return undefined;
}

/**
 * The tier implied by a managed-OAuth profile's `.claude.json` `oauthAccount.organizationType`: Team/Enterprise
 * SSO logins carry no keychain `subscriptionType`, so their identity lives only here. Undefined on any read/parse
 * failure or a non-managed org. `base` is the config dir.
 */
function readOrgTier(base: string): SubscriptionType | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(base, ".claude.json"), "utf8"));
		const oauth = isObject(parsed) ? parsed["oauthAccount"] : undefined;
		const orgType = isObject(oauth) ? oauth["organizationType"] : undefined;
		if (orgType === "claude_enterprise") return "enterprise";
		if (orgType === "claude_team") return "team";
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Gated read of the OAuth subscription tier. Prefers the local creds blob (config-scoped keychain, legacy
 * keychain, creds file, or secret-tool); when no blob exists, falls back to the managed-OAuth identity in
 * `.claude.json` so Team/Enterprise SSO profiles resolve their tier. Never throws; returns `null` when nothing
 * is found or on any parse failure. Only invoked when an API key is set or via the cached OAuth usage path —
 * never per-tick on the hot render path.
 */
export function readCreds(run: Runner = defaultRunner): CredsInfo | null {
	try {
		const base = configBase();
		const blob = readBlob(run, base);
		if (blob.trim() !== "") {
			const tier = parseSubscription(blob);
			return tier !== undefined ?
					{ present: true, subscriptionType: tier }
				:	{ present: true };
		}
		const org = readOrgTier(base);
		if (org !== undefined) return { present: true, subscriptionType: org };
		return null;
	} catch {
		return null;
	}
}
