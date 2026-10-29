import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, LogLine, Night, ReadNight } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

const isStatus = (value: unknown): value is LogLine['status'] =>
  value === 'ok' || value === 'retry' || value === 'fail';

const isLogLine = (value: unknown): value is LogLine =>
  typeof value === 'object' &&
  value !== null &&
  'at' in value &&
  typeof value.at === 'string' &&
  'job' in value &&
  typeof value.job === 'string' &&
  'status' in value &&
  isStatus(value.status) &&
  'owner' in value &&
  (typeof value.owner === 'string' || value.owner === null) &&
  (!('error' in value) || typeof value.error === 'string');

const parseLine = (text: string): LogLine | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isLogLine(value) ? value : null;
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const readRunLog = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

const groupByJob = (lines: readonly LogLine[]): [string, LogLine[]][] =>
  [
    ...lines.reduce(
      (groups, line) => groups.set(line.job, [...(groups.get(line.job) ?? []), line]),
      new Map<string, LogLine[]>(),
    ),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const toRow = ([job, lines]: [string, LogLine[]]): DigestRow => {
  const first = lines[0];
  const last = lines[lines.length - 1];
  const lastWithError = lines.findLast((line) => line.error !== undefined);
  return {
    job,
    owner: last.owner,
    runs: lines.length,
    retries: lines.filter((line) => line.status === 'retry').length,
    lastStatus: last.status,
    lastError: lastWithError?.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
};

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readRunLog(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;
  const entries = splitLines(text).map(parseLine);
  const lines = entries.filter((entry): entry is LogLine => entry !== null);
  return {
    rows: groupByJob(lines).map(toRow),
    badLines: entries.length - lines.length,
  } satisfies Night;
};
