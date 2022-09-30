var user = {
  id: '',
  name: 'no name',
  active_room: null,
  isAdmin: false,
  isMod: false
}
var rooms = {}

const january_proxy_url = "https://chedski.net/january/proxy?url="
const january_embed_url = "https://chedski.net/january/embed?url="

var session_data = {
  auth_key: null,
  nickname: null,
  active_room: null,
  room_access: {}
}

try {
  session_data.nickname = sessionStorage.getItem("nickname")
  session_data.auth_key = sessionStorage.getItem("auth_key")
  session_data.active_room = sessionStorage.getItem("active_room")
  session_data.room_access = JSON.parse(sessionStorage.getItem("room_access")) || {}
} catch (err) {
  console.log(err)
}

var shoutSound = new Audio("shout.mp3")
shoutSound.load()
shoutSound.volume = 1

var adminSound = new Audio("become_admin.mp3")
adminSound.load()
adminSound.volume = 1

var server = {
  main_room_id: "27b9bef4-ffb7-451e-b010-29870760e2b1",
  shout_room_id: "823d68d9-a20c-409e-b6db-12e313ed9a16",
  public_rooms: []
}

var on_pubroom_update = null

// Automatically generate the websocket URL from the current page
var socket_url = `${window.location.protocol == "https:" ? "wss" : "ws"}://${window.location.host}${window.location.pathname.replace("/index.html", "")}${window.location.pathname.endsWith("/") ? "" : "/"}ev`

if (window.location.hash) {
  socket_url = window.location.hash
}

var socket = new ReconnectingWebSocket(socket_url, [], { automaticOpen: false })

var room_delete_quotes = [
  " has been nuked from orbit.",
  " was reduced to atoms.",
  " has been destroyed.",
  " has been obliterated.",
]

