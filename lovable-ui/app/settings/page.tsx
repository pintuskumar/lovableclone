import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function SettingsPage() {
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
            Settings
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            Personalize your workspace
          </h1>
          <p className="mt-4 text-gray-300">
            Settings are coming soon. You will be able to manage your profile,
            API keys, and workspace preferences here.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="px-5 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-100 transition-colors"
            >
              Back home
            </Link>
            <Link
              href="/register"
              className="px-5 py-2 rounded-lg border border-gray-700 text-gray-200 hover:border-gray-500 transition-colors"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
