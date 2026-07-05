// The two scratch-config render bodies the Dashboard shows: the preview popup's full statusline and the Theme
// section's per-theme mini-statusline. Both call renderScenario, which writes a scratch config + git fixture to
// disk and runs the whole render pipeline, so neither may run on the synchronous keystroke render. Each hook
// keeps its body in state and recomputes on a trailing debounce, so cycling scenarios or browsing themes with
// j/k never blocks a keystroke on disk and never rewrites disk on every key — only once the selection settles.
// When inactive the body clears immediately (no timer) so a closed popup or a non-Themes category shows nothing.

import { useEffect, useState } from "react";

import { displayWidth } from "../../render";
import type { Config } from "../../sources";
import { renderScenario, SCENARIOS, type Scenario } from "../preview";

// The trailing debounce, in ms, before a settled selection triggers its render. Kept short so it stays within
// the TUI's own render cadence, while still keeping the disk write off the synchronous keystroke render.
const BODY_DEBOUNCE_MS = 24;

/** The preview popup's statusline body: the active scenario rendered at the popup's width, or "" while closed. */
export function usePreviewBody(
	active: boolean,
	scenario: Scenario,
	draft: Config,
	columns: number,
	noColor: boolean,
): string {
	const [body, setBody] = useState("");
	useEffect(() => {
		if (!active) {
			setBody("");
			return;
		}
		const id = setTimeout(() => {
			// The compactions/todo widgets default off (most sessions show neither), so force them on for the
			// preview render only -- the fixture always seeds a compaction and an in-progress todo, and the
			// preview is exactly where a user would look to see what those widgets look like. `draft` itself
			// (and whatever gets saved) is untouched.
			const previewConfig: Config = {
				...draft,
				line: {
					...draft.line,
					widgets: { ...draft.line.widgets, compactions: true, todo: true },
				},
			};
			setBody(renderScenario(scenario, previewConfig, { columns, noColor }));
		}, BODY_DEBOUNCE_MS);
		return () => {
			clearTimeout(id);
		};
	}, [active, scenario, draft, columns, noColor]);
	return body;
}

/**
 * One character's rendered statusline for the Save & install carousel. Forces fixed mode on the draft so the
 * pipeline paints exactly `character` (and, under the "Match character" theme, that character's palette), and
 * forces the compactions/todo widgets on like usePreviewBody. Off the keystroke path: the disk-writing render
 * runs on a trailing debounce. Empty while inactive.
 */
export function useSaveCharacterBody(
	active: boolean,
	character: string,
	draft: Config,
	columns: number,
): string {
	const [body, setBody] = useState("");
	useEffect(() => {
		if (!active) {
			setBody("");
			return;
		}
		const id = setTimeout(() => {
			const scenario = SCENARIOS[0];
			if (scenario === undefined) {
				setBody("");
				return;
			}
			const previewConfig: Config = {
				...draft,
				character: { ...draft.character, mode: "fixed", name: character },
				line: {
					...draft.line,
					widgets: { ...draft.line.widgets, compactions: true, todo: true },
				},
			};
			setBody(renderScenario(scenario, previewConfig, { columns, noColor: false }));
		}, BODY_DEBOUNCE_MS);
		return () => {
			clearTimeout(id);
		};
	}, [active, character, draft, columns]);
	return body;
}

/** The Theme section's highlighted-theme mini-statusline, or "" when inactive or too wide for its column. */
export function useThemeDetailBody(
	active: boolean,
	itemCursor: number,
	themeKeys: readonly string[],
	scenarioIndex: number,
	draft: Config,
	columns: number,
): string {
	const [body, setBody] = useState("");
	useEffect(() => {
		if (!active) {
			setBody("");
			return;
		}
		const id = setTimeout(() => {
			const idx = Math.min(itemCursor, themeKeys.length - 1);
			const themeKey = themeKeys[idx] ?? "houston";
			const sc = SCENARIOS[scenarioIndex] ?? SCENARIOS[0];
			if (sc === undefined) {
				setBody("");
				return;
			}
			const out = renderScenario(
				sc,
				{ ...draft, theme: { ...draft.theme, name: themeKey } },
				{ columns, noColor: false },
			);
			// Gate: the render pipeline has a minimum output width (the never-drop helpful-tip floor) that can
			// exceed the column budget at narrow pane widths. Drop the body rather than let it overflow the
			// rail's detail column — the swatch strip remains visible either way.
			const maxW = out.split("\n").reduce((m, l) => Math.max(m, displayWidth(l)), 0);
			setBody(maxW <= columns ? out : "");
		}, BODY_DEBOUNCE_MS);
		return () => {
			clearTimeout(id);
		};
	}, [active, itemCursor, themeKeys, scenarioIndex, draft, columns]);
	return body;
}
