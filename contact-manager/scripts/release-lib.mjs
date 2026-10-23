// Pure helpers shared by the release script and its tests. No side effects, no
// git and no `gh` here — `release.mjs` does the I/O and the shelling out.
//
// The version in `manifest.json` is the single source of truth (see the
// README's changelog policy): the top `## [x.y.z]` entry of `CHANGELOG.md` must
// match it, and so must `package.json`.

/** The version of the first `## [x.y.z]` heading in a changelog, or ''. */
export function topChangelogVersion(changelog) {
  const match = /^##\s*\[([^\]]+)\]/m.exec(String(changelog ?? ''));
  return match ? match[1].trim() : '';
}

/**
 * The `CHANGELOG.md` section body for one version, without the heading itself
 * and without the sections that follow it. `''` when the version has no entry.
 */
export function releaseNotes(changelog, version) {
  const text = String(changelog ?? '');
  const marker = `## [${version}]`;
  const start = text.indexOf(marker);
  if (start === -1) return '';
  const headingEnd = text.indexOf('\n', start);
  if (headingEnd === -1) return '';
  const rest = text.slice(headingEnd + 1);
  const end = rest.search(/^## \[/m);
  return rest.slice(0, end === -1 ? undefined : end).trim();
}

/**
 * Everything that must hold before `manifest.version` may be released. Returns
 * a list of human-readable problems; an empty list means the release is
 * well-formed. This is the guard that catches a commit which bumps the code but
 * forgets to bump the version.
 */
export function checkRelease({ manifestVersion, packageVersion, changelog }) {
  const problems = [];
  const top = topChangelogVersion(changelog);
  if (!top) {
    problems.push('CHANGELOG.md has no `## [x.y.z]` entry.');
  } else if (top !== manifestVersion) {
    problems.push(
      `The top CHANGELOG.md entry is ${top} but manifest.json is ${manifestVersion}. ` +
      'Add the matching entry before releasing.',
    );
  }
  if (packageVersion && packageVersion !== manifestVersion) {
    problems.push(`package.json is ${packageVersion} but manifest.json is ${manifestVersion}.`);
  }
  return problems;
}
