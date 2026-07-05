import type { Event, EventCategory } from "../domain";

const FAILURES = new Set<EventCategory>(["test_fail", "build_fail", "typecheck_fail"]);
const WINS = new Set<EventCategory>(["test_pass", "build_pass", "typecheck_pass"]);
const GIT = new Set<EventCategory>([
	"git_commit",
	"git_push",
	"git_pull",
	"git_merge",
	"git_rebase",
	"git_branch",
	"git_tag",
	"git_stash",
	"force_push",
]);
const FILE_OPS = new Set<EventCategory>(["file_edit", "file_read", "search", "web_fetch"]);

/** Tiebreak rank for equal-timestamp events: failures (0) before wins, git, file ops, then meta (4). */
function categoryRank(c: EventCategory): number {
	if (FAILURES.has(c)) return 0;
	if (WINS.has(c)) return 1;
	if (GIT.has(c)) return 2;
	if (FILE_OPS.has(c)) return 3;
	return 4;
}

/**
 * The freshest classified event by timestamp (`readEvents` already drops entries past the read window). Ties
 * break by the fixed category order — failures before wins before git before file ops before meta — so an
 * equal-time `test_fail` and `git_commit` resolve to the fail.
 */
export function freshestEvent(events: readonly Event[]): Event | null {
	let best: Event | null = null;
	for (const e of events) {
		if (
			best === null ||
			e.ts > best.ts ||
			(e.ts === best.ts && categoryRank(e.category) < categoryRank(best.category))
		) {
			best = e;
		}
	}
	return best;
}
