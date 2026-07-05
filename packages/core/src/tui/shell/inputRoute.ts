// The Dashboard's input routing, as a pure function. The single useInput feeds every keystroke here first:
// given the current focus (the editing flag plus the nav zone/overlay/section) and the key, `routeKey` names
// the one handler that owns the key. Ownership used to live in an ordered twelve-branch if-chain whose
// correctness depended on call order and on each handler's own guard clause; naming it as data makes the
// routing testable without Ink and immune to reordering. The named handler then runs its effect unconditionally.

import type { Overlay, Zone } from "../nav";
import { isFieldNavKey } from "../widgets";

// The four preview-overlay controls: cycle scenario (, .), toggle color (n), toggle width (w). Any other key
// (or a ctrl/meta chord) falls through the preview overlay to the global dispatcher, which closes it.
const PREVIEW_KEYS = new Set([",", ".", "n", "w"]);

export type InputRoute =
	| "editing"
	| "save"
	| "saveSection"
	| "find"
	| "currency"
	| "preview"
	| "character"
	| "theme"
	| "stats"
	| "statusline"
	| "saveToggle"
	| "content"
	| "global";

export interface RouteContext {
	readonly editing: boolean;
	readonly zone: Zone;
	readonly overlay: Overlay;
	readonly section: number;
}

// The key shape the router reads: the nav KeyEvent flags (arrows/return/ctrl, consumed by isFieldNavKey) plus
// `meta`, so an alt chord in the preview overlay falls through like a ctrl chord does.
export interface RouteEvent {
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
		readonly meta?: boolean;
	};
}

// The Statistics section consumes the arrow keys (axis focus + change) and the ijkl scroll cluster; every other
// field-nav key falls through to the content handler. Kept in sync with handleStatsKey's branches.
function isStatsKey(ev: RouteEvent): boolean {
	const { input, key } = ev;
	return (
		key.leftArrow === true ||
		key.rightArrow === true ||
		key.upArrow === true ||
		key.downArrow === true ||
		input === "i" ||
		input === "j" ||
		input === "k" ||
		input === "l"
	);
}

// Overlays capture before any section or global routing. The save-confirm modal swallows everything; find and
// currency run their own text capture; preview keeps only its four controls (else falls through to close). The
// Save section's Enter opens the confirm ahead of the generic content handler. Returns null when no overlay
// (nor the Save-Enter special case) claims the key, so section/global routing takes over.
function overlayRoute(overlay: Overlay, section: number, ev: RouteEvent): InputRoute | null {
	const { input, key } = ev;
	if (overlay === "save") return "save";
	if (section === 7 && overlay === "none" && key.return === true) return "saveSection";
	if (overlay === "find") return "find";
	if (overlay === "currency") return "currency";
	if (overlay === "preview")
		return key.ctrl !== true && key.meta !== true && PREVIEW_KEYS.has(input) ?
				"preview"
			:	"global";
	return null;
}

// The section-specific rail/tab handlers, each gated to its own section (caller guarantees overlay none, zone
// content). A field-nav key the section handler declines (a non-tab key in Statistics) returns null so it
// falls through to the generic content handler.
function sectionRoute(section: number, ev: RouteEvent): InputRoute | null {
	if (section === 0 && isFieldNavKey(ev)) return "character";
	if (section === 1 && isFieldNavKey(ev)) return "theme";
	if (section === 6 && isStatsKey(ev)) return "stats";
	if (section === 5 && isFieldNavKey(ev)) return "statusline";
	return null;
}

/** Name the handler that owns a keystroke, in the same priority order the old useInput if-chain applied. */
export function routeKey(ctx: RouteContext, ev: RouteEvent): InputRoute {
	const { editing, zone, overlay, section } = ctx;

	// A text/number field owns the keyboard first, so a keystroke never leaks to a global shortcut.
	if (editing) return "editing";

	const overlayR = overlayRoute(overlay, section, ev);
	if (overlayR !== null) return overlayR;

	if (overlay === "none" && zone === "content") {
		const sectionR = sectionRoute(section, ev);
		if (sectionR !== null) return sectionR;
	}

	// Space in the Save section toggles the project target (no zone gate: it is the section's only action).
	if (section === 7 && overlay === "none" && ev.input === " ") return "saveToggle";

	// Generic content-zone field navigation for the form sections (and inert keys in the empty ones).
	if (overlay === "none" && zone === "content" && isFieldNavKey(ev)) return "content";

	return "global";
}
