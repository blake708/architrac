import type { TenantDb } from "@/db/tenant";

// Where invoice changes hand off to QuickBooks Online (invoicing spec rule
// 15d and 16; quickbooks-sync.md). The sync queue (integration_sync_jobs)
// arrives with the QuickBooks sync (Release 2, decision #33); until then
// this does nothing. It is called inside the same transaction as the status
// change, so the sync only has to fill it in.

export async function queueQuickbooksInvoice(db: TenantDb, invoiceId: string, kind: "create" | "void"): Promise<void> {
  // QuickBooks sync (Release 2): insert an integration_sync_jobs row (kind "invoice/create" or
  // "invoice/void") when the firm has QuickBooks connected.
  void db;
  void invoiceId;
  void kind;
}

/** A payment recorded or deleted (invoicing spec Actions; sync spec). Does nothing until the QuickBooks sync (Release 2). */
export async function queueQuickbooksPayment(db: TenantDb, paymentId: string, kind: "create" | "delete"): Promise<void> {
  // QuickBooks sync (Release 2): insert an integration_sync_jobs row ("payment/create" or "payment/delete").
  void db;
  void paymentId;
  void kind;
}
