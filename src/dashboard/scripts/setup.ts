/** @module dashboard/scripts/setup — Client-side setup wizard UI (standalone HTML page). */

export function renderSetupPage(config: { manifestUrl: string }): string {
  // Escape the manifest URL for safe embedding in HTML attribute
  const safeManifestUrl = config.manifestUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>HuskyGate Setup</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #F5F1E8;
      --surface: rgba(237,232,221,0.6);
      --surface-hover: rgba(237,232,221,0.9);
      --border: #DDD5C8;
      --border-hover: #C5A55A;
      --text: #2C2C2C;
      --text-muted: #7A7067;
      --text-dim: #A69E94;
      --accent: #B8975A;
      --accent2: #A07D3F;
      --green: #4CAF50;
      --red: #C0392B;
      --yellow: #D4A017;
      --blue: #5B8DB8;
      --radius: 12px;
      --glass: rgba(255,255,255,0.5);
      --glass-border: #DDD5C8;
      --shadow-sm: 0 1px 3px rgba(44,44,44,0.06);
      --shadow-md: 0 4px 12px rgba(44,44,44,0.08);
      --font-mono: 'SF Mono', 'Fira Code', 'Consolas', 'Menlo', monospace;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }

    body {
      font-family: 'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 2rem 1rem;
    }

    .setup-container {
      max-width: 640px;
      width: 100%;
    }

    .setup-header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .setup-header h1 {
      font-size: 1.6rem;
      font-style: italic;
      font-weight: 700;
      background: linear-gradient(135deg, #C5A55A 0%, #E0C97A 50%, #B8975A 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .setup-header p {
      color: var(--text-muted);
      font-size: 0.92rem;
    }

    /* ── Stepper ── */
    .stepper { display: flex; flex-direction: column; gap: 0; }

    .step {
      border: 1px solid var(--glass-border);
      background: var(--glass);
      border-radius: var(--radius);
      overflow: hidden;
      transition: box-shadow 0.2s, border-color 0.2s;
    }

    .step + .step { margin-top: -1px; }
    .step.active { border-color: var(--border-hover); box-shadow: var(--shadow-md); z-index: 1; position: relative; }
    .step.completed { border-color: rgba(76,175,80,0.3); }

    .step-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      cursor: default;
      user-select: none;
    }

    .step-number {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.82rem;
      font-weight: 600;
      flex-shrink: 0;
      border: 2px solid var(--border);
      color: var(--text-dim);
      background: transparent;
      transition: all 0.2s;
    }

    .step.active .step-number { border-color: var(--accent); color: var(--accent); background: rgba(184,151,90,0.1); }
    .step.completed .step-number { border-color: var(--green); color: #fff; background: var(--green); }

    .step-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text);
    }

    .step.completed .step-title { color: var(--text-muted); }

    .step-status {
      margin-left: auto;
      font-size: 0.78rem;
      color: var(--green);
      font-weight: 500;
    }

    .step-body {
      display: none;
      padding: 0 1.25rem 1.25rem;
    }

    .step.active .step-body { display: block; animation: fadeIn 0.2s ease; }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .step-instructions {
      font-size: 0.88rem;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 1rem;
    }

    .step-instructions ol {
      padding-left: 1.5rem;
      margin: 0.5rem 0;
    }

    .step-instructions li { margin-bottom: 0.3rem; }
    .step-instructions code {
      background: rgba(44,44,44,0.06);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 0.82rem;
      font-family: var(--font-mono);
    }

    /* ── Form elements ── */
    .form-group {
      margin-bottom: 1rem;
    }

    .form-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.35rem;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .form-input {
      width: 100%;
      padding: 0.6rem 0.85rem;
      padding-right: 2.5rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font-size: 0.88rem;
      font-family: var(--font-mono);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(184,151,90,0.12); }
    .form-input.error { border-color: var(--red); }
    .form-input.success { border-color: var(--green); }

    .toggle-visibility {
      position: absolute;
      right: 0.5rem;
      background: none;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      padding: 0.25rem;
      line-height: 0;
      display: flex;
      align-items: center;
    }

    .toggle-visibility:hover { color: var(--text); }

    .form-hint {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-top: 0.25rem;
    }

    .form-error {
      font-size: 0.78rem;
      color: var(--red);
      margin-top: 0.25rem;
      display: none;
    }

    .form-error.visible { display: block; }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 1.2rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 0.88rem;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
      text-decoration: none;
    }

    .btn:hover { background: var(--surface-hover); border-color: var(--border-hover); }
    .btn:active { transform: scale(0.97); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 600;
    }

    .btn-primary:hover { background: var(--accent2); border-color: var(--accent2); }

    .btn-link {
      background: none;
      border: none;
      color: var(--accent);
      padding: 0;
      font-size: 0.88rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .btn-link:hover { color: var(--accent2); }

    .step-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    /* ── Global alert ── */
    .alert {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 1rem;
      display: none;
    }

    .alert.visible { display: block; }

    .alert-error {
      background: rgba(192,57,43,0.08);
      border: 1px solid rgba(192,57,43,0.2);
      color: var(--red);
    }

    .alert-success {
      background: rgba(76,175,80,0.08);
      border: 1px solid rgba(76,175,80,0.2);
      color: var(--green);
    }

    /* ── Completion ── */
    .setup-complete {
      text-align: center;
      padding: 2rem 1.5rem;
      display: none;
    }

    .setup-complete.visible { display: block; }

    .setup-complete h2 {
      font-size: 1.3rem;
      margin-bottom: 0.75rem;
      color: var(--green);
    }

    .setup-complete p {
      color: var(--text-muted);
      margin-bottom: 1.5rem;
      font-size: 0.92rem;
    }

    .storage-summary {
      text-align: left;
      background: rgba(44,44,44,0.03);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.82rem;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }

    .storage-summary div { padding: 0.15rem 0; }

    /* ── Spinner ── */
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(184,151,90,0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .btn .spinner { border-top-color: #fff; border-color: rgba(255,255,255,0.3); }
  </style>
</head>
<body>
  <div class="setup-container">
    <div class="setup-header">
      <h1>HuskyGate</h1>
      <p>First-time setup &mdash; configure your Slack App in a few steps.</p>
    </div>

    <div id="globalAlert" class="alert"></div>

    <div id="stepper" class="stepper">
      <!-- Step 1: Create Slack App -->
      <div class="step active" data-step="1">
        <div class="step-header">
          <div class="step-number">1</div>
          <div class="step-title">Create Slack App</div>
          <div class="step-status"></div>
        </div>
        <div class="step-body">
          <div class="step-instructions">
            <p>Create a new Slack App using a pre-filled manifest:</p>
            <ol>
              <li>Click the link below to open the Slack App creation page</li>
              <li>Select your workspace from the dropdown</li>
              <li>Review the manifest and click <strong>Create</strong></li>
            </ol>
            <p style="margin-top:0.75rem;">
              <a href="${safeManifestUrl}" target="_blank" rel="noopener" class="btn">
                Open Slack App Creation Page &#8599;&#xFE0E;
              </a>
            </p>
          </div>
          <div class="step-actions">
            <button class="btn btn-primary" onclick="completeStep(1)">
              I've created the app &rarr;
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2: Install & Get Bot Token -->
      <div class="step" data-step="2">
        <div class="step-header">
          <div class="step-number">2</div>
          <div class="step-title">Install App &amp; Get Bot Token</div>
          <div class="step-status"></div>
        </div>
        <div class="step-body">
          <div class="step-instructions">
            <p>In your Slack App settings page:</p>
            <ol>
              <li>Go to <strong>Install App</strong> in the left sidebar</li>
              <li>Click <strong>Install to Workspace</strong></li>
              <li>Review the permissions and click <strong>Allow</strong></li>
              <li>Copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>)</li>
            </ol>
          </div>
          <div class="form-group">
            <label class="form-label" for="botToken">Bot Token</label>
            <div class="input-wrapper">
              <input type="password" class="form-input" id="botToken"
                     placeholder="xoxb-..." autocomplete="off" spellcheck="false">
              <button type="button" class="toggle-visibility" onclick="toggleVisibility('botToken', this)"
                      title="Show/hide token"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
            <div class="form-hint">Starts with <code>xoxb-</code></div>
            <div class="form-error" id="botTokenError"></div>
          </div>
          <div class="step-actions">
            <button class="btn btn-primary" onclick="completeStep(2)">
              Next &rarr;
            </button>
          </div>
        </div>
      </div>

      <!-- Step 3: Generate App Token -->
      <div class="step" data-step="3">
        <div class="step-header">
          <div class="step-number">3</div>
          <div class="step-title">Generate App-Level Token</div>
          <div class="step-status"></div>
        </div>
        <div class="step-body">
          <div class="step-instructions">
            <p>In your Slack App settings page:</p>
            <ol>
              <li>Go to <strong>Basic Information</strong> in the left sidebar</li>
              <li>Scroll to <strong>App-Level Tokens</strong></li>
              <li>Click <strong>Generate Token and Scopes</strong></li>
              <li>Name: <code>huskygate</code></li>
              <li>Add scopes: <code>connections:write</code>, <code>authorizations:read</code></li>
              <li>Click <strong>Generate</strong></li>
              <li>Copy the token (starts with <code>xapp-</code>)</li>
            </ol>
          </div>
          <div class="form-group">
            <label class="form-label" for="appToken">App Token</label>
            <div class="input-wrapper">
              <input type="password" class="form-input" id="appToken"
                     placeholder="xapp-..." autocomplete="off" spellcheck="false">
              <button type="button" class="toggle-visibility" onclick="toggleVisibility('appToken', this)"
                      title="Show/hide token"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
            <div class="form-hint">Starts with <code>xapp-</code></div>
            <div class="form-error" id="appTokenError"></div>
          </div>
          <div class="step-actions">
            <button class="btn btn-primary" onclick="completeStep(3)">
              Next &rarr;
            </button>
          </div>
        </div>
      </div>

      <!-- Step 4: Set Allowed Users -->
      <div class="step" data-step="4">
        <div class="step-header">
          <div class="step-number">4</div>
          <div class="step-title">Set Allowed Users</div>
          <div class="step-status"></div>
        </div>
        <div class="step-body">
          <div class="step-instructions">
            <p>Which Slack users should be allowed to use HuskyGate?</p>
            <p style="margin-top:0.5rem;">To find your User ID: open Slack &rarr; click your profile photo
               &rarr; <strong>Profile</strong> &rarr; click <strong>...</strong> &rarr; <strong>Copy member ID</strong></p>
          </div>
          <div class="form-group">
            <label class="form-label" for="allowedUserIds">User ID(s)</label>
            <input type="text" class="form-input" id="allowedUserIds"
                   placeholder="U01ABCDEF, U02GHIJKL" autocomplete="off" spellcheck="false"
                   style="font-family: var(--font-mono);">
            <div class="form-hint">Comma-separated Slack User IDs (optional)</div>
            <div class="form-error" id="allowedUserIdsError"></div>
          </div>
          <div class="step-actions">
            <button class="btn btn-primary" id="submitBtn" onclick="submitSetup()">
              Complete Setup
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Completion screen -->
    <div id="setupComplete" class="setup-complete">
      <h2>&#10003; Setup Complete</h2>
      <p>HuskyGate is now configured and ready to use.</p>
      <div id="storageSummary" class="storage-summary"></div>
      <a href="/" class="btn btn-primary">Open Dashboard</a>
    </div>
  </div>

  <script>
    var currentStep = 1;

    var SVG_EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var SVG_EYE_CLOSED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';

    function toggleVisibility(inputId, btn) {
      var input = document.getElementById(inputId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = SVG_EYE_CLOSED;
        btn.title = 'Hide token';
      } else {
        input.type = 'password';
        btn.innerHTML = SVG_EYE_OPEN;
        btn.title = 'Show token';
      }
    }

    function clearErrors() {
      var errs = document.querySelectorAll('.form-error');
      for (var i = 0; i < errs.length; i++) {
        errs[i].textContent = '';
        errs[i].classList.remove('visible');
      }
      var inputs = document.querySelectorAll('.form-input');
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].classList.remove('error');
      }
      var alert = document.getElementById('globalAlert');
      alert.classList.remove('visible', 'alert-error', 'alert-success');
    }

    function showFieldError(fieldId, message) {
      var errEl = document.getElementById(fieldId + 'Error');
      var input = document.getElementById(fieldId);
      if (errEl) {
        errEl.textContent = message;
        errEl.classList.add('visible');
      }
      if (input) {
        input.classList.add('error');
      }
    }

    function showGlobalError(message) {
      var alert = document.getElementById('globalAlert');
      alert.textContent = message;
      alert.classList.remove('alert-success');
      alert.classList.add('alert-error', 'visible');
    }

    function setStepState(stepNum, state) {
      var step = document.querySelector('.step[data-step="' + stepNum + '"]');
      if (!step) return;
      step.classList.remove('active', 'completed');
      if (state) step.classList.add(state);
      var statusEl = step.querySelector('.step-status');
      if (statusEl) {
        statusEl.textContent = state === 'completed' ? '\\u2713' : '';
      }
    }

    function completeStep(stepNum) {
      clearErrors();

      // Validate current step
      if (stepNum === 2) {
        var botToken = document.getElementById('botToken').value.trim();
        if (!botToken) {
          showFieldError('botToken', 'Bot Token is required');
          return;
        }
        if (!botToken.startsWith('xoxb-')) {
          showFieldError('botToken', 'Token must start with xoxb-');
          return;
        }
        if (botToken.length < 30) {
          showFieldError('botToken', 'Token is too short');
          return;
        }
      }

      if (stepNum === 3) {
        var appToken = document.getElementById('appToken').value.trim();
        if (!appToken) {
          showFieldError('appToken', 'App Token is required');
          return;
        }
        if (!appToken.startsWith('xapp-')) {
          showFieldError('appToken', 'Token must start with xapp-');
          return;
        }
        if (appToken.length < 40) {
          showFieldError('appToken', 'Token is too short');
          return;
        }
      }

      setStepState(stepNum, 'completed');
      currentStep = stepNum + 1;
      if (currentStep <= 4) {
        setStepState(currentStep, 'active');
      }
    }

    function submitSetup() {
      clearErrors();

      var botToken = document.getElementById('botToken').value.trim();
      var appToken = document.getElementById('appToken').value.trim();
      var allowedUserIds = document.getElementById('allowedUserIds').value.trim();

      // Client-side validation
      var hasError = false;

      if (!botToken) {
        showFieldError('botToken', 'Bot Token is required');
        setStepState(2, 'active');
        setStepState(4, '');
        currentStep = 2;
        hasError = true;
      }

      if (!appToken) {
        showFieldError('appToken', 'App Token is required');
        if (!hasError) {
          setStepState(3, 'active');
          setStepState(4, '');
          currentStep = 3;
        }
        hasError = true;
      }

      if (hasError) return;

      doSubmit(botToken, appToken, allowedUserIds, false);
    }

    function doSubmit(botToken, appToken, allowedUserIds, force) {
      var submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span> Validating...';

      var payload = {
        botToken: botToken,
        appToken: appToken,
        allowedUserIds: allowedUserIds
      };
      if (force) payload.force = true;

      fetch('/api/setup/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-protection': '1'
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
      .then(function(resp) { return resp.json().then(function(data) { return { status: resp.status, data: data }; }); })
      .then(function(result) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Complete Setup';

        // Handle 409 Conflict: setup already complete, ask to force
        if (result.status === 409 && !force) {
          if (confirm('HuskyGate is already configured. Overwrite existing settings?')) {
            doSubmit(botToken, appToken, allowedUserIds, true);
          }
          return;
        }

        if (!result.data.ok) {
          var errors = result.data.errors || [];
          for (var i = 0; i < errors.length; i++) {
            var err = errors[i];
            if (err.field === '_') {
              showGlobalError(err.message);
            } else {
              showFieldError(err.field, err.message);
              // Navigate to the step with the error
              if (err.field === 'botToken') {
                setStepState(4, '');
                setStepState(2, 'active');
                currentStep = 2;
              } else if (err.field === 'appToken') {
                setStepState(4, '');
                setStepState(3, 'active');
                currentStep = 3;
              } else if (err.field === 'allowedUserIds') {
                // Stay on step 4
              }
            }
          }
          return;
        }

        // Success — show completion screen
        setStepState(4, 'completed');
        document.getElementById('stepper').style.display = 'none';

        var storage = result.data.storage || {};
        var summary = document.getElementById('storageSummary');
        summary.innerHTML =
          '<div>Bot Token &#8594; ' + escapeSetupHtml(storage.botToken || 'saved') + '</div>' +
          '<div>App Token &#8594; ' + escapeSetupHtml(storage.appToken || 'saved') + '</div>' +
          '<div>Allowed Users &#8594; ' + escapeSetupHtml(storage.allowedUserIds || 'saved') + '</div>';

        document.getElementById('setupComplete').classList.add('visible');
      })
      .catch(function(err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Complete Setup';
        showGlobalError('Network error: ' + (err.message || 'failed to connect'));
      });
    }

    function escapeSetupHtml(s) {
      if (typeof s !== 'string') return '';
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
}
