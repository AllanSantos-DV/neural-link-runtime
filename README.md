# neural-link-runtime

> **Este repositório não é mais o canal de distribuição do Neural Link.**

O `neural-link` é um **motor agnóstico** — infraestrutura compartilhada, uma instalação por máquina,
N consumidores — e agora é distribuído pelo registro central de motores:

**→ [`AllanSantos-DV/engine-registry`](https://github.com/AllanSantos-DV/engine-registry)**

## Por que mudou

O que existia aqui era distribuição **por cópia**: um `install.ps1`/`install.sh` que copiava
arquivos de um diretório local. Sem `sha256`, sem assinatura, sem versão e sem atualização. O
resultado apareceu na prática: este repositório ficou **três versões atrás** da fonte, com um
formato de configuração **incompatível** — quem instalasse daqui quebrava a própria configuração.

No registro central a release é **verificada antes de instalar**: o `engine-kit` confere o `sha256`
**e** a assinatura **Ed25519**, e recusa qualquer artefato que não venha de quem tem a chave
privada. Atualizar deixou de ser copiar arquivo por cima.

## Como instalar agora

```js
import { ensureEngine } from "engine-kit";

const r = await ensureEngine("neural-link");   // motor kind=cli: não exige healthCheck
if (!r.available) { log(`dispatcher indisponível: ${r.reason}`); return; }

// r.bin -> ~/.copilot/neural-link/runtimes/neural-link/src/index.js
```

O update troca apenas `runtimes/neural-link/`. Seus **pesos aprendidos** (`weights/`) e **logs**
ficam fora dessa pasta e **sobrevivem** a qualquer atualização.

## Como falar com o dispatcher

O contrato de invocação — o que mandar no stdin (incluindo o campo **`project`**, que identifica
qual produto registrou o hook), o que esperar no stdout, variáveis de ambiente e exit codes — está
em **[`CONTRATO-DISPATCHER.md`](./CONTRATO-DISPATCHER.md)**, versionado junto com o artefato.

## Este repositório continua no ar

Nada aqui foi removido: quem ainda aponta para cá não quebra. Mas **não recebe versões novas** — a
v0.1.0 publicada aqui é anterior à mudança de formato da configuração e não deve ser usada. O
README antigo está em [`README.legacy.md`](./README.legacy.md).
