import JyotishChat from "@/components/JyotishChat";

export const metadata = {
  title: "🪐 Jyotish GPT — BPHS Scholar",
  description: "Ask questions about Brihat Parasara Hora Sastra in English or Indian languages",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <JyotishChat />
    </main>
  );
}
