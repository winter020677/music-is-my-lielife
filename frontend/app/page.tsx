import Link from "next/link";
import SongForm from "./components/SongForm";
import SongList from "./components/SongList";

export default async function Home() {
  const data = await fetch("http://localhost:8000/songs");

  const posts = await data.json();

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
          className="block text-zinc-400 font-bold text-sm hover:text-white transition-colors"
        >
          → レコメンドを探す
        </Link>
        <Link
          href="/analysis"
          className="block text-zinc-400 font-bold text-sm hover:text-white transition-colors"
        >
          → 気分グラフはこちら
        </Link>
        <SongForm />
        <h2 className="text-2xl font-bold text-white mb-2">Songs log</h2>

        <SongList posts={posts} />
      </div>
    </main>
  );
}
