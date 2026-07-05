import type { EventCategory, Mood, PressureMood, Provider, Severity, Stack, Tier } from "./enums";
import type { Project, Session } from "./ids";

/** A classified PostToolUse-family event (one line in events.jsonl). */
export interface Event {
	readonly ts: number;
	readonly category: EventCategory;
	readonly stack?: Stack;
}

/** Terminal context passed into render/ (never read from env inside render/). */
export interface TermContext {
	readonly columns: number;
	readonly noColor: boolean;
	readonly isTTY: boolean;
}

/** A role-tagged statusline segment. */
type SegmentRole = "icon" | "label" | "value" | "placeholder" | "separator";

export interface Segment {
	readonly role: SegmentRole;
	readonly text: string;
	/** Signal level for value segments; undefined ⇒ use the line band color. */
	readonly signal?: SignalLevel;
	/** When set, the segment is wrapped in an OSC 8 terminal hyperlink to this URL (color path only). */
	readonly href?: string;
}

export type SignalLevel = "nominal" | "caution" | "critical";

/** A composed statusline field: an ordered run of segments under a stable id. */
export interface Field {
	readonly id: WidgetId;
	readonly segments: readonly Segment[];
}

/**
 * Widget ids = the [line.widgets] config keys, bracket-accessed.
 * Effort is NOT a widget (renders inline in model); cost_pending is NOT a widget (the ⋯ placeholder).
 */
export type WidgetId =
	| "dir"
	| "added_dirs"
	| "session_name"
	| "git_branch"
	| "git_hash"
	| "git_tag"
	| "git_worktree"
	| "git_changes"
	| "git_ahead_behind"
	| "git_status"
	| "git_conflict"
	| "git_operation"
	| "git_stash"
	| "pr"
	| "model"
	| "fast_mode"
	| "thinking"
	| "output_style"
	| "agent"
	| "context_usage"
	| "compactions"
	| "cost_chat"
	| "cost_project"
	| "cost_total"
	| "cost_burn"
	| "block_usage"
	| "weekly_usage"
	| "balance"
	| "pay_as_you_go"
	| "cache_hit"
	| "token_burn"
	| "session_duration"
	| "todo";

export interface HelpfulComment {
	readonly id: string;
	readonly severity: Severity;
	readonly text: string;
}

export interface CharacterComment {
	readonly text: string;
}

/** The character mood actually rendered this tick (base or synthetic). */
export type RenderMood = Mood | PressureMood;

export type {
	EventCategory,
	Mood,
	PressureMood,
	Provider,
	Severity,
	Stack,
	Tier,
	Project,
	Session,
};
