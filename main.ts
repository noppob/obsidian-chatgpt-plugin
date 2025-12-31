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
	MarkdownRenderer,
} from 'obsidian';

// モバイルデバッグ用ログクラス
class MobileDebugLogger {
	private logs: string[] = [];
	private plugin: ChatGPTPlugin;

	constructor(plugin: ChatGPTPlugin) {
		this.plugin = plugin;
	}

	log(message: string, data?: any) {
		const timestamp = new Date().toISOString().substring(11, 19);
		const logEntry = data
			? `[${timestamp}] ${message}: ${JSON.stringify(data).substring(0, 100)}`
			: `[${timestamp}] ${message}`;

		this.logs.push(logEntry);
		console.log(logEntry);

		// 設定でデバッグモードが有効な場合はNoticeでも表示
		if (this.plugin.settings?.debugMode) {
			new Notice(logEntry, 3000);
		}
	}

	async saveToFile() {
		try {
			const logContent = this.logs.join('\n');
			const vault = (this.plugin as any).app.vault;
			await vault.adapter.write('chatgpt_debug_logs.txt', logContent);
			new Notice('✅ Debug log saved to chatgpt_debug_logs.txt', 5000);
		} catch (error) {
			new Notice(`❌ Failed to save log: ${error.message}`, 5000);
		}
	}

	clear() {
		this.logs = [];
		new Notice('Debug log cleared');
	}

	getLogsCount() {
		return this.logs.length;
	}
}

interface UsageRecord {
	date: string; // ISO date string
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	estimatedCost: number; // USD
}

interface ChatGPTSettings {
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	responseFormat: string;
	debugMode: boolean;
	useWebSearch: boolean;
	usageHistory: UsageRecord[];
}

const DEFAULT_SETTINGS: ChatGPTSettings = {
	apiKey: '',
	model: 'gpt-4o',
	temperature: 0.7,
	maxTokens: 2000,
	systemPrompt: 'You are a helpful assistant. Answer questions clearly and concisely.',
	responseFormat: '**ChatGPT:**\n{response}',
	debugMode: false,
	useWebSearch: false,
	usageHistory: [],
};

export default class ChatGPTPlugin extends Plugin {
	settings: ChatGPTSettings;
	floatingButton: HTMLElement | null = null;
	selectedTextCache: string = ''; // テキスト選択のキャッシュ（モバイル対応）
	debugLogger: MobileDebugLogger;

	async onload() {
		this.debugLogger = new MobileDebugLogger(this);
		this.debugLogger.log('🚀 ChatGPT Plugin loaded');
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

	showFloatingButton() {
		if (this.floatingButton) return;

		this.debugLogger.log('💬 Creating floating button');

		this.floatingButton = document.body.createDiv('chatgpt-floating-button');
		this.floatingButton.innerHTML = '💬';
		this.floatingButton.setAttribute('aria-label', 'Ask ChatGPT');

		this.floatingButton.addEventListener('click', async () => {
			// キャッシュをローカル変数にコピー（確実に取得）
			const cachedText = this.selectedTextCache;
			this.debugLogger.log('🖱️ Floating button clicked', {
				cacheLength: cachedText.length,
				preview: cachedText.substring(0, 50)
			});

			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!markdownView) {
				new Notice('Please open a note first');
				return;
			}

			if (!cachedText || !cachedText.trim()) {
				new Notice('📝 Please select text first');
				return;
			}

			// キャッシュから取得した選択テキストでモーダルを開く
			const editor = markdownView.editor;
			await this.askChatGPTCustom(editor, cachedText);

			// 使用後にキャッシュをクリア
			this.selectedTextCache = '';
		});
	}

	handleSelectionChange() {
		const selection = window.getSelection();
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		this.debugLogger.log('📝 Selection changed', {
			length: selection?.toString().length || 0
		});

		if (selection && selection.toString().trim() && markdownView) {
			// キャッシュに保存
			this.selectedTextCache = selection.toString().trim();
			this.debugLogger.log('💾 Text cached', {
				cacheLength: this.selectedTextCache.length
			});
			this.showFloatingButton();
		} else {
			// 選択解除時はキャッシュもクリア
			this.selectedTextCache = '';
			this.hideFloatingButton();
		}
	}

