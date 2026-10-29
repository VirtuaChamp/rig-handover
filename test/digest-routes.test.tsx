import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { MarkedRow } from '../src/digest/mark.js';
import type { LogLine } from '../src/digest/types.js';

const entry = (
  at: string,
  job: string,
  status: LogLine['status'],
  owner: string | null,
  error?: string,
): string => JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

const NIGHT_OK = '2026-10-28';
const NIGHT_EMPTY = '2026-10-26';
const NIGHT_BAD = '2026-10-25';
const NIGHT_MISSING = '2026-01-01';

const okLines = [
  entry('2026-10-28T23:00:00+01:00', 'zeta/backup', 'ok', null),
  entry('2026-10-28T23:05:00+01:00', 'alpha/fetch', 'retry', 'rook', 'upstream 503'),
  entry('2026-10-28T23:06:00+01:00', 'mid/notes', 'fail', 'lane-07', 'quota exceeded'),
  entry('2026-10-28T23:07:00+01:00', 'alpha/fetch', 'retry', 'rook', 'upstream 503'),
  entry('2026-10-28T23:08:00+01:00', 'beta/render', 'ok', 'rook'),
  entry('2026-10-28T23:09:00+01:00', 'gamma/sync', 'retry', 'rook', 'lock held'),
  entry('2026-10-28T23:10:00+01:00', 'alpha/fetch', 'retry', 'rook', 'upstream 503'),
  entry('2026-10-28T23:11:00+01:00', 'gamma/sync', 'retry', 'rook', 'lock held'),
  entry('2026-10-28T23:12:00+01:00', 'alpha/fetch', 'ok', 'rook'),
  entry('2026-10-28T23:13:00+01:00', 'gamma/sync', 'ok', 'rook'),
];

const badLines = [
  entry('2026-10-25T09:00:00+01:00', 'beta/render', 'ok', 'rook'),
  'not json',
  entry('2026-10-25T09:01:00+01:00', 'alpha/fetch', 'fail', 'rook', 'disk full'),
];

const SORTED_JOBS = ['alpha/fetch', 'beta/render', 'gamma/sync', 'mid/notes', 'zeta/backup'];

type PageRow = { marked: boolean; cells: string[] };
type DigestBody = { night: string; rows: MarkedRow[]; badLines: number };

const pageRows = (html: string): PageRow[] =>
  [...html.matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)]
    .filter(([, , body]) => body.includes('<td>'))
    .map(([, cls, body]) => ({
      marked: cls === 'warn',
      cells: [...body.matchAll(/<td>([^<]*)<\/td>/g)].map(([, cell]) => cell),
    }));

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(join(runsDir, `${NIGHT_OK}.jsonl`), okLines.join('\n'));
  writeFileSync(join(runsDir, `${NIGHT_EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${NIGHT_BAD}.jsonl`), badLines.join('\n'));
  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  app = createApp(config);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders the jobs sorted, marks retries of 3 or more and any fail, shows — for missing values', async () => {
    const res = await app.request(`/digest/${NIGHT_OK}`);
    expect(res.status).toBe(200);
    const rows = pageRows(await res.text());
    expect(rows.map((r) => r.cells[0])).toEqual(SORTED_JOBS);
    expect(rows.filter((r) => r.marked).map((r) => r.cells[0])).toEqual(['alpha/fetch', 'mid/notes']);
    expect(rows.find((r) => r.cells[0] === 'alpha/fetch')?.cells).toEqual([
      'alpha/fetch',
      'rook',
      '4',
      '3',
      'ok',
      'upstream 503',
      '2026-10-28T23:05:00+01:00',
      '2026-10-28T23:12:00+01:00',
    ]);
    expect(rows.find((r) => r.cells[0] === 'zeta/backup')?.cells).toEqual([
      'zeta/backup',
      '—',
      '1',
      '0',
      'ok',
      '—',
      '2026-10-28T23:00:00+01:00',
      '2026-10-28T23:00:00+01:00',
    ]);
  });

  it('answers 404 with the no-log note for a night with no file', async () => {
    const res = await app.request(`/digest/${NIGHT_MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${NIGHT_MISSING}`);
  });

  it('renders "nothing ran" and no table for an empty file', async () => {
    const res = await app.request(`/digest/${NIGHT_EMPTY}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('notes the bad line and still renders the other rows', async () => {
    const res = await app.request(`/digest/${NIGHT_BAD}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('1 line could not be read');
    const rows = pageRows(html);
    expect(rows.map((r) => r.cells[0])).toEqual(['alpha/fetch', 'beta/render']);
    expect(rows.find((r) => r.cells[0] === 'alpha/fetch')).toMatchObject({ marked: true });
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the jobs sorted, with marks and null owner kept', async () => {
    const res = await app.request(`/api/digest/${NIGHT_OK}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestBody;
    expect(body.night).toBe(NIGHT_OK);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(SORTED_JOBS);
    expect(body.rows.filter((r) => r.marked).map((r) => r.job)).toEqual(['alpha/fetch', 'mid/notes']);
    expect(body.rows.find((r) => r.job === 'alpha/fetch')).toMatchObject({
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-28T23:05:00+01:00',
      lastAt: '2026-10-28T23:12:00+01:00',
    });
    expect(body.rows.find((r) => r.job === 'zeta/backup')).toMatchObject({ owner: null, lastError: null });
  });

  it('answers 404 with the error and night for a night with no file', async () => {
    const res = await app.request(`/api/digest/${NIGHT_MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: NIGHT_MISSING });
  });

  it('returns no rows for an empty file', async () => {
    const res = await app.request(`/api/digest/${NIGHT_EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: NIGHT_EMPTY, rows: [], badLines: 0 });
  });

  it('counts the bad line and still returns the other rows', async () => {
    const res = await app.request(`/api/digest/${NIGHT_BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestBody;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/fetch', 'beta/render']);
    expect(body.rows.find((r) => r.job === 'alpha/fetch')).toMatchObject({ marked: true, lastStatus: 'fail' });
  });
});

describe('page and JSON agree', () => {
  it.each([NIGHT_OK, NIGHT_BAD])('list the same jobs in the same order with the same marks for %s', async (night) => {
    const page = pageRows(await (await app.request(`/digest/${night}`)).text());
    const api = (await (await app.request(`/api/digest/${night}`)).json()) as DigestBody;
    expect(page.map((r) => r.cells[0])).toEqual(api.rows.map((r) => r.job));
    expect(page.map((r) => r.marked)).toEqual(api.rows.map((r) => r.marked));
  });
});
