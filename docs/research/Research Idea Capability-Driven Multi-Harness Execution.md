## Research Idea: Capability-Driven Multi-Harness Execution  
## 1. The Idea  
Modern coding-agent CLIs are increasingly becoming **execution harnesses** rather than simply chat interfaces.  
Tools such as OpenCode and GitHub Copilot CLI expose capabilities through their command-line interfaces: headless execution, model selection, MCP/tool integration, conversation continuation, forking, Git integration, permissions, and so on.  
The hypothesis is:  
**Instead of choosing one AI coding harness, we can dynamically discover the capabilities of every harness installed on a machine and route individual tasks to the harness best suited to execute them.**  
The orchestration layer therefore doesn’t need to know how to perform the work itself.  
It only needs to answer:  
**“Which installed harness has the capabilities required for this task?”**  
   
⸻  
   
## 2. Core Concept  
Instead of:  
```
User
  │
  ▼
Orchestrator
  │
  ▼
OpenCode

```
Use:  
```
                    ┌─────────────────┐
                    │  Task Request   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Capability      │
                    │ Requirements    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Harness Router  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │OpenCode │    │ Copilot │    │ Future  │
         │         │    │   CLI   │    │Harness  │
         └─────────┘    └─────────┘    └─────────┘

```
The router doesn’t fundamentally care whether the harness is OpenCode, Copilot, Claude, Gemini, Codex, Pi, or something else.  
It cares about **capabilities**.  
   
⸻  
   
## 3. Harness Discovery  
The first experiment should be making the system capable of discovering installed harnesses.  
For each known executable:  
```
opencode --help
copilot --help

```
The discovery process examines the CLI’s advertised commands and options.  
For example, it might detect capabilities such as:  
```
--help
--model
--continue
--fork
--prompt
--no-interactive

```
and normalize them into a capability profile:  
```
{
  "name": "opencode",
  "executable": "opencode",
  "capabilities": {
    "headless": true,
    "model-selection": true,
    "fork": true,
    "continue": true,
    "mcp": true
  }
}

```
And:  
```
{
  "name": "copilot",
  "executable": "copilot",
  "capabilities": {
    "headless": true,
    "model-selection": true,
    "mcp": true,
    "github-context": true
  }
}

```
**Key Principle**  
**Don’t hard-code capabilities where they can be discovered from the CLI.**  
   
⸻  
   
## 4. Discovery vs. Verification  
There is an important distinction.  
--help tells us:  
“This capability appears to exist.”  
It doesn’t necessarily prove:  
“This capability actually works in this environment.”  
Therefore the system could eventually have two phases.  
**Phase 1 — Discovery**  
```
harness --help
      │
      ▼
Parse CLI
      │
      ▼
Candidate capabilities

```
**Phase 2 — Verification**  
Run small capability probes:  
```
Does headless execution work?
Does MCP initialize?
Does fork work?
Can the harness operate in the current directory?

```
Result:  
```
Discovered
    │
    ▼
Verified
    │
    ▼
Registered

```
This makes the capability registry dynamic rather than based purely on documentation.  
   
⸻  
   
## 5. Capability Registry  
The resulting registry could look like:  
```
{
  "harnesses": [
    {
      "name": "opencode",
      "version": "x.y.z",
      "capabilities": [
        "headless",
        "fork",
        "continue",
        "mcp",
        "model-selection",
        "local-models"
      ]
    },
    {
      "name": "copilot",
      "version": "x.y.z",
      "capabilities": [
        "headless",
        "mcp",
        "github-context",
        "model-selection"
      ]
    }
  ]
}

```
Eventually the registry could also describe **confidence and verification state**:  
```
{
  "capability": "fork",
  "supported": true,
  "verified": true
}

```
   
⸻  
   
## 6. Tasks Declare Requirements  
Instead of saying:  
```
Run this with OpenCode.

```
a task declares:  
```
task:
  description: "Explore three alternative implementations"

  requires:
    - fork
    - headless

```
The router then evaluates the available harnesses:  
```
OpenCode
✓ fork
✓ headless

Copilot
✓ headless
✗ fork

```
Therefore:  
```
Selected harness: OpenCode

```
The user doesn’t need to know which harness was selected.  
   
