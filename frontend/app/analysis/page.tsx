import MoodChart from "../components/MoodChart";

import Link from "next/link";

export default async function AnalysisPage() {
  const res = await fetch("http://localhost:8000/songs/mood-trend", {
    cache: "no-store",
  });
  const trend = await res.json();
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-12">
      <div className="max-w-xl mx-auto">
        <Link
          href="/"
          className="block text-zinc-400 text-sm hover:text-white transition-colors mb-5"
        >
          → TOPに戻る
        </Link>
        <h1 className="text-3xl font-bold text-white mb-2">MoodChart</h1>
        <p className="text-zinc-500 text-sm mb-8">気分グラフ</p>
        <MoodChart trend={trend.trend} />
      </div>
    </main>
  );
}
