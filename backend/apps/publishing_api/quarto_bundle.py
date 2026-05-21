"""Safe extraction of Quarto/RMarkdown/Jupyter HTML bundles.

A "bundle" is a ZIP archive produced by `quarto render` (or equivalent)
containing one `index.html` at the root plus an optional sibling
directory tree of figures, CSS, JS, etc. Clients (RStudio addin, VS Code
extension, CLI) zip the rendered output and POST it here.

Hardening:
- Size cap before extract (compressed) and after extract (uncompressed).
- File-count cap to avoid zip-bomb DoS.
- Path traversal rejected — no `..`, no absolute paths, no symlinks.
- `index.html` must be present at the archive root (clients pre-flatten
  any wrapping directory before zipping).
- Existing target directory is replaced atomically: extract to temp dir,
  swap in, delete old. Prevents leaving half-extracted bundles on error.
"""

from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

MAX_COMPRESSED_BYTES = 100 * 1024 * 1024  # 100 MB upload cap
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  # 500 MB extracted cap
MAX_FILE_COUNT = 2000


class BundleError(Exception):
    """Raised for any client-fixable issue with the uploaded archive."""


def _safe_member_path(name: str) -> str:
    """Return a normalized relative path, or raise if it escapes the root."""
    # zipfile uses forward-slash paths even on Windows. We normalize and
    # reject any segment that's ".." or starts with "/" (absolute).
    if not name or name.endswith("/"):
        return name  # directory entries — handled by caller
    parts = name.replace("\\", "/").split("/")
    if any(p in ("", "..") for p in parts):
        raise BundleError(f"Unsafe path in archive: {name!r}")
    if name.startswith("/"):
        raise BundleError(f"Absolute path in archive: {name!r}")
    return "/".join(parts)


def _validate_archive(zf: zipfile.ZipFile) -> int:
    """Inspect the zip without extracting. Returns total uncompressed size."""
    members = zf.infolist()
    if len(members) > MAX_FILE_COUNT:
        raise BundleError(f"Too many files in archive ({len(members)} > {MAX_FILE_COUNT})")

    total = 0
    saw_index = False
    for m in members:
        # Reject symlinks (Unix mode bits in external_attr high bits)
        # Mode 0o120000 = symlink. Zip external_attr stores it shifted left 16.
        unix_mode = (m.external_attr >> 16) & 0o170000
        if unix_mode == 0o120000:
            raise BundleError(f"Symlinks are not allowed: {m.filename!r}")

        safe = _safe_member_path(m.filename)
        if safe == "index.html":
            saw_index = True
        total += m.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            raise BundleError(
                f"Uncompressed archive exceeds {MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} MB cap"
            )

    if not saw_index:
        raise BundleError("Archive must contain 'index.html' at root")
    return total


def extract_bundle(zip_bytes: bytes, target_dir: Path) -> int:
    """Extract a Quarto bundle into target_dir atomically.

    Returns the on-disk byte size of the extracted bundle (for quota).
    Raises BundleError on any validation failure; the target directory
    is left untouched in that case.
    """
    if len(zip_bytes) > MAX_COMPRESSED_BYTES:
        raise BundleError(
            f"Upload exceeds {MAX_COMPRESSED_BYTES // (1024 * 1024)} MB compressed cap"
        )

    # Validate first, then extract to temp dir, then swap in.
    import io

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            uncompressed_size = _validate_archive(zf)

            tmp = Path(tempfile.mkdtemp(prefix="quarto_extract_"))
            try:
                for m in zf.infolist():
                    if m.is_dir():
                        continue
                    safe = _safe_member_path(m.filename)
                    out_path = tmp / safe
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(m, "r") as src, out_path.open("wb") as dst:
                        shutil.copyfileobj(src, dst)

                # Atomic swap — remove old target then move temp in.
                target_dir.parent.mkdir(parents=True, exist_ok=True)
                if target_dir.exists():
                    shutil.rmtree(target_dir)
                shutil.move(str(tmp), str(target_dir))
                tmp = None  # don't clean up — it's been moved
            finally:
                if tmp is not None and tmp.exists():
                    shutil.rmtree(tmp, ignore_errors=True)
    except zipfile.BadZipFile as e:
        raise BundleError(f"Invalid ZIP archive: {e}") from e

    return uncompressed_size


def remove_bundle(target_dir: Path) -> None:
    """Remove an extracted bundle. Silent if directory doesn't exist."""
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)
