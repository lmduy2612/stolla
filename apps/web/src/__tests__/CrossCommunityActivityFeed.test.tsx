import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityRegistryProvider } from "@/lib/community/CommunityRegistryProvider";
import type { Community, CommunityRegistry } from "@/lib/community/types";
import { ProposalState } from "@/lib/proposalState";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  listCommunities: vi.fn(),
  createReadOnlyNftClient: vi.fn(),
  createReadOnlyGovernorClientFor: vi.fn(),
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));

vi.mock("@/lib/contracts", () => ({
  createReadOnlyNftClient: mocks.createReadOnlyNftClient,
  createReadOnlyGovernorClientFor: mocks.createReadOnlyGovernorClientFor,
}));

import { CrossCommunityActivityFeed } from "@/components/communities/CrossCommunityActivityFeed";

const registry = {
  list: mocks.listCommunities,
  get: vi.fn(),
} satisfies CommunityRegistry;

function createMockCommunity(idByte: string, name: string): Community {
  return {
    record: {
      id: idByte.repeat(64),
      nftContract: `C_NFT_${idByte}`,
      governorContract: `C_GOV_${idByte}`,
      creator: "GCREATOR",
      communityOwner: "GOWNER",
      createdAtLedger: 100,
      creationIndex: 0,
      metadataUri: "https://example.test/metadata.json",
      metadataHash: "ab".repeat(32),
      metadataSchemaVersion: 1,
    },
    metadata: {
      schemaVersion: 1,
      name,
      description: `Test community ${name}`,
      externalLinks: [],
    },
    metadataError: null,
    governance: {
      votingDelay: 100,
      votingPeriod: 1000,
      proposalThreshold: "100",
      quorum: "500",
      unavailableFields: [],
    },
  };
}

