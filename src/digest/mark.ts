import type { DigestRow } from './types.js';

export type MarkedRow = DigestRow & { marked: boolean };

export const isMarked = (row: DigestRow): boolean => row.retries >= 3 || row.lastStatus === 'fail';

export const markRows = (rows: readonly DigestRow[]): MarkedRow[] =>
  rows.map((row) => ({ ...row, marked: isMarked(row) }));
