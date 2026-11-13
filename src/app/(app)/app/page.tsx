import Link from "next/link";
import { Suspense } from "react";
import {
  BoardSkeleton,
  BoardWidget,
  CardSkeleton,
  OutstandingWidget,
  WaitingWidget,
  YourTimeWidget,
} from "@/components/home/home-widgets";
import { WidgetBoundary } from "@/components/home/widget-boundary";
import { buttonClasses } from "@/components/ui/button";
import { ClockIcon, PlusIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { greetingFor, homeEyebrow, hourIn } from "@/lib/calc/home";
import { todayIn } from "@/lib/format";
import { canSeeWaiting, loadActiveCount } from "@/server/home/home";
import { timeActorFrom } from "@/server/time/actor";

// Home (home spec): where everyone lands after signing in. Read-only. Each
// widget streams in on its own; role-restricted widgets aren't rendered and
// their data is never loaded.
export default async function AppHomePage() {
  const session = await requireSession();
  const actor = timeActorFrom(session);
  const now = new Date();
  const { active, waiting } = await withFirm(actor.firmId, async (db) => ({
    active: await loadActiveCount(db),
    waiting: await canSeeWaiting(db, actor),
  }));
  const invoices = can(actor.member, "financials.view");
  const canCreate = can(actor.member, "projects.create");
  const left = waiting || invoices;

  return (
    <main>
      <PageHeader
        eyebrow={<span className="cap">{homeEyebrow(todayIn(actor.timezone, now), active)}</span>}
        title={`Good ${greetingFor(hourIn(actor.timezone, now))}, ${session.user.firstName}`}
        actions={
          <>
            <Link href="/app/time" className={buttonClasses("secondary")}>
              <ClockIcon className="size-4" />
              Log time
            </Link>
            {canCreate && (
              <Link href="/app/projects/new" className={buttonClasses("primary")}>
                <PlusIcon className="size-4" />
                New project
              </Link>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-6 px-4 pt-7 pb-8 md:px-page-x">
        <WidgetBoundary label="Projects">
          <Suspense fallback={<BoardSkeleton />}>
            <BoardWidget actor={actor} canCreate={canCreate} />
          </Suspense>
        </WidgetBoundary>
        <div className="flex flex-wrap items-start gap-6">
          {left && (
            <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-6">
              {waiting && (
                <WidgetBoundary label="Approvals">
                  <Suspense fallback={<CardSkeleton label="approvals" />}>
                    <WaitingWidget actor={actor} />
                  </Suspense>
                </WidgetBoundary>
              )}
              {invoices && (
                <WidgetBoundary label="Invoices">
                  <Suspense fallback={<CardSkeleton label="invoices" />}>
                    <OutstandingWidget actor={actor} />
                  </Suspense>
                </WidgetBoundary>
              )}
            </div>
          )}
          <div className={left ? "min-w-0 flex-[1_1_400px]" : "w-full max-w-140"}>
            <WidgetBoundary label="Your time">
              <Suspense fallback={<CardSkeleton label="your time" />}>
                <YourTimeWidget actor={actor} />
              </Suspense>
            </WidgetBoundary>
          </div>
        </div>
      </div>
    </main>
  );
}
