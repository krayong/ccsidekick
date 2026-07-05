import { expect, test } from "bun:test";

import { classify } from "./classifier";

const cat = (tool: string, cmd: string, ok?: boolean): string | null =>
	classify(tool, cmd, ok)?.category ?? null;

test("non-Bash tools classify from the tool name (incl. legacy aliases)", () => {
	expect(cat("Read", "")).toBe("file_read");
	expect(cat("Edit", "")).toBe("file_edit");
	expect(cat("Write", "")).toBe("file_edit");
	expect(cat("NotebookEdit", "")).toBe("file_edit");
	expect(cat("Grep", "")).toBe("search");
	expect(cat("Glob", "")).toBe("search");
	expect(cat("WebFetch", "")).toBe("web_fetch");
	expect(cat("WebSearch", "")).toBe("web_fetch");
	expect(cat("Agent", "")).toBe("agent_spawn");
	expect(cat("Task", "")).toBe("agent_spawn");
	expect(cat("Skill", "")).toBe("skill_run");
	expect(cat("TaskCreate", "")).toBe("todo_update");
	expect(cat("TaskUpdate", "")).toBe("todo_update");
	expect(cat("TodoWrite", "")).toBe("todo_update");
});

test("background-subagent tools are NOT todo updates, and unknown tools ⇒ null", () => {
	expect(classify("TaskStop", "")).toBeNull();
	expect(classify("TaskOutput", "")).toBeNull();
	expect(classify("MultiEdit", "")).toBeNull();
	expect(classify("SomeFutureTool", "")).toBeNull();
});

test("destructive rows outrank their family", () => {
	expect(cat("Bash", "git push --force origin main")).toBe("force_push");
	expect(cat("Bash", "git push -f")).toBe("force_push");
	expect(cat("Bash", "git push --force-with-lease")).toBe("force_push");
	expect(cat("Bash", "git reset --hard HEAD~1")).toBe("dangerous");
	expect(cat("Bash", "rm -rf build")).toBe("dangerous");
	expect(cat("Bash", "kubectl delete pod foo")).toBe("dangerous");
	expect(cat("Bash", "terraform destroy")).toBe("dangerous");
});

test("git family", () => {
	expect(cat("Bash", "git push origin main")).toBe("git_push");
	expect(cat("Bash", "git commit -m wip")).toBe("git_commit");
	expect(cat("Bash", "git pull")).toBe("git_pull");
	expect(cat("Bash", "git merge feature")).toBe("git_merge");
	expect(cat("Bash", "git rebase main")).toBe("git_rebase");
	expect(cat("Bash", "git branch new")).toBe("git_branch");
	expect(cat("Bash", "git checkout -b feat")).toBe("git_branch");
	expect(cat("Bash", "git tag v1")).toBe("git_tag");
	expect(cat("Bash", "git stash")).toBe("git_stash");
});

test("test/build/typecheck families split on ok", () => {
	expect(cat("Bash", "pytest", true)).toBe("test_pass");
	expect(cat("Bash", "pytest", false)).toBe("test_fail");
	expect(cat("Bash", "pytest")).toBe("test_pass"); // default ok=true
	expect(cat("Bash", "cargo build", true)).toBe("build_pass");
	expect(cat("Bash", "cargo build", false)).toBe("build_fail");
	expect(cat("Bash", "tsc --noEmit", false)).toBe("typecheck_fail");
	expect(cat("Bash", "mypy .", true)).toBe("typecheck_pass");
});

test("package-runner and make wrappers", () => {
	expect(cat("Bash", "npm test", true)).toBe("test_pass");
	expect(cat("Bash", "npm test", false)).toBe("test_fail");
	expect(cat("Bash", "npm run test:unit", true)).toBe("test_pass");
	expect(cat("Bash", "bun test")).toBe("test_pass");
	expect(cat("Bash", "npm run build")).toBe("build_pass");
	expect(cat("Bash", "npm run lint")).toBe("lint");
	expect(cat("Bash", "make test")).toBe("test_pass");
	expect(cat("Bash", "make check")).toBe("test_pass");
	expect(cat("Bash", "make")).toBe("build_pass"); // bare make is build, not test
});

test("lint / format / install / docker / k8s / deploy / db_migrate / server_start", () => {
	expect(cat("Bash", "eslint src")).toBe("lint");
	expect(cat("Bash", "prettier --write .")).toBe("format");
	expect(cat("Bash", "npm install")).toBe("install");
	expect(cat("Bash", "docker build .")).toBe("docker");
	expect(cat("Bash", "kubectl apply -f k.yaml")).toBe("k8s");
	expect(cat("Bash", "terraform apply")).toBe("deploy");
	expect(cat("Bash", "prisma migrate dev")).toBe("db_migrate");
	expect(cat("Bash", "npm run dev")).toBe("server_start");
	expect(cat("Bash", "nest start")).toBe("server_start");
});

test("stack tags attach from the command program; multi-stack programs carry none", () => {
	expect(classify("Bash", "cargo build", true)).toEqual({
		category: "build_pass",
		stack: "rust",
	});
	expect(classify("Bash", "npm install")).toEqual({ category: "install", stack: "web" });
	expect(classify("Bash", "nest start")).toEqual({ category: "server_start", stack: "node" });
	// gradle build is build, but gradle serves java+android ⇒ no stack tag
	expect(classify("Bash", "gradle build", true)).toEqual({ category: "build_pass" });
	expect(classify("Bash", "pytest", false)).toEqual({ category: "test_fail", stack: "python" });
	// jest is not in the program→stack map ⇒ no stack tag
	expect(classify("Bash", "jest", true)?.stack).toBeUndefined();
});

test("tokenizer strips cd/env/wrappers; the most-specific segment wins", () => {
	expect(cat("Bash", "cd app && CI=1 npx jest", true)).toBe("test_pass");
	expect(cat("Bash", "cd app && CI=1 npx jest", false)).toBe("test_fail");
	// most-specific across segments: a force_push outranks a plain build elsewhere
	expect(cat("Bash", "npm run build && git push --force")).toBe("force_push");
	expect(cat("Bash", "sudo docker build .")).toBe("docker");
	// `pnpm dlx` is a two-token wrapper strip; `bunx` a single-token one — the runner underneath still classifies.
	expect(cat("Bash", "pnpm dlx jest", true)).toBe("test_pass");
	expect(cat("Bash", "bunx vitest", false)).toBe("test_fail");
});

test("a Bedrock-failure-derived ok=false on a test command ⇒ test_fail; unmatched ⇒ null", () => {
	expect(cat("Bash", "go test ./...", false)).toBe("test_fail");
	expect(cat("Bash", "echo hello")).toBeNull();
	expect(cat("Bash", "ls -la")).toBeNull();
});
