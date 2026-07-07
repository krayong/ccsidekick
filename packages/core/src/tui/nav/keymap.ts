// The single input sink. Rather than many co-active useInput hooks, one reducer reads the focus zone and overlay
// from NavState and routes each key to a state transition plus an optional action. Text-capturing overlays
// (find) swallow every key except Escape so their own input field consumes the character. This is pure and
// fully testable without Ink.

export const SECTIONS = [
	"Character",
	"Theme",
	"Comments",
	"Network",
	"Statusline",
	"Statistics",
	"Save",
] as const;

export type SectionName = (typeof SECTIONS)[number];

export type Zone = "sidebar" | "content";
export type Overlay = "none" | "find" | "help" | "save" | "quit" | "currency" | "preview";

export interface NavState {
	readonly section: number;
	readonly zone: Zone;
	readonly overlay: Overlay;
	readonly stack: readonly number[];
}

export const INITIAL_NAV: NavState = { section: 0, zone: "sidebar", overlay: "none", stack: [] };

export interface KeyEvent {
	readonly input: string;
	readonly key: {
		readonly upArrow?: boolean;
		readonly downArrow?: boolean;
		readonly leftArrow?: boolean;
		readonly rightArrow?: boolean;
		readonly tab?: boolean;
		readonly escape?: boolean;
		readonly return?: boolean;
		readonly ctrl?: boolean;
	};
}

type NavAction =
	| { readonly type: "none" }
	| { readonly type: "help" }
	| { readonly type: "quit" }
	| { readonly type: "open" };

export interface Dispatch {
	readonly state: NavState;
	readonly action: NavAction;
}

const NONE: NavAction = { type: "none" };
const stay = (state: NavState): Dispatch => ({ state, action: NONE });

// Quitting at the top level is guarded by unsaved edits: dirty opens the "quit" overlay instead of
// firing the quit action outright, so the guard is a pure function of state, key, and dirtiness.
function requestQuit(state: NavState, dirty: boolean): Dispatch {
	return dirty ? stay({ ...state, overlay: "quit" }) : { state, action: { type: "quit" } };
}

// Swallow every key but Escape; the Dashboard's own capture handler owns the typed query, the list
// cursor, and Enter (find's jump, save's y/↵ confirm, currency's commit) while the overlay is up.
const closeOnEscape = (state: NavState, key: KeyEvent["key"]): Dispatch =>
	key.escape === true ? stay({ ...state, overlay: "none" }) : stay(state);

// Text-capturing overlays swallow everything but Escape; their input field consumes the key.
function dispatchOverlayKey(state: NavState, ev: KeyEvent): Dispatch | null {
	const { input, key } = ev;
	if (state.overlay === "find" || state.overlay === "save" || state.overlay === "currency")
		return closeOnEscape(state, key);
	if (state.overlay === "help") {
		return key.escape === true || input === "?" || input === "q" ?
				stay({ ...state, overlay: "none" })
			:	stay(state);
	}
	if (state.overlay === "quit") {
		if (input === "y")
			return { state: { ...state, overlay: "none" }, action: { type: "quit" } };
		if (input === "n" || key.escape === true) return stay({ ...state, overlay: "none" });
		return stay(state);
	}
	if (state.overlay === "preview") {
		return (key.ctrl === true && input === "p") || key.escape === true ?
				stay({ ...state, overlay: "none" })
			:	stay(state);
	}
	return null;
}

function dispatchEscape(state: NavState, dirty: boolean): Dispatch {
	if (state.stack.length > 0) return stay({ ...state, stack: state.stack.slice(0, -1) });
	if (state.zone === "content") return stay({ ...state, zone: "sidebar" });
	return requestQuit(state, dirty);
}

function dispatchCommand(state: NavState, ev: KeyEvent, dirty: boolean): Dispatch | null {
	const { input, key } = ev;
	if (key.ctrl === true && input === "s") return stay({ ...state, overlay: "save" });
	if (input === "?") return { state: { ...state, overlay: "help" }, action: { type: "help" } };
	if (input === "q" && state.zone === "sidebar") return requestQuit(state, dirty);
	if (input === "/") return stay({ ...state, overlay: "find" });
	if (key.ctrl === true && input === "p") return stay({ ...state, overlay: "preview" });
	if (key.tab === true) {
		return stay({ ...state, zone: state.zone === "sidebar" ? "content" : "sidebar" });
	}
	if (/^[1-7]$/.test(input)) {
		return stay({ ...state, section: Number(input) - 1, zone: "sidebar" });
	}
	return null;
}

function dispatchNavigation(state: NavState, ev: KeyEvent): Dispatch {
	const { input, key } = ev;
	const up = key.upArrow === true || input === "k" || input === "w";
	const down = key.downArrow === true || input === "j" || input === "s";
	const right = key.rightArrow === true || input === "l" || input === "d";
	if (state.zone === "sidebar" && (up || down)) {
		const section = Math.min(SECTIONS.length - 1, Math.max(0, state.section + (down ? 1 : -1)));
		return stay({ ...state, section });
	}
	if (state.zone === "sidebar" && (key.return === true || right)) {
		return { state: { ...state, zone: "content" }, action: { type: "open" } };
	}
	return stay(state);
}

export function dispatchKey(state: NavState, ev: KeyEvent, dirty = false): Dispatch {
	const overlay = dispatchOverlayKey(state, ev);
	if (overlay !== null) return overlay;

	if (ev.key.escape === true) return dispatchEscape(state, dirty);

	const command = dispatchCommand(state, ev, dirty);
	if (command !== null) return command;

	return dispatchNavigation(state, ev);
}

interface Hint {
	readonly key: string;
	readonly label: string;
}

export function hintsFor(state: NavState): readonly Hint[] {
	if (state.overlay === "find")
		return [
			{ key: "esc", label: "close" },
			{ key: "↵", label: "jump" },
		];
	if (state.overlay === "help") return [{ key: "esc", label: "close" }];
	if (state.overlay === "save")
		return [
			{ key: "y ↵", label: "install" },
			{ key: "esc", label: "cancel" },
		];
	if (state.overlay === "quit")
		return [
			{ key: "y", label: "quit" },
			{ key: "n/esc", label: "back" },
		];
	if (state.overlay === "currency")
		return [
			{ key: "esc", label: "close" },
			{ key: "↵", label: "select" },
		];
	if (state.overlay === "preview")
		return [
			{ key: ", .", label: "scenario" },
			{ key: "n", label: "color" },
			{ key: "w", label: "width" },
			{ key: "esc", label: "close" },
		];
	if (state.zone === "sidebar") {
		return [
			{ key: "wasd", label: "move" },
			{ key: "↵", label: "open" },
			{ key: "/", label: "find" },
			{ key: "^p", label: "preview" },
			{ key: "^s", label: "save" },
			{ key: "^w", label: "wizard" },
			{ key: "?", label: "help" },
			{ key: "q", label: "quit" },
		];
	}
	return [
		{ key: "tab", label: "sidebar" },
		{ key: "esc", label: "back" },
		{ key: "/", label: "find" },
		{ key: "^p", label: "preview" },
		{ key: "^s", label: "save" },
		{ key: "^w", label: "wizard" },
		{ key: "?", label: "help" },
		{ key: "q", label: "quit" },
	];
}
