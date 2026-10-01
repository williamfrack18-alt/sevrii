import Link from "next/link";

// Sevrii logo + wordmark, same as the sevrii.com landing header.
export default function BrandMark({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`brand-mark ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/sevrii-logo.png" alt="" />
      Sevrii
    </Link>
  );
}
