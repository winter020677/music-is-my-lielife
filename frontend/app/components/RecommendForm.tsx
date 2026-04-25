"use client";

import { useState } from "react";

export default function RecommendForm() {
  const [form, setForm] = useState({ title: "", artist: "" });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(
      `http://localhost:8000/songs/recommend?title=${form.title}&artist=${form.artist}`,
    );
    const data = await res.json();
    setResults(data.recommendations);
    setLoading(false);
  }
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }
  return (
    <form className="flex flex-col gap-6 mt-6" onSubmit={handleSubmit}>
      <input
        className="w-full bg-transparent border-b border-zinc-600 text-white py-2 outline-none placeholder-zinc-500"
        name="title"
        value={form.title}
        onChange={handleChange}
        placeholder="曲名"
        required
      />
      <input
        className="w-full bg-transparent border-b border-zinc-600 text-white py-2 outline-none placeholder-zinc-500"
        name="artist"
        value={form.artist}
        onChange={handleChange}
        placeholder="アーティスト"
        required
      />
      <button
        className="mt-4 self-end px-6 py-2 border border-zinc-500 text-white hover:bg-zinc-800 transition-colors"
        type="submit"
        disabled={loading}
      >
        {loading ? "検索中..." : "レコメンドを見る"}
      </button>
      <ul>
        {results.map((rec, i) => (
          <li key={i}>
            <a
              href={rec.spotify_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white hover:text-zinc-400 transition-colors"
            >
              {rec.title} / {rec.artist}
            </a>
          </li>
        ))}
      </ul>
    </form>
  );
}
