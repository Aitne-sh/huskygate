import { describe, expect, it } from 'vitest';
import { parseApprovalDecision } from './approval.js';

describe('parseApprovalDecision', () => {
  it('parses approval words', () => {
    expect(parseApprovalDecision('!yes')).toBe('approve');
    expect(parseApprovalDecision('!y')).toBe('approve');
    expect(parseApprovalDecision('!YES')).toBe('approve');
    expect(parseApprovalDecision('!Y')).toBe('approve');
  });

  it('rejects removed aliases (!ok, !okay)', () => {
    expect(parseApprovalDecision('!ok')).toBeNull();
    expect(parseApprovalDecision('!okay')).toBeNull();
    expect(parseApprovalDecision('!OK')).toBeNull();
  });

  it('parses rejection words', () => {
    expect(parseApprovalDecision('!no')).toBe('reject');
    expect(parseApprovalDecision('!n')).toBe('reject');
    expect(parseApprovalDecision('!NO')).toBe('reject');
    expect(parseApprovalDecision('!N')).toBe('reject');
    expect(parseApprovalDecision('!no.')).toBe('reject');
  });

  it('returns null for unrelated or non-prefixed input', () => {
    expect(parseApprovalDecision('yes')).toBeNull();
    expect(parseApprovalDecision('no')).toBeNull();
    expect(parseApprovalDecision('maybe')).toBeNull();
    expect(parseApprovalDecision('!maybe')).toBeNull();
    expect(parseApprovalDecision('!')).toBeNull();
    expect(parseApprovalDecision('')).toBeNull();
  });
});
