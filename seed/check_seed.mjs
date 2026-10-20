// Verify seed-data.json: sums, foreign keys, and the mockup/spec numbers.
// Run from the repo root: node seed/check_seed.mjs seed/seed-data.json
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync(process.argv[2] ?? new URL("./seed-data.json", import.meta.url), "utf8"));
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const $ = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const TABLES = ["firms", "users", "memberships", "firm_settings", "teams", "firm_roles", "rates", "phase_templates",
  "activities", "overhead_categories", "companies", "contacts", "projects", "project_phases", "project_members",
  "consultants", "timesheets", "time_entries", "invoices", "invoice_lines", "payments"];
eq(Object.keys(data), TABLES, "top-level keys");

// ---------- ids + foreign keys
const idx = {};
const allIds = new Set();
for (const t of TABLES) {
  idx[t] = new Map();
  for (const r of data[t]) {
    const id = t === "firm_settings" ? r.firm_id : r.id;
    ok(id && !allIds.has(id + "@" + t), `${t} id unique/present ${id}`);
    allIds.add(id + "@" + t);
    idx[t].set(id, r);
    if (t !== "firms" && t !== "users") ok(idx.firms?.has(r.firm_id), `${t}.${id} firm_id`);
  }
}
const FK = {
  memberships: { user_id: "users", firm_role_id: "firm_roles", team_id: "teams" },
  teams: { leader_membership_id: "memberships" },
  rates: { firm_role_id: "firm_roles", membership_id: "memberships" },
  activities: { overhead_category_id: "overhead_categories" },
  companies: { billing_contact_id: "contacts" },
  contacts: { company_id: "companies" },
  projects: { client_company_id: "companies", client_contact_id: "contacts", principal_membership_id: "memberships", pm_membership_id: "memberships" },
  project_phases: { project_id: "projects" },
  project_members: { project_id: "projects", membership_id: "memberships" },
  consultants: { project_id: "projects", company_id: "companies" },
  timesheets: { membership_id: "memberships", approved_by: "users" },
  time_entries: { timesheet_id: "timesheets", project_id: "projects", project_phase_id: "project_phases", overhead_category_id: "overhead_categories", activity_id: "activities", invoice_id: "invoices" },
  invoices: { project_id: "projects", client_company_id: "companies" },
  invoice_lines: { invoice_id: "invoices", project_phase_id: "project_phases" },
  payments: { invoice_id: "invoices" },
};
let fkCount = 0;
for (const [t, cols] of Object.entries(FK)) for (const r of data[t]) for (const [c, target] of Object.entries(cols)) {
  if (r[c] == null) continue;
  fkCount++;
  ok(idx[target].has(r[c]), `${t}.${r.id}.${c} -> ${target} ${r[c]}`);
}
// FKs that must not be null
for (const r of data.projects) ok(r.client_company_id && r.principal_membership_id && r.pm_membership_id, `project ${r.number} required fks`);
for (const r of data.time_entries) ok(r.activity_id, `entry ${r.id} activity`);
// cross-table consistency
for (const r of data.companies) if (r.billing_contact_id) ok(idx.contacts.get(r.billing_contact_id).company_id === r.id, `billing contact of ${r.name} belongs to it`);
for (const r of data.projects) if (r.client_contact_id) ok(idx.contacts.get(r.client_contact_id).company_id === r.client_company_id, `client contact of ${r.number}`);
for (const r of data.invoices) ok(r.client_company_id === idx.projects.get(r.project_id).client_company_id, `invoice ${r.number} client = project client`);
for (const r of data.invoice_lines) if (r.project_phase_id) ok(idx.project_phases.get(r.project_phase_id).project_id === idx.invoices.get(r.invoice_id).project_id, `line ${r.id} phase on invoice's project`);
for (const r of data.activities) ok((r.applies_to === "overhead") === (r.overhead_category_id != null), `activity ${r.name} scope/category`);
for (const c of data.contacts) ok(/@example\.com$/.test(c.email), `contact email example.com ${c.email}`);
for (const u of data.users) ok(/@example\.com$/.test(u.email), `user email example.com ${u.email}`);
eq(data.firms[0].name, "Demo Architecture Studio", "firm name");
eq(data.firms[0].slug, "demo", "firm slug");

