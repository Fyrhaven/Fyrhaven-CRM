// The release preflight: `manifest.json` is the single source of truth, so the
// top CHANGELOG.md entry and package.json must agree with it before the release
// script tags anything. Guards the "shipped the code, forgot the version" bug.
import { describe, expect, it } from 'vitest';
import { checkRelease, releaseNotes, topChangelogVersion } from '../scripts/release-lib.mjs';

const changelog = [
  '# Changelog',
  '',
  '## [1.9.0] — 2026-10-22',
  '',
  '### Added',
  '',
  '- Company profiles.',
  '',
  '## [1.8.0] — 2026-10-22',
  '',
  '### Added',
  '',
  '- Activity tracking.',
  '',
].join('\n');

describe('topChangelogVersion', () => {
  it('reads the newest version heading', () => {
    expect(topChangelogVersion(changelog)).toBe('1.9.0');
  });

  it('is empty when there is no version heading', () => {
    expect(topChangelogVersion('# Changelog\n\nNothing here.')).toBe('');
  });
});

describe('releaseNotes', () => {
  it('returns the section body for a version, without the heading', () => {
    expect(releaseNotes(changelog, '1.9.0')).toBe('### Added\n\n- Company profiles.');
  });

  it('stops at the next version heading', () => {
    expect(releaseNotes(changelog, '1.8.0')).toBe('### Added\n\n- Activity tracking.');
  });

  it('is empty for a version with no entry', () => {
    expect(releaseNotes(changelog, '2.0.0')).toBe('');
  });
});

describe('checkRelease', () => {
  it('passes when manifest, package and the top CHANGELOG entry agree', () => {
    expect(checkRelease({ manifestVersion: '1.9.0', packageVersion: '1.9.0', changelog })).toEqual([]);
  });

  it('flags a CHANGELOG whose top entry was not bumped to the new version', () => {
    const stale = changelog.replace('## [1.9.0] — 2026-10-22', '## [1.8.0] — 2026-10-22');
    const problems = checkRelease({ manifestVersion: '1.9.0', packageVersion: '1.9.0', changelog: stale });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('1.9.0');
    expect(problems[0]).toContain('1.8.0');
  });

  it('flags a missing CHANGELOG entry', () => {
    const problems = checkRelease({ manifestVersion: '1.9.0', packageVersion: '1.9.0', changelog: '# Changelog\n' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no `## [x.y.z]` entry');
  });

  it('flags a package.json that drifted from the manifest', () => {
    const problems = checkRelease({ manifestVersion: '1.9.0', packageVersion: '1.8.0', changelog });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('package.json');
  });
});
