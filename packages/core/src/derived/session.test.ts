import { createHash } from "node:crypto";

import { expect, test } from "bun:test";

import { asSession } from "../domain";
import type { Payload } from "../sources";

import { deriveSession } from "./session";

const base: Payload = { workspace: {}, model: {} };

test("session_id wins when present", () => {
	expect(deriveSession({ ...base, session_id: "abc123" })).toBe(asSession("abc123"));
	// transcript_path is ignored when session_id is set
	expect(deriveSession({ ...base, session_id: "abc123", transcript_path: "/t.jsonl" })).toBe(
		asSession("abc123"),
	);
});

test("missing session_id hashes transcript_path deterministically (sha1 hex, 16 chars)", () => {
	const path = "/Users/me/.claude/projects/foo/s.jsonl";
	const expected = createHash("sha1").update(path).digest("hex").slice(0, 16);
	expect(deriveSession({ ...base, transcript_path: path })).toBe(asSession(expected));
	expect(expected).toHaveLength(16);
	// stable across calls
	expect(deriveSession({ ...base, transcript_path: path })).toBe(
		deriveSession({ ...base, transcript_path: path }),
	);
});

test("absent both ⇒ default", () => {
	expect(deriveSession(base)).toBe(asSession("default"));
	expect(deriveSession({ ...base, session_id: "" })).toBe(asSession("default"));
});
