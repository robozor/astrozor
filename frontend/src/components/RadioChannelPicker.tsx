import { useMemo } from "react";
import { useTranslation } from "react-i18next";

// PMR446 — 16 fixed channels in Europe (CEPT). 446.00625 MHz ch.1,
// step 12.5 kHz. Channels 9-16 added in 2018 (DPMR / extended PMR).
const PMR_CH_COUNT = 16;
const PMR_BASE_HZ = 446_006_250;
const PMR_STEP_HZ = 12_500;

// CB radio — 80 channels in CEPT 80-CH allocation. The frequency
// table is non-linear (gaps exist at certain channels), so we keep
// the dropdown number-only and surface the band hint instead. Ham /
// SDR enthusiasts who care about exact frequency know the table.
const CB_CH_COUNT = 80;

/**
 * Structured picker for the event's radio frequency field. Free-form
 * text was confusing — most amateur astronomy meets agree on PMR or
 * CB channels, so we offer a dropdown of band + channel that the
 * organizer can pick from. A "Custom" option preserves the legacy
 * free-text input for SDR / amateur bands not covered by PMR / CB.
 *
 * Stored wire format:
 *   - PMR  →  "PMR 3"
 *   - CB   →  "CB 19"
 *   - custom text → as-is (e.g. "145.500 MHz FM")
 *
 * On hydrate we regex-parse the stored string back into band +
 * channel state so editing an existing PMR event re-opens the picker
 * with the right values.
 */
export function RadioChannelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseRadio(value), [value]);

  const setBand = (band: Band) => {
    if (band === "") {
      onChange("");
    } else if (band === "PMR") {
      onChange("PMR 1");
    } else if (band === "CB") {
      onChange("CB 1");
    } else if (band === "custom") {
      // Preserve any free-form text the user previously had; otherwise
      // blank so they can start typing.
      onChange(parsed.band === "custom" ? value : "");
    }
  };
  const setChannel = (ch: number) => {
    if (parsed.band === "PMR") onChange(`PMR ${ch}`);
    if (parsed.band === "CB") onChange(`CB ${ch}`);
  };
  const setCustom = (text: string) => onChange(text);

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch">
      <select
        value={parsed.band}
        onChange={(e) => setBand(e.target.value as Band)}
        data-testid="event-radio-band"
        className="bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition text-xs sm:w-44"
      >
        <option value="">{t("events.field.radio.none")}</option>
        <option value="PMR">{t("events.field.radio.pmr")}</option>
        <option value="CB">{t("events.field.radio.cb")}</option>
        <option value="custom">{t("events.field.radio.custom")}</option>
      </select>

      {parsed.band === "PMR" && (
        <select
          value={parsed.channel ?? 1}
          onChange={(e) => setChannel(parseInt(e.target.value, 10))}
          data-testid="event-radio-channel"
          className="bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs sm:w-56"
        >
          {Array.from({ length: PMR_CH_COUNT }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Ch {n} — {formatPmrMhz(n)} MHz
            </option>
          ))}
        </select>
      )}

      {parsed.band === "CB" && (
        <select
          value={parsed.channel ?? 1}
          onChange={(e) => setChannel(parseInt(e.target.value, 10))}
          data-testid="event-radio-channel"
          className="bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs sm:w-32"
        >
          {Array.from({ length: CB_CH_COUNT }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Ch {n}
            </option>
          ))}
        </select>
      )}

      {parsed.band === "custom" && (
        <input
          type="text"
          value={value}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t("events.field.radio.customPlaceholder")}
          data-testid="event-radio-custom"
          className="flex-1 bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded-md px-3 py-2 text-slate-100 outline-none transition font-mono text-xs"
        />
      )}
    </div>
  );
}

type Band = "" | "PMR" | "CB" | "custom";
type Parsed = { band: Band; channel: number | null };

function parseRadio(v: string): Parsed {
  const trimmed = (v || "").trim();
  if (!trimmed) return { band: "", channel: null };
  const m = trimmed.match(/^(PMR|CB)\s+(\d+)$/i);
  if (m) {
    const band = m[1]!.toUpperCase() as "PMR" | "CB";
    const ch = parseInt(m[2]!, 10);
    const max = band === "PMR" ? PMR_CH_COUNT : CB_CH_COUNT;
    return { band, channel: Math.max(1, Math.min(max, ch)) };
  }
  return { band: "custom", channel: null };
}

function formatPmrMhz(ch: number): string {
  const hz = PMR_BASE_HZ + (ch - 1) * PMR_STEP_HZ;
  return (hz / 1_000_000).toFixed(5);
}
