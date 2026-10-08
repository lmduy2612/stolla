"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppButton } from "@/components/ui/AppButton";
import { AppLinkButton } from "@/components/ui/AppLinkButton";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { useWallet } from "@/context/WalletProvider";
import { useCommunityRegistry } from "@/lib/community/CommunityRegistryProvider";
import type { Community, CommunityDetailResult, CommunityRegistry } from "@/lib/community/types";
import {
  COMMUNITY_LIMITS,
  utf8Length,
  isHttpsUrl,
} from "@/lib/community/schema";
import {
  buildCommunityMetadataDocument,
  computeMetadataHash,
  encodeCommunityMetadata,
} from "@/lib/community/metadataDocument";
import { saveCommunityMetadataOverride } from "@/lib/community/metadataOverrides";
import { createIpfsPinClient, type IpfsPinClient, validateImageFile } from "@/lib/ipfs/pin";
import { IPFS_UPLOAD_LIMITS } from "@/lib/ipfs/limits";

const LOGO_ACCEPT = IPFS_UPLOAD_LIMITS.imageTypes.join(",");

type FormDraft = {
  name: string;
  description: string;
  externalLinkLabel: string;
  externalLinkUrl: string;
};

type FormErrors = Partial<Record<keyof FormDraft | "logo", string>>;

export type CommunitySettingsViewProps = {
  communityId: string;
  registry?: CommunityRegistry;
  pinClient?: IpfsPinClient;
};

