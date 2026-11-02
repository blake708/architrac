"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { type AppRole, ROLE_LABELS } from "@/lib/auth/permissions";
import { ROLE_HELP } from "@/lib/auth/user-management";
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  type EmploymentType,
} from "@/lib/team/profile";
import { fullName } from "@/lib/team/display";
import { editProfile, invitePerson } from "@/server/team/actions";
import type { PersonRow, TeamCard } from "@/server/team/view";

type Errors = Record<string, string | undefined>;

/** The fields Invite and Edit share, as typed (strings until sent). */
type Shared = {
  title: string;
  firmRoleId: string;
  teamId: string;
  employmentType: EmploymentType;
  weeklyCapacityHours: string;
  targetUtilizationPct: string;
};

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
const toInput = (s: Shared) => ({
  title: s.title,
  firmRoleId: s.firmRoleId || null,
  teamId: s.teamId || null,
  employmentType: s.employmentType,
  weeklyCapacityHours: num(s.weeklyCapacityHours),
  targetUtilizationPct: num(s.targetUtilizationPct),
});

function SharedFields({
  value,
  set,
  errors,
  roles,
  teams,
}: {
  value: Shared;
  set: (patch: Partial<Shared>) => void;
  errors: Errors;
  roles: { id: string; name: string }[];
  teams: TeamCard[];
}) {
  return (
    <>
      <Input
        label="Title"
        value={value.title}
        maxLength={80}
        placeholder="e.g. Project architect"
        onChange={(e) => set({ title: e.target.value })}
        error={errors.title}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Billing role"
          value={value.firmRoleId}
          onChange={(e) => set({ firmRoleId: e.target.value })}
          error={errors.firmRoleId}
          hint="Sets their rates (Settings → Roles & rates)"
        >
          <option value="">No role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select
          label="Team"
          value={value.teamId}
          onChange={(e) => set({ teamId: e.target.value })}
          error={errors.teamId}
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select
          label="Employment"
          value={value.employmentType}
          onChange={(e) => set({ employmentType: e.target.value as EmploymentType })}
        >
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input
          label="Weekly hours"
          type="number"
          inputMode="decimal"
          min={0}
          max={80}
          step={0.25}
          value={value.weeklyCapacityHours}
          onChange={(e) => set({ weeklyCapacityHours: e.target.value })}
          error={errors.weeklyCapacityHours}
          className="num text-right"
        />
        <Input
          label="Utilization target %"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={value.targetUtilizationPct}
          onChange={(e) => set({ targetUtilizationPct: e.target.value })}
          error={errors.targetUtilizationPct}
          className="num text-right"
        />
      </div>
    </>
  );
}

