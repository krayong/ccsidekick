import { expect, test } from "bun:test";

import { asSession, asProject } from "./ids";

test("branded constructors return the underlying string", () => {
	expect(asSession("abc")).toBe("abc" as unknown as ReturnType<typeof asSession>);
	expect(asProject("owner/repo")).toBe("owner/repo" as unknown as ReturnType<typeof asProject>);
});
