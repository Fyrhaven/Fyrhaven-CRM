// Pure planning for `ship.mjs`: which open pull requests can be merged into
// `main`, and in what order, so a stacked PR is only merged after the PR it is
// based on. No git, no `gh`, no I/O — the script does all of that.

/**
 * Order open pull requests for merging into `main`.
 *
 * A PR is ready when its base branch has already landed on `main`: either it is
 * `main` itself, one of the branches passed in `onMain`, or the head branch of
 * another PR in the same batch that is being merged first. A stacked PR
 * (`base` = another feature branch) is retargeted to `main` at merge time,
 * which is safe because by then `main` already contains that base.
 *
 * @param {Array<{number:number,baseRefName:string,headRefName:string}>} prs
 * @param {string[]} onMain branch names already contained in `main`
 * @returns {{ready:Array<{number:number,head:string,retarget:boolean}>,
 *            blocked:Array<{number:number,head:string,base:string}>}}
 *   `ready` is in the order the PRs must be merged; `blocked` are the PRs whose
 *   base is neither on `main` nor the head of another open PR in the batch.
 */
export function planShip(prs, onMain = ['main']) {
  const landed = new Set(onMain);
  const list = (Array.isArray(prs) ? prs : [])
    .filter((pr) => pr && pr.number != null && pr.baseRefName && pr.headRefName)
    .map((pr) => ({ number: pr.number, base: pr.baseRefName, head: pr.headRefName }));

  const remaining = new Map(list.map((pr) => [pr.head, pr]));
  const ready = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [head, pr] of [...remaining]) {
      if (!landed.has(pr.base)) continue;
      ready.push({ number: pr.number, head, retarget: pr.base !== 'main' });
      landed.add(head);
      remaining.delete(head);
      progressed = true;
    }
  }
  const blocked = [...remaining.values()].map((pr) => ({ number: pr.number, head: pr.head, base: pr.base }));
  return { ready, blocked };
}
