export const COST_TTL_MS = 5000;
export const REFRESH_INTERVAL_SEC = 1; // written to settings.json statusLine.refreshInterval (seconds, min 1)
export const USAGE_TTL_MS = 300_000;
export const CREDS_TTL_MS = 3_600_000; // 1h: the subscription tier is near-static, so refresh it rarely
export const BALANCE_FRESHNESS_MS = 300_000;
export const FX_TTL_MS = 604_800_000; // 7 days
export const MIN_RIGHT_WIDTH = 53;
export const FIGURE_COLS = 25;
export const FIGURE_ROWS = 9;
export const GAP = 2;
export const DEFAULT_COLUMNS = 100;
export const EVENT_LOG_MAX = 200;
export const SESSION_TTL_DAYS = 30;
export const HOT_MS = 15_000;
export const MOOD_WINDOW_MS = 300_000;
export const IDLE_ROTATE_MS = 900_000;
export const MOOD_FAIL_N = 3;
export const EGG_EVERY_N = 12;
export const COMEBACK_GAP_DAYS = 3;
export const STREAK_MILESTONES = [3, 7, 30, 100] as const;
export const SESSION_MILESTONES = [10, 50, 100, 250, 500] as const;
export const STREAK_GRACE_DAYS = 1; // Current Streak survives one missed day
export const RECENT_WINDOW_DAYS = 30; // TUI analytics "recent" window
export const ANALYTICS_TTL_MS = 1500; // TUI-only aggregate refresh gate
export const CHAR_LINE_MAX = 66;
export const HELPFUL_MAX_LEN = 80;
export const HELPFUL_SHOW_MS = 300_000; // transient show window + momentary-critical min show
export const HELPFUL_COOLDOWN_MS = 600_000; // transient cooldown (non-critical)
export const JACCARD_DUP = 0.8;
export const CROSS_CELL_JACCARD = 0.85; // near-verbatim backstop across cells (within-cell is JACCARD_DUP=0.8)
export const POOL_TOTAL = 620;
export const SPINNER_VERB_MIN = 25;
export const BURN_WINDOW_MS = 18_000_000; // 5 hours
export const COMPACT_URGENT_PCT = 90; // context fullness where auto-compact is imminent
export const QUOTA_HIGH_PCT = 80; // 5h/weekly quota fullness: trips block_limit/weekly_limit pressure, the tip threshold, and the always-critical band cutoff
export const QUOTA_PACE_MIN_PCT = 20; // below this used%, ignore pace (avoids early-window false criticals)
export const QUOTA_PROJECT_MIN_PCT = 50; // min used% for the "will exhaust at this pace" tips
export const PAY_AS_YOU_GO_CAUTION_PCT = 60; // PAYG cap fullness above which the caution band kicks in
export const PAY_AS_YOU_GO_NEAR_PCT = 80; // PAYG credits fullness that flags the near-cap (critical) band
export const BALANCE_LOW = 25; // prepaid balance (USD) below which the balance band reads low
export const SHIMMER_PERIOD_MS = 24000; // figure gradient drift period (wall-clock, no frame counter)
// Theme visibility cutoffs (no grey / no near-black). Applied to xterm cube indices 17..231.
export const THEME_CHROMA_MIN = 40; // max(R,G,B) − min(R,G,B) floor: rejects near-grey
export const THEME_MAXCH_MIN = 95; // max(R,G,B) floor: rejects too-dark-to-read on a dark background
// Signal hue families (HSV degrees). A theme may shade a signal, not invert its meaning.
export const SIGNAL_HUE_RANGES = {
	nominal: { min: 70, max: 165 }, // green-family
	caution: { min: 20, max: 55 }, // amber-family
	critical: { wrapMax: 15, wrapMin: 345 }, // red-family (wraps 0): h ≤ 15 OR h ≥ 345
} as const;

// Helpful-tip trigger thresholds (compose/helpful).
export const COMPACT_SOON_PCT = 60; // context fullness that flags "compact soon"
export const COMPACTION_THRASH_N = 3; // compactions in a session before flagging thrash
export const CACHE_RATIO_FLOOR = 0.5; // cache-hit fraction below which the low-cache tip can fire
export const CACHE_WARMUP_TURNS = 20; // messages before the cache-ratio tip is eligible
export const BIG_DIFF_LINES = 1000; // |insertions − deletions| that flags a very large diff
export const UNTRACKED_N = 20; // untracked files that flag clutter
export const STASH_N = 5; // stashes that flag stash buildup
export const STALE_BRANCH_N = 20; // commits behind default that flag a stale branch
export const TODO_STALLED_MIN = 30; // minutes an in-progress todo sits before "stalled"

// Cross-session analytics (derived/analytics, TUI).
export const TIER_THRESHOLDS = [3, 15, 50, 100] as const; // familiarity tier session-count cutoffs
export const DAILY_WINDOW_DAYS = 60; // TUI daily-activity window

// Pricing (derived/pricing).
export const PRICING_TIER_THRESHOLD = 200_000; // input tokens above which tiered (>200k) pricing applies
