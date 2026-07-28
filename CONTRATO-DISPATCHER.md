# CONTRATO-DISPATCHER — como falar com o `neural-link`

Contrato público de invocação do dispatcher de hooks. Quem consome (Skill Manager, Octopus,
qualquer host que reescreva hooks) programa contra **este documento**, não contra o código.

O `neural-link` é um **motor `kind: cli`**: não é daemon, não escuta porta, não tem processo para
manter vivo. Ele é **executado a cada evento de hook**, lê o evento no **stdin**, decide, escreve a
decisão no **stdout** e sai. É agnóstico ao host: não conhece VS Code, Copilot CLI nem Claude Code.

Instalação: pelo `engine-kit` a partir do `AllanSantos-DV/engine-registry`
(motor `neural-link`, artefato assinado com Ed25519 e verificado antes de instalar).

---

## 1. Como invocar

```
<runtime>/bin/neural-link.ps1      # Windows (PowerShell)
<runtime>/bin/neural-link.sh       # Linux / macOS
```

Os wrappers só canalizam o stdin para `node <runtime>/src/index.js` — invocar o `index.js`
diretamente é igualmente válido e evita uma camada de shell.

O `engine-kit` devolve o caminho pronto:

```js
import { ensureEngine } from "engine-kit";

const r = await ensureEngine("neural-link");   // kind=cli: não exige healthCheck
if (!r.available) { log(`dispatcher indisponível: ${r.reason}`); return; }  // degrade SINALIZADO

// r.bin -> <home>/runtimes/neural-link/src/index.js
```

---

## 2. Entrada (stdin, JSON)

Um objeto JSON por invocação. Limite de 50 MB. Campos desconhecidos são preservados em `raw`.

### Identificação — o que todo consumidor deve mandar

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `hook_event_name` | string | **sim** | O evento (veja a lista abaixo). Aceita também `event_type`. |
| `project` | string | **recomendado** | **Quem está registrando o hook**: o projeto/extensão consumidor (`skill-manager`, `octopus`…). Também aceito como `projectId`, ou pela variável `NEURAL_LINK_PROJECT`. |
| `agent` | string | recomendado | Qual **agente** está rodando (`implementor`, `orchestrator`…). Aceita `copilot_chat.agentName`, `agentName`, `agent_type`, ou a variável `NEURAL_LINK_AGENT`. |

> `project` e `agent` respondem perguntas diferentes e ambas importam:
> **`project` = de qual PRODUTO veio o hook. `agent` = qual AGENTE estava executando.**
> Sem `project`, todo handler registrado é indistinguível de qualquer outro na origem — é por isso
> que hoje um handler registrado roda em todos os projetos.
>
> **Validação:** máximo 64 caracteres, apenas `[a-zA-Z0-9._-]`. Fora disso vira `null` (o valor
> acaba em log, em nome de arquivo de peso e, no próximo passo, em regra de escopo — texto livre
> aqui seria travessia de caminho e poluição de log vinda de um campo que o host não controla).
>
> **Retrocompatível:** quem não manda nada continua funcionando, com `project: null`.

### Eventos aceitos

`PreToolUse` · `PostToolUse` · `SessionStart` · `PreCompact` · `Stop` · `SubagentStart` ·
`SubagentStop` · `UserPromptSubmit`

Evento fora da lista é rejeitado — o dispatcher não inventa comportamento para evento que não conhece.

### Demais campos

| Campo | Tipo | Quando | Observação |
|---|---|---|---|
| `cwd` | string | sempre | Máx. 4096 chars, sem null bytes |
| `session_id` / `sessionId` | string | sempre | |
| `timestamp` | string | sempre | ISO-8601 |
| `transcript_path` | string | opcional | Máx. 4096 chars |
| `tool_name` | string | Pre/PostToolUse | Aceita `toolCall.toolName` |
| `tool_input` | object | Pre/PostToolUse | Aceita `toolCall.input` |
| `tool_use_id` | string | Pre/PostToolUse | Aceita `toolCall.toolUseId` |
| `tool_response` | string | PostToolUse | |
| `stop_hook_active` | boolean | Stop/SubagentStop | Default `false` |
| `agent_id`, `agent_type` | string | SubagentStart/Stop | |
| `source` | string | SessionStart | |
| `prompt`, `chat_message` | string | UserPromptSubmit | Truncados em 100 KB |
| `turn_number` | number | opcional | Aceita `copilot_chat.turnNumber` |

