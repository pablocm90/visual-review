# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on the shape.

## Set up

- Node 22.22 (`.tool-versions`) and pnpm 10 (`packageManager` in `package.json`).
- `git`, and `cargo` for the Rust tests: the tests build real git repos and Cargo workspaces in temporary folders and run real `git` and `cargo` on them.

```sh
pnpm install
pnpm test
```

Node runs the `.ts` sources directly by stripping their types, so there is no build step while you work. Relative imports carry their `.ts` extension, and syntax that needs compiling (enums, parameter properties) is out.

## Commands

| Command | Does |
|---|---|
| `pnpm check` | Biome: formatting and lint |
| `pnpm typecheck` | `tsc` in strict mode, with no output |
| `pnpm test` | Vitest, about 30 s. Its global setup builds the page first |
| `pnpm mutate` | Stryker mutation testing |
| `pnpm build` | `dist/`: the CLI as JS, the page as one HTML file, and the JSON schemas |
| `pnpm review <pr \| from..to>` | runs the CLI from source on this repo, or on uncommitted work with no argument |

Run `pnpm check && pnpm typecheck` before you push. CI runs those, `pnpm test` and `pnpm build` on every push.

## How it fits together

- **`src/core/`** holds the rules: the `Reader` and `Linker` ports, the config, reading both sides of a range (`read-range.ts`, `read-stacks.ts`), the diff, what an expansion draws (`visible-diff.ts`), notes, and the page's data contract (`page.ts`). It imports no adapter.
- **`src/readers/{rust,typescript,rails}/`** turn one stack of a checkout into nodes and edges, and read its test files. **`src/linkers/fetch-axum/`** draws edges across stacks. Both are listed in `src/adapters.ts`, which `src/cli.ts` hands to the core.
- **`src/git/`** wraps `git`, `gh` and the `PATH` lookup.
- **`src/viewer/`** is the page: React and ELK, bundled by Vite into one file, `dist/viewer.html`. The CLI fills that file's data slots and never runs Vite.
- **`src/test-support/`** builds the temporary repos and a fake `gh` for the tests. **`src/fixtures/`** holds captured `cargo metadata` and dependency-cruiser output.

## Adding a reader

A reader implements `Reader` (`src/core/reader.ts`, whose JSDoc is the contract):

- `name`, and `stackFields`: the config fields its stacks take, such as `boxes`.
- `roots` lists the directories where one of its stacks may be. `holds` says whether one is.
- `graph` reads one stack into nodes and edges. Node ids are part of the contract (see `GraphNode` in `src/core/graph.ts`), because notes are keyed by them.
- `isTestFile` and `readTests` say which files hold tests and how their tests read.
- `tool`, if `graph` runs a command: when that command isn't on `PATH`, the reader's stacks are skipped and the page says so.

Then add it to `src/adapters.ts` and its name to `READERS` in `src/core/config.ts`.

Test rules about stacks in general on `readStacks` with `fakeReader` and `fakeLinker` (`src/test-support/fakes.ts`). Only what needs the real reader goes through `readRange` with the real adapters (`src/test-support/read-range.ts`).

## Pull requests

- Behaviour changes come with tests, written first: the tests describe behaviour through the public functions, not their internals.
- Keep a pull request to one change, and say why in its description.
- Anything the CLI imports at runtime goes in `dependencies`. What only the page bundles (React, ELK, highlight.js) stays in `devDependencies`.
