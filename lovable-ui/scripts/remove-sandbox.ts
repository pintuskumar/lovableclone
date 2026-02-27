import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from the current working directory
dotenv.config({ path: path.join(process.cwd(), ".env") });

async function removeSandbox(sandboxId: string) {
  const daytonaApiKey = process.env.DAYTONA_API_KEY;

  if (!daytonaApiKey) {
    console.error("ERROR: DAYTONA_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: daytonaApiKey,
  });

  try {
    console.log(`Removing sandbox: ${sandboxId}...`);
    const sandbox = await daytona.get(sandboxId);
    await daytona.delete(sandbox);
    console.log("Sandbox removed successfully");
  } catch (error: any) {
    console.error("Failed to remove sandbox:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];

  if (!sandboxId) {
    console.error("Usage: npx tsx scripts/remove-sandbox.ts <sandbox-id>");
    process.exit(1);
  }

  await removeSandbox(sandboxId);
}

main();
