import { asProject, type Project } from "../domain";
import type { GitState, Payload } from "../sources";

/**
 * Project key (the cost/analytics identity, not the displayed dir). Precedence: (1) payload `workspace.repo`
 * `owner/name` when both are present; (2) git `originRepo` (normalized `owner/repo`, so every clone merges);
 * (3) the absolute cwd path verbatim, used as the key for a non-repo or a remote-less repo.
 */
export function deriveProject(git: GitState | null, payload: Payload): Project {
	const repo = payload.workspace.repo;
	if (repo?.owner !== undefined && repo.name !== undefined) {
		return asProject(`${repo.owner}/${repo.name}`);
	}

	const origin = git?.originRepo;
	if (origin !== undefined && origin !== "") return asProject(origin);

	return asProject(payload.cwd ?? "");
}
