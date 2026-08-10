// scripts/website/worker.test.ts
// The /e endpoint is public, unauthenticated, and reachable from the internet the moment the site deploys.
// There is no preview URL and no staging origin (wrangler.jsonc sets workers_dev and preview_urls to false),
// so production is the only other place this code ever runs. These tests are the whole pre-deploy exercise.

import { describe, expect, test } from "bun:test";

import worker from "./worker";

const ORIGIN = "https://ccsidekick.krayong.com";

interface Written {
	blobs: string[];
	indexes: string[];
}

/** A stub Env that records every data point and proves whether ASSETS was reached instead. */
function stubEnv(): {
	env: Parameters<typeof worker.fetch>[1];
	written: Written[];
	assetHits: string[];
} {
	const written: Written[] = [];
	const assetHits: string[] = [];
	const env = {
		ASSETS: {
			fetch: (request: Request): Promise<Response> => {
				assetHits.push(new URL(request.url).pathname);
				return Promise.resolve(new Response("asset", { status: 200 }));
			},
		},
		EVENTS: {
			writeDataPoint: (point: Written): void => {
				written.push(point);
			},
		},
	};
	return { env, written, assetHits };
}

/** A POST to /e with an explicit Content-Length, matching what `navigator.sendBeacon` produces. */
function post(body: string, headers: Record<string, string> = {}): Request {
	return new Request(`${ORIGIN}/e`, {
		method: "POST",
		body,
		headers: {
			origin: ORIGIN,
			"content-length": String(new TextEncoder().encode(body).length),
			...headers,
		},
	});
}

describe("POST /e", () => {
	test("accepts an allowed event and writes exactly one data point", async () => {
		const { env, written } = stubEnv();
		const res = await worker.fetch(post("install_copied"), env);
		expect(res.status).toBe(204);
		expect(written).toEqual([{ blobs: ["install_copied"], indexes: ["install_copied"] }]);
	});

	// The closed set is what stops the endpoint becoming an arbitrary log sink. An unknown name is dropped
	// silently rather than rejected, so a stale client never sees an error.
	test("drops an unknown event name without writing", async () => {
		const { env, written } = stubEnv();
		const res = await worker.fetch(post("arbitrary_attacker_string"), env);
		expect(res.status).toBe(204);
		expect(written).toHaveLength(0);
	});

	test("matches event names exactly, so no prefix or whitespace variant slips through", async () => {
		const { env, written } = stubEnv();
		for (const name of ["install_copied\n", " install_copied", "install", "INSTALL_COPIED"]) {
			await worker.fetch(post(name), env);
		}
		expect(written).toHaveLength(0);
	});
});

const BAD_ORIGINS: readonly (readonly [string, Record<string, string>])[] = [
	["a missing Origin", {}],
	["a foreign Origin", { origin: "https://evil.example" }],
	// A sandboxed iframe or a data: URL sends the literal string "null".
	["the literal null Origin", { origin: "null" }],
	// The value compare is exact; a trailing slash is not what a browser sends.
	["a trailing-slash Origin", { origin: `${ORIGIN}/` }],
];

describe("POST /e rejections", () => {
	test.each(BAD_ORIGINS)("403s on %s", async (_label, headers) => {
		const { env, written } = stubEnv();
		const req = new Request(`${ORIGIN}/e`, {
			method: "POST",
			body: "install_copied",
			headers: { "content-length": "14", ...headers },
		});
		// `Request` always supplies its own origin-less headers unless set, so delete when testing absence.
		if (!("origin" in headers)) req.headers.delete("origin");
		const res = await worker.fetch(req, env);
		expect(res.status).toBe(403);
		expect(written).toHaveLength(0);
	});

	// The guard runs before any body read. Cloudflare caps a request body at 100 MB and the isolate has
	// 128 MB, so buffering first would be a one-request out-of-memory kill.
	test("413s on an oversized body without writing", async () => {
		const { env, written } = stubEnv();
		const res = await worker.fetch(post("x".repeat(65)), env);
		expect(res.status).toBe(413);
		expect(written).toHaveLength(0);
	});

	// A chunked body carries no Content-Length. Refusing it is deliberate: sendBeacon always sets one.
	test("413s when Content-Length is not a positive integer", async () => {
		const { env } = stubEnv();
		for (const value of ["", "0", "-1", "abc", "12.5"]) {
			const req = new Request(`${ORIGIN}/e`, {
				method: "POST",
				body: "install_copied",
				headers: { origin: ORIGIN },
			});
			req.headers.set("content-length", value);
			expect((await worker.fetch(req, env)).status).toBe(413);
		}
	});

	// The absent case is separate because the header has to be deleted after construction: `Request` sets
	// its own Content-Length from the body. `Number(null)` is 0, which the guard rejects.
	test("413s when Content-Length is absent entirely", async () => {
		const { env, written } = stubEnv();
		const req = new Request(`${ORIGIN}/e`, {
			method: "POST",
			body: "install_copied",
			headers: { origin: ORIGIN },
		});
		req.headers.delete("content-length");
		expect(req.headers.get("content-length")).toBeNull();
		expect((await worker.fetch(req, env)).status).toBe(413);
		expect(written).toHaveLength(0);
	});

	test.each(["GET", "HEAD", "PUT", "DELETE"])(
		"405s on %s and advertises POST",
		async (method) => {
			const { env, written } = stubEnv();
			const res = await worker.fetch(
				new Request(`${ORIGIN}/e`, { method, headers: { origin: ORIGIN } }),
				env,
			);
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("POST");
			expect(written).toHaveLength(0);
		},
	);
});

describe("every other path", () => {
	// run_worker_first is ["/e"] and the match is exact, so these reach the Worker only in tests. The
	// assertion that matters is that the Worker never swallows a page request.
	test.each(["/", "/index.html", "/e/", "/E", "/nonexistent"])(
		"falls through to ASSETS for %s",
		async (path) => {
			const { env, written, assetHits } = stubEnv();
			const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env);
			expect(res.status).toBe(200);
			expect(assetHits).toEqual([path]);
			expect(written).toHaveLength(0);
		},
	);
});
