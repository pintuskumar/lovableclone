import { generateCodeWithPerplexity } from "./generateWithClaudeCode";

async function testPerplexityAPI() {
  console.log("Testing Perplexity API by generating a Tic-Tac-Toe game...\n");

  const prompt = `Create a simple Tic-Tac-Toe game in a single HTML file with:
  - Complete game logic in JavaScript
  - Player vs Player gameplay
  - Nice CSS styling with a modern look
  - Win detection and game reset functionality
  - Display current player turn
  - Highlight winning combination
  
  Provide the complete HTML file content.`;

  const result = await generateCodeWithPerplexity(prompt);

  if (result.success) {
    console.log("\n✅ Code generation completed successfully!");
    console.log(`Content length: ${result.content.length} characters`);

    // Show a preview of the generated content
    console.log("\n=== Generated Content Preview ===");
    console.log(result.content.substring(0, 500) + "...");

    if (result.citations && result.citations.length > 0) {
      console.log("\n=== Citations ===");
      result.citations.forEach((citation, i) => {
        console.log(`${i + 1}. ${citation}`);
      });
    }
  } else {
    console.error("\n❌ Code generation failed:", result.error);
  }
}

// Run the test
testPerplexityAPI().catch(console.error);