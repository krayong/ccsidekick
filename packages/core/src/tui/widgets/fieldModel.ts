// The field model for form sections. A section is a pure `(draft) => FieldSpec[]`; each spec knows its display
// value and how to transform the draft. `applyContentKey` is the content-zone half of the input sink: it moves
// the cursor and applies toggle/cycle edits, and signals when a text/number field should begin editing (the
// dashboard then captures keystrokes into a buffer). Text editing itself is not handled here.

import type { Config } from "../../sources";
import type { KeyEvent } from "../nav";

type FieldKind = "toggle" | "cycle" | "text" | "number";

export interface FieldSpec {
	readonly id: string;
	readonly label: string;
	readonly kind: FieldKind;
	/** The display value shown on the row. */
	readonly value: string;
	/** The seed buffer for editing a text/number field (its current raw value). */
	readonly raw?: string;
	readonly toggle?: (d: Config) => Config;
	readonly next?: (d: Config) => Config;
	readonly commit?: (d: Config, raw: string) => Config;
}

interface ContentResult {
	readonly cursor: number;
	readonly editing: boolean;
	readonly draft: Config;
	readonly exit: boolean;
	readonly changed: boolean;
}

/** Keys the content zone consumes for field navigation and activation (not Escape or Tab, which the dispatcher owns). */
export function isFieldNavKey(ev: KeyEvent): boolean {
	const { input, key } = ev;
	if (key.ctrl === true) return false; // a ctrl chord (e.g. Ctrl+S save) is never a field-nav key
	return (
		key.upArrow === true ||
		key.downArrow === true ||
		key.leftArrow === true ||
		key.rightArrow === true ||
		key.return === true ||
		["j", "k", "w", "s", "a", "d", "h", "l", " "].includes(input)
	);
}

/** Enter/space on a field: toggle it, cycle a cycle field forward, begin editing a text/number field, or nothing. */
function activateField(base: ContentResult, field: FieldSpec, draft: Config): ContentResult {
	if (field.toggle) return { ...base, draft: field.toggle(draft), changed: true };
	if (field.next) return { ...base, draft: field.next(draft), changed: true };
	if (field.kind === "text" || field.kind === "number") return { ...base, editing: true };
	return base;
}

export function applyContentKey(
	draft: Config,
	fields: readonly FieldSpec[],
	cursor: number,
	ev: KeyEvent,
): ContentResult {
	const { input, key } = ev;
	const n = fields.length;
	const idx = n === 0 ? 0 : Math.min(Math.max(0, cursor), n - 1);
	const base: ContentResult = { cursor: idx, editing: false, draft, exit: false, changed: false };
	if (n === 0) return base; // an empty section (Character/Stats) has no fields to move through

	const up = key.upArrow === true || input === "k" || input === "w";
	const down = key.downArrow === true || input === "j" || input === "s";
	const left = key.leftArrow === true || input === "h" || input === "a";
	if (up) return { ...base, cursor: Math.max(0, idx - 1) };
	if (down) return { ...base, cursor: Math.min(n - 1, idx + 1) };
	if (left) return { ...base, exit: true }; // a/left from a form's single column returns to the sidebar
	const field = fields[idx];
	if (field === undefined) return base;
	if (input === " " || key.return === true) return activateField(base, field, draft);
	return base; // right/d is inert in a single-column form; a cycle field advances only on Enter
}
