const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 普通云函数入口
 * event = { openid, template_id, data, page }
 */
exports.main = async (event, context) => {
  const { openid, template_id, data, page = '' } = event || {}

  if (!openid || !template_id) {
    console.warn('[sendSubscribe] 缺少必填参数 openid/template_id:', event)
    return { ok: false, err: 'missing openid or template_id' }
  }

  console.log('[sendSubscribe] 开始发送:', { openid, template_id, page })

  try {
    // 使用 wx-server-sdk 内置 openapi（自动管理 access_token）
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: template_id,
      data: data || {},
      page: page || undefined,
      miniprogramState: 'formal',
    })

    if (result.errCode !== 0) {
      console.error('[sendSubscribe] 微信API返回错误:', {
        errCode: result.errCode,
        errMsg: result.errMsg,
        openid,
        template_id,
      })
    } else {
      console.log('[sendSubscribe] 发送成功:', { openid, template_id })
    }

    return { ok: true, result }
  } catch (err) {
    console.error('[sendSubscribe] 云函数异常:', err)
    return { ok: false, err: err.message || 'internal error' }
  }
}
