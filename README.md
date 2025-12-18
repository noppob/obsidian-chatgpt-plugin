# ChatGPT Integration for Obsidian

Ask ChatGPT about selected text and insert the response directly into your notes. **Supports GPT-4o and all latest OpenAI models!**

## ✨ Features

- 🤖 **Latest GPT-4o Support** - Use the most advanced ChatGPT models
- 📱 **Mobile-Friendly** - Works perfectly on iPhone/iPad
- ⚡ **Fast & Simple** - Select text → Ask → Get response
- 🎨 **Customizable** - Configure model, temperature, prompts, and response format
- 🔒 **Private** - Your API key stays local in Obsidian

## 📋 What It Does

1. **Select text** in your Obsidian note (e.g., a question, paragraph, or idea)
2. **Run command** "Ask ChatGPT about selected text"
3. **Get response** inserted automatically below your selection

Perfect for:
- ❓ Asking questions about concepts in your notes
- 📝 Expanding on ideas
- 🌍 Translating text
- ✅ Checking grammar and spelling
- 💡 Getting explanations or summaries

## 📦 Installation

### Method 1: BRAT (Recommended for beta testing)

1. Install [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from Obsidian Community Plugins
2. Open Command Palette (`Ctrl/Cmd + P`)
3. Run `BRAT: Add a beta plugin for testing`
4. Enter this repository URL:
   ```
   noppob/obsidian-chatgpt-plugin
   ```
5. Enable the plugin in Settings → Community Plugins

### Method 2: Manual Installation

1. Download the latest release from [Releases](https://github.com/noppob/obsidian-chatgpt-plugin/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` (if exists)
3. Copy them to your vault: `<vault>/.obsidian/plugins/chatgpt-integration/`
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

## 🔧 Setup

1. Go to **Settings → ChatGPT Integration**
2. Enter your **OpenAI API Key** (get it from [platform.openai.com/api-keys](https://platform.openai.com/api-keys))
3. (Optional) Customize model, temperature, and prompts

### Getting an API Key

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key and paste it in the plugin settings
5. **Important**: Add payment method to your OpenAI account (free tier has limits)

## 🚀 Usage

### Basic Usage

1. **Select text** in your note
2. Press `Ctrl/Cmd + P` (Command Palette)
3. Search for **"Ask ChatGPT about selected text"**
4. Wait a moment
5. ✅ Response appears below your selection!

### Custom Prompt

1. **Select text** in your note
2. Press `Ctrl/Cmd + P`
3. Search for **"Ask ChatGPT with custom prompt"**
4. Enter your custom question or instruction
5. ✅ Response appears!

### Example Workflows

**Translation:**
```
Select: "Hello, how are you?"
Command: Ask ChatGPT with custom prompt
Prompt: "Translate this to Japanese"
Result: こんにちは、お元気ですか？
```

**Explanation:**
```
Select: "Quantum entanglement"
Command: Ask ChatGPT about selected text
Result: [Detailed explanation of quantum entanglement]
```

**Grammar Check:**
```
Select: "I goes to school yesterday"
Command: Ask ChatGPT with custom prompt
Prompt: "Fix grammar and explain mistakes"
Result: [Corrected version with explanation]
```

## 📱 Using on iPhone/iPad

1. Select text in Obsidian mobile app
2. Tap the **three dots (...)** menu
3. Tap **"Run command"**
4. Search for **"Ask ChatGPT"**
5. Tap to execute
6. ✅ Response inserted!

**Tip:** Add a favorite/shortcut in Obsidian mobile for faster access!

## ⚙️ Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **API Key** | Your OpenAI API key | (required) |
| **Model** | GPT model to use | `gpt-4o` |
| **Temperature** | Creativity level (0-2) | `0.7` |
| **Max Tokens** | Maximum response length | `2000` |
| **System Prompt** | Default instruction for ChatGPT | "You are a helpful assistant..." |
| **Response Format** | How to format the response | `**ChatGPT:**\n{response}` |

### Available Models

- **GPT-4o** (Recommended) - Latest and most capable
- **GPT-4o Mini** - Faster and cheaper
- **GPT-4 Turbo** - Previous generation flagship
- **GPT-4** - Original GPT-4
- **GPT-3.5 Turbo** - Fast and economical

## 💰 Pricing

This plugin uses the OpenAI API (pay-as-you-go):

- **GPT-4o**: ~$0.005 per 1K input tokens, ~$0.015 per 1K output tokens
- **GPT-4o Mini**: ~$0.00015 per 1K input tokens, ~$0.0006 per 1K output tokens

*Typical usage: 10-50 questions/day ≈ $1-5/month*

Check current pricing: [OpenAI Pricing](https://openai.com/api/pricing/)

## 🔒 Privacy & Security

- Your API key is stored **locally** in Obsidian (not sent anywhere except OpenAI)
- Requests go directly from your device to OpenAI
- No data is collected by this plugin
- Review [OpenAI's Privacy Policy](https://openai.com/policies/privacy-policy)

## 🐛 Troubleshooting

### "Please set your OpenAI API key in settings"
→ Go to Settings → ChatGPT Integration and enter your API key

### "Error: 401 Unauthorized"
→ Your API key is invalid or expired. Generate a new one from OpenAI

### "Error: 429 Too Many Requests"
→ You've hit rate limits. Wait a few seconds or upgrade your OpenAI plan

### "No response from ChatGPT"
→ Check your internet connection and OpenAI service status

### Mobile: Command not appearing
→ Make sure the plugin is enabled in Settings → Community Plugins

## 🛠️ Development

### Building from Source

```bash
cd obsidian-chatgpt-plugin
npm install
npm run build
```

### Dev Mode

```bash
npm run dev
```

This watches for changes and rebuilds automatically.

### Testing

1. Build the plugin
2. Copy `main.js` and `manifest.json` to your test vault
3. Reload Obsidian

## 📜 License

MIT License - see [LICENSE](LICENSE) file

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📧 Support

- 🐛 Report bugs: [GitHub Issues](https://github.com/noppob/youtube_summary/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/noppob/youtube_summary/discussions)

## 🙏 Credits

Built with:
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [OpenAI API](https://platform.openai.com/)

---

**Enjoy using ChatGPT in Obsidian! 🎉**

*If this plugin is helpful, consider starring ⭐ the repository!*

