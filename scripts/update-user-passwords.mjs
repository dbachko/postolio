import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function updateAllPasswords() {
  try {
    // Hash the password "password"
    const hashedPassword = await bcrypt.hash('password', 10)
    
    // Get all users
    const users = await prisma.user.findMany({
      select: { id: true, email: true }
    })
    
    console.log(`Found ${users.length} users to update`)
    
    // Update all users with the new password
    const updateResult = await prisma.user.updateMany({
      data: {
        password: hashedPassword
      }
    })
    
    console.log(`✅ Updated ${updateResult.count} user passwords to "password"`)
    
    // List all users for verification
    console.log('\n📧 User accounts:')
    console.log('==========================================')
    for (const user of users) {
      console.log(`Email: ${user.email}`)
      console.log(`Password: password`)
      console.log('------------------------------------------')
    }
    console.log('==========================================')
    
  } catch (error) {
    console.error('❌ Error updating passwords:', error)
  } finally {
    await prisma.$disconnect()
  }
}

updateAllPasswords()