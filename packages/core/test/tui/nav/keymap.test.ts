import { expect, test } from "bun:test";

import {
	type KeyEvent,
	type NavState,
	INITIAL_NAV,
	SECTIONS,
	dispatchKey,
	hintsFor,
} from "../../../src/tui/nav";

const key = (input: string, flags: KeyEvent["key"] = {}): KeyEvent => ({ input, key: flags });

test("sections are in the new order", () => {
	expect([...SECTIONS]).toEqual([
		"Character",
		"Theme",
		"Comments",
		"Network",
		"Statusline",
		"Statistics",
		"Save",
	]);
});

test("Tab toggles focus between sidebar and content", () => {
	const a = dispatchKey(INITIAL_NAV, key("", { tab: true }));
	expect(a.state.zone).toBe("content");
	const b = dispatchKey(a.state, key("", { tab: true }));
	expect(b.state.zone).toBe("sidebar");
});

test("digits 1..7 jump to a section and focus the sidebar", () => {
	const from: NavState = { ...INITIAL_NAV, zone: "content" };
	const r = dispatchKey(from, key("3"));
	expect(r.state.section).toBe(2);
	expect(r.state.zone).toBe("sidebar");
});

test("arrow/j-k in the sidebar move the section within bounds", () => {
	const down = dispatchKey(INITIAL_NAV, key("", { downArrow: true }));
	expect(down.state.section).toBe(1);
	const clampedTop = dispatchKey(INITIAL_NAV, key("k"));
	expect(clampedTop.state.section).toBe(0);
	const last: NavState = { ...INITIAL_NAV, section: SECTIONS.length - 1 };
	const clampedBottom = dispatchKey(last, key("j"));
	expect(clampedBottom.state.section).toBe(SECTIONS.length - 1);
});

test("hjkl mirror the arrow keys: l drills in like right, j moves like down", () => {
	expect(dispatchKey(INITIAL_NAV, key("l")).state.zone).toBe("content");
	expect(dispatchKey(INITIAL_NAV, key("", { rightArrow: true })).state.zone).toBe("content");
	expect(dispatchKey(INITIAL_NAV, key("j")).state.section).toBe(
		dispatchKey(INITIAL_NAV, key("", { downArrow: true })).state.section,
	);
});

test("Enter/right in the sidebar drills into content; Esc from content returns", () => {
	const opened = dispatchKey(INITIAL_NAV, key("", { return: true }));
	expect(opened.state.zone).toBe("content");
	const back = dispatchKey(opened.state, key("", { escape: true }));
	expect(back.state.zone).toBe("sidebar");
});

test("/ opens the find overlay; it swallows s and q", () => {
	const found = dispatchKey(INITIAL_NAV, key("/"));
	expect(found.state.overlay).toBe("find");
	const typed = dispatchKey(found.state, key("s"));
	expect(typed.action.type).toBe("none");
	expect(typed.state.overlay).toBe("find");
	const stillTyping = dispatchKey(found.state, key("q"));
	expect(stillTyping.action.type).toBe("none");
	const closed = dispatchKey(found.state, key("", { escape: true }));
	expect(closed.state.overlay).toBe("none");
});

test("global shortcuts fire their actions when no overlay is capturing", () => {
	expect(dispatchKey(INITIAL_NAV, key("q")).action.type).toBe("quit");
	const help = dispatchKey(INITIAL_NAV, key("?"));
	expect(help.action.type).toBe("help");
	expect(help.state.overlay).toBe("help");
});

test("w and s move sections in the sidebar", () => {
	expect(dispatchKey(INITIAL_NAV, key("s")).state.section).toBe(1);
	expect(dispatchKey({ ...INITIAL_NAV, section: 1 }, key("w")).state.section).toBe(0);
});

test("d, l and → open the content zone from the sidebar", () => {
	for (const e of [key("d"), key("l"), key("", { rightArrow: true })]) {
		const r = dispatchKey(INITIAL_NAV, e);
		expect(r.state.zone).toBe("content");
		expect(r.action.type).toBe("open");
	}
});

test("Ctrl+S opens the save-confirm overlay; plain s does not install", () => {
	expect(dispatchKey(INITIAL_NAV, key("s", { ctrl: true })).state.overlay).toBe("save");
	expect(dispatchKey(INITIAL_NAV, key("s")).action.type).toBe("none");
});

test("the save overlay swallows global keys; esc closes it", () => {
	const saving = { ...INITIAL_NAV, overlay: "save" as const };
	expect(dispatchKey(saving, key("q")).state.overlay).toBe("save"); // q does not quit behind the modal
	expect(dispatchKey(saving, key("3")).state.overlay).toBe("save"); // digit jump does not fire
	expect(dispatchKey(saving, key("", { escape: true })).state.overlay).toBe("none"); // esc cancels
});

test("the currency overlay swallows global keys; esc closes it", () => {
	const picking = { ...INITIAL_NAV, overlay: "currency" as const };
	expect(dispatchKey(picking, key("/")).state.overlay).toBe("currency"); // / does not open Find
	expect(dispatchKey(picking, key("s")).action.type).toBe("none"); // s does not save
	expect(dispatchKey(picking, key("q")).state.overlay).toBe("currency"); // q does not quit
	expect(dispatchKey(picking, key("", { escape: true })).state.overlay).toBe("none"); // esc closes
});

