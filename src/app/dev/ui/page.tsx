import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PlusIcon } from "@/components/ui/icons";
import { KpiTile } from "@/components/ui/kpi-tile";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "UI kit · ArchiTrac" };

// A developer page: every UI kit component and variant in one place.
// Hidden in production builds. Values are typed-in demo strings, not real
// data, so they skip src/lib/format.ts.

const phases = [
  { name: "Schematic design", status: "Done", tone: "green", used: 96, budget: 120, fee: "$28,000", billed: "$28,000" },
  { name: "Design development", status: "In progress", tone: "blue", used: 171, budget: 180, fee: "$42,000", billed: "$31,500" },
  { name: "Construction documents", status: "Over budget", tone: "red", used: 286, budget: 260, fee: "$63,000", billed: "$18,900" },
  { name: "Bidding", status: "Not started", tone: "neutral", used: 0, budget: 24, fee: "$5,600", billed: "$0" },
] as const;

export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface px-4 pt-8 pb-7 sm:px-[var(--spacing-page-x)]">
        <div className="num text-xs text-ink-3">DEV · 13 COMPONENTS</div>
        <h1 className="mt-2.5 mb-0 text-3xl leading-[1.15] font-medium">
          UI kit
        </h1>
      </div>

      <main className="flex flex-col gap-10 px-4 py-8 sm:px-[var(--spacing-page-x)]">
        <Section title="Button">
          <Row>
            <Button variant="primary" icon={<PlusIcon />}>
              New project
            </Button>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Archive</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </Row>
        </Section>

        <Section title="Input / Select / Textarea">
          <div className="grid max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
            <Input label="Project name" placeholder="Harbor House" />
            <Input
              label="Project number"
              defaultValue="2026-01"
              hint="Shown on invoices."
            />
            <Input
              label="Fee"
              defaultValue="abc"
              error="Enter an amount like 186,000."
            />
            <Input label="Disabled" defaultValue="Read only" disabled />
            <Select label="Project type" defaultValue="residential">
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="institutional">Institutional</option>
            </Select>
            <Select label="Phase" error="Pick a phase." defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="sd">Schematic design</option>
            </Select>
            <Textarea
              label="Notes"
              placeholder="Scope, exclusions, anything the team should know"
              wrapperClassName="sm:col-span-2"
            />
          </div>
        </Section>

        <Section title="Table">
          <Card padded={false} title="Phases & fees" description="Hours vs budget by phase">
            <Table className="min-w-[760px]">
              <TableHead>
                <TableRow>
                  <TableHeader>Phase</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader className="w-[220px]">Hours · used / budget</TableHeader>
                  <TableHeader numeric>Fee</TableHeader>
                  <TableHeader numeric>Billed</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {phases.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge tone={p.tone} dot>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <ProgressBar
                          value={p.used}
                          max={p.budget}
                          label={`${p.name} hours used`}
                          showPercent
                        />
                        <span className="num text-xs text-ink-3">
                          {p.used} / {p.budget} h
                        </span>
                      </div>
                    </TableCell>
                    <TableCell numeric>{p.fee}</TableCell>
                    <TableCell numeric>{p.billed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFoot>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="num text-[12.5px]">553 / 584 h</TableCell>
                  <TableCell numeric>$138,600</TableCell>
                  <TableCell numeric>$78,400</TableCell>
                </TableRow>
              </TableFoot>
            </Table>
          </Card>
        </Section>

        <Section title="Card">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card
              title="Project information"
              actions={<Button variant="ghost">Edit</Button>}
            >
              <p className="m-0 text-ink-3">
                Card with a title and an action on the right.
              </p>
            </Card>
            <Card>
              <p className="m-0 text-ink-3">Card with no header.</p>
            </Card>
          </div>
        </Section>

        <Section title="KPI tile">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            <KpiTile label="Fee" value="$186,000" note="4 phases" />
            <KpiTile label="Billed" value="$78,400" note="42% of fee" tone="blue" />
            <KpiTile label="Paid" value="$62,100" note="Last payment Oct 12" tone="green" />
            <KpiTile label="Hours" value="553" note="95% of budget" tone="orange" />
            <KpiTile label="Profit to date" value="−$12,318" note="Over budget in CD" tone="red" />
          </div>
        </Section>

        <Section title="Tabs">
          <Card>
            <Tabs defaultValue="active">
              <TabsList aria-label="Project status">
                <TabsTrigger value="active" count={12}>
                  Active
                </TabsTrigger>
                <TabsTrigger value="hold" count={2}>
                  On hold
                </TabsTrigger>
                <TabsTrigger value="closed" count={31}>
                  Closed
                </TabsTrigger>
                <TabsTrigger value="disabled" disabled>
                  Disabled
                </TabsTrigger>
              </TabsList>
              <TabsContent value="active">Active projects panel.</TabsContent>
              <TabsContent value="hold">On hold projects panel.</TabsContent>
              <TabsContent value="closed">Closed projects panel.</TabsContent>
            </Tabs>
          </Card>
        </Section>

        <Section title="Badge">
          <Row>
            <Badge>Draft</Badge>
            <Badge tone="blue">In progress</Badge>
            <Badge tone="green">Paid</Badge>
            <Badge tone="orange">Due soon</Badge>
            <Badge tone="red">Overdue</Badge>
            <Badge tone="purple">Add-on</Badge>
          </Row>
          <Row>
            <Badge dot>Not started</Badge>
            <Badge tone="blue" dot>
              Current
            </Badge>
            <Badge tone="green" dot>
              On track
            </Badge>
            <Badge tone="orange" dot>
              At risk
            </Badge>
            <Badge tone="red" dot>
              Over budget
            </Badge>
            <Badge tone="purple" dot>
              Tentative
            </Badge>
          </Row>
        </Section>

        <Section title="Progress bar">
          <div className="flex max-w-sm flex-col gap-3">
            <Labeled text="45% — normal">
              <ProgressBar value={45} max={100} label="Normal" showPercent />
            </Labeled>
            <Labeled text="92% — approaching budget">
              <ProgressBar value={92} max={100} label="Warning" showPercent />
            </Labeled>
            <Labeled text="118% — over budget">
              <ProgressBar value={118} max={100} label="Over" showPercent />
            </Labeled>
            <Labeled text="No percent label">
              <ProgressBar value={30} max={100} label="Plain" />
            </Labeled>
          </div>
        </Section>

        <Section title="Avatar">
          <Row>
            <Avatar name="Blake Middleton" />
            <Avatar name="Ana Lopez" />
            <Avatar name="Cher" />
            <Avatar name="Blake Middleton" size="sm" />
            <Avatar name="Ana Lopez" size="sm" />
          </Row>
        </Section>

        <Section title="Dialog / Drawer">
          <Row>
            <Dialog>
              <DialogTrigger asChild>
                <Button>Open dialog</Button>
              </DialogTrigger>
              <DialogContent
                title="Edit phase"
                description="Changes apply to future invoices."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="primary">Save</Button>
                    </DialogClose>
                  </>
                }
              >
                <div className="flex flex-col gap-4">
                  <Input label="Phase name" defaultValue="Design development" />
                  <Input label="Hours budget" defaultValue="180" />
                </div>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button>Open drawer</Button>
              </DialogTrigger>
              <DrawerContent
                title="New contact"
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="primary">Add contact</Button>
                    </DialogClose>
                  </>
                }
              >
                <div className="flex flex-col gap-4">
                  <Input label="Name" />
                  <Input label="Email" type="email" />
                  <Textarea label="Notes" />
                </div>
              </DrawerContent>
            </Dialog>
          </Row>
        </Section>

        <Section title="Empty state">
          <Card>
            <EmptyState
              title="No projects yet"
              help="Create your first project to start tracking phases and time."
              action={
                <Button variant="primary" icon={<PlusIcon />}>
                  New project
                </Button>
              }
            />
          </Card>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-2xs font-medium text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Labeled({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{text}</span>
      {children}
    </div>
  );
}
