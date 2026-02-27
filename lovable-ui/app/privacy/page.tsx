import Navbar from "@/components/Navbar";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-black">
      <Navbar />
      <div
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/gradient.png')" }}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="max-w-3xl rounded-2xl border border-gray-800 bg-gray-900/70 p-8 text-left text-gray-200 shadow-xl">
          <h1 className="text-3xl font-semibold text-white">Privacy Policy</h1>
          <p className="mt-3 text-sm text-gray-400">Last updated: Today</p>

          <section className="mt-6 space-y-4 text-sm leading-relaxed">
            <p>
              We collect only the information required to run the product,
              authenticate users, and support generated projects. Your data
              stays private and is not sold.
            </p>
            <p>
              Usage analytics may be captured to improve the experience. You can
              request removal of your account data at any time.
            </p>
            <p>
              For privacy questions, contact the team before deploying the
              product in production.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
