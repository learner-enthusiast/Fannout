"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "~/lib/utils"

/**
 * Switch — an on/off setting that applies immediately. Pair with a visible
 * label (FormField orientation="horizontal" or <label>).
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background duration-fast ease-out aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=default]:w-11 data-[size=sm]:h-4 data-[size=sm]:w-7 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-unchecked:border-transparent data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0 transition-transform bg-foreground duration-fast ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:bg-primary-foreground group-data-[size=default]/switch:data-checked:translate-x-6 group-data-[size=sm]/switch:data-checked:translate-x-3 rtl:data-checked:-translate-x-6 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
