/**
 * Runs the command-substitution from the print command in a real shell.
 *
 * POSIX sh rather than bash, so this also passes in the Alpine CI image; anything sh
 * accepts, the user's bash or zsh accepts too.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LINUX_PRINT_COMMAND, NEWEST_DOWNLOAD } from '../src/print-command.js';

let home;
let downloads;

/** Create a file in ~/Downloads with an explicit mtime, in seconds from an epoch base. */
function download(name, ageSeconds) {
  const path = join(downloads, name);
  writeFileSync(path, '%PDF-1.7\n');
  const when = new Date('2026-01-01T00:00:00Z').getTime() / 1000 + ageSeconds;
  utimesSync(path, when, when);
  return path;
}

/** Evaluate the substitution with HOME pointed at the fixture. */
function resolved() {
  return execFileSync('sh', ['-c', `printf '%s' ${NEWEST_DOWNLOAD}`], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    // The empty-folder case makes ls complain; that is the point, not a test failure.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mtgpdf-'));
  downloads = join(home, 'Downloads');
  mkdirSync(downloads);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('NEWEST_DOWNLOAD', () => {
  it('picks the only download', () => {
    const only = download('mtg_cards.pdf', 0);
    expect(resolved()).toBe(only);
  });

  it('picks the newest across the browser\'s -N suffixes', () => {
    // Exactly the case that made a hard-coded filename wrong.
    download('mtg_cards.pdf', 0);
    download('mtg_cards-1.pdf', 60);
    const newest = download('mtg_cards-16.pdf', 120);
    download('mtg_cards-2.pdf', 90);
    expect(resolved()).toBe(newest);
  });

  it('is not fooled by the numeric ordering of the suffixes', () => {
    // mtg_cards-2.pdf sorts after -16 alphabetically but is older here.
    download('mtg_cards-16.pdf', 500);
    download('mtg_cards-2.pdf', 100);
    expect(resolved()).toBe(join(downloads, 'mtg_cards-16.pdf'));
  });

  it('ignores unrelated files in the same folder', () => {
    const ours = download('mtg_cards.pdf', 0);
    download('invoice.pdf', 999);
    download('cards.pdf', 999);
    download('mtg_cards.txt', 999);
    expect(resolved()).toBe(ours);
  });

  it('survives a space in the filename, because the expansion is quoted', () => {
    const spaced = download('mtg_cards (2).pdf', 100);
    download('mtg_cards.pdf', 0);
    expect(resolved()).toBe(spaced);
    expect(spaced).toContain(' ');
  });

  it('resolves to nothing when there is no download yet', () => {
    // lp then reports a missing operand rather than printing the wrong file.
    expect(resolved()).toBe('');
  });
});

describe('LINUX_PRINT_COMMAND', () => {
  it('ends with the substitution rather than a fixed filename', () => {
    expect(LINUX_PRINT_COMMAND.trimEnd().endsWith(NEWEST_DOWNLOAD)).toBe(true);
    expect(LINUX_PRINT_COMMAND).not.toContain('~/Downloads/mtg_cards.pdf ');
  });

  it('is one continued command, so a paste runs as a single line', () => {
    const lines = LINUX_PRINT_COMMAND.split('\n');
    expect(lines).toHaveLength(6);
    // Every line but the last ends in a backslash continuation.
    lines.slice(0, -1).forEach((line) => expect(line.endsWith('\\')).toBe(true));
    expect(lines.at(-1).endsWith('\\')).toBe(false);
  });

  it('is accepted by the shell as a whole', () => {
    // -n parses without executing, so no printer is touched.
    expect(() =>
      execFileSync('sh', ['-n', '-c', LINUX_PRINT_COMMAND], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});