export function CommunitySettingsView({
  communityId,
  registry: registryProp,
  pinClient: customPinClient,
}: CommunitySettingsViewProps) {
  const defaultRegistry = useCommunityRegistry();
  const registry = registryProp ?? defaultRegistry;
  const pinClient = useMemo(() => customPinClient ?? createIpfsPinClient(), [customPinClient]);
  const { address, connect, isConnecting } = useWallet();

  const [communityResult, setCommunityResult] = useState<CommunityDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<FormDraft>({
    name: "",
    description: "",
    externalLinkLabel: "",
    externalLinkUrl: "",
  });
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const [previewJson, setPreviewJson] = useState<string>("");
  const [previewHash, setPreviewHash] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadCommunity = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await registry.get(communityId);
      setCommunityResult(result);
      if (result.status === "found") {
        const meta = result.community.metadata;
        const firstLink = meta?.externalLinks?.[0];
        setDraft({
          name: meta?.name ?? "",
          description: meta?.description ?? "",
          externalLinkLabel: firstLink?.label ?? "",
          externalLinkUrl: firstLink?.url ?? "",
        });
        setCurrentLogo(meta?.logo ?? null);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "The community record could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [communityId, registry]);

  useEffect(() => {
    void loadCommunity();
  }, [loadCommunity]);

  // Compute live preview of community.json document and SHA-256 hash
  useEffect(() => {
    let cancelled = false;
    async function updatePreview() {
      const doc = buildCommunityMetadataDocument(
        {
          name: draft.name,
          description: draft.description,
          externalLinkLabel: draft.externalLinkLabel,
          externalLinkUrl: draft.externalLinkUrl,
        },
        logoFile ? "ipfs://[pending-upload]" : currentLogo ?? undefined,
      );
      const encoded = encodeCommunityMetadata(doc);
      const hash = await computeMetadataHash(encoded);
      if (!cancelled) {
        setPreviewJson(JSON.stringify(doc, null, 2));
        setPreviewHash(hash);
      }
    }
    void updatePreview();
    return () => {
      cancelled = true;
    };
  }, [draft, logoFile, currentLogo]);

  function handleDraftChange(
    field: keyof FormDraft,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setDraft((prev) => ({ ...prev, [field]: event.target.value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setPinError(null);
    setSuccessMessage(null);
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setLogoFile(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setErrors((prev) => ({ ...prev, logo: validationError }));
      return;
    }
    setErrors((prev) => ({ ...prev, logo: undefined }));
    setLogoFile(file);
    setPinError(null);
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};
    const name = draft.name.trim();
    const description = draft.description.trim();

    if (!name) {
      nextErrors.name = "Enter a community name.";
    } else if (utf8Length(draft.name) > COMMUNITY_LIMITS.nameBytes) {
      nextErrors.name = `Use at most ${COMMUNITY_LIMITS.nameBytes} UTF-8 bytes.`;
    }

    if (!description) {
      nextErrors.description = "Enter a description.";
    } else if (utf8Length(draft.description) > COMMUNITY_LIMITS.descriptionBytes) {
      nextErrors.description = `Use at most ${COMMUNITY_LIMITS.descriptionBytes} UTF-8 bytes.`;
    }

    if (draft.externalLinkLabel.trim() && !draft.externalLinkUrl.trim()) {
      nextErrors.externalLinkUrl = "Enter a URL for this external link.";
    } else if (draft.externalLinkUrl.trim() && !isHttpsUrl(draft.externalLinkUrl.trim())) {
      nextErrors.externalLinkUrl = "Provide a valid https:// URL.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setPinError(null);
    setSuccessMessage(null);

    try {
      let logoUri = currentLogo ?? undefined;
      if (logoFile) {
        const pinFileResult = await pinClient.pinFile(logoFile);
        logoUri = pinFileResult.uri;
      }

      const updatedDoc = buildCommunityMetadataDocument(
        {
          name: draft.name,
          description: draft.description,
          externalLinkLabel: draft.externalLinkLabel,
          externalLinkUrl: draft.externalLinkUrl,
        },
        logoUri,
      );

      const encoded = encodeCommunityMetadata(updatedDoc);
      const hash = await computeMetadataHash(encoded);
      const pinJsonResult = await pinClient.pinJson(encoded, "community.json");

      saveCommunityMetadataOverride(communityId, {
        metadata: updatedDoc,
        metadataUri: pinJsonResult.uri,
        metadataHash: hash,
      });

      setCurrentLogo(logoUri ?? null);
      setLogoFile(null);
      setSuccessMessage(
        "Community metadata updated successfully! Community details will now reflect these changes.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPinError(
        message || "Failed to pin metadata to IPFS. Please retry your update.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <LiveStatus className="sr-only">Loading community settings…</LiveStatus>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-12 w-full" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <section
          role="alert"
          className="rounded-xl border border-rose-800/70 bg-rose-950/40 p-5 text-rose-200"
        >
          <h1 className="text-xl font-semibold text-rose-100">
            Settings could not be loaded
          </h1>
          <p className="mt-2 text-sm">{loadError}</p>
          <AppButton
            tone="danger"
            onClick={() => void loadCommunity()}
            className="mt-4"
          >
            Retry loading
          </AppButton>
        </section>
      </div>
    );
  }

  if (!communityResult || communityResult.status !== "found") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <section className="rounded-xl border border-slate-800 bg-[#151b2b] p-6 text-slate-100">
          <h1 className="text-xl font-semibold">Community not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            The requested community record was not found or is malformed.
          </p>
          <AppLinkButton href="/communities" tone="primary" className="mt-4">
            Browse communities
          </AppLinkButton>
        </section>
      </div>
    );
  }

  const community: Community = communityResult.community;
  const ownerAddress = community.record.communityOwner;
  const communityName = community.metadata?.name ?? `Community ${community.record.id.slice(0, 8)}`;

  // Wallet and Owner Gate Checks
  if (!address) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
          <Link href="/communities" className="hover:text-indigo-300">
            Communities
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/communities/${community.record.id}`} className="hover:text-indigo-300">
            {communityName}
          </Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">Settings</span>
        </nav>

        <section
          role="region"
          aria-labelledby="connect-gate-title"
          className="mt-6 rounded-xl border border-slate-800 bg-[#151b2b] p-6 text-slate-100"
        >
          <h1 id="connect-gate-title" className="text-xl font-semibold">
            Connect wallet to manage settings
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Settings are restricted to the registered owner of this community. Connect your wallet to verify ownership.
          </p>
          <div className="mt-4">
            <AppButton
              tone="primary"
              onClick={() => void connect()}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </AppButton>
          </div>
        </section>
      </div>
    );
  }

  const isOwner = address.toLowerCase() === ownerAddress.toLowerCase();
  if (!isOwner) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
          <Link href="/communities" className="hover:text-indigo-300">
            Communities
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/communities/${community.record.id}`} className="hover:text-indigo-300">
            {communityName}
          </Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">Settings</span>
        </nav>

        <section
          role="alert"
          aria-labelledby="unauthorized-title"
          className="mt-6 rounded-xl border border-rose-800/70 bg-rose-950/40 p-6 text-rose-100"
        >
          <h1 id="unauthorized-title" className="text-xl font-semibold">
            Unauthorized
          </h1>
          <p className="mt-2 text-sm text-rose-200">
            You are not authorized to edit settings for this community. Only the community owner can modify metadata.
          </p>
          <dl className="mt-4 space-y-2 text-xs">
            <div>
              <dt className="text-rose-300">Registered Community Owner:</dt>
              <dd className="font-mono text-rose-100 break-all">{ownerAddress}</dd>
            </div>
            <div>
              <dt className="text-rose-300">Connected Wallet:</dt>
              <dd className="font-mono text-rose-100 break-all">{address}</dd>
            </div>
          </dl>
          <div className="mt-5">
            <AppLinkButton href={`/communities/${community.record.id}`} tone="secondary">
              Back to community
            </AppLinkButton>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-400">
        <Link href="/communities" className="hover:text-indigo-300">
          Communities
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/communities/${community.record.id}`} className="hover:text-indigo-300">
          {communityName}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Settings</span>
      </nav>

      <header className="mt-5">
        <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">
          Community Settings
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Update off-chain metadata, description, links, and branding for{" "}
          <strong className="text-slate-200">{communityName}</strong>.
        </p>
      </header>

      {successMessage && (
        <section
          role="status"
          className="mt-6 rounded-xl border border-emerald-800/70 bg-emerald-950/40 p-4 text-emerald-200"
        >
          <p className="font-medium text-emerald-100">{successMessage}</p>
          <div className="mt-3">
            <AppLinkButton href={`/communities/${community.record.id}`} tone="primary">
              View community detail
            </AppLinkButton>
          </div>
        </section>
      )}

      {pinError && (
        <section
          role="alert"
          className="mt-6 rounded-xl border border-rose-800/70 bg-rose-950/40 p-4 text-rose-200"
        >
          <p className="font-medium text-rose-100">Pinning failed</p>
          <p className="mt-1 text-sm">{pinError}</p>
          <div className="mt-3">
            <AppButton
              type="button"
              tone="danger"
              onClick={(e) => void handleSubmit(e as unknown as FormEvent)}
              disabled={isSubmitting}
            >
              Retry pinning metadata
            </AppButton>
          </div>
        </section>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className="rounded-xl border border-slate-800 bg-[#151b2b] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Metadata Details</h2>

          <div>
            <label htmlFor="settings-name" className="block text-sm font-medium text-slate-200">
              Community Name <span className="text-rose-400">*</span>
            </label>
            <input
              id="settings-name"
              type="text"
              value={draft.name}
              onChange={(e) => handleDraftChange("name", e)}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="e.g. Stellar Explorers"
              maxLength={COMMUNITY_LIMITS.nameBytes}
              required
            />
            {errors.name && <p className="mt-1 text-xs text-rose-400">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="settings-description" className="block text-sm font-medium text-slate-200">
              Description <span className="text-rose-400">*</span>
            </label>
            <textarea
              id="settings-description"
              rows={4}
              value={draft.description}
              onChange={(e) => handleDraftChange("description", e)}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              placeholder="Describe your community mission and governance…"
              maxLength={COMMUNITY_LIMITS.descriptionBytes}
              required
            />
            {errors.description && <p className="mt-1 text-xs text-rose-400">{errors.description}</p>}
          </div>

          <div>
            <label htmlFor="settings-logo" className="block text-sm font-medium text-slate-200">
              Community Logo
            </label>
            {currentLogo && !logoFile && (
              <p className="mt-1 text-xs text-slate-400">
                Current logo URI: <span className="font-mono text-slate-300">{currentLogo}</span>
              </p>
            )}
            <input
              id="settings-logo"
              type="file"
              accept={LOGO_ACCEPT}
              onChange={handleLogoChange}
              className="mt-2 block w-full text-sm text-slate-400 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
            />
            {errors.logo && <p className="mt-1 text-xs text-rose-400">{errors.logo}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="settings-link-label" className="block text-sm font-medium text-slate-200">
                External Link Label
              </label>
              <input
                id="settings-link-label"
                type="text"
                value={draft.externalLinkLabel}
                onChange={(e) => handleDraftChange("externalLinkLabel", e)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                placeholder="e.g. Website"
                maxLength={COMMUNITY_LIMITS.linkLabelBytes}
              />
            </div>
            <div>
              <label htmlFor="settings-link-url" className="block text-sm font-medium text-slate-200">
                External Link URL
              </label>
              <input
                id="settings-link-url"
                type="url"
                value={draft.externalLinkUrl}
                onChange={(e) => handleDraftChange("externalLinkUrl", e)}
                className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                placeholder="https://example.org"
              />
              {errors.externalLinkUrl && <p className="mt-1 text-xs text-rose-400">{errors.externalLinkUrl}</p>}
            </div>
          </div>
        </div>

        {/* Live Document & Hash Preview */}
        <div className="rounded-xl border border-slate-800 bg-[#151b2b] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Document & Commitment Preview</h2>
            <span className="rounded bg-slate-800 px-2 py-1 text-xs font-mono text-slate-400">
              community.json
            </span>
          </div>

          <div>
            <p className="text-xs text-slate-400">SHA-256 Metadata Hash Commitment:</p>
            <p className="mt-1 break-all font-mono text-xs text-indigo-300 bg-[#0b0f19] p-2 rounded-lg border border-slate-800">
              {previewHash || "Computing hash…"}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-400">Canonical Document JSON:</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs text-slate-300 font-mono">
              {previewJson}
            </pre>
          </div>
        </div>

        {/* Informational Callout regarding Factory contract upgrade path */}
        <aside className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs text-indigo-200 space-y-1">
          <p className="font-semibold text-indigo-100">Factory Metadata Upgrade Notice</p>
          <p>
            Stolla&apos;s current CommunityFactory V1 contract deploys immutable governance and initial metadata commitments.
            Updates pinned here are verified against exact SHA-256 hash digests and refreshed across Stolla app views.
            When the factory contract updater upgrade is finalized, owners will additionally be prompted to submit on-chain ledger updates.
          </p>
        </aside>

        <div className="flex items-center gap-3">
          <AppButton
            type="submit"
            tone="primary"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Pinning to IPFS…" : "Pin and save metadata"}
          </AppButton>
          <AppLinkButton
            href={`/communities/${community.record.id}`}
            tone="secondary"
          >
            Cancel
          </AppLinkButton>
        </div>
      </form>
    </div>
  );
}
