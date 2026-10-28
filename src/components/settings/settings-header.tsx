"use client";

import { usePathname } from "next/navigation";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { sectionForPath } from "@/lib/settings/sections";
import { useSettingsFormStatus } from "./form-state";

/**
 * The white band at the top of Settings: which section you're in, and on
 * sections with a form, its save state and the Save changes button
 * (settings-firm spec, Layout §1).
 */
export function SettingsHeader() {
  const section = sectionForPath(usePathname());
  const { form, saved } = useSettingsFormStatus();
  if (!section) return null;

  const dirty = form?.dirty ?? false;
  const pending = form?.pending ?? false;

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-end gap-5 px-4 pt-8 pb-7 md:px-page-x">
        <div className="min-w-0 flex-[1_1_380px]">
          <div className="num text-xs text-ink-3">
            {section.group.toUpperCase()} · FIRM ADMINS ONLY
          </div>
          <h1 className="m-0 mt-2.5 text-3xl leading-[1.15] font-medium">
            {section.title}
          </h1>
          <p className="m-0 mt-2.5 max-w-[680px] text-base leading-normal text-ink-3">
            {section.description}
          </p>
        </div>
        {section.hasSave && form && (
          <div className="flex items-center gap-2.5">
            {dirty && (
              <span className="text-[12.5px] text-orange-strong">
                Unsaved changes
              </span>
            )}
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-green">
                <CheckIcon className="size-3.5" />
                Saved
              </span>
            )}
            <button
              type="submit"
              form={form.formId}
              disabled={!dirty || pending}
              className={cn(
                "h-[var(--height-control)] rounded-sm border-0 px-4 text-base font-semibold text-white",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
                dirty && !pending
                  ? "cursor-pointer bg-ink hover:bg-ink-2"
                  : "cursor-not-allowed bg-line-strong",
              )}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
