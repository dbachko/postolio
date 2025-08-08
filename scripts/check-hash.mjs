import bcrypt from 'bcrypt'

const hash = '$2b$10$r1HBYKHKuSytBm7a3UMg0evPxdv6uvRpQWaLo.z3zF8rm87VM6H.C'
const password = 'password123'

bcrypt.compare(password, hash, (err, result) => {
  if (err) throw err
  console.log('Password matches hash:', result)
})
