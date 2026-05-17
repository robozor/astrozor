# astrozor — CLI

Publish to Astrozor from your local machine.

## Install (development)

```bash
pip install -e clients/cli
```

(Published to PyPI in a later release — see Q13.)

## Usage

```bash
# Save the base URL + token (interactively prompted)
astrozor login --url http://astrozor.localhost

# Verify token
astrozor whoami

# Publish a Markdown file — server renders + sanitizes
astrozor publish path/to/article.md --lang cs

# Publish a pre-rendered directory (Quarto _site/, manifest.json, index.html)
astrozor publish path/to/_site --lang en
```

Credentials are stored at `~/.config/astrozor/credentials.json` (0600).

## Manifest schema

Minimum:

```yaml
title: "AR Cassiopeiae photometry — weekly digest"
summary: "Light-curve update for the 2026-05-week"
language: "cs"
engine: "quarto"
license: "CC BY 4.0"
tags: [variable, photometry]
# Either:
html: "<h1>...</h1>"
# Or:
content_md: "# Title\n\nBody..."
```

The `html` is sanitized server-side via bleach (no `<script>`, no inline event handlers).
