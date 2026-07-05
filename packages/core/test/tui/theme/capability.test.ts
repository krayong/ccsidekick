import { expect, test } from "bun:test";

import { detectCapability } from "../../../src/tui/theme";

test("NO_COLOR forces the none tier even when truecolor is advertised", () => {
	expect(detectCapability({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("none");
	expect(detectCapability({ NO_COLOR: "" })).toBe("none");
});

test("COLORTERM truecolor/24bit and a 256/truecolor TERM are the full tier", () => {
	expect(detectCapability({ COLORTERM: "truecolor" })).toBe("full");
	expect(detectCapability({ COLORTERM: "24bit" })).toBe("full");
	expect(detectCapability({ TERM: "xterm-256color" })).toBe("full");
	expect(detectCapability({ TERM: "screen-256color" })).toBe("full");
});

test("everything else is the basic tier", () => {
	expect(detectCapability({ TERM: "xterm" })).toBe("basic");
	expect(detectCapability({})).toBe("basic");
});
