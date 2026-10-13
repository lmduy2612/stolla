"use client";

import { useMemo } from "react";
import { ProposalState } from "@/lib/bindings/community-governor/src";
import { AppButton } from "@/components/ui/AppButton";

export type ProposalExecutionSectionProps = {
  proposalId: string;
  state: ProposalState;
  hasTimelock: boolean;
  timelockEta?: number;
  timelockExpiresAt?: number;
  currentLedger?: number;
  isConnected: boolean;
  isCorrectChain?: boolean;
  onQueue?: () => Promise<void> | void;
  onExecute?: () => Promise<void> | void;
  isSubmitting?: boolean;
};

export function ProposalExecutionSection({
  proposalId,
  state,
  hasTimelock,
  timelockEta,
  timelockExpiresAt,
  currentLedger,
  isConnected,
  isCorrectChain = true,
  onQueue,
  onExecute,
  isSubmitting = false,
}: ProposalExecutionSectionProps) {
  const isExecutable = useMemo(() => {
    if (state !== ProposalState.Queued) return false;
    if (timelockEta === undefined || currentLedger === undefined) {
      return true; // Default to executable if ledger unknown
    }
    const expiresAt = timelockExpiresAt ?? timelockEta + 120_960;
    return currentLedger >= timelockEta && currentLedger <= expiresAt;
  }, [state, timelockEta, timelockExpiresAt, currentLedger]);

  const delayReason = useMemo(() => {
    if (state !== ProposalState.Queued) return null;
    if (timelockEta !== undefined && currentLedger !== undefined) {
      if (currentLedger < timelockEta) {
        const remaining = timelockEta - currentLedger;
        return `Timelock delay in progress. Execution unlocks at ledger ${timelockEta} (${remaining} ledgers remaining).`;
      }
      if (timelockExpiresAt !== undefined && currentLedger > timelockExpiresAt) {
        return "Timelock execution window has expired.";
      }
    }
    return null;
  }, [state, timelockEta, timelockExpiresAt, currentLedger]);

  if (state === ProposalState.Executed) {
    return (
      <section
        data-testid="proposal-execution-section"
        className="mt-6 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-5 text-sm"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-emerald-900/60 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            Executed
          </span>
          <p className="text-emerald-200">
            This proposal has been executed on-chain.
          </p>
        </div>
      </section>
    );
  }

  if (state === ProposalState.Succeeded) {
    if (hasTimelock) {
      return (
        <section
          data-testid="proposal-execution-section"
          className="mt-6 rounded-xl border border-slate-800 bg-[#151b2b] p-5"
        >
          <h2 className="font-semibold text-slate-100">Timelock Queue</h2>
          <p className="mt-2 text-sm text-slate-400">
            This proposal succeeded and must be queued in the CommunityTimelock
            before it can be executed.
          </p>
          <div className="mt-4">
            <AppButton
              tone="primary"
              disabled={!isConnected || !isCorrectChain || isSubmitting}
              onClick={() => onQueue?.()}
              data-testid="queue-proposal-button"
              title={
                !isConnected
                  ? "Connect wallet to queue"
                  : !isCorrectChain
                    ? "Switch network to queue"
                    : undefined
              }
            >
              {isSubmitting ? "Queueing proposal…" : "Queue proposal"}
            </AppButton>
            {!isConnected && (
              <p
                data-testid="queue-disabled-reason"
                className="mt-2 text-xs text-amber-300"
              >
                Connect your wallet to queue this proposal.
              </p>
            )}
          </div>
        </section>
      );
    }

    // Community without timelock keeps direct signaling execute CTA
    return (
      <section
        data-testid="proposal-execution-section"
        className="mt-6 rounded-xl border border-slate-800 bg-[#151b2b] p-5"
      >
        <h2 className="font-semibold text-slate-100">Execute Proposal</h2>
        <p className="mt-2 text-sm text-slate-400">
          This proposal has succeeded and is ready for immediate on-chain execution.
        </p>
        <div className="mt-4">
          <AppButton
            tone="primary"
            disabled={!isConnected || !isCorrectChain || isSubmitting}
            onClick={() => onExecute?.()}
            data-testid="execute-proposal-button"
            title={
              !isConnected
                ? "Connect wallet to execute"
                : !isCorrectChain
                  ? "Switch network to execute"
                  : undefined
            }
          >
            {isSubmitting ? "Executing proposal…" : "Execute proposal"}
          </AppButton>
          {!isConnected && (
            <p
              data-testid="execute-disabled-reason"
              className="mt-2 text-xs text-amber-300"
            >
              Connect your wallet to execute this proposal.
            </p>
          )}
        </div>
      </section>
    );
  }

  if (state === ProposalState.Queued) {
    return (
      <section
        data-testid="proposal-execution-section"
        className="mt-6 rounded-xl border border-slate-800 bg-[#151b2b] p-5"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-100">Timelock Status</h2>
          <span className="inline-flex items-center rounded-md bg-sky-950/80 px-2 py-0.5 text-xs font-semibold text-sky-300 border border-sky-800/80">
            Queued
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 text-xs sm:grid-cols-3">
          {timelockEta !== undefined && (
            <div>
              <dt className="text-slate-500">Earliest Execution (ETA)</dt>
              <dd className="font-mono text-slate-200">Ledger #{timelockEta}</dd>
            </div>
          )}
          {timelockExpiresAt !== undefined && (
            <div>
              <dt className="text-slate-500">Expires At</dt>
              <dd className="font-mono text-slate-200">Ledger #{timelockExpiresAt}</dd>
            </div>
          )}
          {currentLedger !== undefined && (
            <div>
              <dt className="text-slate-500">Current Ledger</dt>
              <dd className="font-mono text-slate-200">#{currentLedger}</dd>
            </div>
          )}
        </dl>

        {delayReason && (
          <p
            data-testid="timelock-delay-reason"
            className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-xs text-amber-200"
          >
            {delayReason}
          </p>
        )}

        <div className="mt-4">
          <AppButton
            tone="primary"
            disabled={!isConnected || !isCorrectChain || !isExecutable || isSubmitting}
            onClick={() => onExecute?.()}
            data-testid="execute-proposal-button"
            title={
              !isConnected
                ? "Connect wallet to execute"
                : !isCorrectChain
                  ? "Switch network to execute"
                  : !isExecutable
                    ? delayReason ?? "Action is not executable"
                    : undefined
            }
          >
            {isSubmitting ? "Executing…" : "Execute proposal"}
          </AppButton>
          {!isConnected && (
            <p
              data-testid="execute-disabled-reason"
              className="mt-2 text-xs text-amber-300"
            >
              Connect your wallet to execute.
            </p>
          )}
        </div>
      </section>
    );
  }

  return null;
}
