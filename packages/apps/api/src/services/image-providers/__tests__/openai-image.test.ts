import { describe, expect, it, vi } from 'vitest';
import { generateOpenAIImage } from '../openai-image.js';

function clientReturning(data: unknown[]) {
  const generate = vi.fn().mockResolvedValue({ data });
  return { client: { images: { generate } } as any, generate };
}

describe('generateOpenAIImage', () => {
  it('decodes base64 output, since GPT image models never return URLs', async () => {
    const { client } = clientReturning([{ b64_json: Buffer.from('png').toString('base64') }]);

    const result = await generateOpenAIImage(client, {
      prompt: 'p',
      size: '1024x1024',
      quality: 'auto',
    });

    expect(result.imageBuffer.toString()).toBe('png');
  });

  it('maps settings saved for DALL-E 3 to supported values', async () => {
    const { client, generate } = clientReturning([{ b64_json: 'AA==' }]);

    await generateOpenAIImage(client, { prompt: 'p', size: '1792x1024', quality: 'hd' });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2', size: '1536x1024', quality: 'high' })
    );
  });

  it('fails when the response has no image data', async () => {
    const { client } = clientReturning([{ url: 'https://example.test/x.png' }]);

    await expect(
      generateOpenAIImage(client, { prompt: 'p', size: '1024x1024', quality: 'auto' })
    ).rejects.toThrow('No image data');
  });
});
