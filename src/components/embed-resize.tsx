import { useEffect } from "react";

/**
 * Posts the current document height to the parent window so an embedding
 * iframe can auto-resize. Paired with the snippet in /embed-builder.
 */
export function EmbedResize() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent === window) return; // not in an iframe

    const post = () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      window.parent.postMessage({ type: "swap-embed:height", height: h }, "*");
    };

    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    const id = window.setInterval(post, 1500); // belt + suspenders
    window.addEventListener("load", post);

    return () => {
      ro.disconnect();
      window.clearInterval(id);
      window.removeEventListener("load", post);
    };
  }, []);
  return null;
}
