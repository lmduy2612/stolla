import { describe, expect, it } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import {
  NETWORKS,
  MAINNET_RUNBOOK_PATH,
  MAINNET_RUNBOOK_URL,
  NetworkCapabilityError,
  NetworkMismatchError,
  areMainnetWritesAllowed,
  buildNetworkCapabilities,
  compareNetworks,
  contractUrl,
  describeNetwork,
  findNetworkByPassphrase,
  listUnavailableCapabilities,
  requireNetworkCapability,
  transactionUrl,
} from "./network";
import { createNetworkCapabilitiesFixture } from "@/test-support/stellar/capabilities";

describe("describeNetwork", () => {
  it("recognizes registered networks by passphrase", () => {
    expect(describeNetwork(Networks.TESTNET)).toEqual({
      id: "testnet",
      label: "Testnet",
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("keeps the wallet's own name for networks outside the registry", () => {
    expect(describeNetwork("Custom Network ; 2026", "Local")).toEqual({
      id: null,
      label: "Local",
      networkPassphrase: "Custom Network ; 2026",
    });
  });

  it("falls back to a generic label when the wallet reports no name", () => {
    expect(describeNetwork("Custom Network ; 2026").label).toBe(
      "Unrecognized network",
    );
  });
});

describe("compareNetworks", () => {
  it("reports unknown while the wallet network has not been read", () => {
    const comparison = compareNetworks(NETWORKS.testnet, null);
    expect(comparison.status).toBe("unknown");
  });

  it("matches identical passphrases", () => {
    const comparison = compareNetworks(
      NETWORKS.testnet,
      describeNetwork(Networks.TESTNET),
    );
    expect(comparison.status).toBe("match");
  });

  it("reports a mismatch with both networks named", () => {
    const comparison = compareNetworks(
      NETWORKS.testnet,
      describeNetwork(Networks.PUBLIC),
    );
    expect(comparison.status).toBe("mismatch");
    expect(comparison.expected.label).toBe("Testnet");
    expect(comparison.detected?.label).toBe("Mainnet");
  });
});

describe("explorer links", () => {
  it("uses the segment of the network it is given", () => {
    expect(transactionUrl(NETWORKS.testnet, "abc")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc",
    );
    expect(transactionUrl(NETWORKS.mainnet, "abc")).toBe(
      "https://stellar.expert/explorer/public/tx/abc",
    );
  });

  it("never shares a URL between two networks", () => {
    expect(contractUrl(NETWORKS.testnet, "C1")).not.toBe(
      contractUrl(NETWORKS.mainnet, "C1"),
    );
  });

  it("returns null when the network is not indexed or the value is empty", () => {
    expect(transactionUrl(NETWORKS.futurenet, "abc")).toBeNull();
    expect(contractUrl(NETWORKS.testnet, "")).toBeNull();
  });
});

describe("findNetworkByPassphrase", () => {
  it("returns null for an unknown passphrase", () => {
    expect(findNetworkByPassphrase("nope")).toBeNull();
  });
});

describe("NetworkMismatchError", () => {
  it("names both networks when the wallet network is known", () => {
    const error = new NetworkMismatchError(
      NETWORKS.testnet,
      describeNetwork(Networks.PUBLIC),
    );
    expect(error.message).toContain("Mainnet");
    expect(error.message).toContain("Testnet");
  });

  it("explains an unreadable wallet network", () => {
    const error = new NetworkMismatchError(NETWORKS.testnet, null);
    expect(error.message).toContain("Could not read the wallet network");
  });
});

describe("network capability matrix", () => {
  it("builds complete testnet fixtures through the production builder", () => {
    const capabilities = createNetworkCapabilitiesFixture("testnet");
    expect(capabilities.network.networkPassphrase).toBe(Networks.TESTNET);
    expect(listUnavailableCapabilities(capabilities)).toEqual([]);
  });

  it("names missing factory, discovery, and mainnet write capabilities", () => {
    const capabilities = buildNetworkCapabilities("mainnet", {
      NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: "https://rpc.example",
    });
    expect(listUnavailableCapabilities(capabilities)).toEqual([
      "communityFactory",
      "legacyContracts",
      "proposalDiscovery",
      "mainnetWrites",
    ]);
    expect(() =>
      requireNetworkCapability(capabilities, "communityFactory"),
    ).toThrowError(NetworkCapabilityError);
    try {
      requireNetworkCapability(capabilities, "proposalDiscovery");
    } catch (error) {
      expect(error).toMatchObject({
        name: "NetworkCapabilityError",
        capability: "proposalDiscovery",
        networkId: "mainnet",
      });
    }
  });

  it("keeps invalid discovery ledgers unavailable", () => {
    const capabilities = createNetworkCapabilitiesFixture("testnet", {
      NEXT_PUBLIC_GOVERNOR_START_LEDGER: "0",
    });
    expect(capabilities.proposalDiscovery.available).toBe(false);
  });

  it("allows writes on testnet by default", () => {
    const capabilities = createNetworkCapabilitiesFixture("testnet");
    expect(capabilities.mainnetWrites).toEqual({
      available: true,
      allowed: true,
    });
    expect(areMainnetWritesAllowed(capabilities)).toBe(true);
    expect(requireNetworkCapability(capabilities, "mainnetWrites")).toEqual({
      available: true,
      allowed: true,
    });
  });

  it("blocks mainnet writes by default and references the runbook", () => {
    const capabilities = buildNetworkCapabilities("mainnet", {
      NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: "https://rpc.example",
    });
    expect(capabilities.mainnetWrites.available).toBe(false);
    expect(capabilities.mainnetWrites.allowed).toBe(false);
    if (!capabilities.mainnetWrites.available) {
      expect(capabilities.mainnetWrites.reason).toContain(MAINNET_RUNBOOK_PATH);
      expect(capabilities.mainnetWrites.requiredEnvironment).toContain(
        "NEXT_PUBLIC_ALLOW_MAINNET_WRITES",
      );
    }
    expect(areMainnetWritesAllowed(capabilities)).toBe(false);
    expect(() =>
      requireNetworkCapability(capabilities, "mainnetWrites"),
    ).toThrowError(NetworkCapabilityError);
  });

  it("enables mainnet writes with NEXT_PUBLIC_ALLOW_MAINNET_WRITES flag", () => {
    const capabilities = buildNetworkCapabilities("mainnet", {
      NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_ALLOW_MAINNET_WRITES: "true",
    });
    expect(capabilities.mainnetWrites).toEqual({
      available: true,
      allowed: true,
    });
    expect(areMainnetWritesAllowed(capabilities)).toBe(true);
    expect(listUnavailableCapabilities(capabilities)).not.toContain(
      "mainnetWrites",
    );
  });

  it("enables mainnet writes with ALLOW_MAINNET_WRITES=1 flag", () => {
    const capabilities = buildNetworkCapabilities("mainnet", {
      NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: "https://rpc.example",
      ALLOW_MAINNET_WRITES: "1",
    });
    expect(capabilities.mainnetWrites).toEqual({
      available: true,
      allowed: true,
    });
    expect(areMainnetWritesAllowed(capabilities)).toBe(true);
  });

  it("keeps mainnet writes blocked when flag is explicit false or invalid", () => {
    const capabilities = buildNetworkCapabilities("mainnet", {
      NEXT_PUBLIC_STELLAR_MAINNET_RPC_URL: "https://rpc.example",
      NEXT_PUBLIC_ALLOW_MAINNET_WRITES: "false",
    });
    expect(capabilities.mainnetWrites.available).toBe(false);
    expect(areMainnetWritesAllowed(capabilities)).toBe(false);
  });
});
