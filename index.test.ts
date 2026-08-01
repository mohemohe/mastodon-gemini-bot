import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { filterStatusesByIgnoreKeywords, loadIgnoreKeywords } from './index';

test('loadIgnoreKeywords reads trimmed, non-empty lines', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mastodon-gemini-bot-'));
  const ignoreKeywordsPath = path.join(temporaryDirectory, '.ignore_keywords');

  try {
    fs.writeFileSync(ignoreKeywordsPath, ' A \r\n\r\nD\n  \n', 'utf8');
    assert.deepEqual(loadIgnoreKeywords(ignoreKeywordsPath), ['A', 'D']);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('loadIgnoreKeywords returns an empty list when the file does not exist', () => {
  assert.deepEqual(loadIgnoreKeywords(path.join(os.tmpdir(), 'missing-ignore-keywords')), []);
});

test('filterStatusesByIgnoreKeywords removes statuses containing any keyword', () => {
  const statuses = ['A', 'B', 'C', 'D', 'prefix A suffix'];

  assert.deepEqual(
    filterStatusesByIgnoreKeywords(statuses, ['A', 'D']),
    ['B', 'C']
  );
});

test('filterStatusesByIgnoreKeywords leaves statuses unchanged without keywords', () => {
  const statuses = ['A', 'B'];

  assert.equal(filterStatusesByIgnoreKeywords(statuses, []), statuses);
});
