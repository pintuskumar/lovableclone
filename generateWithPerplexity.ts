import OpenAI from "openai";

const DEFAULT_AI_GATEWAY_MODEL = "anthropic/claude-sonnet-4.5";
const AI_GATEWAY_MODEL =
  process.env.AI_GATEWAY_MODEL || DEFAULT_AI_GATEWAY_MODEL;

// Initialize Vercel AI Gateway client using the OpenAI SDK
const perplexity = new OpenAI({
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh/v1",
});

interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CodeGenerationResult {
  success: boolean;
  content: string;
  citations?: string[];
  error?: string;
}

export async function generateCodeWithPerplexity(
  prompt: string
): Promise<CodeGenerationResult> {
  try {
    const messages: PerplexityMessage[] = [
      {
        role: "system",
        content: `You are an expert web developer. When asked to create websites or web applications, provide complete, working code.

Important requirements:
- Generate complete, production-ready code
- Include all necessary imports and dependencies
- Use modern best practices (TypeScript, React, Next.js, Tailwind CSS)
- Make the design modern and responsive
- Include proper error handling`,
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    console.log(
      `Starting code generation with Vercel AI Gateway (${AI_GATEWAY_MODEL})...`,
    );

    const response = await perplexity.chat.completions.create({
      model: AI_GATEWAY_MODEL,
      messages: messages,
      temperature: 0.2,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || "";
    const citations = (response as any).citations || [];

    console.log("[result]", { success: true, contentLength: content.length });

    return {
      success: true,
      content: content,
      citations: citations,
    };
  } catch (error: any) {
    console.error("Error generating code:", error);
    return {
      success: false,
      content: "",
      error: error.message,
    };
  }
}

// Main execution for CLI usage
async function main() {
  const prompt =
    process.argv[2] ||
    "Create a simple React component that displays a greeting";

  console.log("Prompt:", prompt);
  console.log();

  const result = await generateCodeWithPerplexity(prompt);

  if (result.success) {
    console.log("\n=== Generated Code ===\n");
    console.log(result.content);
    if (result.citations && result.citations.length > 0) {
      console.log("\n=== Citations ===");
      result.citations.forEach((citation, i) => {
        console.log(`${i + 1}. ${citation}`);
      });
    }
  } else {
    console.error("Generation failed:", result.error);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
