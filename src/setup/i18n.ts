/** @module setup/i18n — Centralized setup wizard strings. */

export interface SetupStrings {
  // Banner
  bannerTitle: string;
  bannerSubtitle: string;

  // Step titles
  step1Title: string;
  step2Title: string;
  step3Title: string;
  step4Title: string;

  // Step 1: Create Slack App
  step1OpenBrowser: string;
  step1Fallback: string;
  step1Instruction1: string;
  step1Instruction2: string;
  step1Instruction3: string;
  step1WaitForEnter: string;

  // Step 2: Install App & Get Bot Token
  step2Instruction1: string;
  step2Instruction2: string;
  step2Instruction3: string;
  step2Instruction4: string;
  step2Instruction5: string;
  step2PromptLabel: string;

  // Step 3: Generate App Token
  step3Instruction1: string;
  step3Instruction2: string;
  step3Instruction3: string;
  step3Instruction4: string;
  step3Instruction5: string;
  step3Instruction6: string;
  step3Instruction7: string;
  step3Instruction8: string;
  step3PromptLabel: string;

  // Step 4: Allowed Users
  step4Question: string;
  step4FindUserId1: string;
  step4FindUserId2: string;
  step4PromptLabel: string;
  userRegistered: (count: number) => string;

  // Validation / retry
  attemptCount: (attempt: number, max: number) => string;
  saveWithoutValidation: string;
  saveWithoutLiveValidation: string;
  tokenSavedWithoutFormat: string;
  tokenSavedWithoutLive: string;
  failedAfterRetries: (max: number) => string;
  userIdRequired: string;
  invalidUserIdsAfterRetries: string;

  // Persistence
  keychainUnavailableWarning: string;
  keychainInstallHint: string;
  keychainRerunHint: string;
  saveFailed: (detail: string) => string;
  dbInitFailed: (dir: string, detail: string) => string;

  // Completion
  completeTitle: string;
  botTokenSaved: (storage: string) => string;
  appTokenSaved: (storage: string) => string;
  allowedUsersSaved: string;
  nextStepStart: string;
  nextStepDashboard: string;

  // Re-run / reset
  alreadyConfigured: string;
  setupCancelled: string;
  resetCancelled: string;
  resetConfirm: string;
  resetNoState: string;
  resetKeychainFailed: (detail: string) => string;
  resetDbFailed: (detail: string) => string;
  resetSuccess: string;
  resetPartial: string;
  resetRerunHint: string;

  // Status
  statusComplete: string;
  statusNotComplete: string;

  // Welcome DM
  welcomeTitle: string;
  welcomeBody: string;
}