O comando extraído de `tool_input.command` é truncado em 50 KB.

### Exemplo

```json
{
  "hook_event_name": "PreToolUse",
  "project": "skill-manager",
  "agent": "implementor",
  "cwd": "C:/Users/allan/Desktop/Projetos/meu-projeto",
  "session_id": "a1b2c3",
  "timestamp": "2026-07-28T14:31:00.000Z",
  "tool_name": "run_in_terminal",
  "tool_input": { "command": "git push --force" }
}
```

---

## 3. Saída (stdout, JSON)

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "push --force sem revisão",
    "neural_link": {
      "version": "1.0",
      "event": "PreToolUse",
      "agent": "implementor",
      "handlers_evaluated": 10,
      "handlers_triggered": ["pre-commit-guard"],
      "scores": { "pre-commit-guard": 0.95 },
      "composition": { "final": "deny", "rule": "most_restrictive" }
    }
  }
}
```

- `hookSpecificOutput` carrega a decisão no formato que o host espera:
  `permissionDecision` (`allow` | `deny` | `ask`), `permissionDecisionReason`,
  `additionalContext`, `decision`, `reason`, `content`.
- O bloco **`neural_link` está SEMPRE presente** — é a auditoria da decisão: quantos handlers foram
  avaliados, quais dispararam, com que score, e qual regra compôs o resultado
  (`most_restrictive`: se qualquer handler negou, o resultado é negar).

Variações por evento:

| Evento | Forma |
|---|---|
| `PreToolUse` | decisão vai **dentro** de `hookSpecificOutput` (sem `decision`/`reason` no topo) |
| `Stop` | `decision`/`reason` no topo **e** espelhados dentro, com `hookEventName: "Stop"` |
| `UserPromptSubmit` | os `content` dos handlers que responderam `add` são concatenados |

---

## 4. Contrato de um HANDLER

Um handler é executado como `node <script>` recebendo o mesmo JSON no stdin, e responde no stdout:

```json
{
  "decision": "allow | deny | ask | block | add",
  "reason": "texto curto",
  "hookSpecificOutput": { "additionalContext": "..." },
  "content": "só para UserPromptSubmit com decision=add"
}
```

- **Timeout** por handler: o do próprio handler → o do evento → o default (5 s).
- Saída máxima: 1 MB de stdout/stderr.
- **Fail-open**: timeout ou erro do handler vira `allow`. Um handler quebrado **não** trava o agente
  — mas isso significa que **segurança não pode depender só de um handler**.

---

## 5. Ambiente e saída do processo

| Variável | Efeito |
|---|---|
| `NEURAL_LINK_PROJECT` | valor default de `project`, quando o consumidor não manda no stdin |
| `NEURAL_LINK_AGENT` | valor default de `agent` |

**Exit code:** `0` sempre que o dispatcher concluiu (inclusive negando). Diferente de `0` indica
falha do próprio dispatcher (stdin ilegível, erro interno) — o host deve tratar como **fail-open**,
igual ao handler que estoura o tempo.

---

## 6. O que AINDA não existe (e por que está escrito aqui)

O campo `project` **já é aceito, validado e propagado** — mas o **escopo** (rodar um handler apenas
no projeto que o registrou) é o **próximo passo**. Hoje todo handler registrado roda em todos os
projetos, e os pesos aprendidos são globais.

A ordem é essa de propósito: os consumidores começam a **mandar** a identificação agora, e quando o
filtro por escopo chegar, já existe dado real para ele filtrar. O contrário — ligar o filtro antes
de alguém mandar o campo — silenciaria todos os handlers de uma vez.
