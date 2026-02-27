import { Daytona, type Sandbox } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from the lovable-ui directory
dotenv.config({ path: path.join(process.cwd(), ".env") });

// Helper function to retry operations with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3,
  initialDelayMs: number = 2000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);

      // Check if it's a retryable error (timeout, gateway errors, etc.)
      const isRetryable =
        errorMessage.includes("504") ||
        errorMessage.includes("502") ||
        errorMessage.includes("503") ||
        errorMessage.includes("Gateway") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ECONNRESET");

      if (!isRetryable || attempt === maxRetries) {
        console.error(`❌ ${operationName} failed after ${attempt} attempt(s)`);
        throw error;
      }

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.log(
        `⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`,
      );
      console.log(`   Error: ${errorMessage.substring(0, 100)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function generateWebsiteInDaytona(
  sandboxIdArg?: string,
  prompt?: string,
) {
  console.log("🚀 Starting website generation in Daytona sandbox...\n");

  const daytonaApiKey = process.env.DAYTONA_API_KEY;
  const gatewayApiKey = process.env.VERCEL_AI_GATEWAY_API_KEY;

  if (!daytonaApiKey || !gatewayApiKey) {
    console.error(
      "ERROR: DAYTONA_API_KEY and VERCEL_AI_GATEWAY_API_KEY must be set",
    );
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: daytonaApiKey,
  });

  let sandbox: Sandbox | undefined;
  let sandboxId = sandboxIdArg;

  try {
    // Step 1: Create or get sandbox
    if (sandboxId) {
      console.log(`1. Using existing sandbox: ${sandboxId}`);
      // Get existing sandbox
      const sandboxes = await daytona.list();
      sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found`);
      }
      console.log(`✓ Connected to sandbox: ${sandbox.id}`);
    } else {
      console.log("1. Creating new Daytona sandbox...");
      sandbox = await withRetry(
        () =>
          daytona.create({
            public: true,
            image: "node:20",
          }),
        "Create sandbox",
      );
      sandboxId = sandbox.id;
      console.log(`✓ Sandbox created: ${sandboxId}`);
    }

    if (!sandbox) {
      throw new Error("Sandbox initialization failed");
    }

    const activeSandbox = sandbox;

    // Get the root directory
    const rootDir = await activeSandbox.getUserRootDir();
    console.log(`✓ Working directory: ${rootDir}`);

    // Step 2: Create project directory
    console.log("\n2. Setting up project directory...");
    const projectDir = `${rootDir}/website-project`;
    await withRetry(
      () =>
        activeSandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir),
      "Create project directory",
    );
    console.log(`✓ Created project directory: ${projectDir}`);

    // Step 3: Initialize npm project
    console.log("\n3. Initializing npm project...");
    await withRetry(
      () => activeSandbox.process.executeCommand("npm init -y", projectDir),
      "Initialize npm project",
    );
    console.log("✓ Package.json created");

    // Step 4: Install OpenAI SDK (for Vercel AI Gateway's OpenAI-compatible API)
    console.log("\n4. Installing OpenAI SDK for Vercel AI Gateway...");
    const installResult = await withRetry(
      () =>
        activeSandbox.process.executeCommand(
          "npm install openai",
          projectDir,
          undefined,
          180000, // 3 minute timeout
        ),
      "Install OpenAI SDK",
    );

    if (installResult.exitCode !== 0) {
      console.error("Installation failed:", installResult.result);
      throw new Error("Failed to install OpenAI SDK");
    }
    console.log("✓ OpenAI SDK installed");

    // Verify installation
    console.log("\n5. Verifying installation...");
    const checkInstall = await withRetry(
      () =>
        activeSandbox.process.executeCommand(
          "ls -la node_modules/openai",
          projectDir,
        ),
      "Verify installation",
    );
    console.log("Installation check:", checkInstall.result);

    // Step 6: Copy the generation script to sandbox
    console.log("\n6. Copying generation script to sandbox...");

    const userPrompt =
      prompt ||
      "Create a modern blog website with markdown support and a dark theme";

    // Read the generation script from the local file
    const fs = await import("fs");
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "sandbox-generate.js",
    );
    const scriptContent = fs.readFileSync(scriptPath, "utf-8");

    // Write script using base64 to avoid escaping issues
    const base64Script = Buffer.from(scriptContent).toString("base64");
    await withRetry(
      () =>
        activeSandbox.process.executeCommand(
          `echo "${base64Script}" | base64 -d > generate.js`,
          projectDir,
        ),
      "Copy generation script",
    );
    console.log("✓ Generation script copied to generate.js");

    // Verify the script was created
    const checkScript = await withRetry(
      () =>
        activeSandbox.process.executeCommand(
          "ls -la generate.js && head -5 generate.js",
          projectDir,
        ),
      "Verify script",
    );
    console.log("Script verification:", checkScript.result);

    // Step 7: Run the generation script
    console.log("\n7. Running Vercel AI Gateway generation...");
    console.log(`Prompt: "${userPrompt}"`);
    console.log("\nThis may take several minutes...\n");

    const genResult = await withRetry(
      () =>
        activeSandbox.process.executeCommand(
          "node generate.js",
          projectDir,
          {
            VERCEL_AI_GATEWAY_API_KEY: gatewayApiKey,
            DAYTONA_API_KEY: daytonaApiKey,
            ...(process.env.AI_GATEWAY_MODEL
              ? { AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL }
              : {}),
            USER_PROMPT: userPrompt,
            NODE_PATH: `${projectDir}/node_modules`,
          },
          600000, // 10 minute timeout
        ),
      "Run Vercel AI Gateway generation",
      2, // Only 2 retries for this long operation
      5000,
    );

    console.log("\nGeneration output:");
    console.log(genResult.result);

    if (genResult.exitCode !== 0) {
      throw new Error("Generation failed");
    }

    // Step 8: Check generated files
    console.log("\n8. Checking generated files...");
    const filesResult = await withRetry(
      () => activeSandbox.process.executeCommand("ls -la", projectDir),
      "Check generated files",
    );
    console.log(filesResult.result);

    // Step 9: Install dependencies if package.json was updated
    const hasNextJS = await activeSandbox.process.executeCommand(
      "test -f package.json && grep -q next package.json && echo yes || echo no",
      projectDir,
    );

    if (hasNextJS.result?.trim() === "yes") {
      console.log("\n9. Installing project dependencies...");
      const npmInstall = await activeSandbox.process.executeCommand(
        "npm install",
        projectDir,
        undefined,
        300000, // 5 minute timeout
      );

      if (npmInstall.exitCode !== 0) {
        console.log("Warning: npm install had issues:", npmInstall.result);
      } else {
        console.log("✓ Dependencies installed");
      }

      // Step 10: Start dev server in background
      console.log("\n10. Starting development server in background...");

      // Start the server in background using nohup
      await activeSandbox.process.executeCommand(
        `nohup npm run dev > dev-server.log 2>&1 &`,
        projectDir,
        {
          PORT: "3000",
          DAYTONA_API_KEY: daytonaApiKey,
          VERCEL_AI_GATEWAY_API_KEY: gatewayApiKey,
          ...(process.env.AI_GATEWAY_MODEL
            ? { AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL }
            : {}),
        },
      );

      console.log("✓ Server started in background");

      // Wait for server to initialize with retries
      console.log(
        "Waiting for server to start (this may take up to 60 seconds)...",
      );

      let serverReady = false;
      const maxRetries = 12; // 12 retries * 5 seconds = 60 seconds max

      for (let i = 0; i < maxRetries; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const checkServer = await activeSandbox.process.executeCommand(
          "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo 'failed'",
          projectDir,
        );

        const statusCode = checkServer.result?.trim();
        console.log(`  Attempt ${i + 1}/${maxRetries}: Status ${statusCode}`);

        if (statusCode === "200" || statusCode === "304") {
          serverReady = true;
          console.log("✓ Server is running!");
          break;
        }

        // Check if there are build errors
        if (i === 3 || i === 6 || i === 9) {
          const logCheck = await activeSandbox.process.executeCommand(
            "tail -20 dev-server.log 2>/dev/null || echo 'No logs yet'",
            projectDir,
          );
          console.log("  Recent logs:", logCheck.result?.substring(0, 500));
        }
      }

      if (!serverReady) {
        console.log(
          "⚠️  Server might still be starting or encountered an error...",
        );

        // Show the last part of the dev server log
        const logContent = await activeSandbox.process.executeCommand(
          "tail -50 dev-server.log 2>/dev/null || echo 'No logs available'",
          projectDir,
        );
        console.log("\n📋 Dev server logs:");
        console.log(logContent.result);

        // Check if there's a build error
        if (
          logContent.result?.includes("Error") ||
          logContent.result?.includes("Failed")
        ) {
          console.log(
            "\n❌ Build error detected. Trying to fix common issues...",
          );

          // Try to rebuild
          await activeSandbox.process.executeCommand(
            "pkill -f 'next dev' || true",
            projectDir,
          );

          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Restart the server
          await activeSandbox.process.executeCommand(
            `nohup npm run dev > dev-server.log 2>&1 &`,
            projectDir,
            {
              PORT: "3000",
              DAYTONA_API_KEY: daytonaApiKey,
              VERCEL_AI_GATEWAY_API_KEY: gatewayApiKey,
              ...(process.env.AI_GATEWAY_MODEL
                ? { AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL }
                : {}),
            },
          );

          console.log("Restarted dev server, waiting 15 more seconds...");
          await new Promise((resolve) => setTimeout(resolve, 15000));
        }
      }
    }

    // Step 11: Get preview URL
    console.log("\n11. Getting preview URL...");
    const preview = await activeSandbox.getPreviewLink(3000);

    console.log("\n✨ SUCCESS! Website generated!");
    console.log("\n📊 SUMMARY:");
    console.log("===========");
    console.log(`Sandbox ID: ${sandboxId}`);
    console.log(`Project Directory: ${projectDir}`);
    console.log(`Preview URL: ${preview.url}`);
    if (preview.token) {
      console.log(`Access Token: ${preview.token}`);
    }

    console.log("\n🌐 VISIT YOUR WEBSITE:");
    console.log(preview.url);

    console.log("\n💡 TIPS:");
    console.log("- The sandbox will stay active for debugging");
    console.log(
      "- Server logs: SSH in and run 'cat website-project/dev-server.log'",
    );
    console.log(
      `- To get preview URL again: npx tsx scripts/get-preview-url.ts ${sandboxId}`,
    );
    console.log(
      `- To reuse this sandbox: npx tsx scripts/generate-in-daytona.ts ${sandboxId}`,
    );
    console.log(`- To remove: npx tsx scripts/remove-sandbox.ts ${sandboxId}`);

    return {
      success: true,
      sandboxId: sandboxId,
      projectDir: projectDir,
      previewUrl: preview.url,
    };
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);

    if (sandbox) {
      console.log(`\nSandbox ID: ${sandboxId}`);
      console.log("The sandbox is still running for debugging.");

      // Try to get debug info
      try {
        const debugInfo = await sandbox.process.executeCommand(
          "pwd && echo '---' && ls -la && echo '---' && test -f generate.js && cat generate.js | head -20 || echo 'No script'",
          `${await sandbox.getUserRootDir()}/website-project`,
        );
        console.log("\nDebug info:");
        console.log(debugInfo.result);
      } catch (e) {
        // Ignore
      }
    }

    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let sandboxId: string | undefined;
  let prompt: string | undefined;

  // Parse arguments
  if (args.length > 0) {
    // Check if first arg is a sandbox ID (UUID format)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(args[0])) {
      sandboxId = args[0];
      prompt = args.slice(1).join(" ");
    } else {
      prompt = args.join(" ");
    }
  }

  if (!prompt) {
    prompt =
      "Create a modern blog website with markdown support and a dark theme. Include a home page, blog listing page, and individual blog post pages.";
  }

  console.log("📝 Configuration:");
  console.log(
    `- Sandbox: ${sandboxId ? `Using existing ${sandboxId}` : "Creating new"}`,
  );
  console.log(`- Prompt: ${prompt}`);
  console.log();

  try {
    await generateWebsiteInDaytona(sandboxId, prompt);
  } catch (error) {
    console.error("Failed to generate website:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Exiting... The sandbox will continue running.");
  process.exit(0);
});

main();
