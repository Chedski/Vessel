// @ts-check
const fs = require('fs');
const yaml = require('js-yaml');

/** @type {{admin_key:string, mod_key:string, main_channel_name:string, shout_channel_name:string port:number}} */
// @ts-ignore
var config = yaml.load(fs.readFileSync('./config.yml').toString())

// Use environment variables if blank strings are set
if (config.admin_key === "") {
  config.admin_key = process.env.ADMINKEY
}
if (config.mod_key === "") {
  config.mod_key = process.env.MODKEY
}

// Validate configuration
if (config.admin_key == "" || config.admin_key == null) {
  throw new Error("No admin key is set!")
}
if (config.mod_key == "" || config.mod_key == null) {
  throw new Error("No mod key is set!")
}
if (!Number.isInteger(config.port) && !parseInt(config.port)) {
  throw new Error("No port is set!")
}

exports.config = config
