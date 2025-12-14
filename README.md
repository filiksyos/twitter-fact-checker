# 🔍 Twitter Fact Checker

> AI-powered fact-checking browser extension for X/Twitter. Detects misinformation in real-time and marks incorrect claims in red with corrections in green.

[![Built with Next.js](https://img.shields.io/badge/Next.js-14.1.1-black)](https://nextjs.org/)
[![Powered by Exa](https://img.shields.io/badge/Powered%20by-Exa-blue)](https://exa.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4-green)](https://openai.com/)

## ✨ Features

- 🚀 **Real-time Tweet Analysis** - Automatically scans tweets as you scroll
- 🔴 **Inline Red Markup** - Highlights incorrect or misleading claims
- 🟢 **Green Corrections** - Shows accurate information inline
- 💬 **Detailed Fact-Check Popup** - Click tweets for full analysis with confidence scores
- ⚡ **Lightning Fast** - Only 2 API calls per tweet (Exa + OpenAI)
- 🔄 **Smart Caching** - Remembers checked tweets to save API costs
- 🎛️ **Easy Toggle** - Enable/disable with one click in the popup

## 🏗️ Architecture

This project combines two proven patterns:

1. **Browser Extension** (from [twitter-account-location-in-username](https://github.com/RhysSullivan/twitter-account-location-in-username))
   - Manifest V3 content script pattern
   - Chrome storage for caching
   - postMessage for cross-context communication

2. **AI Fact-Checking** (inspired by [exa-hallucination-detector](https://github.com/exa-labs/exa-hallucination-detector))
   - Fast Exa `/answer` endpoint for fact verification
   - OpenAI GPT-4 for intelligent markup decisions
   - No slow web searches - optimized for speed

### How It Works

```
┌─────────────────┐
│  Twitter Feed   │
│  (User browsing)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Content Script  │ ◄─── Detects tweets, extracts text
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  (localhost)    │
├─────────────────┤
│ 1. Exa Answer   │ ◄─── Fast fact-check: "What's wrong?"
│ 2. OpenAI GPT-4 │ ◄─── Markup decision: Red/Green
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply Markup    │ ◄─── Red underlines + green corrections
└─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- Chrome/Chromium browser
- API Keys:
  - [Exa API Key](https://dashboard.exa.ai/api-keys)
  - [OpenAI API Key](https://platform.openai.com/api-keys)

### 1. Backend Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your API keys

# Start the development server
npm run dev
```

The backend will run on `http://localhost:3000`

### 2. Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. The extension is now installed! 🎉

### 3. Usage

1. Make sure the backend is running (`npm run dev`)
2. Go to [X.com](https://x.com) or [Twitter.com](https://twitter.com)
3. Click the extension icon and ensure it's **enabled**
4. Scroll through your feed - tweets will be automatically checked!
5. Look for:
   - 🔴 **Red underlined text** = Incorrect claims
   - 🟢 **Green text in brackets** = Corrections
   - ✓ **Green badge** = Verified as accurate
   - ⚠️ **Warning badge** = Potential issues detected

## 📁 Project Structure

```
twitter-fact-checker/
├── extension/              # Browser extension files
│   ├── manifest.json      # Extension configuration
│   ├── content.js         # Main content script
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic
│   ├── styles.css         # Red/green markup styles
│   └── pageScript.js      # Page context script
├── app/
│   └── api/
│       ├── checktweet/    # Main fact-checking endpoint
│       │   └── route.ts
│       └── health/        # Health check endpoint
│           └── route.ts
├── package.json           # Next.js dependencies
├── next.config.mjs        # Next.js config with CORS
├── tsconfig.json          # TypeScript config
├── .env.example           # Environment variables template
└── README.md             # You are here!
```

## 🔧 Configuration

### API Keys

Create `.env.local` with:

```env
EXA_API_KEY=your_exa_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

### Extension Settings

- **Toggle on/off**: Click extension icon → toggle switch
- **Clear cache**: Click extension icon → "Clear Cache" link
- **Backend URL**: Default is `http://localhost:3000` (change in `extension/content.js`)

### Performance Tuning

In `extension/content.js`, you can adjust:

```javascript
const MIN_REQUEST_INTERVAL = 3000;  // Time between API calls (ms)
const MAX_CONCURRENT_REQUESTS = 1;   // Parallel requests (1 = sequential)
const CACHE_EXPIRY_DAYS = 7;        // How long to cache results
```

## 🎨 Customization

### Styling

Edit `extension/styles.css` to customize colors:

```css
/* Red markup for incorrect text */
.factcheck-incorrect {
  background: rgba(239, 68, 68, 0.1);
  border-bottom: 2px solid #ef4444;
}

/* Green corrections */
.factcheck-correction {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}
```

### API Logic

Edit `app/api/checktweet/route.ts` to:
- Change OpenAI model (currently `gpt-4-turbo-preview`)
- Adjust prompt for different fact-checking behavior
- Add more sophisticated analysis

## 📊 How Fast Is It?

**Per Tweet:**
- Exa `/answer`: ~2-3 seconds
- OpenAI GPT-4: ~1-2 seconds
- **Total: ~3-5 seconds** per tweet

**Optimizations:**
- Smart caching (7-day default)
- Rate limiting to prevent API overuse
- Only checks tweets with 50+ characters
- Sequential processing to ensure accuracy

## 🐛 Troubleshooting

### Extension not working?

1. Check if backend is running: Visit `http://localhost:3000/api/health`
2. Check extension popup for backend status
3. Open DevTools Console on Twitter and look for `[FactCheck]` logs
4. Make sure extension is enabled in popup

### Backend errors?

1. Verify API keys in `.env.local`
2. Check server logs: `npm run dev`
3. Test Exa API: `curl -X POST http://localhost:3000/api/checktweet -H "Content-Type: application/json" -d '{"text":"Test tweet"}'`

### No tweets being checked?

1. Make sure tweets are longer than 50 characters
2. Wait a few seconds after scrolling (rate limiting)
3. Check if cache is full (click "Clear Cache" in popup)
4. Disable and re-enable the extension

## 🚧 Known Limitations

- Requires backend server running locally (not a standalone extension)
- Only works on `x.com` and `twitter.com` domains
- Exa API has rate limits (check your plan)
- OpenAI API costs apply per tweet checked
- Cache is local to browser (doesn't sync across devices)

## 🛣️ Roadmap

- [ ] Add support for other social media platforms
- [ ] Deploy backend to cloud (Vercel/Railway)
- [ ] Add user accounts and cross-device sync
- [ ] Show confidence scores in UI
- [ ] Allow users to report false positives
- [ ] Add multi-language support
- [ ] Create Firefox extension version

## 🤝 Contributing

Contributions are welcome! This is an MVP, so there's lots of room for improvement.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **[RhysSullivan/twitter-account-location-in-username](https://github.com/RhysSullivan/twitter-account-location-in-username)** - Extension architecture pattern
- **[exa-labs/exa-hallucination-detector](https://github.com/exa-labs/exa-hallucination-detector)** - Fact-checking inspiration
- **[Exa.ai](https://exa.ai)** - Fast semantic search API
- **[OpenAI](https://openai.com)** - GPT-4 for intelligent analysis

## 💬 Support

Have questions or issues?

- Open an issue on GitHub
- Check existing issues for solutions
- Read the troubleshooting section above

---

**Built with ❤️ using Next.js, Exa, and OpenAI**

*Note: This is an MVP (Minimum Viable Product) created to demonstrate fast AI-powered fact-checking on Twitter. Use responsibly and always verify important information yourself.*