import type { EventCategory, Stack } from "../domain";

interface Classification {
	readonly category: EventCategory;
	readonly stack?: Stack;
}

/** The test/build/typecheck families resolve their pass/fail suffix from the tool's success (`ok`). */
type Family = "test" | "build" | "typecheck";

interface Rule {
	readonly match: (n: string) => boolean;
	readonly category?: EventCategory;
	readonly family?: Family;
}

// --- Non-Bash tool-name map (Task / TodoWrite are legacy aliases) ------------------------------------------

const TOOL_CATEGORY: ReadonlyMap<string, EventCategory> = new Map([
	["Edit", "file_edit"],
	["Write", "file_edit"],
	["NotebookEdit", "file_edit"],
	["Read", "file_read"],
	["Grep", "search"],
	["Glob", "search"],
	["WebFetch", "web_fetch"],
	["WebSearch", "web_fetch"],
	["Agent", "agent_spawn"],
	["Task", "agent_spawn"],
	["Skill", "skill_run"],
	["TaskCreate", "todo_update"],
	["TaskUpdate", "todo_update"],
	["TodoWrite", "todo_update"],
]);

// --- Program → stack tag (most-specific program; multi-stack programs carry no tag) ------------------------

const PROGRAM_STACK: ReadonlyMap<string, Stack> = new Map([
	["cargo", "rust"],
	["rustc", "rust"],
	["go", "go"],
	["mvn", "java"],
	["adb", "android"],
	["xcodebuild", "ios"],
	["swift", "ios"],
	["swiftc", "ios"],
	["pod", "ios"],
	["flutter", "flutter"],
	["dart", "flutter"],
	["react-native", "react-native"],
	["expo", "react-native"],
	["pytest", "python"],
	["pip", "python"],
	["pip3", "python"],
	["poetry", "python"],
	["uv", "python"],
	["python", "python"],
	["python3", "python"],
	["jupyter", "ml"],
	["Rscript", "r"],
	["R", "r"],
	["nest", "node"],
	["next", "web-framework"],
	["nuxt", "web-framework"],
	["vite", "web-framework"],
	["ng", "web-framework"],
	["svelte-kit", "web-framework"],
	["npm", "web"],
	["pnpm", "web"],
	["yarn", "web"],
	["bun", "web"],
	["node", "web"],
	["dotnet", "dotnet"],
	["cmake", "cpp"],
	["g++", "cpp"],
	["clang++", "cpp"],
	["ctest", "cpp"],
	["nvcc", "cuda"],
	["composer", "php"],
	["php", "php"],
	["artisan", "php"],
	["bundle", "ruby"],
	["gem", "ruby"],
	["rails", "ruby"],
	["rake", "ruby"],
	["rspec", "ruby"],
	["sbt", "scala"],
	["scala", "scala"],
	["psql", "sql"],
	["mysql", "sql"],
	["sqlite3", "sql"],
	["protoc", "protobuf"],
	["buf", "protobuf"],
	["graphql-codegen", "graphql"],
	["apollo", "graphql"],
	["docker", "docker"],
	["kubectl", "kubernetes"],
	["helm", "kubernetes"],
	["kustomize", "kubernetes"],
	["terraform", "terraform"],
	["pulumi", "terraform"],
	["godot", "game"],
	["unity", "game"],
	["mkdocs", "docs"],
	["sphinx", "docs"],
	["pdflatex", "docs"],
	["hugo", "docs"],
	["jekyll", "docs"],
]);

// --- Bash command rules, most-specific first --------------------------------------------------------------

const GRADLE = /^(?:\.\/)?gradlew?\b/;