// ---------- units
const isInt = (v) => Number.isInteger(v);
for (const t of TABLES) for (const r of data[t]) for (const [k, v] of Object.entries(r)) {
  if (k.endsWith("_cents") && v != null) ok(isInt(v), `${t}.${r.id}.${k} integer cents`);
  if (k.endsWith("_bp") && v != null) ok(isInt(v) && v >= 0 && v <= 10000, `${t}.${r.id}.${k} bp 0..10000`);
}

// ---------- settings / roles / rates (spec seed values)
const fs0 = data.firm_settings[0];
eq([fs0.overhead_rate_bp, fs0.next_invoice_number, fs0.invoice_prefix, fs0.week_starts_on], [6000, 128, "2026-", 1], "firm_settings");
const roleRate = new Map(data.rates.map((r) => [r.firm_role_id, r]));
const memById = idx.memberships;
const costOf = (ini) => roleRate.get(memById.get("mem_" + ini).firm_role_id).cost_rate_cents;
eq(["bm", "jr", "kl", "ap"].map(costOf), [9500, 6200, 4400, 5200], "cost rates BM/JR/KL/AP");
eq(data.phase_templates.reduce((a, p) => a + p.default_fee_share_bp, 0), 10000, "phase template shares = 100%");
const peopleByRole = {};
for (const m of data.memberships) peopleByRole[m.firm_role_id] = (peopleByRole[m.firm_role_id] || 0) + 1;
let num = 0, n = 0, msum = 0;
for (const r of data.rates) { const c = peopleByRole[r.firm_role_id] || 0; if (r.bill_rate_cents && r.cost_rate_cents && c) { num += r.bill_rate_cents * c; n += c; msum += (r.bill_rate_cents / r.cost_rate_cents) * c; } }
eq(`$${Math.round(num / n / 100)} / h`, "$126 / h", "Settings blended bill rate");
eq((msum / n).toFixed(2) + "×", "2.54×", "Settings/Team avg multiplier");
const billable = data.memberships.filter((m) => roleRate.get(m.firm_role_id).bill_rate_cents > 0);
eq([data.memberships.length, data.teams.length, billable.length, billable.reduce((a, m) => a + m.weekly_capacity_hours, 0)], [14, 4, 12, 464], "Team KPIs people/teams/billable/capacity");

