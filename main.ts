import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
} from 'obsidian';

interface ChatGPTSettings {
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	responseFormat: string;
}

const DEFAULT_SETTINGS: ChatGPTSettings = {
	apiKey: '',
	model: 'gpt-4o',
	temperature: 0.7,
	maxTokens: 2000,
	systemPrompt: 'You are a helpful assistant. Answer questions clearly and concisely.',
	responseFormat: '**ChatGPT:**\n{response}',
};

export default class ChatGPTPlugin extends Plugin {
	settings: ChatGPTSettings;

	async onload() {
		await this.loadSettings();

		// エディタメニューにコマンド追加
		this.addCommand({
			id: 'ask-chatgpt',
			name: 'Ask ChatGPT about selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.askChatGPT(editor);
			},
		});

		// カスタムプロンプトで質問
		this.addCommand({
			id: 'ask-chatgpt-custom',
			name: 'Ask ChatGPT with custom prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.askChatGPTCustom(editor);
			},
		});

		// 設定タブ追加
		this.addSettingTab(new ChatGPTSettingTab(this.app, this));
	}

	async askChatGPT(editor: Editor) {
		const selectedText = editor.getSelection();

		if (!selectedText || selectedText.trim() === '') {
			new Notice('Please select text first');
			return;
		}

		if (!this.settings.apiKey) {
			new Notice('Please set your OpenAI API key in settings');
			return;
		}

		try {
			new Notice('Asking ChatGPT...');
			const response = await this.callOpenAI(selectedText);

			// 回答を整形して挿入
			const formattedResponse = this.settings.responseFormat.replace(
				'{response}',
				response
			);

			// 選択テキストの後に回答を挿入
			const cursor = editor.getCursor('to');
			editor.replaceRange(
				`\n\n${formattedResponse}\n`,
				cursor
			);

			new Notice('Response inserted!');
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('ChatGPT Error:', error);
		}
	}

	async askChatGPTCustom(editor: Editor) {
		const selectedText = editor.getSelection();

		if (!selectedText || selectedText.trim() === '') {
			new Notice('Please select text first');
			return;
		}

		if (!this.settings.apiKey) {
			new Notice('Please set your OpenAI API key in settings');
			return;
		}

		// カスタムプロンプト入力モーダル
		new CustomPromptModal(this.app, async (customPrompt) => {
			try {
				new Notice('Asking ChatGPT...');
				const fullPrompt = `${customPrompt}\n\n---\n${selectedText}`;
				const response = await this.callOpenAI(fullPrompt);

				const formattedResponse = this.settings.responseFormat.replace(
					'{response}',
					response
				);

				const cursor = editor.getCursor('to');
				editor.replaceRange(
					`\n\n${formattedResponse}\n`,
					cursor
				);

				new Notice('Response inserted!');
			} catch (error) {
				new Notice(`Error: ${error.message}`);
				console.error('ChatGPT Error:', error);
			}
		}).open();
	}

	async callOpenAI(prompt: string): Promise<string> {
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: [
					{
						role: 'system',
						content: this.settings.systemPrompt,
					},
					{
						role: 'user',
						content: prompt,
					},
				],
				temperature: this.settings.temperature,
				max_tokens: this.settings.maxTokens,
			}),
		});

		const data = response.json;

		if (data.error) {
			throw new Error(data.error.message || 'OpenAI API Error');
		}

		if (!data.choices || data.choices.length === 0) {
			throw new Error('No response from ChatGPT');
		}

		return data.choices[0].message.content.trim();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// カスタムプロンプト入力モーダル
class CustomPromptModal extends Modal {
	onSubmit: (prompt: string) => void;

	constructor(app: App, onSubmit: (prompt: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Custom prompt for ChatGPT' });

		const inputEl = contentEl.createEl('textarea', {
			placeholder: 'Enter your question or instruction...',
		});
		inputEl.style.width = '100%';
		inputEl.style.minHeight = '100px';
		inputEl.style.marginBottom = '10px';

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.textAlign = 'right';

		const submitBtn = buttonContainer.createEl('button', { text: 'Ask' });
		submitBtn.addEventListener('click', () => {
			const prompt = inputEl.value.trim();
			if (prompt) {
				this.onSubmit(prompt);
				this.close();
			} else {
				new Notice('Please enter a prompt');
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 設定画面
class ChatGPTSettingTab extends PluginSettingTab {
	plugin: ChatGPTPlugin;

	constructor(app: App, plugin: ChatGPTPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'ChatGPT Integration Settings' });

		// APIキー設定
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key (get it from platform.openai.com)')
			.addText((text) =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// モデル選択
		new Setting(containerEl)
			.setName('Model')
			.setDesc('Select ChatGPT model')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('gpt-4o', 'GPT-4o (Latest, Recommended)')
					.addOption('gpt-4o-mini', 'GPT-4o Mini (Faster, Cheaper)')
					.addOption('gpt-4-turbo', 'GPT-4 Turbo')
					.addOption('gpt-4', 'GPT-4')
					.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					})
			);

		// Temperature設定
		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0-2). Lower = more focused, Higher = more creative')
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		// Max Tokens設定
		new Setting(containerEl)
			.setName('Max Tokens')
			.setDesc('Maximum length of response')
			.addText((text) =>
				text
					.setPlaceholder('2000')
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxTokens = num;
							await this.plugin.saveSettings();
						}
					})
			);

		// System Prompt設定
		new Setting(containerEl)
			.setName('System Prompt')
			.setDesc('Default instruction for ChatGPT')
			.addTextArea((text) => {
				text
					.setPlaceholder('You are a helpful assistant...')
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
				text.inputEl.style.width = '100%';
			});

		// Response Format設定
		new Setting(containerEl)
			.setName('Response Format')
			.setDesc('How to format the response. Use {response} as placeholder.')
			.addTextArea((text) => {
				text
					.setPlaceholder('**ChatGPT:**\n{response}')
					.setValue(this.plugin.settings.responseFormat)
					.onChange(async (value) => {
						this.plugin.settings.responseFormat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
				text.inputEl.style.width = '100%';
			});

		// 使い方の説明
		containerEl.createEl('h3', { text: 'How to use' });
		const usageEl = containerEl.createEl('div');
		usageEl.innerHTML = `
			<ol>
				<li>Select text in your note</li>
				<li>Press <kbd>Ctrl/Cmd + P</kbd> and search for "Ask ChatGPT"</li>
				<li>Wait for the response to be inserted</li>
			</ol>
			<p><strong>Commands:</strong></p>
			<ul>
				<li><strong>Ask ChatGPT about selected text</strong>: Ask a general question about the selected text</li>
				<li><strong>Ask ChatGPT with custom prompt</strong>: Specify your own question or instruction</li>
			</ul>
		`;
	}
}
