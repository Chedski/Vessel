var user = {
  id: '',
  name: 'no name',
  active_room: null,
  isAdmin: false,
  isMod: false
}
var rooms = {}

var shoutSound = new Audio("shout.mp3")
shoutSound.load()
shoutSound.volume = 1

var adminSound = new Audio("become_admin.mp3")
adminSound.load()
adminSound.volume = 1

const main_room_id = "27b9bef4-ffb7-451e-b010-29870760e2b1"
const shout_room_id = "823d68d9-a20c-409e-b6db-12e313ed9a16"

var socket_url = 'ws://localhost:8692'
if (window.location.hash) {
  socket_url = window.location.hash
}

var socket = new ReconnectingWebSocket(socket_url,[],{automaticOpen: false})

function qspan(text,...classes) {
  if (classes[0] instanceof Array) { classes = classes[0] }
  var span = document.createElement("span")
  classes.forEach((c) => { span.classList.add(c) })
  span.innerText = text
  return span
}

function qicon(name) {
  return qspan(name,"material-icons","md-18","txt_icon")
}

function username_span(target,add_colon) {
  var span = qspan("","username")
  if (target.id == user.id) { span.classList.add("my_username") }
  else { span.classList.add("other_username") }

  var should_add_space = false

  if (target.isAdmin) {
    should_add_space = true
    span.classList.add("admin_username")
    span.appendChild(qicon("eco"))
  }
  else if (target.isMod) {
    should_add_space = true
    span.classList.add("mod_username")
    span.appendChild(qicon("security"))
  }

  var txt = target.name
  if (should_add_space) { txt = " " + txt }
  if (add_colon) { txt += ": " }
  var txt_span = qspan(txt)
  txt_span.onclick = () => {
    navigator.clipboard.writeText(user.id)
    var ctxt = "(copied id)"
    if (should_add_space) { ctxt = " " + ctxt }
    if (add_colon) { ctxt += ": " }
    txt_span.innerText = ctxt
    setTimeout(() => {txt_span.innerText = txt},500)
  }
  span.appendChild(txt_span)
  return span
}

function room_span(target,add_arrow) {
  var span = qspan("","room_name")

  var should_add_space = false

  if (target.id == shout_room_id) { // shout room
    should_add_space = true
    span.appendChild(qicon("campaign"))
  }

  var txt = target.name
  if (should_add_space) { txt = " " + txt }
  if (add_arrow) { txt += " > " }
  
  var txt_span = qspan(txt)
  
  txt_span.onclick = () => {
    navigator.clipboard.writeText(target.id)
    var ctxt = "(copied id)"
    if (should_add_space) { ctxt = " " + ctxt }
    if (add_arrow) { ctxt += " > " }
    txt_span.innerText = ctxt
    setTimeout(() => {txt_span.innerText = txt},500)
  }
  span.appendChild(txt_span)

  return span
}

/**
 * @param {Node} node
 */
function add_to_holder(node) {
  var holder = document.getElementById("message_holder")
  var current_scroll = (holder.scrollHeight - holder.clientHeight)
  var should_scroll = current_scroll == holder.scrollTop

  holder.appendChild(node)

  if (should_scroll) {
    holder.style.scrollBehavior = "auto"
    holder.scrollTop = (holder.scrollHeight - holder.clientHeight)
    holder.style.scrollBehavior = "smooth"
  }
}

/*
    message from other user
    <div class="message user other">
      <span class="username">
        <span>yeehaw: </span>
      </span>
      <span class="message_txt">active user other</span>
    </div>

    message from self
    <div class="message user me">
      <span class="username">
        <span>augh: </span>
      </span>
      <span class="message_txt">active self</span>
    </div>

    message from me
    <div class="message user other admin">
      <span class="username">
        <span class="material-icons txt_icon">eco</span>
        <span> Basil: </span>
      </span>
      <span class="message_txt">its an active message from me :3</span>
    </div>

    message from mod
    <div class="message user other mod">
      <span class="username">
        <span class="material-icons txt_icon">security</span>
        <span> fuwwy: </span>
      </span>
      <span class="message_txt">its an active message from a mod :3</span>
    </div>
*/

/**
 * @param {Array<String>} classes 
 * @param {String} icon
 * @param {Array<Node>} parts
 */
