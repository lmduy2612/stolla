import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AppButton, type AppButtonTone } from "@/components/ui/AppButton";

export type TransactionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "secondary";
  pending?: boolean;
  children: ReactNode;
};

export function TransactionButton({
  variant = "primary",
  pending = false,
  disabled,
  children,
  ...props
}: TransactionButtonProps) {
  const tone: AppButtonTone =
    variant === "danger"
      ? "danger"
      : variant === "secondary"
        ? "secondary"
        : "primary";

  return (
    <AppButton tone={tone} disabled={disabled || pending} {...props}>
      {pending ? "Processing…" : children}
    </AppButton>
  );
}
