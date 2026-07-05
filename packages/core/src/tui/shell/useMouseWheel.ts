// Terminal mouse-wheel / trackpad two-axis scrolling. While `active`, enables SGR mouse tracking (so the
// terminal reports wheel events to the app instead of scrolling its own scrollback) and translates each wheel
// event into a scroll delta. The pure `parseMouseWheel` is unit-tested; the hook wiring (raw mode + stdin) needs
// a real terminal to exercise. Caveat: while tracking is on the terminal's own click-to-select is captured, so
// text selection needs a modifier (e.g. Shift) in most terminals.

import { useStdin } from "ink";
import { useEffect } from "react";

// SGR mouse report: ESC [ < button ; col ; row (M=press, m=release). Wheel buttons carry bit 6 (64): 64 = up,
// 65 = down, 66 = left, 67 = right. One data chunk can carry several events (a fast flick), so aggregate them.
// eslint-disable-next-line no-control-regex -- \x1b (ESC) is the literal first byte of every SGR mouse report
const SGR_MOUSE = /\x1b\[<(\d+);\d+;\d+M/gi;

/** Aggregate wheel deltas in a raw stdin chunk: dy<0 up, dy>0 down, dx<0 left, dx>0 right. {0,0} if none. */
export function parseMouseWheel(data: string): { dx: number; dy: number } {
	let dx = 0;
	let dy = 0;
	for (const m of data.matchAll(SGR_MOUSE)) {
		switch (Number(m[1])) {
			case 64:
				dy -= 1;
				break;
			case 65:
				dy += 1;
				break;
			case 66:
				dx -= 1;
				break;
			case 67:
				dx += 1;
				break;
			default:
				break;
		}
	}
	return { dx, dy };
}

const ENABLE = "\x1b[?1000h\x1b[?1006h"; // button tracking + SGR extended coordinates
const DISABLE = "\x1b[?1000l\x1b[?1006l";

/**
 * Route mouse-wheel/trackpad scroll to `onScroll(dx, dy)` while `active`. Pass a STABLE `onScroll` (useCallback):
 * the effect re-subscribes when it changes, and each re-subscribe rewrites the enable/disable sequences. No-op
 * when raw mode is unsupported (e.g. a non-TTY test harness).
 */
export function useMouseWheel(active: boolean, onScroll: (dx: number, dy: number) => void): void {
	const { stdin, setRawMode, isRawModeSupported } = useStdin();
	useEffect(() => {
		if (!active || !isRawModeSupported) return;
		setRawMode(true);
		process.stdout.write(ENABLE);
		const onData = (chunk: Buffer | string): void => {
			const { dx, dy } = parseMouseWheel(
				typeof chunk === "string" ? chunk : chunk.toString("utf8"),
			);
			if (dx !== 0 || dy !== 0) onScroll(dx, dy);
		};
		stdin.on("data", onData);
		return () => {
			stdin.off("data", onData);
			process.stdout.write(DISABLE);
		};
	}, [active, stdin, setRawMode, isRawModeSupported, onScroll]);
}
