// figure-ingest: splice an edited figure from .author/figure.txt into pack.json and validate.
// Usage: bun figure-ingest.ts <packDir>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packDir = process.argv[2];
if (packDir === undefined) {
	process.stderr.write("usage: figure-ingest <packDir>\n");
	process.exit(2);
}
const rows = readFileSync(join(packDir, ".author", "figure.txt"), "utf8")
	.replace(/\n$/, "")
	.split("\n");
const pack = JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")) as Record<
	string,
	unknown
>;
pack["art"] = rows;
writeFileSync(join(packDir, "pack.json"), `${JSON.stringify(pack, null, "\t")}\n`);
// The schema-only lint is the validation: it enforces the 9x25 bound and the legibility gate on the new art.
execFileSync("bun", ["run", "pack:lint", "--schema-only", packDir], { stdio: "inherit" });
process.stdout.write(`figure-ingest: wrote art into ${packDir}/pack.json and validated.\n`);
