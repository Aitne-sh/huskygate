/** @module dashboard/scripts/chat — Client-side script for the Chat tab. */
import { ICON_CLAUDE, ICON_CODEX, ICON_GEMINI } from '../icons.js';

export function chatScript(): string {
  return `
    /* ── Chat ── */
    var chatCurrentTool = 'claude';
    var chatCurrentSessionId = null;
    var chatStreaming = false;
    var chatAbortController = null;
    var chatLastMessageId = 0;
    var chatPollInterval = null;
    var chatExpandedTools = { claude: true, codex: false, gemini: false };
    var chatAllSessions = [];
    var chatToolIcons = { claude: '${ICON_CLAUDE}', codex: '${ICON_CODEX}', gemini: '${ICON_GEMINI}' };

    function chatStartPoll() {
      chatStopPoll();
      chatPollInterval = setInterval(chatPollNewMessages, 3000);
    }

    function chatStopPoll() {
      if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
      }
    }

    async function chatPollNewMessages() {
      if (!chatCurrentSessionId) return;
      // Allow polling during working state (chatStreaming && chatWorking)
      // but not during SSE streaming
      if (chatStreaming && !chatWorking) return;
      // Capture session ID to detect staleness after async calls
      var pollSessionId = chatCurrentSessionId;
      var url = '/api/chat/' + pollSessionId + '/messages/new?after=' + chatLastMessageId;
      var d = await fetchApi(url, null, true);
      // Bail out if user switched sessions during the async fetch
      if (chatCurrentSessionId !== pollSessionId) return;
      // Session may have been deleted externally — verify and reset if gone
      if (!d) {
        var sessions = await fetchApi('/api/chat/sessions', null, true);
        if (sessions && !sessions.find(function(s) { return s.sessionId === pollSessionId; })) {
          chatStopPoll();
          resetChatPanel();
          chatAllSessions = sessions;
          renderChatTree();
        }
        return;
      }
      if (!d.messages || d.messages.length === 0) {
        // No new messages — check status to detect runner completion
        if (chatWorking) {
          var status = await chatCheckStatus();
          if (chatCurrentSessionId !== pollSessionId) return;
          if (status && !status.running && !status.pendingApproval) {
            chatExitWorkingState();
          }
        }
        return;
      }

      // Check if any non-system message arrived (assistant/user content)
      var hasContentMessage = false;
      for (var ci = 0; ci < d.messages.length; ci++) {
        if (d.messages[ci].role !== 'system') { hasContentMessage = true; break; }
      }

      // Only exit working state when actual content arrives, not for system-only messages
      // (e.g. tool_approval_result).
      if (chatWorking && hasContentMessage) chatExitWorkingState();

      var container = document.getElementById('chat-messages');
      var emptyEl = container.querySelector('.chat-messages-empty');
      if (emptyEl) emptyEl.remove();

      for (var i = 0; i < d.messages.length; i++) {
        var m = d.messages[i];
        if (m.id > chatLastMessageId) chatLastMessageId = m.id;
        // Skip tool_approval_result already rendered by chatApproveToolCall
        if (m.role === 'system') {
          var skipData = tryParseSystemMessage(m.content);
          if (skipData && skipData.type === 'tool_approval_result' && chatHandledApprovalIds[skipData.requestId]) {
            continue;
          }
        }
        if (m.role === 'system') {
          var sysData = tryParseSystemMessage(m.content);
          if (sysData && sysData.type === 'artifacts' && sysData.files && sysData.files.length > 0) {
            renderArtifactCard(container, chatCurrentSessionId, sysData.jobId, sysData.files, null);
            continue;
          }
        }
        var bubble = document.createElement('div');
        if (m.role === 'system') {
          var sysData2 = tryParseSystemMessage(m.content);
          if (sysData2) { renderSystemBubble(bubble, sysData2); }
          else { bubble.className = 'chat-bubble system'; bubble.textContent = m.content; }
        } else {
          bubble.className = 'chat-bubble ' + (m.role === 'user' ? 'user' : 'assistant');
          setBubbleContent(bubble, m.content, m.role === 'assistant');
        }
        container.appendChild(bubble);
      }
      container.scrollTop = container.scrollHeight;
    }

    function chatToggleTool(tool) {
      chatExpandedTools[tool] = !chatExpandedTools[tool];
      renderChatTree();
    }

    function resetChatPanel() {
      chatCurrentSessionId = null;
      var msgs = document.getElementById('chat-messages');
      msgs.innerHTML = '<div class="chat-messages-empty">Select a session to start chatting</div>';
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-send-btn').disabled = true;
      document.getElementById('chat-attach-btn').disabled = true;
      chatPendingFiles = [];
      chatRenderFilePreview();
      chatUpdateMainHeader();
    }

    function chatUpdateMainHeader() {
      var header = document.getElementById('chat-main-header');
      var label = document.getElementById('chat-main-session-label');
      var msgBox = document.getElementById('chat-messages');
      if (chatCurrentSessionId) {
        header.classList.add('visible');
        msgBox.style.borderRadius = '0';
        label.textContent = chatCurrentSessionId;
      } else {
        header.classList.remove('visible');
        msgBox.style.borderRadius = '';
        label.textContent = '';
      }
    }

    function chatDeleteCurrentSession() {
      if (chatCurrentSessionId) chatDeleteSession(chatCurrentSessionId);
    }

    async function refreshChatTree(autoSelectSessionId) {
      var sessions = await fetchApi('/api/chat/sessions');
      chatAllSessions = sessions || [];
      renderChatTree();
      if (autoSelectSessionId) {
        var match = chatAllSessions.find(function(s) { return s.sessionId === autoSelectSessionId; });
        if (match) {
          chatExpandedTools[match.tool] = true;
          renderChatTree();
          chatSelectSession(autoSelectSessionId);
        }
      }
    }

    function renderChatTree() {
      var tools = ['claude', 'codex', 'gemini'];
      var toolLabels = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
      var grouped = {};
      for (var t = 0; t < tools.length; t++) { grouped[tools[t]] = []; }
      for (var i = 0; i < chatAllSessions.length; i++) {
        var s = chatAllSessions[i];
        if (grouped[s.tool]) grouped[s.tool].push(s);
      }

      var html = '';
      for (var t = 0; t < tools.length; t++) {
        var tool = tools[t];
        var expanded = chatExpandedTools[tool];
        var list = grouped[tool];
        html += '<div class="chat-tree-tool-header" onclick="chatToggleTool(\\'' + tool + '\\')">'
          + '<span class="chat-tree-arrow' + (expanded ? ' open' : '') + '">&#9654;</span>'
          + '<img class="chat-tree-icon" src="' + chatToolIcons[tool] + '" alt="">'
          + '<span>' + toolLabels[tool] + '</span>'
          + '<span class="chat-tree-count">' + list.length + '</span>'
          + '</div>';
        html += '<div class="chat-tree-children' + (expanded ? ' open' : '') + '">';
        if (list.length === 0) {
          html += '<div style="padding:0.5rem 2.2rem;color:var(--text-dim);font-size:0.78rem;">No sessions</div>';
        }
        for (var j = 0; j < list.length; j++) {
          var sess = list[j];
          var isActive = chatCurrentSessionId === sess.sessionId;
          html += '<div class="chat-tree-session' + (isActive ? ' active' : '') + '" onclick="chatSelectSession(\\'' + escapeInlineJsArg(sess.sessionId) + '\\')">'
            + '<div class="chat-tree-session-info">'
            + '<div class="chat-tree-session-id">' + escapeHtml(sess.sessionId)
            + (sess.active ? ' <span class="badge badge-active" style="font-size:0.65rem;">Active</span>' : '')
            + '</div>'
            + '<div class="chat-tree-session-meta">' + escapeHtml(sess.mode) + ' &middot; ' + escapeHtml(sess.updatedAt) + '</div>'
            + '</div>'
            + '<button class="chat-tree-delete" onclick="event.stopPropagation();chatDeleteSession(\\'' + escapeInlineJsArg(sess.sessionId) + '\\')" title="Delete">&times;</button>'
            + '</div>';
        }
        html += '</div>';
      }

      document.getElementById('chat-tree').innerHTML = html;
    }

    function chatCreateSession() {
      var defaultRadio = document.getElementById('chat-tool-mode-default');
      if (defaultRadio) defaultRadio.checked = true;
      document.getElementById('chat-tool-modal').classList.add('open');
    }

    function chatCloseToolModal() {
      document.getElementById('chat-tool-modal').classList.remove('open');
    }

    async function chatCreateWithTool(tool) {
      chatCloseToolModal();
      if (!serverOnline && !(await checkServerOnline())) { toast('Server is not running. Please start the server from the Overview tab.', 'error'); return; }
      var modeRadio = document.querySelector('input[name="chat-tool-mode"]:checked');
      var mode = modeRadio ? modeRadio.value : '';
      var body = { tool: tool };
      if (mode) body.mode = mode;
      var d = await fetchApi('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!d || !d.sessionId) return;
      toast('Session created');
      chatExpandedTools[tool] = true;
      await refreshChatTree();
      chatSelectSession(d.sessionId);
    }

    async function chatDeleteSession(sessionId) {
      if (!serverOnline && !(await checkServerOnline())) { toast('Server is not running. Please start the server from the Overview tab.', 'error'); return; }
      if (!confirm('Delete session ' + sessionId + '?')) return;
      var d = await fetchApi('/api/sessions/' + sessionId, { method: 'DELETE' });
      if (d && d.success) {
        toast('Session deleted');
        if (chatCurrentSessionId === sessionId) {
          chatStopPoll();
          resetChatPanel();
        }
        await refreshChatTree();
      }
    }

    async function chatSelectSession(sessionId) {
      chatStopPoll();
      if (chatRetryAbort) chatRetryAbort.abort();
      if (chatStreaming) chatStop();
      chatWorking = false;
      document.getElementById('chat-working-bar').classList.remove('visible');
      chatRestoreInputState();
      chatCurrentSessionId = sessionId;
      // Track the tool of the selected session so rendering can adapt per-driver
      var matchedSession = chatAllSessions.find(function(s) { return s.sessionId === sessionId; });
      if (matchedSession) chatCurrentTool = matchedSession.tool || 'claude';
      chatLastMessageId = 0;
      chatHandledApprovalIds = {};
      renderChatTree();
      chatUpdateMainHeader();
      // Only enable input if server is online
      var canSend = serverOnline;
      document.getElementById('chat-input').disabled = !canSend;
      document.getElementById('chat-send-btn').disabled = !canSend;
      document.getElementById('chat-attach-btn').disabled = !canSend;
      if (!canSend) {
        document.getElementById('chat-input').placeholder = 'Start Server to enable chat';
      } else {
        document.getElementById('chat-input').placeholder = 'Type a message...';
      }
      await chatLoadMessages();
      // Check if session has an active runner → restore working state
      if (serverOnline) {
        var status = await chatCheckStatus();
        if (status && status.running) {
          chatEnterWorkingState();
        }
      }
      chatStartPoll();
    }

    async function chatLoadMessages(before) {
      if (!chatCurrentSessionId) return;
      var url = '/api/chat/' + chatCurrentSessionId + '/messages?limit=50';
      if (before) url += '&before=' + before;
      var d = await fetchApi(url);
      if (!d) return;

      var container = document.getElementById('chat-messages');
      if (!before) {
        container.innerHTML = '';
      }

      var msgs = d.messages || [];
      if (msgs.length === 0 && !before) {
        container.innerHTML = '<div class="chat-messages-empty">No messages yet. Send a prompt to start.</div>';
        return;
      }

      // Track latest message ID for polling
      if (!before && msgs.length > 0) {
        chatLastMessageId = msgs[0].id;
      }

      // Messages come newest-first, we need to prepend them in reverse order
      if (d.hasMore && msgs.length > 0) {
        var oldestId = msgs[msgs.length - 1].id;
        var loadMoreDiv = document.getElementById('chat-load-more-trigger');
        if (!loadMoreDiv) {
          loadMoreDiv = document.createElement('div');
          loadMoreDiv.id = 'chat-load-more-trigger';
          loadMoreDiv.className = 'chat-load-more';
          loadMoreDiv.innerHTML = '<button class="btn" onclick="chatLoadOlder()">Load older messages</button>';
          container.prepend(loadMoreDiv);
        }
        loadMoreDiv.setAttribute('data-before', oldestId);
      } else {
        var existing = document.getElementById('chat-load-more-trigger');
        if (existing) existing.remove();
      }

      // Render messages (reversed to get chronological order)
      var fragment = document.createDocumentFragment();
      for (var i = msgs.length - 1; i >= 0; i--) {
        var m = msgs[i];
        if (m.role === 'system') {
          var artCheck = tryParseSystemMessage(m.content);
          if (artCheck && artCheck.type === 'artifacts' && artCheck.files && artCheck.files.length > 0) {
            renderArtifactCard(fragment, chatCurrentSessionId, artCheck.jobId, artCheck.files, null);
            continue;
          }
        }
        var bubble = document.createElement('div');
        if (m.role === 'system') {
          var sysData = tryParseSystemMessage(m.content);
          if (sysData) { renderSystemBubble(bubble, sysData); }
          else { bubble.className = 'chat-bubble system'; bubble.textContent = m.content; }
        } else {
          bubble.className = 'chat-bubble ' + (m.role === 'user' ? 'user' : 'assistant');
          setBubbleContent(bubble, m.content, m.role === 'assistant');
        }
        fragment.appendChild(bubble);
      }

      if (before) {
        var loadMoreEl = document.getElementById('chat-load-more-trigger');
        if (loadMoreEl) {
          loadMoreEl.after(fragment);
        } else {
          container.prepend(fragment);
        }
      } else {
        container.appendChild(fragment);
        container.scrollTop = container.scrollHeight;
      }
    }

    function chatLoadOlder() {
      var trigger = document.getElementById('chat-load-more-trigger');
      if (!trigger) return;
      var before = trigger.getAttribute('data-before');
      if (before) chatLoadMessages(parseInt(before, 10));
    }

    var chatPendingFiles = [];

    function chatAttachClick() {
      document.getElementById('chat-file-input').click();
    }

    function chatFilesSelected(input) {
      for (var i = 0; i < input.files.length; i++) {
        chatPendingFiles.push(input.files[i]);
      }
      input.value = '';
      chatRenderFilePreview();
    }

    function chatRenderFilePreview() {
      var container = document.getElementById('chat-file-preview');
      container.innerHTML = '';
      for (var i = 0; i < chatPendingFiles.length; i++) {
        var chip = document.createElement('span');
        chip.className = 'chat-file-chip';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'chat-file-chip-name';
        nameSpan.textContent = chatPendingFiles[i].name;
        nameSpan.title = chatPendingFiles[i].name;
        chip.appendChild(nameSpan);
        var removeBtn = document.createElement('span');
        removeBtn.className = 'chat-file-chip-remove';
        removeBtn.textContent = '\\u00d7';
        removeBtn.setAttribute('data-idx', String(i));
        removeBtn.onclick = function() { chatRemoveFile(parseInt(this.getAttribute('data-idx'), 10)); };
        chip.appendChild(removeBtn);
        container.appendChild(chip);
      }
    }

    function chatRemoveFile(index) {
      chatPendingFiles.splice(index, 1);
      chatRenderFilePreview();
    }

    async function chatUploadFiles() {
      var results = [];
      for (var i = 0; i < chatPendingFiles.length; i++) {
        var file = chatPendingFiles[i];
        var buf = await file.arrayBuffer();
        var response = await fetch('/api/chat/' + chatCurrentSessionId + '/upload', {
          method: 'POST',
          headers: {
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Mime': file.type || 'application/octet-stream',
            'X-CSRF-Protection': '1'
          },
          body: buf
        });
        if (!response.ok) {
          var err = await response.json().catch(function() { return { error: 'Upload failed' }; });
          throw new Error(err.error || 'Upload failed for ' + file.name);
        }
        var downloaded = await response.json();
        results.push(downloaded);
      }
      return results;
    }

    function chatSend() {
      var input = document.getElementById('chat-input');
      var prompt = input.value.trim();
      if ((!prompt && chatPendingFiles.length === 0) || !chatCurrentSessionId || chatStreaming) return;
      input.value = '';
      input.style.height = 'auto';
      chatDoSend(prompt || '(files attached)');
    }

    async function chatDoSend(prompt) {
      if (!serverOnline && !(await checkServerOnline())) {
        toast('Server is not running. Please start the server from the Overview tab.', 'error');
        return;
      }

      // Upload pending files first
      var uploadedFiles = null;
      if (chatPendingFiles.length > 0) {
        try {
          uploadedFiles = await chatUploadFiles();
          chatPendingFiles = [];
          chatRenderFilePreview();
        } catch (uploadErr) {
          toast('File upload failed: ' + (uploadErr.message || 'unknown'), 'error');
          return;
        }
      }

      // Capture session and tool at send time — if user switches sessions while
      // we're streaming, the cleanup code must NOT touch UI for the new session.
      var sendSessionId = chatCurrentSessionId;
      var sendTool = chatCurrentTool;

      chatStopPoll();
      // Clean up any lingering working state from a previous approval
      chatWorking = false;
      document.getElementById('chat-working-bar').classList.remove('visible');
      if (chatRetryAbort) chatRetryAbort.abort();
      var container = document.getElementById('chat-messages');
      // Remove empty placeholder
      var emptyEl = container.querySelector('.chat-messages-empty');
      if (emptyEl) emptyEl.remove();

      // Add user bubble (show file names if attached)
      var userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble user';
      var bubbleText = prompt;
      if (uploadedFiles && uploadedFiles.length > 0) {
        var fileNames = uploadedFiles.map(function(f) { return f.originalName; }).join(', ');
        bubbleText = prompt + '\\n[Files: ' + fileNames + ']';
      }
      userBubble.textContent = bubbleText;
      container.appendChild(userBubble);
      container.scrollTop = container.scrollHeight;

      // Disable input
      chatStreaming = true;
      document.getElementById('chat-input').disabled = true;
      document.getElementById('chat-attach-btn').disabled = true;
      var sendBtn = document.getElementById('chat-send-btn');
      sendBtn.textContent = 'Stop';
      sendBtn.onclick = chatStop;
      sendBtn.disabled = false;
      sendBtn.classList.add('btn-stop');

      // Show working status bar (outside chat history) and create a hidden
      // streaming bubble that only appears once actual text arrives.
      chatWorking = true;
      document.getElementById('chat-working-bar').classList.add('visible');
      var barStSpan = document.getElementById('chat-working-bar').querySelector('.working-streaming-text');
      if (barStSpan) barStSpan.textContent = '';
      var assistantBubble = document.createElement('div');
      assistantBubble.className = 'chat-bubble assistant';
      assistantBubble.id = 'chat-streaming-bubble';
      assistantBubble.style.display = 'none';
      container.appendChild(assistantBubble);

      chatAbortController = new AbortController();
      var streamingText = '';
      var streamingLastToolOffset = -1;
      var streamingSawTool = false;
      var streamingToolBubbles = [];
      var lastErrBubble = null;
      var errLineCount = 0;
      var errBaseText = '';
      var MAX_ERR_LINES = 15;

      try {
        var sendBody = { prompt: prompt };
        if (uploadedFiles && uploadedFiles.length > 0) sendBody.files = uploadedFiles;
        await fetchSSE(
          '/api/chat/' + chatCurrentSessionId + '/send',
          sendBody,
          function(event) {
            var c = event.content || '';
            if (event.type !== 'error') { lastErrBubble = null; errLineCount = 0; errBaseText = ''; }
            if (event.type === 'text') {
              streamingText += c;
              // Show latest line in the working status bar (thinking bar)
              if (barStSpan) barStSpan.textContent = streamingText.substring(streamingText.lastIndexOf('\\n') + 1);
            } else if (event.type === 'tool_use') {
              streamingLastToolOffset = streamingText.length;
              streamingSawTool = true;
              var toolBubble = document.createElement('div');
              toolBubble.className = 'chat-bubble tool-use';
              toolBubble.textContent = c;
              container.insertBefore(toolBubble, assistantBubble);
              streamingToolBubbles.push(toolBubble);
              container.scrollTop = container.scrollHeight;
            } else if (event.type === 'tool_result') {
              streamingLastToolOffset = streamingText.length;
              streamingSawTool = true;
              var resultBubble = document.createElement('div');
              resultBubble.className = 'chat-bubble tool-use';
              resultBubble.textContent = c.substring(0, 400);
              resultBubble.style.opacity = '0.7';
              container.insertBefore(resultBubble, assistantBubble);
              streamingToolBubbles.push(resultBubble);
              container.scrollTop = container.scrollHeight;
            } else if (event.type === 'tool_approval') {
              // Clear the streaming bubble — its content is pre-tool text
              // and [MCP_TOOL_REQUEST] block, not useful to the user.
              streamingText = '';
              assistantBubble.textContent = '';
              assistantBubble.style.display = 'none';
              if (barStSpan) barStSpan.textContent = '';
              var approvalData = tryParseSystemMessage(c);
              if (approvalData) {
                var approvalBubble = document.createElement('div');
                renderSystemBubble(approvalBubble, approvalData);
                container.insertBefore(approvalBubble, assistantBubble);
                container.scrollTop = container.scrollHeight;
              }
            } else if (event.type === 'error') {
              errLineCount++;
              if (!lastErrBubble) {
                lastErrBubble = document.createElement('div');
                lastErrBubble.className = 'chat-bubble error';
                errBaseText = c;
                lastErrBubble.textContent = c;
                container.insertBefore(lastErrBubble, assistantBubble);
              } else if (errLineCount <= MAX_ERR_LINES) {
                errBaseText += '\\n' + c;
                lastErrBubble.textContent = errBaseText;
              } else {
                lastErrBubble.textContent = errBaseText + '\\n… (' + (errLineCount - MAX_ERR_LINES) + ' more lines omitted)';
              }
              container.scrollTop = container.scrollHeight;
            } else if (event.type === 'artifacts') {
              try {
                var artData = JSON.parse(c);
                if (artData.files && artData.files.length > 0) {
                  renderArtifactCard(container, chatCurrentSessionId, artData.jobId, artData.files, assistantBubble);
                }
              } catch (e2) { /* ignore parse error */ }
            }
          },
          chatAbortController.signal
        );
      } catch (e) {
        if (e.name !== 'AbortError') {
          toast('Chat error: ' + (e.message || 'unknown'), 'error');
        }
      }

      // If user switched sessions while SSE was streaming, do NOT touch
      // UI state — chatSelectSession owns it now. Only clean up the
      // streaming bubble (which belongs to the old session's DOM anyway).
      var sessionSwitched = (chatCurrentSessionId !== sendSessionId);

      if (!sessionSwitched) {
        // Hide working status bar
        chatWorking = false;
        document.getElementById('chat-working-bar').classList.remove('visible');
      }

      // Remove intermediate tool-use bubbles that were shown during streaming.
      for (var ti = 0; ti < streamingToolBubbles.length; ti++) {
        streamingToolBubbles[ti].remove();
      }

      // Clean up empty streaming bubble or render markdown.
      // For Codex and Claude sessions, inject process separator so
      // setBubbleContent renders the collapsible process narration.
      // Primary: use tool event offset.  Fallback: text heuristic (Codex + Claude).
      if (!streamingText) {
        assistantBubble.remove();
      } else {
        assistantBubble.style.display = '';
        var finalText = streamingText;
        if (sendTool === 'codex' || sendTool === 'claude') {
          var ansMarker = '<!-- answer -->';
          var explicitIdx = streamingText.indexOf(ansMarker);
          if (explicitIdx >= 0) {
            // Explicit marker from Codex — strip it and split.
            var proc = streamingText.substring(0, explicitIdx).trim();
            var ans = streamingText.substring(explicitIdx + ansMarker.length).trim();
            if (proc && ans) {
              finalText = proc + '\\n\\n<!-- process-end -->\\n\\n' + ans;
            } else {
              // One side empty — just strip the marker.
              finalText = streamingText.replaceAll(ansMarker, '').trim();
            }
          } else {
            // Tool-event offset (both Codex and Claude).
            // Text heuristic fallback (Codex and Claude).
            var splitOffset = -1;
            if (streamingSawTool && streamingLastToolOffset >= 0) {
              splitOffset = streamingLastToolOffset;
            } else {
              splitOffset = findProcessBoundary(streamingText);
            }
            if (splitOffset >= 0) {
              var proc2 = streamingText.substring(0, splitOffset).trim();
              var ans2 = streamingText.substring(splitOffset).trim();
              if (proc2 && ans2) {
                finalText = proc2 + '\\n\\n<!-- process-end -->\\n\\n' + ans2;
              }
            }
          }
        }
        setBubbleContent(assistantBubble, finalText, true);
      }
      assistantBubble.removeAttribute('id');

      // If session switched, abort controller is stale — just clear it and bail.
      if (sessionSwitched) {
        chatAbortController = null;
        return;
      }

      // If chatStreamRetryJob took over (tool approval → approve), it owns the
      // UI state (working status bar, streaming flag, Stop button). Do NOT restore
      // input or start polling — the retry stream will handle that on completion.
      if (chatRetryAbort) {
        chatAbortController = null;
        return;
      }

      // Re-enable input
      chatStreaming = false;
      chatAbortController = null;
      chatRestoreInputState();
      document.getElementById('chat-input').focus();

      // Sync chatLastMessageId with server so polling skips messages we already rendered
      var latest = await fetchApi('/api/chat/' + chatCurrentSessionId + '/messages?limit=1');
      if (latest && latest.messages && latest.messages.length > 0) {
        chatLastMessageId = latest.messages[0].id;
      }
      chatStartPoll();
    }

    function chatStop() {
      if (chatAbortController) {
        chatAbortController.abort();
      }
    }

    async function fetchSSE(url, body, onEvent, signal) {
      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify(body),
        signal: signal
      });

      if (!response.ok) {
        var err = await response.json().catch(function() { return { error: 'Request failed' }; });
        throw new Error(err.error || 'Request failed');
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });

        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.startsWith('data: ')) {
            try {
              var event = JSON.parse(line.substring(6));
              if (event.type !== 'done') {
                onEvent(event);
              }
            } catch (e) {
              // skip invalid JSON
            }
          }
        }
      }
    }

    async function fetchSSEGet(url, onEvent, signal) {
      var response = await fetch(url, { method: 'GET', signal: signal });

      if (!response.ok) {
        var err = await response.json().catch(function() { return { error: 'Request failed' }; });
        throw new Error(err.error || 'Request failed');
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });

        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.startsWith('data: ')) {
            try {
              var event = JSON.parse(line.substring(6));
              if (event.type !== 'done') {
                onEvent(event);
              }
            } catch (e) {
              // skip invalid JSON
            }
          }
        }
      }
    }

    // Chat input: Enter to send, Shift+Enter for newline
    // Skip when IME composition is active (e.g. Japanese/Chinese input)
    var chatInputEl = document.getElementById('chat-input');
    chatInputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        chatSend();
      }
    });

    // Auto-resize textarea as user types
    function autoResizeInput() {
      chatInputEl.style.height = 'auto';
      chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 160) + 'px';
      chatInputEl.style.overflowY = chatInputEl.scrollHeight > 160 ? 'auto' : 'hidden';
    }
    chatInputEl.addEventListener('input', autoResizeInput);

    // Drag-and-drop file attachment
    var chatMainEl = document.querySelector('.chat-main');
    var chatDropOverlay = document.getElementById('chat-drop-overlay');
    var chatDragCounter = 0;
    chatMainEl.addEventListener('dragenter', function(e) {
      e.preventDefault();
      chatDragCounter++;
      if (!chatCurrentSessionId || chatStreaming) return;
      chatDropOverlay.classList.add('visible');
    });
    chatMainEl.addEventListener('dragleave', function(e) {
      e.preventDefault();
      chatDragCounter--;
      if (chatDragCounter <= 0) {
        chatDragCounter = 0;
        chatDropOverlay.classList.remove('visible');
      }
    });
    chatMainEl.addEventListener('dragover', function(e) {
      e.preventDefault();
    });
    chatMainEl.addEventListener('drop', function(e) {
      e.preventDefault();
      chatDragCounter = 0;
      chatDropOverlay.classList.remove('visible');
      if (!chatCurrentSessionId || chatStreaming) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        for (var i = 0; i < files.length; i++) {
          chatPendingFiles.push(files[i]);
        }
        chatRenderFilePreview();
      }
    });
`;
}
