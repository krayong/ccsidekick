import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { readMarkers } from "./markers";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "ccsk-mk-"));
}

test("exact-name markers map to their stacks", () => {
	const dir = tmp();
	try {
		writeFileSync(join(dir, "Cargo.toml"), "");
		expect([...readMarkers(dir).stacks]).toEqual(["rust"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("multiple markers union all matching keys (package.json + tsconfig.json)", () => {
	const dir = tmp();
	try {
		writeFileSync(join(dir, "package.json"), "{}");
		writeFileSync(join(dir, "tsconfig.json"), "{}");
		const s = readMarkers(dir).stacks;
		expect(s.has("web")).toBe(true);
		expect(s.has("node")).toBe(true);
		expect(s.size).toBe(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("glob-suffix markers map to their stacks", () => {
	const dir = tmp();
	try {
		writeFileSync(join(dir, "main.go"), "");
		writeFileSync(join(dir, "infra.tf"), "");
		writeFileSync(join(dir, "q.sql"), "");
		const s = readMarkers(dir).stacks;
		expect(s.has("go")).toBe(true);
		expect(s.has("terraform")).toBe(true);
		expect(s.has("sql")).toBe(true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ancestor walk finds markers above cwd, stops at repo root (.git)", () => {
	const root = tmp();
	try {
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, "go.mod"), "module x");
		const sub = join(root, "pkg", "deep");
		mkdirSync(sub, { recursive: true });
		writeFileSync(join(sub, "Cargo.toml"), ""); // local marker
		const s = readMarkers(sub).stacks;
		expect(s.has("rust")).toBe(true); // from cwd
		expect(s.has("go")).toBe(true); // from ancestor repo root
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("never throws on a missing directory; keeps walking to repo root", () => {
	const root = tmp();
	try {
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, "go.mod"), "module x");
		// "ghost" does not exist: the unreadable leaf must not throw, and the walk reaches the repo root.
		const s = readMarkers(join(root, "ghost")).stacks;
		expect(s.has("go")).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a directory with no markers yields an empty set", () => {
	const dir = tmp();
	try {
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, "README"), "");
		expect(readMarkers(dir).stacks.size).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