// ---------- projects & phases
const phasesOf = (pid) => data.project_phases.filter((p) => p.project_id === pid).sort((a, b) => a.sort_order - b.sort_order);
// Projects.dc.html: fee, billed %; Pine billed 31% = $12,710 kept (see README)
const EXPECT = {
  "2026-022": [28500, 4, "On track"], "2026-021": [64000, 0, "On track"], "2026-017": [92000, 12, "On track"],
  "2026-014": [186000, 20, "At risk"], "2026-011": [41000, 31, "On track"], "2026-006": [118000, 55, "Over budget"],
  "2025-038": [76000, 72, "On track"], "2025-031": [98000, 88, "On track"], "2025-027": [36000, 84, "On track"],
  "2025-019": [22000, 97, "On track"], "2025-012": [26000, 100, "Closed"], "2025-004": [48000, 100, "Closed"],
};
eq(data.projects.length, 12, "project count");
const COUNTED = new Set(["sent", "partially_paid", "paid"]);
const linesOf = (iid) => data.invoice_lines.filter((l) => l.invoice_id === iid);
const sheetStatus = new Map(data.timesheets.map((t) => [t.id, t.status]));
const usedByPhase = {};
for (const e of data.time_entries) if (e.project_phase_id && ["submitted", "approved"].includes(sheetStatus.get(e.timesheet_id))) usedByPhase[e.project_phase_id] = (usedByPhase[e.project_phase_id] || 0) + e.hours;
function health(p) {
  if (p.status !== "active") return p.status === "closed" ? "Closed" : p.status;
  const ph = phasesOf(p.id);
  const used = (x) => usedByPhase[x.id] || 0;
  const su = ph.reduce((a, x) => a + used(x), 0), sb = ph.reduce((a, x) => a + x.budget_hours, 0);
  if ((sb > 0 && su > sb) || ph.some((x) => x.status === "current" && used(x) > x.budget_hours)) return "Over budget";
  if (ph.some((x) => ["complete", "closed"].includes(x.status) && used(x) > x.budget_hours) ||
      ph.some((x) => x.status === "current" && x.budget_hours > 0 && used(x) >= 0.9 * x.budget_hours)) return "At risk";
  return "On track";
}
const billedOf = {};
for (const p of data.projects) {
  const [fee, pct, h] = EXPECT[p.number];
  const ph = phasesOf(p.id);
  eq(ph.reduce((a, x) => a + x.fee_cents, 0), fee * 100, `${p.number} Σ phase fees = project fee`);
  eq(ph.map((x) => x.code), ["PD", "SD", "DD", "CD", "PRM", "CA", "CO"], `${p.number} phase codes`);
  ok(ph.filter((x) => x.status === "current").length === (p.status === "active" ? 1 : 0), `${p.number} one current phase`);
  const invs = data.invoices.filter((i) => i.project_id === p.id && COUNTED.has(i.status));
  const billed = invs.reduce((a, i) => a + linesOf(i.id).reduce((s, l) => s + l.amount_cents, 0), 0);
  billedOf[p.id] = billed;
  eq(billed, Math.round(fee * pct) , `${p.number} billed = ${pct}% of fee`);
  eq(health(p), h, `${p.number} health`);
  // per-phase billing never exceeds fee; line % matches cumulative amount; phase % ≥ billed %
  for (const x of ph) {
    const ls = data.invoice_lines.filter((l) => l.project_phase_id === x.id && l.line_type === "phase_fee")
      .map((l) => ({ l, inv: idx.invoices.get(l.invoice_id) })).sort((a, b) => a.inv.issue_date.localeCompare(b.inv.issue_date));
    let cum = 0;
    for (const { l, inv } of ls) {
      const cumHere = cum + l.amount_cents;
      if (inv.status !== "draft") cum = cumHere;
      ok(cumHere <= x.fee_cents, `${p.number} ${x.code} cumulative ≤ fee`);
      ok(Math.abs(x.fee_cents * l.percent_complete_bp / 10000 - cumHere) <= x.fee_cents / 20000 + 0.5, `${p.number} ${x.code} line bp ${l.percent_complete_bp} ≈ cumulative ${cumHere}`);
      ok(x.percent_complete_bp >= l.percent_complete_bp || x.fee_type !== "fixed", `${p.number} ${x.code} phase % ≥ billed %`);
      ok(l.quantity === 1 && l.rate_cents === l.amount_cents, `${l.id} phase_fee qty 1, rate = amount`);
    }
    if (x.fee_type !== "fixed") ok(true, "");
  }
  // projected billed % shown on the list (round)
  eq(Math.round(billed * 100 / (fee * 100)), pct, `${p.number} list Billed %`);
}
const mob = data.projects.find((p) => p.number === "2026-014");
eq(phasesOf(mob.id).map((x) => [x.code, x.fee_cents, x.budget_hours, x.status, x.percent_complete_bp]), [
  ["PD", 930000, 62, "closed", 10000], ["SD", 2790000, 186, "closed", 10000], ["DD", 4650000, 310, "current", 3000],
  ["CD", 6510000, 434, "upcoming", 0], ["PRM", 930000, 62, "upcoming", 0], ["CA", 2790000, 186, "upcoming", 0], ["CO", 0, 0, "upcoming", 0]], "MOB phases (F2)");
const mobDD = phasesOf(mob.id).find((x) => x.code === "DD");
eq(mobDD.end_date, "2026-11-25", "MOB DD ends Nov 25");

