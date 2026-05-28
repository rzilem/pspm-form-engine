"use client";

import { useEffect } from "react";

// Origins allowed to receive resize messages. Defaults to psprop.net; set
// NEXT_PUBLIC_EMBED_PARENT_ORIGINS (comma-separated) to embed elsewhere. We post
// to specific origins rather than "*" so a third-party page that frames the form
// can't receive these activity-correlated resize signals.
const PARENT_ORIGINS = (
  process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGINS ?? "https://psprop.net"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Posts the document height to the parent window so an embedding page can
 * size its <iframe> to fit the form (no scrollbars, no clipped content).
 *
 * Parent-page listener (paste into the host site once). Verify the origin:
 *   window.addEventListener("message", (e) => {
 *     if (e.origin !== "https://pspm-form-engine-138752496729.us-central1.run.app") return;
 *     if (e.data?.type !== "pspm-form:height") return;
 *     const f = document.getElementById("pspm-form-" + e.data.slug);
 *     if (f) f.style.height = e.data.height + "px";
 *   });
 *
 * Only mounted in embed mode (?embed=1), so the standalone form page is
 * unaffected.
 */
export function EmbedAutoHeight({ slug }: { slug: string }) {
  useEffect(() => {
    function post() {
      const height = Math.ceil(document.documentElement.scrollHeight);
      const msg = { type: "pspm-form:height", slug, height };
      for (const origin of PARENT_ORIGINS) {
        window.parent?.postMessage(msg, origin);
      }
    }
    post();
    const observer = new ResizeObserver(() => post());
    observer.observe(document.documentElement);
    window.addEventListener("load", post);
    return () => {
      observer.disconnect();
      window.removeEventListener("load", post);
    };
  }, [slug]);

  return null;
}
