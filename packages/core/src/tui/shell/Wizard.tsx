// The first-run wizard: a linear Character → Theme → Comments → Review journey shown when the chosen config dir
// has no config.toml yet. It reuses the presentational section components (CharacterSection, FormSection) and the
// pure key reducers (applyRailKey, applyContentKey), keeping its own small step/draft state so it never couples
// into the Dashboard. Tab / Shift+Tab step forward/back; Ctrl+D leaves for the full dashboard carrying the draft;
// the last step saves through the same `save` path the dashboard uses.

import { Box, Text, useApp, useInput, type Key } from "ink";
import { type ReactElement, useState } from "react";

import { save } from "..";
import { THEMES, type ThemeData } from "../../data";
import { loadPack, PACKS } from "../../packs";
import { CHARACTER_THEME } from "../../render";
import { type Config, DEFAULT_CONFIG } from "../../sources";
import { CharacterSection, FormSection, commentsFields, type CharacterDetail } from "../sections";
import {
	detectCapability,
	glyphSet,
	hexForXterm,
	resolveTokens,
	type GlyphSet,
	type Tokens,
} from "../theme";
import { applyContentKey, applyRailKey, type RailState } from "../widgets";

import { chipFor, type SaveTarget } from "./saveTarget";
import { useThemeDetailBody } from "./scenarioBodies";

const STEPS = ["Character", "Theme", "Comments", "Review"] as const;

export interface WizardProps {
	readonly targets: readonly SaveTarget[];
	readonly renderBin?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly cols?: number;
	readonly rows?: number;
	readonly initialConfig?: Config;
	/** True when the wizard was reached from the dashboard carrying unsaved edits (Esc returns, never discards). */
	readonly initialDirty?: boolean;
	/** Leave the wizard for the full dashboard, carrying the current draft as its seed. */
	readonly onAdvanced?: (draft: Config) => void;
	readonly onQuit?: () => void;
	readonly onSave?: (config: Config, target: SaveTarget) => void;
}

// The theme choices the wizard offers: the character-following default first, then the built-in catalog. The
// dashboard's Theme section additionally offers per-pack themes and a live preview; the wizard keeps it to a flat
// pick so the journey stays short.
const THEME_ENTRIES: readonly { readonly key: string; readonly label: string }[] = [
	{ key: CHARACTER_THEME, label: "Match Character" },
	...Object.entries(THEMES as Record<string, ThemeData>).map(([key, t]) => ({
		key,
		label: t.displayName,
	})),
];
const THEME_KEYS = THEME_ENTRIES.map((e) => e.key);

// The Theme step body: a scrollable theme list on the left and, on the right, either a note (Match Character), a
// swatch of the built-in theme's hues and signal dots, plus the live mini-statusline preview. Extracted so the
// Wizard's step-dispatch stays a flat branch.
function ThemeStep(props: {
	readonly themeCursor: number;
	readonly selectedName: string;
	readonly contentRows: number;
	readonly preview: string;
	readonly tokens: Tokens;
	readonly glyphs: GlyphSet;
}): ReactElement {
	const { themeCursor, selectedName, contentRows, preview, tokens, glyphs } = props;
	const start = Math.max(0, themeCursor - contentRows + 2);
	const selKey = THEME_KEYS[themeCursor];
	const selData =
		selKey !== undefined ? (THEMES as Record<string, ThemeData>)[selKey] : undefined;
	return (
		<Box flexDirection="row">
			<Box flexDirection="column" width={28}>
				{THEME_ENTRIES.slice(start, start + (contentRows - 1)).map((entry, i) => {
					const active = start + i === themeCursor;
					const selected = entry.key === selectedName;
					return (
						<Text key={entry.key} {...(active ? tokens.accent : tokens.text)}>
							{active ? glyphs.marker : " "}{" "}
							{selected ? glyphs.tabActive : glyphs.tabInactive} {entry.label}
						</Text>
					);
				})}
			</Box>
			<Box flexDirection="column" flexGrow={1} paddingLeft={2}>
				{selKey === CHARACTER_THEME ?
					<Text {...tokens.textMuted}>Follows the active character&apos;s palette.</Text>
				: selData !== undefined ?
					<Box flexDirection="column">
						<Box>
							{selData.hues.map((h, i) => (
								<Text key={`h${String(i)}`} color={hexForXterm(h)}>
									██
								</Text>
							))}
						</Box>
						<Box>
							<Text color={hexForXterm(selData.signals.nominal)}>● </Text>
							<Text color={hexForXterm(selData.signals.caution)}>● </Text>
							<Text color={hexForXterm(selData.signals.critical)}>● </Text>
						</Box>
					</Box>
				:	null}
				{preview !== "" ?
					<Box marginTop={1}>
						<Text>{preview}</Text>
					</Box>
				:	null}
			</Box>
		</Box>
	);
}

// The figure palette for a character under the "Match character" default: the character's own pack theme hues,
// falling back to houston when the pack ships no theme. Without this the figure would paint from houston, since
// the sentinel resolves to no built-in theme.
function packThemeHues(id: string): readonly number[] {
	const res = loadPack(id);
	return res.ok && res.pack.theme ? res.pack.theme.hues : THEMES.houston.hues;
}

