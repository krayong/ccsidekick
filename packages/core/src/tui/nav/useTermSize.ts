// Terminal size and the layout breakpoint, tracking process.stdout resize. `breakpointFor` is pure so the
// clip math is testable without a terminal; the hook wires it to live resize events.

import { useEffect, useState } from "react";

type Breakpoint = "floor" | "narrow" | "wide";

interface TermSize {
	readonly columns: number;
	readonly rows: number;
	readonly breakpoint: Breakpoint;
}

/** The layout breakpoint for a size. Below 80 columns or 24 rows is the hard floor. */
export function breakpointFor(columns: number, rows: number): Breakpoint {
	if (columns < 80 || rows < 24) return "floor";
	return columns < 100 ? "narrow" : "wide";
}

// process.stdout.columns/rows are typed `number` in this repo, so no `??` fallback (ESLint would flag it as an
// unnecessary condition). The interactive TUI only launches on a TTY, where both are defined.
const measure = (): TermSize => {
	const columns = process.stdout.columns;
	const rows = process.stdout.rows;
	return { columns, rows, breakpoint: breakpointFor(columns, rows) };
};

export function useTermSize(): TermSize {
	const [size, setSize] = useState<TermSize>(measure);
	useEffect(() => {
		const onResize = (): void => {
			setSize(measure());
		};
		process.stdout.on("resize", onResize);
		return () => {
			process.stdout.off("resize", onResize);
		};
	}, []);
	return size;
}
