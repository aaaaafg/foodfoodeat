const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  return { openid: OPENID }
}
