import { StrKey } from "@stellar/stellar-sdk";

export const BATCH_MINT_MAX_RECIPIENTS = 25;

export type BatchRecipientItem = {
  raw: string;
  address: string;
  lineNumber: number;
  error?: string;
  isDuplicate?: boolean;
};

export type BatchParseResult = {
  items: BatchRecipientItem[];
  validAddresses: string[];
  invalidItems: BatchRecipientItem[];
  duplicates: string[];
  exceedsCap: boolean;
  errorMessage: string | null;
};

/**
 * Parses and validates a batch recipient string (delimited by newlines or commas).
 * Enforces valid Ed25519 public key format, uniqueness, and a 25-recipient cap.
 */
export function parseBatchRecipients(input: string): BatchParseResult {
  const lines = input.split(/[\r\n,]+/);
  const items: BatchRecipientItem[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const validAddresses: string[] = [];
  const invalidItems: BatchRecipientItem[] = [];

  let lineNumber = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    lineNumber++;

    const isValid = StrKey.isValidEd25519PublicKey(trimmed);
    if (!isValid) {
      const item: BatchRecipientItem = {
        raw: trimmed,
        address: trimmed,
        lineNumber,
        error: `"${trimmed.slice(0, 10)}${trimmed.length > 10 ? "…" : ""}" is not a valid 56-character Stellar public key (G…).`,
      };
      items.push(item);
      invalidItems.push(item);
      continue;
    }

    const isDuplicate = seen.has(trimmed);
    if (isDuplicate) {
      duplicates.add(trimmed);
      const item: BatchRecipientItem = {
        raw: trimmed,
        address: trimmed,
        lineNumber,
        error: "Duplicate address in batch.",
        isDuplicate: true,
      };
      items.push(item);
      invalidItems.push(item);
      continue;
    }

    seen.add(trimmed);
    validAddresses.push(trimmed);
    items.push({
      raw: trimmed,
      address: trimmed,
      lineNumber,
    });
  }

  const exceedsCap = validAddresses.length > BATCH_MINT_MAX_RECIPIENTS;
  let errorMessage: string | null = null;

  if (items.length === 0) {
    errorMessage = "Enter at least one recipient address.";
  } else if (invalidItems.length > 0) {
    errorMessage = `Found ${invalidItems.length} invalid or duplicate address${invalidItems.length === 1 ? "" : "es"}. Correct them before proceeding.`;
  } else if (exceedsCap) {
    errorMessage = `Batch size (${validAddresses.length}) exceeds the maximum cap of ${BATCH_MINT_MAX_RECIPIENTS} recipients.`;
  }

  return {
    items,
    validAddresses,
    invalidItems,
    duplicates: Array.from(duplicates),
    exceedsCap,
    errorMessage,
  };
}

export type BatchMintProgress = {
  total: number;
  completed: number;
  currentAddress: string;
};

export type BatchMintExecutionResult = {
  succeeded: { address: string; tokenId?: number }[];
  failed: { address: string; error: string } | null;
  pending: string[];
};

export type MintFunction = (
  recipient: string,
  tokenUri: string,
) => Promise<number | undefined | null>;

/**
 * Sequentially executes mints for an array of valid addresses.
 * Halts on first hard failure and reports succeeded vs failed vs pending.
 */
export async function executeBatchMint(
  addresses: string[],
  tokenUri: string,
  mintFn: MintFunction,
  onProgress?: (progress: BatchMintProgress) => void,
): Promise<BatchMintExecutionResult> {
  const succeeded: { address: string; tokenId?: number }[] = [];
  let failed: { address: string; error: string } | null = null;
  let pending: string[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    onProgress?.({
      total: addresses.length,
      completed: succeeded.length,
      currentAddress: address,
    });

    try {
      const tokenIdResult = await mintFn(address, tokenUri);
      succeeded.push({
        address,
        tokenId: typeof tokenIdResult === "number" ? tokenIdResult : undefined,
      });
    } catch (err) {
      failed = {
        address,
        error: err instanceof Error ? err.message : String(err),
      };
      pending = addresses.slice(i + 1);
      break;
    }
  }

  return {
    succeeded,
    failed,
    pending,
  };
}
