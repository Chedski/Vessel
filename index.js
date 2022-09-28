// @ts-check
const e = require('express')
const express = require('express')
const uuid = require('uuid')
const crypto = require('crypto')
const wss = require('lup-express-ws').default(express())
const app = wss.app
const config = require("./config_handler").config

const namegen = require('./namegen')

const main_room = {
  id: "27b9bef4-ffb7-451e-b010-29870760e2b1",
  name: 'Main',
  members: [],
  muted: {}
}

const shout_room = {
  id: "823d68d9-a20c-409e-b6db-12e313ed9a16",
  name: 'Shouts',
  adminOnly: true,
  disableRoommates: true,
  preventLeaving: true,
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
  var s = JSON.stringify(data)
  room.members.forEach(c=>c.socket.send(s))
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
  console.log(user)
  return user
}

function on_new_admin(user) {
  send_to_all({
    n: "new_admin",
    d: get_client_user_data(user)
  })

  send_to(user,{
    n: "muted_in_room",
    d: { id: shout_room.id, muted: false }
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

app.ws("/", function(client_ws, req){
  var client = {
    rooms: [main_room],
    socket: client_ws,
    isAdmin: false,
    isMod: false
  }



  client.socket.on('close', function() {
    console.log(`client '${client.name}' (${client.id}) disconnected`)
    client.rooms.forEach((room) => {
      console.log(room)
      room.members = room.members.filter(user => (user != client))
    })
    clients = clients.filter(user => (user != client))
  })

  
  client.socket.on('message', function(raw) {
    console.log(raw.toString())
    var parsed = JSON.parse(raw.toString())
    var event = parsed.n
    var data = parsed.d

    switch (event) {
      case "hello":
        if (data.user) {
          client.id = data.user.id
          client.name = data.user.name
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
      
        client.socket.send(JSON.stringify({
          n: "added_to_room",
          d: get_client_room_data(main_room,client),
          q: true
        }))

        client.socket.send(JSON.stringify({
          n: "added_to_room",
          d: get_client_room_data(shout_room,client),
          q: true
        }))
        
        clients.push(client)
        // @ts-ignore
        main_room.members.push(client)
        // @ts-ignore
        shout_room.members.push(client)
        break

      case "auth":
        if (typeof data === 'string') {
          if (data === config.admin_key) { // TODO: Fix the security issue with this
            become_potted_plant(client)
          } else if (data === config.mod_key) { // TODO: Fix the security issue with this
            become_mod(client)
          } else {
            send_to(client,{n: "system_message", d: {items: [{text: namegen.deny()}]}})
          }
        }
        break

      case "change_name":
        if (typeof data === 'string') {
          if (data.length <= 32) {
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
        break

      case "message":
        var room = rooms[data.room]
        console.log(room)
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
        break
      case "join_room":
        console.log(data.room)
        break
    }
  });
});

app.listen(config.port)
console.log("listening")
