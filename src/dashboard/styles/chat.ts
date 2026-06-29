/** @module styles/chat — CSS for chat UI, docs panel, tool picker modal, and toast notifications */
export const chatStyles = `
    /* ── Docs page ── */
    #tab-docs.active { display: flex; flex-direction: column; height: 100%; }

    .docs-layout {
      display: flex;
      flex: 1;
      min-height: 0;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      position: relative;
    }

    /* ── Navigation sidebar ── */
    .docs-nav {
      width: 220px;
      flex-shrink: 0;
      overflow-y: hidden;
      border-right: 1px solid var(--glass-border);
      padding: 0;
      display: flex;
      flex-direction: column;
    }

    .docs-search-wrap {
      padding: 0.6rem 0.65rem;
      border-bottom: 1px solid var(--glass-border);
      position: relative;
    }
    .docs-search-input {
      width: 100%;
      padding: 0.4rem 0.6rem 0.4rem 1.85rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-card);
      font-size: 0.78rem;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
    }
    .docs-search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(184,151,90,0.12); }
    .docs-search-input::placeholder { color: var(--text-dim); }
    .docs-search-icon { position: absolute; left: 1.1rem; top: 50%; transform: translateY(-50%); opacity: 0.35; pointer-events: none; }

    .docs-nav-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0.25rem 0 0.5rem;
    }

    .docs-cat-header {
      padding: 0.6rem 0.85rem 0.25rem;
      font-size: 0.66rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      user-select: none;
    }
    .docs-cat-header:not(:first-child) { margin-top: 0.3rem; border-top: 1px solid rgba(44,44,44,0.05); padding-top: 0.6rem; }

    .docs-nav-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.85rem 0.45rem 1.1rem;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
      font-size: 0.82rem;
      color: var(--text);
      border-radius: 0 6px 6px 0;
      margin-right: 0.35rem;
    }
    .docs-nav-item:hover { background: var(--surface-hover); border-left-color: rgba(184,151,90,0.3); }
    .docs-nav-item.active { background: rgba(184,151,90,0.15); border-left-color: var(--accent); color: var(--accent2); font-weight: 600; }
    .docs-nav-item.docs-hidden { display: none; }
    .docs-nav-icon { font-size: 1rem; width: 1.3rem; text-align: center; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .docs-nav-icon svg { flex-shrink: 0; vertical-align: middle; opacity: 0.6; transition: opacity 0.15s; }
    .docs-nav-item.active .docs-nav-icon svg { opacity: 1; }
    .docs-nav-item:hover .docs-nav-icon svg { opacity: 0.85; }

    .docs-no-results { padding: 1.5rem 0.85rem; text-align: center; font-size: 0.82rem; color: var(--text-dim); }

    /* ── Content panel ── */
    .docs-content-panel {
      flex: 1;
      overflow-y: auto;
      padding: 0;
      scroll-behavior: smooth;
    }

    .docs-progress { position: sticky; top: 0; left: 0; right: 0; height: 2px; background: var(--accent); width: 0%; z-index: 10; border-radius: 0 1px 1px 0; pointer-events: none; transition: width 80ms linear; }

    /* Hero header */
    .docs-hero { padding: 1.5rem 2rem 1rem; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, rgba(184,151,90,0.06) 0%, transparent 100%); display: flex; align-items: center; gap: 1rem; }
    .docs-hero-icon { width: 42px; height: 42px; border-radius: 10px; background: rgba(184,151,90,0.1); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .docs-hero-icon svg { width: 22px; height: 22px; stroke: var(--accent2); }
    .docs-hero-text h2 { font-size: 1.2rem; color: var(--text); margin: 0; border: none; padding: 0; font-weight: 700; }
    .docs-hero-sub { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.15rem; }

    /* Body container */
    .docs-body { padding: 1.25rem 2rem 2rem; animation: docsFadeIn 0.25s ease; }
    @keyframes docsFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    /* Mini TOC */
    .docs-mini-toc { background: rgba(184,151,90,0.04); border: 1px solid var(--border); border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 1.25rem; }
    .docs-mini-toc-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); margin-bottom: 0.35rem; }
    .docs-mini-toc-item { display: block; padding: 0.18rem 0 0.18rem 0.6rem; font-size: 0.8rem; color: var(--text-muted); cursor: pointer; border-left: 2px solid transparent; transition: all 0.15s; }
    .docs-mini-toc-item:hover { color: var(--accent2); border-left-color: var(--accent); }

    /* ── Headings ── */
    .docs-body h3 { font-size: 0.95rem; color: var(--text); margin-top: 1.5rem; margin-bottom: 0.5rem; padding-bottom: 0.35rem; border-bottom: 1px solid rgba(44,44,44,0.06); cursor: pointer; user-select: none; scroll-margin-top: 12px; display: flex; align-items: center; gap: 0.35rem; }
    .docs-body h3:hover { color: var(--accent2); }
    .docs-body h3 .docs-h3-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0; opacity: 0.7; }
    .docs-body h3 .docs-chevron { margin-left: auto; opacity: 0.3; flex-shrink: 0; transition: transform 0.2s ease, opacity 0.15s; }
    .docs-body h3:hover .docs-chevron { opacity: 0.6; }
    .docs-body h3.docs-collapsed .docs-chevron { transform: rotate(-90deg); }
    .docs-body h3.docs-collapsed + .docs-h3-content { display: none; }
    .docs-h3-content { animation: docsFadeIn 0.2s ease; }
    .docs-body h4 { font-size: 0.88rem; color: var(--text); margin-top: 1rem; margin-bottom: 0.35rem; font-weight: 600; }

    /* ── Text ── */
    .docs-body p { font-size: 0.86rem; color: var(--text); line-height: 1.7; margin-bottom: 0.6rem; }
    .docs-body ul, .docs-body ol { font-size: 0.86rem; color: var(--text); line-height: 1.7; margin-bottom: 0.8rem; padding-left: 1.5rem; }
    .docs-body li { margin-bottom: 0.3rem; }

    /* Inline code */
    .docs-body code { background: rgba(44,44,44,0.06); padding: 0.1rem 0.38rem; border-radius: 4px; font-size: 0.79rem; font-family: var(--font-mono); color: var(--accent2); }

    /* Code blocks */
    .docs-code-wrap { position: relative; margin-bottom: 0.8rem; }
    .docs-body pre { background: rgba(44,44,44,0.04); border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem 1rem; font-size: 0.79rem; font-family: var(--font-mono); overflow-x: auto; margin-bottom: 0; line-height: 1.6; }
    .docs-body pre code { background: none; padding: 0; font-size: inherit; color: var(--text); }
    .docs-copy-btn { position: absolute; top: 0.4rem; right: 0.4rem; padding: 0.2rem 0.45rem; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; font-size: 0.68rem; color: var(--text-muted); cursor: pointer; opacity: 0; transition: opacity 0.15s, background 0.15s; font-family: inherit; display: flex; align-items: center; gap: 0.25rem; }
    .docs-code-wrap:hover .docs-copy-btn { opacity: 1; }
    .docs-copy-btn:hover { background: var(--surface-hover); color: var(--text); }
    .docs-copy-btn.docs-copied { color: var(--green); border-color: rgba(76,175,80,0.3); }

    /* Callout boxes */
    .docs-tip { background: rgba(91,141,184,0.06); border: 1px solid rgba(91,141,184,0.12); border-left: 3px solid var(--blue); padding: 0.7rem 1rem; border-radius: 0 8px 8px 0; margin: 0.75rem 0; font-size: 0.84rem; line-height: 1.6; }
    .docs-warn { background: rgba(212,160,23,0.05); border: 1px solid rgba(212,160,23,0.12); border-left: 3px solid var(--yellow); padding: 0.7rem 1rem; border-radius: 0 8px 8px 0; margin: 0.75rem 0; font-size: 0.84rem; line-height: 1.6; }

    /* Tables */
    .docs-cmd-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 1rem; font-size: 0.84rem; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .docs-cmd-table th { text-align: left; padding: 0.5rem 0.75rem; background: rgba(184,151,90,0.07); font-weight: 600; color: var(--accent2); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .docs-cmd-table td { padding: 0.45rem 0.75rem; border-top: 1px solid rgba(44,44,44,0.05); vertical-align: top; transition: background 0.1s; }
    .docs-cmd-table tr:hover td { background: rgba(184,151,90,0.03); }
    .docs-cmd-table td:first-child { font-family: var(--font-mono); font-size: 0.79rem; white-space: nowrap; color: var(--accent); }

    /* Back to top */
    .docs-back-top { position: absolute; bottom: 1rem; right: 1.5rem; width: 34px; height: 34px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.2s, background 0.15s, transform 0.15s; box-shadow: var(--shadow-sm); z-index: 5; }
    .docs-back-top.visible { opacity: 1; pointer-events: auto; }
    .docs-back-top:hover { background: var(--surface-hover); transform: scale(1.08); }
    .docs-back-top svg { width: 16px; height: 16px; stroke: var(--text-muted); }

    /* Chat layout */
    .chat-layout {
      display: flex;
      gap: 1rem;
      flex: 1;
      min-height: 0;
    }

    .chat-sidebar {
      width: 260px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .chat-sidebar-header {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0 0.25rem;
    }

    .chat-sidebar-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .chat-sidebar-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .chat-refresh-btn {
      width: 30px; height: 30px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      color: var(--text-muted);
      transition: all var(--transition-fast);
    }

    .chat-refresh-btn:hover {
      color: var(--accent);
    }

    .chat-new-session-btn {
      width: 100%;
      padding: 0.5rem 0.75rem;
      font-size: 0.84rem;
      font-weight: 600;
      gap: 0.4rem;
      border-radius: 8px;
      justify-content: center;
      transition: all var(--transition-fast);
    }

    .chat-new-session-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(184,151,90,0.25);
    }

    .chat-tree {
      flex: 1;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--glass);
      box-shadow: var(--shadow-sm);
    }

    .chat-tree-tool-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.6rem;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text);
      border-bottom: 1px solid rgba(44,44,44,0.06);
    }

    .chat-tree-tool-header:hover { background: var(--surface-hover); }

    .chat-tree-arrow {
      display: inline-block;
      font-size: 0.7rem;
      transition: transform 0.15s;
      color: var(--text-dim);
      width: 1rem;
      text-align: center;
    }

    .chat-tree-arrow.open { transform: rotate(90deg); }

    .chat-tree-icon {
      width: 18px; height: 18px;
      border-radius: 3px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .chat-tree-count {
      margin-left: auto;
      font-size: 0.72rem;
      color: var(--text-dim);
      background: rgba(44,44,44,0.06);
      padding: 0.1rem 0.4rem;
      border-radius: 9999px;
    }

    .chat-tree-children { display: none; }
    .chat-tree-children.open { display: block; }

    .chat-tree-session {
      display: flex;
      align-items: center;
      padding: 0.45rem 0.6rem 0.45rem 2.2rem;
      cursor: pointer;
      transition: all var(--transition-fast);
      border-bottom: 1px solid rgba(44,44,44,0.04);
      border-left: 3px solid transparent;
      font-size: 0.82rem;
    }

    .chat-tree-session:hover { background: var(--surface-hover); border-left-color: rgba(184,151,90,0.3); }
    .chat-tree-session.active { background: rgba(184,151,90,0.15); border-left-color: var(--accent); }

    .chat-tree-session-info { flex: 1; min-width: 0; }

    .chat-tree-session-id { font-family: var(--font-mono); font-size: 0.82rem; color: var(--accent); }
    .chat-tree-session-meta { font-size: 0.7rem; color: var(--text-dim); margin-top: 0.1rem; }

    .chat-tree-delete {
      opacity: 0;
      transition: opacity 0.15s;
      background: none;
      border: none;
      color: var(--red);
      cursor: pointer;
      font-size: 0.9rem;
      padding: 0.15rem 0.3rem;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .chat-tree-session:hover .chat-tree-delete { opacity: 1; }
    .chat-tree-delete:hover { background: rgba(192,57,43,0.12); }

    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      position: relative;
    }

    .chat-main-header {
      display: none;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--border);
      border-bottom: none;
      border-radius: var(--radius) var(--radius) 0 0;
      background: var(--glass);
    }

    .chat-main-header.visible {
      display: flex;
    }

    .chat-main-header .chat-main-session-label {
      margin-right: auto;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    .chat-main-header-has-header + .chat-messages {
      border-radius: 0;
    }

    /* Tool picker modal */
    .chat-tool-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9000;
      background: rgba(44,44,44,0.5);
      backdrop-filter: blur(6px);
      align-items: center;
      justify-content: center;
    }

    .chat-tool-modal-overlay.open {
      display: flex;
      animation: overlayFadeIn 0.2s ease;
    }

    .chat-tool-modal {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem 2rem 1.5rem;
      min-width: 420px;
      max-width: 90vw;
      text-align: center;
      box-shadow: var(--shadow-lg);
      animation: modalSlideIn 0.25s ease;
    }

    .chat-tool-modal h3 {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.35rem;
    }

    .chat-tool-modal-subtitle {
      font-size: 0.78rem;
      color: var(--text-dim);
      margin-bottom: 1.25rem;
    }

    .chat-tool-modal-grid {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
    }

    /* Base tool card */
    .chat-tool-modal-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      padding: 1rem 1.2rem 0.85rem;
      border-radius: var(--radius);
      border: 2px solid var(--border);
      background: var(--surface);
      cursor: pointer;
      transition: all var(--transition-med);
      min-width: 115px;
      position: relative;
    }

    .chat-tool-modal-item:active { transform: translateY(-1px); }

    .chat-tool-modal-item img {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      object-fit: contain;
    }

    .chat-tool-modal-item .tool-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }

    .chat-tool-modal-item .tool-desc {
      font-size: 0.68rem;
      color: var(--text-dim);
      line-height: 1.3;
      max-width: 110px;
    }

    /* Claude — warm coral/terracotta */
    .chat-tool-modal-item.tool-claude {
      border-color: rgba(217,119,87,0.35);
      background: var(--bg-card);
    }
    .chat-tool-modal-item.tool-claude:hover {
      border-color: #D97757;
      background: var(--bg-card);
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(217,119,87,0.18);
    }
    .chat-tool-modal-item.tool-claude .tool-name { color: #B85A3A; }

    /* Codex — teal/green */
    .chat-tool-modal-item.tool-codex {
      border-color: rgba(16,163,127,0.30);
      background: var(--bg-card);
    }
    .chat-tool-modal-item.tool-codex:hover {
      border-color: #10A37F;
      background: var(--bg-card);
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(16,163,127,0.18);
    }
    .chat-tool-modal-item.tool-codex .tool-name { color: #0D8A6A; }

    /* Gemini — blue */
    .chat-tool-modal-item.tool-gemini {
      border-color: rgba(66,133,244,0.30);
      background: var(--bg-card);
    }
    .chat-tool-modal-item.tool-gemini:hover {
      border-color: #4285F4;
      background: var(--bg-card);
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(66,133,244,0.18);
    }
    .chat-tool-modal-item.tool-gemini .tool-name { color: #3367BD; }

    /* Mode segmented control */
    .chat-tool-modal-mode {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1.25rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .chat-tool-modal-mode-label {
      font-weight: 500;
      color: var(--text-muted);
      margin-right: 0.15rem;
    }

    .chat-tool-modal-segments {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }

    .chat-tool-modal-segments input[type="radio"] { display: none; }

    .chat-tool-modal-segments label {
      padding: 0.3rem 0.7rem;
      font-size: 0.78rem;
      font-family: inherit;
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
      border-right: 1px solid var(--border);
      user-select: none;
    }

    .chat-tool-modal-segments label:last-of-type { border-right: none; }

    .chat-tool-modal-segments input[type="radio"]:checked + label {
      background: var(--accent);
      color: #fff;
      font-weight: 500;
    }

    .chat-tool-modal-segments label:hover {
      background: var(--surface-hover);
    }

    .chat-tool-modal-segments input[type="radio"]:checked + label:hover {
      background: var(--accent2);
    }

    .chat-tool-modal-cancel {
      margin-top: 1rem;
      font-size: 0.78rem;
      color: #fff;
      cursor: pointer;
      background: var(--red);
      border: none;
      padding: 0.4rem 1.4rem;
      border-radius: 6px;
      transition: all var(--transition-fast);
    }

    .chat-tool-modal-cancel:hover {
      background: rgba(192,57,43,0.85);
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius) var(--radius) 0 0;
      background: rgba(255,255,255,0.6);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      box-shadow: inset 0 1px 3px rgba(44,44,44,0.03);
    }

    .chat-messages-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-dim);
      font-size: 0.9rem;
    }

    .chat-bubble {
      max-width: 80%;
      padding: 0.6rem 0.85rem;
      border-radius: 12px;
      font-size: 0.85rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      animation: bubbleIn 0.25s ease;
    }

    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .chat-bubble.user {
      align-self: flex-end;
      background: rgba(184,151,90,0.15);
      border: 1px solid rgba(184,151,90,0.3);
      color: var(--text);
      border-bottom-right-radius: 4px;
    }

    .chat-bubble.assistant {
      align-self: flex-start;
      background: var(--glass);
      border: 1px solid var(--glass-border);
      color: var(--text);
      border-bottom-left-radius: 4px;
    }

    .chat-bubble.tool-use {
      align-self: flex-start;
      background: rgba(212,160,23,0.1);
      border: 1px solid rgba(212,160,23,0.2);
      color: var(--yellow);
      font-size: 0.78rem;
      font-family: var(--font-mono);
      cursor: pointer;
    }

    .chat-bubble.error {
      align-self: flex-start;
      background: rgba(192,57,43,0.08);
      border: 1px solid rgba(192,57,43,0.15);
      color: var(--red);
      font-size: 0.78rem;
      font-family: var(--font-mono);
      word-break: break-all;
    }

    .chat-bubble.artifacts {
      align-self: flex-start;
      background: rgba(52,152,219,0.06);
      border: 1px solid rgba(52,152,219,0.18);
      border-left: 3px solid var(--accent);
      padding: 0.625rem 0.875rem;
      max-width: 90%;
    }
    .artifacts-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .artifact-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0;
      border-bottom: 1px solid rgba(0,0,0,0.04);
    }
    .artifact-item:last-child { border-bottom: none; }
    .artifact-icon { font-size: 1.1rem; flex-shrink: 0; }
    .artifact-info { flex: 1; min-width: 0; }
    .artifact-name {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text);
      word-break: break-all;
    }
    .artifact-meta {
      font-size: 0.68rem;
      color: var(--text-muted);
    }
    .artifact-dl {
      flex-shrink: 0;
      font-size: 0.72rem;
      color: var(--accent);
      text-decoration: none;
      padding: 0.2rem 0.5rem;
      border: 1px solid rgba(52,152,219,0.3);
      border-radius: 4px;
      cursor: pointer;
    }
    .artifact-dl:hover { background: rgba(52,152,219,0.08); }
    .artifact-img-preview {
      max-width: 100%;
      max-height: 300px;
      border-radius: 4px;
      margin-top: 0.25rem;
      cursor: pointer;
    }
    .artifact-img-preview:hover { opacity: 0.85; }

    .chat-bubble.system {
      align-self: flex-start;
      background: rgba(212,160,23,0.08);
      border: 1px solid rgba(212,160,23,0.25);
      border-left: 3px solid var(--yellow);
      color: var(--text);
      font-size: 0.82rem;
      max-width: 90%;
    }

    .chat-bubble.system .approval-tool-name {
      font-weight: 600;
      color: var(--yellow);
    }

    .chat-bubble.system .approval-args {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      background: rgba(0,0,0,0.06);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
      margin: 0.4rem 0;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .approval-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .approval-actions .btn-approve {
      background: rgba(76,175,80,0.15);
      border: 1px solid rgba(76,175,80,0.4);
      color: var(--green);
      padding: 0.3rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .approval-actions .btn-approve:hover { background: rgba(76,175,80,0.3); }

    .approval-actions .btn-deny {
      background: rgba(192,57,43,0.1);
      border: 1px solid rgba(192,57,43,0.3);
      color: var(--red);
      padding: 0.3rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .approval-actions .btn-deny:hover { background: rgba(192,57,43,0.25); }

    .approval-expired {
      color: var(--text-dim);
      font-style: italic;
      font-size: 0.78rem;
      margin-top: 0.3rem;
    }

    .approval-result-badge {
      display: inline-block;
      padding: 0.2rem 0.7rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .approval-result-badge.approved {
      background: rgba(76,175,80,0.15);
      color: var(--green);
    }
    .approval-result-badge.denied {
      background: rgba(192,57,43,0.1);
      color: var(--red);
    }

    .chat-bubble.system-result {
      align-self: flex-end;
      background: none;
      border: none;
      padding: 0.15rem 0;
      text-align: center;
    }

    .chat-bubble pre {
      position: relative;
      background: rgba(197,165,90,0.08);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      overflow-x: auto;
      margin: 0.4rem 0;
      font-size: 0.8rem;
      line-height: 1.45;
      white-space: pre;
    }

    .chat-bubble pre .code-lang {
      position: absolute;
      top: 0;
      right: 0;
      padding: 0.1rem 0.5rem;
      font-size: 0.65rem;
      color: var(--text-muted);
      background: rgba(197,165,90,0.12);
      border-radius: 0 6px 0 4px;
      border-left: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      font-family: inherit;
      text-transform: lowercase;
      user-select: none;
    }

    .chat-bubble pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: inherit;
      color: inherit;
    }

    .chat-bubble code {
      background: rgba(197,165,90,0.13);
      border: 1px solid rgba(197,165,90,0.2);
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      font-size: 0.8em;
      font-family: var(--font-mono);
    }

    .chat-bubble strong { font-weight: 600; }
    .chat-bubble em { font-style: italic; }
    .chat-bubble s { text-decoration: line-through; opacity: 0.7; }

    .chat-bubble blockquote {
      margin: 0.4rem 0;
      padding: 0.3rem 0.7rem;
      border-left: 3px solid rgba(197,165,90,0.5);
      background: rgba(197,165,90,0.04);
      border-radius: 0 4px 4px 0;
      color: var(--text-muted);
    }
    .chat-bubble blockquote p { margin: 0.15rem 0; }
    .chat-bubble blockquote blockquote { margin: 0.2rem 0; }

    .chat-bubble .task-item {
      list-style: none;
      margin-left: -1.4em;
    }
    .chat-bubble .task-item input[type="checkbox"] {
      margin-right: 0.35em;
      vertical-align: middle;
      accent-color: var(--accent);
    }

    .chat-bubble a {
      color: var(--accent2);
      text-decoration: underline;
      text-underline-offset: 2px;
      word-break: break-all;
    }
    .chat-bubble a:hover { color: var(--accent); }

    .chat-bubble h1, .chat-bubble h2, .chat-bubble h3,
    .chat-bubble h4, .chat-bubble h5, .chat-bubble h6 {
      margin: 0.6rem 0 0.3rem;
      font-weight: 600;
      line-height: 1.3;
    }
    .chat-bubble h1 { font-size: 1.15em; }
    .chat-bubble h2 { font-size: 1.05em; }
    .chat-bubble h3 { font-size: 0.95em; }
    .chat-bubble h4, .chat-bubble h5, .chat-bubble h6 { font-size: 0.88em; }
    .chat-bubble *:first-child { margin-top: 0; }

    .chat-bubble hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 0.5rem 0;
    }

    .chat-bubble ul, .chat-bubble ol {
      margin: 0.3rem 0;
      padding-left: 1.4em;
    }
    .chat-bubble li {
      margin: 0.15rem 0;
    }

    .chat-bubble table {
      border-collapse: collapse;
      margin: 0.4rem 0;
      font-size: 0.82em;
      width: 100%;
      overflow-x: auto;
      display: block;
    }
    .chat-bubble th, .chat-bubble td {
      border: 1px solid var(--border);
      padding: 0.3rem 0.5rem;
      text-align: left;
    }
    .chat-bubble th {
      background: rgba(197,165,90,0.1);
      font-weight: 600;
    }
    .chat-bubble tbody tr:nth-child(even) {
      background: rgba(197,165,90,0.04);
    }

    .chat-bubble p {
      margin: 0.3rem 0;
    }

    .chat-bubble p:last-child { margin-bottom: 0; }

    .chat-input-area {
      display: flex;
      gap: 0.5rem;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 var(--radius) var(--radius);
      background: var(--glass);
    }

    .chat-input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-family: inherit;
      font-size: 0.85rem;
      resize: none;
      outline: none;
      min-height: 38px;
      max-height: 160px;
      overflow-y: hidden;
      line-height: 1.4;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(184,151,90,0.12); }

    .chat-send-btn {
      align-self: flex-end;
    }

    .chat-send-btn.btn-stop {
      background: rgba(192,57,43,0.12);
      border-color: rgba(192,57,43,0.35);
      color: var(--red);
      font-weight: 600;
    }
    .chat-send-btn.btn-stop:hover {
      background: rgba(192,57,43,0.25);
    }

    .chat-attach-btn {
      align-self: flex-end;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.35rem 0.6rem;
      font-size: 1.2rem;
      font-weight: 600;
      line-height: 1;
      transition: color 0.15s, border-color 0.15s;
    }
    .chat-attach-btn:hover { color: var(--accent); border-color: var(--accent); }
    .chat-attach-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .chat-file-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem 0;
      border: 1px solid var(--border);
      border-bottom: none;
      background: var(--glass);
    }
    .chat-file-preview:empty { display: none; }

    .chat-file-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.5rem;
      background: rgba(197,165,90,0.12);
      border: 1px solid rgba(197,165,90,0.25);
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--text);
      max-width: 200px;
    }
    .chat-file-chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-file-chip-remove {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1;
      padding: 0 0.1rem;
    }
    .chat-file-chip-remove:hover { color: var(--red); }

    .chat-drop-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(197,165,90,0.08);
      border: 2px dashed var(--accent);
      border-radius: var(--radius);
      z-index: 20;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
      color: var(--accent);
      font-weight: 600;
      pointer-events: none;
    }
    .chat-drop-overlay.visible { display: flex; }

    /* ── Working Indicator Bar ── */
    #chat-working-bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0 0.85rem;
      background: rgba(46,160,67,0.10);
      border: 1px solid rgba(46,160,67,0.35);
      border-radius: 0;
      margin: 0;
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      position: relative;
      transition: opacity 0.25s ease, max-height 0.3s ease, padding 0.3s ease;
    }
    /* White wave sweep overlay */
    #chat-working-bar::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255,255,255,0.25) 35%,
        rgba(255,255,255,0.6) 50%,
        rgba(255,255,255,0.25) 65%,
        transparent 100%
      );
      background-size: 200% 100%;
      animation: workingShimmer 2.5s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes workingShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    #chat-working-bar.visible {
      opacity: 1;
      max-height: 52px;
      padding-top: 0.5rem;
      padding-bottom: 0.5rem;
    }

    /* 3-dot bounce animation */
    .working-dots {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .working-dots span {
      display: block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(46,160,67,0.7);
      animation: workingBounce 1.4s ease-in-out infinite;
    }
    .working-dots span:nth-child(2) { animation-delay: 0.16s; }
    .working-dots span:nth-child(3) { animation-delay: 0.32s; }
    @keyframes workingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    /* Label */
    .working-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: rgba(46,160,67,0.85);
      flex-shrink: 0;
      user-select: none;
    }

    /* Streaming text preview */
    .working-streaming-text {
      flex: 1;
      font-size: 0.75rem;
      color: var(--text-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .chat-load-more {
      text-align: center;
      padding: 0.5rem;
    }

    /* ── Thinking Preamble ── */
    .thinking-preamble {
      border-left: 3px solid rgba(197,165,90,0.5);
      background: rgba(197,165,90,0.04);
      border-radius: 0 6px 6px 0;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.4rem;
    }

    .thinking-preamble-label {
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.3rem;
    }

    .thinking-preamble-content p {
      color: var(--text-muted);
      font-size: 0.82rem;
    }

    .thinking-preamble.collapsed .thinking-preamble-content {
      max-height: 4.5em;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
      mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
    }

    .thinking-toggle {
      background: none;
      border: none;
      color: var(--accent2);
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0.2rem 0;
      font-weight: 500;
    }
    .thinking-toggle:hover { text-decoration: underline; }

    hr.thinking-divider {
      border: none;
      border-top: 1px dashed var(--border);
      margin: 0.5rem 0;
    }

    .chat-bubble ol > li > ul {
      margin: 0.2rem 0 0.1rem;
      padding-left: 1.2em;
      list-style: disc;
    }

    /* Offline banner */
    .offline-banner {
      display: none;
      background: rgba(192,57,43,0.08);
      border: 1px solid rgba(192,57,43,0.2);
      border-left: 4px solid var(--red);
      border-radius: 8px;
      padding: 0.6rem 1rem;
      margin-bottom: 1rem;
      color: var(--red);
      font-size: 0.85rem;
      text-align: center;
    }

    .offline-banner.visible { display: block; animation: fadeSlideIn 0.3s ease; }

    .restart-banner {
      display: none;
      background: rgba(212,160,23,0.08);
      border: 1px solid rgba(212,160,23,0.2);
      border-left: 4px solid var(--yellow);
      border-radius: 8px;
      padding: 0.6rem 1rem;
      margin-bottom: 1rem;
      font-size: 0.85rem;
      color: var(--yellow);
      align-items: center;
      gap: 0.75rem;
    }
    .restart-banner.visible { display: flex; animation: fadeSlideIn 0.3s ease; }
    .restart-banner .restart-keys { font-family: var(--font-mono); font-size: 0.8rem; }

    /* Toast */
    .toast-container {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .toast {
      padding: 0.6rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      color: #fff;
      animation: toastIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), toastOut 0.3s ease 2.7s forwards;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      backdrop-filter: blur(8px);
    }

    .toast-success { background: rgba(76,175,80,0.92); }
    .toast-error { background: rgba(192,57,43,0.92); }

    @keyframes toastIn { from { opacity:0; transform:translateX(40px) scale(0.9); } to { opacity:1; transform:translateX(0) scale(1); } }
    @keyframes toastOut { to { opacity:0; transform:translateX(40px) scale(0.9); } }

    /* Responsive */
    @media (max-width: 768px) {
      .chat-layout { flex-direction: column; }
      .chat-sidebar { width: 100%; max-height: 200px; flex-shrink: 0; }
      .sidebar { width: 60px; }
      .sidebar-brand h1, .sidebar-brand .version, .nav-label { display: none; }
      .nav-item { justify-content: center; padding: 0.65rem; }
      .nav-icon { margin: 0; }
      .content { padding: 1rem; }
    }

    /* ═══════════════════════════════════════════════
       Dark Mode Overrides
       ═══════════════════════════════════════════════ */

    :root[data-theme="dark"] .docs-search-input { background: var(--bg-subtle); }

    :root[data-theme="dark"] .docs-body h3 { border-bottom-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .docs-cat-header:not(:first-child) { border-top-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .docs-body code { background: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .docs-body pre { background: rgba(255,255,255,0.04); }

    :root[data-theme="dark"] .chat-messages {
      background: rgba(26,26,26,0.6);
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.15);
    }

    :root[data-theme="dark"] .chat-input { background: var(--bg-subtle); }

    :root[data-theme="dark"] .chat-tree-tool-header { border-bottom-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .chat-tree-session { border-bottom-color: rgba(255,255,255,0.04); }
    :root[data-theme="dark"] .chat-tree-count { background: rgba(255,255,255,0.08); }

    :root[data-theme="dark"] .chat-tool-modal-overlay { background: rgba(0,0,0,0.6); }

    :root[data-theme="dark"] .chat-tool-modal-item.tool-claude {
      background: var(--surface);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-claude:hover {
      background: var(--surface-hover);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-claude .tool-name { color: #e8926e; }

    :root[data-theme="dark"] .chat-tool-modal-item.tool-codex {
      background: var(--surface);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-codex:hover {
      background: var(--surface-hover);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-codex .tool-name { color: #34d399; }

    :root[data-theme="dark"] .chat-tool-modal-item.tool-gemini {
      background: var(--surface);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-gemini:hover {
      background: var(--surface-hover);
    }
    :root[data-theme="dark"] .chat-tool-modal-item.tool-gemini .tool-name { color: #7aabf5; }

    :root[data-theme="dark"] .chat-bubble pre { background: rgba(197,165,90,0.06); }
    :root[data-theme="dark"] .chat-bubble code { background: rgba(197,165,90,0.1); border-color: rgba(197,165,90,0.15); }
    :root[data-theme="dark"] .chat-bubble.system .approval-args { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .artifact-item { border-bottom-color: rgba(255,255,255,0.06); }

    /* Working bar shimmer — use subtle white sweep that works on dark green background */
    :root[data-theme="dark"] #chat-working-bar::before {
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255,255,255,0.08) 35%,
        rgba(255,255,255,0.18) 50%,
        rgba(255,255,255,0.08) 65%,
        transparent 100%
      );
      background-size: 200% 100%;
    }
`;
