import { expect, test } from "bun:test";

import { Alert, ProgressBar, Spinner } from "../../../src/tui/widgets";

test("inkui re-exports Alert, Spinner, and ProgressBar as components", () => {
	expect(typeof Alert).toBe("function");
	expect(typeof Spinner).toBe("function");
	expect(typeof ProgressBar).toBe("function");
});
