// Public barrel for sources/. Re-exports exactly the symbols consumed by code outside this directory.
// Types that transcript.ts re-exports from costCache (CostAggregate, CostCache, CostFileEntry, etc.)
// are intentionally exported only from ./costCache here to avoid TS2308 ambiguous re-export.

// analyticsStore
export type { AttributionEntry, AttributionStore } from "./analyticsStore";
export { readAttribution, upsertAttribution } from "./analyticsStore";

// balance
export type { BalanceSnapshot } from "./balance";
export { readBalance } from "./balance";

// clock
export type { Clock } from "./clock";
export { fixedClock, systemClock } from "./clock";

// config
export type { Config } from "./config";
export { DEFAULT_CONFIG, loadConfig } from "./config";

// costCache — also owns CostAggregate, CostCache, CostFileEntry (transcript re-exports these)
export type { CostAggregate, CostCache, CostFileEntry } from "./costCache";
export { readCostCache, writeCostCache } from "./costCache";

// creds
export type { CredsInfo } from "./creds";
export { readCreds } from "./creds";

// env
export type { EnvInputs } from "./env";
export { readEnv, readModelAliases } from "./env";

// events
export { appendEvent, readEvents } from "./events";

// fx
export { readFx, readFxCached } from "./fx";

// git
export type { GitState } from "./git";
export { readGit } from "./git";

// helpfulEnv
export type { HelpfulEnv } from "./helpfulEnv";
export { readHelpfulEnv } from "./helpfulEnv";

// markers
export type { MarkerSet } from "./markers";
export { readMarkers } from "./markers";

// modelNames
export { learnModelName, readModelNames } from "./modelNames";

// oauthUsage
export type { OAuthQuota, UsageData } from "./oauthUsage";
export { readUsage, readUsageCached } from "./oauthUsage";

// payload
export type { Payload } from "./payload";
export { parsePayload } from "./payload";

// state
export type { SessionState } from "./state";
export { readState, writeState } from "./state";

// storage
export { atomicWrite, ccsidekickRoot, sessionDir } from "./storage";

// transcript — only types/values native to this module; CostAggregate, CostCache, CostFileEntry
// are exported from ./costCache above to prevent ambiguous re-export
export type {
	BurnBucket,
	PriceFn,
	ResolveProject,
	TokenSums,
	TranscriptScan,
	Usage,
} from "./transcript";
export { projectKeyForCwd, repoRootForCwd, scanCostTree, scanTranscript } from "./transcript";
