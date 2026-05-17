from __future__ import annotations

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.db.models import F
from django.http import HttpRequest
from ninja import File, Router
from ninja.files import UploadedFile as NinjaUploadedFile

from apps.accounts.models import Profile

from .models import Upload

router = Router(tags=["uploads"])

ALLOWED_IMAGE_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/svg+xml",
}


def _require_auth(request: HttpRequest) -> bool:
    return bool(getattr(request, "user", None) and request.user.is_authenticated)


@router.post(
    "/uploads/image",
    response={201: dict, 400: dict, 401: dict, 413: dict, 415: dict},
    auth=None,
)
def upload_image(request: HttpRequest, file: NinjaUploadedFile = File(...)):
    """Upload an image and return its public URL.

    Per-user storage:
    - Files are written under MEDIA_ROOT/uploads/<user_id>/<uuid>.<ext>.
    - Profile.storage_used_bytes is incremented atomically.
    - Uploads larger than ASTROZOR_MAX_UPLOAD_BYTES (default 8 MiB) are
      rejected with 413.
    - Mime type outside ALLOWED_IMAGE_MIME is rejected with 415.
    - Uploads that would push storage_used over storage_quota are
      rejected with 413.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}

    f: UploadedFile = file  # type: ignore[assignment]
    if f.size is None:
        return 400, {"detail": "Cannot determine file size"}

    max_size = getattr(settings, "ASTROZOR_MAX_UPLOAD_BYTES", 8 * 1024 * 1024)
    if f.size > max_size:
        return 413, {
            "detail": f"File exceeds per-upload limit ({max_size // (1024 * 1024)} MiB)"
        }

    mime = (f.content_type or "").lower()
    if mime not in ALLOWED_IMAGE_MIME:
        return 415, {
            "detail": f"Unsupported image type: {mime or 'unknown'}. "
            "Allowed: JPEG, PNG, WebP, GIF, SVG."
        }

    profile: Profile = request.user.profile
    if profile.storage_used_bytes + f.size > profile.storage_quota_bytes:
        return 413, {
            "detail": "Storage quota exceeded. Free up space in your account.",
            "quota_bytes": profile.storage_quota_bytes,
            "used_bytes": profile.storage_used_bytes,
        }

    with transaction.atomic():
        upload = Upload.objects.create(
            user=request.user,
            file=f,
            kind=Upload.Kind.IMAGE,
            mime=mime,
            size_bytes=f.size,
            original_name=(f.name or "")[:255],
        )
        Profile.objects.filter(pk=profile.pk).update(
            storage_used_bytes=F("storage_used_bytes") + f.size
        )

    return 201, {
        "id": str(upload.id),
        "url": upload.file.url,
        "size_bytes": upload.size_bytes,
        "mime": upload.mime,
    }


@router.delete(
    "/uploads/{upload_id}",
    response={204: None, 401: dict, 403: dict, 404: dict},
    auth=None,
)
def delete_upload(request: HttpRequest, upload_id: str):
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}
    try:
        up = Upload.objects.get(id=upload_id)
    except (Upload.DoesNotExist, ValueError):
        return 404, {"detail": "Not found"}
    if up.user_id != request.user.id and not request.user.is_staff:
        return 403, {"detail": "Forbidden"}

    size = up.size_bytes
    with transaction.atomic():
        up.file.delete(save=False)
        up.delete()
        Profile.objects.filter(user=request.user).update(
            storage_used_bytes=F("storage_used_bytes") - size
        )
    return 204, None
