"use client";

import { useParams } from "next/navigation";
import { CommunitySettingsView } from "@/components/community/CommunitySettingsView";

export default function CommunitySettingsPage() {
  const params = useParams<{ id: string }>();
  return <CommunitySettingsView communityId={params.id} />;
}
