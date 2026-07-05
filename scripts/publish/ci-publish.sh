#!/usr/bin/env bash
#
# Publish every package whose package.json version has no matching `name@version` git tag yet, with
# npm provenance. Run by the Release workflow's changesets/action `publish:` command, after a Version
# Packages PR merges. Changesets' own `changeset publish` can't do this: npm cannot read the
# `workspace:` protocol these packages link with, so it would publish a literal `workspace:*` dep.
#
# Pass --dry-run to pack the tarballs (exercising the workspace rewrite) without uploading.

set -euo pipefail

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
fi

publish() {
  # shellcheck disable=SC2086 # $DRY_RUN is an intentional optional flag
  ( cd "$1" && npm publish --provenance --no-workspaces --access public $DRY_RUN )
}

changed=""
for dir in packages/core packages/packs/*; do
  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")
  if git rev-parse -q --verify "refs/tags/$name@$version" >/dev/null; then
    echo "$name@$version already released"
  else
    echo "$name@$version NOT released -> will publish"
    changed="$changed $dir"
  fi
done
changed=$(echo "$changed" | xargs || true)

if [ -z "$changed" ]; then
  echo "Nothing to publish — every package version is already tagged."
  exit 0
fi
echo "publishing:$changed"

# Build the core bundle if the engine is being published.
case " $changed " in
  *" packages/core "*)
    echo "== building core =="
    bun run build
    ;;
esac

# Packs first: the engine's workspace:* deps are rewritten to the packs' concrete versions, so those
# versions must already be on the registry when the engine publishes. Packs carry no workspace deps.
for dir in $changed; do
  case "$dir" in
    packages/packs/*)
      echo "== publishing $dir =="
      publish "$dir"
      ;;
  esac
done

# Core last: rewrite its workspace:* deps (batman in dependencies, the other packs in
# devDependencies) to the concrete versions in each pack's package.json — in the tarball only. A trap
# restores package.json so the working tree keeps the workspace protocol.
case " $changed " in
  *" packages/core "*)
    echo "== publishing packages/core =="
    (
      cd packages/core
      cp package.json package.json.orig
      trap 'mv -f package.json.orig package.json 2>/dev/null || true' EXIT

      node -e '
        const fs = require("fs");
        const map = {};
        for (const d of fs.readdirSync("../packs")) {
          try {
            const pp = JSON.parse(fs.readFileSync(`../packs/${d}/package.json`, "utf8"));
            map[pp.name] = pp.version;
          } catch {}
        }
        const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
        for (const sec of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          const deps = p[sec];
          if (!deps) continue;
          for (const [name, spec] of Object.entries(deps)) {
            if (typeof spec === "string" && spec.startsWith("workspace:")) {
              if (!(name in map)) throw new Error("no workspace version found for " + name);
              deps[name] = map[name];
              console.error(`rewrote ${sec}.${name} -> ${map[name]}`);
            }
          }
        }
        fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
      '

      npm publish --provenance --no-workspaces --access public $DRY_RUN
    )
    ;;
esac

echo "publish step complete."
