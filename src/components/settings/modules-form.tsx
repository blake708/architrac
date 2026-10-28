"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RAIL_ICONS, iconProps } from "@/components/shell/icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import {
  MODULES,
  MODULE_KEYS,
  type ModuleKey,
  modulesOnCount,
  normalizeModules,
} from "@/lib/modules";
import { updateModules } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { useSettingsForm } from "./form-state";

const FORM_ID = "modules-form";

// Icons from mockup/Settings.dc.html → ICONS. Code has no rail item, so its
// icon lives here.
const MODULE_ICONS: Record<ModuleKey, string> = {
  build: RAIL_ICONS.build,
  workload: RAIL_ICONS.workload,
  accounting: RAIL_ICONS.accounting,
  marketing: RAIL_ICONS.marketing,
  knowledge: RAIL_ICONS.knowledge,
  code: "M4 4h16v16H4zM4 10h16M10 10v10",
  website: RAIL_ICONS.website,
  hiring: RAIL_ICONS.hiring,
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="cap text-2xs font-semibold text-ink-3">{label}</span>
      <span className="text-[20px] font-semibold">{value}</span>
      <span className="text-[12.5px] text-muted">{hint}</span>
    </span>
  );
}

/** Settings → Modules & plan (settings-firm spec, Layout §4). */
export function ModulesForm({
  initial,
  seats,
}: {
  initial: readonly string[];
  seats: number;
}) {
  const router = useRouter();
  const [on, setOn] = useState<ModuleKey[]>(() => normalizeModules(initial));
  // Any switch counts as a change, even switching back (mockup behaviour).
  const [dirty, setDirty] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const markSaved = useSettingsForm(FORM_ID, dirty, pending);

  function toggle(key: ModuleKey, next: boolean) {
    setOn((cur) =>
      normalizeModules(next ? [...cur, key] : cur.filter((k) => k !== key)),
    );
    setDirty(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || pending) return;
    setBanner(null);
    startTransition(async () => {
      const result = await updateModules(on);
      if (!result.ok) {
        setBanner(
          result.error ?? "Couldn't save. Nothing was changed. Try again.",
        );
        return;
      }
      setDirty(false);
      markSaved();
      router.refresh(); // the menu rail updates without a full reload
    });
  }

  return (
    <form
      id={FORM_ID}
      onSubmit={onSubmit}
      className="flex max-w-[1040px] flex-col gap-4"
    >
      {banner && <ErrorBanner message={banner} />}
      <section
        aria-label="Plan"
        className="flex flex-wrap items-center gap-5 rounded-sm border border-line bg-surface px-6 py-5"
      >
        <Stat
          label="Plan"
          value="ArchiTrac Core"
          hint={`Projects, Contacts, Team, Time, Reports · ${seats} ${seats === 1 ? "seat" : "seats"}`}
        />
        <Stat
          label="Modules on"
          value={`${modulesOnCount(on)} of ${MODULE_KEYS.length}`}
          hint="Billed monthly per seat"
        />
        <Stat
          label="Monthly total"
          value="[Price]"
          hint="Pricing not set yet"
        />
      </section>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
        {MODULES.map((m) => {
          const isOn = on.includes(m.key);
          return (
            <section
              key={m.key}
              aria-label={`${m.name} module`}
              data-on={isOn}
              className={cn(
                "flex flex-col gap-2.5 rounded-sm border bg-surface px-5 py-[18px]",
                isOn ? "border-ink" : "border-line",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-10 shrink-0 items-center justify-center rounded-sm",
                    isOn ? "bg-ink text-white" : "bg-line-soft text-ink-3",
                  )}
                >
                  <svg {...iconProps(20, 1.75)}>
                    <path d={MODULE_ICONS[m.key]} />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="cap text-sm font-bold">{m.name}</span>
                  <span className="text-[12.5px] text-muted">
                    {isOn ? "On" : "Off"} · [Price] per seat / month
                  </span>
                </span>
                <Switch
                  checked={isOn}
                  onCheckedChange={(next) => toggle(m.key, next)}
                  aria-label={`${isOn ? "Turn off" : "Turn on"} ${m.name}`}
                />
              </div>
              <p className="m-0 leading-normal text-ink-2">{m.description}</p>
            </section>
          );
        })}
      </div>
    </form>
  );
}
