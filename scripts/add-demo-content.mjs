#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addDemoContent() {
  try {
    console.log('🤖 Adding sample content for demo brands...')
    
    // Get the demo user
    const user = await prisma.user.findUnique({
      where: { email: 'demo@example.com' }
    })
    
    if (!user) {
      console.log('❌ Demo user not found. Run create-demo-user.mjs first.')
      return
    }
    
    // Get CyberTech Innovations brand
    const cyberTechBrand = await prisma.brand.findFirst({
      where: {
        name: 'CyberTech Innovations',
        userId: user.id
      }
    })
    
    if (!cyberTechBrand) {
      console.log('❌ CyberTech Innovations brand not found.')
      return
    }
    
    // Sample content for CyberTech Innovations
    const sampleContent = [
      {
        caption: "🧠 Neural interface breakthrough achieved! Our latest prototype allows direct thought-to-digital communication at 99.7% accuracy. The future of human-AI collaboration is here. #AI #NeuralInterface #TechBreakthrough #Innovation",
        hashtags: ["#AI", "#NeuralInterface", "#TechBreakthrough", "#Innovation", "#CyberTech", "#FutureTech", "#BrainComputer", "#TechRevolution"],
        imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&h=600&fit=crop",
        status: "pending"
      },
      {
        caption: "⚡ Quantum processors now online! Our new AI cores operate at 1000x faster processing speeds while consuming 90% less energy. Sustainable AI is no longer just a dream. #QuantumComputing #SustainableAI #TechInnovation",
        hashtags: ["#QuantumComputing", "#SustainableAI", "#TechInnovation", "#GreenTech", "#AI", "#Innovation", "#CyberTech", "#FutureTech"],
        imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&h=600&fit=crop",
        status: "pending"
      },
      {
        caption: "🌐 Autonomous city infrastructure now live in Neo-Tokyo test zone. Our AI systems manage traffic, energy, and security with zero human intervention. Welcome to the smart city revolution! #SmartCity #Automation #AI #UrbanTech",
        hashtags: ["#SmartCity", "#Automation", "#AI", "#UrbanTech", "#Innovation", "#CyberTech", "#FutureTech", "#SmartInfrastructure"],
        imageUrl: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1f?w=800&h=600&fit=crop",
        status: "approved",
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
      }
    ]
    
    // Add content to database
    for (const content of sampleContent) {
      const createdContent = await prisma.content.create({
        data: {
          ...content,
          brandId: cyberTechBrand.id,
          generationParams: {
            theme: 'AI technology',
            style: 'cyberpunk',
            isDemo: true
          }
        }
      })
      console.log(`✅ Added content: ${createdContent.caption.substring(0, 50)}...`)
    }
    
    // Get RoboForge Labs brand and add one piece of content
    const roboForgeBrand = await prisma.brand.findFirst({
      where: {
        name: 'RoboForge Labs',
        userId: user.id
      }
    })
    
    if (roboForgeBrand) {
      const robotContent = await prisma.content.create({
        data: {
          caption: "🤖 Meet ARIA-7, our latest companion robot! Features advanced emotional intelligence, natural conversation, and adaptive learning. Pre-orders start next month! #Robotics #CompanionBot #AI #Innovation",
          hashtags: ["#Robotics", "#CompanionBot", "#AI", "#Innovation", "#RoboForge", "#EmotionalAI", "#FutureTech"],
          imageUrl: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&h=600&fit=crop",
          status: "pending",
          brandId: roboForgeBrand.id,
          generationParams: {
            theme: 'robotics',
            style: 'modern tech',
            isDemo: true
          }
        }
      })
      console.log(`✅ Added robot content: ${robotContent.caption.substring(0, 50)}...`)
    }
    
    console.log('\n🎉 Demo content added successfully!')
    console.log('\n📱 You can now:')
    console.log('1. Login with demo@example.com / password123')
    console.log('2. View pending content for approval')
    console.log('3. Create campaigns using the Autopilot feature')
    console.log('4. Edit and approve content')
    
  } catch (error) {
    console.error('❌ Error adding demo content:', error)
  } finally {
    await prisma.$disconnect()
  }
}

addDemoContent()