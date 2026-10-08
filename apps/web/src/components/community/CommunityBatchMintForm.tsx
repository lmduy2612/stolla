"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { AppButton } from "@/components/ui/AppButton";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { useWallet } from "@/context/WalletProvider";
import { createNftClient } from "@/lib/contracts";
import { createIpfsPinClient, type IpfsPinClient, validateImageFile } from "@/lib/ipfs/pin";
import { IPFS_UPLOAD_LIMITS } from "@/lib/ipfs/limits";
import {
  TOKEN_METADATA_LIMITS,
  validateTokenMetadataDraft,
  type TokenMetadataDraft,
  type TokenMetadataDraftErrors,
} from "@/lib/nft/tokenMetadata";
import {
  publishTokenMetadata,
  type PublishedTokenMetadata,
} from "@/lib/nft/publishTokenMetadata";
import {
  BATCH_MINT_MAX_RECIPIENTS,
  executeBatchMint,
  parseBatchRecipients,
  type BatchMintExecutionResult,
  type BatchMintProgress,
} from "@/lib/community/batchMint";

const IMAGE_ACCEPT = IPFS_UPLOAD_LIMITS.imageTypes.join(",");

export type CommunityBatchMintFormProps = {
  nftContractId: string;
  onMintComplete?: () => Promise<unknown> | unknown;
  pinClient?: IpfsPinClient;
};