describe("CrossCommunityActivityFeed (#357)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows prompt to connect wallet when disconnected and triggers connect on click", () => {
    const connectFn = vi.fn();
    mocks.useWallet.mockReturnValue({
      address: null,
      connect: connectFn,
      disconnect: vi.fn(),
      isConnecting: false,
    });

    render(
      <CommunityRegistryProvider registry={registry}>
        <CrossCommunityActivityFeed />
      </CommunityRegistryProvider>,
    );

    expect(screen.getByTestId("activity-feed-disconnected")).toBeInTheDocument();
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect your wallet to see active proposals/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("activity-feed-row")).not.toBeInTheDocument();

    const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
    fireEvent.click(connectBtn);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it("filters to only member communities (balance > 0) with two communities and mixed membership", async () => {
    const userWallet = "G_USER_WALLET";
    mocks.useWallet.mockReturnValue({
      address: userWallet,
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnecting: false,
    });

    const commA = createMockCommunity("a", "Alpha Guild");
    const commB = createMockCommunity("b", "Beta DAO");

    mocks.listCommunities.mockResolvedValue({
      communities: [commA, commB],
      nextCursor: null,
      malformedRecords: 0,
    });

    // Mock NFT balance: Member of Alpha Guild (5), Not a member of Beta DAO (0)
    mocks.createReadOnlyNftClient.mockImplementation((contractId: string) => ({
      balance: vi.fn().mockImplementation(async () => {
        if (contractId === commA.record.nftContract) {
          return { result: 5n };
        }
        return { result: 0n };
      }),
    }));

    // Mock Governor client for Alpha Guild
    const propIdA = "11".repeat(32);
    mocks.createReadOnlyGovernorClientFor.mockImplementation(
      (contractId: string) => ({
        proposal_state: vi
          .fn()
          .mockResolvedValue({ result: ProposalState.Active }),
        proposal_deadline: vi.fn().mockResolvedValue({ result: 250000 }),
        has_voted: vi.fn().mockResolvedValue({ result: false }),
      }),
    );

    const mockDiscovery = vi.fn().mockImplementation(async (govContract: string) => {
      if (govContract === commA.record.governorContract) {
        return [
          {
            id: propIdA,
            description: "Alpha Upgrade Proposal",
            voteSnapshot: 200000,
            voteEnd: 250000,
          },
        ];
      }
      if (govContract === commB.record.governorContract) {
        return [
          {
            id: "22".repeat(32),
            description: "Beta Treasury Allocation",
            voteSnapshot: 200000,
            voteEnd: 250000,
          },
        ];
      }
      return [];
    });

    render(
      <CommunityRegistryProvider registry={registry}>
        <CrossCommunityActivityFeed discoveryProvider={mockDiscovery} />
      </CommunityRegistryProvider>,
    );

    // Should load and show Alpha Guild proposal
    await waitFor(() => {
      expect(screen.getByTestId("activity-feed-list")).toBeInTheDocument();
    });

    // Visible: Alpha Guild proposal
    expect(screen.getByText("Alpha Guild")).toBeInTheDocument();
    expect(screen.getByText("Alpha Upgrade Proposal")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByTestId("activity-needs-vote-badge")).toBeInTheDocument();

    // Verify deep link points to canonical URL
    const link = screen.getByTestId("activity-feed-row");
    expect(link).toHaveAttribute(
      "href",
      `/communities/${commA.record.id}/proposals/${propIdA}`,
    );

    // NOT Visible: Beta DAO (user is not a member)
    expect(screen.queryByText("Beta DAO")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Beta Treasury Allocation"),
    ).not.toBeInTheDocument();
  });

  it("shows no-membership state when wallet has balance 0 across all communities", async () => {
    mocks.useWallet.mockReturnValue({
      address: "G_NON_MEMBER_WALLET",
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnecting: false,
    });

    const commA = createMockCommunity("a", "Alpha Guild");
    mocks.listCommunities.mockResolvedValue({
      communities: [commA],
      nextCursor: null,
      malformedRecords: 0,
    });

    mocks.createReadOnlyNftClient.mockReturnValue({
      balance: vi.fn().mockResolvedValue({ result: 0n }),
    });

    render(
      <CommunityRegistryProvider registry={registry}>
        <CrossCommunityActivityFeed />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("activity-feed-no-membership"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("No community memberships")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /explore communities/i }),
    ).toHaveAttribute("href", "/communities");
  });

  it("handles partial failures gracefully without hiding successful communities", async () => {
    mocks.useWallet.mockReturnValue({
      address: "G_MEMBER_WALLET",
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnecting: false,
    });

    const commA = createMockCommunity("a", "Healthy DAO");
    const commB = createMockCommunity("b", "Failing DAO");

    mocks.listCommunities.mockResolvedValue({
      communities: [commA, commB],
      nextCursor: null,
      malformedRecords: 0,
    });

    mocks.createReadOnlyNftClient.mockReturnValue({
      balance: vi.fn().mockResolvedValue({ result: 1n }),
    });

    mocks.createReadOnlyGovernorClientFor.mockImplementation(
      (contractId: string) => {
        if (contractId === commB.record.governorContract) {
          throw new Error("RPC Node Timeout");
        }
        return {
          proposal_state: vi
            .fn()
            .mockResolvedValue({ result: ProposalState.Executed }),
          proposal_deadline: vi.fn().mockResolvedValue({ result: 100000 }),
          has_voted: vi.fn().mockResolvedValue({ result: true }),
        };
      },
    );

    const mockDiscovery = vi.fn().mockImplementation(async (govContract: string) => {
      if (govContract === commA.record.governorContract) {
        return [{ id: "aa".repeat(32), description: "Healthy Proposal" }];
      }
      return [{ id: "bb".repeat(32), description: "Broken Proposal" }];
    });

    render(
      <CommunityRegistryProvider registry={registry}>
        <CrossCommunityActivityFeed discoveryProvider={mockDiscovery} />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("activity-feed-list")).toBeInTheDocument();
    });

    // Shows partial error warning
    expect(
      screen.getByTestId("activity-feed-partial-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Could not load activity for some communities/i),
    ).toBeInTheDocument();

    // Still renders healthy proposal
    expect(screen.getByText("Healthy DAO")).toBeInTheDocument();
    expect(screen.getByText("Healthy Proposal")).toBeInTheDocument();
    expect(screen.getByText("Executed")).toBeInTheDocument();
    expect(screen.getByTestId("activity-voted-badge")).toBeInTheDocument();
  });
});
