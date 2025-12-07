/**
 * Video Upload Routes
 * Proxies uploads through the assets service (no direct S3 from the API)
 */

import { FastifyPluginAsync } from 'fastify';
import { AssetsServiceClient } from '@postolio/assets-client';
import { config } from '../config/env-validation.js';
import { formatError } from '../utils/logging.js';
import { assertBrandOwnership } from '../services/ownership.js';

const assetsClient = new AssetsServiceClient({
  baseUrl: config.ASSETS_API_BASE_URL,
  serviceToken: config.ASSETS_API_SERVICE_TOKEN,
});

const MAX_VIDEO_SIZE = 300 * 1024 * 1024; // 300MB (Instagram limit)

const videoRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Initiate upload via the assets service
   */
  fastify.post<{
    Body: {
      fileName: string;
      fileSize: number;
      contentType: string;
      brandId: string;
    };
  }>('/upload-url', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { fileName, fileSize, contentType, brandId } = request.body;

      if (!fileName || !brandId || fileSize == null || !contentType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      if (!contentType.startsWith('video/')) {
        return reply.code(400).send({
          error: 'Invalid content type. Must be a video file.',
        });
      }

      if (fileSize > MAX_VIDEO_SIZE) {
        return reply.code(400).send({
          error: `File too large. Maximum size is ${MAX_VIDEO_SIZE / (1024 * 1024)}MB`,
        });
      }
      await assertBrandOwnership(userId, brandId);

      const uploadData = await assetsClient.getUploadUrl({
        brandId,
        fileName,
        contentType,
        fileType: 'video',
        fileSize,
      });

      return reply.send({
        ...uploadData,
        strategy: 'assets-service',
      });
    } catch (error) {
      request.log.error(formatError(error), 'Video upload initiation error');
      return reply.code(500).send({
        error: 'Failed to initiate video upload',
      });
    }
  });

  /**
   * Complete upload by creating asset metadata in the assets service
   */
  fastify.post<{
    Body: {
      brandId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      s3Key: string;
      duration?: number;
    };
  }>('/upload-complete', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { brandId, fileName, fileSize, mimeType, s3Key, duration } = request.body;

      if (!brandId || !fileName || !mimeType || !s3Key || fileSize == null) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      await assertBrandOwnership(userId, brandId);

      const result = await assetsClient.createAsset({
        brandId,
        fileName,
        s3Key,
        fileSize,
        mimeType,
        fileType: 'video',
        uploadedBy: userId,
        duration,
      });

      return reply.send({
        success: true,
        cdnUrl: result.asset.url,
        key: result.asset.s3Key,
        assetId: result.asset.id,
        message: result.message,
        strategy: 'assets-service',
      });
    } catch (error) {
      request.log.error(formatError(error), 'Video upload completion error');
      return reply.code(500).send({
        error: 'Failed to complete video upload',
      });
    }
  });

  /**
   * Abort upload — no-op for single PUT uploads handled by the assets service
   */
  fastify.post<{
    Body: {
      uploadId?: string;
      key?: string;
    };
  }>('/upload-abort', { preHandler: fastify.authenticate }, async (_request, reply) => {
    return reply.send({
      success: true,
      message: 'Uploads are handled by the assets service; no multipart session to abort.',
    });
  });
};

export default videoRoutes;