⸻  
   
## 7. Harnesses Become Specialists  
This allows each harness to be used for what it does particularly well.  
For example:  
**OpenCode**  
Potentially useful for:  
* Forking exploration  
* Multiple implementation approaches  
* Local models  
* Model/provider flexibility  
* MCP  
* Long-running coding sessions  
**GitHub Copilot CLI**  
Potentially useful for:  
* GitHub-aware work  
* Repository tasks  
* Issues/PR-oriented workflows  
* Git operations  
* MCP  
* Headless automation  
Other harnesses could eventually contribute additional capabilities.  
The important idea isn’t that one harness is “better.”  
It is:  
**Different harnesses become interchangeable specialists.**  
   
⸻  
   
## 8. The Killer Experiment  
The smallest compelling demonstration would use a deliberately simple repository.  
Give the same task to two harnesses.  
**Experiment A**  
OpenCode implements the task.  
Then:  
```
OpenCode
    │
    ▼
Implementation
    │
    ▼
Copilot CLI
    │
    ▼
Review

```
**Experiment B**  
Reverse it:  
```
Copilot CLI
    │
    ▼
Implementation
    │
    ▼
OpenCode
    │
    ▼
Review

```
**Experiment C — Harness Capability Composition**  
Exploit a capability unique to one harness:  
```
                    OpenCode
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Fork A   Fork B   Fork C
              │        │        │
              └────────┼────────┘
                       ▼
                Candidate solutions
                       │
                       ▼
                 Copilot CLI
                       │
                       ▼
                    Review
                       │
                       ▼
                Selected solution

```
This demonstrates something more interesting than simply running two agents.  
It demonstrates **composition of harness capabilities**.  
   
⸻  
   
## 9. The Orchestrator Doesn’t Need to Be Intelligent  
The first version doesn’t need an LLM deciding which harness to use.  
It can simply perform deterministic capability matching:  
```
Task
 │
 ▼
Required capabilities
 │
 ▼
Capability matching
 │
 ▼
Harness selection
 │
 ▼
Execute

```
For example:  
```
harnessctl run \
  --requires=headless,fork \
  "Explore three approaches to..."

```
The router evaluates:  
```
Required:
  headless ✓
  fork     ✓

Available:

OpenCode
  headless ✓
  fork     ✓

Copilot
  headless ✓
  fork     ✗

Selected: OpenCode

```
This is deterministic, explainable, and easy to test.  
   
⸻  
   
## 10. Intelligent Routing Comes Later  
Once the basic mechanism works, an LLM could become the **planner**, rather than the executor.  
For example:  
```
                    Task
                     │
                     ▼
              Task Analyzer
                     │
              requirements
                     │
                     ▼
              Capability Router
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       OpenCode   Copilot    Claude

```
The LLM could translate:  
“Explore several radically different implementations and let me compare them.”  
into:  
```
requires:
  - fork
  - parallel-execution
  - code-analysis

```
The deterministic router then selects the appropriate harness.  
This creates a useful separation:  
**LLM decides what is needed.**  
**Router decides what can provide it.**  
**Harness performs the work.**  
   
⸻  
   
## 11. Standard Harness Adapter  
Eventually each harness could have a thin adapter:  
```
HarnessAdapter

discover()
getCapabilities()
execute()
resume()
fork()
cancel()
getOutput()

```
But every harness does **not** need to implement everything.  
Capabilities are optional.  
```
OpenCode Adapter
 ├── execute()
 ├── fork()
 ├── resume()
 └── discover()

Copilot Adapter
 ├── execute()
 ├── resume()
 └── discover()

```
The orchestration layer only invokes operations that the capability registry says are available.  
   
⸻  
   
