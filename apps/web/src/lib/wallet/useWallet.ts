"use client";

export type WalletHookResult = {
  address: string | null;
  connected: boolean;
};

export function useWallet(): WalletHookResult {
  return {
    address: null,
    connected: false,
  };
}