// ---------- invoices, lines, payments
const numbers = data.invoices.map((i) => i.number).filter(Boolean);
eq(new Set(numbers).size, numbers.length, "invoice numbers unique");
for (const i of data.invoices) {
  const ls = linesOf(i.id), pays = data.payments.filter((p) => p.invoice_id === i.id);
  ok(ls.length > 0, `${i.number} has lines`);
  eq(ls.reduce((a, l) => a + l.amount_cents, 0), i.subtotal_cents, `${i.number ?? "draft"} Σ lines = subtotal`);
  eq(i.subtotal_cents + i.tax_cents, i.total_cents, `${i.number} subtotal + tax = total`);
  eq(pays.reduce((a, p) => a + p.amount_cents, 0), i.amount_paid_cents, `${i.number} Σ payments = amount_paid`);
  const want = i.status === "draft" ? "draft" : i.amount_paid_cents === 0 ? "sent" : i.amount_paid_cents === i.total_cents ? "paid" : "partially_paid";
  eq(i.status, want, `${i.number} status`);
  ok(i.period_start <= i.period_end && i.period_end <= i.issue_date, `${i.number} period ${i.period_start}..${i.period_end} ≤ issue`);
  for (const p of pays) ok(p.received_on >= i.issue_date, `${i.number} paid after issue`);
  for (const l of ls) if (l.line_type === "hourly") {
    eq(Math.round(l.quantity * l.rate_cents), l.amount_cents, `${l.id} hourly qty × rate`);
    const es = data.time_entries.filter((e) => e.invoice_id === i.id && e.project_phase_id === l.project_phase_id && e.bill_rate_cents === l.rate_cents);
    eq(es.reduce((a, e) => a + e.hours, 0), l.quantity, `${l.id} billed entries = line hours`);
  }
}
const inv = (n) => data.invoices.find((i) => i.number === n);
eq([inv("2026-121").total_cents, inv("2026-121").status, inv("2026-121").due_date], [1116000, "sent", "2026-11-15"], "2026-121");
const mobInv = data.invoices.filter((i) => i.project_id === mob.id && COUNTED.has(i.status));
eq([mobInv.reduce((a, i) => a + i.total_cents, 0), mobInv.reduce((a, i) => a + i.amount_paid_cents, 0)], [3720000, 2604000], "MOB billed / received");
const draft = data.invoices.find((i) => i.project_id === mob.id && i.status === "draft");
eq([draft.number, draft.total_cents], [null, 1395000], "MOB draft DD 30%");
const maxNum = Math.max(...numbers.filter((x) => x.startsWith("2026-")).map((x) => +x.slice(5)));
ok(fs0.next_invoice_number > maxNum, `next_invoice_number ${fs0.next_invoice_number} > max used ${maxNum}`);

// Accounting receivables list (mockup AR) — after the Pine adjustment
const AR = { "2026-121": 11160, "2026-124": 11040, "2026-125": 24500, "2026-126": 21240, "2026-127": 4510, "2026-123": 17750,
  "2026-112": 6600, "2026-116": 25550, "2026-104": 8200, "2026-118": 19000, "2026-101": 8400, "2025-188": 11500 };
const open = data.invoices.filter((i) => ["sent", "partially_paid"].includes(i.status));
eq(Object.fromEntries(open.map((i) => [i.number, (i.total_cents - i.amount_paid_cents) / 100]).sort()), Object.fromEntries(Object.entries(AR).sort()), "open invoices = AR list");
const today = Date.UTC(2026, 9, 18);
const days = (i) => Math.round((today - Date.parse(i.due_date)) / 864e5);
eq(days(inv("2026-118")), 62, "2026-118 62 days past due");
eq(days(inv("2025-188")), 110, "2025-188 110 days past due");
const octPaid = data.payments.filter((p) => p.received_on.startsWith("2026-10")).reduce((a, p) => a + p.amount_cents, 0);
eq(octPaid, 5184000, "collected in October (mockup $54,940 minus $3,100 Bayside retainer)");

// Contacts: billed / open per client, missing billing contacts
const CLIENT = { "Palmetto Medical Properties": [37200, 11160], "Northside Storage Holdings": [86240, 32900],
  "Summerville Office Park LLC": [64900, 46790], "Coastal Federal Credit Union": [54720, 19000], "Oakmont Health": [11040, 11040],
  "Pine Street Hospitality": [12710, 12710], "Mill Creek Pediatrics PA": [30240, 17750], "Grove Street Coffee Co.": [21340, 6600] };
for (const [name, [b, o]] of Object.entries(CLIENT)) {
  const c = data.companies.find((x) => x.name === name);
  const is = data.invoices.filter((i) => i.client_company_id === c.id && COUNTED.has(i.status));
  eq([is.reduce((a, i) => a + i.total_cents, 0) / 100, is.filter((i) => i.status !== "paid").reduce((a, i) => a + i.total_cents - i.amount_paid_cents, 0) / 100], [b, o], `Contacts ${name} billed/open`);
}
eq(data.companies.filter((c) => c.kind === "client" && !c.billing_contact_id).map((c) => c.name).sort(), ["Coastal Federal Credit Union", "Mill Creek Pediatrics PA"], "missing billing contact");
// consultants: MOB (F2 / Project mockup)
const mobCons = data.consultants.filter((c) => c.project_id === mob.id);
eq(mobCons.map((c) => [c.discipline, c.fee_cents]), [["Civil", 1450000], ["Structural", 1820000], ["MEP", 3680000], ["Landscape", 640000]], "MOB consultants");
eq(mobCons.reduce((a, c) => a + Math.round(c.fee_cents * (10000 + c.markup_bp) / 10000), 0), 8349000, "MOB consultant fee to client $83,490");