function build_system_message(classes,icon,...parts) {
  if (parts[0] instanceof Array) {
    parts = parts[0]
  }

  console.log(classes)
  var div = document.createElement("div")
  div.classList.add("message","system",...classes)

  var systemtag = document.createElement("span")
  systemtag.classList.add("systemtag")
  systemtag.appendChild(qicon(icon))
  systemtag.appendChild(qspan(" "))
  div.appendChild(systemtag)

  parts.forEach((part) => { div.appendChild(part) })

  return div
}

/**
 * @param {Array<Node>} parts
 */
function system_message(...parts) {
  add_to_holder(build_system_message([],"settings",...parts))
}
function icon_message(icon,...parts) {
  add_to_holder(build_system_message([],icon,...parts))
}

function new_admin(who) {
  if (who.id == user.id) {
    add_to_holder(
      build_system_message(["newadmin"],"construction",qspan("you're an amdin now! welcome to hell"))
    )
    adminSound.play()
  } else {
    add_to_holder(
      build_system_message(["newadmin"],"construction",qspan("The user "),username_span(who),qspan(" has passed the vibe check."))
    )
  }
}

function display_user_message(message) {
  var div = document.createElement("div")
  div.classList.add("message","user")
  console.log(message)

  if (message.user.id == user.id) { div.classList.add("me") }
  else { div.classList.add("other") }

  if (message.user.isAdmin) { div.classList.add("admin") }
  else if (message.user.isMod) { div.classList.add("mod") }

  if (message.room.id == shout_room_id) {
    div.classList.add("shout")
    if (message.user.id != user.id) { shoutSound.play() }
  }

  div.appendChild(room_span(message.room,true))
  div.appendChild(username_span(message.user,true))
  div.appendChild(qspan(message.content))

  console.log(div)

  add_to_holder(div);
}

function set_active_room(room) {
  user.active_room = room
  document.getElementById("active_room_name").replaceChildren(room_span(room))

  icon_message("swap_horiz",qspan("Your active room is now "),room_span(user.active_room),qspan("."))
  // icon_message("signpost",qspan("Your active room is now "),room_span(user.active_room),qspan("."))

  if (user.active_room.muted) {
    icon_message("send",qspan("You are not allowed to speak in "),room_span(user.active_room),qspan("."))
  }
}

/**
 * @param {String} str The text to search for
 */
function room_by_name(str) {
  var list = Object.values(rooms)
  var found = list.filter((room) => {
    var v = false
    if (room.name.toLocaleLowerCase().startsWith(str.toLocaleLowerCase())) { v = true }
    if (str.toLowerCase() == room.id.toLowerCase()) { v = true }
    return v
  })
  if (found.length != 0) {
    return found[0]
  } else {
    throw "No matching rooms found. Make sure you've joined the room you're trying to switch to."
  }
}

/**
 * @param {String} content
 */
function send(content) {
  if (typeof content == "string") {
    content = content.trim()
  }
  if (content.startsWith("/")) {
    var sp = content.substring(1).split(' ',1)
    var cmd = sp[0]
    var args = content.substring(cmd.length + 2)

    switch (cmd) {
      case "clear":
        var holder = document.getElementById("message_holder")
        holder.innerHTML = ""
        system_message(qspan("Cleared."))
        document.getElementById("message_content").value = ""
        return
      case "c": case "switch": case "room":
        if (args == '') {
          system_message(qspan(`Syntax: /room <name or id>`))
          system_message(qspan(`Partial room names, (eg. "ma"), are allowed, and will select the first found room.`))
          return
        }
        var room
        try {
          room = room_by_name(args)
        } catch(err) {
          system_message(qspan(err))
          return
        }
        set_active_room(room)
        document.getElementById("message_content").value = "" 
        return
      case "auth":
        if (args != '') {
          socket.send(JSON.stringify({n: "auth", d: args}))
          return
        }
      case "nick":
        if (args == '') {
          system_message(qspan(`Syntax: /nick <nickname>`))
          system_message(qspan(`Changes your nickname.`))
          return
        } else {
          socket.send(JSON.stringify({n: "change_name", d: args}))
          return
        }
      default:
        system_message(qspan(`The command /${cmd} was not found.`))
    }
    return
  }
  if (socket.readyState != WebSocket.OPEN) {
    system_message(qspan("Not connected to server"))
    return
  }
  if (content == '') {
    system_message(qspan("Cannot send empty messages"))
    return
  }
  if (!user.active_room) {
    if (Object.keys(rooms).length == 0) {
      system_message(qspan("How are you not in any rooms? It's not supposed to be possible to leave "),room_span({id: "823d68d9-a20c-409e-b6db-12e313ed9a16", name: 'Shouts'}),qspan("!"))
      return
    }
    console.log("no active room! trying to switch to Main")
    var new_room
    if (Object.keys(rooms).includes("27b9bef4-ffb7-451e-b010-29870760e2b1")) {
      new_room = rooms["27b9bef4-ffb7-451e-b010-29870760e2b1"]
    } else {
      new_room = Object.values(rooms)[0]
    }
    set_active_room(new_room)
    
  }
  if (user.active_room.muted) {
    icon_message("send",qspan("You are not allowed to speak in "),room_span(user.active_room),qspan("."))
    return
  }

  socket.send(JSON.stringify({
    n: "message",
    d: {
      room: user.active_room.id,
      content: content
    }
  }))
  document.getElementById("message_content").value = ""
}


