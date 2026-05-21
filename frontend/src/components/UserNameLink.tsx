import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { users, type PublicProfile } from "../lib/api";

/**
 * Clickable username chip. Anywhere a user appears in the UI (article
 * author, comment author, check-in user, place owner, …), wrap their
 * display name in this so a click opens a read-only profile modal.
 *
 * Identity is the user's e-mail because that's what existing API
 * responses already expose (`author_email`, `user_email`, …). We never
 * leak email back to the visitor — it's purely the lookup key.
 *
 * Pass `email` empty/null to render a plain non-clickable span (useful
 * for anonymous check-ins).
 */
export function UserNameLink({
  email,
  displayName,
  className = "",
  testid,
}: {
  email?: string | null;
  displayName: string;
  className?: string;
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!email) {
    return <span className={className}>{displayName}</span>;
  }
  // We render as a <span role="button"> (not <button>) because callers
  // already wrap us in clickable contexts — e.g. ArticleCard is one big
  // <button>, and nested buttons are invalid HTML (browser strips the
  // inner one + React DOM-nesting warning). Click handler stops
  // propagation so the outer card's click never fires.
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        data-testid={testid}
        className={`${className} hover:text-indigo-300 hover:underline cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded`}
        title={displayName}
      >
        {displayName}
      </span>
      {open && <UserProfileModal email={email} onClose={() => setOpen(false)} />}
    </>
  );
}

function UserProfileModal({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["user-profile", email],
    queryFn: () => users.profileByEmail(email),
    staleTime: 60_000,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-slate-900 ring-1 ring-slate-700 rounded-xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="font-medium text-slate-100">
            {t("user.profile.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-lg"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>

        <div className="p-4">
          {q.isLoading && (
            <p className="text-slate-400 text-sm">{t("common.loading")}</p>
          )}
          {q.isError && (
            <p className="text-rose-400 text-sm">{t("user.profile.notFound")}</p>
          )}
          {q.data && <ProfileBody profile={q.data} />}
        </div>
      </div>
    </div>
  );
}

function ProfileBody({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  const memberSince = new Date(profile.created_at).toLocaleDateString();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="w-14 h-14 rounded-full bg-slate-800 ring-1 ring-slate-700"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-slate-800 ring-1 ring-slate-700 flex items-center justify-center text-slate-400 text-xl">
            {(profile.display_name || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-lg font-medium text-slate-100 truncate">
            {profile.display_name}
          </p>
          <p className="text-[11px] text-slate-500">
            {t("user.profile.memberSince", { date: memberSince })}
          </p>
        </div>
      </div>

      {profile.bio && (
        <Field label={t("user.profile.bio")}>
          <p className="text-sm text-slate-200 whitespace-pre-line">
            {profile.bio}
          </p>
        </Field>
      )}
      {profile.club && (
        <Field label={t("user.profile.club")}>
          <p className="text-sm text-slate-200">{profile.club}</p>
        </Field>
      )}
      {profile.equipment && (
        <Field label={t("user.profile.equipment")}>
          <p className="text-sm text-slate-200 whitespace-pre-line">
            {profile.equipment}
          </p>
        </Field>
      )}
      {profile.location_label && profile.location_visibility !== "hidden" && (
        <Field label={t("user.profile.location")}>
          <p className="text-sm text-slate-200">
            {profile.location_label}{" "}
            {profile.location_visibility === "region" && (
              <span className="text-[11px] text-slate-500">
                ({t("user.profile.regionApprox")})
              </span>
            )}
          </p>
        </Field>
      )}

      {!profile.bio &&
        !profile.club &&
        !profile.equipment &&
        !profile.location_label && (
          <p className="text-xs text-slate-500 italic">
            {t("user.profile.empty")}
          </p>
        )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}
