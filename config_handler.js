// @ts-check
const fs = require('fs');
const yaml = require('js-yaml');

/**
 * @type {{
 * admin_key: string,
 * mod_key: string,
 * main_channel_name: string,
 * shout_channel_name: string,
 * allow_room_creation: boolean,
 * room_creation_public: "none"|"mod"|"admin"|"all",
 * room_creation_unlisted: "none"|"mod"|"admin"|"all",
 * room_deletion: "none"|"mod"|"admin"|"all",
 * list_online_users: "none"|"mod"|"admin"|"all",
 * welcome_message: string[]?,
 * port: number
 * }}
 */
// @ts-ignore
var config = yaml.load(fs.readFileSync('./config.yml').toString())

// Use environment variables if blank strings are set
if (config.admin_key === "" || config.admin_key == null) {
  if (process.env.ADMINKEY) {
    config.admin_key = process.env.ADMINKEY
  } else {
    throw new Error("No admin key is set!")
  }
}
if (config.mod_key === "" || config.mod_key == null) {
  if (process.env.MODKEY) {
    config.mod_key = process.env.MODKEY
  } else {
    throw new Error("No mod key is set!")
  }
}

// Validate configuration
if (!Number.isInteger(config.port) || config.port <= 0 || config.port >= 65535) {
  throw new Error("A valid port must be specified!")
}

exports.config = config
