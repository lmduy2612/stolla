import type { CommunityMetadata } from "./types";

export type CommunityMetadataOverride = {
  metadata: CommunityMetadata;
  metadataUri: string;
  metadataHash: string;
  updatedAt: number;
};

const STORAGE_KEY = "stolla_community_metadata_overrides";

const memoryOverrides = new Map<string, CommunityMetadataOverride>();

/**
 * Returns any locally cached metadata override for the given community ID.
 */
export function getCommunityMetadataOverride(
  communityId: string,
): CommunityMetadataOverride | null {
  const normalizedId = communityId.toLowerCase();
  if (memoryOverrides.has(normalizedId)) {
    return memoryOverrides.get(normalizedId)!;
  }

  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, CommunityMetadataOverride>;
    const found = parsed[normalizedId];
    if (found) {
      memoryOverrides.set(normalizedId, found);
      return found;
    }
  } catch {
    // Ignore parse/storage errors
  }

  return null;
}

/**
 * Stores a metadata override for a community so views refresh without redeploying.
 */
export function saveCommunityMetadataOverride(
  communityId: string,
  override: Omit<CommunityMetadataOverride, "updatedAt">,
): void {
  const normalizedId = communityId.toLowerCase();
  const fullOverride: CommunityMetadataOverride = {
    ...override,
    updatedAt: Date.now(),
  };

  memoryOverrides.set(normalizedId, fullOverride);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const store: Record<string, CommunityMetadataOverride> = raw ? JSON.parse(raw) : {};
      store[normalizedId] = fullOverride;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignore quota/storage errors
    }
  }
}

/**
 * Clears an override for a community.
 */
export function clearCommunityMetadataOverride(communityId: string): void {
  const normalizedId = communityId.toLowerCase();
  memoryOverrides.delete(normalizedId);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const store: Record<string, CommunityMetadataOverride> = JSON.parse(raw);
        delete store[normalizedId];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      }
    } catch {
      // Ignore
    }
  }
}
