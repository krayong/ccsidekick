import { afterEach, expect, test } from "bun:test";
import { Text } from "ink";
import { render as rawRender } from "ink-testing-library";
import { type ReactElement, createElement } from "react";

import { useTransitionFade } from "../../../src/tui/shell";

const mounted: ReturnType<typeof rawRender>[] = [];
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
});
const render = (...args: Parameters<typeof rawRender>): ReturnType<typeof rawRender> => {
	const inst = rawRender(...args);
	mounted.push(inst);
	return inst;
};

const wait = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function Probe({ k, reduced }: { readonly k: number; readonly reduced: boolean }): ReactElement {
	const fade = useTransitionFade(k, reduced);
	return createElement(Text, null, `fade=${String(fade)}`);
}

test("reducedMotion returns full immediately and starts no timer", () => {
	const real = globalThis.setInterval;
	let intervals = 0;
	globalThis.setInterval = ((
		...args: Parameters<typeof setInterval>
	): ReturnType<typeof setInterval> => {
		intervals += 1;
		return real(...args);
	}) as typeof setInterval;
	try {
		const { lastFrame } = render(createElement(Probe, { k: 1, reduced: true }));
		expect(lastFrame() ?? "").toContain("fade=1"); // full on the first frame
		expect(intervals).toBe(0); // no interval scheduled under reducedMotion
	} finally {
		globalThis.setInterval = real;
	}
});

test("the step machine advances 0 → full over discrete ticks, then resets on a key change", async () => {
	const { lastFrame, rerender } = render(createElement(Probe, { k: 1, reduced: false }));
	expect(lastFrame() ?? "").toContain("fade=0"); // reset-on-mount: starts dim
	await wait(300); // both discrete ticks fire; the timer clears itself at full
	expect(lastFrame() ?? "").toContain("fade=1");
	rerender(createElement(Probe, { k: 2, reduced: false })); // a new section key
	await wait(10); // let the reset effect flush, before the next 90ms tick
	expect(lastFrame() ?? "").toContain("fade=0"); // reset to dim on the key change
});
