"""DOI minting service.

Per-user Zenodo token: when the author has profile.zenodo_token set,
we mint the DOI on THEIR Zenodo account. Otherwise we fall back to
the platform-level ZENODO_SANDBOX_TOKEN env. If neither is available,
we mint a MOCK DOI clearly marked with a 'MOCK-' suffix.
"""

from __future__ import annotations

import logging
import os
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)


def _mock_doi(article_uuid: UUID) -> str:
    short = str(article_uuid).replace("-", "")[:10]
    return f"10.5281/zenodo.MOCK-{short}"


def _resolve_zenodo_credentials(user) -> tuple[str, str] | None:
    """Pick which Zenodo token + base URL to use.

    Priority: user's profile.zenodo_token (per-user, the right model),
    then env ZENODO_SANDBOX_TOKEN as a development fallback.
    """
    # 1) Per-user token in profile
    if user is not None and getattr(user, "is_authenticated", True):
        profile = getattr(user, "profile", None)
        if profile and profile.zenodo_token:
            base = (
                "https://sandbox.zenodo.org"
                if profile.zenodo_use_sandbox
                else "https://zenodo.org"
            )
            return profile.zenodo_token, base

    # 2) Platform env fallback (dev/sandbox)
    env_token = os.environ.get("ZENODO_SANDBOX_TOKEN")
    if env_token:
        return env_token, "https://sandbox.zenodo.org"
    env_token = os.environ.get("ZENODO_PROD_TOKEN")
    if env_token:
        return env_token, "https://zenodo.org"

    return None


def _post_deposit(token: str, base: str, title: str, description: str) -> str | None:
    """Create a Zenodo deposition draft and return its DOI.

    Note: a draft DOI is reserved on creation. The full publish flow
    (upload files, publish) requires more steps — out of scope for MVP
    DOI reservation. This is enough to give each article a real DOI.
    """
    payload = {
        "metadata": {
            "title": title or "Astrozor article",
            "upload_type": "publication",
            "publication_type": "article",
            "description": description or "Published via Astrozor",
            "creators": [{"name": "Astrozor user"}],
        }
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                f"{base}/api/deposit/depositions",
                params={"access_token": token},
                json=payload,
            )
    except httpx.HTTPError as e:  # pragma: no cover
        logger.warning("publishing.doi: Zenodo request failed: %s", e)
        return None

    if r.status_code not in (200, 201):
        logger.warning(
            "publishing.doi: Zenodo returned %d: %s", r.status_code, r.text[:200]
        )
        return None

    data = r.json()
    doi = (data.get("metadata") or {}).get("prereserve_doi", {}).get("doi") or data.get("doi")
    if not doi:
        logger.warning("publishing.doi: Zenodo response missing DOI: %s", data)
        return None
    return doi


def mint_doi(article_uuid: UUID, title: str, user=None, description: str = "") -> str:
    """Return a DOI string for an article.

    If the author has a Zenodo token in their profile (or env var is set in
    dev), we register a real DOI. Otherwise we mint a MOCK DOI.
    """
    creds = _resolve_zenodo_credentials(user)
    if not creds:
        doi = _mock_doi(article_uuid)
        logger.info("publishing.doi: minted MOCK doi=%s for %s", doi, title[:40])
        return doi

    token, base = creds
    doi = _post_deposit(token, base, title, description)
    if doi:
        logger.info("publishing.doi: minted Zenodo DOI=%s (base=%s)", doi, base)
        return doi

    # Zenodo call failed — fall back to MOCK rather than crashing the publish
    logger.warning("publishing.doi: Zenodo call failed, returning MOCK DOI")
    return _mock_doi(article_uuid)
