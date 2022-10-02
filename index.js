// @ts-check
const express = require('express')
const uuid = require('uuid')
const http = require('http')
const crypto = require('crypto')
const wss = require('lup-express-ws').default(express())
const app = wss.app
const config = require("./config_handler").config

const namegen = require('./namegen')

/** @type {User[]} */
var clients = []
/** @type {Object<string,Room>} */
var rooms = {}

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
  
  /**
   * @param {string} name
   * @param {"public"|"unlisted"} type
   * @param {User} [founder]
   * @param {string} [uuid_override]
   */
  constructor(name, type, founder, uuid_override) {
    if (founder && !founder.superadmin) {
      if (!config.allow_room_creation) throw new Error("Room creation is disabled.")
      if (name.length < 2) throw new Error("Name is too short!")
      if (name.length > 32) throw new Error("Name is too long!")
    }
    this.id = uuid_override ? uuid_override : uuid.v4()
    this.name = name
    this.founder = founder ? founder.id : "00000000-0000-0000-0000-000000000000",
    this.founderNick = founder ? founder.name : "Vessel"
    
    switch (type) {
      case "public":
        if (founder && !founder.check_permission(config.room_creation_public)) {
          throw new Error("You are not allowed to do that!")
        } else {
          this.isPublic = true
          break
        }
      case "unlisted":
        if (founder && !founder.check_permission(config.room_creation_unlisted)) {
          throw new Error("You are not allowed to do that!")
        } else { break }
      default:
        throw new Error("Invalid room type!")
    }

    rooms[this.id] = this
    if (founder) founder.join(this)
  }

  /**
   * Sends a client message to every member of this room.
   * @param {string} name
   * @param {any} data
   */
  send_to_members(name, data) {
    var s = JSON.stringify({n: name, d: data})
    room.members.forEach(c => c.socket.send(s))
  }

  /**
   * Creates a clean version of the room's data to send to clients.
   * @param {User} [user] Specific user recieving the data (for mute status)
   * @returns {Object<string,any>}
   */
  get_client_object(user) {
    var data = {}
    Object.keys(this).forEach((k) => {
      if (k != "members" && k != "muted") { data[k] = this[k] }
    })
    if (user && (this.muted[user.id] || (this.adminOnly && !(user.isAdmin || user.isMod)))) 
    { data.muted = true }
    return data
  }
  
  /**
   * Destroys the room, notifying its members and removing it from the room list.
   * @param {User} [user] User performing the delete operation
   */
  delete_room(user) {
    if (user && !user.superadmin) {
      if (!user.check_permission(config.room_deletion, this.founder)) {
        throw new Error("Access denied")
      }
      if (this.preventDeletion) {
        throw new Error("Room cannot be deleted.")
      }
    }
    rooms[this.id] = undefined
    this.send_to_members("room_deleted", get_client_room_data(room))
    Object.values(room.members).forEach((u) => remove_user_from_room(u, room))
  }
}

var main_room = new Room(config.main_channel_name,"public",undefined,"27b9bef4-ffb7-451e-b010-29870760e2b1")
main_room.isMain = true
main_room.autoJoin = true
main_room.disableJoinMessages = true
main_room.disableLeaveMessages = true
main_room.preventDeletion = true

var shout_room = new Room(config.main_channel_name,"public",undefined,"27b9bef4-ffb7-451e-b010-29870760e2b1")
shout_room.isShout = true
shout_room.adminOnly = true
shout_room.autoJoin = true
shout_room.disableJoinMessages = true
shout_room.disableLeaveMessages = true
shout_room.preventLeaving = true
shout_room.preventDeletion = true

function send_to_all(data) {
  var s = JSON.stringify(data)
  clients.forEach(c => c.socket.send(s))
}

/** @deprecated */
function send_to(user, data) {
  user.socket.send(JSON.stringify(data))
}
/** @deprecated */
function send_to_members(room, data) {
  if (room) {
    var s = JSON.stringify(data)
    room.members.forEach(c => c.socket.send(s))
  }
}
// function send_to_roommates(user, data) {
//   var targets = {}
//   user.rooms.forEach((room) => {
//     if (!room.disableRoommates) {
//       room.members.forEach((u) => {
//         targets[u] = true
//       })
//     }
//   })
//   var s = JSON.stringify(data)
//   Object.values(targets).forEach(c => c.socket.send(s))
// }


