# Lovable Clone

Thank you so much for checking out this project! 🙏  
We appreciate your interest and hope you enjoy exploring and building with it.

This is a Lovable clone built with Claude Code SDK that generates websites in isolated Daytona sandboxes.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- API keys (see below)

## Getting Started

### 1. Get Your API Keys

Before you begin, you'll need to obtain API keys:

- **Vercel AI Gateway API key**: Create it using the [Vercel AI Gateway docs](https://examples.vercel.com/docs/ai-gateway)
- **Daytona API key**: Get it from [Daytona Dashboard](https://www.daytona.io/)

### 2. Set Up Environment Variables

Navigate to the `lovable-ui` directory and create a `.env` file:

```bash
cd lovable-ui
```

Copy the example environment file and add your keys:

```bash
cp .env.example .env
```

Edit the `.env` file and replace the placeholder values:

```env
VERCEL_AI_GATEWAY_API_KEY=your_actual_vercel_ai_gateway_api_key
DAYTONA_API_KEY=your_actual_daytona_api_key
```

**Important:** Never commit your `.env` file to version control!

### 3. Install Dependencies

From the `lovable-ui` directory, install all dependencies:

```bash
npm install
```

### 4. Run the Development Server

Start the Next.js development server:

```bash
npm run dev
```

This will launch the app locally at [http://localhost:3000](http://localhost:3000).

## How It Works

1. **Enter a prompt**: Describe the website you want to build
2. **AI Generation**: The system uses Vercel AI Gateway (OpenAI-compatible) to generate complete Next.js code
3. **Isolated Sandbox**: Code is deployed to a Daytona sandbox for safe execution
4. **Live Preview**: View your generated website in real-time

The server injects `VERCEL_AI_GATEWAY_API_KEY` and `DAYTONA_API_KEY` into sandbox processes as environment variables (it does not write a sandbox `.env` file).

## Project Structure

```
lovable-clone-daytona/
├── lovable-ui/              # Main Next.js application
│   ├── app/                 # Next.js app router pages
│   │   ├── page.tsx         # Home page
│   │   ├── generate/        # Generation page
│   │   └── api/             # API routes
│   ├── components/          # React components
│   ├── scripts/             # Daytona sandbox scripts
│   │   ├── generate-in-daytona.ts    # Main generation script
│   │   ├── sandbox-generate.js       # Runs inside sandbox
│   │   └── get-preview-url.ts        # Get sandbox preview URL
│   └── lib/                 # Utility libraries
└── .env.example            # Environment variables template
```

## Scripts

You can also run the generation scripts directly from the command line:

### Generate a website in a new sandbox:
```bash
cd lovable-ui
npx tsx scripts/generate-in-daytona.ts "Create a blog website"
```

### Reuse an existing sandbox:
```bash
npx tsx scripts/generate-in-daytona.ts <sandbox-id> "Your prompt"
```

### Get preview URL for existing sandbox:
```bash
npx tsx scripts/get-preview-url.ts <sandbox-id>
```

### Remove a sandbox:
```bash
npx tsx scripts/remove-sandbox.ts <sandbox-id>
```

## Troubleshooting

### "Missing API keys" error
- Ensure your `.env` file exists in the `lovable-ui` directory
- Verify both `VERCEL_AI_GATEWAY_API_KEY` and `DAYTONA_API_KEY` are set
- Check that there are no extra spaces or quotes around the values

### Generation fails or times out
- Check your Vercel AI Gateway API key is valid and has access to the selected model
- Verify your Daytona API key has access to create sandboxes
- The generation process can take 5-10 minutes for complex websites

### Preview not loading
- Wait a few more seconds - the dev server takes time to start
- Check the sandbox is still running in your Daytona dashboard
- Try accessing the preview URL directly from the generation logs

### Port already in use
- Make sure no other Next.js development server is running on port 3000
- Kill any existing processes: `npx kill-port 3000`
- Change the port in `package.json` dev script if needed

## Features

- ✨ AI-powered website generation using Vercel AI Gateway
- 🔒 Isolated sandbox environments via Daytona
- 🎨 Modern UI with Tailwind CSS
- ⚡ Real-time streaming updates during generation
- 🌐 Live preview of generated websites
- 📦 Complete Next.js projects with TypeScript

## Technology Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **AI**: Vercel AI Gateway (OpenAI-compatible, via OpenAI SDK)
- **Sandboxes**: Daytona SDK
- **Language**: TypeScript
- **Runtime**: Node.js 20

## Development

### Built With Claude Code SDK

This project was built using the Claude Code SDK, demonstrating how to create a full-stack AI-powered web application with isolated code execution environments.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Support

If you encounter any issues or have questions:
1. Check the troubleshooting section above
2. Review the Daytona documentation: https://www.daytona.io/docs
3. Check Vercel AI Gateway docs: https://examples.vercel.com/docs/ai-gateway

---

Made with ❤️ using Claude Code
