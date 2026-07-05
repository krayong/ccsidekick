import { mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { type SessionState, readState, writeState } from "./state";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-st-"));
}

const EMPTY: SessionState = { pressureFired: [], milestones: [], helpful: {} };

test("write then read round-trips the full state", () => {
	const dir = tmp();
	try {
		const s: SessionState = {
			character: "robin",
			pressureFired: ["block_limit"],
			milestones: ["tier_up"],
			helpful: { big_diff: { shownSinceTs: 100, dismissedUntilTs: 700 } },
		};
		writeState(dir, s);
		expect(readState(dir)).toEqual(s);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("missing directory reads as the empty default", () => {
	const dir = join(tmp(), "absent");
	expect(readState(dir)).toEqual(EMPTY);
});

test("corrupt JSON reads as the empty default, never throws", () => {
	const dir = tmp();
	try {
		writeFileSync(join(dir, "state.json"), "{ not valid json");
		expect(readState(dir)).toEqual(EMPTY);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("valid JSON of the wrong shape (array) reads as the empty default", () => {
	const dir = tmp();
	try {
		writeFileSync(join(dir, "state.json"), "[1,2,3]");
		expect(readState(dir)).toEqual(EMPTY);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("partial / wrong-typed fields are coerced field by field", () => {
	const dir = tmp();
	try {
		writeFileSync(
			join(dir, "state.json"),
			JSON.stringify({
				character: 42, // wrong type -> dropped
				pressureFired: ["a", 7, "b"], // non-strings filtered out
				milestones: "nope", // wrong type -> []
				helpful: {
					ok: { shownSinceTs: 1, dismissedUntilTs: 2 },
					bad: { shownSinceTs: "x" }, // incomplete -> dropped
				},
			}),
		);
		expect(readState(dir)).toEqual({
			pressureFired: ["a", "b"],
			milestones: [],
			helpful: { ok: { shownSinceTs: 1, dismissedUntilTs: 2 } },
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// A single session's render ticks can overlap: each tick reads state, spends the whole compose deriving
// the once-per-session `pressureFired` latch and the `milestones` set off that snapshot, then writes back
// at the end. A plain last-write-wins overwrite lets a later tick clobber a latch an earlier tick fired.
// The write must re-read under lock and union the set-like latches so neither is lost.
test("concurrent write unions latches instead of clobbering an earlier tick's", () => {
	const dir = tmp();
	try {
		// An earlier tick already latched milestone A + pressure X.
		writeState(dir, {
			character: "batman",
			pressureFired: ["X"],
			milestones: ["A"],
			helpful: {},
		});
		// A later tick derived milestone B off an older (empty) snapshot and writes now.
		writeState(dir, { character: "batman", pressureFired: [], milestones: ["B"], helpful: {} });
		const s = readState(dir);
		expect(new Set(s.milestones)).toEqual(new Set(["A", "B"]));
		expect(new Set(s.pressureFired)).toEqual(new Set(["X"]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// A dismissal (a non-zero `dismissedUntilTs` cooldown) is latch-like: a concurrent tick that recomputes the
// same tip as freshly "shown" must not roll back another tick's dismiss.
test("concurrent write preserves a helpful dismissal over a stale show", () => {
	const dir = tmp();
	try {
		writeState(dir, {
			pressureFired: [],
			milestones: [],
			helpful: { big_diff: { shownSinceTs: 0, dismissedUntilTs: 5000 } },
		});
		writeState(dir, {
			pressureFired: [],
			milestones: [],
			helpful: { big_diff: { shownSinceTs: 100, dismissedUntilTs: 0 } },
		});
		expect(readState(dir).helpful).toEqual({
			big_diff: { shownSinceTs: 0, dismissedUntilTs: 5000 },
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a write skipped under a held lock leaves the prior on-disk state intact, no throw", () => {
	const dir = tmp();
	const prior: SessionState = { pressureFired: ["X"], milestones: ["A"], helpful: {} };
	writeState(dir, prior);
	const lockPath = join(dir, "state.json.lock");
	openSync(lockPath, "wx"); // hold the lock as an overlapping writer would
	try {
		writeState(dir, { pressureFired: ["Y"], milestones: ["B"], helpful: {} }); // lock held -> skipped
		expect(readState(dir)).toEqual(prior);
	} finally {
		rmSync(lockPath, { force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});
