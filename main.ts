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

// デバッグモード（リリース時はfalseに）
const DEBUG_MODE = true;

// モバイルデバッグ用ログクラス
class MobileDebugLogger {
	private logs: string[] = [];
	private plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	log(message: string, data?: any) {
		const timestamp = new Date().toISOString().substring(11, 19);
		const logEntry = data
			? `[${timestamp}] ${message}: ${JSON.stringify(data).substring(0, 100)}`
			: `[${timestamp}] ${message}`;

		this.logs.push(logEntry);
		console.log(logEntry);

		// DEBUG_MODEの場合はNoticeでも表示
		if (DEBUG_MODE) {
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

	handleSelectionChange() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (!markdownView) {
			this.hideFloatingButton();
			return;
		}

		const editor = markdownView.editor;
		const selectedText = editor.getSelection();

		this.debugLogger.log('📝 handleSelectionChange', { length: selectedText?.length || 0 });

		if (selectedText && selectedText.trim()) {
			// エディタから取得した選択テキストをキャッシュに保存
			this.selectedTextCache = selectedText.trim();
			this.debugLogger.log('💾 Cached text', { length: this.selectedTextCache.length });
			this.showFloatingButton();
		} else {
			this.hideFloatingButton();
		}
	}

	showFloatingButton() {
		if (this.floatingButton) return;

		// キャッシュは既にhandleSelectionChange()で保存済み
		this.debugLogger.log('💬 showFloatingButton', { cacheLength: this.selectedTextCache.length });

		this.floatingButton = document.body.createDiv('chatgpt-floating-button');
		this.floatingButton.innerHTML = '💬';
		this.floatingButton.setAttribute('aria-label', 'Ask ChatGPT');

		this.floatingButton.addEventListener('click', async () => {
			// キャッシュをローカル変数にコピー（hideFloatingButton前に確保）
			const cachedText = this.selectedTextCache;
			this.debugLogger.log('🖱️ Button clicked', { textLength: cachedText.length });

			this.hideFloatingButton();
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				// ローカル変数のキャッシュを使用して直接askChatGPTCustomを呼ぶ
				const editor = markdownView.editor;
				await this.askChatGPTCustom(editor, cachedText);
				// 使用後にキャッシュをクリア
				this.selectedTextCache = '';
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

	async askChatGPTCustom(editor: Editor, cachedText?: string) {
		this.debugLogger.log('🎯 askChatGPTCustom called', { hasCached: !!cachedText, cachedLength: cachedText?.length || 0 });

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

		let selectedText = cachedText || editor.getSelection();
		this.debugLogger.log('✅ Final selectedText', { length: selectedText?.length || 0, preview: selectedText?.substring(0, 50) });

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

	// 会話履歴を使ったOpenAI API呼び出し（対話型モーダル用）
	async callOpenAIWithHistory(messages: Array<{role: string, content: string}>): Promise<string> {
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: this.settings.model,
				messages: messages,
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

		this.plugin.debugLogger.log('🎨 Modal created', { selectedLength: selectedText.length, preview: selectedText.substring(0, 50) });

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

		// 会話履歴表示エリア（スクロール可能）
		this.conversationEl = contentEl.createDiv('chatgpt-conversation');

		// 入力エリア
		const inputSection = contentEl.createDiv('chatgpt-input-section');

		this.inputEl = inputSection.createEl('textarea', {
			placeholder: 'Ask a question about the selected text...',
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
		const buttonContainer = inputSection.createDiv('chatgpt-button-container');

		this.sendBtn = buttonContainer.createEl('button', { text: '送信', cls: 'chatgpt-send-btn' });
		this.sendBtn.addEventListener('click', () => this.handleSend());

		this.insertBtn = buttonContainer.createEl('button', { text: '挿入して閉じる', cls: 'chatgpt-insert-btn' });
		this.insertBtn.addEventListener('click', () => this.handleInsertAndClose());

		// デバッグモード時のみ表示
		if (DEBUG_MODE) {
			const debugBtn = buttonContainer.createEl('button', { text: '🐛 ログ保存', cls: 'chatgpt-cancel-btn' });
			debugBtn.addEventListener('click', async () => {
				await this.plugin.debugLogger.saveToFile();
			});
		}

		const cancelBtn = buttonContainer.createEl('button', { text: 'キャンセル', cls: 'chatgpt-cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		// 初期フォーカス
		setTimeout(() => this.inputEl.focus(), 100);
	}

	async handleSend() {
		const userInput = this.inputEl.value.trim();
		if (!userInput || this.isLoading) return;

		// ユーザーメッセージを追加
		this.displayMessages.push({ role: 'user', content: userInput });
		this.messages.push({ role: 'user', content: userInput });

		// 入力欄をクリア
		this.inputEl.value = '';

		// UI更新
		this.renderConversation();
		this.setLoading(true);

		try {
			// ChatGPT APIを呼び出し
			const response = await this.plugin.callOpenAIWithHistory(this.messages);

			// アシスタントメッセージを追加
			this.displayMessages.push({ role: 'assistant', content: response });
			this.messages.push({ role: 'assistant', content: response });

			// UI更新
			this.renderConversation();
		} catch (error) {
			new Notice(`Error: ${error.message}`);
			console.error('ChatGPT Error:', error);

			// エラー時は最後のユーザーメッセージを削除（再試行可能に）
			this.displayMessages.pop();
			this.messages.pop();
			this.inputEl.value = userInput;
		} finally {
			this.setLoading(false);
			this.inputEl.focus();
		}
	}

	renderConversation() {
		this.conversationEl.empty();

		if (this.displayMessages.length === 0) {
			const emptyMsg = this.conversationEl.createDiv('chatgpt-empty-message');
			emptyMsg.textContent = '質問を入力して会話を始めましょう';
			return;
		}

		this.displayMessages.forEach((msg) => {
			const messageEl = this.conversationEl.createDiv(`chatgpt-message chatgpt-message-${msg.role}`);

			const iconEl = messageEl.createSpan('chatgpt-message-icon');
			iconEl.textContent = msg.role === 'user' ? '💬' : '🤖';

			const contentEl = messageEl.createDiv('chatgpt-message-content');
			contentEl.textContent = msg.content;
		});

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
				conversationText += `**Q${questionNum}:** ${msg.content}\n\n`;
			} else {
				conversationText += `**A${questionNum}:** ${msg.content}\n\n`;
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
