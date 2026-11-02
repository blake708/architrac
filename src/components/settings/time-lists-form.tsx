"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  type ListItem,
  type OverheadPhase,
  TIME_LIST_MESSAGES,
  type TimeListErrors,
  type TimeListsForm,
  checkNewName,
  removePhaseWarning,
  validateTimeLists,
} from "@/lib/settings/time-lists";
import { saveTimeLists } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { useSettingsForm } from "./form-state";

const FORM_ID = "time-lists-form";

/** Rows get a key that survives renames. */
type KeyedPhase = OverheadPhase & { key: string };
type State = Omit<TimeListsForm, "overheadPhases"> & { overheadPhases: KeyedPhase[] };

let nextKey = 0;
const withKeys = (f: TimeListsForm): State => ({
  ...f,
  overheadPhases: f.overheadPhases.map((p) => ({ ...p, key: p.id ?? `new-${nextKey++}` })),
});
const strip = (s: State): TimeListsForm => ({
  ...s,
  overheadPhases: s.overheadPhases.map((p) => ({
    id: p.id,
    name: p.name,
    activities: p.activities,
    loggedHours: p.loggedHours,
  })),
});

function ListError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="m-0 mt-2 text-[12.5px] text-red">{message}</p>;
}

/**
 * The dashed input + Add button. Enter adds. A duplicate shows "Already in
 * the list" and adds nothing (rule 11).
 */
function AddControl({
  list,
  placeholder,
  label,
  onAdd,
}: {
  list: readonly { name: string }[];
  placeholder: string;
  label: string;
  onAdd: (name: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const result = checkNewName(list, value);
    if (result === null) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAdd(result.name);
    setValue("");
    setError(null);
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1.5">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          maxLength={80}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            controlClasses,
            "h-7 w-[170px]! border-dashed border-faint text-sm",
          )}
        />
        <button
          type="button"
          onClick={add}
          className="h-7 cursor-pointer rounded-sm border-0 bg-ink px-2.5 text-[12.5px] font-semibold text-white hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
        >
          Add
        </button>
      </span>
      {error && (
        <span id={`${id}-error`} className="mt-1 text-[12.5px] text-red">
          {error}
        </span>
      )}
    </span>
  );
}

function Chips({
  items,
  onRemove,
  removeLabel,
}: {
  items: readonly ListItem[];
  onRemove: (index: number) => void;
  removeLabel: (name: string) => string;
}) {
  return (
    <>
      {items.map((it, i) => (
        <Chip
          key={it.id ?? `new-${it.name}`}
          label={it.name}
          onRemove={() => onRemove(i)}
          removeLabel={removeLabel(it.name)}
        />
      ))}
    </>
  );
}

/**
 * Settings → Time & approvals → "Timesheet phases & activities"
 * (settings-rates-phases spec, section C).
 */
