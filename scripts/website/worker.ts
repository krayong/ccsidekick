// The landing site's Worker. Everything falls through to the static assets except POST /e, an event sink that
// writes one Analytics Engine data point. Cloudflare Web Analytics is pageviews only and does not support
// custom events, which is why this exists at all.

interface Env {
	readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
	readonly EVENTS: { writeDataPoint: (point: { blobs: string[]; indexes: string[] }) => void };
}

const ORIGIN = "https://ccsidekick.krayong.com";
const MAX_BODY = 64;

/** The closed set of event names. An unknown name is dropped, so the endpoint cannot be used as a log sink. */
const ALLOWED = new Set([
	"demo_interacted",
	"install_copied",
	"github_clicked",
	"character_selected",
]);

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== "/e") return env.ASSETS.fetch(request);

		if (request.method !== "POST")
			return new Response(null, { status: 405, headers: { allow: "POST" } });

		// Browsers always set Origin on a non-GET request, same-origin included. Any non-browser client can
		// forge it, so this stops cross-site abuse and nothing else. Volume abuse needs a Cloudflare Rate
		// Limiting rule on /e, which is a dashboard object this repo cannot create or assert. Until that rule
		// exists, the header check below is the only control on a public write endpoint.
		if (request.headers.get("origin") !== ORIGIN) return new Response(null, { status: 403 });

		// Reject on the declared length before the body is ever buffered: `text()` would otherwise read up to
		// Cloudflare's 100 MB body cap into a 128 MB isolate. A chunked body carries no Content-Length, so an
		// absent or non-integer header is refused rather than read.
		const len = Number(request.headers.get("content-length"));
		if (!Number.isInteger(len) || len <= 0 || len > MAX_BODY) {
			await request.body?.cancel();
			return new Response(null, { status: 413 });
		}

		const name = await request.text();
		if (ALLOWED.has(name)) env.EVENTS.writeDataPoint({ blobs: [name], indexes: [name] });
		return new Response(null, { status: 204 });
	},
};