export function CommunityBatchMintForm({
  nftContractId,
  onMintComplete,
  pinClient: customPinClient,
}: CommunityBatchMintFormProps) {
  const { address, signTransaction } = useWallet();
  const pin = useMemo(() => customPinClient ?? createIpfsPinClient(), [customPinClient]);

  const [recipientsInput, setRecipientsInput] = useState("");
  const [tokenDraft, setTokenDraft] = useState<TokenMetadataDraft>({
    name: "Community Member",
    description: "Community membership NFT",
  });
  const [tokenErrors, setTokenErrors] = useState<TokenMetadataDraftErrors>({});
  const [tokenImage, setTokenImage] = useState<File | null>(null);
  const [tokenImageError, setTokenImageError] = useState<string | null>(null);

  const [publishedToken, setPublishedToken] = useState<PublishedTokenMetadata | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [progress, setProgress] = useState<BatchMintProgress | null>(null);
  const [executionResult, setExecutionResult] = useState<BatchMintExecutionResult | null>(null);
  const [pinErrorMessage, setPinErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => parseBatchRecipients(recipientsInput),
    [recipientsInput],
  );

  function handleDraftChange(
    field: keyof TokenMetadataDraft,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setTokenDraft((prev) => ({ ...prev, [field]: event.target.value }));
    setPublishedToken(null);
    if (tokenErrors[field]) {
      setTokenErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPublishedToken(null);
    if (!file) {
      setTokenImage(null);
      setTokenImageError(null);
      return;
    }
    const rejection = validateImageFile(file);
    if (rejection) {
      setTokenImage(null);
      setTokenImageError(rejection);
      event.target.value = "";
      return;
    }
    setTokenImage(file);
    setTokenImageError(null);
  }

  async function handleBatchSubmit(event: FormEvent) {
    event.preventDefault();
    if (!address) return;

    // Validate metadata draft
    const metaErrors = validateTokenMetadataDraft(tokenDraft);
    setTokenErrors(metaErrors);
    if (Object.keys(metaErrors).length > 0 || tokenImageError) return;

    // Acceptance criterion: Invalid addresses blocked before any wallet prompt
    if (
      parseResult.validAddresses.length === 0 ||
      parseResult.invalidItems.length > 0 ||
      parseResult.exceedsCap
    ) {
      return;
    }

    setInFlight(true);
    setPinErrorMessage(null);
    setExecutionResult(null);
    setProgress(null);

    try {
      // Step 1: Pin shared metadata once if not already pinned
      let tokenUri = publishedToken?.tokenUri;
      if (!tokenUri) {
        const published = await publishTokenMetadata(tokenDraft, tokenImage, pin);
        setPublishedToken(published);
        tokenUri = published.tokenUri;
      }

      // Step 2: Sequential mint execution
      const client = createNftClient({
        publicKey: address,
        signTransaction,
        contractId: nftContractId,
      });

      const result = await executeBatchMint(
        parseResult.validAddresses,
        tokenUri,
        async (to, uri) => {
          const tx = await client.mint({ to, token_uri: uri });
          return tx.result;
        },
        (prog) => setProgress(prog),
      );

      setExecutionResult(result);

      if (result.succeeded.length > 0) {
        await onMintComplete?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPinErrorMessage(msg || "Failed to publish token metadata or initialize mint.");
    } finally {
      setInFlight(false);
      setProgress(null);
    }
  }

  function handleResumeRemaining() {
    if (!executionResult?.failed && executionResult?.pending.length === 0) return;
    const remainingToResume = [
      ...(executionResult?.failed ? [executionResult.failed.address] : []),
      ...(executionResult?.pending ?? []),
    ];
    setRecipientsInput(remainingToResume.join("\n"));
    setExecutionResult(null);
    setPinErrorMessage(null);
  }

  const canSubmit =
    Boolean(address) &&
    !inFlight &&
    parseResult.validAddresses.length > 0 &&
    parseResult.invalidItems.length === 0 &&
    !parseResult.exceedsCap &&
    Boolean(tokenDraft.name.trim()) &&
    Boolean(tokenDraft.description.trim()) &&
    !tokenImageError;

  return (
    <div className="space-y-6">
      {/* Execution Results Summary */}
      {executionResult && (
        <div className="space-y-3">
          {executionResult.succeeded.length > 0 && !executionResult.failed && (
            <section
              role="status"
              className="rounded-xl border border-emerald-800/70 bg-emerald-950/40 p-4 text-emerald-200"
            >
              <p className="font-semibold text-emerald-100">
                Batch Mint Complete!
              </p>
              <p className="mt-1 text-sm">
                Successfully minted {executionResult.succeeded.length} membership{" "}
                {executionResult.succeeded.length === 1 ? "NFT" : "NFTs"}.
              </p>
              <ul className="mt-2 space-y-1 text-xs font-mono text-emerald-300 max-h-32 overflow-y-auto">
                {executionResult.succeeded.map((item, idx) => (
                  <li key={idx} className="truncate">
                    ✓ {item.address} {item.tokenId !== undefined ? `(Token #${item.tokenId})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {executionResult.failed && (
            <section
              role="alert"
              className="rounded-xl border border-amber-800/70 bg-amber-950/40 p-4 text-amber-200"
            >
              <p className="font-semibold text-amber-100">
                Batch Mint Stopped on Failure
              </p>
              <p className="mt-1 text-sm">
                Minting failed on recipient:{" "}
                <span className="font-mono font-medium text-amber-200 break-all">
                  {executionResult.failed.address}
                </span>
              </p>
              <p className="mt-1 text-xs text-rose-300">
                Reason: {executionResult.failed.error}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
                <div>
                  <span className="font-semibold text-emerald-300">
                    Succeeded ({executionResult.succeeded.length}):
                  </span>
                  <ul className="mt-1 space-y-0.5 font-mono text-emerald-200 max-h-24 overflow-y-auto">
                    {executionResult.succeeded.map((item, i) => (
                      <li key={i} className="truncate">
                        ✓ {item.address}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="font-semibold text-amber-300">
                    Unattempted ({executionResult.pending.length}):
                  </span>
                  {executionResult.pending.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 font-mono text-amber-200 max-h-24 overflow-y-auto">
                      {executionResult.pending.map((addr, i) => (
                        <li key={i} className="truncate">
                          • {addr}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400 text-xs">None</p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <AppButton
                  type="button"
                  tone="primary"
                  onClick={handleResumeRemaining}
                >
                  Resume remaining (
                  {(executionResult.failed ? 1 : 0) + executionResult.pending.length}
                  )
                </AppButton>
              </div>
            </section>
          )}
        </div>
      )}

      {pinErrorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-800/70 bg-rose-950/40 p-4 text-rose-200 text-sm"
        >
          {pinErrorMessage}
        </div>
      )}

      {progress && (
        <LiveStatus className="rounded-xl border border-indigo-800/70 bg-indigo-950/40 p-4 text-indigo-200 text-sm">
          Minting {progress.completed + 1} of {progress.total} to{" "}
          <span className="font-mono font-medium">{progress.currentAddress}</span>…
        </LiveStatus>
      )}

      <form onSubmit={handleBatchSubmit} className="space-y-5">
        {/* Recipient Addresses Textarea */}
        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="batch-recipients"
              className="block text-sm font-medium text-slate-200"
            >
              Recipient Addresses <span className="text-rose-400">*</span>
            </label>
            <span
              className={`text-xs font-mono ${
                parseResult.exceedsCap || parseResult.invalidItems.length > 0
                  ? "text-rose-400"
                  : "text-slate-400"
              }`}
            >
              {parseResult.validAddresses.length} / {BATCH_MINT_MAX_RECIPIENTS} recipients
            </span>
          </div>

          <textarea
            id="batch-recipients"
            rows={5}
            value={recipientsInput}
            onChange={(e) => setRecipientsInput(e.target.value)}
            disabled={inFlight}
            placeholder="Paste G... addresses, one per line or separated by commas (max 25)"
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            required
          />

          {parseResult.errorMessage && recipientsInput.trim() && (
            <p role="alert" className="mt-1 text-xs text-rose-400">
              {parseResult.errorMessage}
            </p>
          )}

          {/* Per-row validation error list */}
          {parseResult.invalidItems.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-300 space-y-1 max-h-32 overflow-y-auto">
              <p className="font-semibold text-rose-200">Address errors detected:</p>
              {parseResult.invalidItems.map((item, idx) => (
                <p key={idx}>
                  Line {item.lineNumber}: {item.error}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Shared Metadata Fields */}
        <div className="rounded-lg border border-slate-800 bg-[#0b0f19] p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200">
            Shared Token Metadata (SEP-0050)
          </h3>
          <p className="text-xs text-slate-400">
            All NFTs minted in this batch will share this metadata and be pinned once to IPFS.
          </p>

          <div>
            <label
              htmlFor="batch-token-name"
              className="block text-xs font-medium text-slate-300"
            >
              Display Name <span className="text-rose-400">*</span>
            </label>
            <input
              id="batch-token-name"
              type="text"
              value={tokenDraft.name}
              onChange={(e) => handleDraftChange("name", e)}
              disabled={inFlight}
              maxLength={TOKEN_METADATA_LIMITS.nameBytes}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#151b2b] px-3 py-1.5 text-sm text-slate-100"
              required
            />
            {tokenErrors.name && (
              <p className="mt-1 text-xs text-rose-400">{tokenErrors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="batch-token-description"
              className="block text-xs font-medium text-slate-300"
            >
              Description <span className="text-rose-400">*</span>
            </label>
            <textarea
              id="batch-token-description"
              rows={2}
              value={tokenDraft.description}
              onChange={(e) => handleDraftChange("description", e)}
              disabled={inFlight}
              maxLength={TOKEN_METADATA_LIMITS.descriptionBytes}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#151b2b] px-3 py-1.5 text-sm text-slate-100"
              required
            />
            {tokenErrors.description && (
              <p className="mt-1 text-xs text-rose-400">
                {tokenErrors.description}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="batch-token-image"
              className="block text-xs font-medium text-slate-300"
            >
              Image (optional)
            </label>
            <input
              id="batch-token-image"
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={handleImageChange}
              disabled={inFlight}
              className="mt-1 block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1 file:text-xs file:text-slate-200"
            />
            {tokenImageError && (
              <p className="mt-1 text-xs text-rose-400">{tokenImageError}</p>
            )}
          </div>
        </div>

        <AppButton
          type="submit"
          tone="primary"
          disabled={!canSubmit}
          aria-busy={inFlight}
          className="w-full sm:w-auto"
        >
          {inFlight
            ? "Batch minting in progress…"
            : `Batch mint ${parseResult.validAddresses.length || ""} NFT${
                parseResult.validAddresses.length === 1 ? "" : "s"
              }`}
        </AppButton>
      </form>
    </div>
  );
}
