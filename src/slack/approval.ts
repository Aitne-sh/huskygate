/** @module approval — Parses bang-command approval/rejection keywords (!yes, !no) from user messages */
export type ApprovalDecision = 'approve' | 'reject';

const APPROVE_WORDS = new Set(['yes', 'y']);
const REJECT_WORDS = new Set(['no', 'n']);

export function parseApprovalDecision(text: string): ApprovalDecision | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/[。．.]+$/g, '');
  if (!normalized) return null;
  if (!(normalized.startsWith('!') || normalized.startsWith('！'))) return null;
  const keyword = normalized.replace(/^[!！]+/, '').trim();
  if (!keyword) return null;
  if (APPROVE_WORDS.has(keyword)) return 'approve';
  if (REJECT_WORDS.has(keyword)) return 'reject';
  return null;
}
