// The stateful shell root: holds the draft config plus the nav, cursor, and editing state, installs the one
// useInput that feeds the dispatcher and the content-zone field reducer, resolves tokens from the active theme,
// and picks the layout from terminal size. Text/number editing is captured here into a buffer so a keystroke
// never leaks to a global shortcut. Below the floor it shows a resize notice.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Box, Text, useApp, useInput, type Key } from "ink";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { clampScroll, loadMetrics, save } from "..";
import { THEMES, type ThemeData } from "../../data";
import type { AllMetrics } from "../../derived";
import { BUNDLED_PACK, FIRST_PARTY_PACKS, loadPack } from "../../packs";
import { CHARACTER_THEME, displayWidth } from "../../render";
import {
	type Clock,
	type Config,
	listInstalledPacks,
	loadConfig,
	readFxCached,
	systemClock,
} from "../../sources";
import { INITIAL_NAV, breakpointFor, dispatchKey, type NavState } from "../nav";
import { PreviewPanel, SCENARIOS } from "../preview";
import {
	CharacterSection,
	ENGINE_ROOT,
	FormSection,
	InstallPanel,
	StatsSection,
	StatuslineSection,
	ThemeSection,
	WIDGET_GROUPS,
	currencyCodes,
	filterCodes,
	installPackAsync,
	sectionFields,
	statsAxisRowCount,
	statsBoardHeight,
	statsView,
	statuslineFields,
	themeSettingsFields,
	type CharacterDetail,
} from "../sections";
import { detectCapability, detectReducedMotion, glyphSet, resolveTokens } from "../theme";
import {
	Alert,
	CurrencyPicker,
	FindPopup,
	HelpPopup,
	Popup,
	applyContentKey,
	applyRailKey,
	popupTextWidth,
	type FieldSpec,
	type RailState,
} from "../widgets";

import { AppShell, CONTENT_CHROME_COLS, CONTENT_CHROME_ROWS, POPUP_CHROME_ROWS } from "./AppShell";
import { buildFindIndex, rankFind } from "./findIndex";
import { routeKey } from "./inputRoute";
import { SaveConfirmPopup } from "./SaveConfirmPopup";
import { savePreviewSet } from "./savePreview";
import { chipFor, type SaveTarget } from "./saveTarget";
import { usePreviewBody, useSaveCharacterBody, useThemeDetailBody } from "./scenarioBodies";
import { useMouseWheel } from "./useMouseWheel";

const dedupe = (xs: readonly string[]): readonly string[] => [...new Set(xs)];

export interface DashboardProps {
	readonly targets: readonly SaveTarget[];
	readonly themeName?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly onQuit?: () => void;
	readonly onSave?: (config: Config, target: SaveTarget) => void;
	readonly renderBin?: string;
	readonly initialConfig?: Config;
	readonly cols?: number;
	readonly rows?: number;
	readonly packs?: readonly string[];
	readonly installed?: readonly string[];
	readonly reducedMotion?: boolean;
	readonly install?: (name: string) => Promise<void>;
	readonly clock?: Clock;
	readonly metrics?: AllMetrics;
}

const seed = (configDir: string, initial: Config | undefined): Config => {
	if (initial) return initial;
	try {
		return loadConfig(readFileSync(join(configDir, "ccsidekick", "config.toml"), "utf8"));
	} catch {
		return loadConfig("");
	}
};

