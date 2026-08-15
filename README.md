# Vigia de Preços

Interface gráfica (grátis, no GitHub Pages) para vigiares o preço de qualquer
produto online. Quando o preço atinge o teu alvo (ou desce abaixo dele),
recebes um alerta no Telegram.

**100% gratuito, sem servidores próprios:**
- A interface gráfica é um site estático, hospedado grátis no GitHub Pages.
- Os produtos que vigias ficam guardados num ficheiro `products.json`, dentro
  do teu próprio repositório GitHub — a interface lê/escreve esse ficheiro
  diretamente via API do GitHub (o "backend" é o próprio GitHub).
- O GitHub Actions corre periodicamente (grátis) para visitar cada URL,
  detetar o preço atual, e comparar com o teu alvo.
- Os alertas são enviados por um bot Telegram (grátis, sem limites).

---

## Como funciona, em resumo

```
[Tu, no browser]
      │  adicionas um produto (nome, URL, preço-alvo)
      ▼
[Interface em GitHub Pages] ──── escreve ────▶ [products.json no repositório]
                                                        │
                                                        ▼
                                     [GitHub Actions, a cada 4h]
                                     visita a URL, deteta o preço,
                                     compara com o alvo
                                                        │
                                        preço ≤ alvo?  │
                                                        ▼
                                              [Alerta no Telegram]
```

---

## Passo 1 — Criar o repositório

1. Cria um novo repositório no GitHub (pode ser **público** — precisas de
   público, ou de GitHub Pro/Team, para o GitHub Pages gratuito funcionar em
   repositórios privados). Ex.: `price-watcher`.
2. Faz upload de **todos** os ficheiros e pastas desta entrega para a raiz do
   repositório, mantendo a estrutura:
   ```
   price-watcher/
   ├── docs/
   │   ├── index.html
   │   ├── style.css
   │   └── app.js
   ├── .github/workflows/check_prices.yml
   ├── check_prices.py
   ├── requirements.txt
   ├── products.json
   └── README.md
   ```
   Lembra-te (do projeto anterior) que a pasta `.github` fica oculta no
   Finder do Mac — mas isso só importa no teu computador; o upload para o
   GitHub funciona à mesma. Se tiveres dificuldade a arrastar a pasta
   `.github/workflows/check_prices.yml`, cria o ficheiro diretamente no
   GitHub com "Add file → Create new file" e escreve o caminho completo,
   tal como fizeste no projeto dos bilhetes.

## Passo 2 — Ativar o GitHub Pages

1. No repositório: `Settings` → `Pages`.
2. Em "Build and deployment" → "Source", escolhe **Deploy from a branch**.
3. Em "Branch", escolhe `main` e a pasta **`/docs`**. Grava.
4. Ao fim de 1-2 minutos, o GitHub mostra o URL do teu site (algo como
   `https://o-teu-utilizador.github.io/price-watcher/`). É esse o link da
   tua interface gráfica.

## Passo 3 — Configurar os secrets do Telegram

Se já tens o bot Telegram do projeto anterior, **podes reutilizá-lo** —
não precisas de criar um novo. Basta configurar os secrets neste novo
repositório também:

1. `Settings` → `Secrets and variables` → `Actions` → `New repository secret`.
2. Cria `TELEGRAM_BOT_TOKEN` com o token do teu bot.
3. Cria `TELEGRAM_CHAT_ID` com o teu chat_id.

(Se precisares de recuperar estes valores, consulta o guia do projeto
anterior — o processo é exatamente o mesmo.)

## Passo 4 — Criar um token de acesso para a interface gráfica escrever no repositório

A interface precisa de autorização para atualizar `products.json` em teu
nome. Usa um **fine-grained personal access token**, limitado só a este
repositório:

1. No GitHub, vai a `Settings` da tua conta (não do repositório — o teu
   perfil) → `Developer settings` → `Personal access tokens` →
   `Fine-grained tokens` → `Generate new token`.
