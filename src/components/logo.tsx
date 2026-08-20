import Image from "next/image";
import Link from "next/link";

export function HanabiMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Hanabi 日報ホーム" className={`brand${compact ? " brand--compact" : ""}`} href="/">
      <HanabiLogo decorative />
    </Link>
  );
}

export function HanabiLogo({
  className = "",
  decorative = false,
  inverse = false,
}: {
  className?: string;
  decorative?: boolean;
  inverse?: boolean;
}) {
  return (
    <Image
      alt={decorative ? "" : "Hanabi"}
      className={`brand__image${className ? ` ${className}` : ""}`}
      height={1581}
      loading="eager"
      src={inverse ? "/brand/hanabi-white.png" : "/brand/hanabi-normal.png"}
      width={inverse ? 2127 : 2170}
    />
  );
}
