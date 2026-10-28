#!/bin/sh
# Build the Simmer image on the Unraid server straight from the GitHub repo.
# No registry (Docker Hub / GHCR) is involved: the image only exists on your server as "simmer:local".
#
# Public repo:   curl -fsSL https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/build.sh | sh
# Private repo:  export GITHUB_TOKEN=<token with read access to the repo>
#                curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/build.sh | sh
set -eu
REPO="${SIMMER_REPO:-moimeme81/simmer}"
BRANCH="${SIMMER_BRANCH:-main}"
WORK="${SIMMER_WORKDIR:-/mnt/user/appdata/simmer-src}"

mkdir -p "$WORK"
rm -rf "$WORK/src"
mkdir -p "$WORK/src"

echo "Downloading $REPO@$BRANCH ..."
if [ -n "${GITHUB_TOKEN:-}" ]; then
  curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$REPO/tarball/$BRANCH" | tar xz -C "$WORK/src" --strip-components=1
else
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar xz -C "$WORK/src" --strip-components=1
fi

echo "Building simmer:local ..."
docker build -t simmer:local "$WORK/src"
rm -rf "$WORK/src"
echo "Done. In the Docker tab, edit the Simmer container and click Apply to start the new image."
