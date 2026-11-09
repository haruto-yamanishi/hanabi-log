import { BatArt, GhostArt, PumpkinArt } from "./halloween-art";

export type HalloweenVariant = "hero" | "loading" | "brand" | "login" | "header";

/** Drawing only: the caller chooses whether it is seasonal decor or a report stamp. */
export function HalloweenComposition({ variant }: { variant: HalloweenVariant }) {
  return <div className={`halloween-scene halloween-scene--${variant}`} aria-hidden="true">
    <span className="halloween-friend halloween-pumpkin"><PumpkinArt /></span>
    <span className="halloween-friend halloween-ghost"><GhostArt /></span>
    <span className="halloween-friend halloween-bat"><BatArt /></span>
    {(variant === "hero" || variant === "login" || variant === "loading") && <>
      <span className="halloween-friend halloween-bat halloween-bat--little"><BatArt /></span>
      <span className="halloween-spark halloween-spark--one" />
      <span className="halloween-spark halloween-spark--two" />
      <span className="halloween-caption">A LITTLE BOO. A LOT OF HANABI.</span>
    </>}
  </div>;
}
