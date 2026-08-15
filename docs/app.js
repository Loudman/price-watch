// Vigia de Preços — frontend estático
// Lê e escreve directamente o ficheiro products.json no repositório GitHub,
// através da API REST do GitHub, a partir do browser. Não há servidor próprio:
// o "backend" é o próprio repositório + o GitHub Actions que já lá está configurado.

const LS_KEYS = {
  owner: "pw_owner",
  repo: "pw_repo",
  branch: "pw_branch",
  token: "pw_token",
};

const CURRENCY_SYMBOL = { EUR: "€", USD: "$", GBP: "£", BRL: "R$" };

let currentSha = null; // sha do products.json, necessário para o GitHub aceitar updates
let currentProducts = [];

// ---------- utilidades ----------

function getConfig() {
  return {
    owner: localStorage.getItem(LS_KEYS.owner) || "",
    repo: localStorage.getItem(LS_KEYS.repo) || "",
    branch: localStorage.getItem(LS_KEYS.branch) || "main",
    token: localStorage.getItem(LS_KEYS.token) || "",
  };
}

function configIsComplete(cfg) {
  return cfg.owner && cfg.repo && cfg.token;
}

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode("0x" + p1)));
}

function b64DecodeUnicode(str) {
  return decodeURIComponent(
    atob(str)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
}

function formatPrice(value, currency) {
  if (value === null || value === undefined) return "—";
  const symbol = CURRENCY_SYMBOL[currency] || currency || "";
  return `${symbol}${Number(value).toFixed(2)}`;
}

function relativeTime(isoString) {
  if (!isoString) return "ainda não verificado";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

function statusInfo(product) {
  switch (product.status) {
    case "no_alvo":
      return { dot: "hit", badge: "hit", label: "No alvo!" };
    case "acima_do_alvo":
      return { dot: "watching", badge: "watching", label: "A vigiar" };
    case "erro":
    case "error":
      return { dot: "error", badge: "error", label: "Erro" };
    case "sem_alvo":
      return { dot: "watching", badge: "pending", label: "Sem alvo definido" };
    default:
      return { dot: "watching", badge: "pending", label: "A aguardar 1ª verificação" };
  }
}

// ---------- API GitHub ----------

async function githubRequest(path, options = {}) {
  const cfg = getConfig();
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  return resp;
}

async function fetchProducts() {
  const cfg = getConfig();
  if (!configIsComplete(cfg)) {
    setSettingsStatus("Preenche a ligação ao GitHub para começar.", true);
    document.getElementById("panel-settings").classList.remove("hidden");
    return;
  }
  setSettingsStatus("A ligar ao repositório…");
  try {
    const resp = await githubRequest(`/contents/products.json?ref=${encodeURIComponent(cfg.branch)}`);
    if (resp.status === 404) {
      // Ficheiro ainda não existe — trata como lista vazia, sha fica null (cria no 1º save)
      currentSha = null;
      currentProducts = [];
      renderProducts();
      setSettingsStatus("Ligado. (products.json ainda não existe — será criado ao adicionares o 1º produto.)");
      return;
    }
    if (!resp.ok) {
      const body = await resp.text();
      setSettingsStatus(`Erro ao ler o repositório (${resp.status}). Confirma o token e as permissões.`, true);
      console.error(body);
      return;
    }
    const data = await resp.json();
    currentSha = data.sha;
    const jsonText = b64DecodeUnicode(data.content.replace(/\n/g, ""));
    currentProducts = JSON.parse(jsonText);
    renderProducts();
    setSettingsStatus("Ligado ✓");
  } catch (e) {
    console.error(e);
    setSettingsStatus("Falha de ligação — vê a consola do browser para detalhes.", true);
  }
}

async function saveProducts(commitMessage) {
  const cfg = getConfig();
  if (!configIsComplete(cfg)) {
    alert("Configura primeiro a ligação ao GitHub (botão 'Ligação ao GitHub').");
    return false;
  }
  const body = {
    message: commitMessage,
    content: b64EncodeUnicode(JSON.stringify(currentProducts, null, 2)),
    branch: cfg.branch,
  };
  if (currentSha) body.sha = currentSha;

  const resp = await githubRequest("/contents/products.json", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(errText);
    alert(`Não foi possível guardar no GitHub (erro ${resp.status}). Vê a consola para detalhes.`);
    return false;
  }
  const data = await resp.json();
  currentSha = data.content.sha;
  return true;
}

// ---------- UI ----------

function setSettingsStatus(text, isError = false) {
  const el = document.getElementById("settings-status");
  el.textContent = text;
  el.style.color = isError ? "var(--warn)" : "var(--signal)";
}

function renderProducts() {
  const list = document.getElementById("product-list");
  const empty = document.getElementById("empty-state");
  const countBadge = document.getElementById("count-badge");

  countBadge.textContent = currentProducts.length;
  list.innerHTML = "";

  if (currentProducts.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  currentProducts.forEach((product) => {
    const info = statusInfo(product);
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="pd-beacon"><span class="pd-dot ${info.dot}"></span></div>
      <div class="pd-info">
        <p class="pd-name">${escapeHtml(product.name || "(sem nome)")}</p>
        <a class="pd-url" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">${escapeHtml(product.url)}</a>
        <div class="pd-meta">
          Verificado ${relativeTime(product.last_checked)}
          ${product.last_price_method ? ` · ${escapeHtml(product.last_price_method)}` : ""}
          <span class="badge ${info.badge}">${info.label}</span>
        </div>
        ${product.status === "erro" || product.status === "error"
          ? `<div class="pd-meta" style="color:var(--warn)">${escapeHtml(product.last_error || "")}</div>`
          : ""}
      </div>
      <div class="pd-prices">
        <div class="pd-current ${product.status === "no_alvo" ? "hit" : ""}">${formatPrice(product.last_price, product.currency)}</div>
        <div class="pd-target">alvo: ${formatPrice(product.target_price, product.currency)}</div>
      </div>
      <div class="pd-actions">
        <button class="icon-btn" data-action="remove" data-id="${product.id}" title="Remover">Remover</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", () => removeProduct(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function removeProduct(id) {
  const product = currentProducts.find((p) => p.id === id);
  if (!product) return;
  if (!confirm(`Remover "${product.name}" da vigia?`)) return;
  currentProducts = currentProducts.filter((p) => p.id !== id);
  renderProducts();
  await saveProducts(`Remove produto: ${product.name}`);
}

async function addProduct(e) {
  e.preventDefault();
  const name = document.getElementById("f-name").value.trim();
  const url = document.getElementById("f-url").value.trim();
  const target = parseFloat(document.getElementById("f-target").value);
  const currency = document.getElementById("f-currency").value;
  const selector = document.getElementById("f-selector").value.trim();

  const product = {
    id: crypto.randomUUID(),
    name,
    url,
    target_price: isNaN(target) ? null : target,
    currency,
    css_selector: selector,
    last_price: null,
    last_price_method: "",
    last_checked: null,
    status: "pendente",
    last_error: "",
    notified_below_target: false,
  };

  currentProducts.push(product);
  renderProducts();

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "A guardar…";
  const ok = await saveProducts(`Adiciona produto: ${name}`);
  btn.disabled = false;
  btn.textContent = "Adicionar à vigia";

  if (ok) {
    e.target.reset();
  }
}

// ---------- arranque ----------

function loadSettingsIntoForm() {
  const cfg = getConfig();
  document.getElementById("cfg-owner").value = cfg.owner;
  document.getElementById("cfg-repo").value = cfg.repo;
  document.getElementById("cfg-branch").value = cfg.branch;
  document.getElementById("cfg-token").value = cfg.token;
}

function saveSettingsFromForm() {
  localStorage.setItem(LS_KEYS.owner, document.getElementById("cfg-owner").value.trim());
  localStorage.setItem(LS_KEYS.repo, document.getElementById("cfg-repo").value.trim());
  localStorage.setItem(LS_KEYS.branch, document.getElementById("cfg-branch").value.trim() || "main");
  localStorage.setItem(LS_KEYS.token, document.getElementById("cfg-token").value.trim());
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettingsIntoForm();

  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("panel-settings").classList.toggle("hidden");
  });

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    saveSettingsFromForm();
    await fetchProducts();
  });

  document.getElementById("btn-refresh").addEventListener("click", fetchProducts);
  document.getElementById("form-add").addEventListener("submit", addProduct);

  const cfg = getConfig();
  if (configIsComplete(cfg)) {
    fetchProducts();
  } else {
    document.getElementById("panel-settings").classList.remove("hidden");
  }
});
