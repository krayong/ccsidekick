import type { EventCategory, Mood, PressureMood, ReactionCategory, Stack, Tier } from "./enums";

export type GreetingBucket = "morning" | "day" | "evening" | "night" | "weekend";
export type MilestoneType = "tier_up" | "comeback" | "streak" | "anniversary";
export type PositiveGitMoment = "clean_tree" | "op_cleared" | "branch_created" | "tag_pushed";
export type StackMoment = "slow" | "fail";

export interface PackLines {
	readonly mood: Record<Mood, Record<Tier, readonly string[]>>;
	readonly greeting: Record<GreetingBucket, Record<Tier, readonly string[]>>;
	readonly firstContact: Record<Tier, readonly string[]>;
	readonly milestone: Record<MilestoneType, Record<Tier, readonly string[]>>;
	readonly positiveGit: Record<PositiveGitMoment, Record<Tier, readonly string[]>>;
	readonly egg: Record<Tier, readonly string[]>;
	readonly event: Record<ReactionCategory, readonly string[]>;
	readonly stack: Record<Stack, Record<StackMoment, readonly string[]>>;
	readonly pressure: Record<PressureMood, readonly string[]>;
	readonly dateEgg: readonly string[];
}

// A pack-contributed theme: the full ThemeData schema minus displayName (which comes from pack.displayName).
export interface PackTheme {
	readonly hues: readonly number[]; // 4..5 visible xterm-256 indices
	readonly comment: readonly number[]; // 2..3 vivid xterm-256 indices
	readonly signals: {
		readonly nominal: number;
		readonly caution: number;
		readonly critical: number;
	};
	readonly separator: number;
}

export interface PackAttribution {
	readonly artist: string;
	readonly source: string;
}

export interface PackJson {
	readonly schema: 1;
	readonly name: string;
	readonly displayName: string;
	readonly attribution: PackAttribution;
	readonly emblem: string;
	readonly tone: "mild" | "edgy" | "offensive";
	readonly theme?: PackTheme;
	readonly art: readonly string[]; // the single figure: 1..9 rows, each ≤25 display cols
	readonly lines: PackLines;
	readonly spinnerVerbs: readonly string[];
}

export type { EventCategory, Mood, PressureMood, Stack, Tier };
