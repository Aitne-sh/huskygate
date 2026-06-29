import { describe, expect, it } from 'vitest';
import { boolFromDb, boolToDb } from './db.js';

describe('db utils', () => {
  it('boolToDb', () => {
    expect(boolToDb(true)).toBe(1);
    expect(boolToDb(false)).toBe(0);
    expect(boolToDb(1)).toBe(1);
    expect(boolToDb(0)).toBe(0);
    expect(boolToDb(null)).toBe(0);
    expect(boolToDb(undefined)).toBe(0);
    expect(boolToDb('')).toBe(0);
    expect(boolToDb('str')).toBe(1);
  });

  it('boolFromDb', () => {
    expect(boolFromDb(1)).toBe(true);
    expect(boolFromDb(0)).toBe(false);
    expect(boolFromDb(null)).toBe(false);
    expect(boolFromDb(undefined)).toBe(false);
    expect(boolFromDb('str')).toBe(true);
  });
});
