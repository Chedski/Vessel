// @ts-check
const express = require('express')
const uuid = require('uuid')
const http = require('http')
const crypto = require('crypto')
const wss = require('lup-express-ws').default(express())
const app = wss.app
const namegen = require('./namegen')
const fs = require('fs');
const util = require('util');
/** @type {http.Server} */
var httpserver

var logFile = fs.createWriteStream('log/log.txt', { flags: 'a' });
  // Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;
console.log = function () {
  logFile.write(util.format.apply(null, arguments) + '\n');
  logStdout.write(util.format.apply(null, arguments) + '\n');
}

/** @type {string} */
const ver = require("./package.json").version

/** @type {string} */
const sq = namegen.startup()
console.log(`
═══════════════════════════════════════════════════════════════

       ██╗   ██╗███████╗███████╗███████╗███████╗██╗
       ██║   ██║██╔════╝██╔════╝██╔════╝██╔════╝██║
       ██║   ██║█████╗  ███████╗███████╗█████╗  ██║
       ╚██╗ ██╔╝██╔══╝  ╚════██║╚════██║██╔══╝  ██║
        ╚████╔╝ ███████╗███████║███████║███████╗███████╗
         ╚═══╝  ╚══════╝╚══════╝╚══════╝╚══════╝╚══════╝

═══════════════════════════════════════════════════════════════
${' '.repeat(Math.floor((34 - ver.length) / 2))}------ Vessel Server v${ver} ------

${' '.repeat(Math.floor((63 - sq.length) / 2))}${sq}
`)

/**
 * @param {string} name The specific part of Vessel that logged this message
 * @param {...any} data
 */

function log2(name, ...data) {
  console.log(`[${new Date().toUTCString()}] [${name}] `, ...data)
}


const config = require("./config_handler").config

const { Sequelize, Model, DataTypes } = require('sequelize')
var silence_db = false
const sequelize = new Sequelize(config.database, {
  // logging: (msg) => { if (!silence_db) { log2("Database", msg) } }
  logging: () => {}
})



/** These errors will be sent to clients if thrown inside of the socket event handler. */
class VesselError extends Error {
  /** @returns {string} */
  get_client_message() { return this.message }
  show_to_clients = true
}
/** Thrown when clients send incorrect data types, such as sending an array instead of a string with `change_name`. */
class VesselDataError extends VesselError { }
/** Thrown when clients send data that goes outside of limits, such as trying to set an 800 character nickname. */
class VesselLimitError extends VesselError { }
/** Thrown when clients try to operate on missing/invalid resources, such as trying to join a nonexistent room ID. */
class VesselResourceError extends VesselError { }
/** Thrown when clients try to perform an operation that can't be done in the current state, such as trying to delete a channel with preventDeletion enabled. */
class VesselStateError extends VesselError { }
/** Thrown when a client trues to perform an operation without required permissions, such as a non-superadmin trying to modify room internals. */
class VesselSecurityError extends VesselError {
  /** @returns {string} */
  get_client_message() { return namegen.deny() }
}



/** @type {User[]} */
var clients = []
/** @type {Object<string,Room>} */
var rooms = {}

/** Sends a client message to all users on the server.
 * @param {string} name
 * @param {any} data
 */
function send_to_all(name, data) {
  var s = JSON.stringify({ n: name, d: data })
  clients.forEach(c => c.socket.send(s))
}

/** @param {User} user */
function become_admin(user) {
  if (user.isAdmin || user.isMod) {
    user.send("system_message", { items: [{ text: "You already did that." }] })
    return
  }

  user.isAdmin = true
  user.send("new_admin", user.get_client_object())
  user.send("user_update", { isAdmin: true })

  Object.values(rooms).forEach((room) => {
    if (room.adminOnly) { user.send("muted_in_room", { id: room.id, muted: false }) }
  })
}

/** @param {User} user */
function become_mod(user) {
  if (user.isAdmin || user.isMod) {
    user.send("system_message", { items: [{ text: "You already did that." }] })
    return
  }
  user.isMod = true
  user.send("new_admin", user.get_client_object())
  user.send("user_update", { isMod: true })

  Object.values(rooms).forEach((room) => {
    if (room.adminOnly) { user.send("muted_in_room", { id: room.id, muted: false }) }
  })
}

