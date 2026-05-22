# Builds the `astrozor-publish` VS Code extension into a .vsix served by
# Caddy at https://<astrozor>/vscode-extension/. Runs once per
# `docker compose up` and exits — other services don't depend on it.
#
# Output layout (in /repo, mapped to astrozor_vsce_repo volume):
#   /repo/astrozor-publish-latest.vsix    — symlink-style copy, stable URL
#   /repo/astrozor-publish-<version>.vsix — versioned filename
#   /repo/index.json                      — { name, version, vsix_url }
#
# node:20-bookworm-slim ships with the npm + system libs needed for vsce
# packaging without pulling in the full devtools image.

FROM node:20-bookworm-slim

WORKDIR /work

# Source is bind-mounted at runtime so iterating on vscode-extension/
# doesn't require an image rebuild. Image only contains node + vsce.
RUN npm install -g @vscode/vsce@^3

COPY docker/vsce-pkg-builder/build.sh /usr/local/bin/build-vsce-pkg
RUN chmod +x /usr/local/bin/build-vsce-pkg

CMD ["build-vsce-pkg"]
