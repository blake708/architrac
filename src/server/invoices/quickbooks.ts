import type { TenantDb } from "@/db/tenant";

// Where invoice changes hand off to QuickBooks Online (invoicing spec rule
// 15d and 16; quickbooks-sync.md). The sync queue (integration_sync_jobs)
// arrives with milestone 1.9; until then this does nothing. It is called
// inside the same transaction as the status change, so 1.9 only has to fill
// it in.

export async function queueQuickbooksInvoice(db: TenantDb, invoiceId: string, kind: "create" | "void"): Promise<void> {
  // 1.9: insert an integration_sync_jobs row (kind "invoice/create" or
  // "invoice/void") when the firm has QuickBooks connected.
  void db;
  void invoiceId;
  void kind;
}
