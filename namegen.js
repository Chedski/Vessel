var adj = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'bright',
  'fluffy',
  'small',
  'big',
  'sleepy',
  'funny',
  'cheerful',
  'some kind of'
]
var noun = [
  'cat',
  'dog',
  'mouse',
  'deer',
  'parrot',
  'finch',
  'fish',
  'squid',
  'octopus',
  'dragon',
  'moose',
  'bnuy',
  'anteater',
]

function gen() {
  return adj[Math.floor(Math.random()*adj.length)] + " " + noun[Math.floor(Math.random()*noun.length)]
}
exports.gen = gen

var deny_quotes = [
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "...",
  "Nope.",
  "Nope.",
  "Nope.",
  "Nope.",
  "Nope.",
  "No, sir.",
  "No, sir.",
  "No, sir.",
  "No, sir.",
  "No, sir.",
  "No way.",
  "No way.",
  "No way.",
  "No way.",
  "No way.",
  "Why are you asking me?",
  "Why are you asking me?",
  "Why are you asking me?",
  "What is that smell?",
  "This is as far as I go.",
  "Are you thinking what I'm thinking?",
  "Did you have any idea they were working on this kind of stuff?",
  "My god, what are you doing?",
  "What the hell is this?",
  "Why do we all have to wear these ridiculous ties?",
  "I suspected this could happen but the Administrator just would not listen.",
  "Do you think we should appeal to the alien authorities?",
  "Do you suspect some alien subterfuge behind this failure?",
  "Did you understand that last announcement?",
  "Have you been able to get the beverage machine to work yet?",
  "What the hell is going on with our equipment?",
  "They're waiting for you, Gordon. In the Test Chamberrrrrrrr.",
  "Climb up and start the rotors.",
  "Quick! It's about to go critical!",
  "Very good. We'll take it from here.",
  "Power to stage one emitters in three... two... one...",
  "I'm seeing predictable phase arrays.",
  "Stage two emitters activating... now.",
  "Standard insertion for a nonstandard specimen.",
  "Overhead capacitors to one oh five percent.",
  "Get away from the beams!",
  "Shutting down. Attempting shut down. It's not... it's- it's not... it's not shutting down... it's not...",
  "Take me with you! I'm the one man who knows everything!",
  "Fat lot of good that Ph.D. does me now, hm?",
  "Why do we all have to wear these ridiculous ties?",
  "Do you smell what I smell?",
]
function deny() {
  return deny_quotes[Math.floor(Math.random()*deny_quotes.length)]
}
exports.deny = deny