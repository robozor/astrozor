"""Shared models living in apps.core — re-used across multiple
domains. Currently:

* ``UUIDTaggedItem`` — taggit ``through`` model that stores ``object_id``
  as ``UUIDField`` instead of taggit's default ``IntegerField``. We need
  this because Article, Event, Campaign and Project all use UUID primary
  keys, and the default taggit table silently fails to insert with
  ``integer out of range`` when the UUID is coerced to an int.
"""

from __future__ import annotations

from django.db import models
from taggit.models import GenericUUIDTaggedItemBase, TaggedItemBase


class UUIDTaggedItem(GenericUUIDTaggedItemBase, TaggedItemBase):
    """Shared `through` table for all UUID-keyed taggable models.

    Used by ``TaggableManager(through=UUIDTaggedItem)`` in publishing,
    events, citizen and projects apps so they all share the same set of
    Tag rows (a tag like ``#m31`` created on an article is reusable on
    an event without ambiguity)."""

    class Meta:
        verbose_name = "UUID Tag"
        verbose_name_plural = "UUID Tags"
        # Explicit table name keeps it out of taggit's namespace —
        # taggit_taggeditem will stay empty (legacy, will be removed
        # later once no model references it).
        db_table = "core_uuidtaggeditem"
