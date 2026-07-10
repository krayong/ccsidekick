// Tiny in-memory bridge shared by the browser fs / child_process shims and the web render entry. The render
// pipeline reads its config, transcript tree, and git state from disk / subprocesses; in the browser there is
// none, so the entry stashes generated inputs here and the shims serve them. Project-level config is always empty.

interface Vfs {
	/** The global `<root>/config.toml` text the fs shim returns; the web entry sets this before each render. */
	configToml: string;
	/** Virtual files (absolute path → contents) the fs shim serves for stat/read/readdir/exists. */
	files: Map<string, string>;
	/** The canned `git` runner the child_process shim delegates to; `null` ⇒ report a clean subprocess failure. */
	gitRunner: ((args: readonly string[]) => string) | null;
}

export const vfs: Vfs = { configToml: "", files: new Map(), gitRunner: null };
