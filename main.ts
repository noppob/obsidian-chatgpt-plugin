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
	floatingButton: HTMLElement | null = null;
	selectedTextCache: string = ''; // テキスト選択のキャッシュ（モバイル対応）

	async onload() {
		await this.loadSettings();

		// リボンアイコンを追加（カスタムプロンプト版）
		this.addRibbonIcon('message-square', 'Ask ChatGPT (Custom Prompt)', (evt: MouseEvent) => {
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				const editor = markdownView.editor;
				this.askChatGPTCustom(editor);
			} else {
				new Notice('Please open a note first');
			}
		});

		// テキスト選択時のフローティングボタン（モバイル対応）
		this.registerDomEvent(document, 'selectionchange', () => {
			this.handleSelectionChange();
		});

		// テキスト選択時のコンテキストメニューに追加
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selectedText = editor.getSelection();
				if (selectedText && selectedText.trim()) {
					menu.addItem((item) => {
						item
							.setTitle('✨ Ask ChatGPT')
							.setIcon('message-square')
							.onClick(async () => {
								this.askChatGPT(editor);
							});
					});

					menu.addItem((item) => {
						item
							.setTitle('💬 Ask ChatGPT (Custom)')
							.setIcon('edit')
							.onClick(async () => {
								this.askChatGPTCustom(editor);
							});
					});
				}
			})
		);

		// エディタメニューにコマンド追加（モバイル対応）
		this.addCommand({
			id: 'ask-chatgpt',
			name: 'Ask ChatGPT about selected text',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						const editor = markdownView.editor;
						this.askChatGPT(editor);
					}
					return true;
				}
				return false;
			},
		});

		// カスタムプロンプトで質問（モバイル対応）
		this.addCommand({
			id: 'ask-chatgpt-custom',
			name: 'Ask ChatGPT with custom prompt',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						const editor = markdownView.editor;
						this.askChatGPTCustom(editor);
					}
					return true;
				}
				return false;
			},
		});

		// 設定タブ追加
		this.addSettingTab(new ChatGPTSettingTab(this.app, this));
	}

	handleSelectionChange() {
		const selection = window.getSelection();
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (selection && selection.toString().trim() && markdownView) {
			this.showFloatingButton();
		} else {
			this.hideFloatingButton();
		}
	}

	showFloatingButton() {
		if (this.floatingButton) return;

		// 選択テキストをキャッシュに保存（ボタンクリック時に選択が解除される問題に対応）
		const selection = window.getSelection();
		if (selection) {
			this.selectedTextCache = selection.toString().trim();
		}

		this.floatingButton = document.body.createDiv('chatgpt-floating-button');
		this.floatingButton.innerHTML = '💬';
		this.floatingButton.setAttribute('aria-label', 'Ask ChatGPT');

		this.floatingButton.addEventListener('click', async () => {
			this.hideFloatingButton();
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				await this.askChatGPTWithModeSwitch(markdownView);
			}
		});
	}

	hideFloatingButton() {
		if (this.floatingButton) {
			this.floatingButton.remove();
			this.floatingButton = null;
		}
		// キャッシュは保持（ボタンクリック後も使用するため）
	}

	async askChatGPTWithModeSwitch(view: MarkdownView) {
		// リーディングモードかチェック
		const state = view.getState();
		const wasInReadingMode = state.mode === 'preview';

		// 編集モードに切り替え
		if (wasInReadingMode) {
			await view.setState({ ...state, mode: 'source' }, { history: false });
			// モード切り替えを待つ
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// ChatGPTを実行（カスタムプロンプト版）
		// キャッシュされた選択テキストを使用（モバイルでボタンクリック時に選択が解除される問題に対応）
		const editor = view.editor;
		await this.askChatGPTCustom(editor, this.selectedTextCache);

		// 使用後にキャッシュをクリア
		this.selectedTextCache = '';

		// リーディングモードに戻す
		if (wasInReadingMode) {
			await new Promise(resolve => setTimeout(resolve, 500));
			await view.setState({ ...state, mode: 'preview' }, { history: false });
		}
	}

	async askChatGPT(editor: Editor) {
		let selectedText = editor.getSelection();

		// モバイルで選択が解除される問題に対応：クリップボードから取得
		if (!selectedText || selectedText.trim() === '') {
			try {
				selectedText = await navigator.clipboard.readText();
				if (selectedText && selectedText.trim()) {
					new Notice('Using text from clipboard');
				} else {
					new Notice('Please select text or copy it to clipboard first');
					return;
				}
			} catch (e) {
				new Notice('Please select text first');
				return;
			}
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

			// ドキュメントの最後に質問と回答を挿入
			const lastLine = editor.lastLine();
			const lastLineLength = editor.getLine(lastLine).length;
			const insertText = `\n\n---\n\n**Question:**\n${selectedText}\n\n${formattedResponse}\n`;

			editor.replaceRange(
				insertText,
				{ line: lastLine, ch: lastLineLength }
			);

			// 挿入した位置までスクロール
			const newLastLine = editor.lastLine();
			editor.setCursor({ line: newLastLine, ch: 0 });

			new Notice('Response inserted!');
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('ChatGPT Error:', error);
		}
	}

	async askChatGPTCustom(editor: Editor, cachedText?: string) {
		let selectedText = cachedText || editor.getSelection();

		// モバイルで選択が解除される問題に対応：クリップボードから取得
		if (!selectedText || selectedText.trim() === '') {
			try {
				selectedText = await navigator.clipboard.readText();
				if (selectedText && selectedText.trim()) {
					new Notice('Using text from clipboard');
				} else {
					new Notice('Please select text or copy it to clipboard first');
					return;
				}
			} catch (e) {
				new Notice('Please select text first');
				return;
			}
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

				// ドキュメントの最後に質問と回答を挿入
				const lastLine = editor.lastLine();
				const lastLineLength = editor.getLine(lastLine).length;
				const insertText = `\n\n---\n\n**Prompt:**\n${customPrompt}\n\n**Context:**\n${selectedText}\n\n${formattedResponse}\n`;

				editor.replaceRange(
					insertText,
					{ line: lastLine, ch: lastLineLength }
				);

				// 挿入した位置までスクロール
				const newLastLine = editor.lastLine();
				editor.setCursor({ line: newLastLine, ch: 0 });

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

		// ChatGPTモーダル専用クラスを追加（他のモーダルに影響しないように）
		this.modalEl.addClass('chatgpt-custom-modal');

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

		// 入力欄に確実にフォーカス（モバイル対応）
		// 複数のタイミングでフォーカスを試みることで確実に保持
		inputEl.focus();

		// レンダリング完了後に再度フォーカス
		setTimeout(() => {
			inputEl.focus();
		}, 50);

		// モーダルアニメーション完了後にもう一度フォーカス
		setTimeout(() => {
			inputEl.focus();
		}, 150);
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
