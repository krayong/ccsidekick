// Pure field builders: each form section is `(draft) => FieldSpec[]`. Editors return a new Config; the dashboard
// owns cursor/dirty/editing. WIDGET_IDS is the ordered widget list (matches DEFAULT_CONFIG.line.widgets keys).

import { BANDINGS, MIN_SEVERITIES, type WidgetId } from "../../domain";
import { type Config, DEFAULT_CONFIG } from "../../sources";
import type { FieldSpec } from "../widgets";

const onOff = (b: boolean): string => (b ? "on" : "off");

export const WIDGET_IDS = Object.keys(DEFAULT_CONFIG.statusline.widgets) as readonly WidgetId[];

const step = <T extends string>(arr: readonly T[], cur: T, dir: 1 | -1): T => {
	const n = arr.length;
	const i = arr.indexOf(cur);
	return arr[(((i + dir) % n) + n) % n] ?? cur;
};

export function statuslineFields(d: Config): readonly FieldSpec[] {
	const currency: FieldSpec = {
		id: "currency",
		label: "Currency",
		kind: "text",
		value: d.statusline.currency,
		raw: d.statusline.currency,
		commit: (c, raw) => {
			const v = raw.trim().toUpperCase();
			return v === "" ? c : { ...c, statusline: { ...c.statusline, currency: v } };
		},
	};
	const budget: FieldSpec = {
		id: "budget",
		label: "Budget (USD/mo)",
		kind: "number",
		value: d.statusline.budget === undefined ? "off" : String(d.statusline.budget),
		raw: d.statusline.budget === undefined ? "" : String(d.statusline.budget),
		commit: (c, raw) => {
			const t = raw.trim();
			// Clearing budget rebuilds statusline without the key (exactOptionalPropertyTypes forbids undefined).
			if (t === "")
				return {
					...c,
					statusline: { currency: c.statusline.currency, widgets: c.statusline.widgets },
				};
			const n = Number(t);
			return Number.isFinite(n) && n >= 0 ?
					{ ...c, statusline: { ...c.statusline, budget: n } }
				:	c;
		},
	};
	const widgets: readonly FieldSpec[] = WIDGET_IDS.map((id) => ({
		id: `widget:${id}`,
		label: id,
		kind: "toggle",
		value: onOff(d.statusline.widgets[id]),
		toggle: (c) => ({
			...c,
			statusline: {
				...c.statusline,
				widgets: { ...c.statusline.widgets, [id]: !c.statusline.widgets[id] },
			},
		}),
	}));
	return [currency, budget, ...widgets];
}

export function themeSettingsFields(d: Config): readonly FieldSpec[] {
	return [
		{
			id: "banding",
			label: "Banding",
			kind: "cycle",
			value: d.theme.banding,
			next: (c) => ({
				...c,
				theme: { ...c.theme, banding: step(BANDINGS, c.theme.banding, 1) },
			}),
		},
		{
			id: "mood_shift",
			label: "Mood shift",
			kind: "toggle",
			value: onOff(d.theme.mood_shift),
			toggle: (c) => ({ ...c, theme: { ...c.theme, mood_shift: !c.theme.mood_shift } }),
		},
	];
}

// The Comments section: the character's own voice line (Character Comments) and the helpful-tip line (Helpful
// Comments), each an independent on/off. Min severity rides along under Helpful Comments and is only offered when
// that stream is on — with it off, the severity has no effect.
export function commentsFields(d: Config): readonly FieldSpec[] {
	const characterComments: FieldSpec = {
		id: "comments_character",
		label: "Character Comments",
		kind: "toggle",
		value: onOff(d.comments.character),
		toggle: (c) => ({ ...c, comments: { ...c.comments, character: !c.comments.character } }),
	};
	const helpfulComments: FieldSpec = {
		id: "comments_helpful",
		label: "Helpful Comments",
		kind: "toggle",
		value: onOff(d.comments.helpful),
		toggle: (c) => ({ ...c, comments: { ...c.comments, helpful: !c.comments.helpful } }),
	};
	const minSeverity: FieldSpec = {
		id: "min_severity",
		label: "Min severity",
		kind: "cycle",
		value: d.comments.min_severity,
		next: (c) => ({
			...c,
			comments: {
				...c.comments,
				min_severity: step(MIN_SEVERITIES, c.comments.min_severity, 1),
			},
		}),
	};
	return d.comments.helpful ?
			[characterComments, helpfulComments, minSeverity]
		:	[characterComments, helpfulComments];
}

export function networkFields(d: Config): readonly FieldSpec[] {
	return [
		{
			id: "fx_refresh",
			label: "FX refresh",
			kind: "toggle",
			value: onOff(d.network.fx_refresh),
			toggle: (c) => ({ ...c, network: { ...c.network, fx_refresh: !c.network.fx_refresh } }),
		},
		{
			id: "usage_fetch",
			label: "Usage fetch (sends OAuth token to Anthropic)",
			kind: "toggle",
			value: onOff(d.network.usage_fetch),
			toggle: (c) => ({
				...c,
				network: { ...c.network, usage_fetch: !c.network.usage_fetch },
			}),
		},
		{
			id: "balance_path",
			label: "Balance path",
			kind: "text",
			value: d.network.balance_path === "" ? "(none)" : d.network.balance_path,
			raw: d.network.balance_path,
			commit: (c, raw) => ({ ...c, network: { ...c.network, balance_path: raw.trim() } }),
		},
	];
}

export function sectionFields(section: number, d: Config): readonly FieldSpec[] {
	switch (section) {
		case 1:
			return themeSettingsFields(d); // Theme
		case 2:
			return commentsFields(d); // Comments
		case 3:
			return networkFields(d); // Network
		case 4:
			return statuslineFields(d); // Statusline
		default:
			return [];
	}
}
