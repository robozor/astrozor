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

ALLOWED_VIDEO_MIME = {
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
}

# Per-upload cap for inline video attachments in chat. Generous to allow
# short clips (drone flyovers, telescope footage) without making the place
# panel a video host. Default 50 MiB.
MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024


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


@router.post(
    "/uploads/article-cover",
    response={201: dict, 400: dict, 401: dict, 413: dict, 415: dict},
    auth=None,
)
def upload_article_cover(request: HttpRequest, file: NinjaUploadedFile = File(...)):
    """Upload an article cover image with server-side resize.

    Resizes the input to a max width of 1600 px (preserving aspect
    ratio) before saving as a JPEG with quality 88. Serves both the
    magazine hero (1200 px wide) and the grid thumbnails (400 px wide)
    from a single asset — the browser handles further downscale.

    Per-user storage quota + ASTROZOR_MAX_UPLOAD_BYTES cap on the
    INPUT file (raw upload), same as /uploads/image. Output is usually
    smaller after resize + JPEG encode, but storage accounting uses the
    resized size for accuracy.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}

    f: UploadedFile = file  # type: ignore[assignment]
    if f.size is None:
        return 400, {"detail": "Cannot determine file size"}

    max_input = getattr(settings, "ASTROZOR_MAX_UPLOAD_BYTES", 8 * 1024 * 1024)
    if f.size > max_input:
        return 413, {
            "detail": f"File exceeds per-upload limit ({max_input // (1024 * 1024)} MiB)"
        }

    mime = (f.content_type or "").lower()
    # SVG isn't accepted for covers — magazine grid needs raster for
    # the gradient hover scale + lazy loading semantics.
    if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        return 415, {
            "detail": (
                f"Unsupported cover image type: {mime or 'unknown'}. "
                "Allowed: JPEG, PNG, WebP, GIF."
            )
        }

    from io import BytesIO

    from django.core.files.base import ContentFile
    from PIL import Image, ImageOps

    try:
        src = Image.open(f.file)
        # Strip EXIF rotation by physically rotating + re-encoding —
        # iOS / Android usually upload landscape EXIF-rotated portrait
        # photos that look correct only with EXIF-aware viewers.
        src = ImageOps.exif_transpose(src)
        if src.mode in ("RGBA", "LA", "P"):
            # Flatten transparency on dark background so the hero card
            # doesn't show through gradient fallbacks behind the image.
            bg = Image.new("RGB", src.size, (15, 23, 42))
            if src.mode != "RGBA":
                src = src.convert("RGBA")
            bg.paste(src, mask=src.split()[-1])
            src = bg
        elif src.mode != "RGB":
            src = src.convert("RGB")
        # Cap width at 1600 px; let height float to preserve aspect.
        max_w = 1600
        if src.width > max_w:
            new_h = round(src.height * (max_w / src.width))
            src = src.resize((max_w, new_h), Image.LANCZOS)
        out = BytesIO()
        src.save(out, format="JPEG", quality=88, optimize=True, progressive=True)
        out.seek(0)
        resized_bytes = out.getbuffer().nbytes
    except Exception as e:  # pragma: no cover — Pillow handles most cases
        return 400, {"detail": f"Cannot process image: {e}"}

    profile: Profile = request.user.profile
    if profile.storage_used_bytes + resized_bytes > profile.storage_quota_bytes:
        return 413, {
            "detail": "Storage quota exceeded. Free up space in your account.",
            "quota_bytes": profile.storage_quota_bytes,
            "used_bytes": profile.storage_used_bytes,
        }

    # Use original filename stem with .jpg suffix; Upload model derives
    # the saved name from the ContentField name we provide.
    orig_name = (f.name or "cover").rsplit(".", 1)[0][:120]
    saved_name = f"{orig_name}.jpg"

    with transaction.atomic():
        upload = Upload.objects.create(
            user=request.user,
            file=ContentFile(out.getvalue(), name=saved_name),
            kind=Upload.Kind.IMAGE,
            mime="image/jpeg",
            size_bytes=resized_bytes,
            original_name=(f.name or "")[:255],
        )
        Profile.objects.filter(pk=profile.pk).update(
            storage_used_bytes=F("storage_used_bytes") + resized_bytes
        )

    return 201, {
        "id": str(upload.id),
        "url": upload.file.url,
        "size_bytes": upload.size_bytes,
        "mime": upload.mime,
        "width": src.width,
        "height": src.height,
    }


@router.post(
    "/uploads/media",
    response={201: dict, 400: dict, 401: dict, 413: dict, 415: dict},
    auth=None,
)
def upload_media(request: HttpRequest, file: NinjaUploadedFile = File(...)):
    """Upload an image or short video for chat / place attachments.

    - Images use the same MIME allowlist and ASTROZOR_MAX_UPLOAD_BYTES
      (default 8 MiB) cap as /uploads/image.
    - Videos must be MP4/WebM/Ogg/MOV and are capped at 50 MiB.
    - Storage quota is enforced per-user against Profile.storage_quota_bytes.
    """
    if not _require_auth(request):
        return 401, {"detail": "Authentication required"}

    f: UploadedFile = file  # type: ignore[assignment]
    if f.size is None:
        return 400, {"detail": "Cannot determine file size"}

    mime = (f.content_type or "").lower()
    image_max = getattr(settings, "ASTROZOR_MAX_UPLOAD_BYTES", 8 * 1024 * 1024)

    if mime in ALLOWED_IMAGE_MIME:
        kind = Upload.Kind.IMAGE
        max_size = image_max
    elif mime in ALLOWED_VIDEO_MIME:
        kind = Upload.Kind.VIDEO
        max_size = MAX_VIDEO_UPLOAD_BYTES
    else:
        return 415, {
            "detail": (
                f"Unsupported media type: {mime or 'unknown'}. "
                "Allowed: JPEG, PNG, WebP, GIF, SVG, MP4, WebM, OGG, MOV."
            )
        }

    if f.size > max_size:
        return 413, {
            "detail": f"File exceeds limit ({max_size // (1024 * 1024)} MiB) for {kind}"
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
            kind=kind,
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
        "kind": upload.kind,
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
