import type { Provider } from "../domain";
import type { CredsInfo, EnvInputs, Payload } from "../sources";

export interface ProviderInfo {
	readonly provider: Provider;
	readonly hasQuota: boolean;
	readonly modelName: string;
	/** Badge text with the fixed ` | ` lead-in before the model; empty for the hidden subscription badge. */
	readonly badge: string;
}

/** Plan-mode alias map: a rare fallback used only when `display_name` is absent or empty. */
const PLAN_ALIAS: Record<string, string> = {
	opusplan: "Claude Opus",
	sonnetplan: "Claude Sonnet",
	haikuplan: "Claude Haiku",
};

/** Per-provider badge mark; subscription is hidden. */
const BADGE: Record<Provider, string> = {
	api: "🔑 API",
	bedrock: "🪨 Bedrock",
	vertex: "☁️ Vertex",
	foundry: "🏭 Foundry",
	proxy: "🔀 Proxy",
	ci: "⚙️ CI",
	team: "👥 Team",
	enterprise: "🏢 Enterprise",
	subscription: "",
};

/** Backends that can carry Anthropic quota (the usage rows). The rest run in no-quota mode. */
function quotaCapable(provider: Provider): boolean {
	return (
		provider === "subscription" ||
		provider === "team" ||
		provider === "enterprise" ||
		provider === "ci"
	);
}

function detectProvider(env: EnvInputs, creds: CredsInfo | null): Provider {
	// When the host manages the provider, do not assert one from the env flags: skip the env chain.
	if (!env.managedByHost) {
		// Mantle and AnthropicAws fold into bedrock (not distinct providers).
		if (env.useBedrock || env.useMantle || env.useAnthropicAws) return "bedrock";
		if (env.useVertex) return "vertex";
		if (env.useFoundry) return "foundry";
		if (env.hasAuthToken || env.customBaseUrl) return "proxy";
		if (env.hasOauthToken) return "ci";
		if (env.hasApiKey) return "api";
	}
	if (creds?.subscriptionType === "team") return "team";
	if (creds?.subscriptionType === "enterprise") return "enterprise";
	return "subscription";
}

/**
 * Resolve the Provider, its quota availability, and the model name — purely, no `aws bedrock` call and no
 * network. `hasQuota` is false for api/bedrock/vertex/foundry/proxy (no-quota mode) and true for the quota
 * backends when quota data exists; the no-quota heuristic treats a stripped `rate_limits` (an assistant turn
 * exists yet `rate_limits` is absent) as no-quota.
 */
export function deriveProvider(
	env: EnvInputs,
	payload: Payload,
	creds: CredsInfo | null,
	transcriptHasAssistantTurn: boolean,
): ProviderInfo {
	const id = payload.model.id ?? "";
	const trimmedName = payload.model.display_name?.trim() ?? "";
	const aliasName = PLAN_ALIAS[id.toLowerCase()] ?? "";
	const modelName =
		trimmedName !== "" ? trimmedName
		: aliasName !== "" ? aliasName
		: id;

	const provider = detectProvider(env, creds);

	let hasQuota = false;
	if (quotaCapable(provider)) {
		const rateLimitsPresent = payload.rate_limits !== undefined;
		// Quota present in the payload ⇒ quota. Absent + an assistant turn already exists ⇒ the relay stripped
		// it (no-quota). Absent with no assistant turn yet ⇒ stay optimistic (OAuth fallback may supply it).
		hasQuota = rateLimitsPresent || !transcriptHasAssistantTurn;
	}

	const mark = BADGE[provider];
	const badge = mark === "" ? "" : `${mark} | `;

	return { provider, hasQuota, modelName, badge };
}
