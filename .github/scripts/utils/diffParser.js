/**
 * Returns a Set of right-side (new file) line numbers that appear in the diff.
 * Only lines present in the diff can receive inline review comments.
 */
export function getDiffLines(patch) {
  const lines = new Set();
  if (!patch) return lines;

  let currentLine = 0;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      currentLine = parseInt(hunk[1], 10) - 1;
      continue;
    }
    if (line.startsWith('-')) continue; // removed line — no right-side number
    currentLine++;
    if (line.startsWith('+')) lines.add(currentLine);
  }

  return lines;
}
