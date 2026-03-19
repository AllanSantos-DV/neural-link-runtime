# Neural Link Runtime

Adaptive hook dispatcher for VS Code Copilot agents. Replaces individual hook scripts with a single intelligent dispatcher that learns from agent behavior.

## What is Neural Link?

Neural Link sits between VS Code Copilot and your hook scripts. Instead of each agent calling hooks directly, Neural Link:

- **Scores** each hook per event/agent/context using declarative rules + learned weights
- **Filters** hooks below threshold (skip irrelevant ones)
- **Executes** only relevant hooks in parallel
- **Composes** results (veto/inject/modify) into a single response
- **Learns** from outcomes to improve future decisions

## Installation

### Via Skill Manager (recommended)

1. Install the [Copilot Skill Manager](https://marketplace.visualstudio.com/items?itemName=allansantos-dv.copilot-skill-manager) extension
2. Add this repository: `https://github.com/AllanSantos-DV/neural-link-runtime.git`
3. Enable Neural Link: `Ctrl+Shift+P` → "Neural Link: Enable"

### Manual

```bash
# Clone
git clone https://github.com/AllanSantos-DV/neural-link-runtime.git

# Install
cd neural-link-runtime
# Windows
powershell ./install.ps1
# Unix
bash ./install.sh
```

## Requirements

- **Node.js >= 18** (VS Code's bundled Node works automatically)
- **VS Code** with GitHub Copilot

## Configuration

The `neural-link.config.json` defines handlers, events, weights, and learning parameters. The Skill Manager manages this automatically — manual editing is for advanced users.

## Structure

```
src/
├── index.js          ← Entry point (reads stdin JSON, outputs JSON)
├── dispatcher.js     ← Pipeline orchestrator
├── sensor.js         ← Context extraction from VS Code stdin
├── scoring.js        ← Declarative + learned scoring
├── executor.js       ← Parallel hook execution with timeouts
├── compositor.js     ← Result merging (veto/inject/modify)
├── learner.js        ← Online Linear Regression with per-workspace weights
├── features.js       ← Feature extraction + FNV-1a hashing
├── feedback.js       ← Reward derivation + false negative detection
├── session-tracker.js ← Override detection for feedback loop
├── transcript.js     ← VS Code transcript parsing
├── llm-evaluator.js  ← LLM fallback for inconclusive scores
├── logger.js         ← JSONL fire-and-forget logging
├── config.js         ← Config loading with cache
└── cli.js            ← Management CLI (stats, explain, reset, rollback)
bin/
├── neural-link.ps1   ← Windows entry point
└── neural-link.sh    ← Unix entry point
```

## License

MIT