## 12. Potential CLI  
The eventual user experience could be extremely simple.  
**Discover**  
```
harnessctl discover

```
Output:  
```
Harness Discovery

✓ opencode  vX.Y
  headless
  fork
  continue
  mcp
  model-selection

✓ copilot  vX.Y
  headless
  mcp
  github-context
  model-selection

2 harnesses discovered
11 capabilities discovered

```
**Inspect**  
```
harnessctl capabilities

```
**Execute**  
```
harnessctl run \
  --requires fork \
  "Explore three possible architectures for this feature"

```
**Explain Selection**  
```
harnessctl explain

```
Output:  
```
Task requires:

  fork ✓
  headless ✓
  repository-access ✓

Candidates:

  OpenCode  3/3
  Copilot   2/3

Selected: OpenCode

Reason: highest capability match

```
   
⸻  
   
## 13. Why This Is Interesting  
The deeper idea is that **the CLI itself becomes the contract**.  
Instead of building integrations based on assumptions such as:  
“OpenCode supports X.”  
the system asks the installed executable:  
**“What do you currently expose?”**  
This is particularly interesting because these tools are evolving extremely quickly.  
A new version might introduce a capability such as:  
```
--fork

```
and suddenly the harness becomes eligible for an entire class of workflows.  
The orchestration layer doesn’t necessarily need to be updated.  
   
⸻  
   
## 14. Research Questions  
**RQ1 — Capability Discovery**  
Can useful harness capabilities be reliably inferred from CLI help output?  
**RQ2 — Capability Normalization**  
Can fundamentally different CLI interfaces be represented through a common capability vocabulary?  
**RQ3 — Capability Verification**  
Can lightweight probes determine whether advertised capabilities are actually usable?  
**RQ4 — Dynamic Routing**  
Can tasks be routed to the most appropriate harness without coupling workflows to a specific vendor?  
**RQ5 — Composability**  
Does combining specialized harness capabilities produce better workflows than using a single harness?  
**RQ6 — Resilience**  
Can a workflow automatically fall back to another harness when the preferred harness is unavailable?  
   
⸻  
   
## 15. Proposed Architecture  
```
                 ┌─────────────────────────┐
                 │    Human / Workflow     │
                 └────────────┬────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │     Task Description    │
                 └────────────┬────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │   Capability Planner    │
                 └────────────┬────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │    Harness Registry     │
                 └────────────┬────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
      OpenCode             Copilot             Future
      ────────             ───────              ──────
      fork                 GitHub               Claude
      local                MCP                  Gemini
      MCP                  agents               Codex
      etc.                 etc.                 etc.

```
   
⸻  
   
## 16. Initial Proof of Concept  
Keep the first implementation deliberately small.  
**Milestone 1 — Discovery**  
Install:  
* OpenCode  
* GitHub Copilot CLI  
Build:  
```
harnessctl discover

```
Have it:  
1. Locate installed executables.  
2. Run their --help.  
3. Parse the available commands/options.  
4. Normalize discovered capabilities.  
5. Store the result in a local registry.  
**Milestone 2 — Routing**  
Implement:  
```
harnessctl run --requires=fork "..."

```
The system selects the appropriate harness based on the discovered capabilities.  
**Milestone 3 — Verification**  
Add tiny probes to validate important capabilities.  
**Milestone 4 — Composition**  
Demonstrate:  
```
OpenCode
   ↓
implementation
   ↓
Copilot
   ↓
review

```
and:  
```
OpenCode
   ↓
fork
 ┌─┴─┐
 A   B
 └─┬─┘
   ↓
Copilot
   ↓
review

```
   
⸻  
   
## 17. The Central Hypothesis  
The entire experiment can be summarized as:  
**Agents are not necessarily the unit of orchestration. Capabilities are.**  
Today’s AI development environment increasingly consists of many powerful harnesses, each with different strengths.  
Rather than forcing developers to choose one, a lightweight capability layer could allow those harnesses to become **composable execution primitives**.  
The interesting question isn’t:  
*“Which coding agent is best?”*  
It is:  
**“Can we dynamically compose the best capabilities of the coding agents already installed on a machine?”**  
That is the theory this prototype would test.  
