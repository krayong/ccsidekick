import { humanize } from "../format";
import type { Payload, TranscriptScan } from "../sources";

import type { ProviderInfo } from "./provider";

export interface ModelInfo {
	/** Resolved model name with a leading `"Claude "` stripped (e.g. `Opus 4.8`). */
	readonly name: string;
	/** Humanized context-window size (e.g. `1M`); empty when no size is reported. */
	readonly contextLabel: string;
	/** Reasoning effort level; rendered inline in the model field, not as a separate widget. */
	readonly effort?: string;
	readonly fast: boolean;
	readonly thinking: boolean;
	readonly outputStyle?: string;
	readonly agentName?: string;
}

/**
 * The model field's inputs. `name` strips a leading `"Claude "` from the provider-resolved model name; `fast`
 * comes from the transcript scan (no payload field carries it); effort/thinking/style/agent come from the
 * payload. Effort renders inline in the model, so it is not a widget of its own.
 */
export function deriveModel(
	payload: Payload,
	provider: ProviderInfo,
	scan: TranscriptScan,
): ModelInfo {
	// Drop a leading "Claude " and any trailing "(…)" context note (e.g. Bedrock's "Opus 4.8 (1M context)"), so
	// the separately-rendered contextLabel isn't doubled.
	const name = provider.modelName.replace(/^Claude /, "").replace(/\s*\([^)]*\)\s*$/, "");
	const size = payload.context_window?.context_window_size;
	const contextLabel = size !== undefined && size > 0 ? humanize(size) : "";

	const effort = payload.effort?.level;
	const outputStyle = payload.output_style?.name;
	const agentName = payload.agent?.name;

	return {
		name,
		contextLabel,
		...(effort !== undefined ? { effort } : {}),
		fast: scan.speed === "fast",
		thinking: payload.thinking?.enabled ?? false,
		...(outputStyle !== undefined ? { outputStyle } : {}),
		...(agentName !== undefined ? { agentName } : {}),
	};
}
