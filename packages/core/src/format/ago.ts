import { ladder } from "./left";

const MIN = 60_000;
export const fmtAgo = (ms: number): string =>
	ms < MIN ? "just now" : `${ladder(ms).join(" ")} ago`;
export const fmtGap = (ms: number): string => ladder(ms).join(" ");