/** Authenticates a user using an access key
 * @param {User} user
 * @param {string} data
 */
function key_auth(user, data) {
  if (typeof data === 'string') {
    var data_hash = crypto.createHash('sha256').update(data).digest()
    var superkey_hash = crypto.createHash('sha256').update(config.superadmin_key).digest()
    var adminkey_hash = crypto.createHash('sha256').update(config.admin_key).digest()
    var modkey_hash = crypto.createHash('sha256').update(config.mod_key).digest()

    if (crypto.timingSafeEqual(data_hash, superkey_hash)) {
      log2("Security", `User ${user.name} (${user.id}) has authenticated themselves as a superadmin.`)
      become_admin(user)
      user.superadmin = true

    } else if (crypto.timingSafeEqual(data_hash, adminkey_hash)) {
      log2("Security", `User ${user.name} (${user.id}) has authenticated themselves as an admin.`)
      become_admin(user)

    } else if (crypto.timingSafeEqual(data_hash, modkey_hash)) {
      log2("Security", `User ${user.name} (${user.id}) has authenticated themselves as a moderator.`)
      become_mod(user)

    } else {
      log2("Security", `User ${user.name} (${user.id}) has failed authentication.`)
      throw new VesselSecurityError()
    }
  }
}

/**
 * Represents a connected client.
 */
class User {
  /** @type {string} */
  id

  /** @type {string} */
  name


  /** @type {Room[]} */
  rooms = []

  /**
   * @readonly
   * @type {import("ws").WebSocket}
   */
  socket

  /** Does user have superpowers?  
   * *(hidden from clients)*
   * @type {boolean}
   */
  superadmin = false

  /** Does user have admin level permissions?
   * @type {boolean}
   */
  isAdmin = false

  /** Does user have mod level permissions?
   * @type {boolean}
   */
  isMod = false

  /** Checks if a user has the proper permissions to perform a given operation.
   * @param {"all"|"founder"|"mod"|"admin"|"none"} level
   * @param {string} [founderID]
   * @returns {boolean}
   */
  check_permission(level, founderID) {
    if (this.superadmin) { return true } // Superadmin bypass
    switch (level) {
      case "all": return true
      case "founder": return (this.isAdmin || this.isMod || this.id === founderID)
      case "mod": return (this.isAdmin || this.isMod)
      case "admin": return (this.isAdmin)
      case "none": return false

      default:
        throw new Error(`Invalid permission level ${level}`)
    }
  }

  /**
   * Generates an object of the user for sending to clients.
   * @returns {Object<string,any>}
   */
  get_client_object() {
    var user = {}
    Object.keys(this).forEach((k) => {
      if (typeof (k) != "function" && k != "socket" && k != "rooms" && k != "superadmin") {
        user[k] = this[k]
      }
    })
    return user
  }

  /** Sends a message to the client
   * @param {string} name
   * @param {any} data
   */
  send(name, data) {
    this.socket.send(JSON.stringify({ n: name, d: data }))
  }

