import { expect, test } from "bun:test";

import { dispatchKey, type NavState } from "../../../src/tui/nav";

const quitState: NavState = { section: 0, zone: "sidebar", overlay: "quit", stack: [] };
const ev = (input: string, over: Partial<{ escape: boolean }> = {}) => ({
	input,
	key: { escape: over.escape ?? false },
});

test("y in the quit overlay discards and quits", () => {
	const { state, action } = dispatchKey(quitState, ev("y"));
	expect(action.type).toBe("quit");
	expect(state.overlay).toBe("none");
});

test("n in the quit overlay goes back to config without quitting", () => {
	const { state, action } = dispatchKey(quitState, ev("n"));
	expect(action.type).toBe("none");
	expect(state.overlay).toBe("none");
});

test("escape in the quit overlay goes back to config without quitting", () => {
	const { state, action } = dispatchKey(quitState, ev("", { escape: true }));
	expect(action.type).toBe("none");
	expect(state.overlay).toBe("none");
});
