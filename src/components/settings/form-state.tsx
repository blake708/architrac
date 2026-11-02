"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Settings sections share one page frame: the Save changes button sits in
// the header band, the form sits in Main, and the section menu needs to know
// about unsaved changes. This context connects them (settings-firm spec,
// Layout §1 and business rule 4).

type FormState = { formId: string; dirty: boolean; pending: boolean };

type Ctx = {
  form: FormState | null;
  setForm: (form: FormState | null) => void;
  /** "✓ Saved" shows for 4 seconds after a save. */
  saved: boolean;
  markSaved: () => void;
};

const SettingsFormContext = createContext<Ctx | null>(null);

export const DISCARD_MESSAGE = "Discard unsaved changes?";

export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const markSaved = useCallback(() => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 4000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Leaving the page (reload, close tab) with unsaved changes asks first.
  const dirty = form?.dirty ?? false;
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const value = useMemo(
    () => ({ form, setForm, saved: saved && !dirty, markSaved }),
    [form, saved, dirty, markSaved],
  );
  return (
    <SettingsFormContext.Provider value={value}>
      {children}
    </SettingsFormContext.Provider>
  );
}

function useCtx() {
  const ctx = useContext(SettingsFormContext);
  if (!ctx) throw new Error("Needs <SettingsFormProvider> around it");
  return ctx;
}

/** For the header band and the section menu. */
export function useSettingsFormStatus() {
  const { form, saved } = useCtx();
  return { form, saved };
}

/**
 * For a section's form: tell the frame its id and state. Returns markSaved,
 * to call after a successful save.
 */
export function useSettingsForm(
  formId: string,
  dirty: boolean,
  pending: boolean,
) {
  const { setForm, markSaved } = useCtx();
  useEffect(() => {
    setForm({ formId, dirty, pending });
  }, [setForm, formId, dirty, pending]);
  useEffect(() => () => setForm(null), [setForm]);
  return markSaved;
}

/**
 * For sections that save each change straight away (no Save button). Saves
 * run one at a time, in order, so a quick second change never races the
 * first. `fn` should read the latest values when it runs (use a ref) and
 * resolve true if the save worked.
 */
export function useInstantSave(formId: string) {
  const [inFlight, setInFlight] = useState(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const markSaved = useSettingsForm(formId, false, inFlight > 0);

  const save = useCallback(
    (fn: () => Promise<boolean>) => {
      setInFlight((n) => n + 1);
      chain.current = chain.current
        .then(fn)
        .then(
          (ok) => {
            if (ok) markSaved();
          },
          (err: unknown) => console.error("Instant save failed", err),
        )
        .finally(() => setInFlight((n) => n - 1));
      return chain.current;
    },
    [markSaved],
  );

  return { saving: inFlight > 0, save };
}

/**
 * Put on an instant-save <form> as onKeyDown: Enter in a one-line field saves
 * it by leaving the field. (A form with no submit button ignores Enter.)
 * Controls that handle Enter themselves call preventDefault first.
 */
export function blurOnEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  const t = e.target as HTMLElement;
  if (e.key !== "Enter" || e.defaultPrevented || t.tagName !== "INPUT") return;
  e.preventDefault();
  t.blur();
}
