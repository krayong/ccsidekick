// character.ts
export { composeCharacter } from "./character";
export type { CharacterInputs, CharacterResult, PendingMilestones } from "./character";

// statusline.ts
export { composeStatusline, dropOrder, FIELD_ROW, isProtected, rowFor } from "./statusline";
export type { ComposeInputs, RowId } from "./statusline";

// helpful/ — the tip catalog and resolver, re-exported so consumers reach it through ../compose
export {
	BALANCE_LOW,
	COMPACT_URGENT_PCT,
	HELPFUL_CATALOG,
	HOT_MS,
	PAY_AS_YOU_GO_NEAR_PCT,
	QUOTA_HIGH_PCT,
	resolveHelpful,
	SECRET_SAFE,
} from "./helpful";
export type { HelpfulCategory, HelpfulInputs, HelpfulTrigger } from "./helpful";
