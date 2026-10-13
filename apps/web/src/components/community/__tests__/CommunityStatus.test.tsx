import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(() => ({ address: null, isConnected: false })),
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));

import { CommunityDetailView } from "@/components/community/CommunityDetailView";
import { CommunityCard } from "@/components/CommunityCard";
import { atlasCommunity } from "@/test/fixtures/communities";
import type { Community, CommunityRegistry } from "@/lib/community/types";

function createMockRegistry(community: Community): CommunityRegistry {
  return {
    async list() {
      return {
        communities: [community],
        nextCursor: null,
        malformedRecords: 0,
      };
    },
    async get(id: string) {
      if (id === community.record.id) {
        return { status: "found", community };
      }
      return { status: "not-found" };
    },
  };
}

describe("Community lifecycle status (Active / Paused / Archived)", () => {
  it("renders active community without pause or archive badges", () => {
    const activeCommunity: Community = {
      ...atlasCommunity,
      status: "active",
    };

    render(<CommunityCard community={activeCommunity} />);
    expect(screen.queryByTestId("community-status")).not.toBeInTheDocument();
  });

  it("renders paused badge on CommunityCard when community is paused", () => {
    const pausedCommunity: Community = {
      ...atlasCommunity,
      status: "paused",
    };

    render(<CommunityCard community={pausedCommunity} />);
    const badge = screen.getByTestId("community-status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "paused");
    expect(badge).toHaveTextContent("Paused");
  });

  it("renders archived badge on CommunityCard when community is archived", () => {
    const archivedCommunity: Community = {
      ...atlasCommunity,
      status: "archived",
    };

    render(<CommunityCard community={archivedCommunity} />);
    const badge = screen.getByTestId("community-status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "archived");
    expect(badge).toHaveTextContent("Archived");
  });

  it("renders paused badge and warning notice on CommunityDetailView", async () => {
    const pausedCommunity: Community = {
      ...atlasCommunity,
      status: "paused",
    };
    const registry = createMockRegistry(pausedCommunity);

    render(
      <CommunityDetailView
        communityId={pausedCommunity.record.id}
        registry={registry}
      />
    );

    const badge = await screen.findByTestId("community-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Paused");

    const notice = screen.getByTestId("community-paused-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/Write actions including minting membership NFTs and creating proposals are currently suspended/i);
  });

  it("renders archived badge and notice on CommunityDetailView", async () => {
    const archivedCommunity: Community = {
      ...atlasCommunity,
      status: "archived",
    };
    const registry = createMockRegistry(archivedCommunity);

    render(
      <CommunityDetailView
        communityId={archivedCommunity.record.id}
        registry={registry}
      />
    );

    const badge = await screen.findByTestId("community-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Archived");

    const notice = screen.getByTestId("community-archived-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/All governance and minting actions are permanently closed/i);
  });
});
