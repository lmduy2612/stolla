import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProposalState } from "@/lib/bindings/community-governor/src";
import { ProposalExecutionSection } from "@/components/proposal/ProposalExecutionSection";

describe("ProposalExecutionSection state machine UI", () => {
  it("renders signaling execute button when proposal succeeded in community without timelock", () => {
    const handleExecute = vi.fn();

    render(
      <ProposalExecutionSection
        proposalId="prop-1"
        state={ProposalState.Succeeded}
        hasTimelock={false}
        isConnected={true}
        onExecute={handleExecute}
      />
    );

    const btn = screen.getByTestId("execute-proposal-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
    expect(screen.getByText(/ready for immediate on-chain execution/i)).toBeInTheDocument();

    fireEvent.click(btn);
    expect(handleExecute).toHaveBeenCalledTimes(1);
  });

  it("renders queue button when proposal succeeded in community with timelock", () => {
    const handleQueue = vi.fn();

    render(
      <ProposalExecutionSection
        proposalId="prop-2"
        state={ProposalState.Succeeded}
        hasTimelock={true}
        isConnected={true}
        onQueue={handleQueue}
      />
    );

    const queueBtn = screen.getByTestId("queue-proposal-button");
    expect(queueBtn).toBeInTheDocument();
    expect(queueBtn).toBeEnabled();
    expect(screen.getByText(/must be queued in the CommunityTimelock/i)).toBeInTheDocument();

    fireEvent.click(queueBtn);
    expect(handleQueue).toHaveBeenCalledTimes(1);
  });

  it("disables queue button with reason when wallet is disconnected", () => {
    render(
      <ProposalExecutionSection
        proposalId="prop-2"
        state={ProposalState.Succeeded}
        hasTimelock={true}
        isConnected={false}
      />
    );

    const queueBtn = screen.getByTestId("queue-proposal-button");
    expect(queueBtn).toBeDisabled();
    expect(screen.getByTestId("queue-disabled-reason")).toHaveTextContent(
      /connect your wallet to queue/i
    );
  });

  it("disables execute button with delay reason when queued proposal is before ETA", () => {
    render(
      <ProposalExecutionSection
        proposalId="prop-3"
        state={ProposalState.Queued}
        hasTimelock={true}
        timelockEta={1000}
        timelockExpiresAt={2000}
        currentLedger={850}
        isConnected={true}
      />
    );

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Ledger #1000")).toBeInTheDocument();
    expect(screen.getByText("Ledger #2000")).toBeInTheDocument();

    const delayReason = screen.getByTestId("timelock-delay-reason");
    expect(delayReason).toHaveTextContent(/150 ledgers remaining/i);

    const executeBtn = screen.getByTestId("execute-proposal-button");
    expect(executeBtn).toBeDisabled();
  });

  it("enables execute button when queued proposal enters executable window", () => {
    const handleExecute = vi.fn();

    render(
      <ProposalExecutionSection
        proposalId="prop-4"
        state={ProposalState.Queued}
        hasTimelock={true}
        timelockEta={1000}
        timelockExpiresAt={2000}
        currentLedger={1500}
        isConnected={true}
        onExecute={handleExecute}
      />
    );

    const executeBtn = screen.getByTestId("execute-proposal-button");
    expect(executeBtn).toBeEnabled();

    fireEvent.click(executeBtn);
    expect(handleExecute).toHaveBeenCalledTimes(1);
  });

  it("disables execute button when queued proposal expires", () => {
    render(
      <ProposalExecutionSection
        proposalId="prop-5"
        state={ProposalState.Queued}
        hasTimelock={true}
        timelockEta={1000}
        timelockExpiresAt={2000}
        currentLedger={2001}
        isConnected={true}
      />
    );

    const executeBtn = screen.getByTestId("execute-proposal-button");
    expect(executeBtn).toBeDisabled();
    expect(screen.getByTestId("timelock-delay-reason")).toHaveTextContent(
      /execution window has expired/i
    );
  });

  it("renders executed status badge and message when executed", () => {
    render(
      <ProposalExecutionSection
        proposalId="prop-6"
        state={ProposalState.Executed}
        hasTimelock={true}
        isConnected={true}
      />
    );

    expect(screen.getByText("Executed")).toBeInTheDocument();
    expect(screen.getByText(/executed on-chain/i)).toBeInTheDocument();
    expect(screen.queryByTestId("execute-proposal-button")).not.toBeInTheDocument();
  });
});
