import SongForm from "./components/SongForm";

export default async function Home() {
  const data = await fetch("http://localhost:8000/songs");
  const posts = await data.json();
  return (
    <main className="min-h-screen bg-zinc-950 p-8">
      <h1 className="text-3xl font-bold text-white">Music is my lielife</h1>
      <SongForm />
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            {post.title}
            {post.artist}
          </li>
        ))}
      </ul>
    </main>
  );
}
