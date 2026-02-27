# Setup Checklist ✅

Use this checklist to ensure your Lovable Clone Daytona project is properly configured and ready to use.

## Prerequisites ✓

- [ ] Node.js 18 or higher installed
  ```bash
  node --version
  # Should show v18.x.x or higher
  ```

- [ ] npm installed
  ```bash
  npm --version
  # Should show 9.x.x or higher
  ```

## API Keys ✓

- [ ] Vercel AI Gateway API key created (see docs: [https://examples.vercel.com/docs/ai-gateway](https://examples.vercel.com/docs/ai-gateway))
- [ ] Daytona API key obtained from [https://www.daytona.io/](https://www.daytona.io/)
- [ ] Both API keys have active credits/quota

## Environment Setup ✓

- [ ] Navigated to `lovable-ui` directory
  ```bash
  cd lovable-ui
  ```

- [ ] Created `.env` file from example
  ```bash
  cp .env.example .env
  ```

- [ ] Opened `.env` file and added real API keys
  ```bash
  # Edit .env file - should look like:
  VERCEL_AI_GATEWAY_API_KEY=vck_xxxxxxxxxxxxx
  DAYTONA_API_KEY=daytona_xxxxxxxxxxxxx
  ```

- [ ] Verified `.env` file is in `.gitignore` (it should be by default)

## Installation ✓

- [ ] Installed dependencies in `lovable-ui`
  ```bash
  npm install
  ```

- [ ] No errors during installation
- [ ] `node_modules` directory created

## Quick Test ✓

- [ ] Started development server
  ```bash
  npm run dev
  ```

- [ ] Server running without errors
- [ ] Can access [http://localhost:3000](http://localhost:3000) in browser
- [ ] Home page loads correctly with gradient background
- [ ] Input field is visible and functional

## Functionality Test ✓

- [ ] Entered a simple prompt (e.g., "Create a simple hello world page")
- [ ] Clicked send button or pressed Enter
- [ ] Redirected to `/generate` page
- [ ] Progress messages appear in left panel
- [ ] No error messages appear
- [ ] Generation completes (may take 5-10 minutes)
- [ ] Preview URL generated
- [ ] Website preview loads in right panel

## Optional: CLI Test ✓

- [ ] Tested standalone script
  ```bash
  npx tsx scripts/generate-in-daytona.ts "Create a simple counter app"
  ```

- [ ] Script runs without errors
- [ ] Sandbox created successfully
- [ ] Preview URL provided
- [ ] Can access generated website

## Troubleshooting Completed ✓

If you encountered any issues, check these:

- [ ] Verified API keys are correct (no extra spaces, quotes, or line breaks)
- [ ] Checked API key quotas/credits are not exhausted
- [ ] Confirmed port 3000 is not already in use
- [ ] Ensured firewall allows Node.js to run
- [ ] Checked console for specific error messages
- [ ] Reviewed README troubleshooting section

## Final Verification ✓

- [ ] Can generate websites through web UI
- [ ] Preview URLs work and show generated content
- [ ] No console errors in browser developer tools
- [ ] No terminal errors when running dev server
- [ ] Generated websites are functional

---

## Notes

Record any issues or observations here:

```
Issue: _____________________________
Solution: ___________________________
```

---

## Success! 🎉

If all items are checked, your Lovable Clone is ready to use!

**Next Steps:**
- Try different prompts
- Experiment with complex website ideas
- Explore the generated code in Daytona sandboxes
- Share your creations!

---

**Need Help?**
- Check `BUGFIXES.md` for known issues and solutions
- Review `readMe.md` for detailed documentation
- Check Daytona docs: https://www.daytona.io/docs
- Check Vercel AI Gateway docs: https://examples.vercel.com/docs/ai-gateway
