"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// The game's window over the page: a popup on computers (the dimmed page stays behind it; the game's X in the top
// right corner closes it and the page is back as it was), the whole visible screen on touch devices (`fill`). Its
// height comes from the measure each kind of device gets right:
// phones follow the *visual* viewport (top = visualViewport.offsetTop, height = visualViewport.height; 100dvh reaches
// under Chrome on iPhone's bottom toolbar and hid the keypad's last row), tablets take 100dvh (an iPad browser reported
// a visual viewport shorter than the screen by its own toolbar's height, which left a strip of the page under the
// game). While a text field of the game has the focus (a guest's name) every device follows the visual viewport: iOS
// Safari scrolls the page to show a focused field when the keyboard opens, so the window just gets shorter instead.
// The dimming covers the whole screen on its own. The page behind it is locked (body position: fixed, the scroll position restored on close), and the browser's back button /
// swipe asks the game (onBack) instead of leaving the page. No browser full screen: in it Android Chrome lays the
// keyboard over the page without telling it (the question card ended up under the keyboard) and shows its own
// "Tam ekrandan çıkmak için…" notice over the game.

type Box = { top: number; height: number };
/** Some browsers report the keyboard late (or not at all while it animates): the size is checked again this often. */
const RECHECK_MS = 250;

// history.back() calls made by a closing layer: the popstate they cause belongs to nobody (React's development double
// mount closes and reopens the layer at once, and the reopened layer must not take it for a back press).
let ownBacks = 0;
const LAYER_HASH = "#oyun";
const marked = () => window.location.hash === LAYER_HASH;

const isTextField = (el: Element | null) => !!el?.closest("input, textarea, select, [contenteditable]");
/** A phone: the short side of the screen under 600 px (tablets start at 744). */
const phoneQuery = () => Math.min(window.screen.width, window.screen.height) < 600;
const noSubscribe = () => () => {};

function measure(): Box {
  const vv = window.visualViewport;
  return vv ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) } : { top: 0, height: window.innerHeight };
}

/**
 * `fill`: the whole visible screen at every width (touch screens), not the popup of wider screens. `windowRef`: the
 * window box itself (the game's heartbeat bump / nudge move it).
 */
export function GameLayer({
  onBack,
  children,
  label,
  fill = false,
  windowRef,
}: {
  onBack: () => void;
  children: React.ReactNode;
  label: string;
  fill?: boolean;
  windowRef?: React.Ref<HTMLDivElement>;
}) {
  const [box, setBox] = useState<Box | null>(null);
  // A text field of the game has the focus (the keyboard may be open).
  const [typing, setTyping] = useState(false);
  const phone = useSyncExternalStore(noSubscribe, phoneQuery, () => false);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // A modal window for keyboard and screen-reader users too: focus moves into it, everything outside it is inert
  // while it is open (Tab can't reach the dimmed page), and focus goes back where it was on close.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    // The window (role="dialog") is the wrapper's only child; a field the game focused at once (the typing race's
    // keyboard holder, focused by the press that opened the window) keeps the focus, and with it the open keyboard.
    if (!wrap.contains(document.activeElement)) (wrap.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
    const made: Element[] = [];
    for (let node: Element = wrap; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib === node || sib.hasAttribute("data-layer-dim") || sib.hasAttribute("inert")) continue;
        sib.setAttribute("inert", "");
        made.push(sib);
      }
    }
    return () => {
      for (const el of made) el.removeAttribute("inert");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Lock the page behind the layer (works on iOS, unlike overflow: hidden alone).
  useLayoutEffect(() => {
    const y = window.scrollY;
    const body = document.body.style;
    const html = document.documentElement.style;
    const saved = { position: body.position, top: body.top, left: body.left, right: body.right, width: body.width, overflow: body.overflow, overscroll: html.overscrollBehavior, htmlOverflow: html.overflow };
    Object.assign(body, { position: "fixed", top: `-${y}px`, left: "0", right: "0", width: "100%", overflow: "hidden" });
    html.overscrollBehavior = "none";
    // No scrollbar of the page over the game (an overlay scrollbar is drawn over the window's right edge).
    html.overflow = "hidden";
    return () => {
      Object.assign(body, { position: saved.position, top: saved.top, left: saved.left, right: saved.right, width: saved.width, overflow: saved.overflow });
      html.overscrollBehavior = saved.overscroll;
      html.overflow = saved.htmlOverflow;
      window.scrollTo(0, y);
    };
  }, []);

  // Follow the visual viewport (keyboard, browser bars, pinch): on its events, and checked again every RECHECK_MS
  // in case an event never comes (a re-render only when the size really changed).
  useLayoutEffect(() => {
    const update = () => {
      // With the body fixed the window shouldn't scroll; if the browser scrolled it anyway, undo it.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      const next = measure();
      setBox((prev) => (prev && prev.top === next.top && prev.height === next.height ? prev : next));
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    const onFocus = () => setTyping(isTextField(document.activeElement));
    const onBlur = () => setTimeout(onFocus, 0);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    const timer = setInterval(update, RECHECK_MS);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      clearInterval(timer);
    };
  }, []);

  // Back button / swipe: one history entry (the URL gets "#oyun") while the layer is open; going back asks the game.
  // A URL marker, because the Next.js router replaces history.state with its own.
  useEffect(() => {
    if (!marked()) window.history.pushState(window.history.state, "", LAYER_HASH);
    const onPop = () => {
      if (ownBacks > 0) {
        ownBacks--;
        // React's development double mount: the reopened layer gets its entry back.
        if (!marked()) window.history.pushState(window.history.state, "", LAYER_HASH);
        return;
      }
      if (!marked()) onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed from inside the game: drop the entry we added.
      if (marked()) {
        ownBacks++;
        window.history.back();
        // Nobody may be listening when it arrives: forget it after a moment.
        setTimeout(() => (ownBacks = Math.max(0, ownBacks - 1)), 1000);
      }
    };
  }, []);

  return (
    <>
      {/* color-guard-allow: the dimming backdrop is dark in every theme and mode. On touch screens (fill) it is the game's
          own background: the window may end above a see-through keyboard or a browser bar, and the page must not show there. */}
      <div aria-hidden data-layer-dim className={`fixed inset-x-0 top-0 h-[max(100%,100lvh)] z-[89] ${fill ? "bg-background" : "bg-black/50"} overscroll-none touch-none`} />
      <div
        ref={wrapRef}
        className={`fixed inset-x-0 z-[90] flex overscroll-none touch-manipulation ${fill ? "" : "md:items-center md:justify-center md:p-6"}`}
        style={(phone || typing) && box ? { top: box.top, height: box.height } : { top: 0, height: "100dvh" }}
      >
      <div
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`flex flex-col w-full h-full bg-background text-foreground overflow-hidden outline-none ${fill ? "" : "md:w-[min(72rem,100%)] md:h-[min(52rem,100%)] md:rounded-2xl md:border md:border-border md:shadow-2xl"}`}
      >
        {children}
      </div>
      </div>
    </>
  );
}

/** The game re-adds the history entry when it answers a back press with "Oyundan çıkılsın mı?". */
export function keepLayerEntry() {
  if (!marked()) window.history.pushState(window.history.state, "", LAYER_HASH);
}
