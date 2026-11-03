"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { actorFrom } from "@/server/settings/common";
import { createProjectCore } from "./create";

// Projects server actions (projects-list spec, Actions). Who is asking comes
// from the session; createProjectCore checks the role first.

export async function createProject(input: unknown) {
  const result = await createProjectCore(actorFrom(await requireSession()), input);
  if (result.ok) {
    revalidatePath("/app/projects");
    revalidatePath("/app/contacts");
  }
  return result;
}
