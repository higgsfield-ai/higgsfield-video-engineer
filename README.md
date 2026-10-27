# Higgsfield Video Engineer

**Make short animated films where every frame is drawn by code.** The characters, the set, the movement and the
sound are all written as code. Our own renderer turns that code into pictures on your computer's graphics card.
An AI agent can run the whole process for you, from the story to the finished video.

<p align="center">
  <img src="docs/frame_S1.jpg" width="49%" alt="the felt chick in its nest at night, made from code">
  <img src="docs/frame_S6.jpg" width="49%" alt="the felt chick and the paper sun, made from code">
  <br><sub>Two frames of the example film. Everything is made from code and rendered on a MacBook (M4 Max) in about 40 seconds each.</sub>
</p>

- **Runs on your own computer.** No accounts and no cloud. Works on Mac, Windows and Linux. Renting faster
  computers online is optional.
- **Everything is our own.** No outside 3D software. Felt, paper, clay, glass, smoke, blur and soft focus all come
  from our own renderer.
- **Safe to stop and restart.** Every frame is made on its own, so you can stop a render at any time, then
  continue later or redo a single frame.
- **Made for AI agents.** One install gives an agent the renderer, the tools and the step-by-step process.

## Get started

You need: Node.js 22.12 or newer, Google Chrome, and FFmpeg (to make the final video). Python 3.11+ is optional; the example
film uses it for textures, titles and sound (packages listed in `skills/code-based-films/requirements/`).

```bash
git clone https://github.com/higgsfield-ai/higgsfield-video-engineer
cd higgsfield-video-engineer
bin/hve setup        # checks your computer and installs what's missing
bin/hve hello        # makes a test picture, hello.png, in a few seconds
```

When it runs, it prints the name of the graphics card it uses. Make sure that's your real graphics card.

Then try the example, a 20-second kids' film made of felt and paper:

```bash
bin/hve example --dry-run                       # quick check, makes nothing
bin/hve example --quality preview --encode      # small, fast version of the whole film, with title and sound effects
bin/hve example --quality final --frames 0-119  # full quality, a part at a time
```

Run `npm link` once if you want to type `hve` instead of `bin/hve`.

## Make your own film

```bash
bin/hve new my-film                  # starts a new film from a copy of the example
bin/hve film projects/my-film --dry-run
```

Then ask your AI agent to make the film. It follows these steps: story, music, shot plan, concept images,
characters and set, rough cut, look, final render, sound, review, delivery. The AI images are only a guide to
compare against. They never appear in the film.

## Install for your AI agent

The agent package includes the renderer and tools, so the agent doesn't need this whole repo:

```bash
npx skills add higgsfield-ai/higgsfield-video-engineer
bash ~/.claude/skills/code-based-films/setup.sh     # once; change the folder to match your agent
```

Works with Claude Code, Codex, Cursor, Pi and other agents. The example film stays in this repo. Its concept images and music aren't included. The agent
looks here when it needs it.

## Commands

| Command | What it does |
|---|---|
| `hve setup` | Checks your computer and installs what's missing. |
| `hve hello` | Makes a test picture. |
| `hve new <name>` | Starts a new film. |
| `hve film <folder>` | Makes the frames of a film. Add `--quality preview` or `final`, `--frames 0-119` for a part, `--encode` for the final video. |
| `hve example` | Same as `hve film`, for the example. |
| `hve render <file>` | Makes a single frame from a scene file. |
| `hve check` | Tests that the renderer works correctly on your computer. |
| `hve skill` | Installs the agent package. |

## What's in here

| Folder | What it is |
|---|---|
| `skills/code-based-films/` | The agent package: the instructions, the renderer and the tools. |
| `examples/felt-good-morning/` | The finished example film: story, characters, set, shots, sound effects and font. |
| `docs/` | Pictures for this page and test renders. |
| `bin/hve` | The `hve` command. |

## How fast it is

| Computer | Speed on the example film |
|---|---|
| Gaming PC (RTX 5090) | about 3 seconds per small frame |
| MacBook (M4 Max) | about 13 seconds per small frame, about 43 seconds per full-quality frame |
| Rented online computer (RTX 4090) | about 20 seconds per full-quality frame; four of them made the whole film in about 40 minutes |

On a laptop: stay plugged in, close other heavy apps, and make the film a part at a time.

## Optional: rent faster computers

You don't need this. For a long final render you can rent graphics cards on Runpod. You need a Runpod account
and its command-line tool. The steps are in `skills/code-based-films/references/rendering.md`. Rented computers
cost money for as long as they exist, so delete them as soon as the render is done.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Licence

MIT, see [LICENSE](LICENSE). Credits for outside methods and packages are in
`skills/code-based-films/engine/NOTICE.md`. The example uses the free font Fredoka (licence in
`examples/felt-good-morning/fonts/OFL.txt`).
