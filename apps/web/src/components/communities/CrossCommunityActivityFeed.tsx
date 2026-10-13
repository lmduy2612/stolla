"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Buffer } from "buffer";
import { useWallet } from "@/context/WalletProvider";
import { useCommunityRegistry } from "@/lib/community/CommunityRegistryProvider";
import {
  createReadOnlyGovernorClientFor,
  createReadOnlyNftClient,
} from "@/lib/contracts";
import { ProposalState, PROPOSAL_STATE_LABELS } from "@/lib/proposalState";
import { formatProposalDeadlineEstimate } from "@/lib/proposalDeadline";
import { AppButton } from "@/components/ui/AppButton";
import { AppLinkButton } from "@/components/ui/AppLinkButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { getE2EBridge } from "@/lib/e2eMock";
import type { DiscoveredProposal } from "@/hooks/useProposalDiscovery";

export type FeedProposal = {
  communityId: string;
  communityName: string;
  proposalId: string;
  title: string;
  state: ProposalState;
  stateLabel: string;
  deadlineEstimate: string | null;
  hasVoted: boolean;
};

export type ActivityFeedState =
  | { kind: "disconnected" }
  | { kind: "loading" }
  | { kind: "no-membership" }
  | { kind: "empty"; memberCommunitiesCount: number }
  | {
      kind: "ready";
      proposals: FeedProposal[];
      partialErrors: string[];
    };