  /**
   * @param {import("ws").WebSocket} socket
   */
  constructor(socket) {
    this.socket = socket
    var self = this
    socket.on('message', function(raw) {
      if (shutting_down) { return }
      try {
        var parsed = JSON.parse(raw.toString())
        var event = parsed.n
        var data = parsed.d
        // console.log(parsed)

        switch (event) {
          case "hello":
            self.login(data); break

          case "auth":
            key_auth(self, data); break

          case "create_room":
            if (typeof (data.name) == "string") { new Room(data.name, data.type, self) }
            else { throw new VesselDataError("Name must be a string") }
            break
_
          case "change_name":
            if (typeof data === 'string') { self.set_nickname(data) }
            else { throw new VesselDataError("Data must be a string") }
            break

          case "delete_room":
            if (rooms[data.id]) { rooms[data.id].delete_room(self) }
            else { throw new VesselResourceError("Room does not exist") }
            break

          case "modify_room_user_data":
            if (rooms[data.id]) { rooms[data.id].modify_userdata(data.data, self) }
            else { throw new VesselResourceError("Room does not exist") }
            break

          case "modify_room_internal_data":
            if (rooms[data.id]) { rooms[data.id].modify_internal_data(data.data, self) }
            else { throw new VesselResourceError("Room does not exist") }
            break

          case "message":
            if (rooms[data.room]) { rooms[data.room].send(self, data.content) }
            else { throw new VesselResourceError("Room does not exist") }
            break

          case "get_online_user_list":
            if (self.check_permission(config.list_online_users)) { self.send("online_user_list", clients.map(user => user.get_client_object())) }
            else { self.send("online_user_list", {}) }
            break

          case "get_public_room_list":
            let pubrooms = []
            Object.values(rooms).forEach((room) => { if (room.isPublic) { pubrooms.push(room.get_client_object(self)) } })
            self.send("public_room_list", pubrooms)
            break

          case "get_full_room_list":
            if (!self.isAdmin) { self.socket.close(); return }
            let allrooms = []
            Object.values(rooms).forEach((room) => { allrooms.push(room.get_client_object(self)) })
            self.send("full_room_list", allrooms)
            break

          case "join_room":
            if (rooms[data.id]) { rooms[data.id].add(self) }
            else { throw new VesselResourceError("Room does not exist") }
            break

          case "leave_room":
            if (rooms[data.id]) {
              if (!rooms[data.id].preventLeaving) { rooms[data.id].remove(self) }
              else { throw new VesselStateError("Cannot leave that room.") }
            } else { throw new VesselResourceError("Room does not exist") }
            break

          case "shutdown_server":
            if (!self.isAdmin) { self.socket.close(); return }
            else if (self.superadmin) { shutdown(); return }
        }
      } catch (err) {
        if (err instanceof VesselError) {
          try {
            let item = { text: err.get_client_message() }
            let msg = { items: [item] }
            if (item.text == "Room does not exist" || item.text == "You already did that." || item.text == "You are already a member of that room.") { msg.loginHide = true }
            self.send("system_message", msg)

          } catch (err) {
            // This is awkward
          }
        } else {
          console.log(err)
        }
      }
    })

    socket.on('close', function() {
      log2("Socket", `User ${self.name} (${self.id}) has disconnected.`)
      self.rooms.forEach(room => room.remove(self, true))
      clients = clients.filter(user => (user != self))
    })
  }


  /** @param {{user: {id: String, name: String}?}} data */
  login(data) {
    if (data.user) {
      if (data.user.id) {
        this.id = data.user.id
      } else { this.id = uuid.v4() }
      if (data.user.name.length <= 32 && data.user.name.length >= 1) {
        this.name = data.user.name
      }
    } else {
      this.id = uuid.v4()
      this.name = namegen.gen()
    }

    this.send("hello", {
      id: this.id,
      name: this.name,
      isAdmin: false,
      isMod: false
    }
    )

    Object.values(rooms).forEach((room) => {
      if (room.autoJoin) { room.add(this) }
    })

    clients.push(this)

    if (config.welcome_message) {
      config.welcome_message.forEach(text => {
        this.send("system_message", { icon: "waving_hand", items: [{ text: text }] })
      })
    }

    this.send("login_done", {})

    log2("Socket", `User ${this.name} (${this.id}) has logged in.`)
  }

  /** @param {string} name */
  set_nickname(name) {
    if (name.length <= 32 && name.length >= 1) {
      var old_name = this.name
      this.name = name

      log2("Users", `User ${old_name} (${this.id}) has changed their nickname to ${this.name}`)
      this.send("user_update", { name: name })
    } else {
      throw new VesselLimitError("Name is too long.")
    }
  }


  /** Sends a client message to all users sharing at least 1 room with this user.
   * @param {string} name
   * @param {any} data
   */
  send_to_roommates(name, data) {
    var targets = {}
    this.rooms.forEach((room) => {
      if (!room.disableRoommates) {
        room.members.forEach(u => targets[u] = true)
      }
    })
    var s = JSON.stringify({ n: name, d: data })
    Object.values(targets).forEach(c => c.socket.send(s))
  }
}


