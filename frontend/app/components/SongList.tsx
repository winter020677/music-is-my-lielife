"use client";

import { useRouter } from "next/navigation";

type Post = {
  id: number;
  title: string;
  artist: string;
  listened_at: string;
  mood: string | null;
  favorite_part: string | null;
};

export default function SongList({ posts }: { posts: Post[] }) {
  const router = useRouter();

  async function handleDelete(id: number) {
    await fetch(`http://localhost:8000/songs/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
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
              <p className="text-sm text-zinc-400">mood: {post.mood}</p>
            )}
            {post.favorite_part && (
              <p className="text-sm text-zinc-400">
                favorite: {post.favorite_part}
              </p>
            )}
            <button
              onClick={() => handleDelete(post.id)}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors mt-1"
            >
              削除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
