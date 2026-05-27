const cloud = require('wx-server-sdk')
const https = require('https')
const mysql = require('mysql2/promise')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const REMINDER_WINDOW_SECONDS = Number(process.env.REMINDER_WINDOW_SECONDS || 90)
const REMINDER_MAX_BATCH = Number(process.env.REMINDER_MAX_BATCH || 100)
const WX_TMPL_EVENT_REMINDER = (process.env.WX_TMPL_EVENT_REMINDER || '').trim()

function parseMysqlAddress() {
  const raw = process.env.MYSQL_ADDRESS || ''
  const [host, portRaw] = raw.split(':')
  return { host, port: Number(portRaw || 3306) }
}

function normalizeText(value, limit, fallback = '') {
  const text = String(value || fallback || '').trim()
  if (!limit || text.length <= limit) return text
  return text.slice(0, Math.max(0, limit - 1)) + '…'
}

function parseStartTime(value) {
  if (!value) return null
  const normalized = String(value).replace(/\//g, '-').replace('T', ' ')
  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized
  const dt = new Date(withSeconds.replace(' ', 'T'))
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

function formatDateTime(dt) {
  if (!dt) return ''
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function sendSubscribeMessage(accessToken, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 10000,
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
    req.end(JSON.stringify(payload))
  })
}

exports.main = async () => {
  if (!WX_TMPL_EVENT_REMINDER) {
    return { ok: false, err: 'WX_TMPL_EVENT_REMINDER not set' }
  }

  const { host, port } = parseMysqlAddress()
  if (!host || !process.env.MYSQL_USERNAME || process.env.MYSQL_PASSWORD === undefined || !process.env.MYSQL_DATABASE) {
    return { ok: false, err: 'missing mysql env' }
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
  })

  try {
    const [events] = await conn.execute(
      `
      SELECT
        e.id,
        e.calendar_id,
        e.creator_id,
        e.title,
        e.start_time,
        e.location,
        e.content,
        e.remind_before_minutes,
        c.creator_id AS calendar_creator_id
      FROM events e
      JOIN calendars c ON c.id = e.calendar_id
      WHERE e.status='approved'
        AND e.reminder_sent_at IS NULL
        AND e.remind_before_minutes IS NOT NULL
        AND NOW() >= DATE_SUB(
          COALESCE(
            STR_TO_DATE(e.start_time, '%Y-%m-%d %H:%i:%s'),
            STR_TO_DATE(e.start_time, '%Y-%m-%d %H:%i'),
            STR_TO_DATE(e.start_time, '%Y/%m/%d %H:%i:%s'),
            STR_TO_DATE(e.start_time, '%Y/%m/%d %H:%i')
          ),
          INTERVAL e.remind_before_minutes MINUTE
        )
        AND NOW() < DATE_ADD(
          COALESCE(
            STR_TO_DATE(e.start_time, '%Y-%m-%d %H:%i:%s'),
            STR_TO_DATE(e.start_time, '%Y-%m-%d %H:%i'),
            STR_TO_DATE(e.start_time, '%Y/%m/%d %H:%i:%s'),
            STR_TO_DATE(e.start_time, '%Y/%m/%d %H:%i')
          ),
          INTERVAL ? SECOND
        )
      ORDER BY id
      LIMIT ?
      `,
      [REMINDER_WINDOW_SECONDS, REMINDER_MAX_BATCH]
    )

    if (!events.length) {
      return { ok: true, scanned: 0, sent: 0, marked: 0 }
    }

    const { accessToken } = await cloud.getAccessToken()
    let sentCount = 0
    let markedCount = 0

    for (const event of events) {
      const recipientIds = Array.from(new Set([event.calendar_creator_id, event.creator_id].filter(Boolean)))
      let eventSent = 0
      const startAt = parseStartTime(event.start_time)

      for (const recipientId of recipientIds) {
        const [prefRows] = await conn.execute(
          `
          SELECT state
          FROM wx_subscribe_prefs
          WHERE user_id=? AND template_id=?
          LIMIT 1
          `,
          [recipientId, WX_TMPL_EVENT_REMINDER]
        )
        if (!prefRows.length || prefRows[0].state !== 'accept') continue

        const [userRows] = await conn.execute(
          `
          SELECT openid
          FROM users
          WHERE id=?
          LIMIT 1
          `,
          [recipientId]
        )
        if (!userRows.length || !userRows[0].openid) continue

        const result = await sendSubscribeMessage(accessToken, {
          touser: userRows[0].openid,
          template_id: WX_TMPL_EVENT_REMINDER,
          page: `pages/event-detail/event-detail?id=${event.id}`,
          data: {
            thing1: { value: normalizeText(event.title, 20, '未命名日程') },
            thing2: { value: formatDateTime(startAt) },
            thing5: { value: normalizeText(event.location, 20, '无') },
            thing3: { value: normalizeText(event.content, 20, '无') },
          },
        })

        if (result && result.errcode === 0) {
          sentCount += 1
          eventSent += 1
        }
      }

      if (eventSent > 0) {
        await conn.execute('UPDATE events SET reminder_sent_at=NOW() WHERE id=? AND reminder_sent_at IS NULL', [event.id])
        markedCount += 1
      }
    }

    return { ok: true, scanned: events.length, sent: sentCount, marked: markedCount }
  } finally {
    await conn.end()
  }
}