const RULES: readonly Rule[] = [
	// destructive (outrank their family)
	{
		match: (n) =>
			/^git push\b/.test(n) && /(?:--force-with-lease|--force|(?:^| )-f)(?:$| )/.test(n),
		category: "force_push",
	},
	{
		match: (n) =>
			(/^rm\b/.test(n) && /(?:^| )-[^\sR]*R\S*f|(?:^| )-[^\sF]*F\S*r|--recursive/i.test(n)) ||
			/^git reset\b.*--hard/.test(n) ||
			/^git clean\b.* -\S*f/.test(n) ||
			/^kubectl delete\b/.test(n) ||
			/^terraform destroy\b/.test(n) ||
			/^dropdb\b/.test(n) ||
			(/^(?:psql|mysql)\b/.test(n) && /drop (?:table|database)/i.test(n)),
		category: "dangerous",
	},
	// git family
	{ match: (n) => /^git push\b/.test(n), category: "git_push" },
	{ match: (n) => /^git commit\b/.test(n), category: "git_commit" },
	{ match: (n) => /^git pull\b/.test(n), category: "git_pull" },
	{ match: (n) => /^git merge\b/.test(n), category: "git_merge" },
	{ match: (n) => /^git rebase\b/.test(n), category: "git_rebase" },
	{
		match: (n) =>
			/^git branch\b/.test(n) ||
			/^git switch\b.* -c\b/.test(n) ||
			/^git checkout\b.* -b\b/.test(n),
		category: "git_branch",
	},
	{ match: (n) => /^git tag\b/.test(n), category: "git_tag" },
	{ match: (n) => /^git stash\b/.test(n), category: "git_stash" },
	// test (outcome-bearing)
	{
		match: (n) =>
			/^pytest\b/.test(n) ||
			/^jest\b/.test(n) ||
			/^vitest\b/.test(n) ||
			/^mocha\b/.test(n) ||
			/^go test\b/.test(n) ||
			/^cargo test\b/.test(n) ||
			/^mvn\b.+\btest\b/.test(n) ||
			(GRADLE.test(n) && /\btest\b/.test(n)) ||
			/^rspec\b/.test(n) ||
			/^phpunit\b/.test(n) ||
			/^dotnet test\b/.test(n) ||
			/^flutter test\b/.test(n) ||
			/^sbt\b.+\btest\b/.test(n) ||
			/^swift test\b/.test(n) ||
			/^ctest\b/.test(n) ||
			/^Rscript\b/.test(n) ||
			/^(?:npm|pnpm|yarn|bun) (?:run )?test(?::\S*)?\b/.test(n) ||
			/^make (?:test|check)\b/.test(n),
		family: "test",
	},
	// build (outcome-bearing)
	{
		match: (n) =>
			/^make\b/.test(n) ||
			/^cmake\b/.test(n) ||
			/^cargo build\b/.test(n) ||
			/^go build\b/.test(n) ||
			/^mvn\b.+\b(?:package|install)\b/.test(n) ||
			(GRADLE.test(n) && /\b(?:build|assemble)\b/.test(n)) ||
			/^tsc\b.*--build\b/.test(n) ||
			/^(?:webpack|vite|next|nuxt|ng|svelte-kit) build\b/.test(n) ||
			/^xcodebuild\b/.test(n) ||
			/^swiftc\b/.test(n) ||
			/^dotnet build\b/.test(n) ||
			/^flutter build\b/.test(n) ||
			/^sbt\b.+\b(?:compile|assembly)\b/.test(n) ||
			/^nvcc\b/.test(n) ||
			/^protoc\b/.test(n) ||
			/^buf generate\b/.test(n) ||
			/^npm run build\b/.test(n) ||
			/^(?:yarn|pnpm) build\b/.test(n),
		family: "build",
	},
	// typecheck (outcome-bearing)
	{
		match: (n) =>
			/^tsc\b.*--noEmit\b/.test(n) ||
			/^mypy\b/.test(n) ||
			/^pyright\b/.test(n) ||
			/^flow\b/.test(n),
		family: "typecheck",
	},
	// lint
	{
		match: (n) =>
			/^(?:eslint|ruff|flake8|pylint|golangci-lint|detekt|ktlint|rubocop|phpstan|swiftlint|markdownlint)\b/.test(
				n,
			) ||
			/(?:^| )clippy\b/.test(n) ||
			/^npm run lint\b/.test(n),
		category: "lint",
	},
	// format
	{
		match: (n) =>
			/^(?:prettier|black|gofmt|rustfmt|swift-format)\b/.test(n) || /^dart format\b/.test(n),
		category: "format",
	},
	// install
	{
		match: (n) =>
			/^(?:npm|pnpm|yarn|bun) install\b/.test(n) ||
			/^(?:pip|pip3|poetry|uv|pipenv) install\b/.test(n) ||
			/^cargo (?:add|fetch)\b/.test(n) ||
			/^go mod download\b/.test(n) ||
			/^bundle install\b/.test(n) ||
			/^gem install\b/.test(n) ||
			/^composer install\b/.test(n) ||
			/^pod install\b/.test(n) ||
			/^dotnet restore\b/.test(n) ||
			/^flutter pub get\b/.test(n) ||
			/^sbt update\b/.test(n),
		category: "install",
	},
	// docker
	{
		match: (n) => /^docker (?:build|run|compose)\b/.test(n) || /^docker-compose\b/.test(n),
		category: "docker",
	},
	// k8s
	{ match: (n) => /^(?:kubectl|helm|kustomize)\b/.test(n), category: "k8s" },
	// deploy
	{
		match: (n) =>
			/^terraform apply\b/.test(n) ||
			/^pulumi up\b/.test(n) ||
			/^ansible-playbook\b/.test(n) ||
			/^serverless deploy\b/.test(n) ||
			/^fly deploy\b/.test(n) ||
			/^cap deploy\b/.test(n),
		category: "deploy",
	},
	// db_migrate
	{
		match: (n) =>
			/^alembic\b/.test(n) ||
			/^prisma migrate\b/.test(n) ||
			/^rails db:migrate\b/.test(n) ||
			/^knex migrate\b/.test(n) ||
			/^goose\b/.test(n) ||
			/^dbt run\b/.test(n) ||
			/^flyway\b/.test(n) ||
			/^sqitch\b/.test(n),
		category: "db_migrate",
	},
	// server_start
	{
		match: (n) =>
			/^(?:npm|pnpm|yarn) (?:run )?(?:dev|start)\b/.test(n) ||
			/^nest start\b/.test(n) ||
			/^next dev\b/.test(n) ||
			/^vite\b/.test(n) ||
			/^nuxt dev\b/.test(n) ||
			/^flask run\b/.test(n) ||
			/^rails (?:s|server)\b/.test(n) ||
			/\bmanage\.py runserver\b/.test(n) ||
			/^uvicorn\b/.test(n) ||
			/^php artisan serve\b/.test(n) ||
			/^dotnet watch\b/.test(n) ||
			/^(?:python|python3) -m http\.server\b/.test(n),
		category: "server_start",
	},
];

