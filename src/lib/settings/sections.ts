// The Settings section menu (settings-firm spec, "Release 0 section nav").
// Release 1 adds a "Work" group between Firm and Account.

export type SettingsSection = {
  key: "firm" | "users" | "modules";
  group: string;
  label: string;
  href: string;
  title: string;
  description: string;
  /** Has a Save changes button (Users saves each change straight away). */
  hasSave: boolean;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "firm",
    group: "Firm",
    label: "Firm profile",
    href: "/app/settings/firm",
    title: "Firm profile",
    description:
      "Your firm's name, address and license details. These appear on letterhead, invoices, proposals and the client portal.",
    hasSave: true,
  },
  {
    key: "users",
    group: "Firm",
    label: "Users & access",
    href: "/app/settings/users",
    title: "Users & access",
    description:
      "Who can sign in to ArchiTrac and what each person can see and do.",
    hasSave: false,
  },
  {
    key: "modules",
    group: "Account",
    label: "Modules & plan",
    href: "/app/settings/modules",
    title: "Modules & plan",
    description:
      "Turn modules on or off for the whole firm. A module that's off is hidden from the menu.",
    hasSave: true,
  },
];

/** Sections grouped for the menu, in order. */
export function settingsGroups() {
  const groups: { name: string; items: SettingsSection[] }[] = [];
  for (const s of SETTINGS_SECTIONS) {
    const last = groups.at(-1);
    if (last?.name === s.group) last.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }
  return groups;
}

/** The section for a path, e.g. /app/settings/firm → Firm profile. */
export function sectionForPath(pathname: string): SettingsSection | null {
  return (
    SETTINGS_SECTIONS.find(
      (s) => pathname === s.href || pathname.startsWith(s.href + "/"),
    ) ?? null
  );
}
