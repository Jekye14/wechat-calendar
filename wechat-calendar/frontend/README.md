# 前端部署说明

## 1) HTTP 云函数 `sendSubscribe` 部署

`frontend/cloudfunctions/sendSubscribe` 需按 HTTP 云函数部署：

- 入口 `index.js` 启动原生 Node HTTP 服务，监听 `0.0.0.0:9000`
- `scf_bootstrap`（无扩展名、可执行、LF）：

```bash
#!/bin/bash
export PORT=9000
/var/lang/node18/bin/node index.js
```

## 2) 小程序调用 HTTP 云函数

`app.js` 中保留：

- `wx.cloud.init({ env: globalData.cloudEnv })`（云托管）
- `globalData.resourceEnv`（云开发环境 ID）
- `this.subscribeCloud = new wx.cloud.Cloud({ resourceEnv })`

发送订阅消息时调用：

```js
getApp().subscribeCloud.callHTTPFunction({
  name: 'sendSubscribe',
  path: '/send',
  method: 'POST',
  data: payload,
})
```

## 3) reminderCron 定时函数配置

`frontend/cloudfunctions/reminderCron` 需要配置定时触发器，并设置环境变量：

- `MYSQL_ADDRESS`
- `MYSQL_USERNAME`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `WX_TMPL_EVENT_REMINDER`
- 可选：`REMINDER_WINDOW_SECONDS`（默认 90）
- 可选：`REMINDER_MAX_BATCH`（默认 100）

## 4) remind_before_minutes 语义

- `null`：不提醒
- `0`：到点提醒（开始时提醒）
- `>0`：提前 N 分钟提醒（如 5/10/15/30/60）

创建事件时前端默认传 `10`。
