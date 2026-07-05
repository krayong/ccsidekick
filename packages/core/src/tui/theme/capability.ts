// Terminal color capability for the TUI. Reads env once at startup. This is TUI-only and off the hot render
// path; the engine's own color gate remains NO_COLOR alone.

export type Capability = "full" | "basic" | "none";

/** Detect the color tier from the environment. NO_COLOR always wins and yields the no-color tier. */
export function detectCapability(env: NodeJS.ProcessEnv): Capability {
	if (env["NO_COLOR"] !== undefined) return "none";
	const colorterm = env["COLORTERM"] ?? "";
	if (colorterm === "truecolor" || colorterm === "24bit") return "full";
	if (/256|truecolor|direct/.test(env["TERM"] ?? "")) return "full";
	return "basic";
}
