const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 用户未订阅 / 拒绝接收的微信 errCode 列表
 * 43101: 用户拒绝接受消息（未订阅）
 * 47003: 模板参数不匹配
 */
const NON_ERROR_CODES = new Set([43101, 47003])

exports.main = async (event, context) => {
  const { openid, template_id, data, page = '' } = event || {}

  if (!openid || !template_id) {
    console.warn('[sendSubscribe] 缺少必填参数 openid/template_id:', event)
    return { ok: false, err: 'missing openid or template_id' }
  }

  console.log('[sendSubscribe] 开始发送:', { openid, template_id, page })

  try {
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: template_id,
      data: data || {},
      page: page || undefined,
      miniprogramState: 'formal',
    })

    if (result.errCode === 0) {
      console.log('[sendSubscribe] 发送成功:', { openid, template_id })
      return { ok: true, sent: true, result }
    }

    // 微信 API 返回了非 0 的 errCode（不走 catch，走 then）
    if (NON_ERROR_CODES.has(result.errCode)) {
      console.log('[sendSubscribe] 用户未订阅（正常情况）:', {
        errCode: result.errCode,
        openid,
        template_id,
      })
      return { ok: true, sent: false, reason: 'not_subscribed', errCode: result.errCode }
    }

    console.error('[sendSubscribe] 微信API返回错误:', {
      errCode: result.errCode,
      errMsg: result.errMsg,
      openid,
      template_id,
    })
    return { ok: false, err: `errCode: ${result.errCode}`, errCode: result.errCode }
  } catch (err) {
    const errCode = err?.errCode || 0
    const errMsg = err?.errMsg || err?.message || ''

    // 43101 用户未订阅 —— 正常情况，不是错误
    if (errCode === 43101 || errMsg.includes('43101')) {
      console.log('[sendSubscribe] 用户未订阅（正常情况）:', { openid, template_id, errCode })
      return { ok: true, sent: false, reason: 'not_subscribed', errCode: 43101 }
    }

    // 其他真实错误
    console.error('[sendSubscribe] 云函数异常:', err)
    return { ok: false, err: errMsg || 'internal error', errCode: errCode || -1 }
  }
}
