import OpenAI from "openai";

const DEFAULT_AI_GATEWAY_MODEL = "anthropic/claude-sonnet-4.5";
const AI_GATEWAY_MODEL =
    process.env.AI_GATEWAY_MODEL || DEFAULT_AI_GATEWAY_MODEL;

function getAiGatewayApiKey() {
    const apiKey =
        process.env.AI_GATEWAY_API_KEY?.trim() ||
        process.env.VERCEL_AI_GATEWAY_API_KEY?.trim();

    if (!apiKey) {
        throw new Error(
            "AI_GATEWAY_API_KEY or VERCEL_AI_GATEWAY_API_KEY must be set"
        );
    }

    return apiKey;
}

// Create the client lazily so route modules can be imported during build
// even when the runtime secret is not configured in the build environment.
export function getAiClient() {
    return new OpenAI({
        apiKey: getAiGatewayApiKey(),
        baseURL: "https://ai-gateway.vercel.sh/v1",
    });
}

export interface PerplexityMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export type AIMessage = PerplexityMessage;

export interface PerplexityResponse {
    id: string;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    citations?: string[];
}
export type AIResponse = PerplexityResponse;

export interface CodeGenerationResult {
    success: boolean;
    content: string;
    citations?: string[];
    error?: string;
}

export async function generateCodeWithPerplexity(
    prompt: string
): Promise<CodeGenerationResult> {
    try {
        const aiClient = getAiClient();
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

        const response = await aiClient.chat.completions.create({
            model: AI_GATEWAY_MODEL,
            messages: messages,
            temperature: 0.2,
            max_tokens: 4096,
        });

        const content = response.choices[0]?.message?.content || "";
        const citations = (response as any).citations || [];

        return {
            success: true,
            content: content,
            citations: citations,
        };
    } catch (error: any) {
        console.error("Error generating code via Vercel AI Gateway:", error);
        return {
            success: false,
            content: "",
            error: error.message,
        };
    }
}

export async function* streamGenerateCodeWithPerplexity(
    prompt: string
): AsyncGenerator<{ type: string; content?: string; error?: string }> {
    try {
        const aiClient = getAiClient();
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

        const stream = await aiClient.chat.completions.create({
            model: AI_GATEWAY_MODEL,
            messages: messages,
            temperature: 0.2,
            max_tokens: 4096,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                yield { type: "text", content };
            }
        }

        yield { type: "complete" };
    } catch (error: any) {
        console.error("Error streaming from Vercel AI Gateway:", error);
        yield { type: "error", error: error.message };
    }
}

export const generateCode = generateCodeWithPerplexity;
export const streamGenerateCode = streamGenerateCodeWithPerplexity;

export { getAiClient as aiClient, getAiClient as perplexity };
