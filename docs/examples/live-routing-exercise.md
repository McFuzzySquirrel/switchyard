# Live Routing Exercise

This exercise demonstrates the complete Switchyard path with two live provider
CLIs:

1. Discover installed providers and their normalized capabilities.
2. Route an implementation prompt to OpenCode.
3. Apply the change in a disposable workspace.
4. Route an independent review prompt to GitHub Copilot.

The exercise uses Switchyard's native adapters. It does not use a MyForge
adapter or the workflow engine.

## Prerequisites

- Node.js 24 or newer
- OpenCode installed and authenticated
- GitHub Copilot CLI installed and authenticated
- A checkout of this repository with dependencies installed

The live providers may incur model usage or other provider costs. The prompts
are intentionally narrow and the workspace is disposable.

## Run the exercise

From the repository root:

```sh
./examples/live-routing-exercise.sh
```

The script creates a temporary workspace containing one `score.js` file. It
does not modify the repository checkout. It exits nonzero when either provider
is missing, unavailable, fails to execute, or does not produce the expected
result.

## Terminal recording

The live run has been captured as terminal-style media:

![Live routing exercise terminal recording](media/live-routing-exercise.gif)

- [Download the MP4 recording](media/live-routing-exercise.mp4)
- [Replay the exercise](../../examples/live-routing-exercise.sh)

To regenerate both demo recordings locally, use:

```sh
./examples/record-terminal-demos.sh
```

The recorder requires `script`, `ffmpeg`, Python 3 with Pillow, and the live
provider prerequisites. Raw captures and temporary frames are not retained.

## Recorded run

The following run was completed with the live installed CLIs:

| Stage | Provider selected by Switchyard | Result |
| --- | --- | --- |
| Discovery | OpenCode `1.18.28`, GitHub Copilot `1.0.83` | Both available |
| Implementation | OpenCode | Succeeded |
| Review | GitHub Copilot | Succeeded; no findings |

Discovery reported `headless` for both providers, so the scripted replay used
the same explicit requirement while pinning a different preferred harness for
each stage:

```sh
npm run --silent switchyard -- prompt \
  --registry "$REGISTRY" \
  --requires=headless \
  --preferred-harness=opencode \
  --cwd "$DISPOSABLE_WORKSPACE" \
  --timeout-ms 180000 \
  "Improve score.js by validating finite numeric inputs."
```

```sh
npm run --silent switchyard -- prompt \
  --registry "$REGISTRY" \
  --requires=headless \
  --preferred-harness=copilot \
  --cwd "$DISPOSABLE_WORKSPACE" \
  --timeout-ms 180000 \
  "Review score.js without modifying files."
```

The implementation provider changed only `score.js`:

```js
export function average(values) {
  if (values.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (!(index in values) || !Number.isFinite(values[index])) {
      throw new TypeError("average expects every value to be a finite number");
    }
    total += values[index];
  }
  return total / values.length;
}
```

The review provider reported:

> Findings:
>
> - Empty-array behavior is preserved.
> - Ordinary sparse arrays and non-finite/non-number values are rejected.
> - Two minor edge cases were noted for follow-up: inherited prototype
>   properties can satisfy `index in values`, and individually finite values
>   can overflow during summation.
>
> Verdict: Pass for the stated exercise requirements, with the two minor edge
> cases recorded for future hardening.

## What this proves

- Discovery can find both installed provider CLIs.
- Users can route without hard-coding provider details into the task itself.
- `--preferred-harness` makes the two-stage demonstration deterministic while
  capability matching remains all-required.
- `--cwd` confines provider execution to the requested disposable workspace.
- OpenCode and Copilot use separate native execution adapters behind the same
  Switchyard `prompt` command.
- JSON execution results expose the selected harness and bounded execution
  status for scripts or demonstrations.

Provider responses, model versions, and token usage can vary between runs.
Treat this transcript as a representative recorded result; use the script for a
fresh live run.
