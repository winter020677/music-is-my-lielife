import RecommendForm from "../components/RecommendForm";

export default function RecommendPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-12">
      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Recommend</h1>
        <p className="text-zinc-500 text-sm mb-8">曲からレコメンドを探す</p>
        <RecommendForm />
      </div>
    </main>
  );
}
