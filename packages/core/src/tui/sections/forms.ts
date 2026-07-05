// Pure field builders: each form section is `(draft) => FieldSpec[]`. Editors return a new Config; the dashboard
// owns cursor/dirty/editing. WIDGET_IDS is the ordered widget list (matches DEFAULT_CONFIG.line.widgets keys).

import type { WidgetId } from "../../domain";
import { type Config, DEFAULT_CONFIG } from "../../sources";
import type { FieldSpec } from "../widgets";

const onOff = (b: boolean): string => (b ? "on" : "off");

export const WIDGET_IDS = Object.keys(DEFAULT_CONFIG.line.widgets) as readonly WidgetId[];

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const BANDINGS = ["solid", "cycle"] as const;

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
		value: d.line.currency,
		raw: d.line.currency,
		commit: (c, raw) => {
			const v = raw.trim().toUpperCase();
			return v === "" ? c : { ...c, line: { ...c.line, currency: v } };
		},
	};
	const budget: FieldSpec = {
		id: "budget",
		label: "Budget (USD/mo)",
		kind: "number",
		value: d.line.budget === undefined ? "off" : String(d.line.budget),
		raw: d.line.budget === undefined ? "" : String(d.line.budget),
		commit: (c, raw) => {
			const t = raw.trim();
			// Clearing budget rebuilds line without the key (exactOptionalPropertyTypes forbids budget: undefined).
			if (t === "")
				return { ...c, line: { currency: c.line.currency, widgets: c.line.widgets } };
			const n = Number(t);
			return Number.isFinite(n) && n >= 0 ? { ...c, line: { ...c.line, budget: n } } : c;
		},
	};
	const widgets: readonly FieldSpec[] = WIDGET_IDS.map((id) => ({
		id: `widget:${id}`,
		label: id,
		kind: "toggle",
		value: onOff(d.line.widgets[id]),
		toggle: (c) => ({
			...c,
			line: { ...c.line, widgets: { ...c.line.widgets, [id]: !c.line.widgets[id] } },
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

export function voiceFields(d: Config): readonly FieldSpec[] {
	return [
		{
			id: "comments_enabled",
			label: "Comments",
			kind: "toggle",
			value: onOff(d.comments.enabled),
			toggle: (c) => ({ ...c, comments: { enabled: !c.comments.enabled } }),
		},
	];
}

export function tipsFields(d: Config): readonly FieldSpec[] {
	return [
		{
			id: "helpful_enabled",
			label: "Enabled",
			kind: "toggle",
			value: onOff(d.helpful.enabled),
			toggle: (c) => ({ ...c, helpful: { ...c.helpful, enabled: !c.helpful.enabled } }),
		},
		{
			id: "min_severity",
			label: "Min severity",
			kind: "cycle",
			value: d.helpful.min_severity,
			next: (c) => ({
				...c,
				helpful: {
					...c.helpful,
					min_severity: step(SEVERITIES, c.helpful.min_severity, 1),
				},
			}),
		},
	];
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
			return voiceFields(d); // Voice
		case 3:
			return tipsFields(d); // Tips
		case 4:
			return networkFields(d); // Network
		case 5:
			return statuslineFields(d); // Statusline
		default:
			return [];
	}
}
