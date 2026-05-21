import type { ZooniverseSubjectMedia } from "../lib/api";

/** Pure helper: list of media + URL fallback → renderable items.
 *
 * If ``media`` has MIME info we trust it. Legacy attachments only
 * carried plain URLs (``locations``), so we fall back to guessing
 * MIME from the URL extension. The default for unknown extensions
 * is ``image/*`` — empirically the most common subject medium and
 * the <img> renderer is the most tolerant on failure.
 */
function pickMime(url: string): string {
  const lower = url.toLowerCase().split("?")[0];
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".svg")
  ) {
    return "image/" + lower.split(".").pop();
  }
  if (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".ogv") ||
    lower.endsWith(".mov")
  ) {
    return "video/" + lower.split(".").pop();
  }
  if (
    lower.endsWith(".mp3") ||
    lower.endsWith(".wav") ||
    lower.endsWith(".ogg") ||
    lower.endsWith(".flac") ||
    lower.endsWith(".m4a")
  ) {
    return "audio/" + lower.split(".").pop();
  }
  return "image/*";
}

export function resolveSubjectMedia(
  media: ZooniverseSubjectMedia[] | undefined,
  locations: string[] | undefined,
): ZooniverseSubjectMedia[] {
  if (media && media.length > 0) {
    return media.map((m) => ({
      url: m.url,
      mime: m.mime || pickMime(m.url),
    }));
  }
  return (locations ?? []).map((url) => ({ url, mime: pickMime(url) }));
}

/** Grid renderer for the media of one Zooniverse subject.
 *
 * Layout adapts to the count: single big tile for 1, side-by-side
 * for 2, 2×2 for 3–4, 3-col grid for 5+. Each tile picks the right
 * HTML element from the MIME prefix. Failed loads (broken URL,
 * blocked CDN) fall back to a small placeholder so the row stays
 * structurally stable.
 */
export function SubjectMediaGrid({
  media,
  locations,
  size = "md",
  alt = "",
}: {
  media: ZooniverseSubjectMedia[] | undefined;
  locations: string[] | undefined;
  size?: "sm" | "md" | "lg";
  alt?: string;
}) {
  const items = resolveSubjectMedia(media, locations);
  if (items.length === 0) {
    return (
      <div className="w-full h-32 bg-slate-900/60 ring-1 ring-slate-800 rounded grid place-items-center text-slate-500 text-3xl">
        🔭
      </div>
    );
  }
  const cols =
    items.length === 1
      ? "grid-cols-1"
      : items.length === 2
        ? "grid-cols-2"
        : items.length <= 4
          ? "grid-cols-2"
          : "grid-cols-2 sm:grid-cols-3";
  const tileH =
    size === "sm" ? "h-24" : size === "lg" ? "h-64 sm:h-72" : "h-40 sm:h-48";
  return (
    <div className={`grid ${cols} gap-2`}>
      {items.map((m, i) => (
        <SubjectMediaTile
          key={`${m.url}-${i}`}
          mediaItem={m}
          alt={alt || `Frame ${i + 1}`}
          tileH={tileH}
        />
      ))}
    </div>
  );
}

function SubjectMediaTile({
  mediaItem,
  alt,
  tileH,
}: {
  mediaItem: ZooniverseSubjectMedia;
  alt: string;
  tileH: string;
}) {
  const m = mediaItem.mime || "image/*";
  if (m.startsWith("video/")) {
    return (
      <video
        src={mediaItem.url}
        controls
        preload="metadata"
        className={`w-full ${tileH} object-contain bg-slate-950 rounded ring-1 ring-slate-800`}
      />
    );
  }
  if (m.startsWith("audio/")) {
    return (
      <div
        className={`w-full ${tileH} bg-slate-950 rounded ring-1 ring-slate-800 grid place-items-center p-2`}
      >
        <audio src={mediaItem.url} controls className="w-full" />
      </div>
    );
  }
  // image/* (or unknown — try image then fall back to a link)
  return (
    <img
      src={mediaItem.url}
      alt={alt}
      loading="lazy"
      className={`w-full ${tileH} object-contain bg-slate-950 rounded ring-1 ring-slate-800`}
      onError={(e) => {
        const t = e.currentTarget;
        t.replaceWith(
          Object.assign(document.createElement("a"), {
            href: mediaItem.url,
            target: "_blank",
            rel: "noopener noreferrer",
            innerText: alt,
            className:
              "text-[11px] text-indigo-300 underline break-all p-2 block",
          }),
        );
      }}
    />
  );
}
