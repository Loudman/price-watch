#!/usr/bin/env python3
"""
Vigia de Preços — verificação periódica de preços em páginas de produto
=========================================================================

Lê `products.json`, visita cada URL com um browser headless (Playwright,
porque muitas lojas calculam o preço em JavaScript), tenta extrair o preço
atual através de várias estratégias (da mais fiável para a menos fiável),
compara com o preço-alvo definido pelo utilizador, e envia um alerta via
Telegram quando o preço está no alvo ou abaixo dele.

IMPORTANTE — LIMITAÇÕES REAIS DESTA ABORDAGEM
------------------------------------------------
Não existe uma forma 100% fiável de "adivinhar" onde está o preço em
qualquer página de qualquer loja — cada site organiza o HTML de forma
diferente. Este script tenta, por ordem:

  1. Um seletor CSS fornecido manualmente pelo utilizador (mais fiável,
     recomendado sempre que a deteção automática falhar ou errar).
  2. Dados estruturados JSON-LD (schema.org/Product) — muitas lojas
     incluem isto para SEO, e costuma ser o mais fiável dos métodos
     automáticos.
  3. Meta tags Open Graph / Product (og:price:amount, product:price:amount).
  4. Uma pesquisa por expressão regular no texto visível da página, à
     procura do primeiro valor monetário plausível — usado como último
     recurso, é o método menos fiável.

Depois de adicionares um produto, confirma sempre na interface se o
"último preço" detetado bate certo com o preço real da página. Se não
bater, define um seletor CSS manual (a interface explica como encontrá-lo).

Alguns sites bloqueiam ativamente browsers automatizados (Cloudflare,
CAPTCHAs) — nesses casos este método pode simplesmente não funcionar,
independentemente da configuração.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright
import requests

PRODUCTS_FILE = Path(__file__).parent / "products.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

CURRENCY_SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP", "R$": "BRL"}

# Regex para valores monetários no texto visível (usado só como último recurso)
MONEY_REGEX = re.compile(
    r"(?:(€|R\$|\$|£)\s?)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?:\s?(€|EUR|USD|\$|£))?"
)


def normalize_number(raw: str) -> float | None:
    """Converte '1.234,56' ou '1,234.56' ou '19.99' em float, de forma heurística."""
    raw = raw.strip()
    if not raw:
        return None
    has_comma = "," in raw
    has_dot = "." in raw
    try:
        if has_comma and has_dot:
            # O último separador encontrado é o decimal; o outro é milhar.
            if raw.rfind(",") > raw.rfind("."):
                raw = raw.replace(".", "").replace(",", ".")
            else:
                raw = raw.replace(",", "")
            return float(raw)
        if has_comma and not has_dot:
            # Só vírgula: assume-se separador decimal europeu se tiver 1-2 dígitos depois.
            parts = raw.split(",")
            if len(parts[-1]) in (1, 2):
                return float(raw.replace(",", "."))
            return float(raw.replace(",", ""))
        if has_dot and not has_comma:
            parts = raw.split(".")
            if len(parts[-1]) in (1, 2):
                return float(raw)
            return float(raw.replace(".", ""))
        return float(raw)
    except ValueError:
        return None


def extract_via_selector(page, selector: str):
    try:
        el = page.locator(selector).first
        text = el.inner_text(timeout=5000)
        match = MONEY_REGEX.search(text)
        if match:
            value = normalize_number(match.group(2))
            if value is not None:
                return value, "seletor CSS manual"
    except Exception as e:
        print(f"  [aviso] seletor CSS falhou: {e}")
    return None, None


def extract_via_jsonld(page):
    try:
        scripts = page.locator('script[type="application/ld+json"]')
        count = scripts.count()
        for i in range(count):
            raw = scripts.nth(i).inner_text(timeout=2000)
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            candidates = data if isinstance(data, list) else [data]
            # Alguns sites usam "@graph": [...]
            expanded = []
            for c in candidates:
                if isinstance(c, dict) and "@graph" in c:
                    expanded.extend(c["@graph"])
                else:
                    expanded.append(c)
            for item in expanded:
                if not isinstance(item, dict):
                    continue
                offers = item.get("offers")
                if isinstance(offers, list):
                    offers = offers[0] if offers else None
                if isinstance(offers, dict) and "price" in offers:
                    price = offers.get("price")
                    try:
                        return float(price), "JSON-LD (schema.org)"
                    except (TypeError, ValueError):
                        parsed = normalize_number(str(price))
                        if parsed is not None:
                            return parsed, "JSON-LD (schema.org)"
                if "price" in item:
                    try:
                        return float(item["price"]), "JSON-LD (schema.org)"
                    except (TypeError, ValueError):
                        pass
    except Exception as e:
        print(f"  [aviso] extração JSON-LD falhou: {e}")
    return None, None


def extract_via_meta(page):
    selectors = [
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        'meta[itemprop="price"]',
        'meta[name="price"]',
    ]
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() == 0:
                continue
            content = el.get_attribute("content")
            if content:
                value = normalize_number(content)
                if value is not None:
                    return value, f"meta tag ({sel})"
        except Exception:
            continue
    return None, None


def extract_via_regex_fallback(page):
    try:
        text = page.inner_text("body")
        matches = MONEY_REGEX.findall(text)
        for symbol_before, amount, symbol_after in matches:
            if symbol_before or symbol_after:
                value = normalize_number(amount)
                if value is not None and value > 0:
                    return value, "deteção genérica (baixa confiança)"
    except Exception as e:
        print(f"  [aviso] fallback regex falhou: {e}")
    return None, None


def extract_price(page, product: dict):
    custom_selector = product.get("css_selector", "").strip()
    if custom_selector:
        value, method = extract_via_selector(page, custom_selector)
        if value is not None:
            return value, method

    value, method = extract_via_jsonld(page)
    if value is not None:
        return value, method

    value, method = extract_via_meta(page)
    if value is not None:
        return value, method

    value, method = extract_via_regex_fallback(page)
    if value is not None:
        return value, method

    return None, None


def send_telegram_message(text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[aviso] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não definidos — só a imprimir:")
        print(text)
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    resp = requests.post(
        url,
        data={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": False},
        timeout=20,
    )
    if resp.status_code != 200:
        print(f"[erro] Falha ao enviar Telegram: {resp.status_code} {resp.text}")
    else:
        print("[ok] Alerta enviado via Telegram.")


def load_products() -> list:
    if not PRODUCTS_FILE.exists():
        return []
    try:
        return json.loads(PRODUCTS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print("[erro] products.json inválido — a abortar.")
        sys.exit(1)


def save_products(products: list) -> None:
    PRODUCTS_FILE.write_text(json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8")


def format_price(value: float, currency: str) -> str:
    symbol = {"EUR": "€", "USD": "$", "GBP": "£", "BRL": "R$"}.get(currency, currency)
    return f"{symbol}{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main() -> int:
    products = load_products()
    if not products:
        print("Nenhum produto em products.json — nada a verificar.")
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for product in products:
            name = product.get("name") or product.get("url")
            url = product["url"]
            target_price = product.get("target_price")
            currency = product.get("currency", "EUR")

            print(f"\nA verificar: {name} ({url})")

            page = browser.new_page(user_agent=USER_AGENT)
            try:
                page.goto(url, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(2000)
                price, method = extract_price(page, product)
            except Exception as e:
                print(f"  [erro] Não foi possível carregar/analisar a página: {e}")
                product["status"] = "error"
                product["last_error"] = str(e)[:300]
                product["last_checked"] = now_iso
                page.close()
                continue
            page.close()

            product["last_checked"] = now_iso

            if price is None:
                print("  [erro] Não foi possível detetar um preço nesta página.")
                product["status"] = "error"
                product["last_error"] = "Preço não encontrado — considera definir um seletor CSS manual."
                continue

            print(f"  Preço detetado: {format_price(price, currency)} (método: {method})")
            product["last_price"] = price
            product["last_price_method"] = method
            product["last_error"] = ""

            if target_price is None:
                product["status"] = "sem_alvo"
                continue

            if price <= target_price:
                product["status"] = "no_alvo"
                already_notified = product.get("notified_below_target", False)
                if not already_notified:
                    message = (
                        "🔔 <b>Preço no alvo!</b>\n\n"
                        f"<b>{name}</b>\n"
                        f"Preço atual: {format_price(price, currency)}\n"
                        f"O teu alvo era: {format_price(target_price, currency)}\n\n"
                        f"👉 {url}"
                    )
                    send_telegram_message(message)
                    product["notified_below_target"] = True
                else:
                    print("  [info] Já tinha sido notificado para este preço — sem novo alerta.")
            else:
                product["status"] = "acima_do_alvo"
                # Rearma o alerta: se o preço voltar a descer no futuro, volta a notificar.
                product["notified_below_target"] = False

        browser.close()

    save_products(products)
    print("\nConcluído.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
