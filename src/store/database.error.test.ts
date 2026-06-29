import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  DatabaseCtor: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({
  default: mocked.DatabaseCtor,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    error: mocked.loggerError,
  },
}));

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-db-error-'));
}

interface FakeDb {
  pragma: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function createBaseFakeDb(): FakeDb {
  const pragma = vi.fn((sql: string) => {
    if (sql === 'journal_mode = WAL') return 'wal';
    if (sql === 'table_info(sessions)') return [{ name: 'dev_alias' }];
    if (sql === 'table_info(dev_aliases)') return [{ name: 'instruction_content' }];
    if (sql === 'wal_checkpoint(TRUNCATE)') return undefined;
    return undefined;
  });

  return {
    pragma,
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 0 })),
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
    })),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
  };
}

beforeEach(() => {
  vi.resetModules();
  mocked.DatabaseCtor.mockReset();
  mocked.loggerInfo.mockReset();
  mocked.loggerError.mockReset();
});

describe('database error paths', () => {
  it('logs and rethrows when constructor fails during initDatabase', async () => {
    mocked.DatabaseCtor.mockImplementation(() => {
      throw new Error('open failed');
    });

    const { initDatabase } = await import('./database.js');

    expect(() => initDatabase(createTempDir())).toThrow('open failed');
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'database_init_failed',
      expect.objectContaining({ error: 'open failed' }),
    );
  });

  it('tries to close partially initialized db on init failure and clears singleton', async () => {
    const fakeDb = createBaseFakeDb();
    fakeDb.exec.mockImplementation(() => {
      throw new Error('schema boom');
    });
    fakeDb.close.mockImplementation(() => {
      throw new Error('close boom');
    });
    mocked.DatabaseCtor.mockReturnValue(fakeDb as never);

    const { getDb, initDatabase } = await import('./database.js');

    expect(() => initDatabase(createTempDir())).toThrow('schema boom');
    expect(fakeDb.close).toHaveBeenCalled();
    expect(() => getDb()).toThrow(/Database not initialized/);
  });

  it('logs wal checkpoint failure but still closes database', async () => {
    const fakeDb = createBaseFakeDb();
    fakeDb.pragma.mockImplementation((sql: string) => {
      if (sql === 'wal_checkpoint(TRUNCATE)') {
        throw new Error('checkpoint failed');
      }
      if (sql === 'journal_mode = WAL') return 'wal';
      if (sql === 'table_info(sessions)') return [{ name: 'dev_alias' }];
      if (sql === 'table_info(dev_aliases)') return [{ name: 'instruction_content' }];
      return undefined;
    });
    mocked.DatabaseCtor.mockReturnValue(fakeDb as never);

    const { closeDatabase, initDatabase } = await import('./database.js');

    initDatabase(createTempDir());
    closeDatabase();

    expect(mocked.loggerError).toHaveBeenCalledWith('wal_checkpoint_failed', {
      error: 'checkpoint failed',
    });
    expect(fakeDb.close).toHaveBeenCalled();
    expect(mocked.loggerInfo).toHaveBeenCalledWith('database_closed');
  });

  it('logs close failure and still resets singleton', async () => {
    const fakeDb = createBaseFakeDb();
    fakeDb.close.mockImplementation(() => {
      throw new Error('close failed');
    });
    mocked.DatabaseCtor.mockReturnValue(fakeDb as never);

    const { closeDatabase, getDb, initDatabase } = await import('./database.js');

    initDatabase(createTempDir());
    closeDatabase();

    expect(mocked.loggerError).toHaveBeenCalledWith('database_close_failed', {
      error: 'close failed',
    });
    expect(() => getDb()).toThrow(/Database not initialized/);
  });
});
