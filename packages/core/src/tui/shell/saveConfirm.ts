// The save-confirm view model: the resolved save-target list and scope. Pure and Ink-free so it is
// unit-testable without the UI runtime. The confirm popup renders this alongside the character carousel.

import { chipFor, type SaveTarget } from "./saveTarget";

interface SaveConfirmView {
	readonly targets: readonly string[];
	readonly scope: "global" | "local" | "mixed";
}

export function buildSaveConfirm(targets: readonly SaveTarget[]): SaveConfirmView {
	return {
		targets: targets.map((t) => t.dir),
		scope: chipFor(targets),
	};
}
