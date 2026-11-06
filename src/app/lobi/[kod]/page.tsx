import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Quicker } from "@/components/quicker/quicker";

type Props = { params: Promise<{ kod: string }> };

export const metadata: Metadata = { title: "quicker lobisi", robots: { index: false, follow: false } };

// An invite link: anyone who has it joins the lobby at once (the race itself runs on the server). Never indexed.
export default async function LobbyPage({ params }: Props) {
  const { kod } = await params;
  if (!/^[A-Za-z0-9]{6}$/.test(kod)) notFound();
  return (
    <main className="max-w-6xl mx-auto px-2 sm:px-4 py-3 md:py-6">
      <Quicker lobbyCode={kod.toUpperCase()} />
    </main>
  );
}
