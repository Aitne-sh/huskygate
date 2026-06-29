/** @module dashboard/scripts/helpers — Shared client-side utilities (escapeHtml, fetchApi, toast, etc.). */
export const helpersScript = `
    /* ── Helpers ── */
    function escapeHtml(s) {
      if (typeof s !== 'string') return '';
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Escape untrusted text for inline JS handler arguments:
    // onclick="fn('...')"
    function escapeInlineJsArg(s) {
      if (typeof s !== 'string') return '';
      return s
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/"/g, '\\\\x22')
        .replace(/\\r/g, '\\\\r')
        .replace(/\\n/g, '\\\\n')
        .replace(/\\u2028/g, '\\\\u2028')
        .replace(/\\u2029/g, '\\\\u2029')
        .replace(/</g, '\\\\x3C')
        .replace(/>/g, '\\\\x3E')
        .replace(/&/g, '\\\\x26');
    }

    function sanitizeHref(url) {
      // Only allow http(s) and mailto links — block javascript:, data:, vbscript:, etc.
      if (/^https?:\\/\\//i.test(url) || /^mailto:/i.test(url)) return url;
      return '';
    }

    function renderInline(escaped) {
      escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      escaped = escaped.replace(/~~(.+?)~~/g, '<s>$1</s>');
      escaped = escaped.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
      escaped = escaped.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(m, text, href) {
        var safe = sanitizeHref(href);
        return safe ? '<a href="' + safe + '" target="_blank" rel="noopener">' + text + '</a>' : text;
      });
      escaped = escaped.replace(/(^|[\\s>])(https?:\\/\\/[^\\s<&)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
      return escaped;
    }

    function getListIndent(line) {
      var m = line.match(/^(\\s*)/);
      return m ? m[1].length : 0;
    }

    function isListLine(trimmed) {
      return /^[-*+]\\s/.test(trimmed) || /^\\d+[.)]\\s/.test(trimmed);
    }

    function renderList(lines, startIdx) {
      var baseIndent = getListIndent(lines[startIdx]);
      var first = lines[startIdx].trim();
      var isOl = /^\\d+[.)]\\s/.test(first);
      var tag = isOl ? 'ol' : 'ul';
      var html = '<' + tag + '>';
      var i = startIdx;
      while (i < lines.length) {
        var rawLine = lines[i];
        var indent = getListIndent(rawLine);
        var cur = rawLine.trim();
        if (!cur) {
          var peek = i + 1;
          while (peek < lines.length && !lines[peek].trim()) peek++;
          if (peek < lines.length) {
            var peekIndent = getListIndent(lines[peek]);
            if (peekIndent >= baseIndent && isListLine(lines[peek].trim())) {
              i = peek; continue;
            }
          }
          break;
        }
        if (indent < baseIndent) break;
        if (indent > baseIndent) {
          if (isListLine(cur)) {
            var sub = renderList(lines, i);
            html = html.replace(/<\\/li>$/, '') + sub.html + '</li>';
            i = sub.endIdx;
          } else {
            html = html.replace(/<\\/li>$/, '<br>' + renderInline(escapeHtml(cur)) + '</li>');
            i++;
          }
          continue;
        }
        if (!isListLine(cur)) break;
        if (isOl && /^[-*+]\\s/.test(cur)) {
          var nestedUl = '<ul>';
          while (i < lines.length) {
            var nlRaw = lines[i];
            var nlIndent = getListIndent(nlRaw);
            var nlCur = nlRaw ? nlRaw.trim() : '';
            if (!nlCur || nlIndent !== baseIndent || !/^[-*+]\\s/.test(nlCur)) break;
            nestedUl += '<li>' + renderInline(escapeHtml(nlCur.replace(/^[-*+]\\s+/, ''))) + '</li>';
            i++;
          }
          nestedUl += '</ul>';
          html = html.replace(/<\\/li>$/, '') + nestedUl + '</li>';
          continue;
        }
        var liText = isOl ? cur.replace(/^\\d+[.)]\\s+/, '') : cur.replace(/^[-*+]\\s+/, '');
        var taskMatch = liText.match(/^\\[([ xX])\\]\\s?(.*)/);
        if (taskMatch) {
          var checked = taskMatch[1] !== ' ';
          html += '<li class="task-item"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' + renderInline(escapeHtml(taskMatch[2])) + '</li>';
        } else {
          html += '<li>' + renderInline(escapeHtml(liText)) + '</li>';
        }
        i++;
      }
      html += '</' + tag + '>';
      return { html: html, endIdx: i };
    }

    function renderMdTable(tl) {
      if (tl.length < 2) return '<p>' + escapeHtml(tl.join('\\n')) + '</p>';
      function parseCells(ln) {
        return ln.replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function(c) { return c.trim(); });
      }
      var headers = parseCells(tl[0]);
      var out = '<table><thead><tr>';
      for (var h = 0; h < headers.length; h++) {
        out += '<th>' + renderInline(escapeHtml(headers[h])) + '</th>';
      }
      out += '</tr></thead><tbody>';
      for (var r = 2; r < tl.length; r++) {
        var cells = parseCells(tl[r]);
        out += '<tr>';
        for (var c = 0; c < cells.length; c++) {
          out += '<td>' + renderInline(escapeHtml(cells[c] || '')) + '</td>';
        }
        out += '</tr>';
      }
      out += '</tbody></table>';
      return out;
    }

    function renderMarkdown(text) {
      if (!text) return '';
      var fence = '\x60\x60\x60';
      var fenceRe = new RegExp('(' + fence + '[\\\\s\\\\S]*?' + fence + ')', 'g');
      var parts = text.split(fenceRe);
      var result = '';
      for (var pi = 0; pi < parts.length; pi++) {
        var part = parts[pi];
        if (part.indexOf(fence) === 0) {
          var inner = part.slice(3, -3);
          var nl = inner.indexOf('\\n');
          var lang = '';
          var code = inner;
          if (nl >= 0) {
            lang = inner.slice(0, nl).trim();
            code = inner.slice(nl + 1);
          }
          var langAttr = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
          var langLabel = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
          result += '<pre>' + langLabel + '<code' + langAttr + '>' + escapeHtml(code).replace(/\\n$/, '') + '</code></pre>';
          continue;
        }
        var lines = part.split('\\n');
        var idx = 0;
        while (idx < lines.length) {
          var trimmed = lines[idx].trim();
          if (!trimmed) { idx++; continue; }

          var hm = trimmed.match(/^(#{1,6})\\s+(.*)/);
          if (hm) {
            var lvl = hm[1].length;
            result += '<h' + lvl + '>' + renderInline(escapeHtml(hm[2])) + '</h' + lvl + '>';
            idx++; continue;
          }

          if (/^[-*_]{3,}\\s*$/.test(trimmed) && !/^[-*+]\\s/.test(trimmed)) {
            result += '<hr>'; idx++; continue;
          }

          if (trimmed.indexOf('|') !== -1 && idx + 1 < lines.length && lines[idx + 1]) {
            var sep = lines[idx + 1].trim();
            if (sep.indexOf('|') !== -1 && /^\\|?[\\s:]*-+[\\s:]*/.test(sep)) {
              var tl = [];
              while (idx < lines.length && lines[idx].trim().indexOf('|') !== -1) {
                tl.push(lines[idx].trim()); idx++;
              }
              result += renderMdTable(tl); continue;
            }
          }

          if (/^>/.test(trimmed)) {
            var bqLines = [];
            while (idx < lines.length && /^>/.test(lines[idx].trim())) {
              bqLines.push(lines[idx].trim().replace(/^>\\s?/, ''));
              idx++;
            }
            result += '<blockquote>' + renderMarkdown(bqLines.join('\\n')) + '</blockquote>';
            continue;
          }

          if (isListLine(trimmed)) {
            var listResult = renderList(lines, idx);
            result += listResult.html;
            idx = listResult.endIdx;
            continue;
          }

          var pl = [];
          while (idx < lines.length) {
            var pt = lines[idx].trim();
            if (!pt) break;
            if (/^#{1,6}\\s/.test(pt)) break;
            if (/^[-*_]{3,}\\s*$/.test(pt) && !/^[-*+]\\s/.test(pt)) break;
            if (isListLine(pt)) break;
            if (/^>/.test(pt)) break;
            if (pt.indexOf('|') !== -1 && idx + 1 < lines.length && lines[idx + 1] && lines[idx + 1].trim().indexOf('|') !== -1 && /^\\|?[\\s:]*-+/.test(lines[idx + 1].trim())) break;
            pl.push(pt); idx++;
          }
          if (pl.length) {
            var ph = pl.map(function(l) { return renderInline(escapeHtml(l)); }).join('<br>');
            result += '<p>' + ph + '</p>';
          }
        }
      }
      return result;
    }

    /**
     * Heuristic: find the char offset where process narration (Codex / Claude)
     * ends and the structured answer begins.  Returns -1 if no boundary found.
     */
    function findProcessBoundary(text) {
      // Heuristic patterns (require 80-char preamble).
      // NOTE: explicit <!-- answer --> marker is handled by callers before
      // this function is reached.
      var patterns = [
        /\\n(?:\\*\\*)?What you asked(?:\\*\\*)?/i,
        /\\n(?:\\*\\*)?(?:Conclusion|Summary|Answer)[:：\\s]/i,
        /\\n#{1,3}\\s/,
        /\\n[\\x60\\s]*★\\s*Insight/
      ];
      var earliest = -1;
      for (var i = 0; i < patterns.length; i++) {
        var match = patterns[i].exec(text);
        if (match !== null && match.index >= 80) {
          if (earliest < 0 || match.index < earliest) {
            earliest = match.index;
          }
        }
      }
      return earliest;
    }

    /**
     * Wrap process narration (Codex / Claude pre-tool text) in a collapsible
     * section.  Reuses .thinking-preamble CSS classes with a "Process" label.
     * Long narrations (>200 chars visible) start collapsed.
     */
    function wrapProcessNarration(html) {
      if (!html) return '';
      var visibleText = html.replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').replace(/\\s+/g, ' ').trim();
      if (!visibleText) return '';
      var isLong = visibleText.length > 200;
      var cls = 'thinking-preamble' + (isLong ? ' collapsed' : '');
      var toggle = isLong ? '<button class="thinking-toggle" onclick="toggleThinkingPreamble(this)">Show more</button>' : '';
      return '<div class="' + cls + '">'
        + '<div class="thinking-preamble-label">Process</div>'
        + '<div class="thinking-preamble-content">' + html + '</div>'
        + toggle
        + '</div>'
        + '<hr class="thinking-divider">';
    }

    function toggleThinkingPreamble(btn) {
      var wrap = btn.parentElement;
      if (wrap.classList.contains('collapsed')) {
        wrap.classList.remove('collapsed');
        btn.textContent = 'Show less';
      } else {
        wrap.classList.add('collapsed');
        btn.textContent = 'Show more';
      }
    }

    function stripMcpToolRequest(text) {
      return text
        .replace(/\\[MCP_TOOL_REQUEST\\][\\s\\S]*?\\[\\/MCP_TOOL_REQUEST\\]\\s*/gi, '')
        // Strip hookSpecificOutput JSON blocks (e.g. { "hookSpecificOutput": { ... } })
        .replace(/\\{\\s*"hookSpecificOutput"\\s*:[\\s\\S]*?\\}\\s*\\}\\s*/g, '')
        // Strip Sources section at end of message
        .replace(/\\n*Sources:\\s*\\n(?:[\\t ]*[-*]\\s*(?:\\[.*?\\]\\(.*?\\)|[^\\n]+)\\n?)+\\s*$/gi, '')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
    }

    function setBubbleContent(bubble, text, isMarkdown) {
      var cleaned = stripMcpToolRequest(text);
      if (!cleaned) { bubble.textContent = ''; return; }
      if (isMarkdown) {
        bubble.style.whiteSpace = 'normal';
        // Detect process separator (Codex / Claude).
        // <!-- process-end -->: server-injected (DB-persisted messages).
        // <!-- answer -->: Codex-emitted (live streaming before server converts).
        var sepMarker = '<!-- process-end -->';
        var ansMarker = '<!-- answer -->';
        var sepIdx = cleaned.indexOf(sepMarker);
        var activeMarker = sepMarker;
        if (sepIdx < 0) {
          // Use lastIndexOf — Gemini may emit multiple <!-- answer --> markers
          // when tool calls are retried; the last one precedes the real answer.
          sepIdx = cleaned.lastIndexOf(ansMarker);
          activeMarker = ansMarker;
        }
        if (sepIdx >= 0) {
          var proc = cleaned.substring(0, sepIdx);
          var ans = cleaned.substring(sepIdx + activeMarker.length).trim();
          // Strip duplicate <!-- answer --> markers accumulated by Gemini tool
          // retries.  <!-- process-end --> is server-controlled (always single)
          // so cleanup is only needed for the ansMarker path.
          if (activeMarker === ansMarker) {
            proc = proc.replaceAll(ansMarker, '').replace(/\\n{3,}/g, '\\n\\n');
          }
          proc = proc.trim();
          if (proc && ans) {
            bubble.innerHTML = wrapProcessNarration(renderMarkdown(proc)) + renderMarkdown(ans);
          } else {
            bubble.innerHTML = renderMarkdown(cleaned.replaceAll(activeMarker, '').replace(/\\n{3,}/g, '\\n\\n').trim());
          }
        } else {
          bubble.innerHTML = renderMarkdown(cleaned);
        }
      } else {
        bubble.textContent = cleaned;
      }
    }

    function tryParseSystemMessage(content) {
      try { return JSON.parse(content); } catch { return null; }
    }

    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + 'B';
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
      return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    }

    function artifactIcon(mimeType) {
      if (!mimeType) return '\u{1F4C4}';
      if (mimeType.startsWith('image/')) return '\u{1F5BC}';
      if (mimeType.includes('pdf')) return '\u{1F4D1}';
      if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '\u{1F4CA}';
      if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '\u{1F4CA}';
      if (mimeType.includes('word') || mimeType.includes('document')) return '\u{1F4DD}';
      if (mimeType.startsWith('video/')) return '\u{1F3AC}';
      if (mimeType.startsWith('audio/')) return '\u{1F3B5}';
      return '\u{1F4C4}';
    }

    function isPreviewableArtifactImageMimeType(mimeType) {
      if (!mimeType) return false;
      return [
        'image/bmp',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/x-icon'
      ].includes(String(mimeType).toLowerCase());
    }

    /** Render an artifact card showing output files from a job. */
    function renderArtifactCard(container, sessionId, jobId, files, insertBefore) {
      var card = document.createElement('div');
      card.className = 'chat-bubble artifacts';
      var title = document.createElement('div');
      title.className = 'artifacts-title';
      title.textContent = 'Output Files';
      card.appendChild(title);

      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var url = '/api/chat/' + sessionId + '/artifacts/' + jobId + '/' + encodeURIComponent(f.filename);

        var item = document.createElement('div');
        item.className = 'artifact-item';

        // Image preview
        if (isPreviewableArtifactImageMimeType(f.mimeType)) {
          var imgWrap = document.createElement('div');
          imgWrap.style.width = '100%';
          var img = document.createElement('img');
          img.className = 'artifact-img-preview';
          img.src = url;
          img.alt = f.filename;
          img.title = f.filename;
          img.onclick = (function(u) { return function() {
            var opened = window.open(u, '_blank', 'noopener,noreferrer');
            if (opened) opened.opener = null;
          }; })(url);
          imgWrap.appendChild(img);

          var metaRow = document.createElement('div');
          metaRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:4px;';
          var nameSpan = document.createElement('span');
          nameSpan.className = 'artifact-name';
          nameSpan.textContent = f.filename;
          var sizeSpan = document.createElement('span');
          sizeSpan.className = 'artifact-meta';
          sizeSpan.textContent = formatFileSize(f.size);
          var dlLink = document.createElement('a');
          dlLink.className = 'artifact-dl';
          dlLink.href = url;
          dlLink.download = f.filename;
          dlLink.textContent = 'Download';
          metaRow.appendChild(nameSpan);
          metaRow.appendChild(sizeSpan);
          metaRow.appendChild(dlLink);
          imgWrap.appendChild(metaRow);

          item.style.flexDirection = 'column';
          item.style.alignItems = 'stretch';
          item.appendChild(imgWrap);
        } else {
          // Non-image file: icon + name + size + download
          var icon = document.createElement('span');
          icon.className = 'artifact-icon';
          icon.textContent = artifactIcon(f.mimeType);
          item.appendChild(icon);

          var info = document.createElement('div');
          info.className = 'artifact-info';
          var name = document.createElement('div');
          name.className = 'artifact-name';
          name.textContent = f.filename;
          var meta = document.createElement('div');
          meta.className = 'artifact-meta';
          meta.textContent = formatFileSize(f.size);
          info.appendChild(name);
          info.appendChild(meta);
          item.appendChild(info);

          var dl = document.createElement('a');
          dl.className = 'artifact-dl';
          dl.href = url;
          dl.download = f.filename;
          dl.textContent = 'Download';
          item.appendChild(dl);
        }

        card.appendChild(item);
      }

      if (insertBefore) {
        container.insertBefore(card, insertBefore);
      } else {
        container.appendChild(card);
      }
      container.scrollTop = container.scrollHeight;
    }

    function renderSystemBubble(bubble, data) {
      bubble.className = 'chat-bubble system';
      bubble.style.whiteSpace = 'normal';
      if (data.type === 'tool_approval') {
        var toolName = data.requestedToolName || 'unknown_tool';
        var argsText = '';
        if (data.requestedToolArgs != null) {
          try { argsText = typeof data.requestedToolArgs === 'string' ? data.requestedToolArgs : JSON.stringify(data.requestedToolArgs, null, 2); }
          catch { argsText = String(data.requestedToolArgs); }
        }
        var html = '<div><strong>' + escapeHtml(data.tool || '') + '</strong> needs permission</div>'
          + '<div>Tool: <span class="approval-tool-name">' + escapeHtml(toolName) + '</span></div>';
        if (argsText) {
          html += '<div class="approval-args">' + escapeHtml(argsText.substring(0, 1400)) + '</div>';
        }
        var expired = Date.now() > (data.expiresAt || 0);
        if (expired) {
          html += '<div class="approval-expired">Expired</div>';
        } else {
          html += '<div class="approval-actions">'
            + '<button class="btn-approve" onclick="chatApproveToolCall(\\'approve\\',\\'' + escapeInlineJsArg(data.requestId) + '\\')">Approve</button>'
            + '<button class="btn-deny" onclick="chatApproveToolCall(\\'deny\\',\\'' + escapeInlineJsArg(data.requestId) + '\\')">Deny</button>'
            + '</div>';
        }
        bubble.innerHTML = html;
      } else if (data.type === 'tool_approval_result') {
        bubble.className = 'chat-bubble system-result';
        var badge = data.decision === 'approved' ? 'approved' : 'denied';
        var label = data.decision === 'approved' ? 'Approved' : 'Denied';
        bubble.innerHTML = '<span class="approval-result-badge ' + badge + '">' + label + '</span>';
      } else {
        bubble.textContent = '[system] ' + JSON.stringify(data);
      }
    }

    var chatWorking = false;
    var chatRetryAbort = null;
    var chatHandledApprovalIds = {};

    async function chatApproveToolCall(decision, requestId) {
      if (!chatCurrentSessionId) return;
      // Disable buttons immediately
      var buttons = document.querySelectorAll('.approval-actions button');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
      try {
        var d = await fetchApi('/api/chat/' + chatCurrentSessionId + '/tool-approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: decision, requestId: requestId })
        });
        if (d && d.success) {
          toast('Tool call ' + d.decision);
          // Mark this requestId as handled so poll skips the duplicate
          chatHandledApprovalIds[requestId] = true;
          // Remove buttons from the approval card (no longer actionable)
          var actions = document.querySelectorAll('.approval-actions');
          for (var j = 0; j < actions.length; j++) {
            actions[j].innerHTML = '';
          }
          // Insert a user-side result badge bubble
          var container = document.getElementById('chat-messages');
          var resultBubble = document.createElement('div');
          resultBubble.className = 'chat-bubble system-result';
          var badge = decision === 'approve' ? 'approved' : 'denied';
          var label = decision === 'approve' ? 'Approved' : 'Denied';
          resultBubble.innerHTML = '<span class="approval-result-badge ' + badge + '">' + label + '</span>';
          container.appendChild(resultBubble);
          if (decision === 'approve' && d.jobId) {
            // Stream retry job output via working status bar
            chatStreamRetryJob(d.jobId);
          } else if (decision === 'approve') {
            // No jobId (Slack session) — just poll for result
            chatEnterWorkingState();
            chatStartPoll();
          } else {
            chatStartPoll();
          }
          container.scrollTop = container.scrollHeight;
        }
      } catch (e) {
        toast('Approval failed: ' + (e.message || 'unknown'), 'error');
        for (var k = 0; k < buttons.length; k++) buttons[k].disabled = false;
      }
    }

    function chatEnterWorkingState() {
      chatWorking = true;
      var bar = document.getElementById('chat-working-bar');
      bar.classList.add('visible');
      var stSpan = bar.querySelector('.working-streaming-text');
      if (stSpan) stSpan.textContent = '';

      // Show Stop button
      chatStreaming = true;
      document.getElementById('chat-input').disabled = true;
      var sendBtn = document.getElementById('chat-send-btn');
      sendBtn.textContent = 'Stop';
      sendBtn.onclick = chatStopWorking;
      sendBtn.disabled = false;
      sendBtn.classList.add('btn-stop');
    }

    /** Restore input bar to default state (Send button, enabled input). */
    function chatRestoreInputState() {
      chatStreaming = false;
      document.getElementById('chat-input').disabled = false;
      document.getElementById('chat-attach-btn').disabled = false;
      var sendBtn = document.getElementById('chat-send-btn');
      sendBtn.textContent = 'Send';
      sendBtn.onclick = chatSend;
      sendBtn.classList.remove('btn-stop');
      sendBtn.disabled = false;
    }

    function chatExitWorkingState() {
      chatWorking = false;
      document.getElementById('chat-working-bar').classList.remove('visible');
      chatRestoreInputState();
    }

    /** Stream retry job events via SSE into the working status bar. */
    async function chatStreamRetryJob(jobId) {
      chatStopPoll();
      // Abort the initial chatDoSend SSE so its cleanup doesn't trample our state
      if (chatAbortController) { chatAbortController.abort(); chatAbortController = null; }
      chatEnterWorkingState();
      // Capture session to detect switches during async streaming
      var retrySessionId = chatCurrentSessionId;
      var container = document.getElementById('chat-messages');
      var bar = document.getElementById('chat-working-bar');
      var streamingText = '';
      var lastErrBubble = null;
      var errLineCount = 0;
      var errBaseText = '';
      var MAX_ERR_LINES = 15;

      chatRetryAbort = new AbortController();

      try {
        await fetchSSEGet(
          '/api/chat/' + chatCurrentSessionId + '/job-stream/' + jobId,
          function(event) {
            var c = event.content || '';
            if (event.type !== 'error') { lastErrBubble = null; errLineCount = 0; errBaseText = ''; }
            if (event.type === 'text') {
              streamingText += c;
              // Show latest line of intermediate text in the status bar
              var stSpan = bar.querySelector('.working-streaming-text');
              if (stSpan) stSpan.textContent = streamingText.substring(streamingText.lastIndexOf('\\n') + 1);
            } else if (event.type === 'tool_use') {
              var toolBubble = document.createElement('div');
              toolBubble.className = 'chat-bubble tool-use';
              toolBubble.textContent = c;
              container.appendChild(toolBubble);
              container.scrollTop = container.scrollHeight;
            } else if (event.type === 'tool_result') {
              var trBubble = document.createElement('div');
              trBubble.className = 'chat-bubble tool-use';
              trBubble.textContent = c.substring(0, 400);
              trBubble.style.opacity = '0.7';
              container.appendChild(trBubble);
              container.scrollTop = container.scrollHeight;
            } else if (event.type === 'tool_approval') {
              // New approval during retry — reset streaming, show approval card
              streamingText = '';
              var stClear = bar.querySelector('.working-streaming-text');
              if (stClear) stClear.textContent = '';
              var approvalData = tryParseSystemMessage(c);
              if (approvalData) {
                var approvalBubble = document.createElement('div');
                renderSystemBubble(approvalBubble, approvalData);
                container.appendChild(approvalBubble);
                container.scrollTop = container.scrollHeight;
              }
            } else if (event.type === 'error') {
              errLineCount++;
              if (!lastErrBubble) {
                lastErrBubble = document.createElement('div');
                lastErrBubble.className = 'chat-bubble error';
                errBaseText = c;
                lastErrBubble.textContent = c;
                container.appendChild(lastErrBubble);
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
                  renderArtifactCard(container, chatCurrentSessionId, artData.jobId, artData.files, null);
                }
              } catch (e2) { /* ignore parse error */ }
            }
          },
          chatRetryAbort.signal
        );
      } catch (e) {
        if (e.name !== 'AbortError') {
          // SSE error — poll will pick up final state
        }
      }

      chatRetryAbort = null;

      // If user switched sessions during streaming, do not touch UI
      if (chatCurrentSessionId !== retrySessionId) return;

      chatExitWorkingState();

      // Sync message ID so poll does not re-render messages we already displayed
      var latest = await fetchApi('/api/chat/' + chatCurrentSessionId + '/messages?limit=1');
      if (latest && latest.messages && latest.messages.length > 0) {
        chatLastMessageId = latest.messages[0].id;
      }
      chatStartPoll();
    }

    async function chatCheckStatus() {
      if (!chatCurrentSessionId) return null;
      return await fetchApi('/api/chat/' + chatCurrentSessionId + '/status');
    }

    async function chatStopWorking() {
      if (!chatCurrentSessionId) return;
      try {
        await fetchApi('/api/chat/' + chatCurrentSessionId + '/stop', { method: 'POST' });
        toast('Stopped');
      } catch (e) { /* ignore */ }
      if (chatRetryAbort) chatRetryAbort.abort();
      chatExitWorkingState();
    }

    function toast(msg, type) {
      var c = document.getElementById('toast-container');
      var d = document.createElement('div');
      d.className = 'toast toast-' + (type || 'success');
      d.textContent = msg;
      c.appendChild(d);
      setTimeout(function() { d.remove(); }, 3200);
    }

    async function fetchApi(path, opts, silent) {
      try {
        opts = opts || {};
        opts.headers = Object.assign({ 'X-CSRF-Protection': '1' }, opts.headers || {});
        var res = await fetch(path, opts);
        if (res.status === 401) {
          if (!silent) toast('Session expired. Please restart dashboard: HuskyGate dashboard', 'error');
          return null;
        }
        var data = await res.json();
        if (!res.ok) {
          if (!silent) {
            if (res.status === 503) {
              toast('Server is not running. Please start the server from the Overview tab.', 'error');
            } else {
              toast(data.error || 'Request failed', 'error');
            }
          }
          return null;
        }
        return data;
      } catch (e) { if (!silent) toast('Network error', 'error'); return null; }
    }

    /* ── Shared Icons (Lucide-style, 14×14) ── */
    var SHARED_ICON = {
      play:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
      edit:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
      trash:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
      history: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
      pause:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
      checkCircle:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
      xCircle:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
      alertCircle:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      loader:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>',
      clock:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      copy:         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
    };

    var TOOL_BADGE_CLASSES = {
      claude: 'badge-claude',
      codex:  'badge-codex',
      gemini: 'badge-gemini'
    };

    function sharedToolBadge(tool) {
      var cls = TOOL_BADGE_CLASSES[(tool || '').toLowerCase()] || 'badge-tool';
      return '<span class="badge ' + cls + '">' + escapeHtml(tool) + '</span>';
    }

    var SOURCE_BADGE_CLASSES = {
      dashboard: 'badge-src-dashboard',
      schedule:  'badge-src-schedule',
      slack:     'badge-src-slack',
      webhook:   'badge-src-webhook',
      polling:   'badge-src-polling',
      chat:      'badge-src-chat',
      'ondemand-task': 'badge-src-ondemand',
      'triggered-task': 'badge-src-triggered',
      orchestrator: 'badge-src-orchestrator'
    };

    function sharedSourceBadge(source) {
      var s = (source || '').toLowerCase();
      var cls = SOURCE_BADGE_CLASSES[s] || 'badge-src-unknown';
      var label = s || 'unknown';
      return '<span class="badge badge-sm ' + cls + '">' + escapeHtml(label) + '</span>';
    }

    function showRunDetailFromCache(cacheObj, taskId, runIndex) {
      var runs = cacheObj[taskId];
      if (!runs || !runs[runIndex]) return;
      showRunDetailModal(runs[runIndex], runs.length - runIndex);
    }

    /* ── Shared Run Detail Modal ── */
    var _runDetailEscHandler = null;

    function showRunDetailModal(r, runNum) {
      var started = r.startedAt ? new Date(r.startedAt).toLocaleString() : '—';
      var ended = r.endedAt ? new Date(r.endedAt).toLocaleString() : '—';
      var duration = '—';
      if (r.endedAt && r.startedAt) {
        var ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
        duration = (ms / 1000).toFixed(1) + 's';
      }

      var statusColors = { completed: 'var(--status-completed)', failed: 'var(--status-failed)', timeout: 'var(--status-timeout)', running: 'var(--status-running)', pending: 'var(--status-pending)', cancelled: 'var(--status-pending)' };
      var statusColor = statusColors[r.status] || 'var(--text)';

      var outputHtml = '';
      if (r.outputSummary) {
        outputHtml = '<div class="qt-run-detail-output">' + renderMarkdown(r.outputSummary) + '</div>';
      } else if (r.errorMessage) {
        outputHtml = '<div class="qt-run-detail-output qt-run-detail-error">' + renderMarkdown(r.errorMessage) + '</div>';
      } else {
        outputHtml = '<div class="qt-run-detail-output" style="color:var(--text-dim);font-style:italic;">No output</div>';
      }

      var triggerContextHtml = '';
      if (r.triggerContextJson) {
        var triggerContextText = r.triggerContextJson;
        try {
          triggerContextText = JSON.stringify(JSON.parse(r.triggerContextJson), null, 2);
        } catch (_err) {
          triggerContextText = String(r.triggerContextJson);
        }
        triggerContextHtml = '<div class="qt-run-detail-section-title">Trigger Context</div>'
          + '<pre class="qt-run-detail-output"><code>' + escapeHtml(triggerContextText) + '</code></pre>';
      }

      var retryBadge = r.retryCount > 0
        ? ' <span class="badge badge-retry badge-sm">retry ' + r.retryCount + '</span>'
        : '';

      var sourceLabel = (r.triggeredBy && !r.source) ? 'Trigger' : 'Source';
      var sourceValue = r.source || r.triggeredBy;

      var html = '<div class="qt-run-detail-overlay" onclick="closeRunDetailModal()">'
        + '<div class="modal-content qt-run-detail-modal" onclick="event.stopPropagation()">'
        + '<div class="qt-run-detail-header">'
        + '<span class="qt-run-detail-title">Run #' + runNum + '</span>'
        + '<button class="qt-run-detail-close" onclick="closeRunDetailModal()" title="Close">&times;</button>'
        + '</div>'
        + '<div class="qt-run-detail-meta">'
        + '<div class="qt-run-detail-meta-item"><span class="qt-run-detail-label">Status</span><span style="color:' + statusColor + ';font-weight:600;">' + escapeHtml(r.status) + retryBadge + '</span></div>'
        + '<div class="qt-run-detail-meta-item"><span class="qt-run-detail-label">Started</span><span>' + escapeHtml(started) + '</span></div>'
        + '<div class="qt-run-detail-meta-item"><span class="qt-run-detail-label">Ended</span><span>' + escapeHtml(ended) + '</span></div>'
        + '<div class="qt-run-detail-meta-item"><span class="qt-run-detail-label">Duration</span><span>' + escapeHtml(duration) + '</span></div>'
        + '<div class="qt-run-detail-meta-item"><span class="qt-run-detail-label">' + escapeHtml(sourceLabel) + '</span>' + sharedSourceBadge(sourceValue) + '</div>'
        + '</div>'
        + '<div class="qt-run-detail-section-title">Output</div>'
        + outputHtml
        + triggerContextHtml
        + '</div></div>';

      /* Remove any previous modal + listener */
      closeRunDetailModal();

      document.body.insertAdjacentHTML('beforeend', html);

      _runDetailEscHandler = function(e) {
        if (e.key === 'Escape') closeRunDetailModal();
      };
      document.addEventListener('keydown', _runDetailEscHandler);
    }

    function closeRunDetailModal() {
      if (_runDetailEscHandler) {
        document.removeEventListener('keydown', _runDetailEscHandler);
        _runDetailEscHandler = null;
      }
      var el = document.querySelector('.qt-run-detail-overlay');
      if (el) {
        el.style.opacity = '0';
        setTimeout(function() { el.remove(); }, 200);
      }
    }

    /* ── Execution Policy (MCP / Skills) ── */

    /** Cached available skills fetched from server. key = tool or '__all__'. */
    var _availableSkillsByKey = {};

    function getAvailableSkillsCacheKey(tool) {
      return tool || '__all__';
    }

    function isSelectableSkillCatalogEntry(entry, tool) {
      if (!entry || typeof entry.skillRef !== 'string') return false;
      if (!Array.isArray(entry.toolVariants) || entry.toolVariants.length === 0) return false;
      if (Array.isArray(entry.issues)) {
        for (var i = 0; i < entry.issues.length; i++) {
          if (entry.issues[i] && entry.issues[i].code === 'duplicate-dir-name') return false;
        }
      }
      return !tool || entry.toolVariants.indexOf(tool) >= 0;
    }

    function formatSkillCatalogLabel(entry) {
      var base = (typeof entry.name === 'string' && entry.name) || entry.dirName || entry.skillRef;
      return entry.sourceKind === 'builtin' ? base : base + ' (' + entry.sourceKind + ')';
    }

    /** Fetch available skills from the unified catalog (cached per tool). */
    async function ensureAvailableSkills(tool) {
      var key = getAvailableSkillsCacheKey(tool);
      if (Object.prototype.hasOwnProperty.call(_availableSkillsByKey, key)) {
        return _availableSkillsByKey[key];
      }
      try {
        var url = '/api/skills/catalog';
        if (tool) url += '?tool=' + encodeURIComponent(tool);
        var data = await fetchApi(url, null, true);
        if (data && Array.isArray(data)) {
          var skills = [];
          for (var i = 0; i < data.length; i++) {
            var entry = data[i];
            if (!isSelectableSkillCatalogEntry(entry, tool)) continue;
            skills.push({
              skillRef: entry.skillRef,
              label: formatSkillCatalogLabel(entry)
            });
          }
          _availableSkillsByKey[key] = skills;
        } else {
          _availableSkillsByKey[key] = [];
        }
      } catch (e) {
        _availableSkillsByKey[key] = [];
      }
      return _availableSkillsByKey[key];
    }

    function getAvailableSkills(tool) {
      return _availableSkillsByKey[getAvailableSkillsCacheKey(tool)] || [];
    }

    /** Build HTML for MCP toggle + skills toggles. prefix = 'sched', 'qt', 'orch'. */
    function buildExecutionPolicyHtml(prefix, allowMcp, enabledSkills, tool) {
      return buildMcpSectionHtml(prefix, allowMcp) + buildSkillsSectionHtml(prefix, enabledSkills, tool);
    }

    /** Build HTML for MCP toggle only. */
    function buildMcpSectionHtml(prefix, allowMcp) {
      return '<label class="toggle-switch" style="margin-bottom:0.4rem;">'
        + '<input type="checkbox" id="' + prefix + '-allow-mcp"' + (allowMcp !== false ? ' checked' : '') + '>'
        + '<span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span>'
        + '<span class="toggle-switch-label">Allow MCP tools</span></label>';
    }

    /** Build HTML for skills checkboxes. */
    function buildSkillsSectionHtml(prefix, enabledSkills, tool) {
      var skills = getAvailableSkills(tool);
      var html = '';
      if (skills.length === 0) {
        html += '<div style="font-size:0.78rem;color:var(--text-dim);font-style:italic;">No skills available' + (tool ? ' for this app.' : ' on this server.') + '</div>';
      } else {
        html += '<div style="font-size:0.72rem;color:var(--text-dim);margin-bottom:0.3rem;">None checked = no skills</div>';
        html += '<div class="agent-checkbox-grid">';
        for (var si = 0; si < skills.length; si++) {
          var skill = skills[si];
          var checked = enabledSkills && enabledSkills.indexOf(skill.skillRef) >= 0;
          html += '<label class="agent-checkbox-label">'
            + '<input type="checkbox" class="' + prefix + '-skill-cb" value="' + escapeHtml(skill.skillRef) + '"' + (checked ? ' checked' : '') + '>'
            + '<span class="cb-mark"></span> ' + escapeHtml(skill.label) + '</label>';
        }
        html += '</div>';
      }
      return html;
    }

    /** Build HTML for skills checkboxes only (no MCP toggle). Used by orchestrator settings. */
    function buildSkillsOnlyHtml(prefix, enabledSkills, tool) {
      var skills = getAvailableSkills(tool);
      var html = '<div class="exec-policy-section" style="margin-top:0.5rem;">';
      html += '<div>';
      html += '<label class="orch-field-label" style="font-size:0.78rem;color:var(--text-dim);">Enabled Skills' + (skills.length > 0 ? ' <span style="font-size:0.7rem;">(none checked = no skills)</span>' : '') + '</label>';
      if (skills.length === 0) {
        html += '<div style="font-size:0.78rem;color:var(--text-dim);font-style:italic;margin-top:0.2rem;">No skills available' + (tool ? ' for this app.' : ' on this server.') + '</div>';
      } else {
        html += '<div class="agent-checkbox-grid" style="margin-top:0.3rem;">';
        for (var si = 0; si < skills.length; si++) {
          var skill = skills[si];
          var checked = enabledSkills && enabledSkills.indexOf(skill.skillRef) >= 0;
          html += '<label class="agent-checkbox-label">'
            + '<input type="checkbox" class="' + prefix + '-skill-cb" value="' + escapeHtml(skill.skillRef) + '"' + (checked ? ' checked' : '') + '>'
            + '<span class="cb-mark"></span> ' + escapeHtml(skill.label) + '</label>';
        }
        html += '</div>';
      }
      html += '</div></div>';
      return html;
    }

    /** Read skills checkboxes only (no MCP). Returns array of skill IDs. */
    function readSkillsOnly(prefix) {
      var cbs = document.querySelectorAll('.' + prefix + '-skill-cb:checked');
      var skills = [];
      for (var i = 0; i < cbs.length; i++) skills.push(cbs[i].value);
      return skills;
    }

    /** Read execution policy from form. Returns { allowMcp, enabledSkills }. */
    function readExecutionPolicy(prefix) {
      var mcpEl = document.getElementById(prefix + '-allow-mcp');
      var allowMcp = mcpEl ? mcpEl.checked : true;
      var cbs = document.querySelectorAll('.' + prefix + '-skill-cb:checked');
      var skills = [];
      for (var i = 0; i < cbs.length; i++) skills.push(cbs[i].value);
      // Empty array [] = explicit "no skills"; null = "inherit global"
      return { allowMcp: allowMcp, enabledSkills: skills };
    }

    /* ── Task Agent Selector (shared across qt / sched / tt modals) ── */

    /**
     * Populate agent selector dropdown for a task modal.
     * @param {string} prefix - 'qt', 'sched', or 'tt'
     * @param {string|null} selectedAgentId - current agent ID (for edit)
     */
    async function populateAgentSelector(prefix, selectedAgentId) {
      var agents = await agentsFetchCached();
      var select = document.getElementById(prefix + '-input-agent');
      if (!select) return;
      while (select.options.length > 1) select.remove(1);
      for (var i = 0; i < agents.length; i++) {
        var opt = document.createElement('option');
        opt.value = agents[i].id;
        opt.textContent = agents[i].name + ' (' + agents[i].tool + ')';
        select.appendChild(opt);
      }
      if (selectedAgentId) select.value = selectedAgentId;
      handleAgentSelectionChange(prefix);
    }

    /**
     * Handle agent dropdown change — show/hide tool/MCP/skills fields.
     * When an agent is selected: hide tool/MCP/skills rows, show summary.
     * When "None": restore normal fields.
     */
    function handleAgentSelectionChange(prefix) {
      var select = document.getElementById(prefix + '-input-agent');
      var agentId = select ? select.value : '';
      var isAgentMode = !!agentId;

      // Rows to toggle visibility
      var rowIds = [
        prefix + '-row-tool',
        prefix + '-row-mcp',
        prefix + '-row-skills'
      ];
      for (var i = 0; i < rowIds.length; i++) {
        var row = document.getElementById(rowIds[i]);
        if (row) row.style.display = isAgentMode ? 'none' : '';
      }

      // Agent summary card
      var summaryEl = document.getElementById(prefix + '-agent-summary');
      if (summaryEl) {
        if (isAgentMode) {
          renderAgentSummary(prefix, agentId);
          summaryEl.style.display = '';
        } else {
          summaryEl.style.display = 'none';
          summaryEl.innerHTML = '';
        }
      }
    }

    /**
     * Render a read-only summary of the selected agent's configuration.
     */
    async function renderAgentSummary(prefix, agentId) {
      var agents = await agentsFetchCached();
      var agent = null;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].id === agentId) { agent = agents[i]; break; }
      }
      var el = document.getElementById(prefix + '-agent-summary');
      if (!el || !agent) return;

      var html = '<div class="agent-inherited-card">'
        + '<div class="agent-inherited-header">Inherited from Agent</div>';
      html += '<div class="agent-inherited-row"><span class="agent-inherited-key">App</span><span class="agent-inherited-val">' + escapeHtml(agent.tool) + '</span></div>';
      var mcpLabel = agent.allowMcp === false ? 'Disabled' : (agent.enabledMcpServerIds && agent.enabledMcpServerIds.length > 0 ? agent.enabledMcpServerIds.length + ' server(s)' : 'All allowed');
      html += '<div class="agent-inherited-row"><span class="agent-inherited-key">MCP</span><span class="agent-inherited-val">' + escapeHtml(mcpLabel) + '</span></div>';
      if (agent.enabledSkills && agent.enabledSkills.length > 0) {
        html += '<div class="agent-inherited-row"><span class="agent-inherited-key">Skills</span><span class="agent-inherited-val">' + agent.enabledSkills.map(escapeHtml).join(', ') + '</span></div>';
      }
      if (agent.systemInstruction) {
        var preview = agent.systemInstruction.length > 100
          ? agent.systemInstruction.substring(0, 100) + '...'
          : agent.systemInstruction;
        html += '<div class="agent-inherited-row"><span class="agent-inherited-key">Instruction</span><span class="agent-inherited-val" style="font-family:monospace;font-size:0.75rem;">' + escapeHtml(preview) + '</span></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    /**
     * Read agentId from selector and snapshot agent values into payload for fallback.
     * Call this during save to populate payload.agentId and snapshot fields.
     */
    async function applyAgentToPayload(prefix, payload) {
      var agentId = (document.getElementById(prefix + '-input-agent') || {}).value || null;
      payload.agentId = agentId;
      if (agentId) {
        var agents = await agentsFetchCached();
        for (var i = 0; i < agents.length; i++) {
          if (agents[i].id === agentId) {
            payload.tool = agents[i].tool;
            payload.allowMcp = agents[i].allowMcp !== false;
            payload.enabledSkills = agents[i].enabledSkills == null ? null : agents[i].enabledSkills;
            break;
          }
        }
      }
    }

    /* ── Native Directory Picker (shared) ── */
    async function pickDirectory(targetInputId) {
      var inputEl = document.getElementById(targetInputId);
      if (!inputEl) return;
      var btn = inputEl.parentElement.querySelector('.btn-browse-dir');
      var currentPath = inputEl.value.trim();
      if (btn) { btn.disabled = true; btn.textContent = 'Opening...'; }
      try {
        var res = await fetch('/api/filesystem/pick-directory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
          body: JSON.stringify(currentPath ? { initialPath: currentPath } : {})
        });
        var data = await res.json();
        if (data && data.path) {
          inputEl.value = data.path;
        }
      } catch (e) {
        toast('Failed to open folder picker', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Browse'; }
      }
    }

    /* ── Global error safety net ── */
    window.addEventListener('unhandledrejection', function(event) {
      var msg = event.reason && event.reason.message ? event.reason.message : String(event.reason);
      toast('Error: ' + msg, 'error');
      if (typeof console !== 'undefined') console.error('[unhandledrejection]', event.reason);
    });

    /* ── Setup status indicator ── */
    async function checkSetupStatus() {
      var el = document.getElementById('setup-status');
      if (!el) return;
      try {
        var data = await fetchApi('/api/setup/status');
        if (data && data.complete) {
          el.className = 'sidebar-integration-card sid-configured';
          el.innerHTML =
            '<div class="sid-header">' +
              '<span class="sid-icon sid-icon-ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
              '<span class="sid-label">Slack</span>' +
              '<span class="sid-badge sid-badge-ok">Connected</span>' +
            '</div>' +
            '<div class="sid-footer">' +
              '<button class="sid-btn-reconfigure" onclick="window.open(\\'/setup\\',\\'_blank\\')">Reconfigure</button>' +
            '</div>';
        } else {
          el.className = 'sidebar-integration-card sid-unconfigured';
          el.innerHTML =
            '<div class="sid-header">' +
              '<span class="sid-icon sid-icon-warn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span>' +
              '<span class="sid-label">Slack</span>' +
              '<span class="sid-badge sid-badge-off">Not connected</span>' +
            '</div>' +
            '<button class="sid-btn-setup" onclick="window.open(\\'/setup\\',\\'_blank\\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
              'Connect Slack' +
            '</button>' +
            '<div class="sid-cli-hint">' +
              'or run <code>huskygate setup</code>' +
            '</div>';
        }
      } catch (e) {
        // Silently ignore — non-critical indicator
      }
    }
    checkSetupStatus();

    /* ── Theme Toggle ── */
    function toggleTheme() {
      var root = document.documentElement;
      var current = root.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('huskygate-theme', next); } catch(e) {}
    }

    /* ── Model Field Helpers ── */
    var MODEL_PLACEHOLDERS = {
      claude: 'e.g. claude-opus-4-6, claude-sonnet-4-6',
      codex: 'e.g. o3, gpt-4.1',
      gemini: 'e.g. gemini-2.5-pro, gemini-2.5-flash'
    };
    var MODEL_PREFIXES = {
      claude: ['claude'],
      codex: ['gpt', 'o1', 'o3', 'o4', 'codex'],
      gemini: ['gemini']
    };
    function checkModelToolMismatch(tool, model) {
      if (!model || !model.trim()) return null;
      var lower = model.trim().toLowerCase();
      var otherTools = Object.keys(MODEL_PREFIXES).filter(function(t) { return t !== tool; });
      for (var i = 0; i < otherTools.length; i++) {
        var prefixes = MODEL_PREFIXES[otherTools[i]];
        for (var j = 0; j < prefixes.length; j++) {
          if (lower.startsWith(prefixes[j])) {
            return 'This model name looks like it belongs to ' + otherTools[i] + '. You can still save it.';
          }
        }
      }
      return null;
    }
    function modelFieldHtml(fieldId, tool, currentModel) {
      var ph = MODEL_PLACEHOLDERS[tool] || '';
      var val = currentModel ? escapeHtml(currentModel) : '';
      return '<input type="text" class="settings-input" id="' + fieldId + '" value="' + val + '" placeholder="' + ph + '" oninput="onModelFieldInput(\\'' + fieldId + '\\')" />'
        + '<div id="' + fieldId + '-warning" class="model-mismatch-warning" style="display:none;"></div>';
    }
    function onModelFieldInput(fieldId) {
      var input = document.getElementById(fieldId);
      var warning = document.getElementById(fieldId + '-warning');
      if (!input || !warning) return;
      var tool = getModelFieldTool(fieldId);
      var msg = checkModelToolMismatch(tool, input.value);
      if (msg) {
        warning.textContent = msg;
        warning.style.display = 'block';
      } else {
        warning.style.display = 'none';
      }
    }
    function getModelFieldTool(fieldId) {
      // Derive tool from nearby tool select element based on conventions
      var toolSelectors = {
        'ondemand-model': 'ondemand-tool',
        'schedule-model': 'sched-input-tool',
        'triggered-model': 'triggered-tool',
        'agent-field-model': 'agent-field-tool',
        'orch-panel-node-model': 'orch-panel-node-tool'
      };
      var toolSelectId = toolSelectors[fieldId];
      if (toolSelectId) {
        var sel = document.getElementById(toolSelectId);
        if (sel) return sel.value;
      }
      return 'claude';
    }
    function updateModelPlaceholder(fieldId, tool) {
      var input = document.getElementById(fieldId);
      if (input) input.placeholder = MODEL_PLACEHOLDERS[tool] || '';
      onModelFieldInput(fieldId);
    }
`;