test("hintsFor advertises close and select for the currency overlay", () => {
	const picking: NavState = { ...INITIAL_NAV, overlay: "currency" };
	const hints = hintsFor(picking);
	expect(hints.some((h) => h.label === "close")).toBe(true);
	expect(hints.some((h) => h.label === "select")).toBe(true);
});

test("hintsFor reflects the active zone and overlay", () => {
	expect(hintsFor(INITIAL_NAV).some((h) => h.label === "move")).toBe(true);
	const find: NavState = { ...INITIAL_NAV, overlay: "find" };
	expect(hintsFor(find).some((h) => h.label === "close")).toBe(true);
});

test("footer hints advertise Ctrl+S save, not plain s", () => {
	const keys = hintsFor(INITIAL_NAV).map((h) => h.key);
	expect(keys).toContain("^s");
	expect(keys).not.toContain("s");
});

test("both zones surface the quit hint, since q quits from either", () => {
	const content: NavState = { ...INITIAL_NAV, zone: "content" };
	expect(hintsFor(INITIAL_NAV).some((h) => h.key === "q")).toBe(true);
	expect(hintsFor(content).some((h) => h.key === "q")).toBe(true);
});

test("both zones surface the preview hint", () => {
	const content: NavState = { ...INITIAL_NAV, zone: "content" };
	expect(hintsFor(INITIAL_NAV)).toContainEqual({ key: "^p", label: "preview" });
	expect(hintsFor(content)).toContainEqual({ key: "^p", label: "preview" });
});

test("a clean top-level quit fires quit immediately", () => {
	expect(dispatchKey(INITIAL_NAV, key("q"), false).action.type).toBe("quit");
});

test("a dirty top-level quit opens the guard instead of quitting", () => {
	const r = dispatchKey(INITIAL_NAV, key("q"), true);
	expect(r.state.overlay).toBe("quit");
	expect(r.action.type).toBe("none");
});

test("in the quit guard, y quits (discards), n/esc backs out, q is inert", () => {
	const guard = { ...INITIAL_NAV, overlay: "quit" as const };
	expect(dispatchKey(guard, key("y")).action.type).toBe("quit");
	expect(dispatchKey(guard, key("n")).action.type).toBe("none");
	expect(dispatchKey(guard, key("", { escape: true })).action.type).toBe("none");
	expect(dispatchKey(guard, key("q")).action.type).toBe("none"); // q no longer discards
});

test("q in the content zone is inert (quit is top-level only)", () => {
	const inContent = { ...INITIAL_NAV, zone: "content" as const };
	expect(dispatchKey(inContent, key("q")).action.type).toBe("none");
});

test("a clean top-level esc fires quit immediately", () => {
	expect(dispatchKey(INITIAL_NAV, key("", { escape: true }), false).action.type).toBe("quit");
});

test("a dirty top-level esc opens the guard instead of quitting", () => {
	const r = dispatchKey(INITIAL_NAV, key("", { escape: true }), true);
	expect(r.state.overlay).toBe("quit");
	expect(r.action.type).toBe("none");
});

test("esc in the content zone steps back to the sidebar and does not quit", () => {
	const inContent = { ...INITIAL_NAV, zone: "content" as const };
	const r = dispatchKey(inContent, key("", { escape: true }));
	expect(r.state.zone).toBe("sidebar");
	expect(r.action.type).toBe("none");
});

test("ctrl+p opens the preview overlay; it swallows unrelated keys", () => {
	const opened = dispatchKey(INITIAL_NAV, key("p", { ctrl: true }));
	expect(opened.state.overlay).toBe("preview");
	const digit = dispatchKey(opened.state, key("3"));
	expect(digit.action.type).toBe("none");
	expect(digit.state.overlay).toBe("preview");
	const letter = dispatchKey(opened.state, key("x"));
	expect(letter.action.type).toBe("none");
	expect(letter.state.overlay).toBe("preview");
});

test("the preview overlay closes on ctrl+p or esc", () => {
	const preview = { ...INITIAL_NAV, overlay: "preview" as const };
	const closedByP = dispatchKey(preview, key("p", { ctrl: true }));
	expect(closedByP.state.overlay).toBe("none");
	const closedByEsc = dispatchKey(preview, key("", { escape: true }));
	expect(closedByEsc.state.overlay).toBe("none");
});

test("hintsFor advertises preview controls: scenario, color, width, and close", () => {
	const preview: NavState = { ...INITIAL_NAV, overlay: "preview" };
	const hints = hintsFor(preview);
	expect(hints.some((h) => h.label === "scenario")).toBe(true);
	expect(hints.some((h) => h.label === "color")).toBe(true);
	expect(hints.some((h) => h.label === "width")).toBe(true);
	expect(hints.some((h) => h.label === "close")).toBe(true);
});

test("the preview width hint key is w, not m", () => {
	const preview: NavState = { ...INITIAL_NAV, overlay: "preview" };
	const hints = hintsFor(preview);
	expect(hints).toContainEqual({ key: "w", label: "width" });
	expect(hints.some((h) => h.key === "m")).toBe(false);
});
