import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { learnModelName, readModelNames } from "./modelNames";
import { cacheDir } from "./storage";

const withRoot = (fn: (root: string) => void): void => {
	const root = mkdtempSync(join(tmpdir(), "ccsk-models-"));
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

const ARN = "arn:aws:bedrock:ap-southeast-1:1:application-inference-profile/abc[1m]";

test("readModelNames is empty when no cache exists", () => {
	withRoot((root) => {
		expect(readModelNames(root)).toEqual({});
	});
});

test("learnModelName persists an id → display-name mapping that readModelNames returns", () => {
	withRoot((root) => {
		learnModelName(root, {}, ARN, "Opus 4.8 (1M context)");
		expect(readModelNames(root)).toEqual({ [ARN]: "Opus 4.8 (1M context)" });
	});
});

test("learnModelName merges without dropping other entries", () => {
	withRoot((root) => {
		const first = { "arn:x": "Sonnet 5" };
		learnModelName(root, first, ARN, "Opus 4.8 (1M context)");
		expect(readModelNames(root)).toEqual({
			"arn:x": "Sonnet 5",
			[ARN]: "Opus 4.8 (1M context)",
		});
	});
});

test("learnModelName is a no-op when the mapping is unchanged (no write)", () => {
	withRoot((root) => {
		learnModelName(root, {}, ARN, "Opus 4.8");
		const path = join(cacheDir(root), "model-names.json");
		const before = readFileSync(path, "utf8");
		writeFileSync(path, `${before} `); // tamper so any rewrite is detectable
		learnModelName(root, { [ARN]: "Opus 4.8" }, ARN, "Opus 4.8");
		expect(readFileSync(path, "utf8")).toBe(`${before} `); // untouched ⇒ no write
	});
});
