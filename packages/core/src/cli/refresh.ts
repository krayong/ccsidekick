// The detached child behind `ccsidekick-render refresh <usage|fx> <root>`: run one network refresh the render's
// persist tail already claimed, to completion. Spawned by `spawnRefresh`; writes nothing to stdout or stderr.

import { type Clock, runFxRefresh, runUsageRefresh } from "../sources";

/** Run the claimed refresh named by `args` (`[kind, root]`); an unknown kind or a missing root is a no-op. */
export async function runRefresh(
	args: readonly string[],
	clock: Clock,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const [kind, root] = args;
	if (root === undefined || root === "") return;
	if (kind === "usage") await runUsageRefresh(root, clock, { fetchImpl });
	else if (kind === "fx") await runFxRefresh(root, clock, { fetchImpl });
}