// Database object definition for rooms
var room_db_definition = {
  id: { type: DataTypes.UUID, primaryKey: true },
  name: { type: DataTypes.TEXT, allowNull: false },
  adminOnly: { type: DataTypes.BOOLEAN, allowNull: false },
  isPublic: { type: DataTypes.BOOLEAN, allowNull: false },
  isShout: { type: DataTypes.BOOLEAN, allowNull: false },
  isMain: { type: DataTypes.BOOLEAN, allowNull: false },
  autoJoin: { type: DataTypes.BOOLEAN, allowNull: false },
  disableJoinMessages: { type: DataTypes.BOOLEAN, allowNull: false },
  disableLeaveMessages: { type: DataTypes.BOOLEAN, allowNull: false },
  disableRoommates: { type: DataTypes.BOOLEAN, allowNull: false },
  preventDeletion: { type: DataTypes.BOOLEAN, allowNull: false },
  preventLeaving: { type: DataTypes.BOOLEAN, allowNull: false },
  founder: { type: DataTypes.UUID, allowNull: false },
  founderNick: { type: DataTypes.TEXT, allowNull: false },
  userdata: { type: DataTypes.JSON, allowNull: false },
}

const PersistentRoom = sequelize.define("Room", room_db_definition, { paranoid: true })

/** @type {boolean} */
var shutting_down = false
async function shutdown() {
  shutting_down = true
  console.log("\n") // Two blank lines
  log2("Shutdown", "Vessel is shutting down!")
  console.log("\n") // Two blank lines

  log2("Shutdown", "Sending a system message to all connected users.")
  send_to_all("system_message", { items: [{ text: "Server is shutting down, you will be disconnected shortly." }] })

  setTimeout(() => {
    log2("Shutdown", "Disconnecting clients.")
    clients.forEach(c => c.socket.close())
    log2("Shutdown", "Clients have been disconnected.")

    log2("Shutdown", "Closing HTTP server.")
    httpserver.close()
    log2("Shutdown", "Closed.")
  }, 200)


  log2("Shutdown", "Saving room data.")
  var list = Object.values(rooms)
  for (const r of list) { await r.save() }
  log2("Shutdown", "Done saving rooms.")

  setTimeout(() => {
    process.exit()
  }, 350)
}

/**
 * Represents a single room. Rooms are essentially the same thing as channels.
 */
class Room {
  /** Unique room ID, as a UUID
   * @readonly
   * @type {string} */
  id;

  /** Human-readable room name. Not unique.
   * @type {string} */
  name;

  /** Are normal users prevented from speaking in this room?
   * @type {boolean} */
  adminOnly = false;

  /** Is this room included in the room list?
   * @type {boolean} */
  isPublic = false;

  /** Is this a shout channel? (Shout channels may have special highlighting on clients)
   * @type {boolean} */
  isShout = false;

  /** Is this room the server's main channel?
   * @type {boolean} */
  isMain = false;

  /** Are users automatically added to this room when they connect for the first time?
   * @type {boolean} */
  autoJoin = false;

  /** Should the user joined signal be disabled?
   * @type {boolean} */
  disableJoinMessages = false;

  /** Should the user left signal be disabled?
   * @type {boolean} */
  disableLeaveMessages = false;

  /** Should this room be skipped when getting lists of users with mutual rooms?  
   * @type {boolean} */
  disableRoommates = false;

  /** Is this room protected from deletion?
   * @type {boolean} */
  preventDeletion = false;

  /** Are users prevented from leaving this room?  
   * **Note:** This does not prevent users from hiding sent messages.
   * @type {boolean} */
  preventLeaving = false;

  /** UUID of the room's creator, using a zeroed UUID to represent the server.
   * @type {string} */
  founder = "00000000-0000-0000-0000-000000000000";

  /** Nickname of the room's creator, using "Vessel" to represent the server.
   * @type {string} */
  founderNick = "Vessel";

  /** Array of users that are members of this channel.
   * @type {User[]} */
  members = [];

  /** Dictionary of muted users, with user UUID as keys.
   * @type {Object<string,boolean>} */
  muted = {};

  /** User-defined room metadata.
   * @type {Object<string,any>} */
  userdata = {};

  dbi;

