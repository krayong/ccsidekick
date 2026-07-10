// @ts-check
import comments from "@eslint-community/eslint-plugin-eslint-comments";
import boundaries from "eslint-plugin-boundaries";
import { importX } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import * as regexp from "eslint-plugin-regexp";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"**/dist/**",
			"**/node_modules/**",
			// `.claude/skills/**` is gitignored (locally-installed skills). ESLint doesn't read .gitignore (unlike
			// Prettier, which gets `--ignore-path .gitignore`), so mirror it here or `eslint .` walks into those
			// non-project skill scripts. pack-author is the exception: it ships tracked, with tests, held to the same
			// gate — so re-include it. Skill markdown/templates are never linted regardless.
			".claude/skills/**",
			"!.claude/skills/pack-author/**",
			".claude/**/*.md",
			// generated engine bundle, generated data, and vendored libraries served by the static site
			"website/render-web.js",
			"website/data.js",
			"website/vendor/**",
		],
	},
	...tseslint.configs.strictTypeChecked,
	{
		plugins: { "import-x": importX },
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.eslint.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
			// Enum-heavy domain: a switch over a union must handle every case (no silent fallthrough).
			"@typescript-eslint/switch-exhaustiveness-check": "error",
			// Pair with verbatimModuleSyntax + the barrels: type-only imports/exports use `type`. Inline the
			// marker so a module's types and values share one import statement instead of two.
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{ fixStyle: "inline-type-imports" },
			],
			"@typescript-eslint/consistent-type-exports": "error",
			// No implicit truthiness on nullable/string/number: force explicit comparisons.
			"@typescript-eslint/strict-boolean-expressions": "error",
			// Stable, alphabetized import order: node builtins, then externals, then local groups, blank-separated.
			"import-x/order": [
				"error",
				{
					groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
					"newlines-between": "always",
					alphabetize: { order: "asc", orderImportKind: "asc", caseInsensitive: true },
				},
			],
			// Barrels pull a whole directory into an import, which can close a dependency loop the per-file
			// imports avoided. Fail on any runtime import cycle (type-only edges are ignored).
			"import-x/no-cycle": [
				"error",
				{ ignoreExternal: true, allowUnsafeDynamicCyclicDependency: false },
			],
			// Merge a module's type-only and value imports into one statement (uses the inline `type` marker).
			"import-x/no-duplicates": ["error", { "prefer-inline": true }],
			"import-x/no-self-import": "error",
			"import-x/no-useless-path-segments": ["error", { noUselessIndex: false }],
			"import-x/no-mutable-exports": "error",
			"import-x/no-extraneous-dependencies": "error",
		},
	},
	{
		// Extra correctness/style rules on TypeScript source only (not the plain-JS config/scripts).
		files: ["**/*.ts", "**/*.tsx"],
		plugins: { unicorn, sonarjs, regexp },
		rules: {
			"unicorn/prefer-node-protocol": "error",
			"unicorn/error-message": "error",
			"unicorn/throw-new-error": "error",
			"unicorn/no-useless-undefined": "error",
			"unicorn/prefer-optional-catch-binding": "error",
			"unicorn/no-array-push-push": "error",
			"unicorn/prefer-string-starts-ends-with": "error",
			"unicorn/prefer-includes": "error",
			"unicorn/prefer-set-has": "error",
			"unicorn/prefer-array-find": "error",
			"unicorn/prefer-array-some": "error",
			"unicorn/no-lonely-if": "error",
			"unicorn/prefer-date-now": "error",
			"unicorn/no-instanceof-array": "error",
			"unicorn/consistent-function-scoping": "error",
			"sonarjs/no-identical-functions": "error",
			"sonarjs/no-duplicated-branches": "error",
			"sonarjs/no-redundant-boolean": "error",
			"sonarjs/no-collapsible-if": "error",
			"sonarjs/prefer-single-boolean-return": "error",
			"sonarjs/cognitive-complexity": "error",
			...regexp.configs["flat/recommended"].rules,
		},
	},
	{
		// Barrel enforcement. Every directory under src is an "element" whose only public entry point is its
		// index.ts; the tui subtree, sources/storage, and compose/helpful are their own nested elements. Importing
		// a directory's inner file from outside that directory is an error — cross-directory imports must go
		// through the barrel (so tui/shell reaches tui/theme via ../theme, never a deep file path). Applies to the
		// test tree too, so tests import ../../src/<dir> barrels rather than reaching into module files.
		files: ["packages/core/src/**/*.{ts,tsx}", "packages/core/test/**/*.{ts,tsx}"],
		plugins: { boundaries },
		settings: {
			// boundaries resolves import specifiers to files to classify them; the default node resolver ignores
			// extensionless .ts/.tsx imports, so it must use the TypeScript resolver or the rule silently no-ops.
			"import/resolver": { typescript: { project: "./tsconfig.eslint.json" } },
			"boundaries/elements": [
				{
					type: "barrel",
					mode: "folder",
					pattern: "packages/core/src/*/*",
					capture: ["dir", "sub"],
				},
				{
					type: "barrel",
					mode: "folder",
					pattern: "packages/core/src/*",
					capture: ["dir"],
				},
				// The separate test tree is its own element, so the `from: { type: "*" }` rule below covers it and
				// tests are held to the same barrel-entry rule as source (test files reach src through its barrels).
				{ type: "test", mode: "file", pattern: "packages/core/test/**/*.@(ts|tsx)" },
			],
		},
		rules: {
			"boundaries/dependencies": [
				"error",
				{
					default: "disallow",
					rules: [
						{
							// Any file may import a barrel element, but only through its index (or a raw JSON data asset
							// like data/pricing.json, which no barrel re-exports). Deep imports of a directory's inner
							// module files from outside that directory are the violation this catches.
							from: { type: "*" },
							allow: {
								to: [
									{ type: "barrel", internalPath: "index.@(ts|tsx)" },
									{ type: "barrel", internalPath: "*.json" },
								],
							},
						},
					],
				},
			],
		},
	},
	{
		// eslint-disable hygiene, everywhere: no stale disables, and every disable carries a reason.
		plugins: { "@eslint-community/eslint-comments": comments },
		rules: {
			"@eslint-community/eslint-comments/no-unused-disable": "error",
			"@eslint-community/eslint-comments/require-description": "error",
		},
	},
	{
		// The hand-written guards in sources/ and the pack guard necessarily handle loose JSON/TOML types.
		files: ["packages/*/src/sources/**/*.ts", "packages/*/src/packs/validate.ts"],
		rules: {
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
		},
	},
	{
		// The Ink/React TUI layer only. Rules of Hooks catches conditional/looped hooks (real bugs, error);
		// exhaustive-deps warns. Scoped to tui tsx so it never touches the pure hot path.
		files: ["packages/*/src/tui/**/*.tsx"],
		plugins: { "react-hooks": reactHooks },
		rules: {
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "warn",
		},
	},
	{
		files: ["**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"@typescript-eslint/no-non-null-assertion": "off",
			// Tests count display columns by code point via [...str]; the figure art is BMP-only.
			"@typescript-eslint/no-misused-spread": "off",
		},
	},
	{
		// The pack-author authoring scripts are dev-only tooling (not shipped): they spread BMP-only figure art
		// into code points and assert on known-present array slots, the same patterns the test files allow.
		files: [".claude/skills/**/*.ts"],
		rules: {
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-misused-spread": "off",
		},
	},
	{
		// Plain JS scripts (this config, scripts/*.mjs) are not in tsconfig.eslint.json, so type-checked rules
		// would error ("file not found in project"). Disable type-checked rules for them.
		files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
		...tseslint.configs.disableTypeChecked,
	},
);
