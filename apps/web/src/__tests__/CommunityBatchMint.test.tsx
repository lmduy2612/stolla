import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommunityBatchMintForm } from "@/components/community/CommunityBatchMintForm";
import CommunityPage from "@/app/(app)/community/page";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  createNftClient: vi.fn(),
  createReadOnlyNftClient: vi.fn(),
  runCommunityRefresh: vi.fn(),
  getE2EBridge: vi.fn(),
  pinFile: vi.fn(),
  pinJson: vi.fn(),
}));

vi.mock("@/lib/e2eMock", () => ({
  getE2EBridge: mocks.getE2EBridge,
}));

vi.mock("@/context/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));

vi.mock("@/lib/contracts", () => ({
  createNftClient: mocks.createNftClient,
  createReadOnlyNftClient: mocks.createReadOnlyNftClient,
}));

vi.mock("@/lib/stellar", () => ({
  contractIds: { nft: "CNFT", governor: "CGOV" },
}));

vi.mock("@/app/(app)/community/community-data.mjs", () => ({
  loadCommunityData: vi.fn(),
  runCommunityRefresh: mocks.runCommunityRefresh,
}));

const VALID_G1 = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const VALID_G2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const VALID_G3 = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

describe("CommunityBatchMint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/community");

    mocks.pinFile.mockImplementation(async (file: File) => ({
      cid: "bafyimage",
      uri: "ipfs://bafyimage",
      size: file.size,
    }));

    mocks.pinJson.mockImplementation(async (bytes: Uint8Array) => ({
      cid: "bafytoken",
      uri: "ipfs://bafytoken",
      size: bytes.length,
    }));

    mocks.getE2EBridge.mockReturnValue({
      pin: { pinFile: mocks.pinFile, pinJson: mocks.pinJson },
    });

    mocks.useWallet.mockReturnValue({
      address: "GWALLET",
      signTransaction: vi.fn(),
      isConnecting: false,
    });

    mocks.runCommunityRefresh.mockImplementation(
      async (
        _load: unknown,
        callbacks: {
          onStart: () => void;
          onSuccess: (data: {
            name: string;
            symbol: string;
            balance: number;
            votes: string;
          }) => void;
        },
      ) => {
        callbacks.onStart();
        callbacks.onSuccess({
          name: "Stolla",
          symbol: "STL",
          balance: 1,
          votes: "0",
        });
        return true;
      },
    );
  });

  describe("CommunityPage integration and mode toggle", () => {
    it("renders Single recipient by default and allows toggling to Batch mint", async () => {
      render(<CommunityPage />);

      expect(screen.getByRole("button", { name: "Single recipient" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Batch mint" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // Single recipient input is visible
      expect(screen.getByLabelText(/Recipient address/i)).toBeInTheDocument();

      // Toggle to Batch mint
      fireEvent.click(screen.getByRole("button", { name: "Batch mint" }));

      expect(screen.getByRole("button", { name: "Batch mint" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByLabelText(/Recipient Addresses/i)).toBeInTheDocument();
      expect(screen.getByText(/Shared Token Metadata/i)).toBeInTheDocument();
    });
  });

  describe("CommunityBatchMintForm component", () => {
    it("validates recipients and blocks submission when addresses are invalid or duplicated", async () => {
      render(
        <CommunityBatchMintForm
          nftContractId="CNFT"
          pinClient={{ pinFile: mocks.pinFile, pinJson: mocks.pinJson }}
        />,
      );

      const submitButton = screen.getByRole("button", { name: /Batch mint/i });
      expect(submitButton).toBeDisabled();

      const textarea = screen.getByLabelText(/Recipient Addresses/i);

      // Invalid input
      fireEvent.change(textarea, {
        target: { value: `${VALID_G1}\nINVALID_ED25519\n${VALID_G1}` },
      });

      expect(screen.getByText(/Found 2 invalid or duplicate addresses/i)).toBeInTheDocument();
      expect(screen.getByText(/is not a valid 56-character Stellar public key/i)).toBeInTheDocument();
      expect(screen.getByText(/Duplicate address in batch/i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();

      // Fix input to valid
      fireEvent.change(textarea, {
        target: { value: `${VALID_G1}\n${VALID_G2}` },
      });

      expect(screen.queryByText(/Found.*invalid/i)).not.toBeInTheDocument();
      expect(screen.getByText("2 / 25 recipients")).toBeInTheDocument();
      expect(submitButton).toBeEnabled();
    });

    it("executes batch mint sequentially with upload-first metadata pinned once", async () => {
      const mockMint = vi.fn().mockImplementation(async ({ to }: { to: string }) => {
        return { result: to === VALID_G1 ? 1 : 2 };
      });

      mocks.createNftClient.mockReturnValue({
        mint: mockMint,
      });

      const onMintComplete = vi.fn();

      render(
        <CommunityBatchMintForm
          nftContractId="CNFT"
          onMintComplete={onMintComplete}
          pinClient={{ pinFile: mocks.pinFile, pinJson: mocks.pinJson }}
        />,
      );

      const textarea = screen.getByLabelText(/Recipient Addresses/i);
      fireEvent.change(textarea, {
        target: { value: `${VALID_G1}\n${VALID_G2}` },
      });

      // Customize metadata
      fireEvent.change(screen.getByLabelText(/Display Name/i), {
        target: { value: "Wave Member" },
      });
      fireEvent.change(screen.getByLabelText(/^Description/i), {
        target: { value: "Batch minted membership" },
      });

      const submitButton = screen.getByRole("button", { name: "Batch mint 2 NFTs" });
      expect(submitButton).toBeEnabled();

      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Batch Mint Complete!/i)).toBeInTheDocument();
      });

      // Pinned only once for the whole batch
      expect(mocks.pinJson).toHaveBeenCalledTimes(1);

      // Contract mint called sequentially for each recipient
      expect(mockMint).toHaveBeenCalledTimes(2);
      expect(mockMint).toHaveBeenNthCalledWith(1, {
        to: VALID_G1,
        token_uri: "ipfs://bafytoken",
      });
      expect(mockMint).toHaveBeenNthCalledWith(2, {
        to: VALID_G2,
        token_uri: "ipfs://bafytoken",
      });

      expect(screen.getByText(/Successfully minted 2 membership NFTs/i)).toBeInTheDocument();
      expect(onMintComplete).toHaveBeenCalledTimes(1);
    });

    it("halts on first failure and offers one-click resume for failed and pending recipients", async () => {
      const mockMint = vi
        .fn()
        .mockResolvedValueOnce({ result: 1 })
        .mockRejectedValueOnce(new Error("Transaction simulation reverted: insf_funds"));

      mocks.createNftClient.mockReturnValue({
        mint: mockMint,
      });

      render(
        <CommunityBatchMintForm
          nftContractId="CNFT"
          pinClient={{ pinFile: mocks.pinFile, pinJson: mocks.pinJson }}
        />,
      );

      const textarea = screen.getByLabelText(/Recipient Addresses/i);
      fireEvent.change(textarea, {
        target: { value: `${VALID_G1}\n${VALID_G2}\n${VALID_G3}` },
      });

      const submitButton = screen.getByRole("button", { name: "Batch mint 3 NFTs" });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Batch Mint Stopped on Failure/i)).toBeInTheDocument();
      });

      // Only 2 attempts made: G1 succeeded, G2 failed, G3 never attempted
      expect(mockMint).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Transaction simulation reverted: insf_funds/i)).toBeInTheDocument();

      // Succeeded breakdown
      expect(screen.getByText(`✓ ${VALID_G1}`)).toBeInTheDocument();

      // Failed recipient and unattempted breakdown
      expect(screen.getByText(VALID_G2)).toBeInTheDocument();
      expect(screen.getByText(`• ${VALID_G3}`)).toBeInTheDocument();

      // Resume button
      const resumeButton = screen.getByRole("button", { name: "Resume remaining (2)" });
      expect(resumeButton).toBeInTheDocument();

      // Click resume button
      fireEvent.click(resumeButton);

      // Textarea now contains only failed (G2) and pending (G3)
      expect(screen.getByLabelText(/Recipient Addresses/i)).toHaveValue(
        `${VALID_G2}\n${VALID_G3}`,
      );
      expect(screen.queryByText(/Batch Mint Stopped on Failure/i)).not.toBeInTheDocument();
    });
  });
});
