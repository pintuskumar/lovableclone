"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";

type PromptGroup = {
  label: string;
  hint: string;
  prompts: Array<{ title: string; prompt: string }>;
};

const PROMPT_GROUPS: PromptGroup[] = [
  {
    label: "Quick starts",
    hint: "Common projects that generate quickly",
    prompts: [
      {
        title: "Blog website",
        prompt: "Create a modern blog website with markdown support and a featured posts section.",
      },
      {
        title: "Portfolio site",
        prompt: "Build a portfolio website with project showcase, about section, and contact form.",
      },
      {
        title: "E-commerce",
        prompt: "Create an e-commerce product catalog with filters, cart UI, and responsive product cards.",
      },
      {
        title: "Dashboard",
        prompt: "Build a dashboard with charts, tables, KPI cards, and mobile responsive layout.",
      },
    ],
  },
  {
    label: "Higher complexity",
    hint: "Prompts with multiple sections, interactions, and stronger visual direction",
    prompts: [
      {
        title: "SaaS marketing",
        prompt:
          "Build a SaaS marketing website with pricing, testimonials, FAQ, and a contact form. Use a bold visual style and responsive layout.",
      },
      {
        title: "Admin dashboard",
        prompt:
          "Create an admin dashboard with sidebar navigation, KPI cards, charts, table filters, and mobile responsive behavior.",
      },
      {
        title: "Restaurant brand",
        prompt:
          "Design a restaurant website with menu browsing, reservations form, event highlights, and a warm editorial visual style.",
      },
    ],
  },
];

const UX_HINTS = [
  "Be specific about sections and pages",
  "Mention style direction (bold, minimal, editorial)",
  "Add mobile behavior requirements",
  "Call out forms, charts, filters, or interactions",
];

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [isPending, startTransition] = useTransition();

  const trimmedPrompt = prompt.trim();
  const charCount = prompt.length;

  const handleGenerate = () => {
    if (!trimmedPrompt) return;

    startTransition(() => {
      router.push(`/generate?prompt=${encodeURIComponent(trimmedPrompt)}`);
    });
  };

  const applyPrompt = (nextPrompt: string) => {
    setPrompt(nextPrompt);
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-black">
      <Navbar />

      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-80 bg-cover bg-center"
          style={{ backgroundImage: "url('/gradient.png')" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.12),transparent_38%),radial-gradient(circle_at_80%_25%,rgba(59,130,246,0.16),transparent_42%),linear-gradient(to_bottom,rgba(0,0,0,0.25),rgba(0,0,0,0.7))]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] [background-size:32px_32px]" />
      </div>

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 pt-28 sm:pt-32 pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 lg:gap-8 items-start">
            <section className="space-y-6">
              <div className="inline-flex items-center gap-2 ui-pill px-3 py-1.5 text-xs text-gray-200 backdrop-blur">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Vercel AI Gateway + Daytona sandboxes
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl leading-tight font-semibold text-white tracking-tight">
                  Turn a prompt into a working UI and live preview
                </h1>
                <p className="text-base sm:text-lg text-gray-300 max-w-2xl leading-relaxed">
                  Describe the product, sections, and interactions you want. Lovable-clone generates the code in an isolated Daytona sandbox and opens a live preview you can edit immediately.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <div className="ui-card ui-card-hover p-3">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Flow</div>
                  <div className="mt-1 text-sm text-white">Prompt to preview</div>
                </div>
                <div className="ui-card ui-card-hover p-3">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Runtime</div>
                  <div className="mt-1 text-sm text-white">Isolated sandbox</div>
                </div>
                <div className="ui-card ui-card-hover p-3">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Editor</div>
                  <div className="mt-1 text-sm text-white">Live code edits</div>
                </div>
                <div className="ui-card ui-card-hover p-3">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Model</div>
                  <div className="mt-1 text-sm text-white">Gateway-backed</div>
                </div>
              </div>

              <div className="ui-card ui-card-hover p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-white">Prompt quality tips</h2>
                  <span className="text-xs text-gray-500">Faster results with better specs</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-300">
                  {UX_HINTS.map((hint) => (
                    <div key={hint} className="flex items-center gap-2 ui-chip px-3 py-2">
                      <span className="text-blue-300">•</span>
                      <span>{hint}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="glass-panel ui-ring-frame rounded-3xl p-4 sm:p-5 lg:p-6">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-white font-semibold">Start with a prompt</h2>
                  <p className="text-sm text-gray-400 mt-1">Enter to generate, Shift+Enter for a new line</p>
                </div>
                <span className="text-xs px-2 py-1 ui-pill text-gray-300">
                  {charCount} chars
                </span>
              </div>

              <div className="rounded-2xl ui-ring-frame bg-black/40 shadow-inner shadow-black/30 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 text-xs text-gray-400 ui-divider-bottom">
                  <span>Prompt</span>
                  <span>{trimmedPrompt ? "Ready to generate" : "Describe the app you want"}</span>
                </div>

                <label htmlFor="prompt" className="sr-only">
                  Describe what you want to build
                </label>
                <textarea
                  id="prompt"
                  placeholder="Create a modern SaaS landing page with pricing, testimonials, FAQ, and a waitlist form. Use a bold visual style and responsive navigation..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  className="w-full px-4 sm:px-5 py-4 bg-transparent text-white placeholder-gray-500 focus:outline-none text-base sm:text-lg resize-none min-h-[170px] max-h-[320px]"
                  rows={5}
                />

                <div className="border-t border-white/10 p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="text-xs text-gray-500">
                    Tip: mention layout sections, interactions, and visual style for better output.
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!trimmedPrompt || isPending}
                    aria-label="Generate project"
                    className="ui-btn ui-btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold"
                  >
                    {isPending ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        Generate project
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 12h14M13 5l7 7-7 7"
                          />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {PROMPT_GROUPS.map((group) => (
                  <div key={group.label} className="ui-card ui-card-hover p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3">
                      <div className="text-sm font-medium text-white">{group.label}</div>
                      <div className="text-xs text-gray-500">{group.hint}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.prompts.map((item) => (
                        <button
                          key={item.title}
                          type="button"
                          onClick={() => applyPrompt(item.prompt)}
                          className="ui-chip px-3 py-2 text-sm"
                          title={item.prompt}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
