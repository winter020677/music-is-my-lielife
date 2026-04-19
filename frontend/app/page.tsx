import SongForm from "./components/SongForm"

  export default function Home() {
    return (
      <main className="min-h-screen bg-zinc-950 p-8">
        <h1 className="text-3xl font-bold text-white">
          Music is my lielife
        </h1>
        <SongForm/>
      </main>
    )
  }
