"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { fullName } from "@/lib/team/display";
import { saveTeam } from "@/server/team/actions";
import type { PersonRow, TeamCard } from "@/server/team/view";

type Errors = Record<string, string | undefined>;

/** New team / Edit team: name and leader (team spec, Actions). */
export function TeamDialog({
  team,
  open,
  onOpenChange,
  people,
  onDone,
}: {
  /** Null = New team. */
  team: TeamCard | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  people: PersonRow[];
  onDone: (message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <Body
          key={team?.id ?? "new"}
          team={team}
          people={people}
          onCancel={() => onOpenChange(false)}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function Body({
  team,
  people,
  onCancel,
  onDone,
}: {
  team: TeamCard | null;
  people: PersonRow[];
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [leader, setLeader] = useState(team?.leaderMembershipId ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const candidates = people.filter((p) => p.kind === "member" && p.active);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await saveTeam({
        id: team?.id ?? null,
        name,
        leaderMembershipId: leader || null,
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Errors);
        setFormError(result.error ?? null);
        return;
      }
      onDone(team ? `${name.trim()} saved` : `${name.trim()} created`);
    });
  }

  return (
    <DialogContent
      title={team ? "Edit team" : "New team"}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form="team-form" disabled={pending}>
            {pending ? "Saving…" : team ? "Save team" : "Create team"}
          </Button>
        </>
      }
    >
      <form id="team-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <Input
          label="Team name"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Select
          label="Team leader"
          value={leader}
          onChange={(e) => setLeader(e.target.value)}
          error={errors.leaderMembershipId}
          hint="Reviews the team's timesheets first, then a principal. They join this team."
        >
          <option value="">No leader yet</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {fullName(p)}
            </option>
          ))}
        </Select>
      </form>
    </DialogContent>
  );
}