	hideFloatingButton() {
		if (this.floatingButton) {
			this.floatingButton.remove();
			this.floatingButton = null;
		}
	}

	async askChatGPT(editor: Editor) {
		// リーディングモードかチェックして自動切り替え
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a note first');
			return;
		}

		const state = markdownView.getState();
		const wasInReadingMode = state.mode === 'preview';

		// 編集モードに切り替え
		if (wasInReadingMode) {
			await markdownView.setState({ ...state, mode: 'source' }, { history: false });
			// モード切り替えを待つ
			await new Promise(resolve => setTimeout(resolve, 100));
		}

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
		} finally {
			// リーディングモードに戻す
			if (wasInReadingMode) {
				await new Promise(resolve => setTimeout(resolve, 500));
				await markdownView.setState({ ...state, mode: 'preview' }, { history: false });
			}
		}
	}

	async askChatGPTCustom(editor: Editor, selectedText?: string) {
		// リーディングモードかチェックして自動切り替え
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			new Notice('Please open a note first');
			return;
		}

		const state = markdownView.getState();
		const wasInReadingMode = state.mode === 'preview';

		// 編集モードに切り替え
		if (wasInReadingMode) {
			await markdownView.setState({ ...state, mode: 'source' }, { history: false });
			// モード切り替えを待つ
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// selectedTextが渡されていない場合はeditorから取得
		if (!selectedText) {
			selectedText = editor.getSelection();
		}

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

		// 対話型ChatGPTモーダルを開く
		new InteractiveChatModal(
			this.app,
			this,
			selectedText,
			editor,
			wasInReadingMode ? { view: markdownView, state, wasInReadingMode } : undefined
		).open();
	}

	async callOpenAI(prompt: string): Promise<string> {
		const requestBody: any = {
			model: this.settings.model,
			input: [
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
			max_output_tokens: this.settings.maxTokens,
		};

		// Web検索が有効な場合はツールを追加
		if (this.settings.useWebSearch) {
			requestBody.tools = [{ type: "web_search" }];
		}

		const response = await requestUrl({
			url: 'https://api.openai.com/v1/responses',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		const data = response.json;

		if (data.error) {
			throw new Error(data.error.message || 'OpenAI API Error');
		}

		// 使用量を記録（Responses APIのusageフィールド）
		if (data.usage) {
			this.recordUsage(
				this.settings.model,
				data.usage.prompt_tokens || data.usage.input_tokens || 0,
				data.usage.completion_tokens || data.usage.output_tokens || 0
			);
		}

		// Responses APIではoutput_textまたはoutput配列を使用
		if (data.output_text) {
			return data.output_text.trim();
		}

		if (data.output && data.output.length > 0) {
			// output配列をループしてmessageタイプを探す（Web検索時は複数アイテムがある）
			for (const outputItem of data.output) {
				if (outputItem.type === "message" && outputItem.content && outputItem.content.length > 0) {
					for (const contentItem of outputItem.content) {
						if (contentItem.type === "output_text" && contentItem.text) {
							return contentItem.text.trim();
						}
					}
				}
			}
		}

		throw new Error('No response from ChatGPT');
	}

	// 会話履歴を使ったOpenAI API呼び出し（ストリーミング対応 - Responses API使用）
	async callOpenAIWithHistoryStreaming(
		messages: Array<{role: string, content: string}>,
		onChunk: (chunk: string) => void
	): Promise<{ fullText: string; usage?: any }> {
		const requestBody: any = {
			model: this.settings.model,
			input: messages,
			temperature: this.settings.temperature,
			max_output_tokens: this.settings.maxTokens,
			stream: true,  // ストリーミング有効化
		};

		// Web検索が有効な場合はツールを追加（Responses APIはストリーミング時もサポート）
		if (this.settings.useWebSearch) {
			requestBody.tools = [{ type: "web_search" }];
		}

		const response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(errorData.error?.message || 'OpenAI API Error');
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Failed to get response reader');
		}

		const decoder = new TextDecoder();
		let fullText = '';
		let buffer = '';
		let usageData: any = undefined;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;

					// Responses APIのイベント形式を処理
					// event: response.output_text.delta
					// data: {"delta": "text"}
					if (line.startsWith('event:')) {
						// イベントタイプの行はスキップ（次のdata行で処理）
						continue;
					}

					if (!line.startsWith('data: ')) continue;

					try {
						const jsonStr = line.substring(6);
						const data = JSON.parse(jsonStr);

						// response.output_text.delta イベントの処理
						if (data.delta !== undefined) {
							const chunk = data.delta;
							fullText += chunk;
							onChunk(chunk);
						}

						// response.completed イベントの処理（使用量情報）
						if (data.usage) {
							usageData = data.usage;
						}
					} catch (e) {
						// JSONパースエラーは無視
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		// 使用量を記録
		if (usageData) {
			this.recordUsage(
				this.settings.model,
				usageData.prompt_tokens || usageData.input_tokens || 0,
				usageData.completion_tokens || usageData.output_tokens || 0
			);
		} else {
			// 使用量データがない場合は概算
			const estimatedPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
			const estimatedCompletionTokens = Math.ceil(fullText.length / 4);
			this.recordUsage(this.settings.model, estimatedPromptTokens, estimatedCompletionTokens);
		}

		return { fullText, usage: usageData };
	}

	// 会話履歴を使ったOpenAI API呼び出し（対話型モーダル用・非ストリーミング版）
	async callOpenAIWithHistory(messages: Array<{role: string, content: string}>): Promise<string> {
		const requestBody: any = {
			model: this.settings.model,
			input: messages,
			temperature: this.settings.temperature,
			max_output_tokens: this.settings.maxTokens,
		};

		// Web検索が有効な場合はツールを追加
		if (this.settings.useWebSearch) {
			requestBody.tools = [{ type: "web_search" }];
		}

		const response = await requestUrl({
			url: 'https://api.openai.com/v1/responses',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		const data = response.json;

		if (data.error) {
			throw new Error(data.error.message || 'OpenAI API Error');
		}

		// 使用量を記録（Responses APIのusageフィールド）
		if (data.usage) {
			this.recordUsage(
				this.settings.model,
				data.usage.prompt_tokens || data.usage.input_tokens || 0,
				data.usage.completion_tokens || data.usage.output_tokens || 0
			);
		}

		// Responses APIではoutput_textまたはoutput配列を使用
		if (data.output_text) {
			return data.output_text.trim();
		}

		if (data.output && data.output.length > 0) {
			// output配列をループしてmessageタイプを探す（Web検索時は複数アイテムがある）
			for (const outputItem of data.output) {
				if (outputItem.type === "message" && outputItem.content && outputItem.content.length > 0) {
					for (const contentItem of outputItem.content) {
						if (contentItem.type === "output_text" && contentItem.text) {
							return contentItem.text.trim();
						}
					}
				}
			}
		}

		throw new Error('No response from ChatGPT');
	}

	// コスト計算（モデル別料金）
	calculateCost(model: string, promptTokens: number, completionTokens: number): number {
		// 料金表（USD per 1M tokens）2025年1月時点
		const pricing: { [key: string]: { input: number; output: number } } = {
			'gpt-5.2': { input: 1.75, output: 7.00 },
			'gpt-5.1': { input: 1.25, output: 5.00 },
			'gpt-5': { input: 1.00, output: 4.00 },
			'gpt-5-mini': { input: 0.25, output: 1.00 },
			'gpt-5-nano': { input: 0.10, output: 0.40 },
			'gpt-4o': { input: 2.50, output: 10.00 },
			'gpt-4o-mini': { input: 0.150, output: 0.600 },
			'gpt-4-turbo': { input: 10.00, output: 30.00 },
			'gpt-4': { input: 30.00, output: 60.00 },
			'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
		};

		const modelPricing = pricing[model] || pricing['gpt-4o']; // デフォルトはgpt-4o
		const inputCost = (promptTokens / 1_000_000) * modelPricing.input;
		const outputCost = (completionTokens / 1_000_000) * modelPricing.output;

		return inputCost + outputCost;
	}

	// 使用量を記録
	recordUsage(model: string, promptTokens: number, completionTokens: number) {
		const totalTokens = promptTokens + completionTokens;
		const estimatedCost = this.calculateCost(model, promptTokens, completionTokens);

		const record: UsageRecord = {
			date: new Date().toISOString(),
			model,
			promptTokens,
			completionTokens,
			totalTokens,
			estimatedCost,
		};

		this.settings.usageHistory.push(record);
		this.saveSettings();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// 対話型ChatGPTモーダル
interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

class InteractiveChatModal extends Modal {
	plugin: ChatGPTPlugin;
	selectedText: string;
	editor: Editor;
	readingModeInfo?: {
		view: MarkdownView;
		state: any;
		wasInReadingMode: boolean;
	};

	// 会話履歴（API送信用、システムプロンプト + 選択テキスト含む）
	messages: Array<{role: string, content: string}> = [];
	// 表示用会話履歴（ユーザーとアシスタントのやり取りのみ）
	displayMessages: ChatMessage[] = [];

	// UI要素
	conversationEl: HTMLElement;
	inputEl: HTMLTextAreaElement;
	sendBtn: HTMLButtonElement;
	insertBtn: HTMLButtonElement;
	isLoading: boolean = false;
	contextContentEl: HTMLElement;
	contextToggleIconEl: HTMLElement;

	constructor(
		app: App,
		plugin: ChatGPTPlugin,
		selectedText: string,
		editor: Editor,
		readingModeInfo?: { view: MarkdownView; state: any; wasInReadingMode: boolean }
	) {
		super(app);
		this.plugin = plugin;
		this.selectedText = selectedText;
		this.editor = editor;
		this.readingModeInfo = readingModeInfo;

		// 初期メッセージ（システムプロンプト + 選択テキストコンテキスト）
		this.messages.push({
			role: 'system',
			content: this.plugin.settings.systemPrompt,
		});
		this.messages.push({
			role: 'system',
			content: `Selected context from the document:\n\n${selectedText}`,
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// モーダル専用クラスを追加
		this.modalEl.addClass('chatgpt-interactive-modal');

		// タイトル
		contentEl.createEl('h2', { text: '💬 ChatGPT Interactive Chat' });

		// 選択テキストプレビュー（折りたたみ可能）
		const contextSection = contentEl.createDiv('chatgpt-context-section');
		const contextHeader = contextSection.createDiv('chatgpt-context-header');
		contextHeader.createEl('strong', { text: '📄 Selected Context' });
		const toggleIcon = contextHeader.createSpan('chatgpt-toggle-icon');
		toggleIcon.textContent = '▼';

		const contextContent = contextSection.createDiv('chatgpt-context-content');
		contextContent.style.display = 'block';
		const contextText = contextContent.createEl('div', { cls: 'chatgpt-context-text' });
		contextText.textContent = this.selectedText.length > 200
			? this.selectedText.substring(0, 200) + '...'
			: this.selectedText;

		// 要素への参照を保存（送信時に閉じるため）
		this.contextContentEl = contextContent;
		this.contextToggleIconEl = toggleIcon;

		// 折りたたみ動作
		contextHeader.addEventListener('click', () => {
			if (contextContent.style.display === 'none') {
				contextContent.style.display = 'block';
				toggleIcon.textContent = '▼';
			} else {
				contextContent.style.display = 'none';
				toggleIcon.textContent = '▶';
			}
		});

		// 入力エリア（折りたたみ可能）
		const inputSection = contentEl.createDiv('chatgpt-input-section');

		// 折りたたみヘッダー
		const inputHeader = inputSection.createDiv('chatgpt-input-header');
		inputHeader.createEl('strong', { text: '✍️ Input Area' });
		const inputToggleIcon = inputHeader.createSpan('chatgpt-toggle-icon');
		inputToggleIcon.textContent = '▼';

		// 入力コンテンツ（折りたたみ可能）
		const inputContent = inputSection.createDiv('chatgpt-input-content');
		inputContent.style.display = 'block';

		this.inputEl = inputContent.createEl('textarea', {
			placeholder: '💬 ここに質問を入力してください...',
			cls: 'chatgpt-input',
		});
		this.inputEl.setAttribute('inputmode', 'text');
		this.inputEl.setAttribute('autocomplete', 'off');
		this.inputEl.setAttribute('autocorrect', 'off');
		this.inputEl.setAttribute('spellcheck', 'false');

		// Enter キーで送信（Shift+Enter で改行）
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});

		// ボタンエリア
		const buttonContainer = inputContent.createDiv('chatgpt-button-container');

		this.sendBtn = buttonContainer.createEl('button', { text: '送信', cls: 'chatgpt-send-btn' });
		this.sendBtn.addEventListener('click', () => this.handleSend());

		this.insertBtn = buttonContainer.createEl('button', { text: '挿入して閉じる', cls: 'chatgpt-insert-btn' });
		this.insertBtn.addEventListener('click', () => this.handleInsertAndClose());

		// デバッグモード時のみ表示
		if (this.plugin.settings.debugMode) {
			const debugBtn = buttonContainer.createEl('button', { text: '🐛 ログ保存', cls: 'chatgpt-cancel-btn' });
			debugBtn.addEventListener('click', async () => {
				await this.plugin.debugLogger.saveToFile();
			});
		}

		const cancelBtn = buttonContainer.createEl('button', { text: 'キャンセル', cls: 'chatgpt-cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		// 入力エリアの折りたたみ動作
		inputHeader.addEventListener('click', () => {
			if (inputContent.style.display === 'none') {
				inputContent.style.display = 'block';
				inputToggleIcon.textContent = '▼';
			} else {
				inputContent.style.display = 'none';
				inputToggleIcon.textContent = '▶';
			}
		});

		// 会話履歴表示エリア（入力エリアの下に配置）
		this.conversationEl = contentEl.createDiv('chatgpt-conversation');

		// 初期フォーカス（iPhone対応強化）
		setTimeout(() => {
			this.inputEl.focus();
			// iOSでカーソルを表示させるためにクリックイベントを発火
			this.inputEl.click();
			// 強制的にフォーカスを維持
			this.inputEl.setSelectionRange(0, 0);
		}, 150);
	}

	async handleSend() {
		const userInput = this.inputEl.value.trim();
		if (!userInput || this.isLoading) return;

		// ユーザーメッセージを追加
		this.displayMessages.push({ role: 'user', content: userInput });
		this.messages.push({ role: 'user', content: userInput });

		// 入力欄をクリア
		this.inputEl.value = '';

		// Selected Contextエリアを閉じる（回答エリアを広く表示）
		if (this.contextContentEl) {
			this.contextContentEl.style.display = 'none';
			this.contextToggleIconEl.textContent = '▶';
		}

		// UI更新
		await this.renderConversation();
		this.setLoading(true);

		// ストリーミング用のアシスタントメッセージを事前に追加
		const assistantMessageIndex = this.displayMessages.length;
		this.displayMessages.push({ role: 'assistant', content: '' });

		// ストリーミング表示用のメッセージ要素を作成
		const messageEl = this.conversationEl.createDiv('chatgpt-message chatgpt-message-assistant');
		const iconEl = messageEl.createSpan('chatgpt-message-icon');
		iconEl.textContent = '🤖';
		const contentEl = messageEl.createDiv('chatgpt-message-content');
		contentEl.textContent = '';

		try {
			// ChatGPT APIをストリーミングで呼び出し
			const result = await this.plugin.callOpenAIWithHistoryStreaming(
				this.messages,
				async (chunk: string) => {
					// チャンクごとにUI更新
					this.displayMessages[assistantMessageIndex].content += chunk;

					// Markdownをレンダリング
					contentEl.empty();
					await MarkdownRenderer.renderMarkdown(
						this.displayMessages[assistantMessageIndex].content,
						contentEl,
						'',
						null as any
					);

					// 自動スクロール
					this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
				}
			);

			// 最終的なメッセージを保存
			this.messages.push({ role: 'assistant', content: result.fullText });
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('ChatGPT Error:', error);

			// エラー時は最後のユーザーメッセージとアシスタントメッセージを削除
			this.displayMessages.splice(assistantMessageIndex - 1, 2);
			this.messages.pop();
			this.inputEl.value = userInput;

			// エラーメッセージ要素を削除
			messageEl.remove();
		} finally {
			this.setLoading(false);
			this.inputEl.focus();
		}
	}

	async renderConversation() {
		this.conversationEl.empty();

		if (this.displayMessages.length === 0) {
			const emptyMsg = this.conversationEl.createDiv('chatgpt-empty-message');
			emptyMsg.textContent = '質問を入力して会話を始めましょう';
			return;
		}

		for (const msg of this.displayMessages) {
			const messageEl = this.conversationEl.createDiv(`chatgpt-message chatgpt-message-${msg.role}`);

			const iconEl = messageEl.createSpan('chatgpt-message-icon');
			iconEl.textContent = msg.role === 'user' ? '💬' : '🤖';

			const contentEl = messageEl.createDiv('chatgpt-message-content');

			// Markdownをレンダリング
			await MarkdownRenderer.renderMarkdown(
				msg.content,
				contentEl,
				'',
				null as any
			);
		}

		// 最新メッセージまでスクロール
		this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
	}

	setLoading(loading: boolean) {
		this.isLoading = loading;
		this.sendBtn.disabled = loading;
		this.insertBtn.disabled = loading;
		this.inputEl.disabled = loading;

		if (loading) {
			this.sendBtn.textContent = '送信中...';
			// ローディングインジケータを表示
			const loadingMsg = this.conversationEl.createDiv('chatgpt-message chatgpt-message-loading');
			loadingMsg.innerHTML = '<span class="chatgpt-message-icon">🤖</span><div class="chatgpt-message-content">考え中...</div>';
			this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
		} else {
			this.sendBtn.textContent = '送信';
			// ローディングインジケータを削除
			const loadingMsg = this.conversationEl.querySelector('.chatgpt-message-loading');
			if (loadingMsg) loadingMsg.remove();
		}
	}

	async handleInsertAndClose() {
		if (this.displayMessages.length === 0) {
			new Notice('会話履歴がありません');
			return;
		}

		// 会話履歴を整形してMarkdownに変換
		let conversationText = `\n\n---\n\n**Selected Context:**\n${this.selectedText}\n\n**ChatGPT Conversation:**\n\n`;

		this.displayMessages.forEach((msg, index) => {
			const questionNum = Math.floor(index / 2) + 1;
			if (msg.role === 'user') {
				conversationText += `**==Q${questionNum}:==** ${msg.content}\n\n`;
			} else {
				conversationText += `**==A${questionNum}:==** ${msg.content}\n\n`;
			}
		});

		// ドキュメントの最後に挿入
		const lastLine = this.editor.lastLine();
		const lastLineLength = this.editor.getLine(lastLine).length;

		this.editor.replaceRange(
			conversationText,
			{ line: lastLine, ch: lastLineLength }
		);

		// 挿入した位置までスクロール
		const newLastLine = this.editor.lastLine();
		this.editor.setCursor({ line: newLastLine, ch: 0 });

		new Notice('会話履歴を挿入しました！');

		// モーダルを閉じる
		this.close();
	}

	async onClose() {
		const { contentEl } = this;
		contentEl.empty();

		// リーディングモードに戻す
		if (this.readingModeInfo && this.readingModeInfo.wasInReadingMode) {
			await new Promise(resolve => setTimeout(resolve, 100));
			await this.readingModeInfo.view.setState(
				{ ...this.readingModeInfo.state, mode: 'preview' },
				{ history: false }
			);
		}
	}
}

// カスタムプロンプト入力モーダル（旧バージョン、互換性のため残す）
class CustomPromptModal extends Modal {
	onSubmit: (prompt: string) => void;
	focusInterval: number | null = null;
	readingModeInfo?: {
		view: MarkdownView;
		state: any;
		wasInReadingMode: boolean;
	};

	constructor(app: App, onSubmit: (prompt: string) => void, readingModeInfo?: { view: MarkdownView; state: any; wasInReadingMode: boolean }) {
		super(app);
		this.onSubmit = onSubmit;
		this.readingModeInfo = readingModeInfo;
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

		// モバイルでのカーソル点滅を改善するための属性
		inputEl.setAttribute('inputmode', 'text');
		inputEl.setAttribute('autocomplete', 'off');
		inputEl.setAttribute('autocorrect', 'off');
		inputEl.setAttribute('spellcheck', 'false');

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

		// フォーカスが失われた時に自動的に戻す（モバイル対応）
		inputEl.addEventListener('blur', () => {
			// ボタンクリック時以外はフォーカスを戻す
			setTimeout(() => {
				if (this.modalEl.isShown()) {
					inputEl.focus();
				}
			}, 10);
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

		// カーソル点滅を維持するため、定期的にフォーカスを再適用（モバイル対応）
		// 500ms間隔でフォーカスをチェック・維持
		this.focusInterval = window.setInterval(() => {
			if (document.activeElement !== inputEl && this.modalEl.isShown()) {
				inputEl.focus();
			}
		}, 500);
	}

	async onClose() {
		const { contentEl } = this;
		contentEl.empty();

		// フォーカス維持インターバルをクリア（メモリリーク防止）
		if (this.focusInterval !== null) {
			window.clearInterval(this.focusInterval);
			this.focusInterval = null;
		}

		// モーダルキャンセル時もリーディングモードに戻す
		if (this.readingModeInfo && this.readingModeInfo.wasInReadingMode) {
			await new Promise(resolve => setTimeout(resolve, 100));
			await this.readingModeInfo.view.setState(
				{ ...this.readingModeInfo.state, mode: 'preview' },
				{ history: false }
			);
		}
	}
}

// 設定画面
class ChatGPTSettingTab extends PluginSettingTab {
	plugin: ChatGPTPlugin;

	constructor(app: App, plugin: ChatGPTPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	displayUsageStats(containerEl: HTMLElement): void {
		const now = new Date();
		const currentMonth = now.getMonth();
		const currentYear = now.getFullYear();

		// 今月のデータのみフィルタリング
		const thisMonthRecords = this.plugin.settings.usageHistory.filter((record) => {
			const recordDate = new Date(record.date);
			return (
				recordDate.getMonth() === currentMonth &&
				recordDate.getFullYear() === currentYear
			);
		});

		// モデル別に集計
		const modelStats: {
			[model: string]: {
				tokens: number;
				cost: number;
				count: number;
			};
		} = {};

		let totalCost = 0;
		let totalTokens = 0;

		thisMonthRecords.forEach((record) => {
			if (!modelStats[record.model]) {
				modelStats[record.model] = { tokens: 0, cost: 0, count: 0 };
			}
			modelStats[record.model].tokens += record.totalTokens;
			modelStats[record.model].cost += record.estimatedCost;
			modelStats[record.model].count += 1;

			totalCost += record.estimatedCost;
			totalTokens += record.totalTokens;
		});

		// 使用料金セクション
		const usageSection = containerEl.createDiv('chatgpt-usage-section');
		usageSection.createEl('h3', { text: '📊 今月の利用料金' });

		const statsSummary = usageSection.createDiv('chatgpt-usage-summary');
		statsSummary.innerHTML = `
			<div style="background-color: var(--background-secondary); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
				<div style="font-size: 24px; font-weight: bold; color: var(--text-accent);">
					$${totalCost.toFixed(4)}
				</div>
				<div style="margin-top: 5px; color: var(--text-muted); font-size: 14px;">
					合計 ${totalTokens.toLocaleString()} トークン / ${thisMonthRecords.length} リクエスト
				</div>
			</div>
		`;

		// モデル別内訳
		if (Object.keys(modelStats).length > 0) {
			const breakdownEl = usageSection.createDiv('chatgpt-usage-breakdown');
			breakdownEl.createEl('strong', { text: 'モデル別内訳:' });
			breakdownEl.style.marginTop = '10px';

			const table = breakdownEl.createEl('table');
			table.style.width = '100%';
			table.style.marginTop = '10px';
			table.style.borderCollapse = 'collapse';

			const headerRow = table.createEl('tr');
			headerRow.innerHTML = `
				<th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--background-modifier-border);">モデル</th>
				<th style="text-align: right; padding: 8px; border-bottom: 1px solid var(--background-modifier-border);">リクエスト</th>
				<th style="text-align: right; padding: 8px; border-bottom: 1px solid var(--background-modifier-border);">トークン</th>
				<th style="text-align: right; padding: 8px; border-bottom: 1px solid var(--background-modifier-border);">コスト</th>
			`;

			Object.entries(modelStats).forEach(([model, stats]) => {
				const row = table.createEl('tr');
				row.innerHTML = `
					<td style="padding: 8px;">${model}</td>
					<td style="text-align: right; padding: 8px;">${stats.count}</td>
					<td style="text-align: right; padding: 8px;">${stats.tokens.toLocaleString()}</td>
					<td style="text-align: right; padding: 8px;">$${stats.cost.toFixed(4)}</td>
				`;
			});
		}

		// リセットボタン
		new Setting(usageSection)
			.setName('利用履歴をリセット')
			.setDesc('今月のデータを削除します（元に戻せません）')
			.addButton((button) =>
				button
					.setButtonText('リセット')
					.setWarning()
					.onClick(async () => {
						// 今月以外のデータを残す
						this.plugin.settings.usageHistory = this.plugin.settings.usageHistory.filter(
							(record) => {
								const recordDate = new Date(record.date);
								return (
									recordDate.getMonth() !== currentMonth ||
									recordDate.getFullYear() !== currentYear
								);
							}
						);
						await this.plugin.saveSettings();
						new Notice('利用履歴をリセットしました');
						this.display(); // 画面を再描画
					})
			);

		// 区切り線
		containerEl.createEl('hr', { attr: { style: 'margin: 20px 0;' } });
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'ChatGPT Integration Settings' });

		// 今月の利用料金セクション
		this.displayUsageStats(containerEl);

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
			.setDesc('Select ChatGPT model (GPT-5 versions have different pricing)')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('gpt-5.2', 'GPT-5.2 (Latest, Most Capable, $1.75/1M in)')
					.addOption('gpt-5.1', 'GPT-5.1 (Balanced)')
					.addOption('gpt-5', 'GPT-5 (Original)')
					.addOption('gpt-5-mini', 'GPT-5 Mini (Fast, $0.25/1M in)')
					.addOption('gpt-5-nano', 'GPT-5 Nano (Fastest, Cheapest)')
					.addOption('gpt-4o', 'GPT-4o')
					.addOption('gpt-4o-mini', 'GPT-4o Mini')
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

		// デバッグモード設定
		new Setting(containerEl)
			.setName('🐛 Debug Mode')
			.setDesc('Show debug logs as notices on screen. Logs are always saved to console and can be exported to chatgpt_debug_logs.txt')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
						new Notice(`Debug mode ${value ? 'enabled' : 'disabled'}`);
					})
			);

		// Web検索設定
		new Setting(containerEl)
			.setName('🌐 Web Search')
			.setDesc('Enable ChatGPT to search the web for current information when needed. Uses OpenAI\'s web_search tool.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useWebSearch)
					.onChange(async (value) => {
						this.plugin.settings.useWebSearch = value;
						await this.plugin.saveSettings();
						new Notice(`Web search ${value ? 'enabled' : 'disabled'}`);
					})
			);

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
