import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { readHelpfulEnv } from "./helpfulEnv";

function withKubeconfig<T>(body: string, fn: () => T): T {
	const dir = mkdtempSync(join(tmpdir(), "ccsk-kube-"));
	const path = join(dir, "config");
	writeFileSync(path, body);
	const prev = process.env["KUBECONFIG"];
	process.env["KUBECONFIG"] = path;
	try {
		return fn();
	} finally {
		if (prev === undefined) delete process.env["KUBECONFIG"];
		else process.env["KUBECONFIG"] = prev;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("kubeconfig current-context ⇒ kubeContext", () => {
	const yaml = ["apiVersion: v1", "current-context: prod-cluster", "kind: Config"].join("\n");
	const ctx = withKubeconfig(
		yaml,
		() => readHelpfulEnv(mkdtempSync(join(tmpdir(), "ccsk-cwd-"))).kubeContext,
	);
	expect(ctx).toBe("prod-cluster");
});

test(".terraform/environment ⇒ tfWorkspace", () => {
	const cwd = mkdtempSync(join(tmpdir(), "ccsk-tf-"));
	mkdirSync(join(cwd, ".terraform"));
	writeFileSync(join(cwd, ".terraform", "environment"), "staging\n");
	try {
		// Point KUBECONFIG at a missing file so kubeContext stays absent.
		const env = withKubeconfig("", () => readHelpfulEnv(cwd));
		expect(env.tfWorkspace).toBe("staging");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("no kube/tf markers ⇒ empty object", () => {
	const cwd = mkdtempSync(join(tmpdir(), "ccsk-empty-"));
	const env = withKubeconfig("", () => readHelpfulEnv(cwd));
	try {
		expect(env).toEqual({});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
