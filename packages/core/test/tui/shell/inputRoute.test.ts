import { expect, test } from "bun:test";

import {
	type InputRoute,
	type RouteContext,
	type RouteEvent,
	routeKey,
} from "../../../src/tui/shell";

const key = (input: string, flags: RouteEvent["key"] = {}): RouteEvent => ({ input, key: flags });

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
	editing: false,
	zone: "sidebar",
	overlay: "none",
	section: 0,
	...over,
});

const route = (c: Partial<RouteContext>, ev: RouteEvent): InputRoute => routeKey(ctx(c), ev);

test("an active edit owns every key, before any overlay or section", () => {
	expect(route({ editing: true }, key("q"))).toBe("editing");
	// even with an overlay nominally up, editing wins (it is only ever begun from a content field)
	expect(route({ editing: true, overlay: "save" }, key("y"))).toBe("editing");
});

test("the save-confirm overlay swallows everything", () => {
	expect(route({ overlay: "save" }, key("y"))).toBe("save");
	expect(route({ overlay: "save" }, key("q"))).toBe("save");
	expect(route({ overlay: "save" }, key("", { escape: true }))).toBe("save");
});

test("Enter in the Save section opens the confirm, before generic content nav", () => {
	expect(route({ section: 7, zone: "content" }, key("", { return: true }))).toBe("saveSection");
	// but the save overlay, if already open, still wins over saveSection
	expect(route({ section: 7, overlay: "save" }, key("", { return: true }))).toBe("save");
});

test("the find and currency overlays capture all their keys", () => {
	expect(route({ overlay: "find" }, key("s"))).toBe("find");
	expect(route({ overlay: "find" }, key("q"))).toBe("find");
	expect(route({ overlay: "currency" }, key("/"))).toBe("currency");
	expect(route({ overlay: "currency" }, key("s"))).toBe("currency");
});

test("the preview overlay keeps only its four controls; other keys fall through to global", () => {
	for (const c of [",", ".", "n", "w"])
		expect(route({ overlay: "preview" }, key(c))).toBe("preview");
	expect(route({ overlay: "preview" }, key("x"))).toBe("global"); // closes via the dispatcher
	expect(route({ overlay: "preview" }, key("p", { ctrl: true }))).toBe("global"); // ctrl+p closes
	expect(route({ overlay: "preview" }, key("n", { meta: true }))).toBe("global"); // an alt chord is not a control
	expect(route({ overlay: "preview" }, key("", { escape: true }))).toBe("global");
});

test("help and quit overlays have no dedicated handler, so their keys route to global", () => {
	expect(route({ overlay: "help" }, key("?"))).toBe("global");
	expect(route({ overlay: "quit" }, key("y"))).toBe("global");
});

test("the content-zone section handlers claim their own field-nav keys", () => {
	expect(route({ section: 0, zone: "content" }, key("j"))).toBe("character");
	expect(route({ section: 1, zone: "content" }, key("j"))).toBe("theme");
	expect(route({ section: 5, zone: "content" }, key("j"))).toBe("statusline");
	expect(route({ section: 6, zone: "content" }, key("i"))).toBe("stats");
});

test("Statistics claims the arrows and the ijkl scroll cluster; other keys fall through to content", () => {
	expect(route({ section: 6, zone: "content" }, key("", { leftArrow: true }))).toBe("stats"); // axis
	expect(route({ section: 6, zone: "content" }, key("l"))).toBe("stats"); // scroll right
	expect(route({ section: 6, zone: "content" }, key("i"))).toBe("stats"); // scroll up
	// h and w are no longer Statistics keys; a/return are plain field-nav -> generic content handler
	expect(route({ section: 6, zone: "content" }, key("h"))).toBe("content");
	expect(route({ section: 6, zone: "content" }, key("w"))).toBe("content");
	expect(route({ section: 6, zone: "content" }, key("a"))).toBe("content");
	expect(route({ section: 6, zone: "content" }, key("", { return: true }))).toBe("content");
});

test("a section handler only claims keys in its own content zone, never the sidebar", () => {
	expect(route({ section: 0, zone: "sidebar" }, key("j"))).toBe("global");
	expect(route({ section: 1, zone: "sidebar" }, key("j"))).toBe("global");
});

test("space in the Save section toggles the target, in any zone", () => {
	expect(route({ section: 7, zone: "content" }, key(" "))).toBe("saveToggle");
	expect(route({ section: 7, zone: "sidebar" }, key(" "))).toBe("saveToggle");
	// but a non-space key in Save content is generic content nav, not a toggle
	expect(route({ section: 7, zone: "content" }, key("j"))).toBe("content");
});

test("form sections route field-nav keys to the generic content handler", () => {
	for (const section of [2, 3, 4]) {
		expect(route({ section, zone: "content" }, key("j"))).toBe("content");
		expect(route({ section, zone: "content" }, key("", { return: true }))).toBe("content");
	}
});

test("a non-field-nav key with nothing else to claim it routes to global", () => {
	expect(route({ section: 2, zone: "content" }, key("q"))).toBe("global");
	expect(route({ section: 2, zone: "content" }, key("/"))).toBe("global");
	expect(route({}, key("q"))).toBe("global"); // sidebar, quit
});
