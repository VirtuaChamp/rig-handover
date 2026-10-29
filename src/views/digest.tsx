import type { DigestRow, Night } from '../digest/types.js';

const orDash = (value: string | null): string => value ?? '—';

const needsAttention = (row: DigestRow): boolean => row.retries >= 3 || row.lastStatus === 'fail';

const unreadNote = (count: number): string =>
  count === 1 ? '1 line could not be read' : `${count} lines could not be read`;

export function DigestView({ night, digest }: { night: string; digest: Night }) {
  return (
    <>
      <h1>digest {night}</h1>
      {digest.badLines > 0 ? <p class="warn">{unreadNote(digest.badLines)}</p> : null}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={needsAttention(row) ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{orDash(row.owner)}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>{row.lastStatus}</td>
                <td>{orDash(row.lastError)}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function NoRunLog({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p class="mute">no run log for {night}</p>
    </>
  );
}
