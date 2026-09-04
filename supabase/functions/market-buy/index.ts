// Supabase Edge Function "market-buy": проверяет оплату в Robinhood Chain и проводит сделку на маркете.
// Внешних зависимостей нет (только ПОЛУЧАЕМ ETH — казну здесь не подписываем).
// Клиент присылает { wallet /*покупатель*/, signature, type: 'sale'|'exclusive', refId }. Мы:
//  1) читаем транзакцию и убеждаемся, что wallet заплатил в treasury достаточную сумму;
//  2) пишем хэш в market_purchases (PK) → повтор даёт 409, деньги не тратятся дважды;
//  3) sale     → отдаём лот покупателю (в его сейв), удаляем лот, создаём заявку на выплату продавцу;
//     exclusive → уменьшаем сток эксклюзива и выдаём пета покупателю (ETH остаётся у казны).
const RPC = Deno.env.get("RH_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com";
// ⚙️ Казна на Robinhood Chain (0x…, нижним регистром). Нулевой адрес → оплаты отклоняются (предохранитель).
const TREASURY = "0x3b51dbd73fe5d9d95c2b228f1642e0ffaa592246";
const WEI_PER_ETH = 1000000000000000000n;
const FEE_BPS = 500; // 5% комиссия казны с продажи между игроками
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function sbHeaders(extra?: Record<string, string>) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...extra };
}
// ETH (дробное число из базы) → wei. Через строку, а НЕ умножением float на 1e18: на деньгах
// ошибка округления double недопустима (та же логика, что в клиентском chain.ts).
function ethToWei(eth: number): bigint {
  const [int, frac = ""] = Number(eth).toFixed(18).split(".");
  return BigInt(int) * WEI_PER_ETH + BigInt(frac.padEnd(18, "0"));
}
// Один JSON-RPC вызов к ноде сети.
async function ethCall(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json().catch(() => null);
  return j?.result ?? null;
}

// Выдать вид питомца в сейв покупателя (ownedSpecies + progress + имя + надетые аксессуары).
// Аксессуары уходят вместе с петом: кладём их и в ownedAccessories, и в progress[species].accessories.
function grantPet(data: any, species: string, level: number, buffs: unknown, name?: string, accessories: string[] = []): boolean {
  const owned: string[] = data.ownedSpecies ?? [];
  if (owned.includes(species)) return false; // модель: один экземпляр на вид
  data.ownedSpecies = [...owned, species];
  data.progress = { ...(data.progress ?? {}), [species]: { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: level || 1, buffs: buffs ?? [], accessories } };
  if (accessories.length) data.ownedAccessories = Array.from(new Set([...(data.ownedAccessories ?? []), ...accessories]));
  if (name) data.names = { ...(data.names ?? {}), [species]: name };
  return true;
}

