#!/usr/bin/env bun
// Serve the built website/ locally for previewing the landing page. Dependency-free and offline —
// a small Bun static server, no external `serve` package, no python. Pairs with site:build.
//
//   bun run site:serve      # -> http://localhost:8129/
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

// The served files are generated (data.js, tokens.css, render-web.js, and the resolved templates), so
// build before serving so a fresh checkout previews correctly.
spawnSync("bun", ["run", "site:build"], {
	cwd: join(import.meta.dir, "..", ".."),
	stdio: "inherit",
});

const root = join(import.meta.dir, "..", "..", "website");
const envPort = Number(process.env["PORT"]);
const port = Number.isInteger(envPort) && envPort > 0 ? envPort : 8129;

// Honor website/_redirects the way the deployed Cloudflare Worker does, so redirect rules preview
// locally. Minimal: one "source target [status]" rule per line (comments/blanks skipped); the exact
// static paths we ship — no placeholders or splats.
const redirects = (() => {
	const rules: { from: string; to: string; status: number }[] = [];
	try {
		for (const line of readFileSync(join(root, "_redirects"), "utf8").split("\n")) {
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			const [from, to, code] = trimmed.split(/\s+/);
			if (from === undefined || to === undefined) continue;
			rules.push({
				from,
				to,
				status: code !== undefined && /^\d+$/.test(code) ? Number(code) : 302,
			});
		}
	} catch {
		// no _redirects file — serve without redirects
	}
	return rules;
})();

Bun.serve({
	port,
	async fetch(req) {
		let path: string;
		try {
			path = decodeURIComponent(new URL(req.url).pathname);
		} catch {
			return new Response("bad request", { status: 400 });
		}
		const redirect = redirects.find((r) => r.from === path);
		if (redirect) return Response.redirect(redirect.to, redirect.status);
		if (path.endsWith("/")) path += "index.html";
		const filePath = normalize(join(root, path));
		// stay inside website/ — reject any path that escapes the root
		if (filePath !== root && !filePath.startsWith(root + "/"))
			return new Response("forbidden", { status: 403 });
		const file = Bun.file(filePath);
		return (await file.exists()) ?
				new Response(file)
			:	new Response("not found", { status: 404 });
	},
});

console.log(`serving website/ → http://localhost:${port}/`);
