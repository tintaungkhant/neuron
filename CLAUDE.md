# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Greenfield project. Currently a default NestJS 11 scaffold — `AppController` / `AppService` are placeholders. The intended domain (per the repo name) is an AI workflow engine, but no engine code exists yet. When adding new domain code, create dedicated Nest modules under `src/` rather than extending the placeholder `AppModule` directly.

Note: package name is `ai-worflow-engine` (missing the `k`). Don't "fix" it without checking — it may already be referenced elsewhere.

## Commands

Package manager is **pnpm** (lockfile + `pnpm-workspace.yaml` present). Do not use `npm` or `yarn`.

```bash
pnpm install              # install deps
pnpm start:dev            # watch-mode dev server (default port 3000, override via PORT)
pnpm build                # nest build → dist/
pnpm start:prod           # run compiled dist/main.js

pnpm lint                 # eslint --fix on src, apps, libs, test
pnpm format               # prettier write src + test

pnpm test                 # jest, unit specs (*.spec.ts co-located in src/)
pnpm test -- <pattern>    # run a single file or name pattern, e.g. pnpm test -- app.controller
pnpm test:watch
pnpm test:cov
pnpm test:e2e             # uses test/jest-e2e.json (rootDir = ./test, *.e2e-spec.ts)
```

Jest unit config lives inline in `package.json` (rootDir = `src`, regex = `.*\.spec\.ts$`). E2E config is `test/jest-e2e.json`. They are separate runners — `pnpm test` does NOT pick up e2e specs.

## Architecture notes

- Entry: `src/main.ts` bootstraps `AppModule` via `NestFactory.create` and listens on `process.env.PORT ?? 3000`. No global pipes, filters, or interceptors are wired yet — add them here when introduced.
- TypeScript paths/aliases are not configured beyond defaults; `tsconfig.build.json` excludes tests from production builds.
- ESLint flat config (`eslint.config.mjs`) uses `typescript-eslint` + Prettier; lint is `--fix` by default, so running it will modify files.
