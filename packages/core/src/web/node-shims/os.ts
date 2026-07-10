// Browser stand-in for `node:os`. Only `homedir`/`tmpdir` are reached on the render path (via configDir); their
// exact values are immaterial because every path built from them is served empty by the fs shim.

export function homedir(): string {
	return "/home/web";
}

export function tmpdir(): string {
	return "/tmp";
}
