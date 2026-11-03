import { cache } from "react";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { lookupEnabled } from "@/server/address/google";
import { loadCompanyChoices, loadProjectPage } from "./page";
import { loadNewProjectOptions } from "./view";

// The project's layout and its tabs all need the same data; cache() runs
// each loader once per request.

export const getProjectPage = cache(async (id: string) => {
  const { firm, membership } = await requireSession();
  const viewer = { membershipId: membership.id, appRole: membership.appRole, active: membership.active };
  return withFirm(firm.id, (db) => loadProjectPage(db, viewer, id));
});

/** Choices for Edit project (only loaded for people who can edit). */
export const getEditOptions = cache(async () => {
  const { firm } = await requireSession();
  const options = await withFirm(firm.id, (db) => loadNewProjectOptions(db, firm.id, firm.timezone));
  return { options, addressLookup: lookupEnabled() };
});

export const getCompanyChoices = cache(async () => {
  const { firm } = await requireSession();
  return withFirm(firm.id, (db) => loadCompanyChoices(db));
});
