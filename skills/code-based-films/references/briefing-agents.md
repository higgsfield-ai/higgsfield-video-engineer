# Briefing sub-agents

Parallel agents speed up assets, simulations and shot polish. They also lose the film if nobody owns it. The lead
keeps story, look, music timing, the edit and acceptance; agents get narrow, verifiable tasks.

## One agent, one narrow task

Good tasks:

- Build one asset to its turnaround (`assets/<name>/`).
- Write one procedural texture set.
- Bake one simulation to a per-frame cache.
- Bring one shot to its styleframe (camera, light, set dressing), without changing its timing.
- Run one QA step (machine pass, or a fresh-eyes review with no context).

Bad tasks: "make the film", "do the second half", "improve the look everywhere", "fix whatever looks wrong".

## No overlapping files

- Assign file ownership explicitly. No two agents edit the same file.
- Shared files (`assets/lib/*`, `engine/`, `shots/film.mjs`, `shots/story.mjs`, `BEATS.md`) belong to the lead.
  An agent that needs a change in a shared file describes it in its report; the lead applies it.
- Each agent renders into its own folder (`assets/<name>/proof/`, `out/test/<shot>/`) and its own stage folder.
- Agents on one machine share one local GPU: renders run one at a time, so keep jobs short and capped with
  `--max-seconds`.

## What every brief contains

1. **Goal** in one sentence.
2. **Paths:** `$SKILL`, `$PROJECT`, the files it owns, the files it may read.
3. **Contract:** "read `references/asset-contract.md` (or `shots-and-timeline.md`) and `engine/README.md` in
   full before starting"; units, naming, determinism, local rendering with its limits (spp, `--max-seconds`, frames
   per job, one render process at a time) or the optional remote pool if the lead assigned one.
4. **Target:** the exact turnaround or styleframe file(s) and which aspects to match first (silhouette,
   proportions, key details, material, light).
5. **Constraints:** what not to change (timing, camera, shared files), the light-standard variant, IP rules.
6. **Done criteria:** the side-by-side proof (ref left, ours right, same angle), the hero frame in its styleframe
   light, an honest `GAPS.md` with no critical gaps, and a report with the paths.
7. **Budget:** how many proof rounds, how many render jobs, and to stop and report if blocked.
8. **Cleanup:** delete scratch renders and temporary images; keep only the proof set.

## Brief template

```
Goal: build <asset> to match refs/<turnaround>.png.
You own: assets/<asset>/ (build.mjs, tex/, proof/, GAPS.md). Read only: assets/lib/, engine/, refs/.
Read first: references/asset-contract.md, references/light-standard.md, engine/README.md.
Rules: our code only; refs are targets, never in frame; seeded RNG; metres, Y up, faces +Z, feet on y=0;
render locally (engine/bin/render.mjs, ≤512 spp, --max-seconds 60, ≤2 frames per job, one render at a time)
or through tools/rp only if the lead assigned remote pods.
Target order: silhouette → proportions → key details → material.
Done: proof/turn_<view>.png, proof/vs_ref_<view>.jpg, proof/hero_<shot>.png, GAPS.md with no critical gaps.
Report: paths, GAPS list, per-frame render time. Do not edit shared files; describe needed changes instead.
```

## Running agents

- Start independent tasks together; keep the lead working on integration (story, animatic, look) meanwhile.
- Review every agent result yourself against the target before using it. An agent's "done" is a claim, not proof.
- Reviewers get the code or the film, not your conclusion, so their read is not anchored on yours.
- If an agent goes off scope, stop it and re-brief narrowly rather than letting it edit shared files.
