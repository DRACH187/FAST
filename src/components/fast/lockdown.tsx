"use client";

/**
 * LOCKDOWN — devtools & inspector deterrent.
 * ==========================================
 * Honest engineering note: NOTHING on the open web can make a browser
 * "disable inspect element" — devtools are part of the browser, not the
 * page. What this layer does is make casual inspection expensive and loud:
 *
 *  - right-click "Inspect" is killed
 *  - every devtools shortcut (F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U,
 *    Ctrl/Cmd+S) is swallowed
 *  - an overlay slam ("DIE WERF IS TOE") drops over the page the moment
 *    devtools are detected docked/open (viewport size-delta heuristic —
 *    desktop only, mobile remote debugging never resizes the window)
 *  - view-source gets a shouted warning in the HTML + the console is
 *    cleared and badged on open
 *
 * It raises the floor against bored snooping. It cannot stop a determined
 * analyst — nothing client-side can — and the app's real defence stays
 * where it belongs: everything sensitive is ciphertext before it ever
 * leaves the tab.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const OVERLAY_TITLE = "DIE WERF IS TOE";
const OVERLAY_SUB = "Ontwikkelaarsgereedskap is oop — maak dit toe om in te kom.";

export function Lockdown() {
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    };

    // 1. context menu — the "Inspect" front door
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
    };

    // 2. devtools shortcut net
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (k === "F12") {
        e.preventDefault();
        return;
      }
      if (ctrl && e.shiftKey && ["I", "J", "C", "K"].includes(k)) {
        e.preventDefault();
        return;
      }
      // view-source + save-page (the cheap rubber-necking routes)
      if (ctrl && !e.shiftKey && (k === "U" || k === "S")) {
        if (k === "U") {
          e.preventDefault();
        } else if (!isEditable(e.target)) {
          e.preventDefault();
        }
      }
    };

    // 3. docked-devtools heuristic: any viewport edge growing past 220px
    //    while the other dimension stays put = a panel opened. 220px clears
    //    zoom, scrollbars, and mobile URL bars; catches docked + side panels.
    let probe: number | undefined;
    const sizeCheck = () => {
      const w = window.outerWidth - window.innerWidth;
      const h = window.outerHeight - window.innerHeight;
      setDevtoolsOpen((w > 220 || h > 220) && !document.hidden);
    };
    const onResize = () => {
      window.clearTimeout(probe);
      probe = window.setTimeout(sizeCheck, 350);
    };

    // 4. console hygiene: clear the tape, badge the house
    const onBoot = () => {
      try {
        console.clear();
        console.log(
          "%c187 · FAST GUNS · GEEN SPIONE HIER",
          "color:#fff;background:#000;font-weight:900;padding:6px 14px;letter-spacing:.3em"
        );
        console.log("%cHierdie werf hou niks van jou toestel nie — en jy hou niks van syne nie. Voetsek.",
          "color:#888;font-weight:700");
      } catch {
        /* hardened consoles */
      }
    };

    document.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    sizeCheck();
    onBoot();

    return () => {
      document.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(probe);
    };
  }, []);

  if (!devtoolsOpen) return null;

  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-black px-8 text-center"
    >
      <span aria-hidden className="gang-font text-6xl text-white sm:text-8xl">187</span>
      <h2 className="gang-font text-3xl text-white sm:text-4xl">{OVERLAY_TITLE}</h2>
      <p className="max-w-xs font-mono text-xs font-bold uppercase leading-relaxed tracking-[0.2em] text-neutral-400">
        {OVERLAY_SUB}
      </p>
    </div>,
    document.body
  );
}
