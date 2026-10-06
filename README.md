# previsao-tempo-obras

Monitora o clima de cada obra do Sistema Fiep e avisa **automaticamente**, nos grupos comuns do WhatsApp, quando há risco de chuva. Ninguém precisa fazer nada.

**Custo zero:** previsão pelo [Open-Meteo](https://open-meteo.com/) (sem chave de API), WhatsApp pela biblioteca gratuita [Baileys](https://github.com/WhiskeySockets/Baileys), agendamento com `node-cron` dentro do próprio processo e execução contínua com PM2. Nenhum serviço pago.

## Sumário

1. [O que o sistema faz](#1-o-que-o-sistema-faz)
2. [Instalação](#2-instalação)
3. [Configuração](#3-configuração)
4. [Primeiro login por QR Code e grupos](#4-primeiro-login-por-qr-code-e-grupos)
5. [Testar antes de ligar de verdade](#5-testar-antes-de-ligar-de-verdade)
6. [Rodar com PM2](#6-rodar-com-pm2)
7. [Início automático com o sistema](#7-início-automático-com-o-sistema)
8. [Ligar e desligar o computador sozinho](#8-ligar-e-desligar-o-computador-sozinho)
9. [Logs e reconexão](#9-logs-e-reconexão)
10. [Avisos importantes](#10-avisos-importantes)
11. [Como as decisões são tomadas](#11-como-as-decisões-são-tomadas)

---

## 1. O que o sistema faz

| Quando | O que acontece |
|---|---|
| **07:00** (seg–sáb) | **Relatório diário.** Para cada obra, busca a previsão horária do dia, monta as janelas de risco (ex.: 14h–16h) e envia para todos os grupos da obra. Se houver `config/geral.json`, envia também um resumo consolidado de todas as obras. |
| **A cada 15 min, 07:00–18:00** (seg–sáb) | **Monitoramento.** (a) *Aviso de aproximação*: 1 hora antes de uma janela prevista. (b) *Chuva imprevista*: chovendo agora, ou chuva na próxima 1 hora, fora de qualquer janela prevista (com cooldown de 2 h). (c) Opcional: avisa quando a chuva para. |

### Quanta antecedência cada aviso dá

| Aviso | Antecedência |
|---|---|
| Relatório diário (07:00) | Todas as janelas do dia, até ~12 h antes |
| Aviso de aproximação | **1 hora** antes do início da janela prevista |
| Chuva imprevista (não estava no relatório) | **Até 1 hora**, com o horário estimado de início |
| Chuva imprevista já caindo | Imediato |

O ciclo de 15 min existe para garantir a hora cheia de antecedência: como as janelas começam em horas fechadas e o ciclo roda em `:00`, `:15`, `:30` e `:45`, o aviso de aproximação sai no ciclo das 13:00 para uma janela das 14:00. Mesmo que um ciclo falhe, o próximo ainda avisa (com 45 min).

Exemplos de mensagens:

```
Bom dia! Previsão para hoje na obra Escola Norte: chuva prevista entre 14h e 16h (até 3 mm/h). Você receberá um novo aviso quando o horário se aproximar.

Bom dia! Previsão para hoje na obra Escola Norte: tempo estável, sem chuva prevista no horário de obra.

Atenção obra Escola Norte: chuva prevista a partir das 14h se aproxima.

Atenção obra Escola Norte: chuva não prevista detectada a partir das 10h45.

Atenção obra Escola Norte: chuva não prevista detectada agora.
```

O robô **só envia**. Ele nunca responde nem lê o conteúdo dos grupos.

## 2. Instalação

Requisitos: **Node.js 20.12 ou superior** (recomendado o LTS mais recente) e acesso à internet.

### Windows

1. Instale o Node.js LTS: baixe em <https://nodejs.org> ou, no PowerShell:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
2. Feche e reabra o PowerShell e confira: `node --version` (deve ser `v20.12` ou maior).
3. Se o PowerShell bloquear scripts (erro de "execução de scripts desabilitada"):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
4. Instale o PM2 e as dependências do projeto:
   ```powershell
   npm install -g pm2
   cd C:\caminho\para\previsao-tempo-obras
   npm install
   ```

### Linux (Debian/Ubuntu)

```bash
# Node.js 22 LTS (qualquer versão >= 20.12 serve)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version

sudo npm install -g pm2
cd /caminho/para/previsao-tempo-obras
npm install
```

Em outras distribuições, instale o Node pelo gerenciador de pacotes ou pelo [nvm](https://github.com/nvm-sh/nvm).

## 3. Configuração

Copie o arquivo de exemplo do ambiente:

```bash
cp .env.example .env        # Windows (PowerShell): Copy-Item .env.example .env
cp config/obras.example.json config/obras.json
cp config/geral.example.json config/geral.json
```

As cidades e os IDs dos grupos ficam fora do versionamento: os arquivos `.example`
são modelos para você preencher com os seus.

### `.env`

| Variável | Valores | Efeito |
|---|---|---|
| `NOTIFICADOR` | `console` (padrão) ou `baileys` | `console` só imprime; `baileys` envia pelo WhatsApp. |
| `DRY_RUN` | `true` (padrão) ou `false` | `true` **força** o `console`, mesmo com `NOTIFICADOR=baileys`. Nada é enviado. |

> Para enviar de verdade: `NOTIFICADOR=baileys` **e** `DRY_RUN=false`. Se o `.env` não existir, o sistema roda em `console` (seguro).

Opcionais: `AUTH_DIR`, `STATE_FILE`, `LOG_DIR`, `CONEXAO_TIMEOUT_S` (veja `.env.example`).

### `config/obras.json`: obras e grupos

```json
[
  {
    "id": "escola-norte",
    "nome": "Escola Norte",
    "latitude": -25.4284,
    "longitude": -49.2733,
    "destinos": ["120363111111111111@g.us", "120363222222222222@g.us"]
  },
  {
    "id": "centro-sul",
    "nome": "Centro Sul",
    "latitude": -25.5,
    "longitude": -49.3,
    "destinos": ["120363111111111111@g.us"]
  }
]
```

- `id`: único, sem espaços. É a chave do estado; **não mude depois** que o sistema estiver rodando.
- `nome`: aparece nas mensagens.
- `latitude` / `longitude`: coordenadas da obra (clique com o botão direito no Google Maps e copie os números).
- `destinos`: **lista** de IDs de grupo. A mesma obra pode ir para vários grupos, e o mesmo grupo pode receber várias obras.

Para descobrir os IDs dos grupos, use `npm run listar-grupos` (seção 4).

### `config/geral.json`: resumo consolidado (opcional)

```json
{ "destinos": ["120363333333333333@g.us"] }
```

Esses grupos recebem, no relatório das 07:00, **uma** mensagem com o resumo de todas as obras. Com `"destinos": []` (ou sem o arquivo) nenhum resumo é enviado.

### `config/regras.json`: limiares e horários

| Campo | Padrão | Significado |
|---|---|---|
| `chuva.precipitacaoMinimaMm` | `1` | Hora com risco se o volume previsto for **≥** este valor (mm/h)... |
| `chuva.codigosChuva` | `[61,63,65,66,67,80,81,82]` | ...**ou** se a condição do tempo prevista for chuva (garoa, códigos 51–57, não conta). |
| `chuva.probabilidadeMinimaPct` | `null` | Probabilidade **ignorada** por padrão: o sistema segue o resultado previsto (volume e condição). Se quiser que ela também dispare o alerta, coloque um número (ex.: `70`). |
| `chuva.chuvaForteMm` | `5` | Chuva forte: **≥** este valor (mm/h)... |
| `chuva.codigosTempestade` | `[95, 96, 99]` | ...ou estes códigos de tempo (tempestade). Chuva forte sempre conta como risco. |
| `horarioObra` | `06:00`–`19:00` | Só este horário entra nas janelas. |
| `diasOperacao` | `[1,2,3,4,5,6]` | 0 = domingo ... 6 = sábado. Fora desses dias nenhum job envia nada. |
| `relatorioDiario.horario` | `07:00` | Horário do relatório. |
| `relatorioDiario.validoAte` | `18:00` | Relatório que ficou na fila (sem WhatsApp) é descartado depois disso. |
| `relatorioDiario.resumoIncompletoApos` | `08:00` | O resumo consolidado espera todas as obras; a partir deste horário sai mesmo com obra sem previsão. |
| `monitoramento.inicio` / `fim` | `07:00` / `18:00` | Faixa do monitoramento. |
| `monitoramento.intervaloMin` | `15` | Intervalo entre ciclos (deve dividir 60: 15, 20, 30, 60). |
| `monitoramento.antecedenciaAvisoMin` | `60` | Avisa quando faltam **≤** N min para a janela. |
| `monitoramento.ignorarAproximacaoAposRelatorioMin` | `10` | Evita aviso de aproximação colado no relatório (adia para o próximo ciclo). |
| `monitoramento.cooldownImprevistoMin` | `120` | Não repete o alerta de imprevisto antes disso. |
| `monitoramento.avisarChuvaParou` | `false` | Liga o aviso "a chuva parou". |
| `monitoramento.imprevisto.horizonteMin` | `60` | Quantos minutos à frente olha em busca de chuva não prevista. |
| `monitoramento.imprevisto.precipitacaoMinimaMmH` | `1` | Chuva "relevante" (garoa abaixo disso não alerta). |
| `monitoramento.imprevisto.toleranciaJanelaMin` | `15` | Folga nas bordas das janelas (veja seção 10). |
| `fila.validadeImprevistoMin` / `validadeChuvaParouMin` | `45` / `30` | Alertas na fila vencem depois disso. O aviso de aproximação vence no início da janela. |
| `estado.retencaoDias` | `7` | Registros mais antigos são apagados do estado. |

Os horários de agendamento (cron) são **derivados** destes campos; com o padrão ficam `0 7 * * 1-6` (relatório) e `*/15 7-18 * * 1-6` (monitoramento), sempre no fuso `America/Sao_Paulo`, independente do fuso do computador.

## 4. Primeiro login por QR Code e grupos

Use um **número dedicado** ao robô (um chip só para isso, não o WhatsApp pessoal de ninguém).

1. Instale o WhatsApp (ou WhatsApp Business) nesse número, em um celular.
2. **Adicione o número aos grupos** como participante comum: um administrador de cada grupo vai em *Dados do grupo → Adicionar participante*. O robô não precisa ser administrador. Confirme que o grupo permite que **todos os participantes enviem mensagens** (nas configurações do grupo); se estiver restrito a administradores, o envio falha.
3. No computador, rode:
   ```bash
   npm run listar-grupos
   ```
   Na primeira vez aparece um **QR Code** no terminal. No celular do robô: *WhatsApp → Aparelhos conectados → Conectar um aparelho* e aponte a câmera para o QR. A sessão fica salva em `./auth` (fora do Git), e nas próximas vezes o sistema reconecta sozinho.
4. O comando lista **nome e ID** de cada grupo:
   ```
   Grupos em que este número participa (2):

     Obra Escola Norte - Engenharia
       120363111111111111@g.us
   ```
   Copie os IDs para `destinos` em `config/obras.json` (e `config/geral.json`).

> **Nunca rode `listar-grupos`, `npm start` e o PM2 ao mesmo tempo.** Duas conexões com a mesma sessão derrubam uma à outra. Com o robô no PM2, pare-o antes: `pm2 stop previsao-tempo-obras`.

## 5. Testar antes de ligar de verdade

```bash
npm test                  # testes automáticos da lógica (node:test)
npm run simular           # roda os dois jobs com dados simulados, em DRY_RUN
npm run relatorio-agora   # dispara o relatório diário agora
npm run monitorar-agora   # dispara um ciclo de monitoramento agora
```

- **`npm run simular`** percorre três cenários (dia seco, chuva prevista, chuva imprevista), com relógio simulado. Não usa internet nem WhatsApp e não mexe em `state/` nem em `logs/`. Mostra as mensagens que seriam enviadas e um resumo no final.
- **`npm run relatorio-agora`** e **`npm run monitorar-agora`** usam a **previsão real** e as suas obras. Com `DRY_RUN=true` (padrão) só imprimem. Respeitam o estado e os dias/horários de operação; para ignorar isso e reenviar, acrescente `--forcar`:
  ```bash
  npm run relatorio-agora -- --forcar
  ```
- Para um teste real com poucas pessoas, crie um grupo de teste, coloque só ele em `destinos`, use `NOTIFICADOR=baileys` e `DRY_RUN=false`.

## 6. Rodar com PM2

```bash
pm2 start ecosystem.config.cjs   # sobe o robô
pm2 save                         # memoriza a lista de processos
pm2 status                       # confere
pm2 restart previsao-tempo-obras # reinicia (depois de mudar config/ ou .env)
pm2 stop previsao-tempo-obras    # para
```

O arquivo é `ecosystem.config.cjs` (e não `.js`) porque o projeto usa módulos ES; o PM2 carrega essa configuração com `require`. Ele sobe **uma única instância** e reinicia sozinho se o processo cair.

Mudanças em `config/*.json` ou `.env` só valem depois de `pm2 restart`.

## 7. Início automático com o sistema

O computador liga sozinho pela manhã (seção 8) e o robô precisa subir sem ninguém fazer nada. Se o boot atrasar, o sistema **recupera**: ao iniciar, se já passou das 07:00 e o relatório do dia não foi enviado, ele é enviado na hora; se já foi enviado, apenas recarrega as janelas do `state/estado.json`, sem mensagem duplicada.

### Linux (systemd)

```bash
pm2 start ecosystem.config.cjs
pm2 startup systemd      # imprime um comando "sudo env PATH=... pm2 startup systemd -u usuario --hp /home/usuario"
                         # copie e execute exatamente o comando que ele imprimir
pm2 save
```

Teste reiniciando o computador e conferindo `pm2 status`.

### Windows: opção A, Tarefa Agendada ao fazer logon (não precisa de administrador)

O PM2 não tem `pm2 startup` no Windows. Use o Agendador de Tarefas para chamar `scripts\iniciar-windows.bat`, que faz `pm2 startOrRestart` e `pm2 save`. Rode no PowerShell, **ajustando o caminho do projeto**:

```powershell
$bat = 'C:\caminho\para\previsao-tempo-obras\scripts\iniciar-windows.bat'
$action = New-ScheduledTaskAction -Execute $bat
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT1M'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'PrevisaoTempoObras' -Action $action -Trigger $trigger -Settings $settings -Force
```

O atraso de 1 minuto (`PT1M`) dá tempo para a rede subir antes do robô tentar conectar ao WhatsApp.

Para testar sem reiniciar o computador:

```powershell
pm2 delete previsao-tempo-obras          # simula o estado depois de um reinício
Start-ScheduledTask -TaskName 'PrevisaoTempoObras'
Start-Sleep 20; pm2 list                 # o robô deve aparecer "online"
(Get-ScheduledTaskInfo 'PrevisaoTempoObras').LastTaskResult   # 0 = sucesso
```

A saída do script fica em `logs\inicio-windows.log`.

> ⚠️ **Este gatilho só funciona se alguém fizer logon.** Se o computador liga sozinho às 06:40 e para na tela de senha, a tarefa nunca dispara e o robô não sobe. Para o boot sem logon, veja a opção B abaixo.

O script de início é idempotente: se o robô já estiver `online`, ele não faz nada. Por isso as duas tarefas (boot e logon) podem conviver, uma servindo de rede de segurança para a outra.

### Windows: opção B, tarefa no boot, sem logon (precisa de administrador)

Sobe o robô assim que o Windows inicia, antes de qualquer logon. Usa o modo **S4U** ("executar estando o usuário conectado ou não", *sem armazenar senha*): ninguém digita nem guarda senha em lugar nenhum.

Num PowerShell **como administrador**, na pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\criar-tarefa-boot.ps1
```

O script cria a tarefa `PrevisaoTempoObrasBoot` (gatilho *na inicialização*, 2 min de atraso para a rede subir) rodando sob a conta que o executou. Use a **mesma conta** que fez o login do WhatsApp por QR Code: o PM2 guarda a lista de processos por usuário. Para indicar outra conta ou outra pasta:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\criar-tarefa-boot.ps1 -Usuario "DOMINIO\conta" -Projeto "C:\caminho\para\previsao-tempo-obras"
```

Teste sem reiniciar:

```powershell
pm2 delete previsao-tempo-obras
Start-ScheduledTask -TaskName 'PrevisaoTempoObrasBoot'
Start-Sleep 25; pm2 list
```

**Se a conta não for administrador local** (comum em máquina de empresa, com conta de domínio), peça à TI para rodar o comando acima, ou para tornar a conta administradora local da máquina dedicada. Para conferir: `whoami /groups | findstr S-1-5-32-544` — se não aparecer nada, a conta não é administradora.

Se a tarefa for criada mas não rodar no boot (erro `0x41303`), a conta pode precisar do direito *Log on as a batch job* (`secpol.msc` → Políticas locais → Atribuição de direitos de usuário) — também com a TI.

> **Evite o logon automático** (`netplwiz` / `AutoAdminLogon`) como atalho: ele deixa a máquina destravada ao ligar e, no método clássico, grava a senha em texto puro no registro. Com conta de domínio, isso expõe a credencial corporativa. Prefira a opção B.

### Windows: opção B, pm2-installer (roda como serviço do Windows)

O [pm2-installer](https://github.com/jessety/pm2-installer) instala o PM2 como serviço, que sobe no boot, sem precisar de logon. Siga o README do projeto (baixar o repositório, abrir o PowerShell como administrador e rodar `npm run setup`). Depois, com o `pm2` do serviço, faça `pm2 start ecosystem.config.cjs` e `pm2 save`. Atenção: o serviço roda com outro usuário e outro `PM2_HOME`, então **faça o login por QR (seção 4) com o mesmo usuário** que vai executar o serviço, ou copie a pasta `auth/` depois.

## 8. Ligar e desligar o computador sozinho

O computador deve **ligar às 06:40** e **desligar às 19:10**. Desligar é fácil; **ligar sozinho exige o relógio da placa-mãe (RTC)**.

### Desligar: Windows (Agendador de Tarefas)

PowerShell como administrador:

```powershell
schtasks /Create /TN "DesligarObras" /TR "shutdown /s /f /t 60" /SC DAILY /ST 19:10 /RU SYSTEM
```

Isso desliga todos os dias às 19:10 (com aviso de 60 s). Para cancelar: `schtasks /Delete /TN "DesligarObras" /F`.

### Desligar e agendar a volta: Linux (`rtcwake`)

O `rtcwake` programa o alarme do RTC e desliga o computador em um só passo. Crie `/usr/local/bin/desligar-e-agendar.sh`:

```bash
#!/bin/bash
# Desliga agora e programa o RTC para ligar às 06:40 do próximo dia útil
dow=$(date +%u)                     # 1=segunda ... 6=sábado, 7=domingo
if [ "$dow" -eq 6 ]; then alvo="next monday 06:40"; else alvo="tomorrow 06:40"; fi
/usr/sbin/rtcwake -m off -t "$(date -d "$alvo" +%s)"
```

```bash
sudo chmod +x /usr/local/bin/desligar-e-agendar.sh
sudo crontab -e
# acrescente a linha (dispara às 19:10 de segunda a sábado):
10 19 * * 1-6 /usr/local/bin/desligar-e-agendar.sh
```

Teste antes com um intervalo curto: `sudo rtcwake -m off -s 120` desliga e liga de novo em 2 minutos. Se não ligar, veja a opção de BIOS abaixo e use `sudo rtcwake -m show` para checar o RTC.

### Ligar: opção "RTC Alarm" da BIOS (vale para Windows e Linux)

Entre na BIOS/UEFI (geralmente `Del`, `F2` ou `F10` na inicialização) e procure por **"Resume by RTC Alarm"**, **"Power On By RTC"**, **"RTC Wake"** ou **"Wake on Alarm"** (fica em *Power Management* / *APM*). Ative, escolha **Todos os dias** ("Every Day") e o horário **06:40**. Assim o computador liga sozinho mesmo que tenha sido desligado pelo Windows. Domingo o computador também liga, mas o sistema não envia nada (fora de `diasOperacao`).

- No Windows, o Agendador de Tarefas ("Ativar o computador para executar esta tarefa") só acorda de **suspensão/hibernação**, **não** de um desligamento completo. Para ligar de verdade, use a BIOS. Alternativa sem BIOS: em vez de desligar às 19:10, **hiberne** (`shutdown /h`) e crie uma tarefa às 06:40 com *Ativar o computador para executar esta tarefa*; depende do suporte do equipamento a *wake timers*.
- Ajuste o horário de ligar para um pouco **antes** do necessário (06:40 dá 20 min de folga até o relatório das 07:00 para o Windows subir, a rede conectar e o WhatsApp reconectar).
- Mantenha o relógio do computador correto (sincronização automática de horário ligada).

## 9. Logs e reconexão

### Ver os logs

Há um arquivo de log **por dia** em `logs/AAAA-MM-DD.log`, com: obra avaliada, decisão tomada, mensagens enviadas ou puladas (e o motivo) e erros.

```powershell
# Windows
Get-Content logs\2026-09-21.log -Wait -Tail 50
pm2 logs previsao-tempo-obras --lines 100
```

```bash
# Linux
tail -f logs/$(date +%F).log
pm2 logs previsao-tempo-obras --lines 100
```

A saída padrão do PM2 fica em `logs/pm2-out.log` e `logs/pm2-error.log`. Para o PM2 não deixar esses arquivos crescerem para sempre: `pm2 install pm2-logrotate`. Os arquivos diários do sistema são pequenos; apague os antigos de vez em quando.

### Conexão do WhatsApp

- **Queda de internet ou do WhatsApp:** o robô reconecta sozinho (espera crescente de 2 s até 60 s). Mensagens que precisarem sair nesse meio tempo ficam em fila e saem quando reconectar; **alertas já vencidos são descartados** (um "vai chover às 14h" às 15h não é enviado).
- **Sessão encerrada (logout):** acontece se o aparelho for desvinculado no celular ou se a sessão expirar. O log mostra `SESSÃO DO WHATSAPP ENCERRADA (logout)`, a pasta `auth/` é limpa e um novo QR Code é gerado. Para reconectar:
  ```bash
  pm2 stop previsao-tempo-obras
  npm start          # aparece o QR Code; escaneie no celular do robô
  # quando aparecer "WhatsApp conectado", pressione Ctrl+C
  pm2 start previsao-tempo-obras
  ```
  (Faça pelo terminal e não pelo `pm2 logs`, onde o prefixo de data em cada linha atrapalha a leitura do QR.)
- **"Conexão substituída":** a mesma sessão foi aberta em outro lugar (outro computador, ou `listar-grupos` rodando com o PM2 ligado). Feche a outra instância.
- Para forçar um novo login do zero: `pm2 stop previsao-tempo-obras`, apague a pasta `auth/` e siga o passo 4.

## 10. Avisos importantes

- **O celular do robô precisa se conectar à internet periodicamente.** O WhatsApp **desconecta os aparelhos vinculados após cerca de 14 dias** sem o celular principal ficar online. Mantenha o chip do robô em um celular que ligue à internet (Wi-Fi) pelo menos de vez em quando, sem deixá-lo desligado por semanas, senão o robô perde a sessão e será preciso escanear o QR de novo.
- **Baileys não é oficial.** Ele usa o protocolo do WhatsApp Web sem autorização da Meta, então existe risco de o número ser bloqueado. Por isso: use um número dedicado (nunca o pessoal), envie poucas mensagens (o sistema já espaça 3 a 8 s entre grupos diferentes) e não use o número para mais nada. Custo zero continua valendo, mas tenha um plano B (por exemplo, um segundo chip) se o número for banido.
- **Precisão do `minutely_15` no Brasil.** O Open-Meteo só tem dados reais a cada 15 min na Europa e na América do Norte; no Brasil esses valores são **interpolados** da previsão horária, e o "agora" (`current`) vem de modelo, não de um pluviômetro. O alerta de chuva imprevista é útil, mas não é tão preciso quanto o nome sugere. Por isso o sistema dá uma folga (`toleranciaJanelaMin`) nas bordas das janelas previstas, para não alertar "chuva imprevista" por causa de alguns minutos de diferença.
- **A fila de mensagens fica na memória.** Se o processo reiniciar com mensagens ainda pendentes, elas se perdem (o estado do dia, com janelas e avisos, fica em disco e sobrevive). Como os alertas têm validade curta, isso é intencional.
- A previsão é uma estimativa. O aviso apoia a decisão do engenheiro; não a substitui.

## 11. Como as decisões são tomadas

- **Hora com risco:** volume previsto ≥ 1 mm/h **ou** condição do tempo prevista de chuva (códigos 61–67 e 80–82). A probabilidade de chuva não entra (configurável). **Chuva forte:** ≥ 5 mm/h ou código de tempestade (95, 96, 99), e sempre conta como risco.
- **Janelas:** horas consecutivas com risco viram uma janela. A hora 14 cobre 14:00–15:00; risco nas horas 14 e 15 gera "entre 14h e 16h". Só entra o horário de obra (06:00–19:00).
- **Aproximação:** avisa uma vez por janela quando faltam ≤ 60 min para o início (a comparação é por intervalo, então um ciclo atrasado alguns minutos ainda avisa). Janela que já começou não gera aviso.
- **Imprevisto:** chuva relevante (≥ 1 mm/h ou tempestade) agora ou na próxima 1 hora, **fora** das janelas previstas. A mensagem traz o horário estimado de início, tirado do bloco de 15 min em que a chuva aparece. Depois de um alerta, só volta a alertar após 2 h.
- **Isolamento de falhas:** um erro em uma obra (API fora do ar, grupo inválido) é registrado no log e não interrompe as outras. O Open-Meteo é tentado 3 vezes, com espera crescente.
- **Um job por vez:** o relatório e o monitoramento disparam juntos às 07:00; o sistema os executa em sequência, com o relatório primeiro.

### Estrutura do projeto

```
config/            obras.json, regras.json, geral.json
src/regras.js      lógica pura de decisão (sem I/O, testável)
src/clima.js       Open-Meteo, com retry e backoff
src/mensagens.js   textos
src/estado.js      state/estado.json (gravação atômica, limpeza de 7 dias)
src/notificador/   console (DRY_RUN) e baileys (WhatsApp, fila, reconexão)
src/jobs/          relatorio-diario.js, monitoramento.js
src/agenda.js      cron derivado das regras e recuperação de boot atrasado
src/index.js       ponto de entrada
scripts/           simular, relatorio-agora, monitorar-agora, listar-grupos
test/              testes com node:test
```