  /**
   * @param {string} name
   * @param {"public"|"unlisted"|"loaded"} type
   * @param {User} [founder]
   * @param {string} [uuid_override]
   * @param {Model<any,any>} [loaded]
   */
  constructor(name, type, founder, uuid_override, loaded) {
    if (founder && !founder.superadmin) {
      if (!config.allow_room_creation) throw new Error("Room creation is disabled.")
      if (name.length < 2) throw new Error("Name is too short!")
      if (name.length > 32) throw new Error("Name is too long!")
    }
    this.id = uuid_override ? uuid_override : uuid.v4()
    this.name = name
    this.founder = founder ? founder.id : "00000000-0000-0000-0000-000000000000"
    this.founderNick = founder ? founder.name : "Vessel"

    switch (type) {
      case "public":
        if (founder && !founder.check_permission(config.room_creation_public)) {
          throw new VesselSecurityError("You are not allowed to do that!")
        } else {
          this.isPublic = true
          break
        }
      case "unlisted":
        if (founder && !founder.check_permission(config.room_creation_unlisted)) {
          throw new VesselSecurityError("You are not allowed to do that!")
        } else { break }
      case "loaded":
        if (founder) {
          throw new VesselSecurityError("You are not allowed to do that!")
        } else { break }
      default:
        throw new Error("Invalid room type!")
    }

    if (type == "loaded" && loaded) {
      this.dbi = loaded
      let data = this.dbi.get()
      Object.keys(data).forEach(k => {
        // console.log("SETTING", typeof (data[k]), k, " = ", data[k])
        if (k != "id") {
          if (k == "userdata") {
            try {
              this.userdata = JSON.parse(data.userdata)
            } catch (err) {
              log2("Rooms", `The room ${this.id}'s userdata JSON failed to load':`)
              log2("Rooms", data.userdata)
            }

          } else {
            this[k] = data[k]
          }
        }
      })
      log2("Rooms", `The room <${this.name} {${this.id}}> has been loaded from database.`)
      rooms[this.id] = this
    } else {
      let data = { id: this.id }
      // This should get filled in automatically, I just added the ID to make ts-check shut up
      Object.keys(room_db_definition).forEach(k => {
        if (k == "userdata") {
          data.userdata = JSON.stringify(this.userdata)
        } else {
          data[k] = this[k]
        }
      })
      this.dbi = PersistentRoom.build(data)

      rooms[this.id] = this
      if (founder) this.add(founder)
      log2("Rooms", founder ? `User ${founder.name} (${founder.id}) has created the ${type} room <${this.name} {${this.id}}>.` : `The ${type} room <${this.name} {${this.id}}> has been created.`)

      log2("Persist", `Saving new room <${this.name} {${this.id}}> to database.`)
      this.dbi.save()
      log2("Persist", `Finished saving new room <${this.name} {${this.id}}> to database.`)
    }
  }

  /**
   * Saves the room to the database.
   */
  async save() {
    log2("Persist", `Saving room <${this.name} {${this.id}}> to database.`)
    var data = {}
    Object.keys(room_db_definition).forEach(k => {
      if (k != "id") {
        if (k == "userdata") {
          data.userdata = JSON.stringify(this.userdata)
        } else {
          data[k] = this[k]
        }
      }
    })
    // console.log(data)
    await this.dbi.update(data)//, { where: { id: this.id } })
    log2("Persist", `Finished saving room <${this.name} {${this.id}}> to database.`)
  }

  /**
   * Sends a client message to every member of this room.
   * @param {string} name
   * @param {any} data
   */
  send_to_members(name, data) {
    var s = JSON.stringify({ n: name, d: data })
    this.members.forEach(c => c.socket.send(s))
  }


  /**
   * Removes a member from the channel.
   * @param {User} user
   * @param {boolean} [is_logout]
   */
  remove(user, is_logout) {
    this.members = this.members.filter(u => (u != user))

    user.rooms = user.rooms.filter(r => (r != this))
    if (!this.disableLeaveMessages) {
      this.send_to_members("system_message", {
        loginHide: true,
        items: [
          // {text: 'The user '},
          { type: "user", user: user.get_client_object() },
          { text: ' has left ' },
          { type: "room", room: this.get_client_object(user) },
          { text: '.' }
        ]
      }
      )
    }

    if (!is_logout) {
      user.send("removed_from_room", this.get_client_object(user))
    }
  }

