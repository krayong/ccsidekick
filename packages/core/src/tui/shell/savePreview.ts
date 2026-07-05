// The set of characters the Save & install carousel previews: exactly the chosen character in fixed mode, and
// the selected roster (then installed, then the known pack union) in random mode. Pure so it is unit-testable
// without the TUI runtime.

import type { Config } from "../../sources";

/** The characters to preview on the save screen, in display order. Never empty (falls back to batman). */
export function savePreviewSet(
	config: Config,
	installed: readonly string[],
	packs: readonly string[],
): readonly string[] {
	if (config.character.mode === "fixed") return [config.character.name];
	const roster = config.character.roster;
	const set =
		roster.length > 0 ? roster
		: installed.length > 0 ? installed
		: packs;
	return set.length > 0 ? set : ["batman"];
}
