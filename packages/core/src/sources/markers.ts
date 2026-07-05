import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Stack } from "../domain";

/** The static cwd-marker half of stack detection (the dynamic command-verb half lives in the classifier). */
export interface MarkerSet {
	readonly stacks: ReadonlySet<Stack>;
}

/** Exact marker file/dir names → stack key (the static Fingerprint column of the stack table). */
const FILE_MARKERS: Readonly<Record<string, Stack>> = {
	"package.json": "web",
	node_modules: "web",
	"pyproject.toml": "python",
	"requirements.txt": "python",
	Dockerfile: "docker",
	"docker-compose.yml": "docker",
	"docker-compose.yaml": "docker",
	"pom.xml": "java",
	"go.mod": "go",
	"tsconfig.json": "node",
	"composer.json": "php",
	artisan: "php",
	"Cargo.toml": "rust",
	Gemfile: "ruby",
	"CMakeLists.txt": "cpp",
	"AndroidManifest.xml": "android",
	"build.gradle": "android",
	"build.gradle.kts": "android",
	gradlew: "android",
	"pubspec.yaml": "flutter",
	"metro.config.js": "react-native",
	"build.sbt": "scala",
	"buf.yaml": "protobuf",
	"project.godot": "game",
	DESCRIPTION: "r",
	"renv.lock": "r",
	"schema.graphql": "graphql",
};

/** Filename suffix (glob) markers → stack key. */
const EXT_MARKERS: Readonly<Record<string, Stack>> = {
	".py": "python",
	".sql": "sql",
	".java": "java",
	".go": "go",
	".csproj": "dotnet",
	".sln": "dotnet",
	".c": "cpp",
	".cpp": "cpp",
	".cc": "cpp",
	".rs": "rust",
	".ipynb": "ml",
	".kt": "android",
	".rb": "ruby",
	".xcodeproj": "ios",
	".swift": "ios",
	".tf": "terraform",
	".graphql": "graphql",
	".dart": "flutter",
	".scala": "scala",
	".proto": "protobuf",
	".unity": "game",
	".uproject": "game",
	".R": "r",
	".cu": "cuda",
};

function scanDir(dir: string, stacks: Set<Stack>): boolean {
	let entries: string[];
	let isRepoRoot = false;
	try {
		entries = readdirSync(dir);
	} catch {
		// EACCES / ENOTDIR on an unreadable ancestor contributes no markers; the walk continues.
		return false;
	}
	for (const name of entries) {
		if (name === ".git") isRepoRoot = true;
		const fileStack = FILE_MARKERS[name];
		if (fileStack) stacks.add(fileStack);
		const dot = name.lastIndexOf(".");
		if (dot > 0) {
			const extStack = EXT_MARKERS[name.slice(dot)];
			if (extStack) stacks.add(extStack);
		}
	}
	return isRepoRoot;
}

/** Scan the cwd and a shallow ancestor walk to the repo root for stack marker files. Fresh each render. */
export function readMarkers(cwd: string): MarkerSet {
	const stacks = new Set<Stack>();
	let dir = resolve(cwd);
	for (;;) {
		const atRepoRoot = scanDir(dir, stacks);
		if (atRepoRoot) break;
		const parent = dirname(dir);
		if (parent === dir) break; // filesystem root
		dir = parent;
	}
	return { stacks };
}
