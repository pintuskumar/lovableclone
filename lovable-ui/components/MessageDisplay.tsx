// Define message types for AI API responses
export interface PerplexitySDKMessage {
  type: "text" | "assistant" | "result" | "error" | "progress";
  content?: string;
  message?: {
    content: string | { type: string; text: string }[];
  };
  subtype?: string;
  result?: string;
}

interface MessageDisplayProps {
  messages: PerplexitySDKMessage[];
}

export default function MessageDisplay({ messages }: MessageDisplayProps) {
  if (messages.length === 0) return null;

  // Filter to show only relevant messages
  const displayMessages = messages.filter(m =>
    m.type === "text" || m.type === "assistant" || m.type === "result" || m.type === "progress"
  );

  return (
    <div className="mt-8 max-w-4xl mx-auto px-4">
      <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800 p-6 max-h-[600px] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">AI Assistant (Vercel AI Gateway)</h3>
        </div>

        <div className="space-y-3">
          {displayMessages.map((message, index) => {
            // Text content streaming
            if (message.type === "text" && message.content) {
              return (
                <div key={index} className="animate-fadeIn">
                  <div className="text-gray-300 leading-relaxed font-mono text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>
                </div>
              );
            }

            // Assistant messages
            if (message.type === "assistant" && message.message?.content) {
              const content = message.message.content;
              const textContent = Array.isArray(content)
                ? content.find((c) => c.type === "text")?.text
                : content;

              if (!textContent) return null;

              return (
                <div key={index} className="animate-fadeIn">
                  <div className="text-gray-300 leading-relaxed">
                    {textContent}
                  </div>
                </div>
              );
            }

            // Progress messages
            if (message.type === "progress" && message.content) {
              return (
                <div key={index} className="animate-fadeIn">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span className="font-mono">{message.content}</span>
                  </div>
                </div>
              );
            }

            // Final result
            if (message.type === "result" && message.subtype === "success") {
              return (
                <div key={index} className="animate-fadeIn mt-4">
                  <div className="bg-green-900/20 border border-green-700 rounded-lg p-4">
                    <div className="text-green-400 font-semibold mb-2">
                      Generation complete
                    </div>
                    <div className="text-gray-300 text-sm whitespace-pre-wrap">
                      {message.result || message.content}
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {/* Show typing indicator if still generating */}
          {messages.length > 0 && !messages.some((m) => m.type === "result") && (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm">AI is working...</span>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
