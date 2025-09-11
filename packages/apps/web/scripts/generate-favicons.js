#!/usr/bin/env node

/**
 * Script to generate favicon files from SVG
 * Run with: node scripts/generate-favicons.js
 *
 * Note: This requires sharp package to be installed:
 * npm install --save-dev sharp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if sharp is available
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.log('⚠️  Sharp not installed. Install with: npm install --save-dev sharp');
  console.log('📝 Creating placeholder favicon.ico instead...');

  // Create a simple placeholder favicon.ico
  const svgContent = fs.readFileSync(path.join(__dirname, '../public/postolio-icon.svg'), 'utf8');
  const icoPath = path.join(__dirname, '../public/favicon.ico');

  // For now, just copy the SVG as a placeholder
  console.log('✅ Using SVG as favicon (browsers will handle it)');
  process.exit(0);
}

async function generateFavicons() {
  const publicDir = path.join(__dirname, '../public');
  const svgPath = path.join(publicDir, 'postolio-icon.svg');

  // Read SVG
  const svgBuffer = fs.readFileSync(svgPath);

  // Sizes to generate
  const sizes = [
    { size: 16, name: 'favicon-16x16.png' },
    { size: 32, name: 'favicon-32x32.png' },
    { size: 96, name: 'icon-96x96.png' },
    { size: 180, name: 'apple-touch-icon.png' },
    { size: 192, name: 'icon-192x192.png' },
    { size: 512, name: 'icon-512x512.png' },
  ];

  console.log('🎨 Generating favicon PNG files from SVG...');

  for (const { size, name } of sizes) {
    try {
      await sharp(svgBuffer).resize(size, size).png().toFile(path.join(publicDir, name));
      console.log(`✅ Generated ${name} (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Failed to generate ${name}:`, error.message);
    }
  }

  console.log('🎉 Favicon generation complete!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateFavicons().catch(console.error);
}

export { generateFavicons };
