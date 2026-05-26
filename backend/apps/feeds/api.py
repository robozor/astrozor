"""Feeds API — sources CRUD, manual fetch, item listing.

Also exposes a static test fixture XML feed (dev/E2E only) so the
end-to-end test can exercise the polling code without depending on
external RSS hosts.
"""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from ninja import Query, Router

from apps.places.models import Place

from .fetch import fetch_source
from .models import FeedItem, FeedSource
from .schemas import (
    FeedItemListOut,
    FeedSourceIn,
    FeedSourceOut,
    FetchResultOut,
)

router = Router(tags=["feeds"])


def _require_auth(request: HttpRequest) -> bool:
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


def _source_out(s: FeedSource) -> dict:
    return {
        "id": s.id,
        "url": s.url,
        "name": s.name,
        "target_kind": s.target_kind,
        "target_id": s.target_id,
        "poll_interval_seconds": s.poll_interval_seconds,
        "last_fetched_at": s.last_fetched_at,
        "last_status": s.last_status,
        "last_error": s.last_error,
        "created_at": s.created_at,
    }


def _item_out(i: FeedItem) -> dict:
    return {
        "id": i.id,
        "source_id": i.source_id,
        "guid": i.guid,
        "title": i.title,
        "link": i.link,
        "summary": i.summary,
        "published_at": i.published_at,
        "fetched_at": i.fetched_at,
    }


@router.get("/feeds/sources", response={200: list[FeedSourceOut]})
def list_sources(
    request: HttpRequest,  # noqa: ARG001
    target_kind: str | None = None,
    target_id: str | None = None,
):
    qs = FeedSource.objects.all()
    if target_kind:
        qs = qs.filter(target_kind=target_kind)
    if target_id:
        qs = qs.filter(target_id=target_id)
    return 200, [_source_out(s) for s in qs.order_by("-created_at")]


@router.post("/feeds/sources", response={201: FeedSourceOut, 200: FeedSourceOut, 401: dict, 400: dict})
def create_source(request: HttpRequest, payload: FeedSourceIn):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}

    # Validate target exists for the kind
    if payload.target_kind == "place":
        if not Place.objects.filter(slug=payload.target_id).exists():
            return 400, {"detail": "Target place not found"}

    obj, created = FeedSource.objects.get_or_create(
        url=payload.url,
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        defaults={
            "name": payload.name or "",
            "poll_interval_seconds": max(300, payload.poll_interval_seconds),
            "added_by": request.user,
        },
    )
    return (201 if created else 200), _source_out(obj)


@router.delete("/feeds/sources/{source_id}", response={204: None, 401: dict, 404: dict})
def delete_source(request: HttpRequest, source_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        s = FeedSource.objects.get(id=source_id)
    except (FeedSource.DoesNotExist, ValueError):
        return 404, {"detail": "Source not found"}
    if s.added_by_id != request.user.id and not request.user.is_staff:
        return 401, {"detail": "Not your source"}
    s.delete()
    return 204, None


@router.post("/feeds/sources/{source_id}/fetch", response={200: FetchResultOut, 401: dict, 404: dict})
def manual_fetch(request: HttpRequest, source_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        s = FeedSource.objects.get(id=source_id)
    except (FeedSource.DoesNotExist, ValueError):
        return 404, {"detail": "Source not found"}
    result = fetch_source(s)
    return 200, result


@router.get("/feeds/items", response={200: FeedItemListOut})
def list_items(
    request: HttpRequest,  # noqa: ARG001
    target_kind: str | None = None,
    target_id: str | None = None,
    source_id: str | None = None,
    limit: int = Query(default=50, le=200),
):
    qs = FeedItem.objects.select_related("source")
    if source_id:
        qs = qs.filter(source_id=source_id)
    if target_kind:
        qs = qs.filter(source__target_kind=target_kind)
    if target_id:
        qs = qs.filter(source__target_id=target_id)
    qs = qs.order_by("-published_at", "-fetched_at")[:limit]
    items = list(qs)
    return 200, {"count": len(items), "items": [_item_out(i) for i in items]}


# ---- Test fixture (dev / E2E only) — serves a static Atom feed ----


@router.get("/feeds/_test/fixture.xml", tags=["meta"], include_in_schema=False)
def test_fixture(request):  # noqa: ARG001
    if not settings.DEBUG:
        return HttpResponse(status=404)
    xml = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Astrozor test fixture</title>
  <link href="http://astrozor.localhost/feeds/_test/fixture.xml"/>
  <updated>2026-05-17T10:00:00Z</updated>
  <id>urn:uuid:astrozor-fixture</id>
  <entry>
    <title>Test entry 1</title>
    <link href="https://example.com/entry-1"/>
    <id>urn:uuid:astrozor-entry-1</id>
    <updated>2026-05-17T09:00:00Z</updated>
    <summary>First test entry from the local Astrozor fixture feed.</summary>
  </entry>
  <entry>
    <title>Test entry 2</title>
    <link href="https://example.com/entry-2"/>
    <id>urn:uuid:astrozor-entry-2</id>
    <updated>2026-05-17T09:30:00Z</updated>
    <summary>Second test entry.</summary>
  </entry>
</feed>
"""
    return HttpResponse(xml, content_type="application/atom+xml")
