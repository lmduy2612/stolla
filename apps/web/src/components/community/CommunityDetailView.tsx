"use client";

import { AppLinkButton } from "@/components/ui/AppLinkButton";
import type { Community, CommunityRegistry } from "@/lib/community/types";
import { useRegistryCommunity } from "@/lib/community/useRegistryCommunity";
import { CommunityBreadcrumbs } from "./CommunityBreadcrumbs";
import { CommunityNotFound } from "./CommunityNotFound";

export type CommunityDetailViewProps = {
  communityId: string;
  registry?: CommunityRegistry;
};

export function CommunityDetailView({
  communityId,
  registry,
}: CommunityDetailViewProps) {
  const resolution = useRegistryCommunity(communityId, registry);

  if (resolution.status === "loading") {
    return <p className="p-6 text-sm text-slate-400">Loading community…</p>;
  }
  if (resolution.status === "error") {
    return (
      <p role="alert" className="p-6 text-sm text-rose-300">
        {resolution.error}
      </p>
    );
  }
  if (resolution.result.status !== "found") {
    return <CommunityNotFound communityId={communityId} />;
  }

  return <CommunityDetailPanel community={resolution.result.community} />;
}

function CommunityDetailPanel({ community }: { community: Community }) {
  const displayName =
    community.metadata?.name ??
    `Community ${community.record.id.slice(0, 8)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <CommunityBreadcrumbs
        communityId={community.record.id}
        communityName={displayName}
      />

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-100">{displayName}</h1>
        {community.status && community.status !== "active" ? (
          <span
            data-testid="community-status-badge"
            data-status={community.status}
            className={`inline-flex shrink-0 items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${
              community.status === "paused"
                ? "border-amber-800/80 bg-amber-950/50 text-amber-200"
                : "border-slate-700 bg-slate-900/80 text-slate-400"
            }`}
          >
            {community.status === "paused" ? "Paused" : "Archived"}
          </span>
        ) : null}
      </div>

      {community.status === "paused" && (
        <div
          role="status"
          data-testid="community-paused-notice"
          className="mt-3 rounded-lg border border-amber-800/70 bg-amber-950/40 p-4 text-sm text-amber-200"
        >
          <span className="font-semibold">Community paused:</span> Write actions including minting membership NFTs and creating proposals are currently suspended. Read paths and history remain fully accessible.
        </div>
      )}

      {community.status === "archived" && (
        <div
          role="status"
          data-testid="community-archived-notice"
          className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300"
        >
          <span className="font-semibold">Community archived:</span> This community has been archived. All governance and minting actions are permanently closed.
        </div>
      )}

      {community.metadata && (
        <p className="mt-2 text-slate-400">{community.metadata.description}</p>
      )}
      {community.metadataError && (
        <p className="mt-2 rounded-lg border border-amber-800/60 bg-amber-950/50 p-3 text-sm text-amber-200">
          Community details are temporarily unavailable, but on-chain data below is
          still accurate.
        </p>
      )}

      <dl className="mt-6 grid gap-3 rounded-xl border border-slate-800 bg-[#151b2b] p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Community ID</dt>
          <dd className="break-all font-mono text-slate-100">{community.record.id}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Governor contract</dt>
          <dd className="break-all font-mono text-slate-100">
            {community.record.governorContract}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">NFT contract</dt>
          <dd className="break-all font-mono text-slate-100">
            {community.record.nftContract}
          </dd>
        </div>
      </dl>

      <AppLinkButton
        href={`/community/${community.record.id}/proposals`}
        tone="primary"
        className="mt-6"
      >
        View proposals
      </AppLinkButton>
    </div>
  );
}
