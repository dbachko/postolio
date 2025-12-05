import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from current working directory (in case caller already set CWD to repo root)
dotenv.config();

// Also try to load .env from the monorepo root (../../../../../.env from this script directory)
const rootEnvPath = path.resolve(__dirname, '../../../../../.env');
dotenv.config({ path: rootEnvPath, override: false });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(
    `OPENAI_API_KEY is not set. Checked process.env and .env at ${rootEnvPath}. ` +
      'Set it in your repo root .env before running generate:demo-images.'
  );
  process.exit(1);
}

// Local output directory for demo images (must match sync-demo-assets script expectations)
const LOCAL_DEMO_DIR = path.resolve(__dirname, '../../demo-assets');

const IMAGES: Array<{ fileName: string; prompt: string }> = [
  {
    fileName: 'post-welcome.png',
    prompt:
      'A square cosmic-themed social media post image: glowing planets, nebula clouds, orbiting UI-like panels and icons floating in space, dark background with neon blue and purple accents, no logos, no words or readable text anywhere, highly detailed digital art, 1:1 aspect ratio.',
  },
  {
    fileName: 'post-testimonial.png',
    prompt:
      'A square social media image showing a small business owner celebrating a milestone: person at a laptop with blurred charts on screen, confetti or subtle celebration elements, cozy workspace, natural lighting, no logos, no readable text, 1:1 aspect ratio.',
  },
  {
    fileName: 'post-bts.png',
    prompt:
      'A behind-the-scenes photo-style social media image: creative team working on content at a desk with camera, notebooks and phones, sticky notes on the wall, warm lighting, no logos or readable text, 1:1 aspect ratio.',
  },
  {
    fileName: 'post-tip.png',
    prompt:
      'A flat-lay social media image of a desk with a notebook, smartphone and coffee cup, subtle infographic shapes in the background, neutral color palette with one bright accent, no logos, no readable text, 1:1 aspect ratio.',
  },
  {
    fileName: 'post-checklist.png',
    prompt:
      'A square social media illustration of an ancient Roman checklist: a stone tablet or parchment with carved checkmarks, Roman columns and laurel wreaths in the background, warm sunset lighting, no modern objects, no letters or readable text anywhere, 1:1 aspect ratio.',
  },
];

async function generateImage(prompt: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1024',
      n: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI image generation failed: ${res.status} ${res.statusText} - ${text}`);
  }

  const json = (await res.json()) as {
    data: Array<{ b64_json: string }>;
  };

  if (!json.data?.[0]?.b64_json) {
    throw new Error('OpenAI response missing image data');
  }

  const buffer = Buffer.from(json.data[0].b64_json, 'base64');
  return buffer;
}

async function main() {
  try {
    await fs.mkdir(LOCAL_DEMO_DIR, { recursive: true });
    console.log(`Generating demo images into ${LOCAL_DEMO_DIR}`);

    for (const img of IMAGES) {
      const outPath = path.join(LOCAL_DEMO_DIR, img.fileName);
      console.log(`→ Generating ${img.fileName}`);
      const buffer = await generateImage(img.prompt);
      await fs.writeFile(outPath, buffer);
      console.log(`   Saved ${outPath}`);
    }

    console.log('Demo image generation complete.');
  } catch (error) {
    console.error('Failed to generate demo images:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