  /**
   * Adds a member to the channel.
   * @param {User} user
   * @param {boolean} [initial]
   */
  add(user, initial) {
    if (this.members.some((u) => u == user)) {
      throw new VesselStateError("You are already a member of that room.")
    }

    log2("Rooms", `User ${user.name} (${user.id}) has been added to the room ${this.name} (${this.id}).`)

    if (!this.disableJoinMessages) {
      this.send_to_members("system_message", {
        loginHide: true,
        items: [
          { type: "user", user: user.get_client_object() },
          { text: ' has joined ' },
          { type: "room", room: this.get_client_object(user) },
          { text: '.' }
        ]
      }
      )
    }

    this.members.push(user)
    user.rooms.push(this)
    user.send("added_to_room", this.get_client_object(user))//, initial)
  }

  /** Processes a message sent in the channel.
   * @param {User} from
   * @param {string} content
   */
  send(from, content) {
    if (!(this.muted[from.id] || (this.adminOnly && !(from.isMod || from.isAdmin)))) {
      log2("Messages", `<${this.name} {${this.id.slice(0, 7)}}> ${from.name} {${from.id.slice(0, 7)}}: ${content}`)
      this.send_to_members("message", {
        room: this.id,
        user: from.get_client_object(),
        from_id: from.id,
        from_name: from.name,
        content: content
      })
    } else {
      log2("Messages", `User ${from.name} (${from.id}) was denied permission to speak in the room ${this.name} (${this.id}).`)
      from.send("system_message", {
        icon: "send",
        items: [
          { text: "You are not allowed to speak in " },
          { type: "room", room: this.get_client_object(from) },
          { text: "." }
        ]
      })
    }
  }

  /**
   * Creates a clean version of the room's data to send to clients.
   * @param {User} [user] Specific user recieving the data (for mute status)
   * @returns {Object<string,any>}
   */
  get_client_object(user) {
    var data = {}
    Object.keys(this).forEach((k) => {
      if (typeof (k) != "function" && k != "members" && k != "muted" && k != "dbi") { data[k] = this[k] }
    })
    if (user && (this.muted[user.id] || (this.adminOnly && !(user.isAdmin || user.isMod)))) { data.muted = true }
    return data
  }

  /**
   * Modifies the room's `userdata` table.
   * @param {Object<string,any>} data
   * @param {User} [user]
   */
  modify_userdata(data, user) {
    if (user && !user.check_permission(config.room_modify_userdata, this.founder)) {
      throw new VesselSecurityError()
    }

    log2("Rooms", user ? `User ${user.name} (${user.id}) is modifying userdata of <${this.name} {${this.id}}>:` : `Userdata of <${this.name} {${this.id}}> is being modified:`)
    Object.keys(data).forEach((k) => {
      log2("Rooms", `<${this.name} {${this.id}}> ${JSON.stringify(k)} = ${JSON.stringify(data[k])}`)
      this.userdata[k] = data[k]
    })
    this.send_to_members("room_update", this.get_client_object())
    this.save()
  }

  /**
   * Modifies the room itself. This can be a very dangerous function, and it is locked to superadmins only for that reason. 
   * @param {Object<string,any>} data
   * @param {User} [user]
   */
  modify_internal_data(data, user) {
    if (user && !user.superadmin) {
      throw new VesselSecurityError()
    }
    log2("Rooms", user ? `User ${user.name} (${user.id}) is modifying internal data of <${this.name} {${this.id}}>:` : `Internal data of <${this.name} {${this.id}}> is being modified:`)
    Object.keys(data).forEach((k) => {
      log2("Rooms", `<${this.name} {${this.id}}> ${JSON.stringify(k)} = ${JSON.stringify(data[k])}`)
      this[k] = data[k]
    })
    this.send_to_members("room_update", this.get_client_object())
    this.save()
  }


