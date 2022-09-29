// @ts-check
const express = require('express')
const uuid = require('uuid')
const http = require('http')
const crypto = require('crypto')
const wss = require('lup-express-ws').default(express())
const app = wss.app
const config = require("./config_handler").config

const namegen = require('./namegen')

const main_room = {
  id: "27b9bef4-ffb7-451e-b010-29870760e2b1",
  name: config.main_channel_name,
  isPublic: true,
  isMain: true,
  autoJoin: true,
  disableJoinMessages: true,
  disableLeaveMessages: true,
  preventDeletion: true,
  members: [],
  muted: {}
}

const shout_room = {
  id: "823d68d9-a20c-409e-b6db-12e313ed9a16",
  name: config.shout_channel_name,
  adminOnly: true,
  isShout: true,
  isPublic: true,
  autoJoin: true,
  disableJoinMessages: true,
  disableLeaveMessages: true,
  disableRoommates: true,
  preventLeaving: true,
  preventDeletion: true,
  members: [],
  muted: {}
}

var clients = []
var messages = []
var rooms = {}

rooms[main_room.id] = main_room
rooms[shout_room.id] = shout_room

function send_to(user,data) {
  user.socket.send(JSON.stringify(data))
}
function send_to_all(data) {
  var s = JSON.stringify(data)
  clients.forEach(c=>c.socket.send(s))
}
function send_to_members(room,data) {
  if (room) {
    var s = JSON.stringify(data)
    room.members.forEach(c=>c.socket.send(s))
  }
}
function send_to_roommates(user,data) {
  var targets = {}
  user.rooms.forEach((room) => {
    if (!room.disableRoommates) {
      room.members.forEach((u) => {
        targets[u] = true
      })
    }
  })
  var s = JSON.stringify(data)
  Object.values(targets).forEach(c=>c.socket.send(s))
}


