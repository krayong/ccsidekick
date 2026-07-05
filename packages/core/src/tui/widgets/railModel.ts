// The pure column/cursor reducer for the three-column Rail. focus 0=category, 1=list, 2=detail. w/s move the
// focused column's cursor; a/left steps focus toward the sidebar (and exits at the category column); d/right
// steps focus toward the detail; Enter signals `act`. Left/right never change a value (that is Enter's job).

import type { KeyEvent } from "../nav";

export interface RailState {
	readonly focus: 0 | 1 | 2;
	readonly catCursor: number;
	readonly itemCursor: number;
}

interface RailResult {
	readonly state: RailState;
	readonly exit: boolean;
	readonly act: boolean;
}

const clampFocus = (n: number): 0 | 1 | 2 =>
	n < 0 ? 0
	: n > 2 ? 2
	: (n as 0 | 1 | 2);

// w/s (up/down) move only the focused column's own cursor. A category change resets the item cursor so a
// shorter list is never indexed out of range; the detail column has no cursor of its own.
function moveCursor(state: RailState, delta: number, catLen: number, itemLen: number): RailState {
	if (state.focus === 0) {
		const catCursor = Math.min(Math.max(0, catLen - 1), Math.max(0, state.catCursor + delta));
		const itemCursor = catCursor === state.catCursor ? state.itemCursor : 0;
		return { ...state, catCursor, itemCursor };
	}
	if (state.focus === 1) {
		const itemCursor = Math.min(
			Math.max(0, itemLen - 1),
			Math.max(0, state.itemCursor + delta),
		);
		return { ...state, itemCursor };
	}
	return state;
}

export function applyRailKey(
	state: RailState,
	ev: KeyEvent,
	catLen: number,
	itemLen: number,
): RailResult {
	const { input, key } = ev;
	const still: RailResult = { state, exit: false, act: false };
	const up = key.upArrow === true || input === "k" || input === "w";
	const down = key.downArrow === true || input === "j" || input === "s";
	const left = key.leftArrow === true || input === "h" || input === "a";
	const right = key.rightArrow === true || input === "l" || input === "d";

	if (left) {
		if (state.focus === 0) return { state, exit: true, act: false };
		return { state: { ...state, focus: clampFocus(state.focus - 1) }, exit: false, act: false };
	}
	if (right) {
		if (state.focus === 2) return { state, exit: false, act: false };
		return { state: { ...state, focus: clampFocus(state.focus + 1) }, exit: false, act: false };
	}
	if (up || down)
		return {
			state: moveCursor(state, down ? 1 : -1, catLen, itemLen),
			exit: false,
			act: false,
		};
	if (key.return === true || input === " ") {
		// Enter on the category column drills into the list; Enter deeper acts (select/toggle/install).
		if (state.focus === 0) return { state: { ...state, focus: 1 }, exit: false, act: false };
		return { state, exit: false, act: true };
	}
	return still;
}
