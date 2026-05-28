const http = require('http')
const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const port = Number(process.env.PORT || 9000)

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function postWechatSubscribe(accessToken, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        timeout: 10000,
      },
      (resp) => {
        let data = ''
        resp.on('data', (chunk) => {
          data += chunk
        })
        resp.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'))
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

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/send') {
    writeJson(res, 404, { ok: false, err: 'not found' })
    return
  }

  try {
    const body = await parseJsonBody(req)
    const { openid, template_id, data, page = '' } = body || {}
    if (!openid || !template_id) {
      writeJson(res, 400, { ok: false, err: 'missing openid/template_id' })
      return
    }

    const { accessToken } = await cloud.getAccessToken()
    const wechatPayload = {
      touser: openid,
      template_id,
      data: data || {},
    }
    if (page) wechatPayload.page = page

    const result = await postWechatSubscribe(accessToken, wechatPayload)
    if (result.errcode !== 0) {
      console.error('[sendSubscribe] 微信API返回错误:', {
        errcode: result.errcode,
        errmsg: result.errmsg,
        openid,
        template_id,
      })
    }
    writeJson(res, 200, { ok: true, result })
  } catch (err) {
    console.error('send subscribe error:', err)
    writeJson(res, 500, { ok: false, err: 'internal error' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${port}`)
})