// Single source for the landing page's copy and identity URLs. Reusable strings (the tagline in
// <title>/og/twitter, the meta description, the image alt), the project's canonical locations (repo, npm,
// contact email), and the FAQ — which is otherwise duplicated between the visible <details> list and the
// JSON-LD FAQPage structured data, where the two silently drift. Templatized so each string appears once.
// `copy` holds the rest of the page's visible body prose (headings, kickers, ledes, feature blurbs, hero
// text, footer). Only pure-text elements live here — anything with inline markup (links, code, etc.) stays
// inline in the template. Count-dependent copy is interpolated here with the real numbers (buildContent
// takes counts) so content values never contain nested {{tokens}} — the single-pass resolver in
// site-template.ts stays correct. Release-varying values (version, counts) and the site base URL live in
// site-context.ts.
//
// IDENTITY holds the static, count-independent strings (URLs, product name, tagline, metadata). It is a
// module const so the count-derived strings that reuse those facts (a faq answer, the footer, a
// requirements line) can single-source them; buildContent spreads IDENTITY in and adds only the
// count-dependent copy (features, faq, sections).
export interface Identity {
	tagline: string;
	description: string;
	ogAlt: string;
	repoUrl: string;
	npmUrl: string;
	ownerUrl: string;
	email: string;
	productName: string;
	installCmd: string;
	author: string;
	keywords: string;
	os: string;
	nodeReq: string;
	licenseUrl: string;
	reelAria: string;
}

export interface Content extends Identity {
	features: readonly string[];
	faq: readonly { readonly q: string; readonly a: string }[];
	copy: {
		hero: { heading: string; subtitle: string };
		build: { kicker: string; heading: string; lede: string; charHint: string };
		characters: { kicker: string; lede: string; soon: string };
		theme: { kicker: string; lede: string; empty: string };
		widgets: { kicker: string; heading: string; lede: string; empty: string };
		cost: { kicker: string; lede: string };
		about: {
			kicker: string;
			heading: string;
			cols: readonly { readonly heading: string; readonly body: string }[];
		};
		faq: { kicker: string; heading: string };
		footer: string;
	};
}

const IDENTITY: Identity = {
	tagline: "A reactive character for your Claude Code status line",
	description:
		"A Claude Code status line with a character that reacts, plus cost tracking, git, and token usage from your transcripts at zero token spend. npx ccsidekick",
	ogAlt: "ccsidekick wordmark above a rendered Claude Code status line with a Spider-Man ASCII character",
	repoUrl: "https://github.com/krayong/ccsidekick",
	npmUrl: "https://www.npmjs.com/package/ccsidekick",
	ownerUrl: "https://github.com/krayong",
	email: "ccsidekick@krayong.com",
	productName: "ccsidekick",
	installCmd: "npx ccsidekick",
	author: "Karan Gourisaria",
	keywords:
		"claude code status line, claude code statusline, claude code cost tracking, claude code themes, claude code widgets",
	os: "macOS, Linux, Windows",
	nodeReq: "Node.js 20.6 or newer",
	licenseUrl: "https://opensource.org/licenses/MIT",
	reelAria:
		"ccsidekick cycling through its character packs, each reacting to the session in its own theme with an in-character comment",
};

export function buildContent(counts: {
	characters: number;
	themes: number;
	widgets: number;
}): Content {
	return {
		...IDENTITY,
		features: [
			"Reactive ASCII character that comments on tests, builds, and commits",
			"Transcript-derived cost tracking, deduped globally by (message.id, requestId)",
			`${counts.widgets} toggleable status-line widgets: git, PR, token context, burn rate, cost`,
			`${counts.themes}+ built-in themes`,
			`${counts.characters} bundled character packs`,
			"Zero token spend, no Claude API, local-first",
		],
		faq: [
			{
				q: "What is ccsidekick?",
				a: IDENTITY.description,
			},
			{
				q: "Does ccsidekick use the Claude API or spend tokens?",
				a: "No. Zero token spend, no Claude API, and no network on the render path. Cost is read from your local Claude Code transcripts.",
			},
			{
				q: "How does it calculate cost?",
				a: "It token-prices your Claude Code transcripts in-house and dedupes globally by (message.id, requestId), which fixes the over-count Claude Code reports when you resume a session.",
			},
			{
				q: "Is my data private?",
				a: "Yes. It is local-first: all state stays on disk under ~/.claude/. The only network use is an optional weekly rate refresh and an account-usage lookup, both off by default and neither on the render path.",
			},
			{
				q: "How do I install it?",
				a: "Run npx ccsidekick for the guided setup, or npx ccsidekick setup with flags for a non-interactive install.",
			},
			{
				q: "How many characters, themes, and widgets are there?",
				a: `${counts.characters} bundled characters, ${counts.themes}+ themes, and ${counts.widgets} widgets, all shipped with no download step.`,
			},
			{
				q: "Can I add my own character?",
				a: "Yes. Character packs are pure data (never executed code), and the pack-author path documents building one.",
			},
			{
				q: "What are the requirements?",
				a: `${IDENTITY.nodeReq} (the render path runs under plain Node). MIT licensed.`,
			},
		],
		copy: {
			hero: {
				heading:
					"ccsidekick: a Claude Code status line with a character that reacts to your session",
				subtitle:
					"When a test passes, a build breaks, or a commit lands, your character reacts in its own voice, and warms to you across sessions. Every pack brings its own theme, and nothing it shows costs a token.",
			},
			build: {
				kicker: "build your own",
				heading: "Design your status line. Watch it render.",
				lede: "Pick a character, a theme, and the fields you want, then copy one command to install exactly that.",
				charHint: "Pick one to pin it, or several to rotate them at random.",
			},
			characters: {
				kicker: "pick your fighter",
				lede: "Pin one in fixed mode, or rotate a roster at random. Tap any character to see its theme.",
				soon: "More characters coming soon. Requests welcome on GitHub.",
			},
			theme: {
				kicker: "every surface, themed",
				lede: "Every theme paints the whole status line: figure, fields, and signal colors. Pick a character's own look or a generic editor theme. Tap one to load it into the build above.",
				empty: "No themes match that search.",
			},
			widgets: {
				kicker: "toggle any field",
				heading: `${counts.widgets} widgets, each one optional.`,
				lede: "Every field in the status line is a widget you can switch on or off, with its own icon, name, and live value.",
				empty: "No widgets match that search.",
			},
			cost: {
				kicker: "the cost is actually right",
				lede: "Chat, project, and all-time spend get token-priced straight from your transcripts, then deduped across the whole tree. That corrects the total that Claude Code over-counts when you resume a session. No Claude API, and no network on the render path.",
			},
			about: {
				kicker: "about",
				heading: "Built for people who live in Claude Code.",
				cols: [
					{
						heading: "What it is",
						body: "A status line for Claude Code with a reactive character and a full widget layer. It takes over the default line the moment you install it.",
					},
					{
						heading: "Why it exists",
						body: "So you can tell what a session is doing and what it costs, without spending tokens or sending your data anywhere.",
					},
					{
						heading: "How it works",
						body: "Packs are pure data, never code. Cost comes from your local transcripts. State stays on disk. The only network use is a weekly rate refresh and an account-usage lookup, both off by default and neither on the render path.",
					},
				],
			},
			faq: {
				kicker: "questions",
				heading: "FAQ",
			},
			footer: `Released under the MIT License. Copyright © 2026 ${IDENTITY.author}`,
		},
	};
}
