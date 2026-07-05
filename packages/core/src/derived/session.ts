import { createHash } from "node:crypto";

import { asSession, type Session } from "../domain";
import type { Payload } from "../sources";

/**
 * Session identity: prefer the payload `session_id`, else a stable sha1 hex of `transcript_path` (first 16
 * chars), else `"default"`. The `"default"` id is never recorded for cost/attribution.
 */
export function deriveSession(payload: Payload): Session {
	const id = payload.session_id;
	if (id !== undefined && id !== "") return asSession(id);

	const path = payload.transcript_path;
	if (path !== undefined && path !== "") {
		return asSession(createHash("sha1").update(path).digest("hex").slice(0, 16));
	}

	return asSession("default");
}