  /**
   * Destroys the room, notifying its members and removing it from the room list.
   * @param {User} [user] User performing the delete operation
   */
  delete_room(user) {
    if (user && !user.superadmin) {
      if (!user.check_permission(config.room_deletion, this.founder)) { throw new VesselSecurityError() }
      if (this.preventDeletion) { throw new VesselStateError("Room cannot be deleted.") }
    }
    delete rooms[this.id]
    this.send_to_members("room_deleted", this.get_client_object())
    Object.values(this.members).forEach(u => this.remove(u))
    log2("Rooms", user ? `User ${user.name} (${user.id}) has deleted <${this.name} {${this.id}}>.` : ` <${this.name} {${this.id}}> has been deleted.`)
    log2("Persist", `Marking room <${this.name} {${this.id}}> as deleted.`)
    this.dbi.destroy()
    log2("Persist", `Finished marking room <${this.name} {${this.id}}> as deleted.`)

    if (Object.values(rooms).length == 0) {
      log2("Rooms", "There are no rooms left! Onboarding needs to be run again.")
      log2("Rooms", "Shutting down; hopefully the server's auto-restart is configured properly.")
      httpserver.close(() => {
        log2("Shutdown", "Shutting down; hopefully the server's auto-restart is configured properly.")
      })
    }
  }
}

async function create_initial_rooms() {
  log2("Onboarding", `No public rooms found, creating default rooms.`)

  log2("Onboarding", `Creating ${config.main_channel_name}.`)
  var main_room = new Room(config.main_channel_name, "public", undefined)//"27b9bef4-ffb7-451e-b010-29870760e2b1")
  log2("Onboarding", `Configuring ${config.main_channel_name}.`)
  main_room.isMain = true
  main_room.autoJoin = true
  main_room.disableJoinMessages = true
  main_room.disableLeaveMessages = true
  main_room.preventDeletion = true
  await main_room.save()

  log2("Onboarding", `Creating ${config.shout_channel_name}.`)
  var shout_room = new Room(config.shout_channel_name, "public", undefined)//, "823d68d9-a20c-409e-b6db-12e313ed9a16")
  log2("Onboarding", `Configuring ${config.shout_channel_name}.`)
  shout_room.isShout = true
  shout_room.adminOnly = true
  shout_room.autoJoin = true
  shout_room.disableJoinMessages = true
  shout_room.disableLeaveMessages = true
  shout_room.preventLeaving = true
  shout_room.preventDeletion = true
  await shout_room.save()

}


async function run() {
  var got = await import('got')

  log2("Resources", `Saving copies of client JS scripts to memory...`)
  //var js_twemoji = await got.got("https://twemoji.maxcdn.com/v/latest/twemoji.min.js")
  var js_marked = await got.got("https://cdn.jsdelivr.net/npm/marked/marked.min.js")
  log2("Resources", `Done!`)

  //app.get("/twemoji.js", (req, res) => { res.setHeader("Content-Type", "text/javascript").send(js_twemoji.body) })
  app.get("/marked.js", (req, res) => { res.setHeader("Content-Type", "text/javascript").send(js_marked.body) })

  log2("Persist", `Making sure the room table exists.`)
  silence_db = true
  await PersistentRoom.sync()
  silence_db = false
  log2("Persist", `Done!`)

  log2("Persist", `Getting rooms from database.`)
  var roomList = await PersistentRoom.findAll()
  log2("Persist", `Done!`)
  var main_counter = 0
  var shout_counter = 0
  Object.values(rooms).forEach((room) => { 
    if (room.isPublic && room.isMain && room.autoJoin) { main_counter++ } 
    if (room.isPublic && room.isShout && room.autoJoin) { shout_counter++ } 
  })
  if (main_counter == 0 && shout_counter == 0) {
    await create_initial_rooms()
  }
  log2("Persist", `Loading rooms...`)
  silence_db = true
  roomList.forEach((data) => {

    if (data["id"]) {
      new Room("", "loaded", undefined, data["id"], data)
    } else {
      log2("Persist", `A room was found with a missing ID. Destroying.`)
      data.destroy({ force: true })
    }
  })
  silence_db = false
  log2("Persist", `Done!`)

  app.ws("/ev", (s) => {
    if (shutting_down) { s.close() }
    else { new User(s) }
  })
  // @ts-ignore
  log2("Socket", `Websocket server created.`)
  // The error I was getting here makes no sense.
  // Remove the @ts-ignore and you'll see what I mean.

  app.use("/", express.static("client"))
  log2("Server", `Starting server on port ${config.port}.`)
  httpserver = app.listen(config.port)
  log2("Server", `Listening on port ${config.port}!`)

  process.on('SIGINT', shutdown)
}
run()
