"use client";

import { useState } from "react";

export function CopyAffButtons({
  url,
  title,
  priceText,
  oldPriceText,
  pct,
  voucher,
  compact = false,
}: {
  url: string;
  title?: string;
  priceText?: string;
  oldPriceText?: string;
  pct?: number | null;
  voucher?: string | null;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<"" | "link" | "post">("");

  async function copy(kind: "link" | "post") {
    let text = url;
    if (kind === "post" && title) {
      const lines = [title];
      if (priceText) {
        const extra = [
          oldPriceText ? `giá gốc ${oldPriceText}` : "",
          pct && pct > 0 ? `-${pct}%` : "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`💰 ${priceText}${extra ? ` (${extra})` : ""}`);
      }
      if (voucher) lines.push(`🏷️ Code: ${voucher}`);
      lines.push(`👉 ${url}`);
      text = lines.join("\n");
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(kind);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <span className="copy-wrap">
      <button type="button" className="copy-btn" onClick={() => void copy("link")} title={url}>
        {copied === "link" ? "✓ Đã copy" : compact ? "Copy Aff" : "Copy link"}
      </button>
      {!compact && title && (
        <button type="button" className="copy-btn" onClick={() => void copy("post")} title="Copy tiêu đề + giá + link Aff">
          {copied === "post" ? "✓ Đã copy" : "Copy bài"}
        </button>
      )}
    </span>
  );
}
