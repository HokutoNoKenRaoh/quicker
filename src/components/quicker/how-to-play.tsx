"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// How a quicker race starts, in three lines: on the setup / lobby screen before the first race on a device
// ("Got it" hides it for good, storage.ts) and any time from the "?" in the game window's top bar (as a dialog).

function Lines({ passHow }: { passHow: string }) {
  return (
    <ul className="space-y-1.5 text-sm list-disc pl-5">
      <li>
        The countdown shows <strong>practice questions</strong>: try the keys, they don&apos;t score.
      </li>
      <li>
        After <strong>GO!</strong> the real questions come; the right number counts the moment you type it, no Enter.
      </li>
      <li>
        Stuck? <strong>Pass</strong>: {passHow}.
      </li>
    </ul>
  );
}

/** The first-time card (inline). */
export function HowToPlayCard({ passHow, onDone }: { passHow: string; onDone: () => void }) {
  return (
    <div className="notice-info p-4 space-y-3" role="note" aria-labelledby="hy-how-title">
      <p id="hy-how-title" className="font-semibold">
        How to play
      </p>
      <Lines passHow={passHow} />
      <button type="button" onClick={onDone} className="btn-primary press px-4 py-2 text-sm font-semibold">
        Got it
      </button>
    </div>
  );
}

/** The same lines as a modal dialog (the "?" of the top bar). */
export function HowToPlayDialog({ passHow, onClose }: { passHow: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="hy-how-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // The dimming backdrop is dark in every mode.
      className="card m-auto w-[calc(100%-2rem)] max-w-md p-5 rounded-2xl space-y-4 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="hy-how-dialog-title" className="text-lg font-bold">
          How to play
        </h2>
        <button type="button" onClick={close} aria-label="Close" className="btn-secondary p-2">
          <X size={18} aria-hidden />
        </button>
      </div>
      <Lines passHow={passHow} />
      <button type="button" onClick={close} className="btn-primary press w-full py-2.5 font-semibold">
        Got it
      </button>
    </dialog>
  );
}
