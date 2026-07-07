// The pure global Find index: one entry per section (jump), one per FormSection field for the sections where the
// cursor is authoritative (Comments, Network), and the install/widget-toggle actions the retired Ctrl+P palette
// used to offer. Ranked with the shared fuzzy matcher. No React, no I/O — the run() thunks are closures the
// Dashboard owns.

import type { Config } from "../../sources";
import { SECTIONS } from "../nav";
import { WIDGET_IDS, sectionFields } from "../sections";
import { fuzzyFilter } from "../widgets";

interface FindEntry {
	readonly id: string;
	readonly label: string;
	readonly kind: "section" | "field" | "action";
	readonly run: () => void;
}

interface FindDeps {
	readonly config: Config;
	readonly goToSection: (index: number) => () => void;
	readonly focusField: (section: number, fieldIndex: number) => () => void;
	readonly runInstall: () => void;
	readonly toggleWidget: (id: string) => () => void;
	readonly openCurrencyPicker: () => void;
	readonly beginBudgetEdit: () => void;
}

// The FormSection-backed sections, where the cursor a Find field-jump would set is authoritative. Character
// (0), Theme (1), Statusline (4, the widget rail), Statistics (5), and Save (6) drive their own cursors (or
// none), so a field jump into them would misfire.
const FORM_SECTIONS = [2, 3] as const;

export function buildFindIndex(deps: FindDeps): readonly FindEntry[] {
	const sections: readonly FindEntry[] = SECTIONS.map((name, i) => ({
		id: `section:${String(i)}`,
		label: name,
		kind: "section" as const,
		run: deps.goToSection(i),
	}));

	const fields: readonly FindEntry[] = FORM_SECTIONS.flatMap((section) => {
		const name = SECTIONS[section];
		return sectionFields(section, deps.config).map((field, fieldIndex) => ({
			id: `field:${String(section)}:${field.id}`,
			label: `${name} › ${field.label}`,
			kind: "field" as const,
			run: deps.focusField(section, fieldIndex),
		}));
	});

	const toggles: readonly FindEntry[] = WIDGET_IDS.map((id) => ({
		id: `toggle:${id}`,
		label: `Toggle ${id}`,
		kind: "action" as const,
		run: deps.toggleWidget(id),
	}));

	// The Statusline rail's two Format rows are not FormSection fields (they have no cursor a field jump
	// could set); index them as bespoke actions instead, alongside the widget toggles above.
	const statuslineExtras: readonly FindEntry[] = [
		{
			id: "statusline:currency",
			label: "Statusline › Currency",
			kind: "action",
			run: deps.openCurrencyPicker,
		},
		{
			id: "statusline:budget",
			label: "Statusline › Budget",
			kind: "action",
			run: deps.beginBudgetEdit,
		},
	];

	const install: FindEntry = {
		id: "install:run",
		label: "Save & install",
		kind: "action",
		run: deps.runInstall,
	};

	return [...sections, ...fields, ...toggles, ...statuslineExtras, install];
}

export function rankFind(query: string, entries: readonly FindEntry[]): readonly FindEntry[] {
	return query === "" ? entries : fuzzyFilter(query, entries, (e) => e.label);
}
