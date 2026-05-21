#!/usr/bin/env bash
# Build astrozorpub source package + PACKAGES index.
#
# Inputs:
#   /work/rstudio-addin/   (read-only bind mount of the source tree)
# Outputs:
#   /repo/src/contrib/PACKAGES, PACKAGES.gz, astrozorpub_<version>.tar.gz
set -euo pipefail

SRC=/work/rstudio-addin
REPO=/repo/src/contrib

if [ ! -d "$SRC" ]; then
  echo "ERROR: $SRC not found. Is the rstudio-addin/ directory bind-mounted?" >&2
  exit 1
fi

mkdir -p "$REPO"

# `R CMD build` writes the tarball to CWD. Use a clean staging dir so we
# don't pollute /work with leftover .tar.gz between runs.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cd "$STAGE"

echo "[r-pkg-builder] Building astrozorpub from $SRC ..."
R CMD build "$SRC" --no-manual --no-build-vignettes

NEW_TARBALL=$(ls astrozorpub_*.tar.gz | head -1)
if [ -z "$NEW_TARBALL" ]; then
  echo "ERROR: R CMD build did not produce a tarball." >&2
  exit 1
fi

# Remove older versions from the repo so the index only lists the latest.
# (We could keep history, but for a private repo with a single package
# the index is simpler when it only ever points at one version.)
rm -f "$REPO"/astrozorpub_*.tar.gz "$REPO"/PACKAGES "$REPO"/PACKAGES.gz "$REPO"/PACKAGES.rds

cp "$NEW_TARBALL" "$REPO/"
echo "[r-pkg-builder] Copied $NEW_TARBALL → $REPO/"

# Generate PACKAGES index. tools::write_PACKAGES is the canonical way;
# it writes PACKAGES, PACKAGES.gz, PACKAGES.rds in one shot.
R --quiet --no-save <<'RSCRIPT'
tools::write_PACKAGES("/repo/src/contrib", type = "source", verbose = TRUE)
RSCRIPT

echo "[r-pkg-builder] Repo contents:"
ls -la "$REPO"
