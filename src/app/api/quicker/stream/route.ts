import { subscribe } from "@/lib/server/registry";
import { roomAndMember } from "@/lib/server/http";

// The room's live state as Server-Sent Events: lobby changes, the countdown's start time, everyone's progress about
// four times a second, the end. A comment every 15 s keeps idle connections open (some proxies close idle ones). A room
// that no longer exists (the server restarted) answers one "gone" event; the browser stops there.
// ?ping=1: three ticks a second apart, to check that the stream isn't buffered on the way (curl -N).

export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
};
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const enc = new TextEncoder();
  const line = (data: unknown) => enc.encode(`data: ${JSON.stringify(data)}\n\n`);

  if (url.searchParams.get("ping") === "1") {
    let n = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(line({ t: "ping", n: n++, at: Date.now() }));
        timer = setInterval(() => {
          controller.enqueue(line({ t: "ping", n: n++, at: Date.now() }));
          if (n >= 3) {
            clearInterval(timer);
            controller.close();
          }
        }, 1000);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(stream, { headers: HEADERS });
  }

  const found = roomAndMember(url.searchParams.get("room"), url.searchParams.get("token"));
  if (!found) {
    return new Response(enc.encode(`retry: 600000\ndata: ${JSON.stringify({ t: "gone" })}\n\n`), { headers: HEADERS });
  }
  const { room, member } = found;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {}
      };
      unsubscribe = subscribe(room, member, {
        memberKey: member.key,
        send: (payload) => {
          if (!closed) controller.enqueue(line(payload));
        },
        close,
      });
      heartbeat = setInterval(() => {
        try {
          if (!closed) controller.enqueue(enc.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers: HEADERS });
}