const STRINGS: SetupStrings = {
  bannerTitle: 'HuskyGate -- First-Time Setup',
  bannerSubtitle:
    'This wizard will guide you through creating a Slack App and\nconfiguring HuskyGate. It takes about 2 minutes.',

  step1Title: 'Create Slack App',
  step2Title: 'Install App to Workspace',
  step3Title: 'Generate App-Level Token',
  step4Title: 'Set Allowed Users',

  step1OpenBrowser: 'Opening the Slack App creation page with a pre-filled manifest...',
  step1Fallback: '(If the browser did not open, copy this URL manually:)',
  step1Instruction1: 'After the page opens:',
  step1Instruction2: '  1. Select your workspace from the dropdown',
  step1Instruction3: '  2. Review the manifest and click "Create"',
  step1WaitForEnter: 'Press Enter when your app has been created...',

  step2Instruction1: 'In your Slack App settings page:',
  step2Instruction2: '  1. Go to "Install App" in the left sidebar',
  step2Instruction3: '  2. Click "Install to Workspace"',
  step2Instruction4: '  3. Review the permissions and click "Allow"',
  step2Instruction5: '  4. Copy the "Bot User OAuth Token" (starts with xoxb-)',
  step2PromptLabel: 'Paste Bot Token',

  step3Instruction1: 'In your Slack App settings page:',
  step3Instruction2: '  1. Go to "Basic Information" in the left sidebar',
  step3Instruction3: '  2. Scroll to "App-Level Tokens"',
  step3Instruction4: '  3. Click "Generate Token and Scopes"',
  step3Instruction5: '  4. Name: huskygate',
  step3Instruction6: '  5. Add scopes: connections:write, authorizations:read',
  step3Instruction7: '  6. Click "Generate"',
  step3Instruction8: '  7. Copy the token (starts with xapp-)',
  step3PromptLabel: 'Paste App Token',

  step4Question: 'Which Slack users should be allowed to use HuskyGate?',
  step4FindUserId1: '(To find your User ID: open Slack -> click your profile photo',
  step4FindUserId2: ' -> "Profile" -> click "..." -> "Copy member ID")',
  step4PromptLabel: 'Enter User ID(s), comma-separated',
  userRegistered: (count) => `${count} user(s) registered`,

  attemptCount: (attempt, max) => `(Attempt ${attempt}/${max})`,
  saveWithoutValidation: 'Save this token without validation?',
  saveWithoutLiveValidation: 'Save this token without live validation?',
  tokenSavedWithoutFormat: 'Token saved without format validation.',
  tokenSavedWithoutLive: 'Token saved without live validation.',
  failedAfterRetries: (max) => `Failed to provide a valid token after ${max} attempts.`,
  userIdRequired: 'At least one User ID is required.',
  invalidUserIdsAfterRetries: 'Invalid User IDs after maximum attempts.',

  keychainUnavailableWarning:
    'OS keychain is not available. Tokens will be stored in the config database.',
  keychainInstallHint: 'For better security, install a keychain provider (gnome-keyring / kwallet)',
  keychainRerunHint: 'and re-run: huskygate setup',
  saveFailed: (detail) => `Failed to save configuration: ${detail}`,
  dbInitFailed: (dir, detail) =>
    `Failed to initialize database in ${dir}:\n${detail}\n\nCheck file permissions on the data/ directory.`,

  completeTitle: '--- Setup Complete ---',
  botTokenSaved: (storage) => `Bot Token      -> saved to ${storage}`,
  appTokenSaved: (storage) => `App Token      -> saved to ${storage}`,
  allowedUsersSaved: 'Allowed Users  -> saved to config database',
  nextStepStart: 'To start HuskyGate:',
  nextStepDashboard: 'To change settings later:',

  alreadyConfigured: 'HuskyGate is already configured. Overwrite existing settings?',
  setupCancelled: 'Setup cancelled.',
  resetCancelled: 'Reset cancelled.',
  resetConfirm: 'This will remove all Slack tokens and allowed user IDs. Continue?',
  resetNoState: 'No setup state found. Nothing to reset.',
  resetKeychainFailed: (detail) => `Keychain cleanup failed: ${detail}`,
  resetDbFailed: (detail) => `Database cleanup failed: ${detail}`,
  resetSuccess: 'Setup state cleared.',
  resetPartial: 'Setup state partially cleared. Some entries may remain.',
  resetRerunHint: 'Run `huskygate setup` to reconfigure.',

  statusComplete: 'Setup complete.',
  statusNotComplete: 'Setup not complete.',

  welcomeTitle: 'Welcome to HuskyGate!',
  welcomeBody: [
    'HuskyGate has been set up and is ready to use.',
    '',
    'You can send me a message directly to start using AI assistants (Claude, Codex, Gemini).',
    '',
    'Quick start:',
    '\u2022 Send any message to start a conversation',
    '\u2022 Use `!help` to see available commands',
    '\u2022 Use `!menu` for the interactive menu',
    '',
    'For settings and monitoring, open the dashboard:',
    '  `huskygate dashboard start`',
  ].join('\n'),
};

export function getStrings(): SetupStrings {
  return STRINGS;
}
