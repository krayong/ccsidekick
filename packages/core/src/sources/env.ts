export interface EnvInputs {
	readonly hasApiKey: boolean;
	readonly hasAuthToken: boolean;
	/** True only when ANTHROPIC_BASE_URL points at a host other than api.anthropic.com (exact host compare). */
	readonly customBaseUrl: boolean;
	readonly useBedrock: boolean;
	readonly useVertex: boolean;
	readonly useFoundry: boolean;
	/** Both fold into the bedrock provider (not distinct providers). */
	readonly useMantle: boolean;
	readonly useAnthropicAws: boolean;
	/** When set, the host manages the provider ⇒ suppress env-based provider detection. */
	readonly managedByHost: boolean;
	readonly hasOauthToken: boolean;
}

const on = (v: string | undefined): boolean => v === "1" || v === "true";

function isCustomHost(base: string | undefined): boolean {
	const raw = (base ?? "").trim();
	if (raw === "") return false;
	let host = "";
	try {
		host = new URL(raw.includes("//") ? raw : `//${raw}`, "http://x").hostname;
	} catch {
		return false;
	}
	const norm = host.replace(/\.$/, "").toLowerCase();
	return norm !== "" && norm !== "api.anthropic.com";
}

/** Parse `CCSIDEKICK_MODEL_ALIASES` (`custom=key,custom2=key2`) into a custom-id → table-key map. */
export function readModelAliases(
	env: NodeJS.ProcessEnv = process.env,
): ReadonlyMap<string, string> {
	const out = new Map<string, string>();
	const raw = env["CCSIDEKICK_MODEL_ALIASES"];
	if (raw === undefined) return out;
	for (const pair of raw.split(",")) {
		const eq = pair.indexOf("=");
		if (eq <= 0) continue;
		const from = pair.slice(0, eq).trim();
		const to = pair.slice(eq + 1).trim();
		if (from !== "" && to !== "") out.set(from, to);
	}
	return out;
}

/** Read the provider/auth-relevant environment variables into the typed `EnvInputs` flags. */
export function readEnv(env: NodeJS.ProcessEnv = process.env): EnvInputs {
	return {
		hasApiKey: Boolean(env["ANTHROPIC_API_KEY"]),
		hasAuthToken: Boolean(env["ANTHROPIC_AUTH_TOKEN"]),
		customBaseUrl: isCustomHost(env["ANTHROPIC_BASE_URL"]),
		useBedrock: on(env["CLAUDE_CODE_USE_BEDROCK"]),
		useVertex: on(env["CLAUDE_CODE_USE_VERTEX"]),
		useFoundry: on(env["CLAUDE_CODE_USE_FOUNDRY"]),
		// useMantle and useAnthropicAws both fold into the bedrock provider in derived/provider.
		useMantle: on(env["CLAUDE_CODE_USE_MANTLE"]),
		useAnthropicAws: on(env["CLAUDE_CODE_USE_ANTHROPIC_AWS"]),
		managedByHost: on(env["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"]),
		hasOauthToken: Boolean(env["CLAUDE_CODE_OAUTH_TOKEN"]),
	};
}
