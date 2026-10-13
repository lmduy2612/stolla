"use client";

import { CrossCommunityActivityFeed } from "@/components/communities/CrossCommunityActivityFeed";
import { AppLinkButton } from "@/components/ui/AppLinkButton";

export default function CrossCommunityActivityPage() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-100">
            Governance Activity Feed
          </h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Active proposals and recent voting activity across the communities
            you belong to.
          </p>
        </div>
        <AppLinkButton
          href="/communities"
          tone="secondary"
          className="shrink-0 w-full sm:w-auto"
        >
          All communities
        </AppLinkButton>
      </div>

      <div className="mt-8">
        <CrossCommunityActivityFeed />
      </div>
    </div>
  );
}
