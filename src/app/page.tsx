import { Quicker } from "@/components/quicker/quicker";

// The game page. The race itself runs on the server (src/app/api/quicker/*); the browser shows it and sends typed
// answers.
export default function Home() {
  return (
    <main className="max-w-6xl mx-auto px-2 sm:px-4 py-3 md:py-6">
      <Quicker />
    </main>
  );
}
