# Builds the `astrozorpub` R package into a CRAN-like repo layout served
# by Caddy at https://<astrozor>/R/. Runs once per `docker compose up` and
# exits — other services do not depend on it, so its build cost (~30-60s
# first time, ~5s subsequent) doesn't gate startup.
#
# Output layout (in /repo, mapped to astrozor_r_repo volume):
#   /repo/src/contrib/PACKAGES         — DCF index
#   /repo/src/contrib/PACKAGES.gz      — gzipped index
#   /repo/src/contrib/astrozorpub_<version>.tar.gz
#
# rocker/r-ver provides R with no extra Tidyverse cruft — minimal image.

FROM rocker/r-ver:4.4.0

WORKDIR /work

# Source is bind-mounted at runtime so iterating on rstudio-addin/ doesn't
# require an image rebuild — we just `docker compose run r-pkg-builder`.
# Image only contains R itself + the build entrypoint.

COPY docker/r-pkg-builder/build.sh /usr/local/bin/build-r-pkg
RUN chmod +x /usr/local/bin/build-r-pkg

CMD ["build-r-pkg"]
