import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ZooniverseSubjectMedia } from "../lib/api";
import { resolveSubjectMedia } from "./SubjectMediaGrid";

/**
 * Single-pane media viewer matching Zooniverse Talk's pattern.
 *
 * For one media item it's just a viewer. For multiple items
 * (Gravity Spy's 4 spectrogram frames, multi-band imagery, …) it
 * adds:
 *
 *   * ◀ / ▶ arrows to step through frames
 *   * ⏵ / ⏸ to auto-cycle (default-on, simulates the video-like
 *     feel of the upstream Talk page)
 *   * Frame counter and dots indicator
 *
 * Every frame is rendered once but only the active one is visible
 * — pre-loading via the browser cache so subsequent cycles don't
 * flicker through the network. Audio and video frames don't pre-load
 * fully (we leave ``preload="metadata"`` on those).
 *
 * Works for image / video / audio MIME prefixes. Unknown MIME →
 * image with onError fallback to a plain link.
 */
export function MediaBrowser({
  media,
  locations,
  alt = "",
  size = "md",
  autoplay = true,
  intervalMs = 700,
}: {
  media: ZooniverseSubjectMedia[] | undefined;
  locations: string[] | undefined;
  alt?: string;
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  intervalMs?: number;
}) {
  const { t } = useTranslation();
  const items = resolveSubjectMedia(media, locations);
  const [index, setIndex] = useState(0);
  const multi = items.length > 1;
  const [playing, setPlaying] = useState(autoplay && multi);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || !multi) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, intervalMs);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, multi, items.length, intervalMs]);

  if (items.length === 0) {
    return (
      <div className="w-full h-40 bg-slate-900/60 ring-1 ring-slate-800 rounded grid place-items-center text-slate-500 text-3xl">
        🔭
      </div>
    );
  }

  const stageH =
    size === "sm"
      ? "h-32"
      : size === "lg"
        ? "h-72 sm:h-96"
        : "h-56 sm:h-72";

  const prev = () => {
    setPlaying(false);
    setIndex((i) => (i - 1 + items.length) % items.length);
  };
  const next = () => {
    setPlaying(false);
    setIndex((i) => (i + 1) % items.length);
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative ${stageH} bg-slate-950 rounded-md ring-1 ring-slate-800 overflow-hidden`}
        // Hover pauses auto-cycle so the user can read the current
        // frame without it flipping under them. Resumes on leave
        // only if it was playing before.
        onMouseEnter={() => {
          if (playing) setPlaying(false);
        }}
      >
        {items.map((m, i) => (
          <MediaFrame
            key={`${m.url}-${i}`}
            mediaItem={m}
            alt={alt || `Frame ${i + 1}`}
            visible={i === index}
          />
        ))}
        {multi && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label={t("common.previous")}
              className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full bg-slate-950/70 ring-1 ring-slate-700 hover:bg-slate-800 text-slate-200 transition"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={next}
              aria-label={t("common.next")}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full bg-slate-950/70 ring-1 ring-slate-700 hover:bg-slate-800 text-slate-200 transition"
            >
              ▶
            </button>
          </>
        )}
      </div>
      {multi && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 ring-1 ring-slate-700 px-2 py-0.5 rounded transition"
            aria-label={
              playing ? t("media.pauseLabel") : t("media.playLabel")
            }
          >
            {playing ? "⏸" : "▶"} {playing ? t("media.pause") : t("media.play")}
          </button>
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setIndex(i);
                }}
                aria-label={t("media.gotoFrame", { n: i + 1 })}
                className={`w-2 h-2 rounded-full transition ${
                  i === index
                    ? "bg-fuchsia-400"
                    : "bg-slate-700 hover:bg-slate-500"
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-slate-400 tabular-nums">
            {index + 1} / {items.length}
          </span>
        </div>
      )}
    </div>
  );
}

function MediaFrame({
  mediaItem,
  alt,
  visible,
}: {
  mediaItem: ZooniverseSubjectMedia;
  alt: string;
  visible: boolean;
}) {
  const m = mediaItem.mime || "image/*";
  // ``visibility:hidden`` keeps the element in the DOM (and the
  // browser cache primed) so cycling between frames is instant.
  // ``display:none`` would defeat that on some browsers because
  // they pause network for hidden trees.
  const baseClass = `absolute inset-0 w-full h-full object-contain ${
    visible ? "" : "invisible pointer-events-none"
  }`;
  if (m.startsWith("video/")) {
    return (
      <video
        src={mediaItem.url}
        controls={visible}
        preload="metadata"
        className={baseClass}
      />
    );
  }
  if (m.startsWith("audio/")) {
    return (
      <div className={`${baseClass} grid place-items-center bg-slate-950`}>
        <audio src={mediaItem.url} controls className="w-3/4" />
      </div>
    );
  }
  return (
    <img
      src={mediaItem.url}
      alt={alt}
      loading="eager"
      className={baseClass}
      onError={(e) => {
        // Last-resort: link out so the user can still reach the
        // image via the CDN even if the inline render fails.
        const img = e.currentTarget;
        const link = document.createElement("a");
        link.href = mediaItem.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.innerText = alt;
        link.className =
          "absolute inset-0 grid place-items-center text-xs text-indigo-300 underline p-3 text-center";
        img.replaceWith(link);
      }}
    />
  );
}
