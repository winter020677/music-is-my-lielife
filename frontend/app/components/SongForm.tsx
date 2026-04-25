"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SongForm() {
  const [form, setForm] = useState({
    title: "",
    artist: "",
    listened_at: "",
    mood: "",
    favorite_part: "",
  });

  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("http://localhost:8000/songs/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        listened_at: new Date(form.listened_at).toISOString(),
      }),
    });
    setLoading(false);
    alert("記録完了");
    setForm({
      title: "",
      artist: "",
      listened_at: "",
      mood: "",
      favorite_part: "",
    });
    router.refresh();
    // console.log("submit fired", form);
    // console.log("response", res.status);
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
      <input
        className="w-full bg-transparent border-b border-zinc-600 text-white py-2 outline-none placeholder-zinc-500"
        name="listened_at"
        value={form.listened_at}
        onChange={handleChange}
        type="datetime-local"
        required
      />
      <select
        className="w-full bg-transparent border-b border-zinc-600 text-white py-2 outline-none"
        name="mood"
        value={form.mood}
        onChange={handleChange}
      >
        <option value="">気分（任意）</option>
        <option value="happy">happy</option>
        <option value="calm">calm</option>
        <option value="neutral">neutral</option>
        <option value="tired">tired</option>
        <option value="sad">sad</option>
      </select>
      <textarea
        className="w-full bg-transparent border-b border-zinc-600 text-white py-2 outline-none placeholder-zinc-500"
        name="favorite_part"
        value={form.favorite_part}
        onChange={handleChange}
        placeholder="お気に入りのパート（任意）"
      />
      <button
        className="mt-4 self-end px-6 py-2 border border-zinc-500 text-white hover:bg-zinc-800 transition-colors"
        type="submit"
        disabled={loading}
      >
        {loading ? "送信中..." : "記録する"}
      </button>
    </form>
  );
}