2. Nome: algo como `price-watcher-frontend`.
3. Expiration: escolhe uma data razoável (ex.: 90 dias — depois renovas).
4. Repository access: **Only select repositories** → escolhe o teu
   `price-watcher`.
5. Permissions → Repository permissions → `Contents` → **Read and write**.
6. Gera o token e **copia-o já** (só é mostrado uma vez).

⚠️ Este token só vai ficar guardado no `localStorage` do teu próprio
browser — nunca é enviado para nenhum sítio além da API oficial do GitHub.
Mesmo assim, trata-o como uma password: não o partilhes, e definiste-lhe
uma expiração por precaução.

## Passo 5 — Abrir a interface e ligar tudo

1. Abre o URL do GitHub Pages do Passo 2.
2. Clica em **"Ligação ao GitHub"**.
3. Preenche: o teu utilizador/organização GitHub, o nome do repositório
   (`price-watcher`), a branch (`main`), e cola o token do Passo 4.
4. Clica em **Guardar ligação**. Deve aparecer "Ligado ✓".
5. Adiciona o teu primeiro produto: nome, URL, preço-alvo, moeda.

## Passo 6 — Confirmar que a deteção do preço está correta

Depois do GitHub Actions correr pela primeira vez (podes forçar isso em
`Actions` → `Verificar preços` → `Run workflow`, ou esperar pelo horário
agendado), atualiza a página da interface (botão **↻ Atualizar**) e
confirma que o "preço atual" mostrado bate certo com o preço real na
página do produto.

**Se o preço vier errado, vazio, ou o produto ficar com estado "Erro":**
- Abre a página do produto no teu browser.
- Clica com o botão direito exatamente em cima do preço → **Inspecionar**.
- No painel de código que abre, o elemento destacado deve estar
  realçado — clica com o botão direito nele → **Copy** → **Copy selector**.
- Volta à interface, remove o produto e adiciona-o de novo, desta vez
  preenchendo o campo "Seletor CSS (opcional)" nas opções avançadas com o
  valor copiado.

Isto acontece porque cada loja organiza a página de forma diferente — não
há uma forma universal de "adivinhar" onde está o preço em qualquer site.
O seletor manual resolve isto de forma definitiva para esse produto.

---

## Limitações importantes (para geres expectativas)

- **Nem todos os sites deixam.** Alguns têm proteções anti-robô
  (Cloudflare, CAPTCHAs) que bloqueiam browsers automatizados — nesses
  casos a deteção pode simplesmente falhar, sem forma de contornar
  gratuitamente.
- **Frequência de verificação**: por omissão, a cada 4 horas (ajustável no
  ficheiro `.github/workflows/check_prices.yml`, na linha do `cron`). Não
  convém baixares muito este intervalo — além do limite gratuito de
  minutos do GitHub Actions, verificar demasiado depressa o mesmo site
  pode ser visto como abuso.
- **Respeita os termos de uso de cada site.** Este tipo de verificação
  pessoal e pouco frequente é geralmente aceitável, mas alguns sites
  proíbem explicitamente scraping automatizado nos seus Termos de Serviço
  — a responsabilidade de cumprir isso é tua.
- **Sem conversão de moeda.** Define o preço-alvo na mesma moeda em que o
  site apresenta o preço.
- **CORS**: a interface faz pedidos diretamente do browser para
  `api.github.com`. Se em algum momento a GitHub mudar essa política e
  os pedidos começarem a falhar por CORS, avisa-me que ajusto a
  abordagem (ex.: passar a usar GitHub Actions também para aplicar as
  alterações feitas na interface, em vez do browser fazê-lo diretamente).

## Limites do plano gratuito

Idêntico ao projeto anterior: repositórios públicos têm minutos de Actions
ilimitados; privados têm 2.000 min/mês grátis. Cada verificação de um
produto demora uns segundos — mesmo com vários produtos e verificações a
cada 4h, fica muito longe desse limite. O GitHub Pages é sempre gratuito
para repositórios públicos.