/** @deprecated */
function get_client_room_data(from, user) {
  var room = {}
  Object.keys(from).forEach((k) => {
    if (k != "members" && k != "muted") {
      room[k] = from[k]
    }
  })
  if (
    (user && from.muted[user.id]) ||
    (from.adminOnly && !(user && (user.isAdmin || user.isMod)))
  ) { room.muted = true }
  return room
}

/** @deprecated */
function get_client_user_data(from) {
  var user = {}
  Object.keys(from).forEach((k) => {
    if (k != "socket" && k != "rooms" && k != "superadmin") {
      user[k] = from[k]
    }
  })
  return user
}

function on_new_admin(user) {
  send_to(user, {
    n: "new_admin",
    d: get_client_user_data(user)
  })

  Object.values(rooms).forEach((room) => {
    // @ts-ignore
    if (room && room.adminOnly) {
      send_to(user, {
        n: "muted_in_room",
        d: { id: room.id, muted: false }
      })
    }
  })
}

function become_admin(user) {
  
}

/** 

 * @deprecated
 */
function become_potted_plant(user) {
}

function become_mod(user) {
  if (user.isAdmin || user.isMod) {
    send_to(user, {
      n: "system_message", d: { items: [{ text: "You already did that." }] }
    })
    return
  }
  user.isMod = true

  on_new_admin(user)

  send_to(user, {
    n: "user_update",
    d: { isMod: true }
  })
}


function user_can_speak_in_room(user, room) {
  if (room.muted[user.id]) {
    return false
  } else if (room.adminOnly && !(user.isMod || user.isAdmin)) {
    return false
  } else {
    return true
  }
}


function add_user_to_room(user, room, initial) {
  if (room.members.some((u) => u == user)) {
    send_to(user, { n: "system_message", d: { loginHide: true, items: [{ text: `You are already a member of that room.` }] } })
    return
  }

  if (!room.disableJoinMessages) {
    send_to_members(room, {
      n: "system_message", d: {
        loginHide: true,
        items: [
          // {text: 'The user '},
          { type: "user", user: get_client_user_data(user) },
          { text: ' has joined ' },
          { type: "room", room: get_client_room_data(room, user) },
          { text: '.' }
        ]
      }
    })
  }

  // @ts-ignore
  room.members.push(user)
  user.rooms.push(room)
  user.socket.send(JSON.stringify({
    n: "added_to_room",
    d: get_client_room_data(room, user),
    q: initial
  }))
}

function remove_user_from_room(user, room, is_logout) {
  room.members = room.members.filter(u => (u != user))

  user.rooms = user.rooms.filter(r => (r != room))
  if (!room.disableLeaveMessages) {
    send_to_members(room, {
      n: "system_message", d: {
        loginHide: true,
        items: [
          // {text: 'The user '},
          { type: "user", user: get_client_user_data(user) },
          { text: ' has left ' },
          { type: "room", room: get_client_room_data(room, user) },
          { text: '.' }
        ]
      }
    })
  }

  if (!is_logout) {
    user.socket.send(JSON.stringify({
      n: "removed_from_room",
      d: get_client_room_data(room, user)
    }))
  }
}

function check_user_permission(user, level, founderID) {
  if (user.superadmin) { return true } // Superadmin bypass
  switch (level) {
    case "all": return true
    case "founder": return (user.isAdmin || user.isMod || (founderID && user.id == founderID))
    case "mod": return (user.isAdmin || user.isMod)
    case "admin": return (user.isAdmin)
    case "none": return false

    default:
      throw new Error(`Invalid permission level ${level}`)
  }
}

/**
 * @param {string} name
 * @param {"public"|"unlisted"} type
 * @param {User} user
 */
function create_room(name, type, user) {
  new Room(name, type, user)
}

