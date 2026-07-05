import { expect, test } from "bun:test";

import type { TermContext } from "../domain";

import { fg, fgFaint, gradient, xtermToRgb, rgbToXterm } from "./color";

const tty: TermContext = { columns: 100, noColor: false, isTTY: true };
const noColor: TermContext = { columns: 100, noColor: true, isTTY: true };
const nonTty: TermContext = { columns: 100, noColor: false, isTTY: false };

test("fg wraps in a 256-color SGR on a color TTY", () => {
	expect(fg(40, "x", tty)).toBe("\x1b[38;5;40mx\x1b[0m");
});

test("fg returns plain text under NO_COLOR and on a non-TTY", () => {
	expect(fg(40, "x", noColor)).toBe("x");
	expect(fg(40, "x", nonTty)).toBe("x");
});

test("fgFaint wraps in a faint (SGR 2) 256-color SGR on a color TTY, plain otherwise", () => {
	expect(fgFaint(8, "⋯", tty)).toBe("\x1b[2;38;5;8m⋯\x1b[0m");
	expect(fgFaint(8, "⋯", noColor)).toBe("⋯");
	expect(fgFaint(8, "⋯", nonTty)).toBe("⋯");
});

test("xtermToRgb decodes base, cube, and grayscale ranges", () => {
	expect(xtermToRgb(0)).toEqual([0, 0, 0]);
	expect(xtermToRgb(15)).toEqual([255, 255, 255]);
	expect(xtermToRgb(16)).toEqual([0, 0, 0]); // cube origin
	expect(xtermToRgb(231)).toEqual([255, 255, 255]); // cube max
	expect(xtermToRgb(232)).toEqual([8, 8, 8]); // grayscale start
	expect(xtermToRgb(255)).toEqual([238, 238, 238]); // grayscale end
});

test("rgbToXterm round-trips cube corners", () => {
	expect(rgbToXterm([0, 0, 0])).toBe(16);
	expect(rgbToXterm([255, 255, 255])).toBe(231);
	expect(rgbToXterm(xtermToRgb(40))).toBe(40);
});

test("gradient is single-stop safe", () => {
	expect(gradient([51], 3)).toEqual([51, 51, 51]);
	expect(gradient([51, 123], 1)).toEqual([51]);
	expect(gradient([51, 123], 2).length).toBe(2);
});

test("gradient endpoints equal the stops, interior interpolates in RGB", () => {
	const g = gradient([51, 123], 5);
	expect(g.length).toBe(5);
	expect(g[0]).toBe(51);
	expect(g[4]).toBe(123);
});

test("gradient spans multiple stops and hits each at its anchor", () => {
	const g = gradient([16, 196, 231], 3);
	expect(g).toEqual([16, 196, 231]);
});
