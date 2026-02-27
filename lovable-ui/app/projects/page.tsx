import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function ProjectsPage() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-black">
      <Navbar />
      <div
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/gradient.png')" }}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-400">
            Projects
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            Your generated work
          </h1>
          <p className="mt-4 text-gray-300">
            Projects will appear here once you start generating. You can also
            sign in to sync them across devices.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/generate?prompt=Create%20a%20product%20roadmap%20dashboard"
              className="px-5 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-100 transition-colors"
            >
              Generate a project
            </Link>
            <Link
              href="/login"
              className="px-5 py-2 rounded-lg border border-gray-700 text-gray-200 hover:border-gray-500 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
