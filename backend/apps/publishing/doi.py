"""DOI minting service.

Real Zenodo integration deferred (BLOCKERS.md B-5). For now we mint
mock DOIs with the Zenodo prefix and a fake record id. Mocked DOIs
are clearly marked with a suffix so they're distinguishable.
"""

from __future__ import annotations

import logging
import os
from uuid import UUID

logger = logging.getLogger(__name__)


def mint_doi(article_uuid: UUID, title: str) -> str:
    """Return a DOI string for the article.

    If ZENODO_SANDBOX_TOKEN is set, we'd POST to the Zenodo API here.
    Until B-5 is resolved, we always mint a MOCK DOI.
    """
    token = os.environ.get("ZENODO_SANDBOX_TOKEN")
    if not token:
        # Mock: 8-char prefix of the article UUID
        short = str(article_uuid).replace("-", "")[:10]
        doi = f"10.5281/zenodo.MOCK-{short}"
        logger.info("publishing.doi: minted MOCK doi=%s for %s", doi, title[:40])
        return doi

    # TODO Krok 11.x — Zenodo Sandbox/Prod integration
    logger.warning("publishing.doi: Zenodo integration not yet implemented, falling back to MOCK")
    short = str(article_uuid).replace("-", "")[:10]
    return f"10.5281/zenodo.MOCK-{short}"
