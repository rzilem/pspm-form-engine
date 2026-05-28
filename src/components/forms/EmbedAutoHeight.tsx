"use client";

import { useEffect } from "react";

/**
 * Posts the document height to the parent window so an embedding page can
 * size its <iframe> to fit the form (no scrollbars, no clipped content).
 *
 * Parent-page listener (paste into the host site once):
 *   window.addEventListener("message", (e) => {
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
      window.parent?.postMessage({ type: "pspm-form:height", slug, height }, "*");
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