// ---------- time
const tsKey = new Set();
for (const t of data.timesheets) {
  const k = t.membership_id + t.week_start;
  ok(!tsKey.has(k), `timesheet unique ${k}`); tsKey.add(k);
  ok(new Date(t.week_start + "T12:00:00Z").getUTCDay() === 1, `${t.id} week starts Monday`);
  ok((t.status === "approved") === (t.approved_at != null && t.approved_by != null), `${t.id} approval fields`);
  if (t.status === "approved") ok(t.approved_by !== idx.memberships.get(t.membership_id).user_id, `${t.id} not self-approved`);
}
const dayTot = {};
for (const e of data.time_entries) {
  const t = idx.timesheets.get(e.timesheet_id);
  ok(e.hours > 0 && Number.isInteger(e.hours * 4), `${e.id} hours quarter`);
  const d = (Date.parse(e.work_date) - Date.parse(t.week_start)) / 864e5;
  ok(d >= 0 && d < 7, `${e.id} date in week`);
  ok((e.project_phase_id == null) !== (e.overhead_category_id == null), `${e.id} exactly one of phase/overhead`);
  ok((e.project_id == null) === (e.project_phase_id == null), `${e.id} project iff phase`);
  const a = idx.activities.get(e.activity_id) || {};
  if (e.project_phase_id) {
    const ph = idx.project_phases.get(e.project_phase_id);
    ok(ph.project_id === e.project_id, `${e.id} phase belongs to project`);
    ok(a.applies_to === "project" && e.billable === true, `${e.id} project activity/billable`);
    ok(ph.start_date <= e.work_date && (!ph.end_date || e.work_date <= ph.end_date), `${e.id} ${e.work_date} within ${ph.id} dates`);
    if (t.status !== "approved") ok(ph.status !== "closed", `${e.id} open-week entry not on closed phase ${ph.id}`);
    ok(idx.projects.get(e.project_id).status === "active", `${e.id} project active`);
    ok(data.project_members.some((m) => m.project_id === e.project_id && m.membership_id === t.membership_id), `${e.id} person is project member`);
  } else {
    ok(a.applies_to === "overhead" && a.overhead_category_id === e.overhead_category_id && e.billable === false, `${e.id} overhead activity/category`);
  }
  if (t.status === "approved") {
    const r = roleRate.get(memById.get(t.membership_id).firm_role_id);
    eq([e.bill_rate_cents, e.cost_rate_cents], [r.bill_rate_cents, r.cost_rate_cents], `${e.id} frozen rates`);
  } else eq([e.bill_rate_cents, e.cost_rate_cents], [null, null], `${e.id} rates null until approval`);
  if (e.invoice_id) ok(t.status === "approved" && e.billable && idx.invoices.get(e.invoice_id).project_id === e.project_id, `${e.id} billed entry valid`);
  const k = t.membership_id + e.work_date; dayTot[k] = (dayTot[k] || 0) + e.hours;
}
ok(Object.values(dayTot).every((h) => h <= 24), "no day over 24 h");
// MOB hours by phase and person (project-detail F2): submitted + approved only
const used = {};
for (const e of data.time_entries) {
  if (e.project_id !== mob.id || !["submitted", "approved"].includes(sheetStatus.get(e.timesheet_id))) continue;
  const code = idx.project_phases.get(e.project_phase_id).code, who = idx.memberships.get(idx.timesheets.get(e.timesheet_id).membership_id).user_id.slice(5).toUpperCase();
  used[code] ??= {}; used[code][who] = (used[code][who] || 0) + e.hours;
}
eq(used, { PD: { BM: 24, JR: 22, KL: 12 }, SD: { BM: 14, JR: 92, KL: 66, AP: 29 }, DD: { BM: 4, JR: 50, KL: 10 } }, "MOB used hours by person (F2)");
const kl8 = data.time_entries.filter((e) => sheetStatus.get(e.timesheet_id) === "draft" && e.project_phase_id === mobDD.id && e.timesheet_id.startsWith("ts_kl_"));
eq(kl8.reduce((a, e) => a + e.hours, 0), 8, "KL 8 h draft on MOB DD");
// week of Oct 12
const week = (ini, ws) => {
  const t = data.timesheets.find((x) => x.membership_id === "mem_" + ini && x.week_start === ws);
  if (!t) return null;
  const es = data.time_entries.filter((e) => e.timesheet_id === t.id);
  const dd = [0, 0, 0, 0, 0, 0, 0];
  for (const e of es) dd[(Date.parse(e.work_date) - Date.parse(ws)) / 864e5] += e.hours;
  const tot = es.reduce((a, e) => a + e.hours, 0), bill = es.filter((e) => e.billable).reduce((a, e) => a + e.hours, 0);
  return { status: t.status, days: dd.slice(0, 5), total: tot, billPct: Math.round(bill / tot * 100), bill };
};
const bm = week("bm", "2026-10-12");
eq([bm.status, bm.days, bm.total, bm.bill, bm.billPct], ["draft", [8, 7.5, 8, 6, 3], 32.5, 28, 86], "BM week Oct 12 (timesheet.md rule 11)");
const APPROVALS = { jr: ["submitted", [9, 8.5, 8, 8, 8], 88], kl: ["submitted", [8, 8, 8, 8, 8], 92], ds: ["submitted", [8, 8, 8, 8, 6], 79],
  ap: ["submitted", [8, 8, 8, 8, 8], 71], ew: ["submitted", [6, 6, 6, 6, 0], 75], tc: ["submitted", [8.5, 8.5, 8.5, 8.5, 8], 85],
  sg: ["submitted", [10, 9, 9, 9, 9], 90], lp: ["submitted", [8, 8, 8, 8, 8], 87], rh: ["approved", [8, 8, 8, 8, 8], 90],
  mw: ["approved", [8, 8, 8, 8, 8], 8], ok: ["approved", [6, 0, 6, 6, 6], 0] };
