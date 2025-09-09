#!/usr/bin/env tsx

/**
 * Demo User Creation Script
 * Creates demo@example.com user with AI, robots, and cyberpunk themed brands
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEMO_USER = {
  email: "demo@example.com",
  password: "password123",
  name: "Demo User",
  subscriptionTier: "pro",
};

const DEMO_BRANDS = [
  {
    name: "NeuralSync AI",
    description:
      "Advanced AI solutions for neural network synchronization and machine learning optimization",
    styleProfile: {
      style: "modern",
      visualThemes: [
        "neural networks",
        "blue circuits",
        "glowing connections",
        "abstract data flows",
      ],
      brandPersonality: "innovative, technical, professional",
      toneOfVoice:
        "authoritative yet approachable, uses technical terminology but remains accessible",
      keyMessages: [
        "Cutting-edge AI technology",
        "Neural network innovation",
        "Machine learning excellence",
      ],
      targetAudience: "tech professionals, AI researchers, enterprise clients",
      colorPalette: ["electric blue", "deep purple", "silver", "black"],
      contentTypes: [
        "product demos",
        "technical insights",
        "AI breakthrough announcements",
      ],
      hashtagStrategy: [
        "#AI",
        "#MachineLearning",
        "#NeuralNetworks",
        "#Innovation",
        "#TechLeadership",
      ],
    },
  },
  {
    name: "RoboTech Industries",
    description:
      "Next-generation robotics for industrial automation and smart manufacturing",
    styleProfile: {
      style: "professional",
      visualThemes: [
        "industrial robots",
        "manufacturing floors",
        "precision machinery",
        "automated systems",
      ],
      brandPersonality: "reliable, innovative, efficiency-focused",
      toneOfVoice:
        "confident and solution-oriented, emphasizes precision and reliability",
      keyMessages: [
        "Automation excellence",
        "Industrial innovation",
        "Precision robotics",
      ],
      targetAudience:
        "manufacturing companies, industrial engineers, automation specialists",
      colorPalette: ["steel gray", "orange accents", "white", "dark blue"],
      contentTypes: ["case studies", "product showcases", "industry insights"],
      hashtagStrategy: [
        "#Robotics",
        "#Automation",
        "#Industry40",
        "#Manufacturing",
        "#Innovation",
      ],
    },
  },
  {
    name: "CyberNeon Labs",
    description:
      "Cyberpunk-inspired tech solutions for the digital underground and crypto economy",
    styleProfile: {
      style: "vibrant",
      visualThemes: [
        "neon cityscapes",
        "holographic interfaces",
        "cyberpunk aesthetics",
        "digital glitch art",
      ],
      brandPersonality: "edgy, rebellious, cutting-edge, mysterious",
      toneOfVoice:
        "bold and provocative, uses tech slang and cyberpunk terminology",
      keyMessages: ["Digital revolution", "Crypto freedom", "Underground tech"],
      targetAudience:
        "crypto enthusiasts, tech rebels, digital artists, gamers",
      colorPalette: ["neon pink", "electric cyan", "deep purple", "black"],
      contentTypes: [
        "crypto updates",
        "tech manifesto",
        "digital art showcases",
      ],
      hashtagStrategy: [
        "#Cyberpunk",
        "#Crypto",
        "#DigitalRevolution",
        "#Neon",
        "#FutureIsNow",
      ],
    },
  },
  {
    name: "Quantum Minds",
    description:
      "AI consciousness research and quantum computing applications for the future of intelligence",
    styleProfile: {
      style: "luxury",
      visualThemes: [
        "quantum particles",
        "consciousness visualization",
        "abstract AI minds",
        "futuristic laboratories",
      ],
      brandPersonality: "visionary, philosophical, scientifically rigorous",
      toneOfVoice:
        "intellectual and thought-provoking, balances scientific accuracy with accessibility",
      keyMessages: [
        "Quantum intelligence",
        "Consciousness research",
        "Future of AI",
      ],
      targetAudience:
        "researchers, academics, tech visionaries, science enthusiasts",
      colorPalette: ["deep gold", "quantum blue", "silver", "dark gray"],
      contentTypes: [
        "research insights",
        "philosophical discussions",
        "breakthrough announcements",
      ],
      hashtagStrategy: [
        "#QuantumComputing",
        "#AIConsciousness",
        "#Research",
        "#Future",
        "#Innovation",
      ],
    },
  },
  {
    name: "SteelCore Mechs",
    description:
      "Combat robotics and mech suits for defense applications and extreme environments",
    styleProfile: {
      style: "professional",
      visualThemes: [
        "military mechs",
        "armored suits",
        "combat scenarios",
        "industrial strength",
      ],
      brandPersonality: "tough, reliable, mission-critical",
      toneOfVoice:
        "authoritative and mission-focused, emphasizes durability and performance",
      keyMessages: [
        "Combat-ready technology",
        "Extreme environment solutions",
        "Military-grade reliability",
      ],
      targetAudience:
        "defense contractors, military personnel, extreme environment workers",
      colorPalette: ["military green", "steel gray", "red accents", "black"],
      contentTypes: [
        "capability demonstrations",
        "mission reports",
        "technology specifications",
      ],
      hashtagStrategy: [
        "#DefenseRobotics",
        "#MechSuits",
        "#MilitaryTech",
        "#CombatReady",
        "#Durability",
      ],
    },
  },
  {
    name: "Digital Dystopia",
    description:
      "Cyberpunk fashion and tech accessories for the style-conscious digital nomad",
    styleProfile: {
      style: "vibrant",
      visualThemes: [
        "cyberpunk fashion",
        "LED accessories",
        "urban street style",
        "tech-wear",
      ],
      brandPersonality: "stylish, rebellious, trend-setting, urban",
      toneOfVoice:
        "trendy and lifestyle-focused, speaks to the cyberpunk aesthetic",
      keyMessages: ["Cyberpunk style", "Tech fashion", "Digital lifestyle"],
      targetAudience:
        "fashion enthusiasts, cyberpunk fans, digital nomads, urban professionals",
      colorPalette: ["neon green", "hot pink", "electric blue", "matte black"],
      contentTypes: ["fashion showcases", "lifestyle content", "trend reports"],
      hashtagStrategy: [
        "#CyberpunkFashion",
        "#TechWear",
        "#DigitalStyle",
        "#FutureFashion",
        "#UrbanTech",
      ],
    },
  },
];

async function createDemoUser() {
  console.log("🤖 Creating demo user and AI/robotics/cyberpunk brands...\n");

  try {
    // Check if demo user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: DEMO_USER.email },
    });

    if (existingUser) {
      console.log(
        `⚠️  Demo user ${DEMO_USER.email} already exists. Deleting existing data...`,
      );

      // Delete existing brands and content for this user
      await prisma.content.deleteMany({
        where: {
          brand: {
            userId: existingUser.id,
          },
        },
      });

      await prisma.campaign.deleteMany({
        where: {
          brand: {
            userId: existingUser.id,
          },
        },
      });

      await prisma.brand.deleteMany({
        where: {
          userId: existingUser.id,
        },
      });

      await prisma.user.delete({
        where: { id: existingUser.id },
      });

      console.log("✅ Cleaned up existing demo data");
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(DEMO_USER.password, 10);

    // Create demo user
    console.log("👤 Creating demo user...");
    const user = await prisma.user.create({
      data: {
        email: DEMO_USER.email,
        password: hashedPassword,
        name: DEMO_USER.name,
        subscriptionTier: DEMO_USER.subscriptionTier,
      },
    });
    console.log(`✅ Created user: ${user.email} (ID: ${user.id})`);

    // Create demo brands
    console.log("\n🏢 Creating demo brands...");
    const createdBrands = [];

    for (const brandData of DEMO_BRANDS) {
      const brand = await prisma.brand.create({
        data: {
          name: brandData.name,
          description: brandData.description,
          userId: user.id,
          styleProfile: brandData.styleProfile,
        },
      });

      createdBrands.push(brand);
      console.log(`✅ Created brand: ${brand.name} (ID: ${brand.id})`);
      console.log(`   Description: ${brand.description}`);
      console.log(`   Style: ${brandData.styleProfile.style}`);
      console.log(
        `   Themes: ${brandData.styleProfile.visualThemes.join(", ")}\n`,
      );
    }

    console.log("🎉 Demo setup complete!\n");
    console.log("📧 Login credentials:");
    console.log(`   Email: ${DEMO_USER.email}`);
    console.log(`   Password: ${DEMO_USER.password}`);
    console.log(`   User ID: ${user.id}`);

    console.log("\n🏢 Created brands:");
    createdBrands.forEach((brand, index) => {
      console.log(`   ${index + 1}. ${brand.name} (${brand.id})`);
    });

    console.log("\n🚀 You can now:");
    console.log("   • Log in with the demo credentials");
    console.log("   • Create campaigns for any of the brands");
    console.log("   • Test priority and coordination features");
    console.log("   • Generate AI content with the established style profiles");
  } catch (error) {
    console.error("❌ Error creating demo user:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createDemoUser().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}

export { createDemoUser };
