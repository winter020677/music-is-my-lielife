"use client";

import { useState } from "react";

export default function SongForm() {
  const [form, setForm] = useState({
    title: "",
    artist: "",
    listened_at: "",
    mood: "",
    favorite_part: "",
  });

  const [loading, setLoading] = useState(false);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
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
    // console.log("submit fired", form);
    // console.log("response", res.status);
  }
  return (
    <form onSubmit={handleSubmit}>
      <input
        name="title"
        value={form.title}
        onChange={handleChange}
        placeholder="曲名"
        required
      />
      <input
        name="artist"
        value={form.artist}
        onChange={handleChange}
        placeholder="アーティスト"
        required
      />
      <input
        name="listened_at"
        value={form.listened_at}
        onChange={handleChange}
        type="datetime-local"
        required
      />
      <input
        name="mood"
        value={form.mood}
        onChange={handleChange}
        placeholder="気分（任意）"
      />
      <textarea
        name="favorite_part"
        value={form.favorite_part}
        onChange={handleChange}
        placeholder="お気に入りのパート（任意）"
      />
      <button type="submit" disabled={loading}>
        {loading ? "送信中..." : "記録する"}
      </button>
    </form>
  );
}
