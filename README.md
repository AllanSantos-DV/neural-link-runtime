# Neural Link Runtime

Dispatcher adaptativo de hooks para agentes do VS Code Copilot. Substitui scripts de hook individuais por um dispatcher inteligente que aprende com o comportamento dos agentes.

*Adaptive hook dispatcher for VS Code Copilot agents.*

---

## O que é o Neural Link?

O Neural Link fica entre o VS Code Copilot e seus scripts de hook. Em vez de cada agente chamar hooks diretamente, o Neural Link:

- **Avalia** cada hook por evento/agente/contexto usando regras declarativas + pesos aprendidos
- **Filtra** hooks abaixo do threshold (ignora os irrelevantes)
- **Executa** apenas hooks relevantes em paralelo
- **Compõe** resultados (veto/inject/modify) em uma resposta única
- **Aprende** com os resultados para melhorar decisões futuras

## Instalação

### Via Skill Manager (recomendado)

1. Instale a extensão [Copilot Skill Manager](https://marketplace.visualstudio.com/items?itemName=allansantos-dv.copilot-skill-manager)
2. Adicione este repositório: `https://github.com/AllanSantos-DV/neural-link-runtime.git`
3. Ative o Neural Link: `Ctrl+Shift+P` → "Neural Link: Enable"

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

## Requisitos

- **Node.js >= 18** (o Node embutido do VS Code funciona automaticamente)
- **VS Code** com GitHub Copilot

## Configuração

O `neural-link.config.json` define handlers, eventos, pesos e parâmetros de aprendizado. O Skill Manager gerencia isso automaticamente — edição manual é para usuários avançados.

## Criando seu Próprio Runtime

Qualquer pessoa pode criar um runtime Neural Link customizado. O contrato mínimo:

```
seu-runtime/
├── src/index.js              ← Entry point (obrigatório)
├── src/*.js                  ← Módulos do runtime
├── package.json              ← Versão semver (obrigatório)
├── neural-link.config.json   ← Config base (obrigatório)
└── .skillmanager.json        ← { "neuralLink": { "isRuntime": true } }
```

O runtime recebe JSON via stdin (formato VS Code Copilot hooks) e responde com JSON via stdout. O Skill Manager detecta repos com `isRuntime: true` automaticamente no "Add Repository".

## Estrutura / Structure

```
src/
├── index.js          ← Entry point (stdin JSON → stdout JSON)
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
