import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Repo deployment context for helpful comments: the active kube context and terraform workspace. */
export interface HelpfulEnv {
	readonly kubeContext?: string;
	readonly tfWorkspace?: string;
}

/** Conditional-spread an optional key so the literal stays exactOptionalPropertyTypes-safe. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
	value !== undefined ? ({ [key]: value } as Record<K, V>) : {};

/** First path from `$KUBECONFIG` (colon/`;`-separated), else `~/.kube/config`. */
function kubeconfigPath(): string {
	const env = process.env["KUBECONFIG"];
	if (env !== undefined && env.trim() !== "") {
		const first = env.split(delimiter).find((p) => p.trim() !== "");
		if (first !== undefined) return first;
	}
	return join(homedir(), ".kube", "config");
}

/** Parse the `current-context` key out of the kubeconfig FILE (no `kubectl` subprocess). */
function readKubeContext(): string | undefined {
	try {
		const content = readFileSync(kubeconfigPath(), "utf8");
		const m = /^current-context:\s*(\S.*)$/m.exec(content);
		const raw = m?.[1];
		if (raw === undefined) return undefined;
		const ctx = raw.replace(/^["']|["']$/g, "").trim();
		return ctx !== "" ? ctx : undefined;
	} catch {
		return undefined;
	}
}

/** Read the active workspace from the `.terraform/environment` FILE (no `terraform` subprocess). */
function readTfWorkspace(cwd: string): string | undefined {
	try {
		const ws = readFileSync(join(cwd, ".terraform", "environment"), "utf8").trim();
		return ws !== "" ? ws : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Detect the repo's deployment context (kube current-context, terraform workspace) from local FILES only —
 * never spawning `kubectl`/`terraform`, since this runs on every gated render. Never throws.
 */
export function readHelpfulEnv(cwd: string): HelpfulEnv {
	return {
		...opt("kubeContext", readKubeContext()),
		...opt("tfWorkspace", readTfWorkspace(cwd)),
	};
}
