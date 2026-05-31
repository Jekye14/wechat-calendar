// i18n 工具：根据微信语言自动加载对应语言包
const zh = require('../locales/zh')
const en = require('../locales/en')

const locales = { zh, en }

/**
 * 获取当前语言对应的 locale 对象
 * 优先从 globalData.lang 读取，兼容从 app.globalData 读取
 */
function getLocale() {
  const app = getApp()
  const lang = (app && app.globalData && app.globalData.lang) || 'zh'
  return locales[lang] || locales.zh
}

/**
 * 获取当前语言代码
 */
function getLang() {
  const app = getApp()
  return (app && app.globalData && app.globalData.lang) || 'zh'
}

module.exports = { getLocale, getLang }
