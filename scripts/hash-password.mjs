#!/usr/bin/env node
// Prints a password and its AUTH_PASSWORD_HASH value. Without an argument, a random password is generated.
import { generatePassword, hashPassword } from '../lib/password.mjs';

const generated = process.argv[2] === undefined;
const password = generated ? generatePassword() : process.argv[2];

if (generated) console.log(`Password: ${password}`);
console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
