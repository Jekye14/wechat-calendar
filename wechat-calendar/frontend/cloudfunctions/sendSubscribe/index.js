const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const crypto = require('crypto')
const axios = require('axios')

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || '')
  const bb = Buffer.from(b || '')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function sign(secret, ts, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex')
}

// event 结构（HTTP 触发器会传入类似：{ headers, body, ... }）
// body 通常是字符串；内容是你 POST 的 JSON
exports.main = async (event) => {
  const headers = event?.headers || {}
  const ts = headers['x-wx-ts'] || headers['X-WX-TS']
  const sig = headers['x-wx-signature'] || headers['X-WX-SIGNATURE']
  const secret = process.env.WEBHOOK_SECRET

  if (!secret) return { ok: false, err: 'WEBHOOK_SECRET not set' }
  if (!ts || !sig) return { ok: false, err: 'missing signature headers' }

  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {})
  const expected = sign(secret, ts, rawBody)
  if (!timingSafeEqual(expected, sig)) return { ok: false, err: 'invalid signature' }

  // 防重放：时间戳 5 分钟有效
  const now = Math.floor(Date.now() / 1000)
  const tsNum = parseInt(ts, 10)
  if (!tsNum || Math.abs(now - tsNum) > 300) return { ok: false, err: 'timestamp expired' }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch (e) {
    return { ok: false, err: 'invalid json body' }
  }

  const { openid, template_id, data, page = '' } = payload || {}
  if (!openid || !template_id) return { ok: false, err: 'missing openid/template_id' }

  // 用云开发获取 accessToken
  const { accessToken } = await cloud.getAccessToken()
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`

  const reqBody = {
    touser: openid,
    template_id,
    data: data || {},
  }
  if (page) reqBody.page = page

  const resp = await axios.post(url, reqBody, { timeout: 10000 })
  return { ok: true, result: resp.data }
}