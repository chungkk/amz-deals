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
    <button type="button" className="share-btn" onClick={() => void share()} aria-label="Teilen" title="Teilen">
      {done ? "✓" : (<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7c0 .3 0 .5.1.8L8.4 11.2a3 3 0 1 0 0 3.6l6.7 3.4A3 3 0 1 0 18 16Z"/></svg>)}
    </button>
  );
}
