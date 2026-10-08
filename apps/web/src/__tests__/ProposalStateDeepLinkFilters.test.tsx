import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalState } from "@/lib/proposalState";
import { CommunityRegistryProvider } from "@/lib/community/CommunityRegistryProvider";
import ProposalsPage from "@/app/(app)/proposals/page";
import CommunityProposalHistoryPage from "@/app/(app)/communities/[id]/proposals/page";
import type { CommunityDetailResult } from "@/lib/community/types";

const mocks = vi.hoisted(() => ({
  useParams: vi.fn(),
  useProposalDiscovery: vi.fn(),
  createGovernorClient: vi.fn(),
  createReadOnlyGovernorClient: vi.fn(),
  getCommunity: vi.fn(),
  refresh: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: mocks.useParams,
}));

vi.mock("@/hooks/useProposalDiscovery", () => ({
  useProposalDiscovery: mocks.useProposalDiscovery,
}));

vi.mock("@/lib/contracts", () => ({
  createGovernorClient: mocks.createGovernorClient,
  createReadOnlyGovernorClient: mocks.createReadOnlyGovernorClient,
  storeProposalId: vi.fn(),
  storeProposalIdFor: vi.fn(),
}));

vi.mock("@/lib/stellar", () => ({
  contractIds: { governor: "CGOVERNOR" },
}));

vi.mock("@/lib/community/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/community/registry")>()),
  getCommunity: mocks.getCommunity,
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: () => ({
    address: null,
    signTransaction: mocks.signTransaction,
    isConnecting: false,
  }),
}));

const mockProposal1 = {
  id: "1111111111111111111111111111111111111111111111111111111111111111",
  description: "Proposal Alpha (Active)",
};

const mockProposal2 = {
  id: "2222222222222222222222222222222222222222222222222222222222222222",
  description: "Proposal Beta (Defeated)",
};

const mockProposal3 = {
  id: "3333333333333333333333333333333333333333333333333333333333333333",
  description: "Proposal Gamma (Succeeded)",
};

function stateForId(id: string): ProposalState {
  if (id === mockProposal1.id) return ProposalState.Active;
  if (id === mockProposal2.id) return ProposalState.Defeated;
  return ProposalState.Succeeded;
}

const mockCommunityView: CommunityDetailResult = {
  status: "found",
  community: {
    record: {
      id: "comm-123",
      owner: "GOWNER",
      nftContract: "CNFT",
      governorContract: "CGOVERNOR",
      metadataUri: "https://meta",
      metadataHash: "hash",
    },
    metadata: {
      name: "Solitude DAO",
      description: "A decentralized community",
      logoUri: "",
    },
    creatorIdentity: null,
  },
};

describe("Proposal state URL query filter deep-linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh.mockResolvedValue(true);
    mocks.useParams.mockReturnValue({ id: "comm-123" });
    mocks.getCommunity.mockResolvedValue(mockCommunityView);

    mocks.useProposalDiscovery.mockReturnValue({
      proposals: [mockProposal1, mockProposal2, mockProposal3],
      loading: false,
      error: null,
      empty: false,
      freshness: { state: "current", explanation: "" },
      latestLedger: 1000,
      refresh: mocks.refresh,
    });

    mocks.createGovernorClient.mockReturnValue({
      proposal_state: vi.fn().mockImplementation(async ({ proposal_id }: { proposal_id: Buffer }) => ({
        result: stateForId(proposal_id.toString("hex")),
      })),
    });

    mocks.createReadOnlyGovernorClient.mockReturnValue({
      proposal_state: vi.fn().mockImplementation(async ({ proposal_id }: { proposal_id: Buffer }) => ({
        result: stateForId(proposal_id.toString("hex")),
      })),
    });

    window.history.replaceState({}, "", "/proposals");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/proposals");
  });

  describe("Global proposals list (/proposals)", () => {
    it("initializes filter from ?state=active and filters the proposal list", async () => {
      window.history.replaceState({}, "", "/proposals?state=active");

      render(<ProposalsPage />);

      await waitFor(() => {
        expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      });

      expect(screen.queryByText("Proposal Beta (Defeated)")).not.toBeInTheDocument();
      expect(screen.queryByText("Proposal Gamma (Succeeded)")).not.toBeInTheDocument();

      const select = screen.getByLabelText("Filter proposals by state") as HTMLSelectElement;
      expect(select.value).toBe(String(ProposalState.Active));
    });

    it("updates URL query parameter when user selects a different filter", async () => {
      window.history.replaceState({}, "", "/proposals");

      render(<ProposalsPage />);

      await waitFor(() => {
        expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("Filter proposals by state");
      fireEvent.change(select, { target: { value: String(ProposalState.Defeated) } });

      expect(window.location.search).toBe("?state=defeated");
      expect(screen.getByText("Proposal Beta (Defeated)")).toBeInTheDocument();
      expect(screen.queryByText("Proposal Alpha (Active)")).not.toBeInTheDocument();
      expect(screen.queryByText("Proposal Gamma (Succeeded)")).not.toBeInTheDocument();
    });

    it("clears query parameter from URL when user selects All", async () => {
      window.history.replaceState({}, "", "/proposals?state=active");

      render(<ProposalsPage />);

      await waitFor(() => {
        expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("Filter proposals by state");
      fireEvent.change(select, { target: { value: "all" } });

      expect(window.location.search).toBe("");
      expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Beta (Defeated)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Gamma (Succeeded)")).toBeInTheDocument();
    });

    it("falls back to All without crashing when URL has an invalid state query value", async () => {
      window.history.replaceState({}, "", "/proposals?state=invalid_gibberish");

      render(<ProposalsPage />);

      await waitFor(() => {
        expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("Filter proposals by state") as HTMLSelectElement;
      expect(select.value).toBe("all");
      expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Beta (Defeated)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Gamma (Succeeded)")).toBeInTheDocument();
    });

    it("updates filter on popstate event (browser back/forward navigation)", async () => {
      window.history.replaceState({}, "", "/proposals?state=active");

      render(<ProposalsPage />);

      await waitFor(() => {
        expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      });

      window.history.replaceState({}, "", "/proposals?state=defeated");
      fireEvent(window, new PopStateEvent("popstate"));

      await waitFor(() => {
        expect(screen.getByText("Proposal Beta (Defeated)")).toBeInTheDocument();
      });
      expect(screen.queryByText("Proposal Alpha (Active)")).not.toBeInTheDocument();
    });
  });

  describe("Community-scoped proposals list (/communities/[id]/proposals)", () => {
    it("initializes filter from ?state=succeeded and updates query when changed", async () => {
      window.history.replaceState(
        {},
        "",
        "/communities/comm-123/proposals?state=succeeded",
      );

      render(
        <CommunityRegistryProvider registry={{ list: vi.fn(), get: mocks.getCommunity }}>
          <CommunityProposalHistoryPage />
        </CommunityRegistryProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText("Proposal Gamma (Succeeded)")).toBeInTheDocument();
      });

      expect(screen.queryByText("Proposal Alpha (Active)")).not.toBeInTheDocument();
      expect(screen.queryByText("Proposal Beta (Defeated)")).not.toBeInTheDocument();

      const select = screen.getByLabelText("Filter community proposals by state");
      fireEvent.change(select, { target: { value: "all" } });

      expect(window.location.search).toBe("");
      expect(screen.getByText("Proposal Alpha (Active)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Beta (Defeated)")).toBeInTheDocument();
      expect(screen.getByText("Proposal Gamma (Succeeded)")).toBeInTheDocument();
    });
  });
});
