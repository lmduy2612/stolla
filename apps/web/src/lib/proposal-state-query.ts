import {
  ProposalState,
  PROPOSAL_STATE_LABELS,
} from "@/lib/proposalState";

export const PROPOSAL_STATE_QUERY_PARAM = "state";
export const ALL_PROPOSAL_STATES = "all" as const;

export type ProposalStateFilter = typeof ALL_PROPOSAL_STATES | ProposalState;

const STATE_SLUGS: Record<ProposalState, string> = {
  [ProposalState.Pending]: "pending",
  [ProposalState.Active]: "active",
  [ProposalState.Defeated]: "defeated",
  [ProposalState.Canceled]: "canceled",
  [ProposalState.Succeeded]: "succeeded",
  [ProposalState.Queued]: "queued",
  [ProposalState.Expired]: "expired",
  [ProposalState.Executed]: "executed",
};

const SLUG_TO_STATE: Record<string, ProposalState> = {
  pending: ProposalState.Pending,
  active: ProposalState.Active,
  defeated: ProposalState.Defeated,
  canceled: ProposalState.Canceled,
  cancelled: ProposalState.Canceled,
  succeeded: ProposalState.Succeeded,
  queued: ProposalState.Queued,
  expired: ProposalState.Expired,
  executed: ProposalState.Executed,
};

/**
 * Parses a raw query string or parameter value into a valid ProposalState or "all".
 * Falls back safely to "all" on any unknown, malformed, or missing value.
 */
export function parseProposalStateQuery(
  raw: string | null | undefined,
): ProposalStateFilter {
  if (!raw) return ALL_PROPOSAL_STATES;

  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === ALL_PROPOSAL_STATES) {
    return ALL_PROPOSAL_STATES;
  }

  if (normalized in SLUG_TO_STATE) {
    return SLUG_TO_STATE[normalized];
  }

  if (/^\d+$/.test(normalized)) {
    const num = Number(normalized);
    if (num in PROPOSAL_STATE_LABELS) {
      return num as ProposalState;
    }
  }

  return ALL_PROPOSAL_STATES;
}

/**
 * Serializes a ProposalStateFilter into a query parameter string value,
 * or null if the filter is "all" (which should be omitted from the URL).
 */
export function serializeProposalStateQuery(
  filter: ProposalStateFilter,
): string | null {
  if (filter === ALL_PROPOSAL_STATES) return null;
  return STATE_SLUGS[filter] ?? null;
}

/**
 * Reads the proposal state filter from a search string or window.location.search.
 */
export function readProposalStateFromQuery(
  searchString?: string,
): ProposalStateFilter {
  const search =
    searchString !== undefined
      ? searchString
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  const params = new URLSearchParams(search);
  return parseProposalStateQuery(params.get(PROPOSAL_STATE_QUERY_PARAM));
}

/**
 * Updates or cleans the state filter parameter in a given URL or query string,
 * preserving any existing parameters.
 */
export function buildProposalStateUrl(
  pathname: string,
  search: string,
  filter: ProposalStateFilter,
): string {
  const params = new URLSearchParams(search);
  const serialized = serializeProposalStateQuery(filter);

  if (serialized) {
    params.set(PROPOSAL_STATE_QUERY_PARAM, serialized);
  } else {
    params.delete(PROPOSAL_STATE_QUERY_PARAM);
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/**
 * Syncs the current proposal state filter to window.history.
 */
export function syncProposalStateToUrl(
  filter: ProposalStateFilter,
  mode: "push" | "replace" = "replace",
): void {
  if (typeof window === "undefined") return;

  const nextUrl = buildProposalStateUrl(
    window.location.pathname,
    window.location.search,
    filter,
  );

  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl !== currentUrl) {
    window.history[mode === "push" ? "pushState" : "replaceState"](
      {},
      "",
      nextUrl,
    );
  }
}
