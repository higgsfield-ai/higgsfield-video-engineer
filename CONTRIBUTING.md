# Contributing

Thanks for helping. This page covers how to set up, what to check before you send a change, and the few rules
that keep the project what it is.

## Set up

```bash
git clone https://github.com/higgsfield-ai/higgsfield-video-engineer
cd higgsfield-video-engineer
bin/hve setup
bin/hve hello
```

If `hello.png` looks right and the printed graphics card is your real one, you're ready.

## Where things live

| You want to change | Look in |
|---|---|
| The renderer (materials, lights, speed, fixes) | `skills/code-based-films/engine/` and its `README.md` |
| Tools (music timing, video encode, rented computers) | `skills/code-based-films/tools/` |
| How the AI agent makes a film | `skills/code-based-films/SKILL.md` and `references/` |
| The example film | `examples/felt-good-morning/` |
| The `hve` command | `bin/hve` |

## Before you send a change

Run these and make sure they pass:

```bash
bin/hve hello                  # the test picture still renders
bin/hve example --dry-run      # the example film still builds
bin/hve check                  # the renderer check, if you touched the engine
```

- If you changed how something looks, add a before and after picture to your pull request.
- If you changed a command, an option or a file path, update the docs that mention it: `README.md`, `SKILL.md`,
  the `references/` pages and the engine `README.md`.
- If you added a material setting, update it in both `engine/src/pack.mjs` and `engine/web/pt.wgsl`. They must match.
- Tell us which computer you tested on (Mac, Windows or Ubuntu, and the graphics card).

## Rules

1. **Our own code only.** No outside 3D software, downloaded models, textures, motion capture or stock footage.
2. **AI images are only a guide.** Concept images can be used to compare against, but never in the film itself.
3. **Same frame number, same picture.** Anything random must use a fixed seed, so any frame can be redone alone.
4. **No secrets in files.** API keys and passwords come from environment variables, never from the repo.
5. **Only free-to-use music and fonts**, with their licence file next to them.
6. **Keep the agent package small.** Big files (example film, test pictures) go outside `skills/`, because
   everything in `skills/code-based-films/` is downloaded with every install.

## Commits and pull requests

- One change per pull request. Small is better.
- Write commit messages like `fix(engine): stop glass going black` or `docs: explain preview quality`. The first
  word is the kind of change: `feat`, `fix`, `docs`, `refactor`, `perf`, `test` or `chore`.

## Reporting a problem

For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue. Otherwise, open an issue with:

- your system and graphics card
- the command you ran
- the full output, including the `adapter: {...}` line
- a picture, if the problem is how something looks

## Licence

By contributing, you agree that your work is shared under the [MIT licence](LICENSE).