var was_connected = false
var is_first_open = true
socket.onopen = () => {
  was_connected = true
  document.getElementById("preload_icons").hidden = true
  if (user.id != '') {
    socket.send(JSON.stringify({
      n: "hello",
      d: {
        user: {
          id: user.id,
          name: user.name
        }
      }
    }))
  } else {
    socket.send(JSON.stringify({n: "hello", d: {}}))
  }

  if (is_first_open) { is_first_open = false }
  else { system_message(qspan("Connected!")) }
}

socket.onclose = () => {
  document.getElementById("preload_icons").hidden = false
  if (was_connected) {
    system_message(qspan("Lost connection to server..."))
    was_connected = false
  }
}

socket.onmessage = (real_event) => {
  var raw = real_event.data
  // console.log(raw)
  var parsed = JSON.parse(raw.toString())
  var event = parsed.n
  var data = parsed.d

  switch (event) {
    
    case "hello":
      user.id = data.id
      user.name = data.name
      icon_message("edit",qspan('Your nickname is now '),username_span(user),qspan('.'))
      console.log(`Your nickname has been set to "` + user.name + `".`)
      document.getElementById("title").innerText = `Vessel (${user.name})`
      break
    
    case "user_update":
      var keys = Object.keys(data)
      keys.forEach((k) => { user[k] = data[k] })

      if (keys.includes("name")) {
        icon_message("edit",qspan('Your nickname is now '),username_span(user),qspan('.'))
        document.getElementById("title").innerText = `Vessel (${user.name})`
      }

      break
    
    case "muted_in_room":
      var room = rooms[data.id]
      room.muted = data.muted
      if (data.muted) {
        system_message(qspan('You are no longer allowed to speak in '),room_span(room),qspan('.'))
        console.log(`You are no longer allowed to speak in the "` + room.name + `" room.`)
      } else {
        system_message(qspan('You are now allowed to speak in '),room_span(room),qspan('.'))
        console.log(`You are now allowed to speak in the "` + room.name + `" room.`)
      }
      break
    
    case "added_to_room":
      rooms[data.id] = data
      icon_message("forum",qspan('You have been added to '),room_span(data),qspan('.'))
      if (!user.active_room) {
        set_active_room(data)
      }
      console.log(`You have been added to the "` + data.name + `" room.`)
      break
    
    case "removed_from_room":
      var id = data.id
      var room = rooms[id]
      icon_message("forum",qspan('You have been removed from '),room_span(room),qspan('.'))
      console.log(`You have been removed from the "` + room.name + `" room.`)
      rooms[id] = null
      break
    
    case "message":
      data.room = rooms[data.room]
      display_user_message(data)
      break
    
    case "new_admin":
      console.log(data)
      new_admin(data)
      break

    case "system_message":
      console.log(data.items)
      var items = []
      data.items.forEach((itm) => {
        switch (itm.type) {
          
          case "user":
            items.push(username_span(itm.user))
            break
          
          case "room":
            items.push(room_span(itm.room))
            break
          
          default: // text
            if (!itm.classes) { itm.classes = [] }
            items.push(qspan(itm.text,itm.classes))
            break
          
        }
      })

      console.log(data.classes)
      add_to_holder(
        build_system_message(
          data.classes || [],
          data.icon || 'settings',
          items
        )
      )
      break
  }
}

function loading_done() {
  setTimeout(socket.open,1000)
  document.getElementById("message_content").addEventListener("keyup", ({key}) => {
    if (key === "Enter") {
      send(document.getElementById("message_content").value)
    }
})
}
