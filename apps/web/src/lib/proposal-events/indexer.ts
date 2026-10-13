/**
 * Proposal-event indexer client and retention fallback adapter.
 *
 * Implements persistent indexing query contract per docs/community-proposal-indexing.md
 * and ADR-004 escalation criteria.
 */

export type IndexedProposalItem = {
  communityId?: string;
  governorContract: string;
  proposalId: string;
  proposalKey: string;
  createdAtLedger: number;
  description: string | null;
  statusHint?: string;
  proposer?: string | null;
  voteSnapshot?: number | null;
  voteEnd?: number | null;
};

export type IndexerSyncStatus = {
  status: "ready" | "syncing" | "partial" | "error";
  freshness: "fresh" | "stale";
  indexedThroughLedger: number;
  observedHeadLedger: number;
  lastSuccessfulSync: string;
  warnings?: string[];
};

export type IndexerProposalListResponse = {
  items: IndexedProposalItem[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  sync: IndexerSyncStatus;
};

export type ProposalIndexerClient = {
  listProposals: (params: {
    governorContract: string;
    communityId?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<IndexerProposalListResponse>;
  getProposal: (params: {
    governorContract: string;
    proposalId: string;
    communityId?: string;
  }) => Promise<IndexedProposalItem | null>;
};

export type FallbackResolutionResult = {
  proposals: IndexedProposalItem[];
  source: "rpc" | "indexer" | "hybrid";
  isPartial: boolean;
  warning: string | null;
};

/**
 * Creates an HTTP client for querying the Stolla Proposal Indexing service.
 */
export function createProposalIndexerClient(
  baseUrl?: string,
  fetchFn: typeof fetch = fetch,
): ProposalIndexerClient {
  const root = (
    baseUrl ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_INDEXER_URL
      : undefined) ??
    ""
  ).replace(/\/+$/, "");

  return {
    async listProposals({ governorContract, communityId, limit = 20, cursor }) {
      if (!root) {
        throw new Error("Proposal indexer URL is not configured.");
      }

      const path = communityId
        ? `${root}/v1/communities/${encodeURIComponent(communityId)}/proposals`
        : `${root}/v1/governors/${encodeURIComponent(governorContract)}/proposals`;

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);

      const url = `${path}?${params.toString()}`;
      const res = await fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(
          `Indexer request failed with status ${res.status}: ${res.statusText}`,
        );
      }

      return (await res.json()) as IndexerProposalListResponse;
    },

    async getProposal({ governorContract, proposalId, communityId }) {
      if (!root) {
        throw new Error("Proposal indexer URL is not configured.");
      }

      const path = communityId
        ? `${root}/v1/communities/${encodeURIComponent(communityId)}/proposals/${encodeURIComponent(proposalId)}`
        : `${root}/v1/governors/${encodeURIComponent(governorContract)}/proposals/${encodeURIComponent(proposalId)}`;

      const res = await fetchFn(path, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `Indexer detail request failed with status ${res.status}: ${res.statusText}`,
        );
      }

      return (await res.json()) as IndexedProposalItem;
    },
  };
}

/**
 * Merges RPC-discovered proposals with persistent indexer records when RPC retention clamps.
 * Guarantees proposals older than RPC retention remain listable.
 * Degrades gracefully to an actionable partial-history notice if the indexer is unavailable.
 */
export async function resolveProposalsWithIndexerFallback(options: {
  rpcProposals: IndexedProposalItem[];
  governorContract: string;
  communityId?: string;
  isClamped: boolean;
  indexerClient?: ProposalIndexerClient;
}): Promise<FallbackResolutionResult> {
  const { rpcProposals, governorContract, communityId, isClamped, indexerClient } =
    options;

  // If RPC is inside retention and not clamped, RPC data is authoritative and fresh
  if (!isClamped) {
    return {
      proposals: rpcProposals,
      source: "rpc",
      isPartial: false,
      warning: null,
    };
  }

  // If retention clamped but no indexer client configured, return actionable partial notice
  if (!indexerClient) {
    return {
      proposals: rpcProposals,
      source: "rpc",
      isPartial: true,
      warning:
        "Older proposals could not be scanned because the start ledger is outside the RPC retention window. Configure an indexer to view full governance history.",
    };
  }

  try {
    const indexed = await indexerClient.listProposals({
      governorContract,
      communityId,
    });

    const seenIds = new Set<string>();
    const merged: IndexedProposalItem[] = [];

    // RPC live items take precedence for recent data
    for (const item of rpcProposals) {
      const normalizedId = item.proposalId.toLowerCase();
      if (!seenIds.has(normalizedId)) {
        seenIds.add(normalizedId);
        merged.push(item);
      }
    }

    // Append older items from indexer
    for (const item of indexed.items) {
      const normalizedId = item.proposalId.toLowerCase();
      if (!seenIds.has(normalizedId)) {
        seenIds.add(normalizedId);
        merged.push(item);
      }
    }

    // Sort descending by creation ledger
    merged.sort((a, b) => b.createdAtLedger - a.createdAtLedger);

    const hasOlderIndexed = indexed.items.some((item) =>
      !rpcProposals.some(
        (rpc) => rpc.proposalId.toLowerCase() === item.proposalId.toLowerCase(),
      ),
    );

    return {
      proposals: merged,
      source: hasOlderIndexed ? "hybrid" : "rpc",
      isPartial: false,
      warning: null,
    };
  } catch (err) {
    // Graceful degradation when indexer is down: display partial RPC results with actionable message
    const message =
      err instanceof Error ? err.message : "Indexer service unreachable.";
    return {
      proposals: rpcProposals,
      source: "rpc",
      isPartial: true,
      warning: `Indexer unavailable (${message}). Showing only recent proposals within RPC retention.`,
    };
  }
}
