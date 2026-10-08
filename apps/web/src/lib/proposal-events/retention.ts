import type { rpc } from "@stellar/stellar-sdk";

export type DiscoveryFailureKind =
  | "configuration"
  | "retention"
  | "rpc"
  | "decode";

export type DiscoveryFailure = {
  kind: DiscoveryFailureKind;
  /** Stable, user-facing message. */
  message: string;
  /** Original thrown value, when available. */
  cause?: unknown;
};

/** Resolve the first event page against the RPC's current retention boundary. */
export function clampEventStartLedger(configured: number, oldest: number | undefined) {
  if (typeof oldest !== "number" || !Number.isSafeInteger(oldest) || oldest < 1) {
    throw new Error("RPC did not report a valid oldest retained ledger.");
  }
  return {
    startLedger: Math.max(configured, oldest),
    clamped: configured < oldest,
  };
}

export async function resolveEventStartLedger(
  server: Pick<rpc.Server, "getLatestLedger" | "serverURL">,
  configured: number,
) {
  // getEvents omits oldestLedger, and this SDK does not wrap getLedgers.
  // Request the current ledger so the metadata query is within retention.
  const { sequence } = await server.getLatestLedger();
  const response = await fetch(server.serverURL.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgers",
      params: { startLedger: sequence, pagination: { limit: 1 } },
    }),
  });
  if (!response.ok) throw new Error("RPC could not report its event retention window.");
  const payload = await response.json() as {
    result?: { oldestLedger?: number };
    error?: { code?: number; message?: string };
  };
  if (payload.error) throw payload.error;
  const oldestLedger = payload.result?.oldestLedger;
  return clampEventStartLedger(configured, oldestLedger);
}

const RETENTION_COPY =
  "Proposal history could not be scanned because the start ledger is outside the RPC retention window. Check NEXT_PUBLIC_GOVERNOR_START_LEDGER, or use an indexer for older history.";

export const CONFIGURATION_COPY =
  "Proposal discovery is not configured. Set NEXT_PUBLIC_GOVERNOR_START_LEDGER and reload.";

/** The SDK throws JSON-RPC errors as plain { code, message } objects. */
export function retentionErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const rpcError = error as { code?: unknown; message?: unknown };
  if (
    rpcError.code !== -32600 ||
    typeof rpcError.message !== "string" ||
    !/startLedger.*(?:ledger range|oldest|latest|retention)/i.test(rpcError.message)
  ) {
    return null;
  }
  return RETENTION_COPY;
}

export function isRetentionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const rpcError = error as { code?: unknown; message?: unknown };
  if (typeof rpcError.message !== "string") return false;
  return /startLedger.*(?:ledger range|oldest|latest|retention)/i.test(rpcError.message);
}