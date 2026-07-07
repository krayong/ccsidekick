import { expect, test } from "bun:test";

import { DEFAULT_CONFIG, loadConfig } from "../../../src/sources";
import type { KeyEvent } from "../../../src/tui/nav";
import { commentsFields } from "../../../src/tui/sections";
import { type FieldSpec, applyContentKey, isFieldNavKey } from "../../../src/tui/widgets";

const ev = (input: string, key: KeyEvent["key"] = {}): KeyEvent => ({ input, key });

const fields: readonly FieldSpec[] = [
	{
		id: "enabled",
		label: "Enabled",
		kind: "toggle",
		value: "on",
		toggle: (d) => ({ ...d, comments: { ...d.comments, character: !d.comments.character } }),
	},
	{
		id: "sev",
		label: "Min severity",
		kind: "cycle",
		value: "low",
		next: (d) => ({ ...d, comments: { ...d.comments, min_severity: "medium" } }),
	},
	{
		id: "cur",
		label: "Currency",
		kind: "text",
		value: "INR",
		raw: "INR",
		commit: (d, raw) => ({
			...d,
			statusline: { ...d.statusline, currency: raw.toUpperCase() },
		}),
	},
];

test("up/down move the cursor within bounds; j/k mirror them", () => {
	expect(applyContentKey(DEFAULT_CONFIG, fields, 0, ev("", { downArrow: true })).cursor).toBe(1);
	expect(applyContentKey(DEFAULT_CONFIG, fields, 0, ev("k")).cursor).toBe(0);
	expect(applyContentKey(DEFAULT_CONFIG, fields, 2, ev("j")).cursor).toBe(2);
});

test("space toggles a toggle field and marks the draft changed", () => {
	const r = applyContentKey(DEFAULT_CONFIG, fields, 0, ev(" "));
	expect(r.changed).toBe(true);
	expect(r.draft.comments.character).toBe(!DEFAULT_CONFIG.comments.character);
	expect(r.editing).toBe(false);
});

test("Enter on a text field begins editing without changing the draft", () => {
	const r = applyContentKey(DEFAULT_CONFIG, fields, 2, ev("", { return: true }));
	expect(r.editing).toBe(true);
	expect(r.changed).toBe(false);
});

test("isFieldNavKey covers motion and activation, not escape or tab", () => {
	expect(isFieldNavKey(ev("", { downArrow: true }))).toBe(true);
	expect(isFieldNavKey(ev("j"))).toBe(true);
	expect(isFieldNavKey(ev(" "))).toBe(true);
	expect(isFieldNavKey(ev("", { return: true }))).toBe(true);
	expect(isFieldNavKey(ev("", { escape: true }))).toBe(false);
	expect(isFieldNavKey(ev("", { tab: true }))).toBe(false);
	expect(isFieldNavKey(ev("x"))).toBe(false);
	expect(isFieldNavKey(ev("s"))).toBe(true);
	expect(isFieldNavKey(ev("s", { ctrl: true }))).toBe(false);
});

test("enter cycles a cycle field forward; left/right never change a value", () => {
	const fields = commentsFields(loadConfig("")); // min_severity is a cycle field
	const i = fields.findIndex((f) => f.kind === "cycle");
	const entered = applyContentKey(loadConfig(""), fields, i, ev("", { return: true }));
	expect(entered.changed).toBe(true); // enter advanced the value
	expect(applyContentKey(loadConfig(""), fields, i, ev("", { leftArrow: true })).changed).toBe(
		false,
	);
	expect(applyContentKey(loadConfig(""), fields, i, ev("", { rightArrow: true })).changed).toBe(
		false,
	);
});

test("a/left from a form returns to the sidebar; w/s move the cursor; ctrl+s is not consumed", () => {
	const fields = commentsFields(loadConfig(""));
	expect(applyContentKey(loadConfig(""), fields, 0, ev("a")).exit).toBe(true);
	expect(applyContentKey(loadConfig(""), fields, 0, ev("", { leftArrow: true })).exit).toBe(true);
	expect(applyContentKey(loadConfig(""), fields, 0, ev("s")).cursor).toBe(1);
	expect(applyContentKey(loadConfig(""), fields, 1, ev("w")).cursor).toBe(0);
	expect(isFieldNavKey(ev("s", { ctrl: true }))).toBe(false); // ctrl+s stays a global save chord
});
