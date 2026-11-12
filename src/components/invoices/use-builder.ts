"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BuilderView } from "@/server/invoices/view";

// The builder's state: the latest view from the server, and a queue so
// saves run one at a time, each with the newest version (a quick second
// change never races the first and trips the stale check).

type Result = { ok: true; data: BuilderView } | { ok: false; error?: string; fieldErrors?: Partial<Record<string, string>> };
type Action<I> = (input: I & { invoiceId: string; version: string }) => Promise<Result>;

export function useBuilder(initial: BuilderView) {
  const [view, setView] = useState(initial);
  // The page refreshes after every save (and on Reload). Take the server's
  // copy only when it's a version this page hasn't seen, so open dialogs and
  // half-typed boxes survive a save.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    // Versions are timestamps: an older copy arriving late is ignored.
    if (initial.version > view.version) setView(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(0);
  const latest = useRef(initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (view.version > latest.current.version) latest.current = view;
  }, [view]);

  /** Run a builder action; resolves true when it worked. `errorKey` scopes a field error (e.g. a phase id). */
  const run = useCallback(<I extends object>(action: Action<I>, input: I, errorKey?: string): Promise<boolean> => {
    setBusy((n) => n + 1);
    const next = chain.current.then(async () => {
      try {
        const r = await action({ ...input, invoiceId: latest.current.id, version: latest.current.version });
        if (!r.ok) {
          const fields = r.fieldErrors ?? {};
          setFieldErrors(errorKey ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${errorKey}:${k}`, v])) : fields);
          setError(Object.keys(fields).length ? null : (r.error ?? "Couldn't save. Try again."));
          return false;
        }
        latest.current = r.data;
        setView(r.data);
        setError(null);
        setFieldErrors({});
        return true;
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
        return false;
      } finally {
        setBusy((n) => n - 1);
      }
    });
    chain.current = next;
    return next;
  }, []);

  return { view, error, setError, fieldErrors, saving: busy > 0, run };
}