function delete_room(room, user) {
  if (user && !check_user_permission(user, config.room_deletion, room.founder)) {
    send_to(user, { n: "system_message", d: { items: [{ text: namegen.deny() }] } })
    return
  }
  if (room.preventDeletion) {
    if (user) {
      send_to(user, { n: "system_message", d: { items: [{ text: "Room cannot be deleted." }] } })
    }
    return
  }
  rooms[room.id] = undefined
  send_to_members(room, { n: "room_deleted", d: get_client_room_data(room) })
  Object.values(room.members).forEach((u) => remove_user_from_room(u, room))
}

function modify_room_userdata(room, user, data) {
  if (user && !check_user_permission(user, config.room_modify_userdata, room.founder)) {
    send_to(user, { n: "system_message", d: { items: [{ text: namegen.deny() }] } })
    return
  }
  Object.keys(data).forEach((k) => { room.userdata[k] = data[k] })
  send_to_members(room, { n: "room_update", d: get_client_room_data(room) })
}

function modify_room_data(room, user, data) {
  // This isn't available to anyone but supers for VERY GOOD reasons
  if (user && !user.superadmin) {
    send_to(user, { n: "system_message", d: { items: [{ text: namegen.deny() }] } })
    return
  }
  Object.keys(data).forEach((k) => { room[k] = data[k] })
  send_to_members(room, { n: "room_update", d: get_client_room_data(room) })
}

