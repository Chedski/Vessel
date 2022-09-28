// @ts-check
const fs = require('fs');
const yaml = require('js-yaml');

/** @type {{admin_key:string, mod_key:string, port:number}} */
// @ts-ignore
var config = yaml.load(fs.readFileSync('./config.yml').toString())
exports.config = config