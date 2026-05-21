import { useCallback, useEffect, useState } from "react";

/**
 * Two-way bind a single URL query parameter to React state.
 *
 * - Reads the param from ``window.location.search`` at mount.
 * - On set, ``pushState``s a new URL preserving the rest of the search
 *   string + pathname + hash. Refresh and share-links work.
 * - Subscribes to ``popstate`` so browser Back/Forward syncs back into
 *   state (e.g. closing a detail panel via the Back button).
 *
 * The setter accepts ``null`` to clear the param entirely. Useful for
 * detail panels: ``setSlug(null)`` returns to the list view.
 *
 * Pass ``replace: true`` if the navigation should not pollute history
 * (typically used during initial cleanup after an OAuth callback).
 *
 * @example
 *     const [projectId, setProjectId] = useUrlParam("p");
 *     // /citizen-science?p=5733 → projectId === "5733"
 *     setProjectId("1879");      // → /citizen-science?p=1879
 *     setProjectId(null);        // → /citizen-science
 */
export function useUrlParam(
  name: string,
): [string | null, (value: string | null, opts?: { replace?: boolean }) => void] {
  const read = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get(name);
  }, [name]);

  const [value, setValue] = useState<string | null>(read);

  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);

  const set = useCallback(
    (next: string | null, opts?: { replace?: boolean }) => {
      setValue(next);
      const params = new URLSearchParams(window.location.search);
      if (next === null || next === "") {
        params.delete(name);
      } else {
        params.set(name, next);
      }
      const qs = params.toString();
      const url =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      // Avoid duplicate consecutive history entries when value is unchanged.
      if (window.location.pathname + window.location.search + window.location.hash === url) {
        return;
      }
      if (opts?.replace) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }
      // Two components can read the same URL param via separate
      // useUrlParam hooks (e.g. CitizenSciencePage owns ``?s`` for
      // routing while SprintsSection writes to it from inside a deep
      // component tree). pushState alone doesn't notify siblings —
      // we manually fire popstate so every useUrlParam in the app
      // re-reads from the URL, matching the behaviour of
      // ``navigateTo`` for cross-page navigation.
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [name],
  );

  return [value, set];
}

/**
 * Cross-page client-side navigation helper. Pushes a new URL and emits
 * a ``popstate`` so anything listening (the top-level page route hook
 * + every ``useUrlParam``) re-reads the location. Without the manual
 * dispatch ``pushState`` is silent, so React state wouldn't update.
 *
 * Use it when a piece of UI on one page needs to send the user to a
 * URL belonging to a different section (e.g. clicking a campaign on
 * the events calendar should land on Citizen Science → project detail).
 *
 * @example
 *     navigateTo(`/citizen-science?p=${zid}`);
 */
export function navigateTo(url: string) {
  if (typeof window === "undefined") return;
  if (window.location.pathname + window.location.search + window.location.hash === url) {
    return;
  }
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
