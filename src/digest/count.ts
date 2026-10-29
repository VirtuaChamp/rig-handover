import type { LogLine, StatusCounts } from './types.js';

export const countByStatus = (lines: readonly LogLine[]): StatusCounts =>
  lines.reduce<StatusCounts>(
    (counts, line) => ({ ...counts, [line.status]: counts[line.status] + 1 }),
    { ok: 0, retry: 0, fail: 0 },
  );
