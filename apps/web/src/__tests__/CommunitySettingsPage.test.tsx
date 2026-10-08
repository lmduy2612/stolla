import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityDetailResult } from "@/lib/community/types";
import { CommunityRegistryProvider } from "@/lib/community/CommunityRegistryProvider";
import {
  clearCommunityMetadataOverride,
  getCommunityMetadataOverride,
} from "@/lib/community/metadataOverrides";
import { communityRegistry } from "@/lib/community/registry";

const mocks = vi.hoisted(() => ({
  useParams: vi.fn(),
  getCommunity: vi.fn(),
  useWallet: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: mocks.useParams,
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));

vi.mock("@/lib/community/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/registry")>();
  return {
    ...actual,
    getCommunity: mocks.getCommunity,
  };
});

import CommunitySettingsPage from "@/app/(app)/communities/[id]/settings/page";
import {
  MOCK_ACCOUNT_CAROL,
  MOCK_ACCOUNT_OWNER,
  MOCK_CONTRACT_A,
  MOCK_CONTRACT_B,
} from "@/test-support/stellar/fixtures";

const COMMUNITY_ID = "12".repeat(32);

const mockFoundCommunity: CommunityDetailResult = {
  status: "found",
  community: {
    record: {
      id: COMMUNITY_ID,
      nftContract: MOCK_CONTRACT_A,
      governorContract: MOCK_CONTRACT_B,
      creator: MOCK_ACCOUNT_CAROL,
      communityOwner: MOCK_ACCOUNT_OWNER,
      createdAtLedger: 100,
      creationIndex: 1,
      metadataUri: "ipfs://bafy-initial-metadata/community.json",
      metadataHash: "aa".repeat(32),
      metadataSchemaVersion: 1,
    },
    metadata: {
      schemaVersion: 1,
      name: "Stellar Builders",
      description: "Original community description",
      logo: "ipfs://bafy-initial-logo/logo.png",
      externalLinks: [{ label: "Website", url: "https://initial.example" }],
    },
    metadataError: null,
    governance: {
      votingDelay: 1,
      votingPeriod: 1000,
      proposalThreshold: "1",
      quorum: "1",
      unavailableFields: [],
    },
  },
};

describe("CommunitySettingsPage (Issue #351)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCommunityMetadataOverride(COMMUNITY_ID);
    mocks.useParams.mockReturnValue({ id: COMMUNITY_ID });
    mocks.getCommunity.mockResolvedValue(mockFoundCommunity);
  });

  it("requires wallet connection when disconnected", async () => {
    mocks.useWallet.mockReturnValue({ address: null, isConnecting: false, connect: vi.fn() });

    render(
      <CommunityRegistryProvider registry={{ list: vi.fn(), get: mocks.getCommunity }}>
        <CommunitySettingsPage />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Connect wallet to manage settings" }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Community Name *")).not.toBeInTheDocument();
  });

  it("blocks non-owners from editing or submitting updates (owner-only gated)", async () => {
    // Carol is creator, not owner
    mocks.useWallet.mockReturnValue({
      address: MOCK_ACCOUNT_CAROL,
      isConnecting: false,
      connect: vi.fn(),
    });

    render(
      <CommunityRegistryProvider registry={{ list: vi.fn(), get: mocks.getCommunity }}>
        <CommunitySettingsPage />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Unauthorized" })).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Only the community owner can modify metadata/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Community Name *")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pin and save metadata/i })).not.toBeInTheDocument();
  });

  it("pre-fills form for owner, displays live hash preview, and successfully updates metadata without redeploy", async () => {
    mocks.useWallet.mockReturnValue({
      address: MOCK_ACCOUNT_OWNER,
      isConnecting: false,
      connect: vi.fn(),
    });

    render(
      <CommunityRegistryProvider registry={{ list: vi.fn(), get: mocks.getCommunity }}>
        <CommunitySettingsPage />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Community Name *")).toHaveValue("Stellar Builders");
      expect(screen.getByLabelText("Description *")).toHaveValue("Original community description");
    });

    // Edit fields
    fireEvent.change(screen.getByLabelText("Community Name *"), {
      target: { value: "Updated Builders Guild" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "New updated mission statement." },
    });

    // Verify hash and JSON preview updated
    await waitFor(() => {
      expect(screen.getByText(/"name": "Updated Builders Guild"/)).toBeInTheDocument();
    });

    // Mock fetch for IPFS pin route
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cid: "bafy-updated-metadata-cid",
        uri: "ipfs://bafy-updated-metadata-cid",
        size: 512,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "Pin and save metadata" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Community metadata updated successfully!/),
      ).toBeInTheDocument();
    });

    // Verify override was saved
    const override = getCommunityMetadataOverride(COMMUNITY_ID);
    expect(override).not.toBeNull();
    expect(override?.metadata.name).toBe("Updated Builders Guild");
    expect(override?.metadata.description).toBe("New updated mission statement.");
    expect(override?.metadataUri).toBe("ipfs://bafy-updated-metadata-cid");
  });

  it("pin failure is retryable and does not clear the draft", async () => {
    mocks.useWallet.mockReturnValue({
      address: MOCK_ACCOUNT_OWNER,
      isConnecting: false,
      connect: vi.fn(),
    });

    render(
      <CommunityRegistryProvider registry={{ list: vi.fn(), get: mocks.getCommunity }}>
        <CommunitySettingsPage />
      </CommunityRegistryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Community Name *")).toHaveValue("Stellar Builders");
    });

    // Edit name to something new
    fireEvent.change(screen.getByLabelText("Community Name *"), {
      target: { value: "Temporary Draft Title" },
    });

    // Mock fetch to simulate network / pinning failure
    const mockFailingFetch = vi.fn().mockRejectedValue(new Error("Pinning service timeout"));
    vi.stubGlobal("fetch", mockFailingFetch);

    fireEvent.click(screen.getByRole("button", { name: "Pin and save metadata" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Pinning failed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry pinning metadata" })).toBeInTheDocument();
    });

    // Acceptance criterion: draft is NOT cleared on failure!
    expect(screen.getByLabelText("Community Name *")).toHaveValue("Temporary Draft Title");

    // Now mock fetch to succeed on retry
    const mockSuccessFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cid: "bafy-retried-cid",
        uri: "ipfs://bafy-retried-cid",
        size: 512,
      }),
    });
    vi.stubGlobal("fetch", mockSuccessFetch);

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: "Retry pinning metadata" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Community metadata updated successfully!/),
      ).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Community Name *")).toHaveValue("Temporary Draft Title");
  });
});