// Markdown
function md(mdText) {

  // first, handle syntax for code-block
  mdText = mdText.replace(/\r\n/g, '\n')
  mdText = mdText.replace(/\n~~~ *(.*?)\n([\s\S]*?)\n~~~/g, '<pre><code title="$1">$2</code></pre>')
  mdText = mdText.replace(/\n``` *(.*?)\n([\s\S]*?)\n```/g, '<pre><code title="$1">$2</code></pre>')

  mdText = mdText.replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

  // split by "pre>", skip for code-block and process normal text
  var mdHTML = ''
  var mdCode = mdText.split('pre>')

  for (var i = 0; i < mdCode.length; i++) {
    if (mdCode[i].substr(-2) == '</') {
      mdHTML += '<pre>' + mdCode[i] + 'pre>'
    } else {
      mdHTML += mdCode[i].replace(/(.*)<$/, '$1')
        .replace(/`(.*?)`/gm, '<code>$1</code>')
        .replace(/\[(.*?)\]\(\)/gm, '<a href="$1" target="_blank">$1</a>')
        .replace(/\[(.*?)\]\((.*?)\)/gm, '<a href="$2" target="_blank">$1</a>')
        .replace(/\*\*\*(.*)\*\*\*/gm, '<b><em>$1</em></b>')
        .replace(/\*\*(.*)\*\*/gm, '<b>$1</b>')
        .replace(/\*([\w \d]*)\*/gm, '<em>$1</em>')
        .replace(/___(.*)___/gm, '<b><em>$1</em></b>')
        .replace(/__(.*?)__/gm, '<u>$1</u>')
        .replace(/~~(.*)~~/gm, '<del>$1</del>')
        .replace(/\^\^(.*)\^\^/gm, '<ins>$1</ins>')
        .replace(/\\([`_\\\*\+\-\.\(\)\[\]\{\}])/gm, '$1')
        .replace(/(?<!["'=])http(s?:\/\/[^ ?#]*\??[^ #]*?#?[^ ]*)/gm, '<a href="http$1">http$1</a>')
      // .replace(/^##### (.*?)\s*#*$/gm, '<h5>$1</h5>')
      // .replace(/^#### (.*?)\s*#*$/gm, '<h4 id="$1">$1</h4>')
      // .replace(/^### (.*?)\s*#*$/gm, '<h3 id="$1">$1</h3>')
      // .replace(/^## (.*?)\s*#*$/gm, '<h2 id="$1">$1</h2>')
      // .replace(/^# (.*?)\s*#*$/gm, '<h1 id="$1">$1</h1>')    
      // .replace(/^-{3,}|^\_{3,}|^\*{3,}/gm, '<hr/>')    
      // .replace(/``(.*?)``/gm, '<code>$1</code>' )
      // .replace(/^\>> (.*$)/gm, '<blockquote><blockquote>$1</blockquote></blockquote>')
      // .replace(/^\> (.*$)/gm, '<blockquote>$1</blockquote>')
      // .replace(/<\/blockquote\>\n<blockquote\>/g, '\n<br>' )
      // .replace(/<\/blockquote\>\n<br\><blockquote\>/g, '\n<br>' )
      // .replace(/!\[(.*?)\]\((.*?) "(.*?)"\)/gm, '<img alt="$1" src="$2" $3 />')
      // .replace(/!\[(.*?)\]\((.*?)\)/gm, '<img alt="$1" src="$2" />')
      // .replace(/\[(.*?)\]\((.*?) "(.*?)"\)/gm, '<a href="$2" title="$3">$1</a>')
      // .replace(/^[\*|+|-][ |.](.*)/gm, '<ul><li>$1</li></ul>' ).replace(/<\/ul\>\n<ul\>/g, '\n' )
      // .replace(/^\d[ |.](.*)/gm, '<ol><li>$1</li></ol>' ).replace(/<\/ol\>\n<ol\>/g, '\n' )
      // .replace(/_([\w \d]*)_/gm, '<em>$1</em>')
      // .replace(/ +\n/g, '\n<br/>')
      // .replace(/\n\s*\n/g, '\n<p>\n')
      // .replace(/^ {4,10}(.*)/gm, '<pre><code>$1</code></pre>' )
      // .replace(/^\t(.*)/gm, '<pre><code>$1</code></pre>' )
      // .replace(/<\/code\><\/pre\>\n<pre\><code\>/g, '\n' )
    }
  }


  return mdHTML
}

/**
 * @param {String} text
 * @returns {RegExpMatchArray[]}
 */
function getLinks(text) {
  return Array.from(text.matchAll(/(?<!["'=])(https?:\/\/[^ ?#]*\??[^ #]*?#?[^ ]*)/gm))
}


// Builders
/**
 * @param {String} text
 * @returns {HTMLSpanElement}
 */
function qicon(name) {
  return qspan(name, "material-icons", "md-18", "txt_icon")
}
/**
 * @param {String} text
 * @param {Array<String>} classes
 * @returns {HTMLSpanElement}
 */
function qspan(text, ...classes) {
  if (classes[0] instanceof Array) { classes = classes[0] }
  var span = document.createElement("span")
  classes.forEach((c) => { span.classList.add(c) })
  span.innerText = text
  try { twemoji.parse(span, { folder: 'svg', ext: '.svg' }) } catch (err) { /*console.log(err)*/ }
  return span
}
/**
 * @param {String} text
 * @param {Array<String>} classes
 * @returns {HTMLSpanElement}
 */
function qspan_md(text, ...classes) {
  if (classes[0] instanceof Array) { classes = classes[0] }
  var span = document.createElement("span")
  classes.forEach((c) => { span.classList.add(c) })
  span.innerHTML = md(text)//.replace(/\n/g,"")).replace(/^<p>/,"").replace(/<\/p>$/,"")
  try { twemoji.parse(span, { folder: 'svg', ext: '.svg' }) } catch (err) { /*console.log(err)*/ }
  return span
}

function username_span(target, add_colon) {
  var span = qspan("", "username")
  if (target.id == user.id) { span.classList.add("my_username") }
  else { span.classList.add("other_username") }

  var should_add_space = false

  if (target.isAdmin) {
    should_add_space = true
    span.classList.add("admin_username")
    span.appendChild(qicon("security"))
  }
  else if (target.isMod) {
    should_add_space = true
    span.classList.add("mod_username")
    span.appendChild(qicon("shield"))
  }

  var txt = target.name
  if (should_add_space) { txt = " " + txt }
  if (add_colon) { txt += ": " }
  var txt_span = qspan(txt)
  txt_span.onclick = () => {
    try { navigator.clipboard.writeText(user.id) }
    catch (err) { system_message(qspan(`Failed to copy ID: ${user.id}`)) }
    var ctxt = "(copied id)"
    if (should_add_space) { ctxt = " " + ctxt }
    if (add_colon) { ctxt += ": " }
    txt_span.innerText = ctxt
    setTimeout(() => { txt_span.innerText = txt }, 500)
  }
  span.appendChild(txt_span)
  return span
}

function room_span(target, add_arrow) {
  var span = qspan("", "room_name")

  var should_add_space = false

  if (target.isShout) {
    should_add_space = true
    span.appendChild(qicon("campaign"))

  } else if (target.isPublic) {
    should_add_space = true
    span.appendChild(qicon("public"))

  } else if (target.isEncrypted) {
    should_add_space = true
    span.appendChild(qicon("lock"))

  } else {
    // should_add_space = true
    // span.appendChild(qicon("lock"))

  }

  var txt = target.name
  if (should_add_space) { txt = " " + txt }
  if (add_arrow) { txt += " > " }

  var txt_span = qspan(txt)

  txt_span.onclick = () => {
    try { navigator.clipboard.writeText(target.id) }
    catch (err) { system_message(qspan(`Failed to copy ID: ${target.id}`)) }
    var ctxt = "(copied id)"
    if (should_add_space) { ctxt = " " + ctxt }
    if (add_arrow) { ctxt += " > " }
    txt_span.innerText = ctxt
    setTimeout(() => { txt_span.innerText = txt }, 500)
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
  var should_scroll = current_scroll >= (holder.scrollTop - 100)

  holder.appendChild(node)

  if (should_scroll) {
    holder.style.scrollBehavior = "auto"
    holder.scrollTop = (holder.scrollHeight - holder.clientHeight)
    holder.style.scrollBehavior = "smooth"
  }
}

/**
 * @param {Array<String>} classes 
 * @param {String} icon
 * @param {Array<Node>} parts
 */
function build_system_message(classes, icon, ...parts) {
  if (parts[0] instanceof Array) {
    parts = parts[0]
  }

  var div = document.createElement("div")
  div.classList.add("message", "system", ...classes)

  var systemtag = document.createElement("span")
  systemtag.classList.add("systemtag")
  systemtag.appendChild(qicon(icon))
  systemtag.appendChild(qspan(" "))
  div.appendChild(systemtag)

  parts.forEach((part) => { div.appendChild(part) })

  return div
}

// regex stuff
const videoLinkRegex = /(.mp4|.mov|.webm|.avi)$/g
const audioLinkRegex = /(.mp3|.m4a|.ogg|.wav|.flac)$/g
const imageLinkRegex = /(.png|.gif|.jpg|.jpeg|.webp)$/g

// Messages

/**
 * @param {Array<Node>} parts
 */
function system_message(...parts) {
  add_to_holder(build_system_message([], "settings", ...parts))
}

/**
 * @param {String} icon
 * @param {Array<Node>} parts
 */
function icon_message(icon, ...parts) {
  add_to_holder(build_system_message([], icon, ...parts))
}

function new_admin(who) {
  if (who.id == user.id) {
    add_to_holder(
      build_system_message(["newadmin"], "construction", qspan("you're an amdin now! welcome to hell"))
    )
    try {
      adminSound.play()
    } catch (err) {
      console.log("couldn't play admin sound (probably auto auth)")
    }
  } else {
    add_to_holder(
      build_system_message(["newadmin"], "construction", qspan("The user "), username_span(who), qspan(" has passed the vibe check."))
    )
  }
}


/**
 * @param {Node} holder
 * @param {Node} node
 */
function add_to_div(holder, node) {
  var mholder = document.getElementById("message_holder")
  var current_scroll = (mholder.scrollHeight - mholder.clientHeight)
  var should_scroll = current_scroll >= (mholder.scrollTop - 100)

  holder.appendChild(node)

  if (should_scroll) {
    mholder.style.scrollBehavior = "auto"
    mholder.scrollTop = (mholder.scrollHeight - mholder.clientHeight)
    mholder.style.scrollBehavior = "smooth"
  }
}

/**
 * @param {HTMLDivElement} message_div
 * @param {RegExpMatchArray[]} links
 */
function display_embeds(message_div, links) {
  return new Promise((resolve, reject) => {

    var duplicates = {}
    var embeds = 0
    links.forEach(
      /** @param {RegExpMatchArray} link */
      (link) => {
        if (!(embeds >= 3 || duplicates[link[0]])) {
          duplicates[link[0]] = true
          embeds++
          var xhr = new XMLHttpRequest()
          xhr.timeout = 15000
          xhr.responseType = 'json'
          xhr.addEventListener("load", () => {
            var result = xhr.response
            console.log(link[0])
            console.log(result)
            var url = result.url
            var type = result.type
            if (url && type) {
              if (type == "Video") {
                /** @type {HTMLVideoElement} */
                var video = document.createElement('video')
                video.preload = "metadata"
                video.controls = true
                video.autoplay = false
                video.src = january_proxy_url + url
                if (result.height) { video.height = Math.min(result.height, 320) }

                var d2 = document.createElement("div")
                d2.appendChild(video)
                d2.classList.add("mediaholder")
                add_to_div(message_div, d2)

              } else if (type == "Audio") {
                /** @type {HTMLAudioElement} */
                var audio = document.createElement('audio')
                audio.preload = "none"
                audio.controls = true
                audio.autoplay = false
                audio.src = january_proxy_url + url

                var d2 = document.createElement("div")
                d2.appendChild(audio)
                d2.classList.add("mediaholder")
                add_to_div(message_div, d2)

              } else if (type == "Image") {
                /** @type {HTMLImageElement} */
                var image = document.createElement('img')
                image.src = january_proxy_url + url
                if (result.height) { image.height = Math.min(result.height, 320) }

                var d2 = document.createElement("div")
                d2.appendChild(image)
                d2.classList.add("mediaholder")
                add_to_div(message_div, d2)
              } else if (type == "Website" && result.special && result.special.type == "YouTube") {
                /** @type {HTMLIFrameElement} */
                var frame = document.createElement('iframe')
                frame.allowFullscreen = true
                // frame.sandbox = "allow-scripts, allow-same-origin"
                frame.src = "https://www.youtube-nocookie.com/embed/" + result.special.id
                if (result.video && result.video.height) {
                  frame.height = Math.min(result.video.height, 320)
                  if (result.video.width) {
                    frame.width = Math.ceil(result.video.width * (frame.height / result.video.height))
                  }
                }

                var d2 = document.createElement("div")
                d2.appendChild(frame)
                d2.classList.add("mediaholder")
                add_to_div(message_div, d2)
              } else if (type == "Website" && result.video && result.video.url) {
                if (result.video.url.endsWith("gif")) {
                  /** @type {HTMLImageElement} */
                  var image = document.createElement('img')
                  image.src = january_proxy_url + result.video.url
                  if (result.video.height) { image.height = Math.min(result.video.height, 320) }

                  var d2 = document.createElement("div")
                  d2.appendChild(image)
                  d2.classList.add("mediaholder")
                  add_to_div(message_div, d2)
                } else {
                  /** @type {HTMLVideoElement} */
                  var video = document.createElement('video')
                  video.preload = "metadata"
                  video.controls = true
                  video.autoplay = false
                  video.src = january_proxy_url + result.video.url
                  if (result.video.height) { video.height = Math.min(result.video.height, 320) }

                  var d2 = document.createElement("div")
                  d2.appendChild(video)
                  d2.classList.add("mediaholder")
                  add_to_div(message_div, d2)
                }
              } else if (type == "Website" && ((result.opengraph_type && result.opengraph_type.startsWith("image")) || result.site_name && result.site_name == "Imgur") && result.image && result.image.url) {
                /** @type {HTMLImageElement} */
                var image = document.createElement('img')
                image.src = january_proxy_url + result.image.url
                if (result.image.height) { image.height = Math.min(result.image.height, 320) }

                var d2 = document.createElement("div")
                d2.appendChild(image)
                d2.classList.add("mediaholder")
                add_to_div(message_div, d2)
              }
            }
          })
          xhr.addEventListener("error", (err) => {
            console.log(err)
          })
          xhr.open("GET", january_embed_url + link[0])
          // xhr.withCredentials = false
          // xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
          // xhr.setRequestHeader('Access-Control-Allow-Origin', '*')
          xhr.send()
        }
      })
  })
}

function display_user_message(message) {
  var div = document.createElement("div")
  div.classList.add("message", "user")

  if (message.user.id == user.id) { div.classList.add("me") }
  else { div.classList.add("other") }

  if (message.user.isAdmin) { div.classList.add("admin") }
  else if (message.user.isMod) { div.classList.add("mod") }

  if (message.room.isShout) {
    div.classList.add("shout")
    if (message.user.id != user.id) { shoutSound.play() }
  }

  div.appendChild(room_span(message.room, true))
  div.appendChild(username_span(message.user, true))
  div.appendChild(qspan_md(message.content))


  display_embeds(div, getLinks(message.content))

  add_to_holder(div);
}

// topbar
function update_topbar() {
  document.getElementById("active_room_name").replaceChildren(room_span(user.active_room))
  document.getElementById("nickname").replaceChildren(username_span(user))
  document.getElementById("active_room_name").hidden = false
  document.getElementById("nickname").hidden = false
  document.getElementById("titlebar_sep").hidden = false
}

// Room stuff
function set_active_room(room) {
  user.active_room = room


  update_topbar()

  if (!logging_in) { icon_message("swap_horiz", qspan("Your active room is now "), room_span(user.active_room), qspan(".")) }
  // icon_message("signpost",qspan("Your active room is now "),room_span(user.active_room),qspan("."))

  if (user.active_room.muted) {
    icon_message("send", qspan("You are not allowed to speak in "), room_span(user.active_room), qspan("."))
  }

  if (!logging_in) {
    session_data.active_room = room.id
    try { sessionStorage.setItem("active_room", room.id) } catch (err) { console.log(err) }
  }
}


function leave_room(room) {
  if (room.preventLeaving) {
    icon_message("send", qspan("You aren't able to leave "), room_span(user.active_room), qspan("."))
    return
  }
  room.leaving = true
  if (user.active_room == room) {
    var new_room
    if (room.id != server.main_room_id && Object.keys(rooms).includes(server.main_room_id)) {
      new_room = rooms[server.main_room_id]
    } else {
      new_room = Object.values(rooms)[0] == room ? Object.values(rooms)[0] : Object.values(rooms[1])
    }
    set_active_room(new_room)
  }

  socket.send(JSON.stringify({ n: "leave_room", d: { id: room.id } }))
}

/**
 * @param {String} str The text to search for
 */
function room_by_name(str) {
  var list = Object.values(rooms)
  var found = list.filter((room) => {
    if (room) {
      var v = false
      if (room.name.toLocaleLowerCase().startsWith(str.toLocaleLowerCase())) { v = true }
      if (str.toLowerCase() == room.id.toLowerCase()) { v = true }
      return v
    }
  })
  if (found.length != 0) {
    return found[0]
  } else {
    throw "No matching rooms found. Make sure you've joined the room you're trying to reference."
  }
}



// Commands

/** @param {String} args */
function command_help(args) {
  icon_message("info", qspan(`Available commands:`))
  icon_message("info", qspan(`/help - Shows this message.`))
  icon_message("info", qspan(`/clear - Clears the screen.`))
  icon_message("info", qspan(`/nick - Changes your nickname.`))
  icon_message("info", qspan(`/c - Changes your active room (the one your messages go to).`))
  icon_message("info", qspan(`/online - Shows you a list of online users.`))
  icon_message("info", qspan(`/rooms - Lists the rooms you're in.`))
  icon_message("info", qspan(`/public - Lists publically joinable rooms.`))
  icon_message("info", qspan(`/join - Joins a room.`))
  icon_message("info", qspan(`/leave - Leaves a room.`))
  icon_message("info", qspan(`/createroom - Creates an unlisted room, which can be joined using the ID.`))
  icon_message("info", qspan(`/createpublicroom - Creates a public room, which is publically listed and joinable.`))
}

/** @param {String} args */
function command_clear_screen(args) {
  var holder = document.getElementById("message_holder")
  holder.innerHTML = ""
  system_message(qspan("Cleared."))
  document.getElementById("message_content").value = ""
}

/** @param {String} args */
function command_switch_rooms(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /room <name or id>`))
    system_message(qspan(`Partial room names, (eg. "ma"), are allowed, and will select the first found room.`))
    return
  }
  var room
  try {
    room = room_by_name(args)
  } catch (err) {
    console.log(err)
    system_message(qspan(err))
    return
  }
  set_active_room(room)
  document.getElementById("message_content").value = ""
}

/** @param {String} args */
function command_leave_room(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /leave <name or id>`))
    system_message(qspan(`Partial room names, (eg. "ma"), are allowed, and will select the first found room.`))
    return
  }
  var room
  try {
    room = room_by_name(args)
  } catch (err) {
    system_message(qspan(err))
    return
  }
  leave_room(room)
  document.getElementById("message_content").value = ""
}

/** @param {String} args */
function command_join_room(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /join <name or id>`))
    system_message(qspan(`Partial room names, (eg. "ma"), are allowed, and will select the first found room.`))
    return
  }
  if (args.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "") == "") {
    socket.send(JSON.stringify({ n: "join_room", d: { id: args } }))
  } else {
    /** @param {Array<Object>} list */
    on_pubroom_update = (list) => {
      var found = list.filter((room) => {
        if (room) {
          var v = false
          if (room.name.toLocaleLowerCase().startsWith(args.toLocaleLowerCase())) { v = true }
          return v
        }
      })
      if (found.length != 0) {
        socket.send(JSON.stringify({ n: "join_room", d: { id: found[0].id } }))
      } else {
        system_message(qspan("No matching public rooms were found. If you're trying to join a non-public room, use its ID."))
      }
      on_pubroom_update = null
    }
    socket.send(JSON.stringify({ n: "get_public_room_list", d: args }))
  }
}

/** @param {String} args */
function command_delete_room(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /delete <name or id>`))
    system_message(qspan(`Partial room names, (eg. "ma"), are allowed, and will select the first found room.`))
    return
  }
  if (args.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "") == "") {
    socket.send(JSON.stringify({ n: "delete_room", d: { id: args } }))
  } else {
    /** @param {Array<Object>} list */
    on_pubroom_update = (list) => {
      var found = list.filter((room) => {
        if (room) {
          var v = false
          if (room.name.toLocaleLowerCase().startsWith(args.toLocaleLowerCase())) { v = true }
          return v
        }
      })
      if (found.length != 0) {
        socket.send(JSON.stringify({ n: "delete_room", d: { id: found[0].id } }))
      } else {
        system_message(qspan("No matching public rooms were found. If you're trying to delete a non-public room, use its ID."))
      }
      on_pubroom_update = null
    }
    socket.send(JSON.stringify({ n: "get_public_room_list", d: args }))
  }
}

