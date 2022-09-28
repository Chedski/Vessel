const rws = require('./rws_node').rws
const ws = require('ws')
const readline = require('readline')
const colors = require('@colors/colors')
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})
rl.on('line', (text) => {
  send(text)
  rl.prompt()
})

var user = {
  id: '',
  name: 'no name'
}
var rooms = {}

var socket = new rws('ws://localhost:8692')

socket.onopen = () => {
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
}

socket.onmessage = (real_event) => {
  var raw = real_event.data
  // console.log(raw)
  var parsed = JSON.parse(raw.toString())
  var event = parsed.n
  var data = parsed.d

  switch (event) {
    case "hello":
      will_prompt = (user.id == '')
      user.id = data.id
      user.name = data.name
      console.log(`Your nickname has been set to "`.green + user.name.yellow + `".`.green)
      rl.setPrompt(``)
      if (will_prompt) { rl.prompt() }
      break
    case "added_to_room":
      rooms[data.id] = {
        id: data.id,
        name: data.name
      }
      console.log(`You have been added to the "`.green + data.name.yellow + `" room.`.green)
      break
    case "message":
      console.log(`${data.from_name.cyan}: ${data.content}`)
      break
  }
}

function send(content) {
  if (socket.readyState != ws.OPEN) {
    console.log("Failed to send message - not connected to server".red)
    return
  }
  if (content == '') {
    console.log("cannot send empty messages".red)
    return
  }
  socket.send(JSON.stringify({
    n: "message",
    d: {
      room: Object.keys(rooms)[0],
      content: content
    }
  }))
  console.log(`${user.name.yellow}: ${content}`)
}

