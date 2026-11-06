"use client";

import { useEffect, useRef } from "react";

/** "Oyundan çıkılsın mı?" during the countdown / race (Escape or "Devam et" keeps playing). */
export function ConfirmExit({ lobby, onYes, onNo }: { lobby: boolean; onYes: () => void; onNo: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    no.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="hy-exit-title"
      onCancel={(e) => {
        e.preventDefault();
        dialog.current?.close();
        onNo();
      }}
      // color-guard-allow: the dimming backdrop is dark in every theme and mode
      className="card m-auto max-w-xs w-[calc(100%-2rem)] p-5 backdrop:bg-black/50"
    >
      <h2 id="hy-exit-title" className="text-lg font-semibold mb-1">
        Oyundan çıkılsın mı?
      </h2>
      <p className="text-sm text-muted mb-4">Yarış durmaz; çıkarsan yarışta &quot;ayrıldı&quot; görünürsün{lobby ? " ve lobiden çıkarsın" : ""}.</p>
      <div className="flex justify-end gap-2">
        <button
          ref={no}
          type="button"
          onClick={() => {
            // Close first: the dialog gives focus back as it closes, then the game focuses the answer field in this tap.
            dialog.current?.close();
            onNo();
          }}
          className="btn-secondary px-4 py-2 text-sm"
        >
          Devam et
        </button>
        <button type="button" onClick={onYes} className="btn-danger px-4 py-2 text-sm">
          Çık
        </button>
      </div>
    </dialog>
  );
}