const WRAPPERS = new Set(["npx", "bunx", "sudo", "time", "env", "command"]);

/** Split on `&&`, `||`, `;`, `|` into trimmed non-empty segments. */
function splitSegments(command: string): string[] {
	return command
		.split(/&&|\|\||;|\|/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Strip leading env-assignments and wrapper programs (`npx`, `pnpm dlx`, `sudo`, …) from a segment. */
function stripLeading(segment: string): string[] {
	let tokens = segment.split(/\s+/).filter((t) => t.length > 0);
	for (;;) {
		const head = tokens[0];
		if (head === undefined) break;
		if (/^[A-Z_]\w*=/i.test(head)) {
			tokens = tokens.slice(1);
		} else if (WRAPPERS.has(head)) {
			tokens = tokens.slice(1);
		} else if (head === "pnpm" && tokens[1] === "dlx") {
			tokens = tokens.slice(2);
		} else {
			break;
		}
	}
	return tokens;
}

function stackForTokens(tokens: readonly string[]): Stack | undefined {
	const program = tokens[0]?.replace(/^\.\//, "");
	return program !== undefined ? PROGRAM_STACK.get(program) : undefined;
}

function resolveCategory(rule: Rule, ok: boolean | undefined): EventCategory {
	if (rule.family !== undefined) {
		return `${rule.family}_${ok === false ? "fail" : "pass"}` as EventCategory;
	}
	// A category-bearing rule always carries one.
	return rule.category ?? "dangerous";
}

/** Classify a Bash command: tokenize into segments, the most-specific rule across all segments wins. */
function classifyBash(command: string, ok: boolean | undefined): Classification | null {
	let best: { idx: number; rule: Rule; tokens: readonly string[] } | null = null;
	for (const segment of splitSegments(command)) {
		const tokens = stripLeading(segment);
		if (tokens.length === 0) continue;
		const norm = tokens.join(" ");
		let idx = 0;
		for (const rule of RULES) {
			if (rule.match(norm)) {
				if (best === null || idx < best.idx) best = { idx, rule, tokens };
				break;
			}
			idx += 1;
		}
	}
	if (best === null) return null;
	const category = resolveCategory(best.rule, ok);
	const stack = stackForTokens(best.tokens);
	return stack !== undefined ? { category, stack } : { category };
}

/**
 * Classify one tool use into a category (+ optional stack tag). Pure; `ok` is the tool's success, resolved
 * upstream in `cli/classify` (`PostToolUseFailure` ⇒ false, `PostToolUse` ⇒ true with a soft-fail heuristic).
 * Only the test/build/typecheck families read `ok`; every other category is fixed. Returns `null` when nothing
 * matches (no catch-all event).
 */
export function classify(toolName: string, command: string, ok?: boolean): Classification | null {
	if (toolName === "Bash") return classifyBash(command, ok);
	const category = TOOL_CATEGORY.get(toolName);
	return category !== undefined ? { category } : null;
}
