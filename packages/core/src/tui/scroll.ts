// Window a flat list around the cursor so a long section scrolls inside a bounded viewport instead of
// overflowing the editor pane (which would push the live preview and footer off-screen). Pure: the sections
// feed it their field count and cursor and render only the returned `[start, end)` slice.

/**
 * The slice of a `total`-length list to render so `cursor` stays visible in a `viewport`-row window. The window
 * is centered on the cursor, then clamped so it never runs past either end; when `total <= viewport` the whole
 * range is returned. `viewport` is floored at 1.
 */
export function scrollWindow(
	total: number,
	cursor: number,
	viewport: number,
): { start: number; end: number } {
	const v = Math.max(1, viewport);
	if (total <= v) return { start: 0, end: total };
	const c = Math.max(0, Math.min(cursor, total - 1));
	let start = c - Math.floor(v / 2);
	start = Math.max(0, Math.min(start, total - v));
	return { start, end: start + v };
}

/**
 * Clamp a scroll `offset` to the valid range for a `content`-sized axis shown through a `viewport`-sized window:
 * never below 0, never past `content - viewport` (which is 0 when the content already fits). Used for both the
 * vertical and horizontal scroll offsets of the Save preview and the Stats board.
 */
export function clampScroll(offset: number, content: number, viewport: number): number {
	return Math.max(0, Math.min(offset, Math.max(0, content - viewport)));
}
