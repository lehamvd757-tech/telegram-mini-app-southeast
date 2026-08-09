const crypto = require("crypto");

const MAX_INIT_DATA_AGE_SECONDS = 60 * 60;
const MAX_INIT_DATA_LENGTH = 8192;
const FIELD_LIMITS = {
  name: 100,
  phone: 50,
  company: 200,
  city: 100,
  interest: 100,
  quantity: 200,
  comment: 2000,
  preferredContact: 50
};

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateInitData(initData, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA_LENGTH) {
    return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
  }

  const params = new URLSearchParams(initData);
  const values = new Map();

  for (const [key, value] of params.entries()) {
    if (values.has(key)) {
      return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
    }
    values.set(key, value);
  }

  const receivedHash = values.get("hash");
  const authDate = values.get("auth_date");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !authDate || !/^\d+$/.test(authDate)) {
    return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
  }

  const dataCheckString = [...values.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeEqual(calculatedHash, receivedHash)) {
    return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
  }

  const authDateSeconds = Number(authDate);
  if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds < nowSeconds - MAX_INIT_DATA_AGE_SECONDS || authDateSeconds > nowSeconds + 60) {
    return { ok: false, code: "TELEGRAM_AUTH_EXPIRED" };
  }

  try {
    const user = JSON.parse(values.get("user") || "");
    if (!Number.isSafeInteger(user.id)) {
      return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
    }
    return { ok: true, user };
  } catch {
    return { ok: false, code: "TELEGRAM_AUTH_REQUIRED" };
  }
}

function normalizeText(value, multiline = false) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    : value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
  return normalized.trim();
}

function validateLead(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead) || !lead.customer || typeof lead.customer !== "object" || Array.isArray(lead.customer)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const customer = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = normalizeText(lead.customer[field], field === "comment");
    if (value === null || value.length > limit) {
      return { ok: false, code: "INVALID_REQUEST" };
    }
    customer[field] = value;
  }

  const phoneDigits = customer.phone.replace(/\D/g, "");
  if (!customer.name || !customer.phone || phoneDigits.length < 7 || phoneDigits.length > 20 || !customer.interest || !customer.preferredContact) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  return { ok: true, customer };
}

function createLeadId(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `LD-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildSellerMessage(leadId, customer, telegramUser, now = new Date()) {
  const optionalLines = [
    ["Компания / ИП", customer.company],
    ["Город", customer.city],
    ["Количество / объём", customer.quantity],
    ["Комментарий", customer.comment]
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const username = telegramUser.username ? `@${telegramUser.username}` : "не указан";
  const localDate = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow"
  }).format(now);

  return [
    "НОВАЯ ЗАЯВКА",
    `Заявка: ${leadId}`,
    "",
    `Имя: ${customer.name}`,
    `Телефон: ${customer.phone}`,
    ...optionalLines,
    "",
    `Интерес: ${customer.interest}`,
    `Удобная связь: ${customer.preferredContact}`,
    "",
    `Telegram: ${username}`,
    `ID: ${telegramUser.id}`,
    `Дата: ${localDate}`,
    "Источник: Telegram Mini App"
  ].join("\n");
}

async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Метод не поддерживается." });
  }

  if (!request.headers["content-type"]?.toLowerCase().includes("application/json")) {
    return sendJson(response, 415, { ok: false, code: "UNSUPPORTED_MEDIA_TYPE", message: "Ожидается JSON." });
  }

  const contentLength = Number(request.headers["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength > 12 * 1024) {
    return sendJson(response, 413, { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Заявка слишком большая." });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const sellerChatId = process.env.SELLER_CHAT_ID;
  if (!botToken || !sellerChatId) {
    return sendJson(response, 500, { ok: false, code: "SERVER_CONFIGURATION_ERROR", message: "Сервис временно недоступен. Попробуйте позже." });
  }

  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", message: "Не удалось обработать заявку." });
  }

  const auth = validateInitData(request.body.initData, botToken);
  if (!auth.ok) {
    const message = auth.code === "TELEGRAM_AUTH_EXPIRED"
      ? "Сессия Telegram устарела. Откройте приложение заново и повторите отправку."
      : "Откройте приложение через Telegram и повторите отправку.";
    return sendJson(response, 401, { ok: false, code: auth.code, message });
  }

  const validatedLead = validateLead(request.body.lead);
  if (!validatedLead.ok) {
    return sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", message: "Проверьте обязательные поля заявки." });
  }

  const leadId = createLeadId();
  const text = buildSellerMessage(leadId, validatedLead.customer, auth.user);

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: sellerChatId, text, disable_web_page_preview: true })
    });
    const telegramResult = await telegramResponse.json().catch(() => null);

    if (!telegramResponse.ok || !telegramResult?.ok) {
      console.info("Telegram lead delivery failed", { leadId, status: telegramResponse.status });
      return sendJson(response, 502, { ok: false, code: "DELIVERY_FAILED", message: "Не удалось передать заявку. Попробуйте ещё раз." });
    }

    console.info("Telegram lead delivered", { leadId, status: telegramResponse.status });
    return sendJson(response, 200, { ok: true, leadId });
  } catch {
    console.info("Telegram lead delivery failed", { leadId, status: "network_error" });
    return sendJson(response, 502, { ok: false, code: "DELIVERY_FAILED", message: "Не удалось передать заявку. Попробуйте ещё раз." });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: { sizeLimit: "12kb" } } };
module.exports._internals = { validateInitData, validateLead, createLeadId, buildSellerMessage };