export function Dashboard(props: DashboardProps): ReactElement {
	const {
		env = process.env,
		onQuit,
		onSave,
		renderBin = "ccsidekick-render",
		initialConfig,
		cols,
		rows,
	} = props;
	const app = useApp();
	// Guards the async install callbacks below: an install can resolve after the TUI has unmounted (Ctrl+C
	// mid-download), and a setState on an unmounted component is a no-op warning. Set true on mount (so a
	// remount cannot leave it stuck false) and false on unmount.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [nav, setNav] = useState<NavState>(INITIAL_NAV);
	const [targets, setTargets] = useState<readonly SaveTarget[]>(props.targets);
	const configDir = targets[0]?.dir ?? "";
	const root = join(configDir, "ccsidekick");
	const [draft, setDraft] = useState<Config>(() => seed(configDir, initialConfig));
	const [dirty, setDirty] = useState(false);
	const [cursor, setCursor] = useState(0);
	const [editing, setEditing] = useState(false);
	const [buffer, setBuffer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [scenarioIndex, setScenarioIndex] = useState(0);
	const [previewNoColor, setPreviewNoColor] = useState(false);
	const [previewNarrow, setPreviewNarrow] = useState(false);
	const [installedScan, setInstalled] = useState<readonly string[]>(
		() => props.installed ?? listInstalledPacks(ENGINE_ROOT),
	);
	// The bundled pack is a runtime dependency of the engine, so it is always installed; the node_modules
	// directory scan that seeds this can miss it when it is hoisted or bundled. Force it in so the catalog
	// never offers it for install and Enter selects it instead of shelling out an npm install that would fail.
	// Memoized (rather than recomputed each render) so its reference stays stable when unchanged -- the
	// `themeTable` useMemo below depends on it, and an unstable reference would defeat that memoization.
	const installed = useMemo(
		() =>
			installedScan.includes(BUNDLED_PACK) ? installedScan : [BUNDLED_PACK, ...installedScan],
		[installedScan],
	);
	const [characterRail, setCharacterRail] = useState<RailState>({
		focus: 0,
		catCursor: 0,
		itemCursor: 0,
	});
	const [themeRail, setThemeRail] = useState<RailState>({
		focus: 0,
		catCursor: 0,
		itemCursor: 0,
	});
	const [statuslineRail, setStatuslineRail] = useState<RailState>({
		focus: 0,
		catCursor: 0,
		itemCursor: 0,
	});
	const [installStatus, setInstallStatus] = useState<"idle" | "installing" | "error">("idle");
	const [installError, setInstallError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [overlayCursor, setOverlayCursor] = useState(0);
	const [currencyQuery, setCurrencyQuery] = useState("");
	const [statsDimension, setStatsDimension] = useState<0 | 1 | 2>(0);
	const [statsWindow, setStatsWindow] = useState<0 | 1>(0);
	const [statsFocus, setStatsFocus] = useState<0 | 1 | 2>(0);
	const [statsEntry, setStatsEntry] = useState(0);
	const [statsScrollX, setStatsScrollX] = useState(0);
	const [statsScrollY, setStatsScrollY] = useState(0);
	const [saveCharIdx, setSaveCharIdx] = useState(0);
	const [saveScrollX, setSaveScrollX] = useState(0);
	const [saveScrollY, setSaveScrollY] = useState(0);

	const packs = props.packs ?? dedupe([...FIRST_PARTY_PACKS, ...installed]);
	// Both rail categories browse the same pack union today (Roster marks selection, Browse marks install
	// status); named separately to match the rail's category-keyed handler contract.
	const rosterList = packs;
	const browseList = packs;
	const install = props.install ?? installPackAsync;
	const themeSettingRows = themeSettingsFields(draft);
	const activeIds =
		draft.character.mode === "fixed" ? [draft.character.name] : draft.character.roster;

	// The Save & install carousel previews exactly these characters. Declared before handleSaveKey so its
	// left/right paging can read the length; the render hook (below) paints the current one off the keystroke path.
	const savePreviewChars = savePreviewSet(draft, installed, packs);
	const saveCharIdxClamped = Math.min(saveCharIdx, savePreviewChars.length - 1);
	const saveCharName = savePreviewChars[saveCharIdxClamped] ?? "batman";

	const selectCharacter = (id: string): Config => {
		const ch = draft.character;
		if (ch.mode === "fixed") return { ...draft, character: { ...ch, name: id } };
		const roster =
			ch.roster.includes(id) ? ch.roster.filter((r) => r !== id) : [...ch.roster, id];
		return { ...draft, character: { ...ch, roster } };
	};

	// Terminal size is owned by App (its single useTermSize tracks resize) and threaded down as cols/rows, so
	// the Dashboard registers no second resize listener of its own. The 80x24 fallback is the layout floor and
	// only applies to a direct mount that supplies neither (which then just shows the resize notice).
	const columns = cols ?? 80;
	const height = rows ?? 24;
	const breakpoint = breakpointFor(columns, height);

	// The save carousel's current character, rendered at the popup's own text budget (SaveConfirmPopup clips to
	// the same width), off the keystroke path via the debounced hook. Its dimensions drive the scroll clamp.
	const saveBody = useSaveCharacterBody(
		nav.overlay === "save",
		saveCharName,
		draft,
		popupTextWidth(columns),
	);
	const saveLines = saveBody.split("\n");
	const saveContentRows = saveLines.length;
	const saveContentCols = Math.max(1, ...saveLines.map((l) => displayWidth(l)));
	const saveViewCols = popupTextWidth(columns);
	// Rows left for the preview inside the popup: the modal region minus its own chrome and the scope/target/
	// label header. Kept a touch conservative so the ScrollBox never spills past the modal's own clip.
	const saveViewRows = Math.max(3, height - POPUP_CHROME_ROWS - (10 + targets.length));
	const saveScrollXc = clampScroll(saveScrollX, saveContentCols, saveViewCols);
	const saveScrollYc = clampScroll(saveScrollY, saveContentRows, saveViewRows);
	const scrollSave = useCallback(
		(dx: number, dy: number): void => {
			setSaveScrollX((x) => clampScroll(x + dx, saveContentCols, saveViewCols));
			setSaveScrollY((y) => clampScroll(y + dy, saveContentRows, saveViewRows));
		},
		[saveContentCols, saveViewCols, saveContentRows, saveViewRows],
	);

	const capability = detectCapability(env);
	// The catalog augmented with installed packs' own theme blocks, each registered under the pack's
	// name so it is selectable alongside the built-ins. On a name collision the pack wins (it is
	// written into the table after the built-in spread); collisions aren't expected in practice since
	// pack names and built-in theme names are drawn from disjoint namespaces. Memoized so this object
	// (and the `themeKeys` derived from it) stays referentially stable across renders — `themeDetailBody`
	// depends on it, and an unstable reference would re-run that hook's disk-writing renderScenario call
	// on every keystroke.
	const themeTable = useMemo<Readonly<Record<string, ThemeData>>>(() => {
		const t: Record<string, ThemeData> = { ...(THEMES as Record<string, ThemeData>) };
		for (const name of installed) {
			const res = loadPack(name);
			if (res.ok && res.pack.theme !== undefined) {
				t[name] = { displayName: res.pack.displayName, ...res.pack.theme };
			}
		}
		return t;
	}, [installed]);
	// The sentinel leads the list so "Match character" is the first, most discoverable option. It has no
	// ThemeData entry in themeTable (ThemeSection renders an explanation instead of a swatch for it).
	const themeKeys = useMemo(() => [CHARACTER_THEME, ...Object.keys(themeTable)], [themeTable]);
	// Driven by the draft's selected theme (houston fallback), not the fixed `themeName` seed prop, so
	// selecting a theme recolors the chrome (via `tokens`, already threaded through every section) and
	// the Character figure (via `hues`, passed to CharacterSection below) live. Reads the augmented
	// table so a pack theme (e.g. batman, spiderman) recolors the live figure and chrome too, not just
	// its swatch in the Theme list.
	const theme: ThemeData = themeTable[draft.theme.name] ?? THEMES.houston;
	const tokens = resolveTokens(theme, capability);
	const glyphs = glyphSet(false);
	const reducedMotion = props.reducedMotion ?? detectReducedMotion(env);

	const fields = sectionFields(nav.section, draft);

	const change = (next: Config): void => {
		setDraft(next);
		setDirty(true);
	};

	const runInstall = (): boolean => {
		try {
			for (const t of targets) {
				if (t.scope === "local" && t.cwd === undefined) {
					throw new Error("local target has no cwd"); // guard: never fall through to save's process.cwd()
				}
				const opts = {
					...(t.cwd !== undefined ? { cwd: t.cwd } : {}),
					...(t.wireLocalSettings !== undefined ?
						{ wireLocalSettings: t.wireLocalSettings }
					:	{}),
				};
				if (onSave) onSave(draft, t);
				else save(draft, t.scope, t.dir, renderBin, opts);
			}
			setDirty(false);
			setError(null);
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return false;
		}
	};

	// The global Find index: sections (jump), the FormSection fields (Voice/Tips/Network/Statusline, where the
	// cursor is authoritative), and the install/widget-toggle actions the retired Ctrl+P palette used to offer.
	const findDeps = {
		config: draft,
		goToSection: (n: number) => () => {
			setNav({ ...nav, section: n, zone: "sidebar", overlay: "none" });
		},
		focusField: (section: number, fieldIndex: number) => () => {
			setNav({ ...nav, section, zone: "content", overlay: "none" });
			setCursor(fieldIndex); // the FormSection cursor for sections 2-5
		},
		// Find's install entry only opens the save-confirm overlay — runInstall() itself (the real disk write)
		// is reserved for the popup's own y/↵, so picking this from Find can never write unconfirmed.
		runInstall: () => {
			setSaveCharIdx(0);
			setSaveScrollX(0);
			setSaveScrollY(0);
			setNav({ ...nav, overlay: "save" });
		},
		toggleWidget: (id: string) => () => {
			const spec = statuslineFields(draft).find((f) => f.id === `widget:${id}`);
			if (spec?.toggle) change(spec.toggle(draft));
		},
		// The Statusline rail's Format rows have no FormSection cursor for focusField to set, so Find jumps
		// straight to the row's own action: landing on Currency opens its picker overlay directly, and
		// Budget starts its edit outright.
		openCurrencyPicker: () => {
			setNav({ ...nav, section: 5, zone: "content", overlay: "currency" });
			setStatuslineRail((s) => ({ ...s, focus: 1, catCursor: 0, itemCursor: 0 }));
			setCurrencyQuery("");
			setOverlayCursor(0);
		},
		beginBudgetEdit: () => {
			setNav({ ...nav, section: 5, zone: "content", overlay: "none" });
			setStatuslineRail((s) => ({ ...s, focus: 1, catCursor: 0, itemCursor: 1 }));
			setCursor(1);
			setBuffer(statuslineFields(draft)[1]?.raw ?? "");
			setEditing(true);
		},
	};
	const findRows = rankFind(query, buildFindIndex(findDeps));

	// Editing capture: a text/number field owns the keyboard until Enter or Escape. Here `key` is Ink's Key
	// (required booleans), so a plain truthy check is correct; the `=== true` form ESLint would reject.
	const handleEditingKey = (input: string, key: Key): void => {
		const field: FieldSpec | undefined = fields[cursor];
		if (key.return) {
			if (field?.commit) change(field.commit(draft, buffer));
			setEditing(false);
		} else if (key.escape) {
			setEditing(false);
		} else if (key.backspace || key.delete) {
			setBuffer((b) => b.slice(0, -1));
		} else if (input !== "" && !key.ctrl && !key.meta) {
			setBuffer((b) => b + input);
		}
	};

	// Find overlay: capture the query, move the cursor over the ranked list, and jump on Enter. dispatchKey
	// swallows these keys, so this branch owns them — this is what makes `s` and `q` type into the query
	// instead of firing Install/quit while Find is open.
	const handleFindKey = (input: string, key: Key): void => {
		if (key.escape) {
			setNav({ ...nav, overlay: "none" });
			setQuery("");
			setOverlayCursor(0);
			return;
		}
		if (key.upArrow || input === "k") {
			setOverlayCursor((c) => Math.max(0, c - 1));
			return;
		}
		if (key.downArrow || input === "j") {
			setOverlayCursor((c) => Math.min(Math.max(0, findRows.length - 1), c + 1));
			return;
		}
		if (key.return) {
			// Close first, then run: run() may itself call setNav (a section/field jump), and that call must
			// land after this generic close so it is the one that wins (both read the same stale `nav` closure).
			const picked = findRows[overlayCursor];
			setNav({ ...nav, overlay: "none" });
			setQuery("");
			setOverlayCursor(0);
			picked?.run();
			return;
		}
		if (key.backspace || key.delete) {
			setQuery((q) => q.slice(0, -1));
			setOverlayCursor(0);
			return;
		}
		if (input !== "" && !key.ctrl && !key.meta) {
			setQuery((q) => q + input);
			setOverlayCursor(0);
		}
	};

	// Gated to only when the overlay is open: readFxCached reads fx.json from disk, so computing this
	// unconditionally on every render would hit disk on every keystroke anywhere in the app.
	const currencyRows = useMemo(
		() =>
			nav.overlay === "currency" ?
				filterCodes(currencyCodes(readFxCached(root)), currencyQuery)
			:	[],
		[root, currencyQuery, nav.overlay],
	);

	// Currency overlay: capture the query, move the cursor over the filtered code list, and commit the
	// highlighted code on Enter. dispatchKey swallows these keys (the "currency" case in dispatchOverlayKey),
	// so this branch owns them — this is what makes `/`, `s`, and `q` type into the query instead of opening
	// Find, saving, or quitting.
	const handleCurrencyKey = (input: string, key: Key): void => {
		if (key.escape) {
			setNav({ ...nav, overlay: "none" });
			setCurrencyQuery("");
			setOverlayCursor(0);
			return;
		}
		if (key.upArrow) {
			setOverlayCursor((c) => Math.max(0, c - 1));
			return;
		}
		if (key.downArrow) {
			setOverlayCursor((c) => Math.min(Math.max(0, currencyRows.length - 1), c + 1));
			return;
		}
		if (key.return) {
			const code = currencyRows[overlayCursor];
			setNav({ ...nav, overlay: "none" });
			setCurrencyQuery("");
			setOverlayCursor(0);
			if (code !== undefined) change({ ...draft, line: { ...draft.line, currency: code } });
			return;
		}
		if (key.backspace || key.delete) {
			setCurrencyQuery((q) => q.slice(0, -1));
			setOverlayCursor(0);
			return;
		}
		if (input !== "" && !key.ctrl && !key.meta) {
			setCurrencyQuery((q) => q + input);
			setOverlayCursor(0);
		}
	};

	// Preview overlay controls: cycle scenario, toggle color/width. routeKey routes only the four preview
	// controls here (ctrl+p, escape, and everything else fall through to the global dispatcher, which closes
	// the overlay), so `input` is always one of , . n w.
	const handlePreviewKey = (input: string): void => {
		if (input === ".") setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
		else if (input === ",")
			setScenarioIndex((i) => (i - 1 + SCENARIOS.length) % SCENARIOS.length);
		else if (input === "n") setPreviewNoColor((v) => !v);
		else setPreviewNarrow((v) => !v);
	};

	// Space/Enter on the list column: on Roster, index 0 is the Mode row (cycles fixed/random); every other
	// Roster row and every Browse row map to rosterList/browseList[itemCursor - 1 | itemCursor]. Browse also
	// kicks off an async install for an uninstalled pack instead of selecting it outright.
	const activateCharacter = (state: RailState): void => {
		if (state.catCursor === 0) {
			// Roster: index 0 is the Mode row; the rest map to rosterList[itemCursor - 1].
			if (state.itemCursor === 0) {
				const ch = draft.character;
				change({
					...draft,
					character: { ...ch, mode: ch.mode === "fixed" ? "random" : "fixed" },
				});
				return;
			}
			const id = rosterList[state.itemCursor - 1];
			if (id !== undefined) change(selectCharacter(id));
			return;
		}
		const id = browseList[Math.min(state.itemCursor, browseList.length - 1)];
		if (id === undefined) return;
		if (installStatus === "installing") return;
		if (!installed.includes(id)) {
			setInstallStatus("installing");
			setInstallError(null);
			install(id)
				.then(() => {
					if (!mounted.current) return;
					setInstalled((prev) => (prev.includes(id) ? prev : [...prev, id]));
					setInstallStatus("idle");
				})
				.catch((e: unknown) => {
					if (!mounted.current) return;
					setInstallStatus("error");
					setInstallError(e instanceof Error ? e.message : String(e));
				});
			return;
		}
		change(selectCharacter(id));
	};

	// Character section: drive the category/list/detail rail. routeKey routes here only for field-nav keys in
	// this content-zone section (digit-jump, Tab, /, ?, and Ctrl+S fall through to the global dispatcher).
	// Roster's list is offset by one (the Mode row at index 0), so a category switch remaps itemCursor by that
	// same one-row shift: Roster index i corresponds to Browse index i-1.
	const handleCharacterKey = (input: string, key: Key): void => {
		const listLength =
			characterRail.catCursor === 0 ? rosterList.length + 1 : browseList.length;
		const r = applyRailKey(characterRail, { input, key }, 2, listLength);
		let next = r.state;
		if (r.state.catCursor !== characterRail.catCursor) {
			const delta = r.state.catCursor === 0 ? 1 : -1;
			const nextLen = r.state.catCursor === 0 ? rosterList.length + 1 : browseList.length;
			next = {
				...r.state,
				itemCursor: Math.max(0, Math.min(nextLen - 1, r.state.itemCursor + delta)),
			};
		}
		setCharacterRail(next);
		if (r.exit) setNav({ ...nav, zone: "sidebar" });
		if (r.act) activateCharacter(next);
	};

	// Space/Enter on a Theme row: select a theme (Themes category) or toggle/cycle a setting (Options category).
	const activateThemeRow = (state: RailState): void => {
		if (state.catCursor === 0) {
			const idx = Math.min(state.itemCursor, themeKeys.length - 1);
			const themeKey = themeKeys[idx];
			if (themeKey !== undefined)
				change({ ...draft, theme: { ...draft.theme, name: themeKey } });
			return;
		}
		const idx = Math.min(state.itemCursor, themeSettingRows.length - 1);
		const spec = themeSettingRows[idx];
		if (spec?.toggle) change(spec.toggle(draft));
		else if (spec?.next) change(spec.next(draft));
	};

	// Theme section: drive the category/list/detail rail. routeKey routes here only for field-nav keys in this
	// content-zone section (digit-jump, Tab, /, ?, and Ctrl+S fall through to the global dispatcher).
	const handleThemeKey = (input: string, key: Key): void => {
		const list = themeRail.catCursor === 0 ? themeKeys : themeSettingRows;
		const r = applyRailKey(themeRail, { input, key }, 2, list.length);
		setThemeRail(r.state);
		if (r.exit) setNav({ ...nav, zone: "sidebar" });
		if (r.act) activateThemeRow(r.state); // Themes -> set theme.name; Options -> next (Banding) / toggle (Mood shift)
	};

	const resetStatsScroll = (): void => {
		setStatsScrollX(0);
		setStatsScrollY(0);
	};
	// Stats section: ijkl scroll the board inside its box (i up, j left, k down, l right); the arrow keys drive
	// the axis rows — ↑/↓ move focus among View/Window/Entry, ←/→ change the focused axis (View wraps and resets
	// the entry index; Window toggles; Entry steps the ranked list). Switching the dimension or entry resets the
	// scroll since the board content changes. routeKey routes here only for these keys.
	const handleStatsKey = (input: string, key: Key): void => {
		if (input === "i") {
			scrollStats(0, -1);
			return;
		}
		if (input === "k") {
			scrollStats(0, 1);
			return;
		}
		if (input === "j") {
			scrollStats(-1, 0);
			return;
		}
		if (input === "l") {
			scrollStats(1, 0);
			return;
		}
		if (key.upArrow) {
			setStatsFocus((f) => Math.max(0, f - 1) as 0 | 1 | 2);
			return;
		}
		if (key.downArrow) {
			setStatsFocus((f) => Math.min(statsAxisCount - 1, f + 1) as 0 | 1 | 2);
			return;
		}
		const dir =
			key.leftArrow ? -1
			: key.rightArrow ? 1
			: 0;
		if (dir === 0) return;
		if (statsFocus === 0) {
			setStatsDimension((d) => ((d + dir + 3) % 3) as 0 | 1 | 2);
			setStatsEntry(0);
			setStatsFocus((f) => Math.min(f, 1) as 0 | 1 | 2); // Entry row may vanish; keep focus valid
			resetStatsScroll();
			return;
		}
		if (statsFocus === 1) {
			setStatsWindow((w) => (w === 0 ? 1 : 0));
			return;
		}
		const count = statsBoard.entry?.count ?? 1;
		setStatsEntry((e) => (e + dir + count) % count);
		resetStatsScroll();
	};

	// Space/Enter on a Statusline row: in a widget group, flip the highlighted widget; in Format, Currency
	// opens the currency picker overlay and Budget hands off to the existing text/number editing
	// machinery. The form cursor MUST land on Budget's index (1) in sectionFields(5), never left at 0, or
	// handleEditingKey's commit would overwrite Currency instead.
	const activateStatuslineRow = (state: RailState): void => {
		const group = WIDGET_GROUPS[state.catCursor] ?? WIDGET_GROUPS[0];
		if (group?.name === "Format") {
			if (Math.min(state.itemCursor, 1) === 1) {
				setCursor(1);
				setBuffer(fields[1]?.raw ?? "");
				setEditing(true);
			} else {
				setCurrencyQuery("");
				setOverlayCursor(0);
				setNav({ ...nav, overlay: "currency" });
			}
			return;
		}
		const widgets = group?.widgets ?? [];
		const id = widgets[Math.min(state.itemCursor, widgets.length - 1)];
		if (id === undefined) return;
		const spec = fields.find((f) => f.id === `widget:${id}`);
		if (spec?.toggle) change(spec.toggle(draft));
	};

	// Statusline section: drive the category/list/detail rail across the seven groups (Format + six widget
	// groups). routeKey routes here only for field-nav keys in this content-zone section (digit-jump, Tab, /,
	// ?, and Ctrl+S fall through to the global dispatcher).
	const handleStatuslineKey = (input: string, key: Key): void => {
		const group = WIDGET_GROUPS[statuslineRail.catCursor] ?? WIDGET_GROUPS[0];
		const listLength = group?.name === "Format" ? 2 : (group?.widgets.length ?? 0);
		const r = applyRailKey(statuslineRail, { input, key }, WIDGET_GROUPS.length, listLength);
		setStatuslineRail(r.state);
		if (r.exit) setNav({ ...nav, zone: "sidebar" });
		if (r.act) activateStatuslineRow(r.state);
	};

	// Save-confirm overlay: y/Enter installs, closing the popup only on success so a failed save keeps it
	// open with the error banner visible; Escape cancels without writing anything. Left/right page the
	// character carousel (wrapping). Swallows every key so nothing leaks to a section handler or the global
	// dispatcher while the modal is up.
	const pageSaveChar = (delta: number): void => {
		setSaveCharIdx((i) => (i + delta + savePreviewChars.length) % savePreviewChars.length);
		setSaveScrollX(0);
		setSaveScrollY(0);
	};
	const handleSaveKey = (input: string, key: Key): void => {
		if (input === "y" || key.return) {
			if (runInstall()) setNav({ ...nav, overlay: "none" });
		} else if (key.escape) {
			setNav({ ...nav, overlay: "none" });
		} else if (key.leftArrow) {
			pageSaveChar(-1);
		} else if (key.rightArrow) {
			pageSaveChar(1);
		} else if (input === "i") {
			scrollSave(0, -1);
		} else if (input === "k") {
			scrollSave(0, 1);
		} else if (input === "j") {
			scrollSave(-1, 0);
		} else if (input === "l") {
			scrollSave(1, 0);
		}
	};

	// The Save section's Enter opens the save-confirm popup. routeKey routes Enter here ahead of the generic
	// content handler, which would otherwise swallow it even though sectionFields(7) is empty.
	const handleSaveSectionKey = (): void => {
		setError(null);
		setSaveCharIdx(0);
		setSaveScrollX(0);
		setSaveScrollY(0);
		setNav({ ...nav, overlay: "save" });
	};

	// The Save section's only togglable target is the project (the sole target carrying a `cwd`); home
	// targets are always global. Bound to space rather than Enter: section 7 has no cursor to sit a
	// "toggle row" on, and Enter is already claimed by handleSaveSectionKey to open the save-confirm.
	const handleSaveToggleKey = (): void => {
		const next = targets.map((t): SaveTarget =>
			t.cwd !== undefined ? { ...t, scope: t.scope === "local" ? "global" : "local" } : t,
		);
		setTargets(next);
		setDirty(true);
	};

	// Content-zone field navigation and activation. routeKey routes here only for field-nav keys in a
	// content-zone form section (and inert keys in the empty Statistics/Save sections).
	const handleContentNavKey = (input: string, key: Key): void => {
		const r = applyContentKey(draft, fields, cursor, { input, key });
		setCursor(r.cursor);
		if (r.changed) change(r.draft);
		if (r.editing) {
			setBuffer(fields[r.cursor]?.raw ?? "");
			setEditing(true);
		}
		if (r.exit) setNav({ ...nav, zone: "sidebar" });
	};

	const quitNow = (): void => {
		if (onQuit) onQuit();
		else app.exit();
	};

	// A section jump or a fresh entry into a section's content zone starts every rail back at the
	// category column, so re-entering Character/Theme after leaving mid-column (Tab/Esc) never lands
	// on a stale list/detail focus.
	const resetRailFocus = (): void => {
		setCharacterRail((s) => ({ ...s, focus: 0 }));
		setThemeRail((s) => ({ ...s, focus: 0 }));
		setStatuslineRail((s) => ({ ...s, focus: 0 }));
		setStatsFocus(0);
		setStatsEntry(0);
		setStatsScrollX(0);
		setStatsScrollY(0);
	};

	// Global / zone / overlay routing.
	const handleGlobalKey = (input: string, key: Key): void => {
		const { state, action } = dispatchKey(nav, { input, key }, dirty);
		setNav(state);
		if (state.section !== nav.section) {
			setCursor(0); // a section jump starts at the first field
			resetRailFocus();
		}
		// Reopening the save-confirm (Ctrl+S) starts clean: a stale error from a previous failed
		// attempt must not reappear as if this attempt had already failed.
		if (state.overlay === "save" && nav.overlay !== "save") {
			setError(null);
			setSaveCharIdx(0);
			setSaveScrollX(0);
			setSaveScrollY(0);
		}
		if (action.type === "open") {
			setCursor(0);
			resetRailFocus();
		} else if (action.type === "quit") quitNow();
	};

	// Routing is data, not a fragile ordered if-chain: routeKey names the one handler that owns the key from
	// the focus context, and that handler runs its effect. The Record is exhaustive over InputRoute — a route
	// with no handler is a compile error.
	useInput((input, key) => {
		const route = routeKey(
			{ editing, zone: nav.zone, overlay: nav.overlay, section: nav.section },
			{ input, key },
		);
		switch (route) {
			case "editing":
				handleEditingKey(input, key);
				break;
			case "save":
				handleSaveKey(input, key);
				break;
			case "saveSection":
				handleSaveSectionKey();
				break;
			case "find":
				handleFindKey(input, key);
				break;
			case "currency":
				handleCurrencyKey(input, key);
				break;
			case "preview":
				handlePreviewKey(input);
				break;
			case "character":
				handleCharacterKey(input, key);
				break;
			case "theme":
				handleThemeKey(input, key);
				break;
			case "stats":
				handleStatsKey(input, key);
				break;
			case "statusline":
				handleStatuslineKey(input, key);
				break;
			case "saveToggle":
				handleSaveToggleKey();
				break;
			case "content":
				handleContentNavKey(input, key);
				break;
			case "global":
				handleGlobalKey(input, key);
				break;
		}
	});

	// The wide simulation renders at exactly the popup's own inner text budget (popupTextWidth) so the
	// statusline's right edge lands flush inside the frame -- PreviewPanel clips to that same budget, so
	// rendering any wider would just shave the figure's right columns off. The narrow ("w") simulation
	// instead caps near 44 cols to demonstrate real field truncation, well under the popup's budget.
	const previewBodyCols =
		previewNarrow ? Math.max(20, Math.min(48, columns - 2) - 4) : popupTextWidth(columns);
	// The real width available inside the Rail's detail column: the shell's own chrome
	// (CONTENT_CHROME_COLS, 27) plus the Rail's own internal chrome (category col 14 + VRule 3 + items
	// col 24 + VRule 3 + paddingLeft 2 = 46) together eat 73 columns from the terminal width.
	const themeDetailCols = Math.max(20, columns - 73);
	const scenario = useMemo(
		() => SCENARIOS[scenarioIndex] ?? SCENARIOS[0] ?? { label: "none" },
		[scenarioIndex],
	);
	// Off the synchronous keystroke render: renderScenario writes disk, so it runs on a trailing debounce from
	// a hook. The popup shows instantly and fills once the scenario/width settles.
	const previewBody = usePreviewBody(
		nav.overlay === "preview",
		scenario,
		draft,
		previewBodyCols,
		previewNoColor,
	);

	const detailIdx =
		characterRail.catCursor === 0 ?
			Math.max(0, Math.min(characterRail.itemCursor - 1, rosterList.length - 1))
		:	Math.min(characterRail.itemCursor, browseList.length - 1);
	const selectedCharId =
		(characterRail.catCursor === 0 ? rosterList : browseList)[detailIdx] ??
		packs[0] ??
		"batman";
	const characterDetail = useMemo<CharacterDetail>(() => {
		const res = loadPack(selectedCharId);
		if (!res.ok)
			return {
				ok: false,
				displayName: selectedCharId,
				figure: [],
				moods: [],
				artist: "",
				source: "",
				tone: "",
				emblem: "",
			};
		const p = res.pack;
		return {
			ok: true,
			displayName: p.displayName,
			figure: p.art,
			moods: Object.keys(p.lines.mood),
			artist: p.attribution.artist,
			source: p.attribution.source,
			tone: p.tone,
			emblem: p.emblem,
		};
	}, [selectedCharId]);

	// The highlighted theme's mini-statusline, shown only on the Theme section's Themes category. As with the
	// preview, the disk-writing render is kept off the keystroke path and debounced inside the hook.
	const themeDetailBody = useThemeDetailBody(
		nav.section === 1 && themeRail.catCursor === 0,
		themeRail.itemCursor,
		themeKeys,
		scenarioIndex,
		draft,
		themeDetailCols,
	);

	const clock = props.clock ?? systemClock;
	const metrics = useMemo<AllMetrics>(
		() => props.metrics ?? loadMetrics(root, clock),
		[props.metrics, root, clock],
	);

	const statsBoard = statsView(
		metrics,
		statsDimension,
		statsWindow,
		statsEntry,
		draft.line.budget,
	);
	// The present axis rows: View + Window always, plus the Project/Character entry row when it has entries.
	const statsAxisCount = statsBoard.entry !== null ? 3 : 2;
	const contentRows = Math.max(1, height - CONTENT_CHROME_ROWS);
	const contentCols = Math.max(20, columns - CONTENT_CHROME_COLS);

	// Stats board scroll bounds: the board (below the pinned axis rows) can be taller than its viewport, and its
	// widest element (the 60-day sparkline) can be wider than the pane, so both axes clamp to the content.
	const statsBoardViewRows = Math.max(1, contentRows - statsAxisRowCount(statsDimension) - 1);
	const statsBoardH = statsBoardHeight(statsBoard, contentCols);
	const statsBoardW = Math.max(contentCols, Math.min(statsBoard.sparkline.length, 60));
	const statsScrollXc = clampScroll(statsScrollX, statsBoardW, contentCols);
	const statsScrollYc = clampScroll(statsScrollY, statsBoardH, statsBoardViewRows);
	const scrollStats = useCallback(
		(dx: number, dy: number): void => {
			setStatsScrollX((x) => clampScroll(x + dx, statsBoardW, contentCols));
			setStatsScrollY((y) => clampScroll(y + dy, statsBoardH, statsBoardViewRows));
		},
		[statsBoardW, contentCols, statsBoardH, statsBoardViewRows],
	);

	// Mouse-wheel / trackpad scrolling for whichever box is live: the save-confirm popup, or the Stats board when
	// it holds the content-zone focus. Enabling terminal mouse tracking only while one of these is active keeps
	// normal text selection working the rest of the time.
	const statsFocused = nav.section === 6 && nav.zone === "content" && nav.overlay === "none";
	const wheelActive = nav.overlay === "save" || statsFocused;
	const onWheel = useCallback(
		(dx: number, dy: number): void => {
			if (nav.overlay === "save") scrollSave(dx, dy);
			else scrollStats(dx, dy);
		},
		[nav.overlay, scrollSave, scrollStats],
	);
	useMouseWheel(wheelActive, onWheel);

	// Below the layout floor everything is replaced by a resize notice. Placed after every hook so the hook order
	// stays identical whether or not the terminal is too small (React's rules-of-hooks).
	if (breakpoint === "floor") {
		return (
			<Popup
				title="Terminal too small"
				footer="resize to continue"
				columns={columns}
				rows={height}
				tokens={tokens}>
				<Text {...tokens.critical}>Resize to at least 80 x 24.</Text>
				<Text
					{...tokens.textMuted}>{`Current: ${String(columns)}x${String(height)}.`}</Text>
			</Popup>
		);
	}

	const buildSectionBody = (): ReactNode => {
		if (nav.section === 7)
			return (
				<InstallPanel
					scope={chipFor(targets)}
					dirty={dirty}
					targets={targets}
					tokens={tokens}
				/>
			);
		if (nav.section === 0)
			return (
				<CharacterSection
					state={characterRail}
					packs={packs}
					installed={installed}
					activeIds={activeIds}
					mode={draft.character.mode}
					detail={characterDetail}
					installStatus={installStatus}
					{...(installError !== null ? { errorMsg: installError } : {})}
					rows={contentRows}
					reducedMotion={reducedMotion}
					tokens={tokens}
					glyphs={glyphs}
					hues={theme.hues}
					nowMs={0}
					moodShift={draft.theme.mood_shift}
				/>
			);
		if (nav.section === 1)
			return (
				<ThemeSection
					state={themeRail}
					themeKeys={themeKeys}
					themes={themeTable}
					activeTheme={draft.theme.name}
					settingRows={themeSettingRows}
					detailBody={themeDetailBody}
					rows={contentRows}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		if (nav.section === 5)
			return (
				<StatuslineSection
					state={statuslineRail}
					config={draft}
					editing={editing}
					buffer={buffer}
					rows={contentRows}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		if (nav.section === 6)
			return (
				<StatsSection
					dimension={statsDimension}
					windowIdx={statsWindow}
					focus={Math.min(statsFocus, statsAxisCount - 1) as 0 | 1 | 2}
					view={statsBoard}
					maxRows={contentRows}
					contentWidth={contentCols}
					offsetX={statsScrollXc}
					offsetY={statsScrollYc}
					tokens={tokens}
				/>
			);
		if (fields.length > 0)
			return (
				<FormSection
					fields={fields}
					cursor={cursor}
					editing={editing}
					buffer={buffer}
					rows={contentRows}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		return null;
	};
	const sectionBody: ReactNode = buildSectionBody();

	const buildOverlayBody = (): ReactElement | null => {
		if (nav.overlay === "preview")
			return (
				<PreviewPanel
					label={scenario.label}
					body={previewBody}
					columns={columns}
					rows={height - POPUP_CHROME_ROWS}
					index={scenarioIndex}
					count={SCENARIOS.length}
					noColor={previewNoColor}
					narrow={previewNarrow}
					tokens={tokens}
				/>
			);
		if (nav.overlay === "help")
			return (
				<HelpPopup columns={columns} rows={height - POPUP_CHROME_ROWS} tokens={tokens} />
			);
		if (nav.overlay === "find")
			return (
				<FindPopup
					query={query}
					rows={findRows.map((e) => ({ id: e.id, label: e.label }))}
					cursor={overlayCursor}
					columns={columns}
					termRows={height - POPUP_CHROME_ROWS}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		if (nav.overlay === "currency")
			return (
				<CurrencyPicker
					query={currencyQuery}
					codes={currencyRows}
					cursor={overlayCursor}
					columns={columns}
					termRows={height - POPUP_CHROME_ROWS}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		if (nav.overlay === "save")
			return (
				<SaveConfirmPopup
					targets={targets}
					body={saveBody}
					charLabel={saveCharName}
					index={saveCharIdxClamped}
					count={savePreviewChars.length}
					offsetX={saveScrollXc}
					offsetY={saveScrollYc}
					viewportRows={saveViewRows}
					error={error}
					columns={columns}
					rows={height - POPUP_CHROME_ROWS}
					tokens={tokens}
				/>
			);
		if (nav.overlay === "quit")
			return (
				<Popup
					title="Discard changes?"
					footer="y quit · n/esc back"
					columns={columns}
					rows={height - POPUP_CHROME_ROWS}
					tokens={tokens}>
					<Text {...tokens.text}>You have unsaved edits.</Text>
					<Text {...tokens.textMuted}>y — discard and quit</Text>
					<Text {...tokens.textMuted}>n / esc — keep editing</Text>
				</Popup>
			);
		return null;
	};
	const overlayBody: ReactElement | null = buildOverlayBody();

	const content: ReactNode = (
		<Box flexDirection="column">
			{error !== null ?
				<Alert variant="error">{error}</Alert>
			:	null}
			{sectionBody}
		</Box>
	);

	return (
		<AppShell
			nav={nav}
			tokens={tokens}
			glyphs={glyphs}
			configDir={configDir}
			scope={chipFor(targets)}
			dirty={dirty}
			reducedMotion={reducedMotion}
			columns={columns}
			rows={height}
			collapsed={breakpoint === "narrow" && nav.zone === "content"}
			{...(overlayBody !== null ? { overlay: overlayBody } : {})}>
			{content}
		</AppShell>
	);
}
