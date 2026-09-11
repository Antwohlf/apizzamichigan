# Website deployment

The existing Vercel project `apizzamichigan` deploys this repository's `main`
branch to https://www.apizzamichigan.com, including TacoBoutMichigan at `/tacos`.
Source branches can still produce Vercel previews. The separate data pipeline
has its own repository and runtime; a website deployment does not restart it.

## GitHub Pages is a separate target

`gh-pages` contains already-built static assets and remains the source for the
legacy GitHub Pages site. Do not merge it into `main` or delete it as a cleanup
step. It does not contain the dependencies needed for a React source build.

Vercel's project-level **Ignored Build Step** must be:

```sh
[ "$VERCEL_GIT_COMMIT_REF" = "gh-pages" ]
```

Keep **Automatically Expose System Environment Variables** enabled. This
command skips only `gh-pages`; `main`, other source branches, and builds without
a branch value continue. Vercel uses exit 0 to skip and exit 1 to build.

The same command is versioned in `vercel.json` and tested by `npm run test:ops`.
The project-level setting is essential: putting it only on `main` would not
protect the independent `gh-pages` branch. It needs no script or dependencies
from that artifact branch. See Vercel's [Ignored Build Step documentation](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel).

## After the September 2026 history cleanup

Use a fresh clone of the existing repository for new work. Do not merge or
force-push from a checkout containing the old history. Preserve uncommitted work
privately and transfer only reviewed changes onto the cleaned `main`.

Repository publication is separate from deploying the website. The outstanding
privacy and licensing decisions are tracked in [PUBLIC_RELEASE.md](PUBLIC_RELEASE.md).
