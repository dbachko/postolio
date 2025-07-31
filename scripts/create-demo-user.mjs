#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function createDemoUser() {
  try {
    console.log('🚀 Creating demo user and brands...')
    
    // Hash the password
    const hashedPassword = await bcrypt.hash('password123', 10)
    
    // Create or update the demo user
    const user = await prisma.user.upsert({
      where: { email: 'demo@example.com' },
      update: {
        password: hashedPassword,
        name: 'Demo User'
      },
      create: {
        email: 'demo@example.com',
        password: hashedPassword,
        name: 'Demo User',
        subscriptionTier: 'premium'
      }
    })
    
    console.log(`✅ Created/updated user: ${user.email}`)
    
    // Define brand data with AI, robots, cyberpunk themes
    const brandsData = [
      {
        name: 'CyberTech Innovations',
        description: 'Cutting-edge AI and robotics company specializing in neural interfaces and autonomous systems',
        styleProfile: {
          tone: 'professional yet edgy',
          style: 'cyberpunk',
          colors: ['neon blue', 'electric purple', 'matrix green'],
          themes: ['artificial intelligence', 'neural networks', 'cyberpunk aesthetics', 'future technology'],
          contentTypes: ['tech demos', 'AI breakthroughs', 'futuristic concepts'],
          targetAudience: 'tech enthusiasts, developers, futurists',
          brandPersonality: 'innovative, mysterious, cutting-edge',
          visualStyle: 'dark backgrounds with neon accents, holographic effects'
        }
      },
      {
        name: 'RoboForge Labs',
        description: 'Advanced robotics manufacturer creating companion robots and industrial automation solutions',
        styleProfile: {
          tone: 'friendly but sophisticated',
          style: 'modern tech',
          colors: ['silver', 'chrome blue', 'warning orange'],
          themes: ['robotics', 'automation', 'AI companions', 'industrial tech'],
          contentTypes: ['robot demonstrations', 'behind the scenes', 'tech tutorials'],
          targetAudience: 'engineers, manufacturers, tech consumers',
          brandPersonality: 'helpful, innovative, trustworthy',
          visualStyle: 'clean industrial design, metallic textures, bright lighting'
        }
      },
      {
        name: 'NeuroLink Digital',
        description: 'Brain-computer interface startup developing next-generation neural implants and AI consciousness',
        styleProfile: {
          tone: 'visionary and scientific',
          style: 'futuristic minimalist',
          colors: ['electric blue', 'neural pink', 'quantum white'],
          themes: ['brain-computer interfaces', 'consciousness', 'neural implants', 'digital minds'],
          contentTypes: ['scientific breakthroughs', 'concept art', 'research updates'],
          targetAudience: 'researchers, investors, early adopters',
          brandPersonality: 'visionary, scientific, boundary-pushing',
          visualStyle: 'minimalist with neural network patterns, brain imagery'
        }
      },
      {
        name: 'Quantum Rebellion',
        description: 'Cyberpunk fashion and lifestyle brand inspired by AI uprising and digital revolution themes',
        styleProfile: {
          tone: 'rebellious and energetic',
          style: 'cyberpunk street',
          colors: ['neon pink', 'toxic green', 'cyber black'],
          themes: ['cyberpunk fashion', 'digital rebellion', 'AI uprising', 'street tech'],
          contentTypes: ['fashion shoots', 'lifestyle content', 'urban photography'],
          targetAudience: 'gamers, cyberpunk enthusiasts, alternative fashion lovers',
          brandPersonality: 'rebellious, edgy, underground',
          visualStyle: 'dark urban environments, neon lighting, glitch effects'
        }
      },
      {
        name: 'Synthetic Minds Studio',
        description: 'AI art collective creating digital consciousness through generative algorithms and machine creativity',
        styleProfile: {
          tone: 'artistic and philosophical',
          style: 'digital art',
          colors: ['holographic rainbow', 'deep purple', 'AI silver'],
          themes: ['AI art', 'generative creativity', 'digital consciousness', 'machine learning'],
          contentTypes: ['AI-generated art', 'creative process', 'philosophical discussions'],
          targetAudience: 'artists, AI researchers, digital art collectors',
          brandPersonality: 'creative, philosophical, experimental',
          visualStyle: 'abstract digital art, flowing algorithms, colorful data visualizations'
        }
      }
    ]
    
    // Create brands for the user
    for (const brandData of brandsData) {
      // Check if brand already exists for this user
      const existingBrand = await prisma.brand.findFirst({
        where: {
          name: brandData.name,
          userId: user.id
        }
      })
      
      let brand
      if (existingBrand) {
        // Update existing brand
        brand = await prisma.brand.update({
          where: { id: existingBrand.id },
          data: {
            description: brandData.description,
            styleProfile: brandData.styleProfile
          }
        })
      } else {
        // Create new brand
        brand = await prisma.brand.create({
          data: {
            name: brandData.name,
            description: brandData.description,
            styleProfile: brandData.styleProfile,
            userId: user.id
          }
        })
      }
      
      console.log(`✅ Created/updated brand: ${brand.name}`)
    }
    
    console.log('\n🎉 Demo user setup complete!')
    console.log('\n📋 Login Details:')
    console.log('Email: demo@example.com')
    console.log('Password: password123')
    console.log('\n🏢 Brands Created:')
    brandsData.forEach((brand, index) => {
      console.log(`${index + 1}. ${brand.name} - ${brand.description}`)
    })
    
  } catch (error) {
    console.error('❌ Error creating demo user:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createDemoUser()