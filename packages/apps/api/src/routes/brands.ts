import { FastifyPluginAsync } from 'fastify';

import { verifyJWT } from '../services/jwt.js';
import { analyzeBrandStyle, type PostAnalysis } from '../services/ai.js';

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

interface BrandAnalysisBody {
  brandName: string;
  posts: PostAnalysis[];
}

interface CreateBrandBody {
  name: string;
  description?: string;
}

interface UpdateBrandBody {
  name?: string;
  description?: string;
}

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new brand
  fastify.post<{ Body: CreateBrandBody }>('/create', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const token = authHeader.substring(7);
      let decoded;
      try {
        decoded = verifyJWT(token);
      } catch (jwtError) {
        console.error('JWT verification error:', jwtError);
        return reply.code(401).send({ error: 'Invalid authentication token' });
      }
      const userId = decoded.id;

      const { name, description } = request.body;

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return reply.code(400).send({ error: 'Brand name is required' });
      }

      if (name.length > 100) {
        return reply.code(400).send({ error: 'Brand name must be less than 100 characters' });
      }

      const brand = await prisma.brand.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          userId,
        },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
        },
      });

      return reply.code(201).send({ brand });
    } catch (error) {
      console.error('Brand creation error:', error);

      // Handle specific Prisma errors
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return reply.code(400).send({ error: 'A brand with this name already exists' });
      }

      return reply.code(500).send({ error: 'Failed to create brand. Please try again.' });
    }
  });

  // Analyze brand from Instagram posts
  fastify.post<{ Body: BrandAnalysisBody }>('/analyze', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const token = authHeader.substring(7);
      const decoded = verifyJWT(token);
      const userId = decoded.id;

      const { brandName, posts } = request.body;

      if (!posts || posts.length === 0) {
        return reply.code(400).send({ error: 'At least one post is required for analysis' });
      }

      // Perform AI analysis
      const analysis = await analyzeBrandStyle(posts, brandName);

      // Create brand with analysis results
      const brand = await prisma.brand.create({
        data: {
          name: brandName,
          // Store analysis outputs as JSON (Prisma.JsonValue)
          styleProfile: JSON.parse(JSON.stringify(analysis.styleProfile)),
          preferences: JSON.parse(
            JSON.stringify({
              recommendations: analysis.recommendations,
              confidence: analysis.confidence,
              analysisDate: new Date().toISOString(),
            })
          ),
          userId,
        },
        select: {
          id: true,
          name: true,
          styleProfile: true,
          preferences: true,
          createdAt: true,
        },
      });

      return reply.code(201).send({ brand, analysis });
    } catch (error) {
      console.error('Brand analysis error:', error);
      return reply.code(500).send({ error: 'Failed to analyze brand' });
    }
  });

  // Get user's brands
  fastify.get('/list', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const token = authHeader.substring(7);
      const decoded = verifyJWT(token);
      const userId = decoded.id;

      const brands = await prisma.brand.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          description: true,
          styleProfile: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return { brands };
    } catch (error) {
      console.error('Brands list error:', error);
      return reply.code(500).send({ error: 'Failed to retrieve brands' });
    }
  });

  // Get specific brand details
  fastify.get<{ Params: { id: string } }>('/brand/:id', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const token = authHeader.substring(7);
      const decoded = verifyJWT(token);
      const userId = decoded.id;

      const { id } = request.params;

      const brand = await prisma.brand.findFirst({
        where: {
          id,
          userId, // Ensure user owns this brand
        },
        select: {
          id: true,
          name: true,
          description: true,
          styleProfile: true,
          preferences: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      return { brand };
    } catch (error) {
      console.error('Brand details error:', error);
      return reply.code(500).send({ error: 'Failed to retrieve brand details' });
    }
  });

  // Update a brand
  fastify.put<{ Params: { id: string }; Body: UpdateBrandBody }>(
    '/brand/:id',
    async (request, reply) => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const token = authHeader.substring(7);
        let decoded;
        try {
          decoded = verifyJWT(token);
        } catch (jwtError) {
          console.error('JWT verification error:', jwtError);
          return reply.code(401).send({ error: 'Invalid authentication token' });
        }
        const userId = decoded.id;

        const { id } = request.params;
        const { name, description } = request.body;

        // Validate at least one field is provided
        if (!name && description === undefined) {
          return reply.code(400).send({ error: 'At least one field must be provided for update' });
        }

        // Validate name if provided
        if (name !== undefined) {
          if (!name || name.trim().length === 0) {
            return reply.code(400).send({ error: 'Brand name cannot be empty' });
          }
          if (name.length > 100) {
            return reply.code(400).send({ error: 'Brand name must be less than 100 characters' });
          }
        }

        // Check if brand exists and user owns it
        const existingBrand = await prisma.brand.findFirst({
          where: {
            id,
            userId,
          },
        });

        if (!existingBrand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Prepare update data with explicit typing
        interface BrandUpdateData {
          name?: string;
          description?: string | null;
        }
        const updateData: BrandUpdateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || null;

        // Update the brand
        const updatedBrand = await prisma.brand.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            name: true,
            description: true,
            styleProfile: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.code(200).send({
          message: 'Brand updated successfully',
          brand: updatedBrand,
        });
      } catch (error) {
        console.error('Brand update error:', error);

        // Handle specific Prisma errors
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A brand with this name already exists' });
        }

        return reply.code(500).send({ error: 'Failed to update brand' });
      }
    }
  );

  // Delete a brand
  fastify.delete<{ Params: { id: string } }>('/brand/:id', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const token = authHeader.substring(7);
      let decoded;
      try {
        decoded = verifyJWT(token);
      } catch (jwtError) {
        console.error('JWT verification error:', jwtError);
        return reply.code(401).send({ error: 'Invalid authentication token' });
      }
      const userId = decoded.id;

      const { id } = request.params;

      // Check if brand exists and user owns it
      const brand = await prisma.brand.findFirst({
        where: {
          id,
          userId,
        },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              content: true,
            },
          },
        },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      // Delete the brand (cascade will handle related content)
      await prisma.brand.delete({
        where: { id },
      });

      return reply.code(200).send({
        message: 'Brand deleted successfully',
        deletedBrand: {
          id: brand.id,
          name: brand.name,
          contentCount: brand._count.content,
        },
      });
    } catch (error) {
      console.error('Brand deletion error:', error);
      return reply.code(500).send({ error: 'Failed to delete brand' });
    }
  });
};

export default brandsRoutes;
