import { describe, expect, it, vi } from "vitest";
import {
  createProposalIndexerClient,
  resolveProposalsWithIndexerFallback,
  type IndexedProposalItem,
  type IndexerProposalListResponse,
  type ProposalIndexerClient,
} from "./indexer";

describe("proposal-events indexer client and fallback", () => {
  const governor = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const communityId = "a".repeat(64);

  const mockRpcProposal: IndexedProposalItem = {
    governorContract: governor,
    communityId,
    proposalId: "prop-recent-1",
    proposalKey: `testnet:${governor}:prop-recent-1`,
    createdAtLedger: 500,
    description: "Recent proposal within RPC retention",
  };

  const mockOlderIndexedProposal: IndexedProposalItem = {
    governorContract: governor,
    communityId,
    proposalId: "prop-ancient-2",
    proposalKey: `testnet:${governor}:prop-ancient-2`,
    createdAtLedger: 100,
    description: "Older proposal outside RPC retention",
  };

  it("constructs correct URLs and queries for community proposals", async () => {
    const mockResponse: IndexerProposalListResponse = {
      items: [mockOlderIndexedProposal],
      page: { nextCursor: null, hasMore: false },
      sync: {
        status: "ready",
        freshness: "fresh",
        indexedThroughLedger: 600,
        observedHeadLedger: 600,
        lastSuccessfulSync: "2026-10-13T00:00:00Z",
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const client = createProposalIndexerClient("https://indexer.stolla.test", mockFetch as unknown as typeof fetch);
    const result = await client.listProposals({
      governorContract: governor,
      communityId,
      limit: 10,
      cursor: "cursor-123",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://indexer.stolla.test/v1/communities/${communityId}/proposals?limit=10&cursor=cursor-123`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].proposalId).toBe("prop-ancient-2");
  });

  it("handles 404 cleanly in getProposal detail", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const client = createProposalIndexerClient("https://indexer.stolla.test", mockFetch as unknown as typeof fetch);
    const result = await client.getProposal({
      governorContract: governor,
      proposalId: "unknown-id",
    });

    expect(result).toBeNull();
  });

  it("returns RPC data directly when RPC retention is not clamped", async () => {
    const mockIndexerClient: ProposalIndexerClient = {
      listProposals: vi.fn(),
      getProposal: vi.fn(),
    };

    const result = await resolveProposalsWithIndexerFallback({
      rpcProposals: [mockRpcProposal],
      governorContract: governor,
      isClamped: false,
      indexerClient: mockIndexerClient,
    });

    expect(result.source).toBe("rpc");
    expect(result.isPartial).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.proposals).toEqual([mockRpcProposal]);
    expect(mockIndexerClient.listProposals).not.toHaveBeenCalled();
  });

  it("merges indexer history when RPC is clamped so older proposals remain listable", async () => {
    const mockIndexerClient: ProposalIndexerClient = {
      listProposals: vi.fn().mockResolvedValue({
        items: [mockRpcProposal, mockOlderIndexedProposal],
        page: { nextCursor: null, hasMore: false },
        sync: { status: "ready", freshness: "fresh", indexedThroughLedger: 600, observedHeadLedger: 600, lastSuccessfulSync: "2026-10-13T00:00:00Z" },
      }),
      getProposal: vi.fn(),
    };

    const result = await resolveProposalsWithIndexerFallback({
      rpcProposals: [mockRpcProposal],
      governorContract: governor,
      isClamped: true,
      indexerClient: mockIndexerClient,
    });

    expect(result.source).toBe("hybrid");
    expect(result.isPartial).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.proposals).toHaveLength(2);
    // Ordered descending by createdAtLedger
    expect(result.proposals[0].proposalId).toBe("prop-recent-1");
    expect(result.proposals[1].proposalId).toBe("prop-ancient-2");
  });

  it("degrades gracefully with an actionable partial-history notice when indexer is down", async () => {
    const mockIndexerClient: ProposalIndexerClient = {
      listProposals: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
      getProposal: vi.fn(),
    };

    const result = await resolveProposalsWithIndexerFallback({
      rpcProposals: [mockRpcProposal],
      governorContract: governor,
      isClamped: true,
      indexerClient: mockIndexerClient,
    });

    // Instead of throwing or blank page, returns available proposals with actionable notice
    expect(result.source).toBe("rpc");
    expect(result.isPartial).toBe(true);
    expect(result.warning).toMatch(/Indexer unavailable.*Showing only recent proposals/i);
    expect(result.proposals).toEqual([mockRpcProposal]);
  });

  it("surfaces an actionable configuration warning when retention clamped but no indexer client exists", async () => {
    const result = await resolveProposalsWithIndexerFallback({
      rpcProposals: [mockRpcProposal],
      governorContract: governor,
      isClamped: true,
    });

    expect(result.source).toBe("rpc");
    expect(result.isPartial).toBe(true);
    expect(result.warning).toMatch(/outside the RPC retention window.*Configure an indexer/i);
    expect(result.proposals).toEqual([mockRpcProposal]);
  });
});
