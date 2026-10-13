"use client";

export type NetworkHookResult = {
  isCorrectChain: boolean;
};

export function useNetwork(): NetworkHookResult {
  return {
    isCorrectChain: true,
  };
}
