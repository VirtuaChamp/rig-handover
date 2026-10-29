import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const runsDir = 'runs';

describe('readNight on the real 2026-10-28 log', () => {
  const night = readNight(runsDir, '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads five jobs and counts the one truncated line as bad', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
  });

  it('counts fixtures/refresh as 4 runs, 3 retries, last ok', () => {
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts lane/sync as 8 runs, 1 retry, last ok, with the offset kept', () => {
    expect(row('lane/sync')).toMatchObject({
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('reports notes/backup as fail with its quota error', () => {
    expect(row('notes/backup')).toMatchObject({
      owner: 'lane-07',
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps digest/render with a null owner', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('returns null for a night with no file', () => {
    expect(readNight(runsDir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not a date, so it cannot leave runsDir', () => {
    expect(readNight(runsDir, '../2026-10-28')).toBeNull();
  });
});

describe('readNight on temp logs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns zero rows for an empty file', () => {
    writeFileSync(join(dir, '2026-10-28.jsonl'), '');
    expect(readNight(dir, '2026-10-28')).toEqual({ rows: [], badLines: 0 });
  });

  it('ignores blank lines and counts non-conforming ones as bad', () => {
    writeFileSync(
      join(dir, '2026-10-28.jsonl'),
      [
        '',
        '{"at":"2026-10-28T10:00:00+01:00","job":"a","status":"ok","owner":null}',
        '   ',
        '{"at":"2026-10-28T10:01:00+01:00","job":"a","status":"maybe","owner":null}',
        '{"at":"2026-10-28T10:02:00+01:00","job":"a","status":"fail","owner":"x","error":42}',
        'not json',
      ].join('\r\n'),
    );
    expect(readNight(dir, '2026-10-28')).toEqual({
      rows: [
        {
          job: 'a',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T10:00:00+01:00',
          lastAt: '2026-10-28T10:00:00+01:00',
        },
      ],
      badLines: 3,
    });
  });

  it('returns null when the file is missing', () => {
    expect(readNight(dir, '2026-10-28')).toBeNull();
  });
});
