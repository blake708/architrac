import type { ReactNode } from "react";

type PageHeaderProps = {
  /** Small mono line above the title, e.g. the date or a project number. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons on the right. Put the primary action last. */
  actions?: ReactNode;
};

/** The white band at the top of every page, under the dark header. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-end gap-5 px-4 pt-8 pb-7 md:px-page-x">
        <div className="min-w-0 flex-[1_1_380px]">
          {eyebrow && <div className="num text-xs text-ink-3">{eyebrow}</div>}
          <h1 className="m-0 mt-2.5 text-3xl leading-[1.15] font-medium first:mt-0">
            {title}
          </h1>
          {description && (
            <p className="m-0 mt-2 max-w-[640px] text-base text-ink-3">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