function get_client_room_data(from,user) {
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
function get_client_user_data(from) {
  var user = {}
  Object.keys(from).forEach((k) => {
    if (k != "socket" && k != "rooms") {
      user[k] = from[k]
    }
  })
  return user
}

function on_new_admin(user) {
  send_to(user,{
    n: "new_admin",
    d: get_client_user_data(user)
  })

  Object.values(rooms).forEach((room) => {
    // @ts-ignore
    if (room && room.adminOnly) {
      send_to(user,{
        n: "muted_in_room",
        d: { id: room.id, muted: false }
      })
    }
  })
}

function become_potted_plant(user) {
  if (user.isAdmin || user.isMod) {
    send_to(user,{
      n: "system_message", d: { items: [{text: "You already did that."}] }
    })
    return
  }
  user.isAdmin = true
  // user.name = "Basil"

  on_new_admin(user)
  
  send_to(user,{
    n: "user_update",
    d: {
      isAdmin: true,
      // name: "Basil",
    }
  })
}

function become_mod(user) {
  if (user.isAdmin || user.isMod) {
    send_to(user,{
      n: "system_message", d: { items: [{text: "You already did that."}] }
    })
    return
  }
  user.isMod = true

  on_new_admin(user)

  send_to(user,{
    n: "user_update",
    d: { isMod: true }
  })
}


function user_can_speak_in_room(user,room) {
  if (room.muted[user.id]) {
    return false
  } else if (room.adminOnly && !(user.isMod || user.isAdmin)) {
    return false
  } else {
    return true
  }
}


function add_user_to_room(user,room,initial) {
  if (room.members.some((u) => u == user)) {
    send_to(user,{n: "system_message", d: {loginHide: true, items: [{text: `You are already a member of that room.`}]}})
    return
  }

  if (!room.disableJoinMessages) {
    send_to_members(room,{n: "system_message", d: {
      loginHide: true,
      items: [
        {text: 'The user '},
        {type: "user", user: get_client_user_data(user)},
        {text: ' has joined '},
        {type: "room", room: get_client_room_data(room,user)},
        {text: '.'}
      ]}})
  }

  // @ts-ignore
  room.members.push(user)
  user.rooms.push(room)
  user.socket.send(JSON.stringify({
    n: "added_to_room",
    d: get_client_room_data(room,user),
    q: initial
  }))
}

function remove_user_from_room(user,room,is_logout) {
  room.members = room.members.filter(u => (u != user))
  user.rooms = user.rooms.filter(r => (r != room))
  if (!is_logout) {
    user.socket.send(JSON.stringify({
      n: "removed_from_room",
      d: get_client_room_data(room,user)
    }))
  }
}

function check_user_permission(user,level) {
  switch (level) {
    case "all": return true
    case "mod": return (user.isAdmin || user.isMod)
    case "admin": return (user.isAdmin)
    case "none": return false
  
    default:
      throw new Error(`Invalid permission level ${level}`)
  }
}

/**
 * @param {String} name
 */
function create_room(name,type,user) {
  if (!config.allow_room_creation) {
    send_to(user,{n: "system_message", d: {items: [{text: "Room creation is disabled."}]}})
  }
  if (name.length < 2) {
    send_to(user,{n: "system_message", d: {items: [{text: "Name is too short!"}]}})
    return
  }
  if (name.length > 32) {
    send_to(user,{n: "system_message", d: {items: [{text: "Name is too long!"}]}})
    return
  }
  var room = {
    id: uuid.v4(),
    name: name,
    adminOnly: false,
    isShout: false,
    isPublic: false,
    autoJoin: false,
    disableRoommates: false,
    preventLeaving: false,
    preventDeletion: false,
    members: [],
    muted: {}
  }
  switch (type) {
    case "public":
      if (user && !check_user_permission(user,config.room_creation_public)) {
        send_to(user,{n: "system_message", d: {items: [{text: "You are not allowed to do that!"}]}})
        return
      } else {
        room.isPublic = true
        break
      }
    case "unlisted": default:
      if (user && !check_user_permission(user,config.room_creation_unlisted)) {
        send_to(user,{n: "system_message", d: {items: [{text: "You are not allowed to do that!"}]}})
        return
      }
  }
  rooms[room.id] = room
  add_user_to_room(user,room)
}

function delete_room(room,user) {
  if (user && !check_user_permission(user,config.room_deletion)) {
    send_to(user,{n: "system_message", d: {items: [{text: namegen.deny()}]}})
    return
  }
  if (room.preventDeletion) {
    if (user) {
      send_to(user,{n: "system_message", d: {items: [{text: "Room cannot be deleted."}]}})
    }
    return
  }
  rooms[room.id] = undefined
  send_to_members(room,{n: "room_deleted", d: get_client_room_data(room)})
  Object.values(room.members).forEach((u) => remove_user_from_room(u,room))
}

app.ws("/ev", function(client_ws, req){
  var client = {
    rooms: [],
    socket: client_ws,
    isAdmin: false,
    isMod: false
  }



  client.socket.on('close', function() {
    console.log(`client '${client.name}' (${client.id}) disconnected`)
    client.rooms.forEach((room) => {
      remove_user_from_room(client,room,true)
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
        add_user_to_room(client,room)
      }
    })
    
    clients.push(client)

    if (config.welcome_message) {
      config.welcome_message.forEach(text => {
        send_to(client,{n: "system_message",d: {
          icon: "waving_hand", items: [ {text: text} ]
        }})
      })
    }

    client.socket.send(JSON.stringify({ n: "login_done", d: {} }))
  }
  
  /** @param {String} data */
  function on_auth(data) {
    if (typeof data === 'string') {
      if (data === config.admin_key) { // TODO: Fix the security issue with this
        become_potted_plant(client)
      } else if (data === config.mod_key) { // TODO: Fix the security issue with this
        become_mod(client)
      } else {
        send_to(client,{n: "system_message", d: {items: [{text: namegen.deny()}]}})
      }
    }
  }

  /** @param {String} data */
  function request_leave_room(data) {
    if (!rooms[data]) {
      send_to(client,{n: "system_message", d: {items: [{text: `Room does not exist.`}]}})
      return
    }
    var room = rooms[data]
    if (!room.preventLeaving) {
      remove_user_from_room(client,room)
    } else {
      send_to(client,{n: "system_message", d: {items: [{text: `Cannot leave that room.`}]}})
    }
  }

  /** @param {String} data */
  function request_join_room(data) {
    var room = rooms[data]
    if (room == undefined) {
      send_to(client,{n: "system_message", d: {loginHide: true, items: [{text: `Room does not exist.`}]}})
      return
    }
    add_user_to_room(client,room)
  }

  /** @param {String} data */
  function request_change_name(data) {
    if (typeof data === 'string') {
      if (data.length <= 32 && data.length >= 1) {
        client.name = data
        send_to(client,{
          n: "user_update",
          d: { name: data }
        })
        // send_to(client,{n: "system_message", d: {items: [{text: `Your name is now ${data}`}]}})
      } else {
        send_to(client,{n: "system_message", d: {items: [{text: `Name is too long.`}]}})
      }
    }
  }

  /** @param {{content: String, room: Object}} data */
  function message_sent(data) {
    if (!Object.keys(rooms).includes(data.room)) {
      return
    }

    var room = rooms[data.room]
    if (!room) { return }
    if (user_can_speak_in_room(client,room)) {
      send_to_members(room,{
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
      send_to(client,{n: "system_message",d: {
        icon: "send",
        items: [
          {text: "You are not allowed to speak in "},
          {type: "room", room: get_client_room_data(room,client)},
          {text: "."}
        ]
      }})
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
          if (typeof(data.name) == "string" && (data.type == "public" || data.type == "unlisted")) {
            create_room(data.name,data.type,client)
          }
          break

        case "change_name":
          request_change_name(data)
          break

        case "delete_room":
          if (!Object.keys(rooms).includes(data.id)) {
            return
          }
          delete_room(rooms[data.id],client)
          break

        case "get_online_user_list":
          if (check_user_permission(client,config.list_online_users)) {
            send_to(client,{
              n: "online_user_list",
              d: clients.map((user) => get_client_user_data(user))
            })
          } else {
            send_to(client,{n: "online_user_list", d: {}})
          }
          break
        
        case "get_public_room_list":
          let pubrooms = []
          Object.values(rooms).forEach((room) => {
            if (room && room.isPublic) {
              pubrooms.push(get_client_room_data(room,client))
            }
          })
          send_to(client,{
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
    } catch(err) {
      console.log(err)
    }
  });
});

(async () => {
  var got = await import('got')
  app.get("/twemoji.js", (req,res) => {
    // https://twemoji.maxcdn.com/v/latest/twemoji.min.js
    // @ts-ignore
    got.got("https://twemoji.maxcdn.com/v/latest/twemoji.min.js").then((val) => {
      res.setHeader("Content-Type","text/javascript")
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