export function CrossCommunityActivityFeed({
  discoveryProvider,
}: {
  discoveryProvider?: (
    governorContractId: string,
  ) => Promise<DiscoveredProposal[]>;
} = {}) {
  const { address, connect } = useWallet();
  const registry = useCommunityRegistry();
  const [feedState, setFeedState] = useState<ActivityFeedState>(() =>
    address ? { kind: "loading" } : { kind: "disconnected" },
  );

  useEffect(() => {
    if (!address) {
      setFeedState({ kind: "disconnected" });
      return;
    }

    let active = true;
    setFeedState({ kind: "loading" });

    void (async () => {
      try {
        const page = await registry.list(null, 50);
        if (!active) return;

        // Step 1: Check membership for each community (NFT balance > 0)
        const memberCommunities: Array<{
          id: string;
          name: string;
          nftContract: string;
          governorContract: string;
        }> = [];

        await Promise.all(
          page.communities.map(async (comm) => {
            try {
              const nftClient = createReadOnlyNftClient(
                comm.record.nftContract,
              );
              const balRes = await nftClient.balance({ account: address });
              const balance = Number(balRes?.result ?? 0);
              if (balance > 0) {
                memberCommunities.push({
                  id: comm.record.id,
                  name: comm.metadata?.name ?? comm.record.id.slice(0, 8),
                  nftContract: comm.record.nftContract,
                  governorContract: comm.record.governorContract,
                });
              }
            } catch {
              // Ignore individual membership probe failure
            }
          }),
        );

        if (!active) return;

        if (memberCommunities.length === 0) {
          setFeedState({ kind: "no-membership" });
          return;
        }

        // Step 2: For each member community, discover and fetch proposal details
        const proposals: FeedProposal[] = [];
        const partialErrors: string[] = [];

        await Promise.all(
          memberCommunities.map(async (comm) => {
            try {
              let discovered: DiscoveredProposal[] = [];

              if (discoveryProvider) {
                discovered = await discoveryProvider(comm.governorContract);
              } else {
                const mocked =
                  getE2EBridge()?.proposals?.[comm.governorContract];
                if (mocked) {
                  discovered = mocked;
                }
              }

              if (discovered.length === 0) return;

              const govClient = createReadOnlyGovernorClientFor(
                comm.governorContract,
              );

              await Promise.all(
                discovered.map(async (p) => {
                  try {
                    const proposalBuf = Buffer.from(p.id, "hex");

                    const [stateRes, deadlineRes, votedRes] =
                      await Promise.allSettled([
                        govClient.proposal_state({
                          proposal_id: proposalBuf,
                        }),
                        govClient.proposal_deadline({
                          proposal_id: proposalBuf,
                        }),
                        govClient.has_voted({
                          proposal_id: proposalBuf,
                          account: address,
                        }),
                      ]);

                    const state =
                      stateRes.status === "fulfilled"
                        ? stateRes.value.result
                        : ProposalState.Active;

                    const deadlineLedger =
                      deadlineRes.status === "fulfilled"
                        ? Number(deadlineRes.value.result)
                        : null;

                    const hasVoted =
                      votedRes.status === "fulfilled"
                        ? Boolean(votedRes.value.result)
                        : false;

                    const deadlineEstimate = formatProposalDeadlineEstimate(
                      deadlineLedger,
                      null,
                      null,
                    );

                    proposals.push({
                      communityId: comm.id,
                      communityName: comm.name,
                      proposalId: p.id,
                      title:
                        p.description || `Proposal #${p.id.slice(0, 8)}`,
                      state,
                      stateLabel:
                        PROPOSAL_STATE_LABELS[state] ?? "Unknown",
                      deadlineEstimate,
                      hasVoted,
                    });
                  } catch {
                    // Skip failed proposal within community
                  }
                }),
              );
            } catch {
              partialErrors.push(comm.name);
            }
          }),
        );

        if (!active) return;

        if (proposals.length === 0 && partialErrors.length === 0) {
          setFeedState({
            kind: "empty",
            memberCommunitiesCount: memberCommunities.length,
          });
        } else {
          setFeedState({
            kind: "ready",
            proposals,
            partialErrors,
          });
        }
      } catch {
        if (!active) return;
        setFeedState({
          kind: "ready",
          proposals: [],
          partialErrors: ["Registry query failed"],
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [address, registry, discoveryProvider]);

  if (feedState.kind === "disconnected") {
    return (
      <div
        data-testid="activity-feed-disconnected"
        className="rounded-2xl border border-slate-800 bg-[#0b0f19] p-8 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-400">
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-100">
          Connect your wallet
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Connect your wallet to see active proposals across communities you
          belong to.
        </p>
        <div className="mt-6">
          <AppButton tone="primary" onClick={() => void connect()}>
            Connect wallet
          </AppButton>
        </div>
      </div>
    );
  }

  if (feedState.kind === "loading") {
    return (
      <div data-testid="activity-feed-loading" className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (feedState.kind === "no-membership") {
    return (
      <div
        data-testid="activity-feed-no-membership"
        className="rounded-2xl border border-slate-800 bg-[#0b0f19] p-8 text-center"
      >
        <h3 className="text-lg font-semibold text-slate-100">
          No community memberships
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          You are not currently a member of any registered communities. Join
          or mint a membership NFT in a community to track proposals and cast
          votes here.
        </p>
        <div className="mt-6">
          <AppLinkButton href="/communities" tone="secondary">
            Explore communities
          </AppLinkButton>
        </div>
      </div>
    );
  }

  if (feedState.kind === "empty") {
    return (
      <div
        data-testid="activity-feed-empty"
        className="rounded-2xl border border-slate-800 bg-[#0b0f19] p-8 text-center text-sm text-slate-400"
      >
        No open proposals across your {feedState.memberCommunitiesCount}{" "}
        member communities right now.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedState.partialErrors.length > 0 && (
        <div
          data-testid="activity-feed-partial-error"
          className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-300"
        >
          Could not load activity for some communities (
          {feedState.partialErrors.join(", ")}).
        </div>
      )}

      <div data-testid="activity-feed-list" className="space-y-3">
        {feedState.proposals.map((item) => (
          <Link
            key={`${item.communityId}-${item.proposalId}`}
            href={`/communities/${item.communityId}/proposals/${item.proposalId}`}
            className="group block rounded-2xl border border-slate-800 bg-[#0b0f19] p-5 transition hover:border-indigo-500/50 hover:bg-slate-900/40"
            data-testid="activity-feed-row"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    data-testid="activity-community-name"
                    className="inline-flex items-center rounded-md bg-indigo-950/60 px-2 py-0.5 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/20"
                  >
                    {item.communityName}
                  </span>
                  <span
                    data-testid="activity-proposal-state"
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                      item.state === ProposalState.Active
                        ? "bg-emerald-950/60 text-emerald-300 ring-1 ring-inset ring-emerald-500/20"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {item.stateLabel}
                  </span>
                </div>
                <h4
                  data-testid="activity-proposal-title"
                  className="mt-2 text-base font-semibold text-slate-100 group-hover:text-indigo-300"
                >
                  {item.title}
                </h4>
                {item.deadlineEstimate && (
                  <p
                    data-testid="activity-deadline-estimate"
                    className="mt-1 text-xs text-slate-400"
                  >
                    {item.deadlineEstimate}
                  </p>
                )}
              </div>

              <div className="shrink-0">
                {item.hasVoted ? (
                  <span
                    data-testid="activity-voted-badge"
                    className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300"
                  >
                    ✓ Voted
                  </span>
                ) : item.state === ProposalState.Active ? (
                  <span
                    data-testid="activity-needs-vote-badge"
                    className="inline-flex items-center rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-semibold text-indigo-300 ring-1 ring-indigo-500/40"
                  >
                    Needs your vote
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
