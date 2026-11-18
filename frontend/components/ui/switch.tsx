"use client";
import * as SwitchPrimitive from "@radix-ui/react-switch";
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="group relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className="h-5 w-9 rounded-full bg-surface-raised transition-colors group-data-[state=checked]:bg-primary"
      />
      <SwitchPrimitive.Thumb className="absolute left-2 block h-4 w-4 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
