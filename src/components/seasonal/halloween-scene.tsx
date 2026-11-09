"use client";
import { HalloweenComposition, type HalloweenVariant } from "./halloween-composition";
import { useHalloween } from "./halloween-provider";

export function HalloweenScene({ variant }: { variant: HalloweenVariant }) {
  const enabled = useHalloween();
  return enabled ? <HalloweenComposition variant={variant} /> : null;
}
