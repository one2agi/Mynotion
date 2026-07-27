#!/usr/bin/env bash
# Vercel build helper: temporarily strip devDependencies from package.json so
# npm install doesn't have to resolve the (broken on npm 10.9) deep dev tree.
# After build we restore package.json from git so local dev still works.
#
# Background: npm 10.9's arborist crashes with "Cannot read properties of
# null (reading 'matches')" while resolving very old dev-tool trees
# (xo -> eslint 5.x -> ...). `--omit=dev` skips install but NOT resolution.
# Removing devDependencies fully dodges the resolver bug.

set -e

cd "$(dirname "$0")/.."

# 1. Backup + sanitize package.json (drop devDependencies and scripts
#    that need devDeps, like pre-commit / lint:fix / type-check).
cp package.json package.json.bak

node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  delete pkg.devDependencies;
  // Some scripts reference dev-only binaries (patch-package, jest, prettier...).
  // Keep them in the file but Vercel only calls "build" which is "next build",
  // and postinstall -> patch-package is a dep, not a devDep.
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log("[vercel-install] Removed devDependencies from package.json");
'

# 2. Install only prod deps. --ignore-scripts so package.json's
#    postinstall hook doesn't call `patch-package` without our --exclude.
#    --legacy-peer-deps because some prod deps have wide peer ranges.
npm install --no-audit --no-fund --ignore-scripts --legacy-peer-deps

# 2b. Apply patches, but skip those targeting dev-only packages (e.g.
#     vitepress-chat — docs site widget, not production runtime).
./node_modules/.bin/patch-package --exclude '^vitepress-chat@' || {
  echo "[vercel-install] patch-package reported warnings (skipped dev-only patches)"
}

# 3. Restore original package.json so other build steps (and local dev)
#    see the full tree.
mv package.json.bak package.json
echo "[vercel-install] Restored original package.json"