/** Team → Invite person (team spec, Actions). */
export function InviteDialog({
  open,
  onOpenChange,
  roles,
  teams,
  assignable,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: { id: string; name: string }[];
  teams: TeamCard[];
  assignable: AppRole[];
  onDone: (email: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <InviteBody
          roles={roles}
          teams={teams}
          assignable={assignable}
          onCancel={() => onOpenChange(false)}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function InviteBody({
  roles,
  teams,
  assignable,
  onCancel,
  onDone,
}: {
  roles: { id: string; name: string }[];
  teams: TeamCard[];
  assignable: AppRole[];
  onCancel: () => void;
  onDone: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [appRole, setAppRole] = useState<AppRole>("staff");
  const [shared, setShared] = useState<Shared>({
    title: "",
    firmRoleId: "",
    teamId: "",
    employmentType: "full_time",
    weeklyCapacityHours: "40",
    targetUtilizationPct: "80",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await invitePerson({
        email,
        firstName: first,
        lastName: last,
        appRole,
        ...toInput(shared),
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Errors);
        setFormError(result.error ?? null);
        return;
      }
      onDone(result.data.email);
    });
  }

  return (
    <DialogContent
      title="Invite person"
      description="They get an email to join. Their profile is ready when they accept."
      className="max-w-[600px]!"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form="invite-person-form" disabled={pending}>
            {pending ? "Sending…" : "Send invite"}
          </Button>
        </>
      }
    >
      <form id="invite-person-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <Input
          label="Email"
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" value={first} onChange={(e) => setFirst(e.target.value)} error={errors.firstName} />
          <Input label="Last name" value={last} onChange={(e) => setLast(e.target.value)} error={errors.lastName} />
        </div>
        <Select
          label="Access"
          value={appRole}
          onChange={(e) => setAppRole(e.target.value as AppRole)}
          error={errors.appRole}
          hint={ROLE_HELP[appRole]}
        >
          {assignable.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <SharedFields
          value={shared}
          set={(p) => setShared((s) => ({ ...s, ...p }))}
          errors={errors}
          roles={roles}
          teams={teams}
        />
      </form>
    </DialogContent>
  );
}

/** Team → Edit profile (invite fields plus phone, license, start date, principal). */
export function EditProfileDialog({
  person,
  onOpenChange,
  roles,
  teams,
  onDone,
  onDeactivate,
}: {
  person: PersonRow | null;
  onOpenChange: (o: boolean) => void;
  roles: { id: string; name: string }[];
  teams: TeamCard[];
  onDone: (name: string) => void;
  /** Null when this viewer can't turn this person off. */
  onDeactivate: (() => void) | null;
}) {
  return (
    <Dialog open={person !== null} onOpenChange={onOpenChange}>
      {person && (
        <EditBody
          key={person.id}
          person={person}
          roles={roles}
          teams={teams}
          onCancel={() => onOpenChange(false)}
          onDone={onDone}
          onDeactivate={onDeactivate}
        />
      )}
    </Dialog>
  );
}

function EditBody({
  person,
  roles,
  teams,
  onCancel,
  onDone,
  onDeactivate,
}: {
  person: PersonRow;
  roles: { id: string; name: string }[];
  teams: TeamCard[];
  onCancel: () => void;
  onDone: (name: string) => void;
  onDeactivate: (() => void) | null;
}) {
  const [shared, setShared] = useState<Shared>({
    title: person.title ?? "",
    firmRoleId: person.firmRoleId ?? "",
    teamId: person.teamId ?? "",
    employmentType: person.employmentType,
    weeklyCapacityHours: String(person.weeklyHours),
    targetUtilizationPct: String((person.targetBp ?? 0) / 100),
  });
  const [phone, setPhone] = useState(person.phone ?? "");
  const [license, setLicense] = useState(person.licenseNote ?? "");
  const [startDate, setStartDate] = useState(person.startDate ?? "");
  const [isPrincipal, setIsPrincipal] = useState(person.isPrincipal);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await editProfile({
        membershipId: person.id,
        ...toInput(shared),
        phone,
        licenseNote: license,
        startDate: startDate || null,
        isPrincipal,
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Errors);
        setFormError(result.error ?? null);
        return;
      }
      onDone(result.data.name);
    });
  }

  return (
    <DialogContent
      title="Edit profile"
      description={fullName(person)}
      className="max-w-[600px]!"
      footer={
        <>
          {onDeactivate && (
            <Button variant="danger" className="mr-auto" onClick={onDeactivate}>
              Turn off access
            </Button>
          )}
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-profile-form" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </>
      }
    >
      <form id="edit-profile-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <Input label="Email" value={person.email} readOnly disabled hint="Comes from their sign-in" />
        <SharedFields
          value={shared}
          set={(p) => setShared((s) => ({ ...s, ...p }))}
          errors={errors}
          roles={roles}
          teams={teams}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
          <Input label="With firm since" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
        </div>
        <Input
          label="License"
          value={license}
          maxLength={120}
          placeholder="e.g. Licensed architect · SC, NC"
          onChange={(e) => setLicense(e.target.value)}
          error={errors.licenseNote}
        />
        <label className="flex items-start gap-2 text-base">
          <input
            type="checkbox"
            checked={isPrincipal}
            onChange={(e) => setIsPrincipal(e.target.checked)}
            className="mt-1 size-4 accent-ink"
          />
          <span>
            Principal
            <span className="block text-xs text-muted">
              Gives final timesheet approval and can be Principal in Charge on projects.
            </span>
          </span>
        </label>
      </form>
    </DialogContent>
  );
}
