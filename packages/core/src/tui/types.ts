import type { Config } from "../sources";

/** The common contract every config section component satisfies. */
export interface SectionProps {
	readonly draft: Config;
	/** True when this section owns keyboard focus. */
	readonly active: boolean;
	readonly onChange: (next: Config) => void;
	/** Return focus to the nav column. */
	readonly onExit: () => void;
	/**
	 * Row budget for the section's field list. Sections that can overflow window their fields around the cursor
	 * to this many rows; omitted (in tests) means render every field.
	 */
	readonly maxRows?: number;
}
