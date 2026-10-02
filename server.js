import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import pkg from 'pg';
import { fal } from '@fal-ai/client';
import fetch from 'node-fetch';

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BOT_TOKEN = process.env.BOT_TOKEN;

// Настройка ключа fal.ai
fal.config({ credentials: process.env.FAL_KEY });

// Модель для примерки (можно поменять одной строкой, например на 'fal-ai/fashn/tryon/v1.6')
const VTON_MODEL = 'fal-ai/fashn/tryon/v1.6';

// Проверка подписи Telegram initData
function verifyTelegramInitData(initData) {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get("hash");
    p.delete("hash");
    const str = [...p.entries()].sort().map(([k, v]) => `${k}=${v}`).join("\n");
    const key = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const ok = crypto.createHmac("sha256", key).update(str).digest("hex") === hash;
    return ok ? JSON.parse(p.get("user")) : null;
  } catch (e) {
    return null;
  }
}

// 1. Авторизация и рефералы при входе
app.post('/api/auth', async (req, res) => {
  const { initData, refCode } = req.body;
  const tgUser = verifyTelegramInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

  const { id: tgId, first_name, username, photo_url } = tgUser;

  try {
    let userResult = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]);
    let user;

    if (userResult.rows.length === 0) {
      let inviterId = null;
      if (refCode && refCode.startsWith('ref_')) {
        const parsedId = Number(refCode.replace('ref_', ''));
        if (parsedId !== tgId) {
          const inviterCheck = await pool.query('SELECT * FROM users WHERE tg_id = $1', [parsedId]);
          if (inviterCheck.rows.length > 0) inviterId = parsedId;
        }
      }

      const insertRes = await pool.query(
        `INSERT INTO users (tg_id, username, first_name, photo_url, balance, referred_by) 
         VALUES ($1, $2, $3, $4, 3, $5) RETURNING *`,
        [tgId, username, first_name, photo_url, inviterId]
      );
      user = insertRes.rows[0];
    } else {
      const updateRes = await pool.query(
        `UPDATE users SET first_name = $1, username = $2, photo_url = $3 WHERE tg_id = $4 RETURNING *`,
        [first_name, username, photo_url, tgId]
      );
      user = updateRes.rows[0];
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 2. Создание счета (Telegram Stars)
app.post('/api/create-invoice', async (req, res) => {
  const { tgId, productType } = req.body; 
  let title = "10 примерок одежды";
  let amount = 150;
  let payload = `pack10:${tgId}:${Date.now()}`;

  if (productType === 'pass24h') {
    title = "Суточный безлимит (24ч)";
    amount = 250;
    payload = `pass24h:${tgId}:${Date.now()}`;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: "Оплата цифровых услуг в мини-приложении",
        payload,
        currency: "XTR",
        prices: [{ label: title, amount }]
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.description);
    res.json({ invoiceLink: data.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Вебхук оплаты Telegram
app.post('/api/webhook/telegram', async (req, res) => {
  const update = req.body;

  if (update.pre_checkout_query) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true })
    });
    return res.sendStatus(200);
  }

  if (update.message && update.message.successful_payment) {
    const payment = update.message.successful_payment;
    const payloadParts = payment.invoice_payload.split(':');
    const productType = payloadParts[0];
    const tgId = Number(payloadParts[1]);
    const chargeId = payment.telegram_payment_charge_id;

    const check = await pool.query('SELECT * FROM payments WHERE charge_id = $1', [chargeId]);
    if (check.rows.length === 0) {
      await pool.query('INSERT INTO payments (charge_id, tg_id, product, stars) VALUES ($1, $2, $3, $4)', 
        [chargeId, tgId, productType, payment.total_amount]);

      if (productType === 'pack10') {
        await pool.query('UPDATE users SET balance = balance + 10 WHERE tg_id = $1', [tgId]);
      } else if (productType === 'pass24h') {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await pool.query('UPDATE users SET unlimited_until = $1 WHERE tg_id = $2', [expiresAt, tgId]);
      }
    }
  }

  res.sendStatus(200);
});

// 4. Запуск виртуальной примерки через fal.ai
app.post('/api/tryon', async (req, res) => {
  const { initData, humanImg, garmentUrl, itemId } = req.body;
  const tgUser = verifyTelegramInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'Unauthorized' });

  const tgId = tgUser.id;

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]);
    const user = userRes.rows[0];

    const now = new Date();
    const hasUnlimited = user.unlimited_until && new Date(user.unlimited_until) > now;

    // Списание баланса
    if (!hasUnlimited) {
      if (user.balance > 0) {
        await pool.query('UPDATE users SET balance = balance - 1 WHERE tg_id = $1', [tgId]);
      } else {
        return res.status(402).json({ error: 'No tries left' });
      }
    }

    // Запрос к fal.ai
    const result = await fal.subscribe(VTON_MODEL, {
      input: {
        model_image: humanImg,
        garment_image: garmentUrl
      },
      logs: true
    });

    const resultUrl = result.data.image.url;

    // Сохранение истории примерки
    await pool.query('INSERT INTO tryons (tg_id, item_id, result_url) VALUES ($1, $2, $3)', [tgId, itemId || 'item', resultUrl]);

    // АНТИФРОД-РЕФЕРАЛ: начисляем бонус пригласившему ТОЛЬКО после первой успешной примерки друга
    if (user.referred_by && !user.ref_rewarded) {
      await pool.query('UPDATE users SET ref_rewarded = true WHERE tg_id = $1', [tgId]);
      await pool.query('UPDATE users SET balance = balance + 3 WHERE tg_id = $1', [user.referred_by]);

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: user.referred_by,
          text: `🎉 Ваш друг сделал первую примерку! Вам начислено +3 бонусных попытки ✨`
        })
      });
    }

    res.json({ success: true, resultUrl });
  } catch (err) {
    console.error(err);
    // Возвращаем баланс при сбое ИИ (если не безлимит)
    res.status(500).json({ error: 'AI generation failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
