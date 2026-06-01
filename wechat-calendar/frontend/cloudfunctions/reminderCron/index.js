const cloud = require('wx-server-sdk')
const mysql = require('mysql2/promise')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ── 环境变量 ────────────────────────────────────────────────
const REMINDER_WINDOW_SECONDS = Number(process.env.REMINDER_WINDOW_SECONDS || 90)
const REMINDER_MAX_BATCH = Number(process.env.REMINDER_MAX_BATCH || 100)
const WX_TMPL_EVENT_REMINDER = (process.env.WX_TMPL_EVENT_REMINDER || '').trim()

// ── 不会被重试的错误码 ──────────────────────────────────────
const FATAL_CODES = new Set([43101, 47003])  // 未订阅 / 模板参数不匹配 — 重试也没用

// ── MySQL 地址解析 ──────────────────────────────────────────
function parseMysqlAddress() {
  const raw = process.env.MYSQL_ADDRESS || ''
  const [host, portRaw] = raw.split(':')
  return { host, port: Number(portRaw || 3306) }
}

// ── 文本截断 ────────────────────────────────────────────────
function normalizeText(value, limit, fallback = '') {
  const text = String(value || fallback || '').trim()
  if (!limit || text.length <= limit) return text
  return text.slice(0, Math.max(0, limit - 1)) + '\u2026'
}

// ── 时间解析（北京时间字符串，不依赖运行环境时区）──────────
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

