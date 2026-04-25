import Link from "next/link";
import SongForm from "./components/SongForm";
import RecommendForm from "./components/RecommendForm";
import SongList from "./components/SongList";
import MoodChart from "./components/MoodChart";

export default async function Home() {
  const data = await fetch("http://localhost:8000/songs");
  const posts = await data.json();
  const trendData = await fetch("http://localhost:8000/songs/mood-trend", {
    cache: "no-store",
  });
  const trend = await trendData.json();
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-12">
      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">
          Music is my lielife
        </h1>
        <p className="text-zinc-500 text-sm mb-8">
          あなたの人生の音楽を記録する
        </p>
        <Link
          href="/recommend"
          className="text-zinc-400 text-sm hover:text-white transition-colors"
        >
          → レコメンドを探す
        </Link>
        <SongForm />
        <SongList posts={posts} />
        <MoodChart trend={trend.trend} />
      </div>
    </main>
  );
}
