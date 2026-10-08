import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ProposalState } from "@/lib/proposalState";
import {
  ALL_PROPOSAL_STATES,
  buildProposalStateUrl,
  parseProposalStateQuery,
  readProposalStateFromQuery,
  serializeProposalStateQuery,
  syncProposalStateToUrl,
} from "./proposal-state-query";

describe("proposal-state-query", () => {
  describe("parseProposalStateQuery", () => {
    it("falls back to 'all' for missing or empty inputs", () => {
      expect(parseProposalStateQuery(null)).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery(undefined)).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("   ")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("all")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("ALL")).toBe(ALL_PROPOSAL_STATES);
    });

    it("parses valid proposal state slug names case-insensitively", () => {
      expect(parseProposalStateQuery("pending")).toBe(ProposalState.Pending);
      expect(parseProposalStateQuery("Pending")).toBe(ProposalState.Pending);
      expect(parseProposalStateQuery("active")).toBe(ProposalState.Active);
      expect(parseProposalStateQuery("Active")).toBe(ProposalState.Active);
      expect(parseProposalStateQuery("ACTIVE")).toBe(ProposalState.Active);
      expect(parseProposalStateQuery("defeated")).toBe(ProposalState.Defeated);
      expect(parseProposalStateQuery("canceled")).toBe(ProposalState.Canceled);
      expect(parseProposalStateQuery("cancelled")).toBe(ProposalState.Canceled);
      expect(parseProposalStateQuery("succeeded")).toBe(ProposalState.Succeeded);
      expect(parseProposalStateQuery("queued")).toBe(ProposalState.Queued);
      expect(parseProposalStateQuery("expired")).toBe(ProposalState.Expired);
      expect(parseProposalStateQuery("executed")).toBe(ProposalState.Executed);
    });

    it("parses valid numeric state strings", () => {
      expect(parseProposalStateQuery("0")).toBe(ProposalState.Pending);
      expect(parseProposalStateQuery("1")).toBe(ProposalState.Active);
      expect(parseProposalStateQuery("4")).toBe(ProposalState.Succeeded);
      expect(parseProposalStateQuery("7")).toBe(ProposalState.Executed);
    });

    it("falls back to 'all' on unknown or malformed strings without throwing", () => {
      expect(parseProposalStateQuery("unknown")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("8")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("-1")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("999")).toBe(ALL_PROPOSAL_STATES);
      expect(parseProposalStateQuery("<script>alert(1)</script>")).toBe(
        ALL_PROPOSAL_STATES,
      );
    });
  });

  describe("serializeProposalStateQuery", () => {
    it("returns null for 'all'", () => {
      expect(serializeProposalStateQuery(ALL_PROPOSAL_STATES)).toBeNull();
    });

    it("serializes ProposalState into standard slugs", () => {
      expect(serializeProposalStateQuery(ProposalState.Active)).toBe("active");
      expect(serializeProposalStateQuery(ProposalState.Succeeded)).toBe("succeeded");
      expect(serializeProposalStateQuery(ProposalState.Pending)).toBe("pending");
      expect(serializeProposalStateQuery(ProposalState.Defeated)).toBe("defeated");
      expect(serializeProposalStateQuery(ProposalState.Canceled)).toBe("canceled");
      expect(serializeProposalStateQuery(ProposalState.Queued)).toBe("queued");
      expect(serializeProposalStateQuery(ProposalState.Expired)).toBe("expired");
      expect(serializeProposalStateQuery(ProposalState.Executed)).toBe("executed");
    });
  });

  describe("buildProposalStateUrl", () => {
    it("adds state param to URL when filter is set", () => {
      expect(
        buildProposalStateUrl("/proposals", "", ProposalState.Active),
      ).toBe("/proposals?state=active");
    });

    it("removes state param when filter is 'all'", () => {
      expect(
        buildProposalStateUrl("/proposals", "?state=active", ALL_PROPOSAL_STATES),
      ).toBe("/proposals");
    });

    it("updates existing state param and preserves other parameters", () => {
      expect(
        buildProposalStateUrl(
          "/communities/123/proposals",
          "?page=2&state=pending&sort=desc",
          ProposalState.Succeeded,
        ),
      ).toBe("/communities/123/proposals?page=2&state=succeeded&sort=desc");
    });

    it("removes state param and keeps other parameters when clearing to 'all'", () => {
      expect(
        buildProposalStateUrl(
          "/communities/123/proposals",
          "?page=2&state=pending&sort=desc",
          ALL_PROPOSAL_STATES,
        ),
      ).toBe("/communities/123/proposals?page=2&sort=desc");
    });
  });

  describe("readProposalStateFromQuery and syncProposalStateToUrl", () => {
    beforeEach(() => {
      window.history.replaceState({}, "", "/proposals");
    });

    afterEach(() => {
      window.history.replaceState({}, "", "/proposals");
    });

    it("reads state filter from custom query string", () => {
      expect(readProposalStateFromQuery("?state=succeeded")).toBe(
        ProposalState.Succeeded,
      );
      expect(readProposalStateFromQuery("?state=invalid")).toBe(
        ALL_PROPOSAL_STATES,
      );
    });

    it("reads state filter from current window location", () => {
      window.history.replaceState({}, "", "/proposals?state=active");
      expect(readProposalStateFromQuery()).toBe(ProposalState.Active);
    });

    it("syncs state filter to URL using replaceState", () => {
      syncProposalStateToUrl(ProposalState.Queued);
      expect(window.location.search).toBe("?state=queued");

      syncProposalStateToUrl(ALL_PROPOSAL_STATES);
      expect(window.location.search).toBe("");
    });
  });
});
