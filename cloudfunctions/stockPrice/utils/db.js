const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: process.env.ENV_ID || cloudbase.SYMBOL_CURRENT_ENV })

module.exports = app.database()
