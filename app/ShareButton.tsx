"use client";

import { useState } from "react";

export function ShareButton({ url, title, text }: { url: string; title: string; text: string }) {
  const [done, setDone] = useState(false);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    const full = `${text}\n👉 ${url}`;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = full;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }

  return (
    <button type="button" className="share-btn" onClick={() => void share()}>
      {done ? "✓ Kopiert" : "Teilen"}
    </button>
  );
}