for (const [ini, [st, dd, pct]] of Object.entries(APPROVALS)) {
  const w = week(ini, "2026-10-12");
  eq(w && [w.status, w.days, w.billPct], [st, dd, pct], `${ini.toUpperCase()} week Oct 12 (Time approvals)`);
}
eq([week("cf", "2026-10-12"), week("nb", "2026-10-12")], [null, null], "CF, NB not submitted for Oct 12");
const HIST = { "2026-08-31": [40, 34], "2026-09-07": [32, 25.5], "2026-09-14": [42.5, 37.5], "2026-09-21": [38, 31], "2026-09-28": [40, 33.5], "2026-10-05": [41, 35.5] };
for (const [ws, [tot, b]] of Object.entries(HIST)) { const w = week("bm", ws); eq([w.status, w.total, w.bill], ["approved", tot, b], `BM history ${ws}`); }

// ---------- report
console.log("\nCounts:", Object.fromEntries(TABLES.map((t) => [t, data[t].length])));
console.log("Foreign-key references checked:", fkCount);
const util = {};
for (const e of data.time_entries) {
  const t = idx.timesheets.get(e.timesheet_id);
  if (!e.billable || !e.project_id || !["submitted", "approved"].includes(t.status) || e.work_date < "2026-09-14" || e.work_date > "2026-10-11") continue;
  util[t.membership_id] = (util[t.membership_id] || 0) + e.hours;
}
console.log("Utilization Sep 14 – Oct 11:", data.memberships.map((m) => `${m.id.slice(4).toUpperCase()} ${Math.round((util[m.id] || 0) / (m.weekly_capacity_hours * 4) * 100)}%`).join(", "));
const act = data.projects.filter((p) => p.status === "active");
const fees = act.reduce((a, p) => a + phasesOf(p.id).reduce((s, x) => s + x.fee_cents, 0), 0), bl = act.reduce((a, p) => a + billedOf[p.id], 0);
console.log(`Projects KPIs: active fees ${$(fees)}, billed ${$(bl)} (${Math.round(bl / fees * 100)}%), left ${$(fees - bl)}`);
console.log(`Receivables ${$(open.reduce((a, i) => a + i.total_cents - i.amount_paid_cents, 0))} in ${open.length} invoices`);
console.log(`\n${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
