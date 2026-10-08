import type { DiscoveryErrorKind } from "@/hooks/useProposalDiscovery";

export function describeDiscoveryError(
  error: string | null | undefined,
  errorKind?: DiscoveryErrorKind | null,
): string {
  if (errorKind === "retention") {
    return "Proposal history could not be scanned because the start ledger is outside the RPC retention window. Check NEXT_PUBLIC_GOVERNOR_START_LEDGER, or use an indexer for older history.";
  }
  if (errorKind === "config") {
    return "Proposal discovery is not configured. Set NEXT_PUBLIC_GOVERNOR_START_LEDGER and reload.";
  }
  if (errorKind === "rpc") {
    return error || "Failed to communicate with the Stellar RPC server.";
  }
  return error || "An unexpected error occurred while discovering proposals.";
}
