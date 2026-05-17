from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    place = models.ForeignKey("places.Place", on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_messages"
    )
    text = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "chat_message"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["place", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.user_id}@{self.place_id}: {self.text[:30]}"