app.ws("/ev", function(client_ws, req) {
  var client = {
    rooms: [],
    socket: client_ws,
    isAdmin: false,
    isMod: false
  }



  client.socket.on('close', function() {
    console.log(`client '${client.name}' (${client.id}) disconnected`)
    client.rooms.forEach((room) => {
      remove_user_from_room(client, room, true)
    })
    clients = clients.filter(user => (user != client))
  })

  /** @param {{user: {id: String, name: String}?}} data */
  function on_login(data) {
    if (data.user) {
      if (data.user.id) {
        client.id = data.user.id
      } else {
        client.id = uuid.v4()
      }
      if (data.user.name.length <= 32 && data.user.name.length >= 1) {
        client.name = data.user.name
      }
    } else {
      client.id = uuid.v4()
      client.name = namegen.gen()
    }

    client.socket.send(JSON.stringify({
      n: "hello",
      d: {
        id: client.id,
        name: client.name,
        isAdmin: false,
        isMod: false
      }
    }))

    Object.values(rooms).forEach((room) => {
      if (room && room.autoJoin) {
        add_user_to_room(client, room)
      }
    })

    clients.push(client)

    if (config.welcome_message) {
      config.welcome_message.forEach(text => {
        send_to(client, {
          n: "system_message", d: {
            icon: "waving_hand", items: [{ text: text }]
          }
        })
      })
    }

    client.socket.send(JSON.stringify({ n: "login_done", d: {} }))
  }

  /** @param {String} data */
  function on_auth(data) {
    if (typeof data === 'string') {
      var data_hash = crypto.createHash('sha256').update(data).digest()
      var superkey_hash = crypto.createHash('sha256').update(config.superadmin_key).digest()
      var adminkey_hash = crypto.createHash('sha256').update(config.admin_key).digest()
      var modkey_hash = crypto.createHash('sha256').update(config.mod_key).digest()

      if (crypto.timingSafeEqual(data_hash, superkey_hash)) {
        become_potted_plant(client)
        client.superadmin = true

      } else if (crypto.timingSafeEqual(data_hash, adminkey_hash)) {
        become_potted_plant(client)

      } else if (crypto.timingSafeEqual(data_hash, modkey_hash)) {
        become_mod(client)

      } else {
        send_to(client, { n: "system_message", d: { items: [{ text: namegen.deny() }] } })
      }
    }
  }

  /** @param {String} data */
  function request_leave_room(data) {
    if (!rooms[data]) {
      send_to(client, { n: "system_message", d: { items: [{ text: `Room does not exist.` }] } })
      return
    }
    var room = rooms[data]
    if (!room.preventLeaving) {
      remove_user_from_room(client, room)
    } else {
      send_to(client, { n: "system_message", d: { items: [{ text: `Cannot leave that room.` }] } })
    }
  }

  /** @param {String} data */
  function request_join_room(data) {
    var room = rooms[data]
    if (room == undefined) {
      send_to(client, { n: "system_message", d: { loginHide: true, items: [{ text: `Room does not exist.` }] } })
      return
    }
    add_user_to_room(client, room)
  }

  /** @param {String} data */
  function request_change_name(data) {
    if (typeof data === 'string') {
      if (data.length <= 32 && data.length >= 1) {
        client.name = data
        send_to(client, {
          n: "user_update",
          d: { name: data }
        })
        // send_to(client,{n: "system_message", d: {items: [{text: `Your name is now ${data}`}]}})
      } else {
        send_to(client, { n: "system_message", d: { items: [{ text: `Name is too long.` }] } })
      }
    }
  }

  /** @param {{content: String, room: Object}} data */
  function message_sent(data) {
    if (!rooms[data.room]) {
      return
    }

    var room = rooms[data.room]
    if (!room) { return }
    if (user_can_speak_in_room(client, room)) {
      send_to_members(room, {
        n: "message",
        d: {
          room: room.id,
          user: get_client_user_data(client),
          from_id: client.id,
          from_name: client.name,
          content: data.content
        }
      })
    } else {
      send_to(client, {
        n: "system_message", d: {
          icon: "send",
          items: [
            { text: "You are not allowed to speak in " },
            { type: "room", room: get_client_room_data(room, client) },
            { text: "." }
          ]
        }
      })
    }
  }

  client.socket.on('message', function(raw) {
    try {
      var parsed = JSON.parse(raw.toString())
      var event = parsed.n
      var data = parsed.d

      switch (event) {
        case "hello":
          on_login(data)
          break

        case "auth":
          on_auth(data)
          break

        case "create_room":
          if (typeof (data.name) == "string" && (data.type == "public" || data.type == "unlisted")) {
            create_room(data.name, data.type, client)
          }
          break


        case "change_name":
          request_change_name(data)
          break

        case "delete_room":
          if (!rooms[data.id]) {
            return
          }
          delete_room(rooms[data.id], client)
          break

        case "modify_room_user_data":
          console.log(data)
          if (!rooms[data.id] || typeof (data.data) != "object") {
            return
          }
          modify_room_userdata(rooms[data.id], client, data.data)
          break

        case "modify_room_internal_data":
          if (!client.superadmin || !rooms[data.id] || typeof (data.data) != "object") {
            console.log(`User ${client.name} (${client.id}) attempted to modify room internals while not superadmin`)
            return
          }
          modify_room_data(rooms[data.id], client, data.data)
          break

        case "get_online_user_list":
          if (check_user_permission(client, config.list_online_users)) {
            send_to(client, {
              n: "online_user_list",
              d: clients.map((user) => get_client_user_data(user))
            })
          } else {
            send_to(client, { n: "online_user_list", d: {} })
          }
          break

        case "get_public_room_list":
          let pubrooms = []
          Object.values(rooms).forEach((room) => {
            if (room && room.isPublic) {
              pubrooms.push(get_client_room_data(room, client))
            }
          })
          send_to(client, {
            n: "public_room_list",
            d: pubrooms
          })
          break

        case "message":
          message_sent(data)
          break

        case "join_room":
          request_join_room(data.id)
          break

        case "leave_room":
          request_leave_room(data.id)
          break
      }
    } catch (err) {
      console.log(err)
    }
  });
});

(async () => {
  var got = await import('got')
  app.get("/twemoji.js", (req, res) => {
    // https://twemoji.maxcdn.com/v/latest/twemoji.min.js
    // @ts-ignore
    got.got("https://twemoji.maxcdn.com/v/latest/twemoji.min.js").then((val) => {
      res.setHeader("Content-Type", "text/javascript")
      res.send(val.body)
    }).catch((err) => {
      res.sendStatus(500)
      console.log(err)
    })
  })
  app.use("/", express.static("client"))
  app.listen(config.port)
  console.log("listening")
})()


process.on("unhandled_exception", (err) => {
  setTimeout(() => {
    process.exit()
  }, 2000)
})