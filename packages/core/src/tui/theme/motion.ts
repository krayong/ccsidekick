// The TUI reduced-motion flag, read once at startup. NO_COLOR (which also drops all color) always implies reduced
// motion; CCSIDEKICK_REDUCE_MOTION is the explicit opt-out for a color terminal that still wants no animation.
// Sibling of detectCapability; presence of the env var wins regardless of its value.

export function detectReducedMotion(env: NodeJS.ProcessEnv): boolean {
	if (env["NO_COLOR"] !== undefined) return true;
	if (env["CCSIDEKICK_REDUCE_MOTION"] !== undefined) return true;
	return false;
}
