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
    // Measure the embed wrapper, not <body>: RootLayout pins body to min-h-full
    // so body.scrollHeight is at least the iframe viewport and can't shrink.
    const target = document.getElementById("pspm-embed-root") ?? document.body;
    function post() {
      const height = Math.ceil(target.getBoundingClientRect().height);
      const msg = { type: "pspm-form:height", slug, height };
      for (const origin of PARENT_ORIGINS) {
        window.parent?.postMessage(msg, origin);
      }
    }
    post();
    // ResizeObserver catches box-size changes; MutationObserver catches
    // conditional fields / validation errors / upload widgets being added or
    // removed, which change height without resizing the observed box.
    const resizeObserver = new ResizeObserver(() => post());
    resizeObserver.observe(target);
    const mutationObserver = new MutationObserver(() => post());
    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    window.addEventListener("load", post);
    target.addEventListener("pspm-form:remeasure", post);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("load", post);
      target.removeEventListener("pspm-form:remeasure", post);
    };
  }, [slug]);

  return null;
}