/** @param {String} args */
function command_create_public_room(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /createpublicroom <name>`))
    system_message(qspan(`Creates a room that is publically listed and joinable by anyone.`))
    return
  }
  socket.send(JSON.stringify({ n: "create_room", d: { type: "public", name: args } }))
}

/** @param {String} args */
function command_create_unlisted_room(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /createroom <name>`))
    system_message(qspan(`Creates a room that is hidden and joinable using the ID.`))
    return
  }
  socket.send(JSON.stringify({ n: "create_room", d: { type: "unlisted", name: args } }))
}

/** @param {String} args */
function command_list_online(args) {
  socket.send(JSON.stringify({ n: "get_online_user_list", d: args }))
  document.getElementById("message_content").value = ""
}

/** @param {String} args */
function command_list_public_rooms(args) {
  socket.send(JSON.stringify({ n: "get_public_room_list", d: args }))
  document.getElementById("message_content").value = ""
}

/** @param {String} args */
function command_list_rooms(args) {
  var memrooms = Object.values(rooms)
  var si = memrooms.length == 1
  var items = [qspan(`You are a member of ${memrooms.length} room${si ? '' : 's'}: `)]
  for (let i = 0; i < memrooms.length; i++) {
    const room = memrooms[i]
    if (i != 0) { items.push(qspan(", ")) }
    items.push(room_span(room))
  }
  system_message(...items)
  system_message(qspan("Run /public to get a list of joinable rooms."))
}