async function loadSave(wallet: string): Promise<any | null> {
  const rows = await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: sbHeaders() }).then((r) => r.json());
  return rows?.[0]?.data ?? null;
}
async function writeSave(wallet: string, data: any): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
}
// Без авторизации + до 8 платных RPC-вызовов на запрос → без лимита кто угодно может слать пачки
// мусорных подписей и накручивать счёт/забивать функцию. rl_check — атомарный счётчик в базе
// (см. marketplace.sql), общий для всех инстансов функции (не in-memory).
async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/rl_check`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_key: key, p_max: max, p_window_ms: windowMs, p_now: Date.now() }) });
  const ok = await res.json().catch(() => true);
  return ok !== true; // rl_check вернул false → лимит исчерпан
}
// Хэш транзакции в EVM — ровно 32 байта hex. Проверяем формат ДО обращения к RPC: отсекает мусор
// бесплатно. (В Solana-версии тут была base58-проверка длиной 80–100 символов.)
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ADDR_RE.test(TREASURY) || /^0x0+$/.test(TREASURY)) {
      return jsonResp({ error: "treasury not configured" }, 503);
    }
    const { wallet: rawWallet, signature, type, refId } = await req.json();
    // Адрес нормализуем так же, как клиент (normalizeAddress в wallet.ts): 0xAbC… и 0xabc… —
    // один и тот же кошелёк, и в базе он должен быть ровно одним.
    const wallet = String(rawWallet ?? "").toLowerCase();
    if (!wallet || !signature || !refId || (type !== "sale" && type !== "exclusive")) return jsonResp({ error: "missing fields" }, 400);
    if (!TX_RE.test(signature)) return jsonResp({ error: "bad tx hash format" }, 400);
    if (!ADDR_RE.test(wallet)) return jsonResp({ error: "bad address" }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (await rateLimited(`market-buy:${ip}`, 15, 60000)) return jsonResp({ error: "too many requests, slow down" }, 429);

    // 1) Читаем транзакцию из блокчейна (с повторами — нода может ещё не видеть её сразу).
    let tx: any = null;
    for (let i = 0; i < 8; i++) {
      tx = await ethCall("eth_getTransactionByHash", [signature]);
      if (tx) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) return jsonResp({ error: "tx not found (try again in a few seconds)" }, 404);

    // Транзакция должна быть В БЛОКЕ и успешной: в EVM попадание в блок ≠ успех, у неудачной
    // status = 0x0 и перевод не состоялся — принимать такую нельзя.
    const receipt = await ethCall("eth_getTransactionReceipt", [signature]);
    if (!receipt) return jsonResp({ error: "tx not confirmed yet (try again)" }, 404);
    if (receipt.status !== "0x1") return jsonResp({ error: "tx failed on-chain" }, 400);

    // Проверяем перевод: платил именно этот кошелёк, получила именно казна.
    if (String(tx.from ?? "").toLowerCase() !== wallet) return jsonResp({ error: "payer mismatch" }, 400);
    if (String(tx.to ?? "").toLowerCase() !== TREASURY) return jsonResp({ error: "no payment to treasury" }, 400);
    // Сумма в wei не помещается в обычное число JS (0.04 ETH = 4e16 wei > предела 9e15),
    // поэтому держим bigint и сравниваем с ценой тоже в wei.
    const paid = BigInt(tx.value ?? "0x0");
    if (paid <= 0n) return jsonResp({ error: "no payment to treasury" }, 400);

    // 2) ЗАПИСЫВАЕМ ПЛАТЁЖ ПЕРВЫМ (signature — PK): дедуп + фиксация, что деньги пришли в казну.
    //    После этой точки любая неудача сделки → заявка на ВОЗВРАТ ETH (деньги не застревают в казне).
    const rec = await fetch(`${SB_URL}/rest/v1/market_purchases`, {
      method: "POST",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ signature, buyer: wallet, kind: type, ref_id: refId, seller: "", lamports: paid.toString(), created_at: new Date().toISOString() }),
    });
    if (rec.status === 409) return jsonResp({ error: "already processed" }, 409);
    if (!rec.ok) return jsonResp({ error: "record failed" }, 500);

    // Возврат: заявка на выплату всей уплаченной суммы обратно покупателю (админ подтвердит в панели).
    // Колонка sell_requests.sol осталась от Solana-эпохи — теперь в ней сумма в ETH
    // (переименование потребовало бы миграции базы и правок во всех выплатных функциях).
    const refund = async (reason: string) => {
      await fetch(`${SB_URL}/rest/v1/sell_requests`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ id: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet, pv: 0, sol: +(Number(paid) / 1e18).toFixed(6), kind: "refund", status: "pending", created_at: new Date().toISOString() }),
      });
      return jsonResp({ error: `${reason} — refund queued`, refund: true }, 409);
    };

    // 3) Находим лот/эксклюзив и его цену.
    let priceEth: number;
    let seller = "";
    let species: string;
    let level = 1;
    let buffs: unknown = [];
    let accessories: string[] = [];
    let name: string | undefined;

    if (type === "sale") {
      const rows = await fetch(`${SB_URL}/rest/v1/listings?id=eq.${encodeURIComponent(refId)}&kind=eq.sale&select=*`, { headers: sbHeaders() }).then((r) => r.json());
      const lot = rows?.[0];
      if (!lot) return refund("listing gone");
      priceEth = Number(lot.price);
      seller = lot.seller;
      species = lot.species;
      level = lot.level ?? 1;
      buffs = lot.buffs ?? [];
      name = lot.name || undefined;
    } else {
      const rows = await fetch(`${SB_URL}/rest/v1/exclusives?id=eq.${encodeURIComponent(refId)}&select=*`, { headers: sbHeaders() }).then((r) => r.json());
      const ex = rows?.[0];
      if (!ex || !ex.active || (ex.stock ?? 0) <= 0) return refund("exclusive sold out");
      priceEth = Number(ex.price);
      species = ex.species;
      name = ex.name || undefined;
    }
    if (paid < ethToWei(priceEth)) return refund("underpaid");

    // 4) Проверяем покупателя: сейв есть и он ещё не владеет этим видом (иначе дубль — блокируем ДО клейма).
    const buyer = await loadSave(wallet);
    if (!buyer) return refund("no save");
    if ((buyer.ownedSpecies ?? []).includes(species)) return refund("you already own this pet");

    // 5) АТОМАРНО «забираем» товар, чтобы два одновременных покупателя (две разные tx) не получили
    //    одного пета: продажу — условным DELETE лота; эксклюзив — атомарным decrement через RPC.
    if (type === "sale") {
      const claimed = await fetch(`${SB_URL}/rest/v1/listings?id=eq.${encodeURIComponent(refId)}&kind=eq.sale`, {
        method: "DELETE",
        headers: sbHeaders({ Prefer: "return=representation" }),
      }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(claimed) || claimed.length === 0) return refund("listing already sold");
      const lot = claimed[0]; // авторитетные данные лота на момент захвата
      species = lot.species;
      level = lot.level ?? 1;
      buffs = lot.buffs ?? [];
      accessories = Array.isArray(lot.accessories) ? lot.accessories : [];
      name = lot.name || undefined;
      seller = lot.seller;
    } else {
      // buy_exclusive(p_id): один UPDATE ... WHERE stock>0 → атомарно уменьшает сток. Пусто = распродан/гонка.
      const claimed = await fetch(`${SB_URL}/rest/v1/rpc/buy_exclusive`, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({ p_id: refId }),
      }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(claimed) || claimed.length === 0) return refund("exclusive sold out");
    }

    // 6) Выдаём пета покупателю (владение уже проверено на шаге 4).
    //    Авторитет — pet_ledger (Phase 2): пишем туда через service_role. saves.data — лишь зеркало.
    //    Продавец уже лишился пета в леджере при выставлении лота (edge fn pets → pet_take).
    grantPet(buyer, species, level, buffs, name, accessories);
    await writeSave(wallet, buyer);
    await fetch(`${SB_URL}/rest/v1/rpc/pet_grant`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ p_wallet: wallet, p_species: species, p_level: level, p_buffs: buffs ?? [], p_name: name ?? null, p_source: type === "exclusive" ? "exclusive" : "market" }),
    }).catch(() => {});

    // 7) Продажа между игроками → заявка продавцу на выплату (минус комиссия казны). Ретрай при сбое
    //    (id — PK, поэтому повторная удачная вставка = 409, считаем успехом → без двойной выплаты).
    if (type === "sale") {
      const payout = +((priceEth * (10000 - FEE_BPS)) / 10000).toFixed(6);
      const body = JSON.stringify({ id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet: seller, pv: 0, sol: payout, kind: "market", status: "pending", created_at: new Date().toISOString() });
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        const r = await fetch(`${SB_URL}/rest/v1/sell_requests`, { method: "POST", headers: sbHeaders({ Prefer: "return=minimal" }), body });
        ok = r.ok || r.status === 409;
        if (!ok) await new Promise((res) => setTimeout(res, 500));
      }
      if (!ok) console.error("payout row insert failed for seller", seller, "sig", signature);
    }

    return jsonResp({ ok: true, save: buyer });
  } catch (e) {
    return jsonResp({ error: String(e) }, 500);
  }
});