function characterDetailFor(id: string): CharacterDetail {
	const res = loadPack(id);
	if (!res.ok)
		return {
			ok: false,
			displayName: id,
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
}

export function Wizard(props: WizardProps): ReactElement {
	const { targets, renderBin = "ccsidekick-render", onAdvanced, onQuit, onSave } = props;
	const env = props.env ?? process.env;
	const columns = props.cols ?? 80;
	const rows = props.rows ?? 24;
	const app = useApp();

	const [step, setStep] = useState(0);
	const [draft, setDraft] = useState<Config>(props.initialConfig ?? DEFAULT_CONFIG);
	const [characterRail, setCharacterRail] = useState<RailState>({
		focus: 0,
		catCursor: 0,
		itemCursor: 0,
	});
	const [themeCursor, setThemeCursor] = useState(0);
	const [commentsCursor, setCommentsCursor] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	const capability = detectCapability(env);
	const theme: ThemeData =
		(THEMES as Record<string, ThemeData>)[draft.theme.name] ?? THEMES.houston;
	const tokens = resolveTokens(theme, capability);
	const glyphs = glyphSet(false);

	const packs: readonly string[] = [...PACKS];
	// In random mode an empty roster means "all", so every pack shows selected by default.
	const activeIds =
		draft.character.mode === "fixed" ? [draft.character.name]
		: draft.character.roster.length > 0 ? draft.character.roster
		: packs;
	const selectedCharId =
		characterRail.catCursor === 1 ?
			(packs[Math.max(0, Math.min(characterRail.itemCursor, packs.length - 1))] ??
			packs[0] ??
			"batman")
		: packs.includes(draft.character.name) ? draft.character.name
		: (packs[0] ?? "batman");
	const characterDetail = characterDetailFor(selectedCharId);
	const commentFields = commentsFields(draft);
	// Under Match Character (the default) the figure follows the selected character's own palette, not houston.
	const figureHues =
		draft.theme.name === CHARACTER_THEME ? packThemeHues(selectedCharId) : theme.hues;

	// The Theme step's live mini-statusline preview, rendered at the right column's width off the keystroke path
	// (the hook debounces its disk-writing render). Reuses the exact machinery the dashboard's Theme detail uses.
	const previewCols = Math.max(24, columns - 46);
	const themePreview = useThemeDetailBody(
		step === 1,
		themeCursor,
		THEME_KEYS,
		0,
		draft,
		previewCols,
	);

	const quit = (): void => {
		if (onQuit) onQuit();
		else app.exit();
	};

	const nextStep = (): void => {
		setStep((s) => Math.min(STEPS.length - 1, s + 1));
	};
	const prevStep = (): void => {
		setStep((s) => Math.max(0, s - 1));
	};

	const selectCharacter = (id: string): void => {
		setDraft((d) => {
			const ch = d.character;
			if (ch.mode === "fixed") return { ...d, character: { ...ch, name: id } };
			// Empty roster is the canonical "all"; toggle from the effective (all-when-empty) selection, then
			// canonicalize a full or empty result back to [] so only proper subsets persist.
			const current = ch.roster.length > 0 ? ch.roster : packs;
			const next = current.includes(id) ? current.filter((r) => r !== id) : [...current, id];
			const roster = next.length === packs.length || next.length === 0 ? [] : next;
			return { ...d, character: { ...ch, roster } };
		});
	};

	const activateCharacter = (state: RailState): void => {
		if (state.catCursor === 0) {
			const mode = state.itemCursor === 0 ? "fixed" : "random";
			setDraft((d) => ({ ...d, character: { ...d.character, mode } }));
			return;
		}
		const id = packs[Math.min(state.itemCursor, packs.length - 1)];
		if (id !== undefined) selectCharacter(id);
	};

	const handleCharacter = (input: string, key: Key): void => {
		const listLen = characterRail.catCursor === 0 ? 2 : packs.length;
		const r = applyRailKey(characterRail, { input, key }, 2, listLen);
		setCharacterRail(r.state);
		if (r.exit) prevStep();
		if (r.act) activateCharacter(r.state);
	};

	const handleTheme = (input: string, key: Key): void => {
		if (key.leftArrow || input === "a") {
			prevStep();
			return;
		}
		if (key.upArrow || input === "k" || input === "w") {
			setThemeCursor((c) => Math.max(0, c - 1));
			return;
		}
		if (key.downArrow || input === "j" || input === "s") {
			setThemeCursor((c) => Math.min(THEME_ENTRIES.length - 1, c + 1));
			return;
		}
		if (key.return || input === " ") {
			const entry = THEME_ENTRIES[themeCursor];
			if (entry !== undefined)
				setDraft((d) => ({ ...d, theme: { ...d.theme, name: entry.key } }));
		}
	};

	const handleComments = (input: string, key: Key): void => {
		const r = applyContentKey(draft, commentFields, commentsCursor, { input, key });
		setCommentsCursor(r.cursor);
		if (r.changed) setDraft(r.draft);
		if (r.exit) prevStep();
	};

	const doSave = (): void => {
		try {
			for (const t of targets) {
				const opts = {
					...(t.cwd !== undefined ? { cwd: t.cwd } : {}),
					...(t.wireLocalSettings !== undefined ?
						{ wireLocalSettings: t.wireLocalSettings }
					:	{}),
				};
				if (onSave) onSave(draft, t);
				else save(draft, t.scope, t.dir, renderBin, opts);
			}
			setError(null);
			setDone(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const handleReview = (input: string, key: Key): void => {
		if (key.leftArrow || input === "a") prevStep();
		else if (key.return || input === "y") doSave();
	};

	// Carried unsaved edits from the dashboard: Esc returns there rather than quitting and dropping them.
	const onEscape = (): void => {
		if (props.initialDirty === true && onAdvanced) onAdvanced(draft);
		else quit();
	};

	const routeStep = (input: string, key: Key): void => {
		if (step === 0) handleCharacter(input, key);
		else if (step === 1) handleTheme(input, key);
		else if (step === 2) handleComments(input, key);
		else handleReview(input, key);
	};

	useInput((input, key) => {
		if (done) {
			quit();
			return;
		}
		if (key.escape) {
			onEscape();
			return;
		}
		if (key.ctrl && input === "d") {
			if (onAdvanced) onAdvanced(draft);
			return;
		}
		if (key.tab) {
			if (key.shift) prevStep();
			else nextStep();
			return;
		}
		routeStep(input, key);
	});

	const contentRows = Math.max(3, rows - 8);

	const body = ((): ReactElement => {
		if (done)
			return (
				<Box flexDirection="column">
					<Text {...tokens.nominal}>
						✓ ccsidekick is set up. Press any key to finish.
					</Text>
					<Text {...tokens.textMuted}>Restart Claude Code to see your status line.</Text>
				</Box>
			);
		if (step === 0)
			return (
				<CharacterSection
					state={characterRail}
					packs={packs}
					activeIds={activeIds}
					mode={draft.character.mode}
					detail={characterDetail}
					rows={contentRows}
					tokens={tokens}
					glyphs={glyphs}
					hues={figureHues}
					nowMs={0}
					moodShift={draft.theme.mood_shift}
				/>
			);
		if (step === 1)
			return (
				<ThemeStep
					themeCursor={themeCursor}
					selectedName={draft.theme.name}
					contentRows={contentRows}
					preview={themePreview}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		if (step === 2)
			return (
				<FormSection
					fields={commentFields}
					cursor={commentsCursor}
					editing={false}
					buffer=""
					rows={contentRows}
					tokens={tokens}
					glyphs={glyphs}
				/>
			);
		return (
			<Box flexDirection="column">
				<Text {...tokens.accent}>Review</Text>
				<Text {...tokens.text}>
					Character: {draft.character.mode === "fixed" ? draft.character.name : "random"}
					{draft.character.mode === "random" ?
						` (${draft.character.roster.length > 0 ? draft.character.roster.join(", ") : "all"})`
					:	""}
				</Text>
				<Text {...tokens.text}>Theme: {draft.theme.name}</Text>
				<Text {...tokens.text}>
					Character Comments: {draft.comments.character ? "on" : "off"}
				</Text>
				<Text {...tokens.text}>
					Helpful Comments: {draft.comments.helpful ? "on" : "off"}
				</Text>
				<Text {...tokens.text}>Save to: {chipFor(targets)}</Text>
				<Box marginTop={1}>
					<Text {...tokens.nominal}>Press ↵ to save and wire ccsidekick.</Text>
				</Box>
			</Box>
		);
	})();

	const hints =
		done ? "any key to finish"
		: step === 3 ? "↵ save · shift+tab back · ^d advanced · esc quit"
		: "tab next · shift+tab back · ↵ select · ^d advanced · esc quit";

	return (
		<Box
			width={columns}
			height={rows}
			flexDirection="column"
			paddingX={1}
			borderStyle="round"
			borderColor={tokens.frame.color ?? "gray"}>
			<Box justifyContent="space-between" flexShrink={0}>
				<Text {...tokens.accent}>ccsidekick setup</Text>
				<Text {...tokens.textMuted}>
					Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}
				</Text>
			</Box>
			<Box flexShrink={0}>
				{STEPS.map((name, i) => {
					const mark =
						i < step ? glyphs.tabActive
						: i === step ? glyphs.marker
						: glyphs.tabInactive;
					const style =
						i === step ? tokens.accent
						: i < step ? tokens.text
						: tokens.textMuted;
					return (
						<Text key={name} {...style}>
							{mark} {name}
							{"   "}
						</Text>
					);
				})}
			</Box>
			{error !== null ?
				<Text {...tokens.critical}>! {error}</Text>
			:	null}
			<Box marginTop={1} flexGrow={1}>
				{body}
			</Box>
			<Box flexShrink={0}>
				<Text {...tokens.textMuted}>{hints}</Text>
			</Box>
		</Box>
	);
}
