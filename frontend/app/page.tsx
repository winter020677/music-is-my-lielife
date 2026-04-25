import SongForm from "./components/SongForm";

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
        <SongForm />
        <ul className="mt-12 space-y-6">
          {posts.map((post) => (
            <li key={post.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-zinc-400 mt-1" />
                <div className="w-px flex-1 bg-zinc-700" />
              </div>
              <div className="pb-6">
                <p className="text-xs text-zinc-500">
                  {new Date(post.listened_at).toLocaleString("ja-JP")}
                </p>
                <p className="text-white">
                  {post.title} / {post.artist}
                </p>
                {post.mood && (
                  <p className="text-sm text-zinc-400">{post.mood}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
