import { join } from "node:path";

import { atomicWrite, cacheDir, readJson } from "./storage";

/** Learned map of opaque model ids (Bedrock inference-profile ARNs) → the display name Claude Code reported. */
type ModelNameCache = Record<string, string>;

const cachePath = (root: string): string => join(cacheDir(root), "model-names.json");

/** Read the learned id → display-name cache; empty on any miss or parse failure. */
export function readModelNames(root: string): ModelNameCache {
	return readJson<ModelNameCache>(cachePath(root), {});
}

/**
 * Learn an id → display-name mapping. A Bedrock inference-profile ARN resolves to one immutable model, but Claude
 * Code only reports the friendly `display_name` once that model resolves — early-session ticks carry the bare ARN.
 * Caching the first resolved name lets later sessions show it from the first tick instead of the raw ARN. No-op
 * when the mapping is unchanged, so steady-state renders never write.
 */
export function learnModelName(
	root: string,
	current: ModelNameCache,
	id: string,
	name: string,
): void {
	if (current[id] === name) return;
	atomicWrite(cachePath(root), JSON.stringify({ ...current, [id]: name }));
}
