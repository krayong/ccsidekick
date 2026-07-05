import { expect, test } from "bun:test";

import type { Event, Stack } from "../domain";
import type { MarkerSet } from "../sources";

import { deriveStacks, pickStack } from "./stack";

const markers = (...stacks: Stack[]): MarkerSet => ({ stacks: new Set(stacks) });

const ev = (stack: Event["stack"]): Event =>
	stack !== undefined ?
		{ ts: 0, category: "build_pass", stack }
	:	{ ts: 0, category: "build_pass" };

test("deriveStacks unions marker stacks with event stack tags", () => {
	const set = deriveStacks(markers("web", "docker"), [ev("rust"), ev(undefined), ev("web")]);
	expect([...set].sort()).toEqual(["docker", "rust", "web"]);
});

test("pickStack: a fresh event stack wins over the set", () => {
	expect(pickStack(new Set(["web", "docker"]), "rust")).toBe("rust");
});

test("pickStack: no fresh tag ⇒ authoring priority (STACKS order) wins", () => {
	// web (1) precedes docker (5) in the prevalence ranking
	expect(pickStack(new Set(["docker", "web"]))).toBe("web");
	// python (2) precedes rust (12)
	expect(pickStack(new Set(["rust", "python"]))).toBe("python");
});

test("pickStack: empty set ⇒ null", () => {
	expect(pickStack(new Set())).toBeNull();
});
