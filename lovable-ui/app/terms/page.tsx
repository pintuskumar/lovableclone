import Navbar from "@/components/Navbar";

export default function TermsPage() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-black">
      <Navbar />
      <div
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/gradient.png')" }}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="max-w-3xl rounded-2xl border border-gray-800 bg-gray-900/70 p-8 text-left text-gray-200 shadow-xl">
          <h1 className="text-3xl font-semibold text-white">Terms of Service</h1>
          <p className="mt-3 text-sm text-gray-400">Last updated: Today</p>

          <section className="mt-6 space-y-4 text-sm leading-relaxed">
            <p>
              By using this product, you agree to follow acceptable use
              guidelines and keep your account secure. You are responsible for
              the content you generate and share.
            </p>
            <p>
              The service is provided as-is. We may update features, limits, or
              availability over time to improve reliability and performance.
            </p>
            <p>
              If you have questions about these terms, contact the team before
              deploying the product in production.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
