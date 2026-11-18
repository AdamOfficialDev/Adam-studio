export interface DiffLine {
  type: 'same' | 'add' | 'remove';
  line: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Guard untuk file super besar agar UI tetap instan
  if (oldLines.length * newLines.length > 450_000) {
    const result: DiffLine[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < oldLines.length && i < newLines.length) {
        if (oldLines[i] === newLines[i]) {
          result.push({ type: 'same', line: newLines[i], oldLineNum: i + 1, newLineNum: i + 1 });
        } else {
          result.push({ type: 'remove', line: oldLines[i], oldLineNum: i + 1 });
          result.push({ type: 'add', line: newLines[i], newLineNum: i + 1 });
        }
      } else if (i < oldLines.length) {
        result.push({ type: 'remove', line: oldLines[i], oldLineNum: i + 1 });
      } else if (i < newLines.length) {
        result.push({ type: 'add', line: newLines[i], newLineNum: i + 1 });
      }
    }
    return result;
  }

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ type: 'same', line: oldLines[i], oldLineNum: i + 1, newLineNum: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'remove', line: oldLines[i], oldLineNum: i + 1 });
      i += 1;
    } else {
      diff.push({ type: 'add', line: newLines[j], newLineNum: j + 1 });
      j += 1;
    }
  }

  while (i < m) {
    diff.push({ type: 'remove', line: oldLines[i], oldLineNum: i + 1 });
    i += 1;
  }
  while (j < n) {
    diff.push({ type: 'add', line: newLines[j], newLineNum: j + 1 });
    j += 1;
  }

  return diff;
}
