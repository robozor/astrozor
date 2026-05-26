import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  geocoding,
  places as placesApi,
  type Me,
  type OpeningSchedule,
  type Place,
  type PlaceCreateIn,
  type PlacePatchIn,
  type VisibilityLevel,
} from "../lib/api";
import { OpeningHoursEditor } from "./OpeningHoursEditor";
import { VisibilityPicker } from "./VisibilityPicker";

const ALL_KINDS: Place["kind"][] = [
  "observatory_public",
  "observatory_private",
  "spot_permanent",
  "spot_temporary",
];

export function PlaceFormModal({
  mode,
  initial,
  me,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: Partial<Place> & { lat: number; lon: number };
  me: Me;
  onClose: () => void;
  onSaved: (p: Place) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isStaff = me.user.is_staff;
  const editingExisting = mode === "edit" && !!initial.slug;

  // Non-staff can only create temporary spots
  const [kind, setKind] = useState<Place["kind"]>(
    initial.kind ?? (isStaff ? "observatory_public" : "spot_temporary"),
  );
  const [name, setName] = useState(initial.name ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [lat, setLat] = useState(initial.lat);
  const [lon, setLon] = useState(initial.lon);
  const [elevation, setElevation] = useState<string>(
    initial.elevation_m != null ? String(initial.elevation_m) : "",
  );
  const [elevLoading, setElevLoading] = useState(false);
  const [elevError, setElevError] = useState<string | null>(null);

  /** Look up SRTM elevation for current lat/lon via our backend proxy.
   * Used both as auto-fill on first open (when elevation is empty) and
   * via the ↻ button when the admin moves the place to new coords. */
  async function fetchElevation(force = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!force && elevation !== "") return; // don't clobber user-entered value
    setElevLoading(true);
    setElevError(null);
    try {
      const r = await geocoding.elevation(lat, lon);
      setElevation(String(r.elevation_m));
    } catch (e) {
      setElevError(e instanceof Error ? e.message : "elevation lookup failed");
    } finally {
      setElevLoading(false);
    }
  }

  // Auto-fill elevation on mount if it's missing. Intentionally NOT
  // re-running on lat/lon change — user might be still typing coords.
  // Manual refresh is the ↻ button next to the field.
  useEffect(() => {
    if (elevation === "" && Number.isFinite(initial.lat) && Number.isFinite(initial.lon)) {
      fetchElevation(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [address, setAddress] = useState(initial.address ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [contact, setContact] = useState(initial.contact ?? "");
  const [openingHours, setOpeningHours] = useState(initial.opening_hours ?? "");
  const [schedule, setSchedule] = useState<OpeningSchedule>(
    (initial as Place).opening_hours_schedule ?? {},
  );
  const [bortle, setBortle] = useState<string>(
    initial.bortle_class != null ? String(initial.bortle_class) : "",
  );
  // Visibility — see apps/core/visibility.py for the 4-level system.
  // Discussion empty string = inherit from main visibility.
  const [visibility, setVisibility] = useState<VisibilityLevel>(
    (initial as Place).visibility ?? "public",
  );
  const [allowedEmails, setAllowedEmails] = useState<string[]>(
    (initial as Place).allowed_user_emails ?? [],
  );
  const [discussionVisibility, setDiscussionVisibility] = useState<"" | VisibilityLevel>(
    (initial as Place).discussion_visibility ?? "",
  );
  const [discussionAllowedEmails, setDiscussionAllowedEmails] = useState<string[]>(
    (initial as Place).discussion_allowed_user_emails ?? [],
  );
  // For temporary spots: when the place expires. Default is +4 hours from
  // the moment the modal opened. <input type="datetime-local"> needs the
  // `YYYY-MM-DDTHH:MM` shape; we keep the value in that shape and convert
  // to ISO on submit.
  const [validTo, setValidTo] = useState<string>(() => {
    const base = (initial as Place).valid_to;
    const dt = base ? new Date(base) : new Date(Date.now() + 4 * 3600_000);
    // Trim seconds + zone — datetime-local only accepts minute precision.
    const off = dt.getTimezoneOffset();
    const local = new Date(dt.getTime() - off * 60_000);
    return local.toISOString().slice(0, 16);
  });

  const allowedKinds = isStaff ? ALL_KINDS : (["spot_temporary"] as Place["kind"][]);

  const save = useMutation({
    mutationFn: () => {
      const body: PlaceCreateIn = {
        name: name.trim(),
        kind,
        description,
        lat,
        lon,
        elevation_m: elevation === "" ? null : Number(elevation),
        address,
        website,
        contact,
        opening_hours: openingHours,
        opening_hours_schedule: schedule,
        bortle_class: bortle === "" ? null : Number(bortle),
        visibility,
        allowed_user_emails: allowedEmails,
        discussion_visibility: discussionVisibility,
        discussion_allowed_user_emails: discussionAllowedEmails,
        // Backend only honours valid_to for temporary spots; sending null
        // for non-temp keeps the model field clean.
        valid_to: kind === "spot_temporary" ? new Date(validTo).toISOString() : null,
      };
      if (editingExisting) {
        const patch: PlacePatchIn = { ...body };
        return placesApi.patch(initial.slug!, patch);
      }
      return placesApi.create(body);
    },
    onSuccess: (place) => {
      qc.invalidateQueries({ queryKey: ["places"] });
      qc.invalidateQueries({ queryKey: ["place", place.slug] });
      onSaved(place);
    },
  });

  const canSubmit = name.trim().length >= 2 && Number.isFinite(lat) && Number.isFinite(lon);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16"
      // No onClick=onClose on the backdrop: misclick used to silently
      // discard the entire form (#20). Closing happens through the ✕
      // button or the Cancel action only.
      data-testid="place-form-modal"
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto dark-scroll p-5"
      >
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {editingExisting
              ? t("place.form.editTitle")
              : t("place.form.createTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100"
          >
            ✕
          </button>
        </header>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) save.mutate();
          }}
        >
          <Field label={t("place.form.name") + " *"}>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100"
            />
          </Field>

          <Field label={t("place.form.kind")}>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Place["kind"])}
              disabled={!isStaff && editingExisting}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 disabled:opacity-60"
            >
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {t(`places.kind.${k}`)}
                </option>
              ))}
            </select>
            {!isStaff && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t("place.form.kindHint")}
              </p>
            )}
          </Field>

          {kind === "spot_temporary" && (
            <Field label={t("place.form.validTo")}>
              <input
                type="datetime-local"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t("place.form.validToHint")}
              </p>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("place.form.lat")}>
              <input
                type="number"
                step="0.0001"
                value={lat}
                onChange={(e) => setLat(Number(e.target.value))}
                className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
              />
            </Field>
            <Field label={t("place.form.lon")}>
              <input
                type="number"
                step="0.0001"
                value={lon}
                onChange={(e) => setLon(Number(e.target.value))}
                className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
              />
            </Field>
          </div>

          <Field label={t("place.form.description")}>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 resize-y"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("place.form.elevation")}>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={elevation}
                  onChange={(e) => setElevation(e.target.value)}
                  placeholder={
                    elevLoading ? t("place.form.elevationFetching") : ""
                  }
                  className="flex-1 bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
                />
                <button
                  type="button"
                  onClick={() => fetchElevation(true)}
                  disabled={elevLoading || !Number.isFinite(lat) || !Number.isFinite(lon)}
                  title={t("place.form.elevationRefetch")}
                  aria-label={t("place.form.elevationRefetch")}
                  className="px-2 py-1.5 rounded ring-1 ring-slate-700 hover:bg-slate-800 text-slate-300 disabled:opacity-50"
                  data-testid="place-form-elevation-refresh"
                >
                  {elevLoading ? "…" : "↻"}
                </button>
              </div>
              {elevError && (
                <p className="text-[10px] text-rose-400 mt-0.5">{elevError}</p>
              )}
            </Field>
            <Field label={t("place.form.bortle")}>
              <input
                type="number"
                step="0.1"
                min="1"
                max="9"
                value={bortle}
                onChange={(e) => setBortle(e.target.value)}
                placeholder={t("place.form.bortleAuto")}
                className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 font-mono"
              />
            </Field>
          </div>

          <Field label={t("place.form.address")}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100"
            />
          </Field>

          <Field label={t("place.form.website")}>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100"
            />
          </Field>

          <Field label={t("place.form.contact")}>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="w-full bg-slate-950 ring-1 ring-slate-700 rounded px-2 py-1.5 text-sm text-slate-100"
            />
          </Field>

          <Field label={t("place.form.openingHours")}>
            <OpeningHoursEditor value={schedule} onChange={setSchedule} />
          </Field>

          <Field label={t("place.form.openingHoursNote")}>
            <textarea
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              placeholder={t("place.form.openingHoursNotePlaceholder")}
              rows={3}
              className="w-full bg-slate-950 ring-1 ring-slate-700 focus:ring-slate-500 rounded px-2 py-1.5 text-sm text-slate-100 resize-y min-h-[4.5rem] max-h-[16rem]"
            />
          </Field>

          <div className="bg-slate-950/50 ring-1 ring-slate-800 rounded-md p-3 space-y-3">
            <VisibilityPicker
              label={t("visibility.label")}
              value={visibility}
              allowedEmails={allowedEmails}
              onChange={(v) => v && setVisibility(v as VisibilityLevel)}
              onAllowedEmailsChange={setAllowedEmails}
              ownerEmail={initial.owner_email || me.user.email}
              testidPrefix="place-visibility"
            />
            <VisibilityPicker
              label={t("visibility.discussionLabel")}
              value={discussionVisibility}
              allowedEmails={discussionAllowedEmails}
              onChange={setDiscussionVisibility}
              onAllowedEmailsChange={setDiscussionAllowedEmails}
              allowInherit
              ownerEmail={initial.owner_email || me.user.email}
              testidPrefix="place-discussion-visibility"
            />
          </div>

          {save.isError && (
            <p className="text-rose-400 text-xs">
              {(save.error as Error)?.message}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={!canSubmit || save.isPending}
              data-testid="place-form-save"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm px-3 py-2 rounded-md transition"
            >
              {save.isPending
                ? "…"
                : editingExisting
                  ? t("place.form.saveChanges")
                  : t("place.form.create")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-md ring-1 ring-slate-700 text-slate-300 hover:bg-slate-800 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
