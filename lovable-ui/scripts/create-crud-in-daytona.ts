import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from the current working directory
dotenv.config({ path: path.join(process.cwd(), ".env") });

const CRUD_PAGE = `"use client";

import { useEffect, useMemo, useState } from "react";

type TaskStatus = "todo" | "in_progress" | "done";

type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
};

const STORAGE_KEY = "crud_tasks_v1";

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const createId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Task[];
        setTasks(parsed);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Ignore storage errors.
    }
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesQuery =
        task.title.toLowerCase().includes(query.toLowerCase()) ||
        task.description.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === "all" || task.status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [tasks, query, filter]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setEditingId(null);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    if (editingId) {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === editingId
            ? {
                ...task,
                title: title.trim(),
                description: description.trim(),
                status,
              }
            : task,
        ),
      );
      resetForm();
      return;
    }

    const newTask: Task = {
      id: createId(),
      title: title.trim(),
      description: description.trim(),
      status,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [newTask, ...prev]);
    resetForm();
  };

  const handleEdit = (task: Task) => {
    setEditingId(task.id);
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
  };

  const handleDelete = (taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    if (editingId === taskId) {
      resetForm();
    }
  };

  const clearAll = () => {
    setTasks([]);
    resetForm();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
              CRUD Dashboard
            </p>
            <h1 className="text-3xl font-semibold sm:text-4xl">
              Task Manager
            </h1>
          </div>
          <div className="rounded-full border border-slate-800 bg-slate-900/50 px-4 py-2 text-xs text-slate-400">
            Stored in localStorage
          </div>
        </header>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1.9fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editingId ? "Edit task" : "Create task"}
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              )}
            </div>

            <label className="mt-6 block text-sm text-slate-300">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                placeholder="e.g. Ship CRUD MVP"
              />
            </label>

            <label className="mt-4 block text-sm text-slate-300">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-2 min-h-[120px] w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                placeholder="Add any context or details."
              />
            </label>

            <label className="mt-4 block text-sm text-slate-300">
              Status
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as TaskStatus)
                }
                className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="mt-6 w-full rounded-xl bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white"
            >
              {editingId ? "Save changes" : "Add task"}
            </button>
          </form>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Your tasks</h2>
                <p className="text-sm text-slate-400">
                  {tasks.length} total, {filteredTasks.length} visible
                </p>
              </div>
              <button
                onClick={clearAll}
                className="rounded-full border border-slate-700 px-4 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Clear all
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
                placeholder="Search tasks..."
              />
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as TaskStatus | "all")
                }
                className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white focus:border-slate-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-6 space-y-4">
              {filteredTasks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-400">
                  No tasks match your filters yet.
                </div>
              )}

              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-white">
                          {task.title}
                        </h3>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          {
                            statusOptions.find(
                              (option) => option.value === task.status,
                            )?.label
                          }
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {task.description || "No description provided."}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Created {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(task)}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="rounded-full border border-red-700/60 px-3 py-1 text-xs text-red-200 hover:border-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
`;

async function createCrudAppInDaytona() {
  console.log("Starting CRUD app setup in Daytona...");

  const daytonaApiKey = process.env.DAYTONA_API_KEY;
  if (!daytonaApiKey) {
    console.error("ERROR: DAYTONA_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({ apiKey: daytonaApiKey });

  console.log("1. Creating sandbox...");
  const sandbox = await daytona.create({ public: true, image: "node:20" });
  console.log(`Sandbox created: ${sandbox.id}`);

  const rootDir = await sandbox.getUserRootDir();
  if (!rootDir) {
    throw new Error("Failed to resolve sandbox root directory");
  }

  const projectDir = `${rootDir}/crud-app`;

  console.log("\n2. Creating Next.js app...");
  const createResult = await sandbox.process.executeCommand(
    "npx create-next-app@latest crud-app --typescript --tailwind --app --no-git --yes --use-npm",
    rootDir,
    undefined,
    600000,
  );

  if (createResult.exitCode !== 0) {
    throw new Error(`create-next-app failed: ${createResult.result}`);
  }

  console.log("\n3. Writing CRUD page...");
  const escapedPage = CRUD_PAGE.replace(/'/g, "'\"'\"'");
  const writeResult = await sandbox.process.executeCommand(
    `echo '${escapedPage}' > app/page.tsx`,
    projectDir,
  );

  if (writeResult.exitCode !== 0) {
    throw new Error(`Failed to write app/page.tsx: ${writeResult.result}`);
  }

  console.log("\n4. Starting dev server...");
  const devResult = await sandbox.process.executeCommand(
    "nohup npm run dev > dev-server.log 2>&1 &",
    projectDir,
    { PORT: "3000" },
  );

  if (devResult.exitCode !== 0) {
    throw new Error(`Failed to start dev server: ${devResult.result}`);
  }

  console.log("Waiting for server to start...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const checkServer = await sandbox.process.executeCommand(
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'failed'",
    projectDir,
  );
  console.log(`Server status: ${checkServer.result?.trim()}`);

  console.log("\n5. Getting preview URL...");
  const preview = await sandbox.getPreviewLink(3000);

  console.log("\nPreview URL:");
  console.log(preview.url);

  if (preview.token) {
    console.log("\nPreview Token:");
    console.log(preview.token);
  }

  console.log("\nSandbox ID:");
  console.log(sandbox.id);

  console.log("\nTo remove the sandbox later:");
  console.log(`npx tsx scripts/remove-sandbox.ts ${sandbox.id}`);
}

createCrudAppInDaytona().catch((error: any) => {
  console.error("Failed to create CRUD app:", error.message);
  process.exit(1);
});