/** @param {String} args */
function command_auth(args) {
  if (args != '') {
    if (session_data.auth_key != args) {
      session_data.auth_key = args
      try { sessionStorage.setItem("auth_key", args) } catch (err) { console.log(err) }
    }
    socket.send(JSON.stringify({ n: "auth", d: args }))
    return
  }
}

/** @param {String} args */
function command_change_nickname(args) {
  if (args == '') {
    system_message(qspan(`Syntax: /nick <nickname>`))
    system_message(qspan(`Changes your nickname.`))
  } else {
    socket.send(JSON.stringify({ n: "change_name", d: args }))
  }
}


// Send message handler

/**
 * @param {String} content
 */
function send(content) {
  if (typeof content == "string") {
    content = content.trim()
  }
  if (content.startsWith("/")) {
    var sp = content.substring(1).split(' ', 1)
    var cmd = sp[0]
    var args = content.substring(cmd.length + 2)

    switch (cmd) {
      case "help":
        command_help(args)
        return
      case "clear":
        command_clear_screen(args)
        return
      case "ls":
        command_list_online(args)
        command_list_rooms(args)
        command_list_public_rooms(args)
        return
      case "c": case "switch": case "room": case "sw":
        command_switch_rooms(args)
        return
      case "online": case "users": case "who": case "lsu":
        command_list_online(args)
        return
      case "rooms": case "lsr":
        command_list_rooms(args)
        return
      case "public": case "publicrooms": case "lsp":
        command_list_public_rooms(args)
        return
      case "deleteroom":
        command_delete_room(args)
        return
      case "createroom": case "newroom": case "createunlistedroom": case "createhiddenroom":
        command_create_unlisted_room(args)
        return
      case "createpublicroom": case "newpublicroom":
        command_create_public_room(args)
        return
      case "join":
        command_join_room(args)
        return
      case "leave":
        command_leave_room(args)
        return
      case "auth":
        command_auth(args)
        return
      case "nick":
        command_change_nickname(args)
        return
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
      system_message(qspan(`Somehow, you're not in any rooms. This is a problem.`))
      return
    }
    console.log("no active room! trying to switch to main channel")
    var new_room
    if (Object.keys(rooms).includes(server.main_room_id)) {
      new_room = rooms[server.main_room_id]
    } else {
      new_room = Object.values(rooms)[0]
    }
    set_active_room(new_room)

  }
  if (user.active_room.muted) {
    icon_message("send", qspan("You are not allowed to speak in "), room_span(user.active_room), qspan("."))
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

var logging_in = false
var was_connected = false
var is_first_open = true
socket.onopen = () => {
  logging_in = true
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
  } else if (session_data.nickname) {
    socket.send(JSON.stringify({
      n: "hello",
      d: {
        user: {
          name: session_data.nickname
        }
      }
    }))
  } else {
    socket.send(JSON.stringify({ n: "hello", d: {} }))
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
  var parsed = JSON.parse(raw.toString())
  var event = parsed.n
  var data = parsed.d

  switch (event) {

    case "hello":
      user.id = data.id
      user.name = data.name
      if (!logging_in) { icon_message("edit", qspan('Your nickname is now '), username_span(user), qspan('.')) }
      console.log(`Your nickname has been set to "` + user.name + `".`)
      document.getElementById("title").innerText = `Vessel (${user.name})`
      break

    case "user_update":
      var keys = Object.keys(data)
      keys.forEach((k) => { user[k] = data[k] })
      update_topbar()
      if (keys.includes("name")) {
        icon_message("edit", qspan('Your nickname is now '), username_span(user), qspan('.'))
        document.getElementById("title").innerText = `Vessel (${user.name})`
        session_data.nickname = user.name
        try { sessionStorage.setItem("nickname", user.name) } catch (err) { console.log(err) }
      }

      break

    case "online_user_list":
      var users = data
      if (users.length == 0) {
        if (!logging_in) { system_message(qspan(`You are not allowed to list online users.`)) }
      } else {
        var si = users.length == 1
        var items = [qspan(`There ${si ? 'is' : 'are'} ${users.length} user${si ? '' : 's'} online: `)]
        for (let i = 0; i < users.length; i++) {
          const user = users[i]
          if (i != 0) { items.push(qspan(", ")) }
          items.push(username_span(user))
        }
        system_message(...items)
      }
      break

    case "public_room_list":
      if (on_pubroom_update != null) {
        on_pubroom_update(data)
      } else {
        var pubrooms = data
        var si = pubrooms.length == 1
        var items = [qspan(`There ${si ? 'is' : 'are'} ${pubrooms.length} public room${si ? '' : 's'}: `)]
        for (let i = 0; i < pubrooms.length; i++) {
          const room = pubrooms[i]
          if (i != 0) { items.push(qspan(", ")) }
          items.push(room_span(room))
        }
        system_message(...items)
      }

      break

    case "login_done":
      if (session_data.auth_key) {
        command_auth(session_data.auth_key)
      }
      socket.send(JSON.stringify({ n: "get_online_user_list", d: "" }))
      if (session_data.room_access) {
        Object.keys(session_data.room_access).forEach((id) => {
          if (session_data.room_access[id]) {
            socket.send(JSON.stringify({ n: "join_room", d: { id: id } }))
          }
        })
      }

      setTimeout(() => {
        if (session_data.active_room) {
          try {
            set_active_room(room_by_name(session_data.active_room))
          } catch (err) { console.log(err) }
        }
      }, 500)
      setTimeout(() => { logging_in = false }, 1000)

      break

    case "muted_in_room":
      var room = rooms[data.id]
      room.muted = data.muted
      if (data.muted) {
        system_message(qspan('You are no longer allowed to speak in '), room_span(room), qspan('.'))
        console.log(`You are no longer allowed to speak in the "` + room.name + `" room.`)
      } else {
        system_message(qspan('You are now allowed to speak in '), room_span(room), qspan('.'))
        console.log(`You are now allowed to speak in the "` + room.name + `" room.`)
      }
      break

    case "added_to_room":
      rooms[data.id] = data
      if (!logging_in) { icon_message("forum", qspan('You have been added to '), room_span(data), qspan('.')) }
      if (!user.active_room) {
        set_active_room(data)
      }
      session_data.room_access[data.id] = {}
      try { sessionStorage.setItem("room_access", JSON.stringify(session_data.room_access)) } catch (err) { console.log(err) }
      console.log(`You have been added to the "` + data.name + `" room.`)
      break

    case "removed_from_room":
      var id = data.id
      var room = rooms[id]
      if (room.leaving) {
        icon_message("forum", qspan('You have left '), room_span(room), qspan('.'))
      } else {
        icon_message("forum", qspan('You have been removed from '), room_span(room), qspan('.'))
      }
      console.log(`You have been removed from the "` + room.name + `" room.`)
      rooms[id] = undefined
      session_data.room_access[data.id] = undefined
      try { sessionStorage.setItem("room_access", JSON.stringify(session_data.room_access)) } catch (err) { console.log(err) }
      set_active_room(rooms[server.main_room_id] || rooms[server.shout_room_id])
      break

    case "room_deleted":
      var room = data
      var quote = room_delete_quotes[Math.floor(Math.random() * room_delete_quotes.length)]
      add_to_holder(
        build_system_message(["nuke"], "delete_forever", qspan("The room "), room_span(room), qspan(quote))
      )

      break

    case "message":
      data.room = rooms[data.room]
      display_user_message(data)
      break

    case "new_admin":
      new_admin(data)
      break

    case "system_message":
      if (logging_in && data.loginHide) {
        console.log("Hiding loginHide message:", data)
        return
      }
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
            items.push(qspan_md(itm.text, itm.classes))
            break

        }
      })

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
  //system_message(qspan(`Connecting to server ${socket_url}`))
  setTimeout(socket.open, 1000)
  document.body.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey && event.key != "V") && !event.metaKey && !event.altKey && event.key != "Shift") {
      document.getElementById("message_content").focus()
    }
  })
  document.getElementById("message_content").addEventListener("keyup", ({ key, shiftKey }) => {
    if (key === "Enter" && !shiftKey) {
      send(document.getElementById("message_content").value)
    }
  })
}