// ══════════════════════════════════════════════════════════════
exports.main = async () => {
  // ── 0. 启动日志 ──────────────────────────────────────────
  console.log('[reminderCron] ====== 定时触发开始 ======')
  console.log(`[reminderCron] WINDOW=${REMINDER_WINDOW_SECONDS}s  MAX_BATCH=${REMINDER_MAX_BATCH}`)
  console.log(`[reminderCron] TMPL_ID=${WX_TMPL_EVENT_REMINDER || '(未设置!)'}`)
  console.log(`[reminderCron] MYSQL_ADDRESS=${process.env.MYSQL_ADDRESS || '(未设置!)'}`)

  // ── 1. 参数校验 ─────────────────────────────────────────
  if (!WX_TMPL_EVENT_REMINDER) {
    console.error('[reminderCron] ❌ WX_TMPL_EVENT_REMINDER 环境变量未设置')
    return { ok: false, err: 'WX_TMPL_EVENT_REMINDER not set' }
  }

  const { host, port } = parseMysqlAddress()
  if (!host || !process.env.MYSQL_USERNAME || process.env.MYSQL_PASSWORD === undefined || !process.env.MYSQL_DATABASE) {
    const missing = []
    if (!host) missing.push('MYSQL_ADDRESS')
    if (!process.env.MYSQL_USERNAME) missing.push('MYSQL_USERNAME')
    if (process.env.MYSQL_PASSWORD === undefined) missing.push('MYSQL_PASSWORD')
    if (!process.env.MYSQL_DATABASE) missing.push('MYSQL_DATABASE')
    console.error(`[reminderCron] ❌ 缺少 MySQL 环境变量: ${missing.join(', ')}`)
    return { ok: false, err: `missing mysql env: ${missing.join(', ')}` }
  }

  // ── 2. 连接数据库 ───────────────────────────────────────
  let conn
  try {
    conn = await mysql.createConnection({
      host,
      port,
      user: process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      charset: 'utf8mb4',
      connectTimeout: 5000,
    })
    console.log('[reminderCron] ✅ MySQL 连接成功')
  } catch (err) {
    console.error('[reminderCron] ❌ MySQL 连接失败:', err.message)
    return { ok: false, err: `mysql connect failed: ${err.message}` }
  }

  try {
    // ── 3. 查询当前 DB 时间（诊断时区） ────────────────────
    const [timeRows] = await conn.execute('SELECT NOW() AS db_now')
    console.log(`[reminderCron] DB NOW() = ${timeRows[0].db_now}`)

    // ── 4. 查询待提醒事件 ─────────────────────────────────
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
      console.log('[reminderCron] 无待提醒事件（窗口内无匹配）')
      return { ok: true, scanned: 0, sent: 0, marked: 0 }
    }

    console.log(`[reminderCron] 查询到待提醒事件: ${events.length}个`)
    // 打印每个事件的关键信息用于调试
    for (const e of events) {
      console.log(`[reminderCron]   -> id=${e.id} title="${e.title}" start="${e.start_time}" remind_before=${e.remind_before_minutes}min creator=${e.creator_id} cal_owner=${e.calendar_creator_id}`)
    }

    // ── 5. 逐事件发送 ─────────────────────────────────────
    let sentCount = 0
    let markedCount = 0
    let errorCount = 0

    for (const event of events) {
      const recipientIds = Array.from(
        new Set([event.calendar_creator_id, event.creator_id].filter(Boolean))
      )
      let eventSent = 0
      const startAt = parseStartTime(event.start_time)
      console.log(`[reminderCron] 事件${event.id} "${event.title}": recipients=${recipientIds.join(',')}`)

      for (const recipientId of recipientIds) {
        // 检查订阅状态
        const [prefRows] = await conn.execute(
          `SELECT state FROM wx_subscribe_prefs WHERE user_id=? AND template_id=? LIMIT 1`,
          [recipientId, WX_TMPL_EVENT_REMINDER]
        )
        if (!prefRows.length || prefRows[0].state !== 'accept') {
          console.log(`[reminderCron] 事件${event.id}: 用户${recipientId} 未订阅(${prefRows.length ? prefRows[0].state : 'no_record'}), 跳过`)
          continue
        }

        // 获取 openid
        const [userRows] = await conn.execute(
          `SELECT openid FROM users WHERE id=? LIMIT 1`,
          [recipientId]
        )
        if (!userRows.length || !userRows[0].openid) {
          console.log(`[reminderCron] 事件${event.id}: 用户${recipientId} 无 openid, 跳过`)
          continue
        }

        // 发送订阅消息
        try {
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
            console.log(`[reminderCron] 事件${event.id}: ✅ 发送成功 -> 用户${recipientId}`)
          } else {
            const errCode = result?.errCode ?? 'unknown'
            const errMsg = result?.errMsg ?? ''
            errorCount += 1

            if (FATAL_CODES.has(errCode)) {
              console.log(`[reminderCron] 事件${event.id}: ⚠️ 用户${recipientId} 未订阅(errCode=${errCode}), 跳过(不会重试)`)
            } else {
              console.error(`[reminderCron] 事件${event.id}: ❌ 发送失败 -> 用户${recipientId} errCode=${errCode} errMsg=${errMsg}`)
            }
          }
        } catch (sendErr) {
          errorCount += 1
          const errCode = sendErr?.errCode ?? -1
          const errMsg = sendErr?.errMsg || sendErr?.message || 'unknown'
          console.error(`[reminderCron] 事件${event.id}: ❌ 发送异常 -> 用户${recipientId} errCode=${errCode} errMsg=${errMsg}`)
        }
      }

      // 标记已发送（只要至少有一个收件人成功）
      if (eventSent > 0) {
        await conn.execute(
          'UPDATE events SET reminder_sent_at=NOW() WHERE id=? AND reminder_sent_at IS NULL',
          [event.id]
        )
        markedCount += 1
        console.log(`[reminderCron] 事件${event.id}: 已标记 reminder_sent_at (${eventSent}人收到)`)
      }
    }

    // ── 6. 汇总 ────────────────────────────────────────────
    const summary = {
      ok: true,
      scanned: events.length,
      sent: sentCount,
      marked: markedCount,
      errors: errorCount,
    }
    console.log(`[reminderCron] ====== 完成: scanned=${events.length} sent=${sentCount} marked=${markedCount} errors=${errorCount} ======`)
    return summary
  } finally {
    await conn.end()
  }
}
