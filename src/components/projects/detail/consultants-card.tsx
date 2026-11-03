"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { DISCIPLINES, moneyInput, parseMoney } from "@/lib/projects/form";
import { removeConsultant, saveConsultant } from "@/server/projects/actions";
import type { CompanyChoice, ConsultantRow } from "@/server/projects/page";

const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium text-muted first:pl-[18px] last:pr-[18px]";
const td = "border-b border-line-soft px-2.5 py-2.5 first:pl-[18px] last:pr-[18px]";
const OTHER = "__other";

/** Consultants card (project-detail spec, Phases & fees tab; rule 7). */
export function ConsultantsCard({
  projectId,
  rows,
  choices,
  canEdit,
  defaultMarkupBp,
}: {
  projectId: string;
  rows: ConsultantRow[];
  choices: CompanyChoice[];
  canEdit: boolean;
  defaultMarkupBp: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ConsultantRow | "new" | null>(null);
  const [removing, setRemoving] = useState<ConsultantRow | null>(null);
  const fee = rows.reduce((n, c) => n + (c.money?.feeCents ?? 0), 0);
  const toClient = rows.reduce((n, c) => n + (c.money?.feeToClientCents ?? 0), 0);

  return (
    <section aria-label="Consultants" className="rounded-sm border border-line bg-surface">
      <header className="flex items-center px-[var(--spacing-card)] pt-4 pb-3">
        <h2 className="m-0 text-sm font-semibold">Consultants</h2>
        {canEdit && (
          <Button className="ml-auto" icon={<PlusIcon />} onClick={() => setEditing("new")}>
            Add consultant
          </Button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="m-0 px-[var(--spacing-card)] pb-5 text-sm text-muted">No consultants on this project.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={th}>Discipline</th>
                <th scope="col" className={th}>Consultant</th>
                <th scope="col" className={cn(th, "text-right")}>Fee</th>
                <th scope="col" className={cn(th, "text-right")}>Markup</th>
                <th scope="col" className={cn(th, "text-right")}>Fee to client</th>
                {canEdit && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-consultant={c.discipline}>
                  <td className={td}>{c.discipline}</td>
                  <td className={td}>
                    {c.companyName}
                    {c.contact && <span className="block text-xs text-muted">{c.contact.name}</span>}
                  </td>
                  <td className={cn(td, "num text-right")}>{formatMoney(c.money?.feeCents ?? 0)}</td>
                  <td className={cn(td, "num text-right")}>{(c.money?.markupBp ?? 0) / 100}%</td>
                  <td className={cn(td, "num text-right")}>
                    {c.money?.feeToClientCents == null ? <span className="text-muted">Not billed through</span> : formatMoney(c.money.feeToClientCents)}
                  </td>
                  {canEdit && (
                    <td className={cn(td, "text-right whitespace-nowrap")}>
                      <Button variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.discipline}`}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => setRemoving(c)} aria-label={`Remove ${c.discipline}`}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-2.5 py-2.5 pl-[18px]" colSpan={2}>Total</td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="consultant-fee-total">{formatMoney(fee)}</td>
                <td />
                <td className="num px-2.5 py-2.5 text-right" data-testid="consultant-client-total">{formatMoney(toClient)}</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && (
        <ConsultantDialog
          projectId={projectId}
          row={editing === "new" ? null : editing}
          choices={choices}
          defaultMarkupBp={defaultMarkupBp}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            toast(msg);
            router.refresh();
          }}
        />
      )}
      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        {removing && (
          <DialogContent
            title={`Remove ${removing.discipline}?`}
            description={`${removing.companyName} comes off this project. Nothing else changes.`}
            footer={
              <>
                <Button onClick={() => setRemoving(null)}>Cancel</Button>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeConsultant({ projectId, id: removing.id });
                      setRemoving(null);
                      if (!r.ok) return toast(r.error ?? "Couldn't remove.", "error");
                      toast(`${removing.discipline} removed`);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </section>
  );
}

function ConsultantDialog({
  projectId,
  row,
  choices,
  defaultMarkupBp,
  onClose,
  onSaved,
}: {
  projectId: string;
  row: ConsultantRow | null;
  choices: CompanyChoice[];
  defaultMarkupBp: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const known = row ? DISCIPLINES.includes(row.discipline) : true;
  const [v, setV] = useState({
    companyId: row?.companyId ?? "",
    contactId: row?.contactId ?? "",
    discipline: row ? (known ? row.discipline : OTHER) : "",
    otherDiscipline: row && !known ? row.discipline : "",
    fee: row?.money ? moneyInput(row.money.feeCents) : "0",
    markup: String((row?.money?.markupBp ?? defaultMarkupBp) / 100),
    billedThrough: row?.money?.billedThrough ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const people = choices.find((c) => c.id === v.companyId)?.contacts ?? [];

  function save() {
    const feeCents = parseMoney(v.fee);
    const markup = v.markup.trim() === "" ? 0 : Number(v.markup);
    const local: Record<string, string> = {};
    if (feeCents === null) local.feeCents = "Enter an amount of $0 or more";
    if (!/^\d+(\.\d{1,2})?$/.test(v.markup.trim() || "0") || markup > 100) local.markupBp = "Use 0–100%, up to 2 decimals";
    if (Object.keys(local).length) return setErrors(local);
    const discipline = v.discipline === OTHER ? v.otherDiscipline : v.discipline;
    startTransition(async () => {
      const r = await saveConsultant({
        id: row?.id ?? null,
        projectId,
        companyId: v.companyId,
        contactId: v.contactId || null,
        discipline,
        feeCents,
        markupBp: Math.round(markup * 100),
        billedThrough: v.billedThrough,
      });
      if (!r.ok) {
        setErrors({ ...(r.fieldErrors ?? {}), ...(r.error ? { form: r.error } : {}) } as Record<string, string>);
        return;
      }
      onSaved(row ? `${discipline} saved` : `${discipline} added`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={row ? "Edit consultant" : "Add consultant"}
        footer={
          <>
            {errors.form && <span role="alert" className="mr-auto text-sm text-red">{errors.form}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              {row ? "Save consultant" : "Add consultant"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select label="Consultant *" value={v.companyId} error={errors.companyId} onChange={(e) => set({ companyId: e.target.value, contactId: "" })}>
            <option value="">{choices.length ? "Choose a consultant…" : "No consultants in Contacts yet"}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select label="Contact" value={v.contactId} disabled={!v.companyId} error={errors.contactId} onChange={(e) => set({ contactId: e.target.value })}>
            <option value="">{v.companyId && people.length === 0 ? "No people at this company" : "Their billing contact"}</option>
            {people.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Discipline *" value={v.discipline} error={v.discipline === OTHER ? undefined : errors.discipline} onChange={(e) => set({ discipline: e.target.value })}>
              <option value="">Choose…</option>
              {DISCIPLINES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              <option value={OTHER}>Other…</option>
            </Select>
            {v.discipline === OTHER && (
              <Input label="Other discipline *" value={v.otherDiscipline} maxLength={40} error={errors.discipline} onChange={(e) => set({ otherDiscipline: e.target.value })} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Fee" value={v.fee} inputMode="decimal" error={errors.feeCents} onChange={(e) => set({ fee: e.target.value })} />
            <Input label="Markup %" value={v.markup} inputMode="decimal" error={errors.markupBp} onChange={(e) => set({ markup: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.billedThrough} onChange={(e) => set({ billedThrough: e.target.checked })} className="size-4 accent-ink" />
            Billed through to the client
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
