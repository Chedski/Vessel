// @ts-check
const fs = require('fs');
const yaml = require('js-yaml');

function log2(name, ...data) {
  console.log(`[${new Date().toUTCString()}] [${name}] `, ...data)
}

/**
 * @type {{
 * database: string,
 * superadmin_key: string,
 * admin_key: string,
 * mod_key: string,
 * main_channel_name: string,
 * shout_channel_name: string,
 * allow_room_creation: boolean,
 * room_creation_public: "none"|"mod"|"admin"|"all",
 * room_creation_unlisted: "none"|"mod"|"admin"|"all",
 * room_deletion: "none"|"founder"|"mod"|"admin"|"all",
 * room_modify_userdata: "none"|"founder"|"mod"|"admin"|"all",
 * list_online_users: "none"|"mod"|"admin"|"all",
 * welcome_message: string[]?,
 * port: number
 * }}
 */
// @ts-ignore
var config = yaml.load(fs.readFileSync('./config.yml').toString())

// Use environment variables if blank strings are set
if (config.database === "" || config.database == null) {
  if (process.env.DATABASE) {
    log2("Database",`Using DATABASE environment variable.`)
    config.database = process.env.DATABASE
  } else {
    config.database = "sqlite://:memory:"
    log2("Database","No database set! Using a non-persistent database.")
  }
} else { log2("Database",`Using config.yml database settings.` )}

if (config.superadmin_key === "" || config.superadmin_key == null) {
  if (process.env.SUPERADMINKEY) {
    config.superadmin_key = process.env.SUPERADMINKEY
  } else {
    throw new Error("No superadmin key is set!")
  }
}
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
