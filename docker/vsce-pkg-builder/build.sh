#!/usr/bin/env bash
# Build astrozor-publish .vsix + index.json with version metadata.
#
# Inputs:
#   /work/vscode-extension/   (read-only bind mount of the source tree)
# Outputs:
#   /repo/astrozor-publish-<version>.vsix
#   /repo/astrozor-publish-latest.vsix      (copy, stable URL)
#   /repo/index.json                        (metadata consumed by /vscode-pkg/info)
set -euo pipefail

SRC=/work/vscode-extension
REPO=/repo

if [ ! -d "$SRC" ]; then
  echo "ERROR: $SRC not found. Is the vscode-extension/ directory bind-mounted?" >&2
  exit 1
fi

mkdir -p "$REPO"

# Stage in a fresh dir so the bind-mounted SRC stays untouched. We copy
# package.json + tsconfig.json + src/ — not node_modules/ (we install
# fresh) and not out/ (we rebuild).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r "$SRC"/. "$STAGE"/
cd "$STAGE"
rm -rf node_modules out *.vsix

echo "[vsce-pkg-builder] Installing deps in $STAGE ..."
npm install --omit=optional --no-audit --no-fund

echo "[vsce-pkg-builder] Compiling TypeScript ..."
npm run build

echo "[vsce-pkg-builder] Packaging .vsix ..."
vsce package --out astrozor-publish.vsix

# Read version from package.json without jq — small node one-liner.
VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")

VERSIONED="astrozor-publish-${VERSION}.vsix"
LATEST="astrozor-publish-latest.vsix"

# Clear old artifacts in the repo so the directory listing stays clean.
rm -f "$REPO"/astrozor-publish-*.vsix "$REPO"/index.json

cp astrozor-publish.vsix "$REPO/$VERSIONED"
cp astrozor-publish.vsix "$REPO/$LATEST"

cat > "$REPO/index.json" <<JSON
{
  "name": "${NAME}",
  "version": "${VERSION}",
  "vsix_filename": "${VERSIONED}",
  "vsix_latest": "${LATEST}"
}
JSON

echo "[vsce-pkg-builder] Repo contents:"
ls -la "$REPO"
echo "[vsce-pkg-builder] Built version ${VERSION}"
