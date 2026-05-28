const cloud = require('wx-server-sdk')
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

// 解析事件开始时间（VARCHAR 存储的北京时间字符串，如 "2026-05-28 14:00:00"）
// 不使用 new Date()，避免运行时时区影响
function parseStartTime(value) {
  if (!value) return null
  const str = String(value).replace(/\//g, '-').replace('T', ' ')
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!match) return null
  return {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
    day: parseInt(match[3]),
    hour: parseInt(match[4]),
    minute: parseInt(match[5]),
  }
}

function formatDateTime(dt) {
  if (!dt) return ''
  const y = dt.year
  const m = String(dt.month).padStart(2, '0')
  const d = String(dt.day).padStart(2, '0')
  const hh = String(dt.hour).padStart(2, '0')
  const mm = String(dt.minute).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
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
      console.log('[reminderCron] 无待提醒事件')
      return { ok: true, scanned: 0, sent: 0, marked: 0 }
    }

    console.log(`[reminderCron] 查询到待提醒事件: ${events.length}个`)

    let sentCount = 0
    let markedCount = 0

    for (const event of events) {
      const recipientIds = Array.from(new Set([event.calendar_creator_id, event.creator_id].filter(Boolean)))
      let eventSent = 0
      const startAt = parseStartTime(event.start_time)
      console.log(`[reminderCron] 事件${event.id} "${event.title}": recipients=${recipientIds.length}`)

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
        if (!prefRows.length || prefRows[0].state !== 'accept') {
          console.log(`[reminderCron] 事件${event.id}: 用户${recipientId}未订阅(${prefRows.length ? prefRows[0].state : 'no_record'}), 跳过`)
          continue
        }

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

        // 使用 cloud.openapi（自动管理 access_token，兼容 wx-server-sdk v3）
        const result = await cloud.openapi.subscribeMessage.send({
          touser: userRows[0].openid,
          templateId: WX_TMPL_EVENT_REMINDER,
          page: `pages/event-detail/event-detail?id=${event.id}`,
          data: {
            thing1: { value: normalizeText(event.title, 20, '未命名日程') },
            thing2: { value: formatDateTime(startAt) },
            thing5: { value: normalizeText(event.location, 20, '无') },
            thing3: { value: normalizeText(event.content, 20, '无') },
          },
          miniprogramState: 'formal',
        })

        if (result && result.errCode === 0) {
          sentCount += 1
          eventSent += 1
          console.log(`[reminderCron] 事件${event.id}: 发送成功 -> 用户${recipientId}`)
        } else {
          console.log(`[reminderCron] 事件${event.id}: 发送失败 -> 用户${recipientId} errCode=${result?.errCode} errMsg=${result?.errMsg}`)
        }
      }

      if (eventSent > 0) {
        await conn.execute('UPDATE events SET reminder_sent_at=NOW() WHERE id=? AND reminder_sent_at IS NULL', [event.id])
        markedCount += 1
      }
    }

    console.log(`[reminderCron] 完成: scanned=${events.length} sent=${sentCount} marked=${markedCount}`)
    return { ok: true, scanned: events.length, sent: sentCount, marked: markedCount }
  } finally {
    await conn.end()
  }
}