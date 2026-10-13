"use client";

import { useState, useCallback } from "react";

export type GovernorProposalActionParams = {
  governorAddress: string;
  proposalId: string;
  action: "cancel" | "execute";
  onSuccess?: () => void;
};

export type GovernorProposalActionResult = {
  visible: boolean;
  pending: boolean;
  submit: () => Promise<void>;
};

export function useGovernorProposalAction({
  governorAddress,
  proposalId,
  action,
  onSuccess,
}: GovernorProposalActionParams): GovernorProposalActionResult {
  const [pending, setPending] = useState(false);

  const submit = useCallback(async () => {
    setPending(true);
    try {
      onSuccess?.();
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return {
    visible: true,
    pending,
    submit,
  };
}
