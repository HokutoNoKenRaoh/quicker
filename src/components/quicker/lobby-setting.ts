"use client";

import { useEffect, useState } from "react";

// A lobby host's setting (the bots, the question count): the new value shows at once and goes to the server at most
// once per SEND_MS, one request at a time (two on the way at once could arrive the other way round), the taps in
// between merged (the latest value wins); a value the server already has is not sent. The shown value goes back to
// the server's once the last request has been answered (the server puts the new state on the stream before it
// replies).

const SEND_MS = 250;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Send<T> = (value: T) => Promise<unknown>;

class SettingSender<T> {
  private queued: { value: T; server: T | undefined; send: Send<T> } | null = null;
  /** The value of this burst's last request (what the server has, or will have). */
  private sent: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastAt = 0;
  private busy = false;

  /** The burst is over: the stream's state counts again. */
  private readonly settled: () => void;

  constructor(settled: () => void) {
    this.settled = settled;
  }

  /** `server`: the value the tap was made on; `send`: the request of that render. */
  change(value: T, server: T | undefined, send: Send<T>) {
    this.queued = { value, server, send };
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer || this.busy || !this.queued) return;
    const wait = this.lastAt + SEND_MS - Date.now();
    if (wait > 0) this.timer = setTimeout(() => this.flush(), wait);
    else this.flush();
  }

  private flush() {
    this.timer = null;
    const next = this.queued;
    if (!next || this.busy) return;
    this.queued = null;
    const have = this.sent ? this.sent.value : next.server;
    if (have !== undefined && same(have, next.value)) return this.done();
    this.lastAt = Date.now();
    this.sent = { value: next.value };
    this.busy = true;
    void next.send(next.value).finally(() => {
      this.busy = false;
      if (this.queued) this.schedule();
      else this.done();
    });
  }

  private done() {
    this.sent = null;
    this.settled();
  }
}

export function useLobbySetting<T>(server: T | undefined, send: Send<T>) {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const [sender] = useState(() => new SettingSender<T>(() => setDraft(null)));
  useEffect(() => () => sender.stop(), [sender]);

  const change = (value: T) => {
    setDraft({ value });
    sender.change(value, server, send);
  };

  return { value: draft ? draft.value : server, change };
}