export function TimeListsFormView({ initial }: { initial: TimeListsForm }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => withKeys(initial));
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<TimeListErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<KeyedPhase | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => JSON.stringify(strip(form)) !== JSON.stringify(strip(saved)),
    [form, saved],
  );
  const markSaved = useSettingsForm(FORM_ID, dirty, pending);

  const removeAt = <T,>(list: readonly T[], i: number) =>
    list.filter((_, j) => j !== i);
  const setPhase = (key: string, patch: Partial<OverheadPhase>) =>
    setForm((f) => ({
      ...f,
      overheadPhases: f.overheadPhases.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));
  const dropPhase = (key: string) =>
    setForm((f) => ({
      ...f,
      overheadPhases: f.overheadPhases.filter((p) => p.key !== key),
    }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || pending) return;
    const data = strip(form);
    const found = validateTimeLists(data);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner(TIME_LIST_MESSAGES.summary);
      return;
    }
    setBanner(null);
    startTransition(async () => {
      const result = await saveTimeLists(data);
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Record<string, string>);
        setBanner(result.error ?? TIME_LIST_MESSAGES.summary);
        return;
      }
      const next = withKeys(result.data.form);
      setSaved(next);
      setForm(next);
      setErrors({});
      markSaved();
      router.refresh();
    });
  }

  const block = "border-t border-line-soft pt-5 first:border-t-0 first:pt-0";
  const labelCls = "cap text-xs font-semibold text-ink";
  const hintCls = "mt-1 text-[12.5px] text-muted";

  return (
    <form
      id={FORM_ID}
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-[960px] flex-col gap-4"
    >
      {banner && <ErrorBanner message={banner} />}
      <section
        aria-labelledby="ts-lists-title"
        className="rounded-sm border border-line bg-surface px-6 pt-5 pb-6"
      >
        <h2 id="ts-lists-title" className="m-0 text-sm font-semibold">
          Timesheet phases &amp; activities
        </h2>
        <p className="m-0 mt-1.5 mb-5 max-w-[720px] text-[12.5px] leading-normal text-muted">
          Every timesheet row needs a phase and an activity. Project phases
          come from each project&apos;s Phases &amp; fees. Overhead phases,
          their activities and leave types are set here, so they match how
          your firm works.
        </p>

        <div className="flex flex-col gap-5">
          {/* 1. Project activities */}
          <div className={block} role="group" aria-labelledby="ts-project-label">
            <div id="ts-project-label" className={labelCls}>Project activities</div>
            <div className={hintCls}>Used on every project, in any phase</div>
            <div className="mt-3 flex flex-wrap items-start gap-1.5">
              <Chips
                items={form.projectActivities}
                onRemove={(i) =>
                  setForm((f) => ({ ...f, projectActivities: removeAt(f.projectActivities, i) }))
                }
                removeLabel={(n) => `Remove ${n}`}
              />
              <AddControl
                list={form.projectActivities}
                placeholder="New activity…"
                label="New project activity"
                onAdd={(name) =>
                  setForm((f) => ({
                    ...f,
                    projectActivities: [...f.projectActivities, { id: null, name }],
                  }))
                }
              />
            </div>
            <ListError message={errors.projectActivities} />
          </div>

          {/* 2. Overhead phases */}
          <div className={block} role="group" aria-labelledby="ts-overhead-label">
            <div id="ts-overhead-label" className={labelCls}>Overhead phases</div>
            <div className={hintCls}>
              Non-billable time. Each phase has its own activities, and the
              timesheet only shows the activities for the phase picked.
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {form.overheadPhases.map((p, i) => {
                const nameErr = errors[`overheadPhases.${i}.name`];
                const listErr = errors[`overheadPhases.${i}`];
                const label = p.name.trim() || "new phase";
                return (
                  <div
                    key={p.key}
                    data-testid="overhead-phase"
                    className="grid grid-cols-1 items-start gap-3 rounded-sm border border-line-soft bg-[#FCFCFC] px-3.5 py-3 md:grid-cols-[minmax(180px,230px)_1fr_auto]"
                  >
                    <div>
                      <input
                        aria-label="Overhead phase name"
                        value={p.name}
                        maxLength={80}
                        onChange={(e) => setPhase(p.key, { name: e.target.value })}
                        aria-invalid={nameErr ? true : undefined}
                        className={cn(controlClasses, "h-8 text-sm font-semibold")}
                      />
                      {nameErr ? (
                        <p className="m-0 mt-1 text-[12.5px] text-red">{nameErr}</p>
                      ) : (
                        <div className="mt-1 text-xs text-muted">
                          {p.activities.length}{" "}
                          {p.activities.length === 1 ? "activity" : "activities"}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-start gap-1.5">
                        <Chips
                          items={p.activities}
                          onRemove={(j) => setPhase(p.key, { activities: removeAt(p.activities, j) })}
                          removeLabel={(n) => `Remove ${n} from ${label}`}
                        />
                        <AddControl
                          list={p.activities}
                          placeholder="New activity…"
                          label={`New activity for ${label}`}
                          onAdd={(name) =>
                            setPhase(p.key, { activities: [...p.activities, { id: null, name }] })
                          }
                        />
                      </div>
                      <ListError message={listErr} />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove overhead phase ${label}`}
                      onClick={() => (p.loggedHours > 0 ? setConfirm(p) : dropPhase(p.key))}
                      className="h-8 cursor-pointer border-0 bg-transparent px-1 text-sm text-red hover:underline focus-visible:outline-2 focus-visible:outline-blue"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div>
                <AddControl
                  list={form.overheadPhases}
                  placeholder="New overhead phase…"
                  label="New overhead phase"
                  onAdd={(name) =>
                    setForm((f) => ({
                      ...f,
                      overheadPhases: [
                        ...f.overheadPhases,
                        { key: `new-${nextKey++}`, id: null, name, activities: [], loggedHours: 0 },
                      ],
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* 3. Leave types */}
          <div className={block} role="group" aria-labelledby="ts-leave-label">
            <div id="ts-leave-label" className={labelCls}>Leave types</div>
            <div className={hintCls}>Shown under PTO. Holidays are set by the firm calendar.</div>
            <div className="mt-3 flex flex-wrap items-start gap-1.5">
              <Chips
                items={form.leaveTypes}
                onRemove={(i) => setForm((f) => ({ ...f, leaveTypes: removeAt(f.leaveTypes, i) }))}
                removeLabel={(n) => `Remove ${n}`}
              />
              <AddControl
                list={form.leaveTypes}
                placeholder="New leave type…"
                label="New leave type"
                onAdd={(name) =>
                  setForm((f) => ({ ...f, leaveTypes: [...f.leaveTypes, { id: null, name }] }))
                }
              />
            </div>
            <ListError message={errors.leaveTypes} />
          </div>
        </div>
      </section>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent
            title={`Remove ${confirm.name}?`}
            footer={
              <>
                <Button onClick={() => setConfirm(null)}>Cancel</Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    dropPhase(confirm.key);
                    setConfirm(null);
                  }}
                >
                  Remove
                </Button>
              </>
            }
          >
            <p className="m-0 text-base">
              {removePhaseWarning(confirm.loggedHours, confirm.name)}
            </p>
          </DialogContent>
        )}
      </Dialog>
    </form>
  );
}
